# Diagrama de Flujo: Gestión Unificada de Recursos

## Flujo Completo: Sleep y Wake Operations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INICIO: SleepInfo Reconcile                          │
│                  (suspendDeployments=True, suspendStatefulSets=True)          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 1: Listar Recursos                                                      │
│  • kubectl get deployments -n <namespace>                                   │
│  • kubectl get statefulsets -n <namespace>                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 2: Para cada Deployment/StatefulSet encontrado                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ ¿Es operación SLEEP o WAKE?   │
                    └───────────────────────────────┘
                            │              │
              ┌─────────────┘              └─────────────┐
              ▼                                           ▼
      ┌───────────────┐                          ┌───────────────┐
      │   SLEEP       │                          │   WAKE        │
      └───────┬───────┘                          └───────┬───────┘
              │                                           │
              ▼                                           ▼


═══════════════════════════════════════════════════════════════════════════════
                            FLUJO SLEEP (APAGADO)
═══════════════════════════════════════════════════════════════════════════════

              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 3: Detectar Tipo de Recurso                                           │
│                                                                              │
│  Verificar labels del Deployment/StatefulSet:                               │
│  • pgbouncer.stratio.com/pgbouncer-name → PgBouncer CRD                      │
│  • pgcluster.stratio.com/cluster → PgCluster CRD (via StatefulSet)          │
│  • hdfs.stratio.com/cluster → HDFSCluster CRD (via StatefulSet)              │
│  • Si no hay labels → Recurso Nativo                                        │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
        ┌─────┴─────┐
        │           │
        ▼           ▼
┌─────────────┐  ┌──────────────┐
│  CRD        │  │  NATIVO      │
│  Detectado  │  │  (Directo)   │
└─────┬───────┘  └──────┬───────┘
      │                  │
      ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  RAMA CRD:                                                                   │
│  1. Obtener CRD padre del namespace                                         │
│     kubectl get pgbouncer <nombre> -n <ns>                                  │
│                                                                              │
│  2. Leer spec.instances actual                                              │
│     currentInstances = crd.spec.instances  // ej: 2                         │
│                                                                              │
│  3. Guardar restore patch                                                   │
│     restorePatch[crdName] = {"spec":{"instances":2}}                        │
│                                                                              │
│  4. Aplicar patch al CRD                                                    │
│     crd.spec.instances = 0                                                  │
│     kubectl patch pgbouncer <nombre> -p '{"spec":{"instances":0}}'         │
│                                                                              │
│  5. Operador detecta cambio                                                 │
│     → Escala Deployment/StatefulSet a 0 automáticamente                    │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  RAMA NATIVO:                                                                │
│  1. Leer spec.replicas actual                                               │
│     currentReplicas = deployment.spec.replicas  // ej: 3                   │
│                                                                              │
│  2. Guardar restore patch                                                   │
│     restorePatch[deploymentName] = {"spec":{"replicas":3}}                  │
│                                                                              │
│  3. Aplicar patch directo                                                   │
│     deployment.spec.replicas = 0                                            │
│     kubectl patch deployment <nombre> -p '{"spec":{"replicas":0}}'         │
└─────────────────────────────────────────────────────────────────────────────┘
              │                   │
              └─────────┬─────────┘
                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 4: Guardar Restore Patches en Secret                                  │
│  • sleepinfo-<nombre> secret                                                 │
│  • Key: original-resource-info                                              │
│  • Value: JSON con todos los restore patches                                │
└─────────────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
                            FLUJO WAKE (ENCENDIDO)
═══════════════════════════════════════════════════════════════════════════════

              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 3: Detectar Tipo de Recurso (igual que Sleep)                         │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
        ┌─────┴─────┐
        │           │
        ▼           ▼
┌─────────────┐  ┌──────────────┐
│  CRD        │  │  NATIVO      │
│  Detectado  │  │  (Directo)   │
└─────┬───────┘  └──────┬───────┘
      │                  │
      ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  RAMA CRD:                                                                   │
