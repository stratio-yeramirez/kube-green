# Diagrama de Flujo: Gestión Dinámica y Extensible de CRDs

## 🎯 Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SleepInfo (Configuración)                           │
│  suspendDeployments: true                                                   │
│  suspendStatefulSets: true                                                  │
│  suspendCronJobs: true                                                      │
│                                                                              │
│  managedCRDs:  ← NUEVO: Lista de CRDs a gestionar dinámicamente            │
│    - group: postgres.stratio.com                                            │
│      kind: PgBouncer                                                        │
│      instancesField: spec.instances                                         │
│    - group: postgres.stratio.com                                            │
│      kind: PgCluster                                                       │
│      instancesField: spec.instances                                         │
│    - group: hdfs.stratio.com                                                │
│      kind: HDFSCluster                                                      │
│      instancesField: spec.instances                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ ¿SLEEP o WAKE?                │
                    └───────────────────────────────┘
                            │              │
              ┌─────────────┘              └─────────────┐
              ▼                                           ▼
      ┌───────────────┐                          ┌───────────────┐
      │   SLEEP       │                          │   WAKE        │
      │  (Apagado)    │                          │  (Encendido)  │
      └───────┬───────┘                          └───────┬───────┘
              │                                           │
              ▼                                           ▼


═══════════════════════════════════════════════════════════════════════════════
                        FLUJO SLEEP (APAGADO) - DETALLADO
═══════════════════════════════════════════════════════════════════════════════

              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 1: Procesar CRDs Configurados (GESTIÓN DINÁMICA)                      │
│                                                                              │
│  Para cada CRD en spec.managedCRDs:                                        │
│    └─ Listar TODOS los recursos de ese tipo en el namespace                │
│                                                                              │
│  Ejemplo:                                                                    │
│    managedCRDs[0] = {group: "postgres.stratio.com", kind: "PgBouncer"}      │
│    → kubectl get pgbouncer -n bdadevdat-datastores                         │
│    → Resultado: ["pgbouncer-meta", "pgbouncer-other", ...] (dinámico)      │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 2: Para cada CRD encontrado (SIN nombres hardcodeados)                │
│                                                                              │
│  Para cada PgBouncer encontrado:                                            │
│    • Leer spec.instances actual (ej: 2)                                     │
│    • Guardar restore patch:                                                 │
│        restorePatch["crd:pgbouncer-meta"] = {"spec":{"instances":2}}        │
│    • Aplicar patch al CRD:                                                  │
│        spec.instances = 0                                                    │
│        kubectl patch pgbouncer pgbouncer-meta -p '{"spec":{"instances":0}}' │
│    • Operador detecta cambio → escala Deployment a replicas=0               │
│                                                                              │
│  Para cada PgCluster encontrado:                                            │
│    • Mismo proceso pero con PgCluster                                       │
│                                                                              │
│  Para cada HDFSCluster encontrado:                                          │
│    • Mismo proceso pero con HDFSCluster                                     │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 3: Procesar Recursos Nativos (Deployments/StatefulSets)               │
│                                                                              │
│  Listar Deployments/StatefulSets en el namespace:                          │
│    kubectl get deployments -n bdadevdat-datastores                          │
│    kubectl get statefulsets -n bdadevdat-datastores                          │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 4: Para cada Deployment/StatefulSet encontrado                         │
│                                                                              │
│  ¿Es gobernado por un CRD gestionado?                                       │
│  (Verificar ownerReferences o labels)                                       │
│                                                                              │
│     ┌─────────────────────┐      ┌─────────────────────┐                    │
│     │ SÍ (Gobernado por   │      │ NO (Nativo)         │                    │
│     │  CRD gestionado)    │      │                     │                    │
│     └──────────┬─────────┘      └──────────┬──────────┘                    │
│                 │                          │                                │
│                 ▼                          ▼                                │
│     ┌─────────────────────┐      ┌─────────────────────┐                   │
│     │ OMITIR              │      │ Aplicar patch       │                   │
│     │ (Ya gestionado por  │      │ directo:            │                   │
│     │  el CRD padre)      │      │ spec.replicas = 0   │                   │
│     │                     │      │                     │                   │
│     │ Log: "resource is   │      │ Guardar restore     │                   │
│     │  managed by CRD,    │      │ patch               │                   │
│     │  skipped"           │      │                     │                   │
│     └─────────────────────┘      └─────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 5: Guardar Restore Patches                                            │
│                                                                              │
│  Secret: sleepinfo-<nombre>                                                 │
│  {                                                                           │
│    "original-resource-info": "{                                             │
│      \"crd:pgbouncer-meta\": \"{\\\"spec\\\":{\\\"instances\\\":2}}\",      │
│      \"crd:pgbouncer-other\": \"{\\\"spec\\\":{\\\"instances\\\":1}}\",    │
│      \"crd:postgres-meta\": \"{\\\"spec\\\":{\\\"instances\\\":1}}\",       │
│      \"deployment:my-app\": \"{\\\"spec\\\":{\\\"replicas\\\":3}}\"         │
│    }"                                                                        │
│  }                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
                        FLUJO WAKE (ENCENDIDO) - DETALLADO
