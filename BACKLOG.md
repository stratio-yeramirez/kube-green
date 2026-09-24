# Backlog

Trabajo pendiente de kube-green en Banco Pichincha. Última actualización: 24/09/2026.

Estado del repositorio: rama `develop` con la versión prerelease `0.7.29-rc.1` lista para
probar; `main` en la estable `0.7.28`, que es lo que corre en DEV y TEST. Ninguna de las dos
está subida a `origin`.

---

## Bloqueantes

### 1. Publicar las imágenes de la prerelease

El chart `dist/charts/kube-green-0.7.29-rc.1.tgz` está empaquetado, pero las imágenes no
existen todavía en el registro. Sin ellas no se puede desplegar nada.

```bash
make docker-build IMG=yeramirez/kube-green:0.7.29-rc.1
make docker-push  IMG=yeramirez/kube-green:0.7.29-rc.1
cd frontend-app && docker build -t yeramirez/kube-front:0.7.13-rc.1 . && docker push yeramirez/kube-front:0.7.13-rc.1
```

Pendiente de decidir quién lo ejecuta: el `git push` de este repositorio lo bloqueó el
clasificador de seguridad del entorno de trabajo, y el `docker push` va al mismo tipo de
destino externo.

### 2. Desplegar y probar en TEST

Con Helm desde el contenedor `keos-installer-pichincha-dev-2`, pasando siempre
`values-test.yaml`. Procedimiento completo en `RELEASE.md`.

Qué hay que validar:

- Guardar un horario con delays desde la interfaz y comprobar que los SleepInfo quedan
  escalonados en el cluster.
- En el siguiente ciclo de encendido (12:00–12:45 UTC), que `virtualizer`, `rocket` y los
  `hdfs-namenode` no acumulen reinicios.
- Que aparezca en los logs del operador `waking up anyway (ignoreExternalModifications=true)`,
  un mensaje que hoy no sale ninguna vez.

### 3. Subir el repositorio a origin

`main` y `develop` solo existen en el disco local, más el respaldo
`backups/kube-green-worktree-20260922-1111.tar.gz`. El `git push origin main --tags` está
bloqueado por el clasificador del entorno. Hay que subirlo manualmente o habilitar el
permiso.

---

## Incidencias abiertas en los entornos

### 4. Cuatro PgBouncer sin despertar en DEV

`bdadev-genaiv6`, `bdadev-genaiv8` y los dos de `bdadevd1a-datastores` llevan a 0 instancias
desde el 18/09. El operador los omite porque su generación cambió mientras dormían, y la
imagen desplegada no tiene la lógica de `ignoreExternalModifications` que permitiría
despertarlos.

El de `bdadev-genaiv8` es la causa de que `genai-api-v8` acumule reinicios y de que
Intelligence de ese tenant no arranque. Debería resolverse con el despliegue del punto 2;
si no, hay que levantarlos a mano.

### 5. Escalonado revertido en bdadevrie y bdadevdat

Se escalonaron el 22/09 con `kubectl patch` y el 24/09 estaban de nuevo con todos los wake a
las 12:00. La causa es la del punto 1 de las correcciones de esta release: alguien guardó esos
tenants desde la interfaz y la API regeneró los SleepInfo descartando los delays.

Una vez desplegada la prerelease hay que volver a escalonarlos, **desde la interfaz o la API**,
no con `kubectl`, y comprobar que se mantienen tras una edición posterior.

Tenants que conservan el escalonado: `bdadevapo`, `bdadevmdp`, `bdadevidn`.

### 6. Excluir genai de los encendidos

Petición pendiente de concretar: que los recursos de genai no se enciendan en ninguno de los
dos entornos. Inventario:

- DEV: `bdadev-genai`, `bdadev-genaitest`, `bdadev-genaiv6`, `bdadev-genaiv8`,
  `bdadevadm-genai`, `bdadevdvn1-genai`, `bdadevidn-genai`, `bdadevrie-genai`,
  `bdadevsnd-genai`, `bdadevtdm-genai`
- TEST: `bdaqa-genaiv6`

Falta decidir el método: suspender los SleepInfo de wake de esos namespaces, usar
`excludeRef` sobre los recursos genai, o `suspendScheduleUntil`. La decisión cambia bastante
el resultado, sobre todo si se quiere seguir apagándolos pero no encenderlos.

---

## Deuda técnica

### 7. Los endpoints por namespace no existen

El frontend llama a `GET/POST/PUT/DELETE /schedules/{tenant}/{namespace}`, pero esas rutas
están comentadas en `server.go` con un `// TODO: Implement namespace-specific handlers`. Los
handlers HTTP no existen, aunque la capa de servicio sí está completa
(`GetNamespaceSchedule`, `CreateNamespaceSchedule`, `UpdateNamespaceSchedule`,
`DeleteNamespaceSchedule`). Cualquier edición por namespace desde la interfaz recibe un 404.

Es cablear cuatro handlers sobre métodos que ya existen.

### 8. El frontend no tiene tests

No hay vitest ni jest configurados. `toApiDelays` y `fromApiDelays` son justo el tipo de
función que conviene cubrir: traducen entre dos contratos y un error ahí no da ningún error
visible. Implica añadir la dependencia al proyecto, por eso no se hizo.

### 9. El release de Helm sigue divergente

El deployment declara `helm.sh/chart: kube-green-0.7.1` mientras corre la imagen `0.7.28`,
porque las imágenes se han actualizado siempre con `kubectl set image`. Desplegar con Helm
como indica `RELEASE.md` reconcilia esa diferencia, pero conviene verificarlo en el primer
upgrade.

### 10. Las imágenes no llevan grabado el commit

La correspondencia entre una imagen y su código se deduce por fechas. Añadir al Dockerfile
`LABEL org.opencontainers.image.revision=$(git rev-parse HEAD)` con un `--build-arg`
permitiría comparar digest contra commit sin inferencias.

### 11. Comprobación de generación con desviación de 1

Decenas de PgBouncer registran `skip wake up` con una desviación de exactamente una
generación (162 frente a 163, 272 frente a 273). Apunta a que el propio patch de sleep
incrementa la generación después de guardarla. No dejan recursos caídos porque el operador de
postgres los reconcilia, pero el mecanismo de protección está saltando cuando no debería.

---

## Seguimiento

### 12. SS-170807 — Error en discovery, tenant de riesgo

En *Waiting for customer* desde el 22/09, con el análisis publicado como nota interna. El
escalonado aplicado ese día redujo los reinicios del tenant de nueve a uno, pero la reversión
del punto 5 deja la validación incompleta. Antes de cerrarlo conviene confirmar un ciclo
limpio con la prerelease desplegada.

### 13. Promover develop a main

Cuando la prerelease acumule al menos un ciclo de encendido correcto en TEST: fusionar en
`main`, quitar el sufijo `-rc.1` de `Chart.yaml`, `values.yaml` y `Makefile`, publicar
`0.7.29` y etiquetar `deployed/0.7.29` con el digest de la imagen.