│  1. Leer restore patch del secret                                           │
│     restorePatch = secret["crd:pgbouncer-meta"]                            │
│     // {"spec":{"instances":2}}                                            │
│                                                                              │
│  2. Si no existe restore patch:                                            │
│     → Leer spec.instances actual del CRD                                   │
│     → Si es 0, usar valor por defecto (2 para PgBouncer)                  │
│     → Si no es 0, mantener valor actual                                    │
│                                                                              │
│  3. Aplicar restore patch al CRD                                            │
│     crd.spec.instances = restorePatch.instances  // 2                       │
│     kubectl patch pgbouncer <nombre> -p '{"spec":{"instances":2}}'         │
│                                                                              │
│  4. Operador detecta cambio                                                 │
│     → Escala Deployment/StatefulSet automáticamente                        │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  RAMA NATIVO:                                                                │
│  1. Leer restore patch del secret                                           │
│     restorePatch = secret["deployment:my-app"]                              │
│     // {"spec":{"replicas":3}}                                              │
│                                                                              │
│  2. Si no existe restore patch:                                             │
│     → Omitir (recurso ya estaba apagado, no encender)                      │
│                                                                              │
│  3. Aplicar restore patch                                                   │
│     deployment.spec.replicas = restorePatch.replicas  // 3                    │
│     kubectl patch deployment <nombre> -p '{"spec":{"replicas":3}}'          │
└─────────────────────────────────────────────────────────────────────────────┘
              │                   │
              └─────────┬─────────┘
                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 4: Actualizar Status                                                  │
│  • SleepInfo.status.lastScheduleTime                                       │
│  • SleepInfo.status.operation = "WAKE_UP"                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Ejemplo Concreto: PgBouncer

### Estado Inicial
```yaml
# PgBouncer CRD
apiVersion: postgres.stratio.com/v1
kind: PgBouncer
metadata:
  name: pgbouncer-meta
spec:
  instances: 2  # ← Este es el valor que kube-green manejará

# Deployment generado por el operador
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pgbouncer-meta
  labels:
    pgbouncer.stratio.com/pgbouncer-name: pgbouncer-meta  # ← Label clave
spec:
  replicas: 2  # ← Este es gestionado por el operador, NO por kube-green
```

### Durante Sleep
```
1. kube-green lista Deployments
2. Encuentra "pgbouncer-meta" Deployment
3. Detecta label: pgbouncer.stratio.com/pgbouncer-name=pgbouncer-meta
4. Identifica como CRD PgBouncer
5. Obtiene CRD "pgbouncer-meta"
6. Lee spec.instances = 2
7. Guarda restore patch: {"spec":{"instances":2}}
8. Aplica patch: PgBouncer.spec.instances = 0
9. Operador detecta cambio → escala Deployment a replicas=0
```

### Durante Wake
```
1. kube-green lista Deployments
2. Encuentra "pgbouncer-meta" Deployment
3. Detecta label → Identifica como CRD
4. Lee restore patch: {"spec":{"instances":2}}
5. Aplica patch: PgBouncer.spec.instances = 2
6. Operador detecta cambio → escala Deployment a replicas=2
```

---

## Comparación: Antes vs. Después

### ANTES (Separado)
```yaml
# SleepInfo 1: Para Deployments nativos
suspendDeployments: true

# SleepInfo 2: Para PgBouncer (patches)
patches:
  - target:
      group: postgres.stratio.com
      kind: PgBouncer
    patch: |
      - op: add
        path: /metadata/annotations/pgbouncer.stratio.com~1shutdown
        value: "true"
```

### DESPUÉS (Unificado)
```yaml
# SleepInfo único: Para todo
suspendDeployments: true
suspendStatefulSets: true
# kube-green detecta automáticamente CRDs y aplica patches al CRD padre
```

