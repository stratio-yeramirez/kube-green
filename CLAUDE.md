# kube-green — fork de Stratio para Banco Pichincha

Fork de [kube-green](https://github.com/kube-green/kube-green) con extensiones propias para
apagar y encender tenants completos de la plataforma Stratio en horario no laboral. Añade
soporte para CRDs de operadores (PgCluster, PgBouncer, HDFSCluster, OsCluster, OsDashboards,
KafkaCluster), una API REST y un frontend React para gestionar horarios.

Remoto: `https://github.com/stratio-yeramirez/kube-green.git`

Se trabaja en `develop` con versiones prerelease y se fusiona en `main` cuando está validado.
El flujo completo, con el procedimiento de despliegue, está en `RELEASE.md`. El trabajo
pendiente, en `BACKLOG.md`.

## Estructura

| Ruta | Contenido |
|---|---|
| `api/v1alpha1/` | Tipos del CRD SleepInfo |
| `internal/controller/sleepinfo/` | Controlador: reconciliación, secrets, sleep/wake |
| `internal/controller/sleepinfo/jsonpatch/` | Aplicación de patches a recursos genéricos y CRDs |
| `internal/api/v1/` | API REST (handlers, schedule_service, auth) |
| `frontend-app/` | Frontend React + TypeScript + MUI (versionado en este repo) |
| `charts/kube-green/` | Chart Helm, con `values-dev.yaml` y `values-test.yaml` por entorno |

## Dónde corre

Solo en los entornos de Banco Pichincha **DEV y TEST**. No está instalado en producción:
allí no hay deployments, ni CRD, ni SleepInfos.

| | Contexto kubectl | Namespace |
|---|---|---|
| DEV | `arn:aws:eks:us-east-1:322089317744:cluster/eks-dya-bda-stratio-dev` | `keos-core` |
| TEST | `arn:aws:eks:us-east-1:563468491841:cluster/eks-dya-bda-stratio-test` | `keos-core` |

Dos contenedores: `manager` (operador, `yeramirez/kube-green`) y `frontend`
(`yeramirez/kube-front`). Sus numeraciones de versión son independientes entre sí.

## Cómo saber qué está desplegado

El repositorio y el cluster han divergido más de una vez, así que conviene comprobarlo
antes de tocar nada.

```bash
CTX=arn:aws:eks:us-east-1:322089317744:cluster/eks-dya-bda-stratio-dev

# Imagen y digest que corren
kubectl get pod -n keos-core --context $CTX -l control-plane=controller-manager \
  -o jsonpath='{range .status.containerStatuses[*]}{.image}{"\n"}{.imageID}{"\n"}{end}'

# Campos del CRD vivo, para saber si un campo nuevo ya está desplegado
kubectl get crd sleepinfos.kube-green.com --context $CTX -o json \
  | python3 -c "import json,sys;print(sorted(json.load(sys.stdin)['spec']['versions'][0]['schema']['openAPIV3Schema']['properties']['spec']['properties']))"
```

**El CRD por sí solo no prueba que el operador tenga la lógica.** Ocurrió con
`ignoreExternalModifications`: el campo está en el CRD y 150 SleepInfo de DEV lo usan, pero
la imagen `0.7.28` no lo implementa. Para comprobar el binario hay que extraerlo, porque la
imagen es distroless y no tiene shell:

```bash
CID=$(docker create yeramirez/kube-green:<tag>)
docker export $CID > /tmp/kg.tar && docker rm -f $CID
tar xf /tmp/kg.tar kube-green -C /tmp
strings /tmp/kube-green | grep -c "<literal de la funcionalidad>"
```

## Trampas conocidas

**Los horarios se gestionan por la API, no con `kubectl`.** Al guardar un tenant desde la
interfaz, la API regenera sus SleepInfo a partir de la hora base y los delays de la petición.
Un `kubectl patch` sobre un SleepInfo sobrevive solo hasta que alguien edite ese tenant en la
interfaz. Ocurrió con `bdadevrie` y `bdadevdat`, que perdieron su escalonado dos días después
de aplicarlo a mano.

**El contrato de los delays es frágil.** El backend lee `pgHdfsDelay`, `pgbouncerDelay` y
`deploymentsDelay`; el formulario maneja un campo por tipo de recurso y los traduce con
`toApiDelays`. Un payload con otros nombres se deserializa sin error, llega vacío y, como el
objeto sí existe, el backend tampoco aplica sus valores por defecto: todos los SleepInfo del
tenant acaban a la misma hora. Los tests de `internal/api/v1/delays_test.go` fijan ese
contrato; si se tocan los nombres de los campos, hay que tocar ambos lados.

**El release Helm no refleja lo desplegado.** El deployment declara
`helm.sh/chart: kube-green-0.7.1` mientras corre una imagen muy posterior, porque las
imágenes se han cambiado históricamente con `kubectl set image`. Desplegar con Helm siguiendo
`RELEASE.md` reconcilia esa diferencia, pero conviene comparar antes el render del chart con
el deployment vivo.

**Hay que pasar siempre los values del entorno.** El chart trae por defecto la identidad de
DEV. Un upgrade de TEST sin `values-test.yaml` le deja la apariencia de DEV y vacía
`CLUSTER_NAME`. Los secrets `kube-green-jwt` y `kube-green-users` sí los preserva el propio
chart con `lookup`, de modo que un upgrade no invalida credenciales.

**El CRD del cluster no procede de este chart.** Los campos coinciden, las descripciones no,
y no se corresponden con ningún fichero del repositorio ni del contenedor del keos-installer;
su origen no está identificado. Al añadir un campo al `SleepInfo` conviene verificar que el
CRD del cluster lo incorpora, o el operador esperará un campo que la API rechaza.

**Para consultar el cluster con permisos de administración** existe el contenedor local
`keos-installer-pichincha-dev-2` (imagen `qa.int.stratio.com/stratio/keos-installer:1.2.10`),
que apunta al mismo cluster y es desde donde se despliega con Helm:

```bash
docker exec keos-installer-pichincha-dev-2 kubectl get crd sleepinfos.kube-green.com -o json
```

**Un tenant puede amanecer apagado por un desfase de generación.** Al dormir un recurso, el
operador guarda su generación para detectar más tarde si alguien lo modificó durante la noche.
Esa relectura iba contra la caché del informer, que justo después del patch todavía devuelve
la versión anterior, de modo que se guardaba un número desfasado y por la mañana el wake creía
que el recurso había cambiado y no lo encendía. El 25/09 le pasó a `bdadevd1a`, que amaneció
con los PgBouncer parados, seis deployments a cero y Discovery caído; de los 213 recursos
afectados ese día, 158 diferían en exactamente una unidad. Corregido en `develop` (`fde69a6`)
pasando a un lector directo a la API. Mientras esa corrección no esté desplegada, los tenants
sin `ignoreExternalModifications` siguen expuestos; el síntoma en el log del operador es
`resource modified after sleep and before wake up, skip wake up`. Para desbloquear uno ya
apagado: activar el flag en sus SleepInfo de wake y lanzar un encendido manual con las
anotaciones `kube-green.stratio.com/manual-action: wake` y `manual-at` en RFC3339, que caduca
a los cinco minutos. El encendido manual debe respetar el orden Postgres, PgBouncer y después
los deploys.

**Un deployment sin restore patch no se enciende.** Si kube-green no tiene guardado el estado
previo de un recurso, no lo toca: `no restore patch found for resource, skipped`. Es
deliberado, para no dejarlo peor. Hay que devolverlo a sus réplicas a mano.

**Los SleepInfo se despiertan escalonados.** El patrón estándar del cluster es
`pg-hdfs` → `pgbouncer` (+5 min) → resto del tenant (+10 min). Si todos comparten hora, las
aplicaciones arrancan antes que sus bases de datos y entran en bucle de reinicios. Al cambiar
un `sleepAt`, el operador conserva el requeue anterior hasta el siguiente ciclo: la hora nueva
no rige hasta el día siguiente. Su `status.lastScheduleTime` no es fiable para auditar la hora
real de ejecución, porque se actualiza por reconciliación del namespace; la evidencia buena es
la edad de los pods.

## Build y despliegue

El despliegue se hace con Helm desde el contenedor `keos-installer`, no con
`kubectl set image`. Procedimiento completo, versiones y comprobaciones previas en
`RELEASE.md`.

```bash
make docker-build IMG=yeramirez/kube-green:<tag>
make docker-push  IMG=yeramirez/kube-green:<tag>
helm package charts/kube-green -d dist/charts
docker cp dist/charts/kube-green-<tag>.tgz keos-installer-pichincha-dev-2:/tmp/
docker exec keos-installer-pichincha-dev-2 \
  helm upgrade kube-green /tmp/kube-green-<tag>.tgz -n keos-core -f /tmp/values-test.yaml --wait
```

Al publicar una imagen conviene etiquetar el commit correspondiente (`deployed/<version>`),
porque la imagen no lleva grabado el commit del que se construyó y la correspondencia solo
puede deducirse por fechas.

## Convenciones

- `go build`, `go vet`, `go test ./...`, y en el frontend `npx tsc --noEmit`, `npm test` y
  `npm run build` deben quedar en verde antes de commitear. Los tests del controlador usan
  envtest y tardan alrededor de un minuto.
- `go build ./...` no compila los ficheros `_test.go`: un test que no compila solo lo detecta
  `go vet` o `go test`.
- Pasar `gofmt -w` sobre lo tocado.
- Las extensiones propias sobre el código upstream van marcadas con comentarios `EXTENSIÓN:`.
- Este fichero se actualiza en el mismo commit que el cambio que lo afecta.

### Qué hay cubierto con tests

| Qué | Dónde |
|---|---|
| Contrato JSON de los delays y su herencia al reeditar | `internal/api/v1/delays_test.go` |
| Días de la semana y desplazamiento entre zonas horarias | `internal/api/v1/weekdays_test.go` |
| La generación se relee de la API y no de la caché | `internal/controller/sleepinfo/resource/reader_test.go` |
| Traducción de delays en ambos sentidos, días y zonas | `frontend-app/src/utils/timezone.test.ts` |

El frontend usa vitest (`npm test`, o `npm run test:watch` mientras se desarrolla).
