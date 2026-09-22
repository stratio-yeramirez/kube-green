# kube-green — fork de Stratio para Banco Pichincha

Fork de [kube-green](https://github.com/kube-green/kube-green) con extensiones propias para
apagar y encender tenants completos de la plataforma Stratio en horario no laboral. Añade
soporte para CRDs de operadores (PgCluster, PgBouncer, HDFSCluster, OsCluster, OsDashboards,
KafkaCluster), una API REST y un frontend React para gestionar horarios.

Remoto: `https://github.com/stratio-yeramirez/kube-green.git` · Rama de trabajo: `main`

## Estructura

| Ruta | Contenido |
|---|---|
| `api/v1alpha1/` | Tipos del CRD SleepInfo |
| `internal/controller/sleepinfo/` | Controlador: reconciliación, secrets, sleep/wake |
| `internal/controller/sleepinfo/jsonpatch/` | Aplicación de patches a recursos genéricos y CRDs |
| `internal/api/v1/` | API REST (handlers, schedule_service, auth) |
| `frontend-app/` | Frontend React + TypeScript + MUI (versionado en este repo) |
| `charts/kube-green/` | Chart Helm |

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

El CRD por sí solo no prueba que el operador tenga la lógica: se aplica por un camino
distinto al de la imagen. Para comprobar el binario de verdad, hay que extraerlo, porque
la imagen es distroless y no tiene shell:

```bash
CID=$(docker create yeramirez/kube-green:<tag>)
docker export $CID > /tmp/kg.tar && docker rm -f $CID
tar xf /tmp/kg.tar kube-green -C /tmp
strings /tmp/kube-green | grep -c "<literal de la funcionalidad>"
```

## Trampas conocidas

**El release Helm no refleja lo desplegado.** El deployment declara
`helm.sh/chart: kube-green-0.7.1` mientras corre una imagen muy posterior, porque la imagen
se ha ido cambiando fuera de Helm. Un `helm upgrade` o `helm rollback` sobre ese release
revertiría el operador a la imagen del chart 0.7.1. Actualizar con `kubectl set image`, o
reconciliar antes el release con el chart del repo.

**El CRD del cluster no procede de este chart.** Sus descripciones no coinciden con
`charts/kube-green/templates/crds/sleepinfo.yaml` ni con `config/crd/bases/`. Los campos sí
coinciden. Al añadir un campo nuevo al `SleepInfo` no basta con actualizar el chart: hay que
asegurarse de que el CRD del cluster también lo incorpore, o el operador esperará un campo
que la API rechaza.

**Para consultar el cluster con permisos de administración** existe el contenedor local
`keos-installer-pichincha-dev-2` (imagen `qa.int.stratio.com/stratio/keos-installer:1.2.10`),
que apunta al mismo cluster:

```bash
docker exec keos-installer-pichincha-dev-2 kubectl get crd sleepinfos.kube-green.com -o json
```

**Los SleepInfo se despiertan escalonados.** El patrón estándar del cluster es
`pg-hdfs` → `pgbouncer` (+5 min) → resto del tenant (+10 min). Si todos comparten hora, las
aplicaciones arrancan antes que sus bases de datos y entran en bucle de reinicios. Al cambiar
un `sleepAt`, el operador conserva el requeue anterior hasta el siguiente ciclo: la hora nueva
no rige hasta el día siguiente. Su `status.lastScheduleTime` no es fiable para auditar la hora
real de ejecución, porque se actualiza por reconciliación del namespace; la evidencia buena es
la edad de los pods.

## Build y despliegue

```bash
# Operador
make docker-build IMG=yeramirez/kube-green:<tag>
make docker-push  IMG=yeramirez/kube-green:<tag>
kubectl set image deployment/kube-green-controller-manager manager=yeramirez/kube-green:<tag> -n keos-core --context $CTX

# Frontend
cd frontend-app && docker build -t yeramirez/kube-front:<tag> .
docker push yeramirez/kube-front:<tag>
kubectl set image deployment/kube-green-frontend frontend=yeramirez/kube-front:<tag> -n keos-core --context $CTX
```

Al publicar una imagen conviene etiquetar el commit correspondiente (`deployed/<version>`),
porque la imagen no lleva grabado el commit del que se construyó y la correspondencia solo
puede deducirse por fechas.

## Convenciones

- `go build`, `go vet`, `go test ./...`, y en el frontend `npx tsc --noEmit` y `npm run build`
  deben quedar en verde antes de commitear. Los tests del controlador usan envtest y tardan
  alrededor de un minuto.
- `go build ./...` no compila los ficheros `_test.go`: un test que no compila solo lo detecta
  `go vet` o `go test`.
- Pasar `gofmt -w` sobre lo tocado.
- Las extensiones propias sobre el código upstream van marcadas con comentarios `EXTENSIÓN:`.