---

## Puntos de Integración en el Código

```
sleepinfo_controller.go
    │
    ├─ Reconcile()
    │   │
    │   ├─ NewResources()  ← Aquí se crean los recursos
    │   │
    │   └─ resources.Sleep() / resources.WakeUp()
    │
jsonpatch/jsonpatch.go
    │
    ├─ Sleep()
    │   │
    │   ├─ Para cada Deployment/StatefulSet:
    │   │   │
    │   │   ├─ DetectCRDParent()  ← NUEVO: Detectar si es CRD
    │   │   │
    │   │   ├─ Si es CRD:
    │   │   │   └─ applyCRDPatch()  ← NUEVO: Patch al CRD
    │   │   │
    │   │   └─ Si es Nativo:
    │   │       └─ Patch normal (comportamiento actual)
    │
    └─ WakeUp()
        │
        └─ Similar a Sleep() pero restaurando valores
```

---

## Almacenamiento de Restore Patches

### Estructura del Secret

```json
{
  "original-resource-info": "{
    \"deployment:my-app\": \"{\\\"spec\\\":{\\\"replicas\\\":3}}\",
    \"crd:pgbouncer-meta\": \"{\\\"spec\\\":{\\\"instances\\\":2}}\",
    \"crd:postgres-meta\": \"{\\\"spec\\\":{\\\"instances\\\":1}}\",
    \"statefulset:my-db\": \"{\\\"spec\\\":{\\\"replicas\\\":3}}\"
  }"
}
```

### Claves de Identificación

- **Recursos nativos**: `"deployment:<nombre>"` o `"statefulset:<nombre>"`
- **CRDs**: `"crd:<nombre-crd>"`

---

## Matriz de Decisiones

| Tipo Recurso | Detección | Patch Aplicado | Restore Patch |
|--------------|-----------|----------------|---------------|
| Deployment Nativo | Sin labels CRD | `spec.replicas` | `{"spec":{"replicas":N}}` |
| Deployment de PgBouncer | Label: `pgbouncer.stratio.com/pgbouncer-name` | CRD: `spec.instances` | `{"spec":{"instances":N}}` |
| StatefulSet Nativo | Sin labels CRD | `spec.replicas` | `{"spec":{"replicas":N}}` |
| StatefulSet de PgCluster | Label o OwnerRef | CRD: `spec.instances` | `{"spec":{"instances":N}}` |
| StatefulSet de HDFSCluster | Label o OwnerRef | CRD: `spec.instances` | `{"spec":{"instances":N}}` |

---

## Validaciones Necesarias

Antes de implementar, verificar:

1. **Campos de instancias en CRDs**:
   ```bash
   kubectl get pgcluster <nombre> -o jsonpath='{.spec}' | jq '.instances'
   kubectl get hdfscluster <nombre> -o jsonpath='{.spec}' | jq '.instances'
   ```

2. **Labels en Deployments/StatefulSets generados**:
   ```bash
   kubectl get deployment pgbouncer-meta -o jsonpath='{.metadata.labels}' | jq
   kubectl get statefulset <nombre> -o jsonpath='{.metadata.labels}' | jq
   kubectl get statefulset <nombre> -o jsonpath='{.metadata.ownerReferences}' | jq
   ```

3. **Relación CRD → Recurso hijo**:
   - ¿Cómo el operador relaciona el CRD con el Deployment/StatefulSet?
   - ¿Labels, OwnerReferences, o ambos?

---

## Notas de Implementación

- **Módulo nuevo**: `crddetector/crddetector.go` para encapsular toda la lógica de detección
- **Compatibilidad**: Mantener comportamiento actual para recursos sin detección de CRD
- **Logging**: Registrar claramente cuando se detecta un CRD y se aplica patch al CRD padre
- **Errores**: Si falla la detección del CRD, fallback al comportamiento nativo (patch directo)