═══════════════════════════════════════════════════════════════════════════════

              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 1: Procesar CRDs Configurados                                         │
│                                                                              │
│  Para cada CRD en spec.managedCRDs:                                        │
│    └─ Listar TODOS los recursos de ese tipo en el namespace                │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 2: Para cada CRD encontrado                                           │
│                                                                              │
│  1. Buscar restore patch:                                                   │
│     restorePatch = secret["crd:pgbouncer-meta"]                            │
│                                                                              │
│  2. ¿Existe restore patch?                                                   │
│     ┌─────────────────────┐      ┌─────────────────────┐                  │
│     │ SÍ                   │      │ NO                  │                  │
│     └──────────┬──────────┘      └──────────┬──────────┘                  │
│                 │                           │                               │
│                 ▼                           ▼                               │
│     ┌─────────────────────┐      ┌─────────────────────┐                   │
│     │ Usar restore patch  │      │ ¿defaultInstances   │                   │
│     │ {"spec":{"instances│      │  configurado?       │                   │
│     │  ":2}}             │      │                     │                   │
│     └──────────┬─────────┘      └──────────┬──────────┘                   │
│                 │                           │                               │
│                 └───────────┬─────────────────┘                              │
│                             ▼                                                │
│                  ┌─────────────────────┐                                     │
│                  │ Aplicar patch al   │                                     │
│                  │ CRD:               │                                     │
│                  │ spec.instances = N │                                     │
│                  │ (valor restaurado) │                                     │
│                  └──────────┬─────────┘                                     │
│                             │                                                │
│                             ▼                                                │
│                  ┌─────────────────────┐                                     │
│                  │ Operador detecta    │                                     │
│                  │ cambio → escala     │                                     │
│                  │ recursos hijos      │                                     │
│                  └─────────────────────┘                                     │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 3: Procesar Recursos Nativos (comportamiento actual)                  │
│  • Buscar restore patches                                                   │
│  • Aplicar restore patches a Deployments/StatefulSets nativos                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Ejemplo Concreto: Namespace con Múltiples Recursos

### Estado Inicial del Namespace

```
bdadevdat-datastores/
├── PgBouncer CRDs:
│   ├── pgbouncer-meta (spec.instances: 2)
│   └── pgbouncer-other (spec.instances: 1)
│
├── PgCluster CRDs:
│   ├── postgres-meta (spec.instances: 1)
│   └── postgres-data (spec.instances: 1)
│
├── HDFSCluster CRDs:
│   └── hdfs (spec.instances: 3)
│
├── Deployments (generados por operadores):
│   ├── pgbouncer-meta (replicas: 2) ← gobernado por PgBouncer CRD
│   ├── pgbouncer-other (replicas: 1) ← gobernado por PgBouncer CRD
│   └── my-app (replicas: 3) ← NATIVO (no gobernado por CRD)
│
└── StatefulSets (generados por operadores):
    ├── postgres-meta (replicas: 1) ← gobernado por PgCluster CRD
    └── my-db (replicas: 2) ← NATIVO (no gobernado por CRD)
```

### Durante Sleep

```
1. kube-green procesa managedCRDs:
   
   a) PgBouncer:
      • Lista: ["pgbouncer-meta", "pgbouncer-other"]
      • Para cada uno:
        - Lee spec.instances actual
        - Guarda restore patch
        - Aplica patch: spec.instances = 0
      • Operador escala Deployments a replicas=0
   
   b) PgCluster:
      • Lista: ["postgres-meta", "postgres-data"]
      • Mismo proceso
   
   c) HDFSCluster:
      • Lista: ["hdfs"]
      • Mismo proceso

2. kube-green procesa Deployments nativos:
   • Lista: ["pgbouncer-meta", "pgbouncer-other", "my-app"]
   • Filtra:
     - pgbouncer-meta → Omitir (gobernado por CRD)
     - pgbouncer-other → Omitir (gobernado por CRD)
     - my-app → Patch directo: spec.replicas = 0

3. kube-green procesa StatefulSets nativos:
   • Lista: ["postgres-meta", "my-db"]
   • Filtra:
     - postgres-meta → Omitir (gobernado por CRD)
     - my-db → Patch directo: spec.replicas = 0
```

### Restore Patches Guardados

```json
{
  "crd:pgbouncer-meta": "{\"spec\":{\"instances\":2}}",
  "crd:pgbouncer-other": "{\"spec\":{\"instances\":1}}",
  "crd:postgres-meta": "{\"spec\":{\"instances\":1}}",
  "crd:postgres-data": "{\"spec\":{\"instances\":1}}",
  "crd:hdfs": "{\"spec\":{\"instances\":3}}",
  "deployment:my-app": "{\"spec\":{\"replicas\":3}}",
  "statefulset:my-db": "{\"spec\":{\"replicas\":2}}"
}
```

---

## 🎯 Extensibilidad: Agregar Nuevo CRD

### Ejemplo: Agregar OpenSearchCluster

**Solo configuración, sin código**:

```yaml
spec:
  managedCRDs:
    # ... CRDs existentes ...
    - group: opensearch.stratio.com
      kind: OpenSearchCluster
      instancesField: spec.replicas  # el campo que use el CRD
      defaultInstances: 3
```

**kube-green automáticamente**:
1. Listará todos los `OpenSearchCluster` en el namespace
2. Aplicará patches a `spec.replicas` durante sleep/wake
3. Omitirá los recursos hijos gobernados por OpenSearchCluster

---

## 🔍 Matriz de Decisiones

| Recurso Encontrado | Tipo | Acción |
|-------------------|------|--------|
| PgBouncer CRD | CRD gestionado | Patch `spec.instances` |
| PgCluster CRD | CRD gestionado | Patch `spec.instances` |
| HDFSCluster CRD | CRD gestionado | Patch `spec.instances` |
| Deployment: pgbouncer-meta | Hijo de CRD | Omitir (ya gestionado) |
| Deployment: my-app | Nativo | Patch `spec.replicas` |
| StatefulSet: postgres-meta | Hijo de CRD | Omitir (ya gestionado) |
| StatefulSet: my-db | Nativo | Patch `spec.replicas` |

---

## 📊 Comparación Visual

### ANTES (Separado)
```
SleepInfo-1: patches explícitos → PgBouncer CRD
SleepInfo-2: patches explícitos → PgCluster CRD
SleepInfo-3: patches explícitos → HDFSCluster CRD
SleepInfo-4: suspendDeployments → Deployments nativos
SleepInfo-5: suspendStatefulSets → StatefulSets nativos
```

### DESPUÉS (Unificado)
```
SleepInfo único:
  managedCRDs → Lista TODOS los CRDs dinámicamente
  suspendDeployments → Deployments nativos (omitiendo hijos de CRDs)
  suspendStatefulSets → StatefulSets nativos (omitiendo hijos de CRDs)
```

---

## ✅ Ventajas Clave

1. **Dinámico**: Busca TODOS los recursos del tipo (sin nombres hardcodeados)
2. **Extensible**: Agregar CRD = solo configuración
3. **Flexible**: Soporta cualquier CRD con campo de instancias/réplicas
4. **Mantenible**: Una sola configuración
5. **Robusto**: Restore patches garantizan restauración correcta

---

## 🎬 Flujo Completo Simplificado

```
┌─────────────────────────────────────────────────────────────┐
│ SleepInfo Reconcile                                         │
│ managedCRDs: [PgBouncer, PgCluster, HDFSCluster]           │
│ suspendDeployments: true                                   │
│ suspendStatefulSets: true                                   │
└─────────────────────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌───────────────┐      ┌───────────────┐
│ Listar CRDs   │      │ Listar        │
│ (directamente)│      │ Deployments/  │
│               │      │ StatefulSets  │
│ • PgBouncer   │      │               │
│ • PgCluster   │      │               │
│ • HDFSCluster │      │               │
└───────┬───────┘      └───────┬───────┘
        │                       │
        ▼                       ▼
┌───────────────┐      ┌──────────────────────┐
│ Para cada CRD:│      │ Para cada recurso:   │
│ • Patch       │      │ • ¿Es hijo de CRD?   │
│   instances=0 │      │   └─ SÍ: Omitir     │
│ • Guardar     │      │   └─ NO: Patch       │
│   restore     │      │      replicas=0      │
└───────────────┘      └──────────────────────┘
        │                       │
        └───────────┬───────────┘
                    ▼
        ┌───────────────────────┐
        │ Guardar Restore       │
        │ Patches en Secret     │
        └───────────────────────┘
```

---

## 🔑 Puntos Clave de la Solución

1. **Listar CRDs directamente**: No depender de labels en recursos hijos
2. **Configuración declarativa**: `managedCRDs` define qué CRDs gestionar
3. **Omisión automática**: Recursos hijos de CRDs gestionados se omiten automáticamente
4. **Extensibilidad**: Nuevos CRDs = solo agregar a la lista de configuración




