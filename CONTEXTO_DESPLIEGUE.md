# Contexto de Despliegue - kube-green

Última validación contra los clusters: 22/09/2026.

## Estado desplegado

| Componente | Imagen | DEV | TEST | Producción |
|---|---|---|---|---|
| Operador (`manager`) | `yeramirez/kube-green:0.7.28` | sí | sí | no instalado |
| Frontend (`frontend`) | `yeramirez/kube-front:0.7.12` | sí | sí | no instalado |

Digest del operador en DEV: `sha256:91dde884189c6c33d47976fd23b7aa112c6ce6e832805775b33049db68ea51eb`

En producción (`eks-prod-dya-bda-stratio`) kube-green **no está instalado**: no hay
deployments, ni el CRD `sleepinfos.kube-green.com`, ni SleepInfos.

Las numeraciones del operador y del frontend son independientes: `kube-front:0.7.12`
contiene los mismos cambios de frontend que acompañan al operador `0.7.28`.

## Nomenclatura de imágenes

- Operador: `yeramirez/kube-green:0.7.X`
- Frontend: `yeramirez/kube-front:0.7.X` (sin sufijo; las variantes `-web` y `-front` son
  de versiones antiguas y ya no se usan)

`VERSION` del `Makefile` está en `0.7.28`, alineado con la imagen desplegada. El
`package.json` del frontend lleva su propia numeración (`0.7.19`) y no coincide con el tag
de su imagen.

## Kubernetes

Namespace único: `keos-core`, en los contextos:

- DEV: `arn:aws:eks:us-east-1:322089317744:cluster/eks-dya-bda-stratio-dev`
- TEST: `arn:aws:eks:us-east-1:563468491841:cluster/eks-dya-bda-stratio-test`

| Deployment | Contenedor | Puerto |
|---|---|---|
| `kube-green-controller-manager` | `manager` | API en 8080 |
| `kube-green-frontend` | `frontend` | 80 |
| `kube-green-exporter` | — | métricas |

El API REST corre dentro del propio controller-manager; el service
`kube-green-api-service` apunta a él por el selector `control-plane: controller-manager`.
Requiere los flags `--enable-api`, `--api-port=8080` y `--enable-api-cors`.

## Build y actualización

### Operador

```bash
make docker-build IMG=yeramirez/kube-green:0.7.29
make docker-push  IMG=yeramirez/kube-green:0.7.29
kubectl set image deployment/kube-green-controller-manager \
  manager=yeramirez/kube-green:0.7.29 -n keos-core --context <ctx>
kubectl rollout status deployment/kube-green-controller-manager -n keos-core --context <ctx>
```

### Frontend

```bash
cd frontend-app
docker build -t yeramirez/kube-front:0.7.13 .
docker push yeramirez/kube-front:0.7.13
kubectl set image deployment/kube-green-frontend \
  frontend=yeramirez/kube-front:0.7.13 -n keos-core --context <ctx>
kubectl rollout status deployment/kube-green-frontend -n keos-core --context <ctx>
```

> **No usar `helm upgrade` sobre el release `kube-green`.** El deployment declara
> `helm.sh/chart: kube-green-0.7.1` porque las imágenes se han actualizado siempre fuera de
> Helm. Un upgrade o un rollback sobre ese release revertiría el operador a la imagen del
> chart 0.7.1. Si se quiere volver a gestionar por Helm, hay que reconciliar antes el release
> con el chart de este repositorio, que ya está en la versión 0.7.28.

## Verificación

```bash
CTX=<contexto>

# Imagen y digest que corren realmente
kubectl get pod -n keos-core --context $CTX -l control-plane=controller-manager \
  -o jsonpath='{range .status.containerStatuses[*]}{.image}{"\n"}{.imageID}{"\n"}{end}'

# Campos del CRD vivo
kubectl get crd sleepinfos.kube-green.com --context $CTX -o json \
  | python3 -c "import json,sys;print(sorted(json.load(sys.stdin)['spec']['versions'][0]['schema']['openAPIV3Schema']['properties']['spec']['properties']))"

# Logs del operador
kubectl logs -n keos-core -l control-plane=controller-manager --context $CTX --since=1h
```

El CRD del cluster **no procede del chart de este repositorio**: los campos coinciden, pero
las descripciones no. Que un campo aparezca en el CRD vivo no implica que el operador
desplegado tenga su lógica; para eso hay que inspeccionar el binario (ver `CLAUDE.md`).

## Estado de implementación

### Operador

- Campo `spec.ignoreExternalModifications` en el CRD y en el tipo `SleepInfo`.
- Soporte de CRDs de operadores: PgCluster, PgBouncer, HDFSCluster, OsCluster,
  OsDashboards, KafkaCluster, con patches dinámicos que se aplican sin verificar el
  restore patch.
- Emparejamiento de SleepInfos sleep/wake: el wake toma los restore patches del sleep
  relacionado, y los datos de restore se conservan en el secret tras el wake.
- Registro de la generación de cada recurso al dormirlo
  (`sleep-resource-generations` en el secret), para no despertar recursos modificados
  por terceros mientras dormían.

### API REST

Endpoints de recursos por tenant y CRUD de horarios por namespace, con delays configurables
y soporte de `userTimezone`.

### Frontend

Dashboard con tarjetas por tenant y acciones de sleep/wake, detalle de namespace, editor de
horarios, gestión de usuarios y servicios suspendidos.

## Pendiente de desplegar

La lógica de `ignoreExternalModifications` **no está en la imagen 0.7.28**. Se verificó
extrayendo el binario: contiene `skip wake up` y `sleep-resource-generations`, pero ni
`waking up anyway` ni `ignoreExternalModifications`.

Consecuencia: en DEV hay 150 SleepInfo con el campo a `true` que no surte efecto, y cuatro
PgBouncer siguen sin despertar por diferencia de generación —`bdadev-genaiv6`,
`bdadev-genaiv8` y los dos de `bdadevd1a-datastores`—. El de `bdadev-genaiv8` mantiene caído
a `genai-api-v8` y, con él, al Intelligence de ese tenant.

Publicar una imagen a partir del commit etiquetado `deployed/0.7.28` o posterior resuelve
ese caso.
