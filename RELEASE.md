# Ramas, versiones y despliegue

## Ramas

| Rama | Para qué | Versión |
|---|---|---|
| `develop` | Todo el trabajo: correcciones, funcionalidades nuevas, pruebas en TEST | prerelease (`0.7.29-rc.1`) |
| `main` | Lo que está validado y desplegado | estable (`0.7.28`) |

Se trabaja siempre en `develop`. Cuando los cambios se han probado en TEST y funcionan, se
fusionan en `main` y se publica una versión estable. `main` debe reflejar en todo momento lo
que corre en los entornos: si algo está desplegado, su código está en `main` y etiquetado.

## Versiones

El chart, el `appVersion` y el tag de la imagen del operador van siempre al mismo número. El
frontend lleva su propia numeración, porque se publica como imagen aparte.

**Prerelease**, mientras se prueba en TEST:

```
0.7.29-rc.1, 0.7.29-rc.2, ...
```

Es SemVer válido para Helm y admisible como tag de Docker. Cada corrección durante las
pruebas incrementa el `rc`, no el número base.

**Estable**, al fusionar en `main`:

```
0.7.29
```

Se quita el sufijo, se etiqueta el commit con `deployed/0.7.29` cuando esa versión llega a
los entornos, y se publica el chart con ese número.

Al publicar cualquier versión hay que tocar los cuatro sitios a la vez:

| Fichero | Campo |
|---|---|
| `charts/kube-green/Chart.yaml` | `version` y `appVersion` |
| `charts/kube-green/values.yaml` | `manager.image.tag` y, si cambia, `frontend.image.tag` |
| `Makefile` | `VERSION` |
| commit | tag `deployed/<versión>` cuando se despliegue |

## Publicar las imágenes

```bash
# Operador
make docker-build IMG=yeramirez/kube-green:0.7.29-rc.1
make docker-push  IMG=yeramirez/kube-green:0.7.29-rc.1

# Frontend, solo si cambió
cd frontend-app
docker build -t yeramirez/kube-front:0.7.13-rc.1 .
docker push yeramirez/kube-front:0.7.13-rc.1
```

## Desplegar

El despliegue se hace **con Helm desde el contenedor `keos-installer`**, no con
`kubectl set image`. El chart empaquetado se copia al contenedor y se aplica desde allí.

```bash
helm package charts/kube-green -d dist/charts

# Copiar el chart al installer del entorno correspondiente
docker cp dist/charts/kube-green-0.7.29-rc.1.tgz keos-installer-pichincha-dev-2:/tmp/

# TEST
docker exec keos-installer-pichincha-dev-2 \
  helm upgrade kube-green /tmp/kube-green-0.7.29-rc.1.tgz \
  -n keos-core -f /tmp/values-test.yaml --wait

# DEV
docker exec keos-installer-pichincha-dev-2 \
  helm upgrade kube-green /tmp/kube-green-0.7.29-rc.1.tgz \
  -n keos-core -f /tmp/values-dev.yaml --wait
```

Los ficheros `values-dev.yaml` y `values-test.yaml` del chart llevan la identidad de cada
entorno (`ENV_NAME`, `ENV_COLOR`, `ENV_LABEL` y `CLUSTER_NAME`). **Hay que pasarlos
siempre**: sin ellos el upgrade aplica los valores por defecto del chart, que son los de
DEV, y deja TEST con la apariencia de DEV y sin `CLUSTER_NAME`.

### Antes de cada upgrade

El deployment se ha modificado en el pasado fuera de Helm, así que conviene comprobar que el
chart no va a quitar nada de lo que hay:

```bash
# Qué generaría el chart
helm template kube-green charts/kube-green -n keos-core -f charts/kube-green/values-test.yaml

# Qué hay vivo
kubectl get deploy kube-green-controller-manager -n keos-core --context <ctx> -o yaml
```

Comparar imagen, `args`, variables de entorno y puertos. Los secrets `kube-green-jwt` y
`kube-green-users` los preserva el propio chart con `lookup`, de modo que un upgrade no
invalida las credenciales ni cierra las sesiones. Conviene confirmarlo igualmente después:

```bash
kubectl get secret kube-green-jwt -n keos-core --context <ctx> -o jsonpath='{.metadata.resourceVersion}'
```

### Después del upgrade

```bash
kubectl rollout status deployment/kube-green-controller-manager -n keos-core --context <ctx>
kubectl get pod -n keos-core --context <ctx> -l control-plane=controller-manager \
  -o jsonpath='{range .status.containerStatuses[*]}{.image}{"\n"}{.imageID}{"\n"}{end}'
```

La validación de fondo es el siguiente ciclo de encendido: entre las 12:00 y las 12:45 UTC,
comprobar que `virtualizer`, `rocket` y los `hdfs-namenode` de los tenants no acumulan
reinicios.

## Promover a estable

1. Los cambios llevan al menos un ciclo de encendido correcto en TEST.
2. Se fusiona `develop` en `main`.
3. Se quita el sufijo `-rc.N` de `Chart.yaml`, `values.yaml` y `Makefile`.
4. Se publican las imágenes y el chart con el número estable.
5. Se despliega en DEV y TEST con el mismo procedimiento.
6. Se etiqueta el commit: `git tag -a deployed/0.7.29 -m "..."`, anotando el digest de la
   imagen, ya que la imagen no lleva grabado el commit del que salió.
