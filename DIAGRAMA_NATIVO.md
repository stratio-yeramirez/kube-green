# Diagrama de Flujo: Gestión Nativa de CRDs

## 🎯 Arquitectura Simplificada

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SleepInfo (Configuración Nativa)                    │
│                                                                              │
│  suspendDeployments: true                                                  │
│  suspendStatefulSets: true                                                 │
│  suspendCronJobs: true                                                     │
│                                                                              │
│  suspendDeploymentsPgbouncer: true    ← NUEVO                              │
│  suspendStatefulSetsPostgres: true     ← NUEVO                              │
│  suspendStatefulSetsHdfs: true         ← NUEVO                              │
│                                                                              │
│  # Ya no necesitas patches explícitos!                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ Controller Reconcile          │
                    │ Detecta operación:            │
                    │ SLEEP o WAKE_UP                │
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
│  PASO 1: Determinar Patches según Campos Booleanos                          │
│                                                                              │
│  Si suspendDeploymentsPgbouncer = true:                                     │
│    → Agregar pgbouncerPatch (spec.instances = 0)                           │
│                                                                              │
│  Si suspendStatefulSetsPostgres = true:                                     │
│    → Agregar pgclusterSleepPatch (anotación shutdown=true)                  │
│                                                                              │
│  Si suspendStatefulSetsHdfs = true:                                         │
│    → Agregar hdfsclusterSleepPatch (anotación shutdown=true)              │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 2: Listar CRDs Directamente por Tipo (SIN labels ni filtros)        │
│                                                                              │
│  Para PgBouncer:                                                            │
│    kubectl get pgbouncer -n <namespace>                                    │
│    → Lista TODOS los PgBouncer (sin importar nombre o labels)              │
│    → Ejemplo: ["pgbouncer-meta", "pgbouncer-other", ...]                  │
│                                                                              │
│  Para PgCluster:                                                            │
│    kubectl get pgcluster -n <namespace>                                    │
│    → Lista TODOS los PgCluster (sin importar nombre o labels)             │
│    → Ejemplo: ["postgres-meta", "postgres-data", ...]                      │
│                                                                              │
│  Para HDFSCluster:                                                          │
│    kubectl get hdfscluster -n <namespace>                                  │
│    → Lista TODOS los HDFSCluster (sin importar nombre o labels)           │
│    → Ejemplo: ["hdfs", "hdfs-backup", ...]                                 │
│                                                                              │
│  NOTA: Listado directo por tipo de recurso (Group + Kind).                  │
│        NO se usa detección por labels ni nombres hardcodeados.              │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 3: Procesar Cada Recurso Encontrado                                   │
│                                                                              │
  │  ┌────────────────────────────────────────────────────────┐               │
  │  │ PgBouncer (Gestiona spec.instances)                    │               │
  │  │                                                          │               │
  │  │ Para cada PgBouncer:                                    │               │
  │  │   1. Leer spec.instances actual (ej: 2)                │               │
  │  │   2. Guardar restore patch:                            │               │
  │  │        {"spec":{"instances":2}}                         │               │
  │  │   3. Aplicar patch (replace):                         │               │
  │  │        op: replace                                     │               │
  │  │        path: /spec/instances                            │               │
  │  │        value: 0                                         │               │
  │  │   4. Operador detecta → escala Deployment a replicas=0  │               │
  │  └────────────────────────────────────────────────────────┘               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────┐               │
│  │ PgCluster (Gestiona anotación)                         │               │
│  │                                                          │               │
│  │ Para cada PgCluster:                                    │               │
│  │   1. Aplicar patch:                                     │               │
│  │        metadata.annotations[                            │               │
│  │          "pgcluster.stratio.com/shutdown"               │               │
│  │        ] = "true"                                        │               │
│  │   2. Operador detecta → escala StatefulSet a 0          │               │
│  └────────────────────────────────────────────────────────┘               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────┐               │
│  │ HDFSCluster (Gestiona anotación)                       │               │
│  │                                                          │               │
│  │ Para cada HDFSCluster:                                  │               │
│  │   1. Aplicar patch:                                     │               │
│  │        metadata.annotations[                            │               │
│  │          "hdfscluster.stratio.com/shutdown"             │               │
│  │        ] = "true"                                        │               │
│  │   2. Operador detecta → escala StatefulSet a 0          │               │
│  └────────────────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 4: Procesar Recursos Nativos (comportamiento actual)                  │
│                                                                              │
│  Deployments nativos:                                                       │
│    • Listar todos                                                           │
│    • Omitir los gobernados por CRDs gestionados                             │
│    • Aplicar patch: spec.replicas = 0                                       │
│                                                                              │
│  StatefulSets nativos:                                                      │
│    • Listar todos                                                           │
│    • Omitir los gobernados por CRDs gestionados                             │
│    • Aplicar patch: spec.replicas = 0                                       │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 5: Guardar Restore Patches                                            │
│                                                                              │
│  Secret: sleepinfo-<nombre>                                                 │
│  {                                                                           │
│    "original-resource-info": "{                                             │
│      \"pgbouncer-meta\": \"{\\\"spec\\\":{\\\"instances\\\":2}}\",          │
│      \"pgbouncer-other\": \"{\\\"spec\\\":{\\\"instances\\\":1}}\",         │
│      \"my-app\": \"{\\\"spec\\\":{\\\"replicas\\\":3}}\",                   │
│      \"my-db\": \"{\\\"spec\\\":{\\\"replicas\\\":2}}\"                    │
│    }"                                                                        │
│  }                                                                           │
│                                                                              │
│  NOTA: Para PgCluster y HDFSCluster no se guardan restore patches           │
│  porque usan anotaciones (el patch de wake es fijo: shutdown=false)         │
└─────────────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
                        FLUJO WAKE (ENCENDIDO) - DETALLADO
═══════════════════════════════════════════════════════════════════════════════

              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 1: Determinar Patches según Campos Booleanos                          │
│                                                                              │
│  Si suspendStatefulSetsPostgres = true:                                     │
│    → Agregar pgclusterWakePatch (anotación shutdown=false)                  │
│                                                                              │
│  Si suspendStatefulSetsHdfs = true:                                         │
│    → Agregar hdfsclusterWakePatch (anotación shutdown=false)               │
│                                                                              │
│  NOTA: PgBouncer usa restore patches (no patch nuevo)                       │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 2: Listar Recursos (igual que Sleep)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 3: Procesar Cada Recurso                                              │
│                                                                              │
  │  ┌────────────────────────────────────────────────────────┐               │
  │  │ PgBouncer (Restaurar spec.instances)                   │               │
  │  │                                                          │               │
  │  │ Para cada PgBouncer:                                    │               │
  │  │   1. Buscar restore patch:                             │               │
  │  │        restorePatch = secret["pgbouncer-meta"]         │               │
  │  │        // {"spec":{"instances":2}}                      │               │
  │  │   2. Aplicar restore patch (replace):                  │               │
  │  │        op: replace                                     │               │
  │  │        path: /spec/instances                            │               │
  │  │        value: 2 (valor original)                        │               │
  │  │   3. Operador detecta → escala Deployment              │               │
  │  └────────────────────────────────────────────────────────┘               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────┐               │
│  │ PgCluster (Cambiar anotación)                          │               │
│  │                                                          │               │
│  │ Para cada PgCluster:                                    │               │
│  │   1. Aplicar patch:                                     │               │
│  │        metadata.annotations[                            │               │
│  │          "pgcluster.stratio.com/shutdown"               │               │
│  │        ] = "false"                                       │               │
│  │   2. Operador detecta → escala StatefulSet              │               │
│  └────────────────────────────────────────────────────────┘               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────┐               │
│  │ HDFSCluster (Cambiar anotación)                        │               │
│  │                                                          │               │
│  │ Para cada HDFSCluster:                                  │               │
│  │   1. Aplicar patch:                                     │               │
│  │        metadata.annotations[                            │               │
│  │          "hdfscluster.stratio.com/shutdown"             │               │
│  │        ] = "false"                                       │               │
│  │   2. Operador detecta → escala StatefulSet              │               │
│  └────────────────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PASO 4: Procesar Recursos Nativos (restaurar desde restore patches)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Comparación Visual: Antes vs. Después

### ANTES (Con Patches Explícitos)
```yaml
spec:
  suspendDeployments: false
  suspendStatefulSets: false
  patches:
    - target:
        group: postgres.stratio.com
        kind: PgBouncer
      patch: |
        - op: add
          path: /metadata/annotations/pgbouncer.stratio.com~1shutdown
          value: "true"
    - target:
        group: postgres.stratio.com
        kind: PgCluster
      patch: |
        - op: add
          path: /metadata/annotations/pgcluster.stratio.com~1shutdown
          value: "true"
```
**Problemas**:
- ❌ Configuración compleja
- ❌ Anotaciones en el YAML
- ❌ Difícil de mantener
- ❌ Fácil cometer errores en el JSON patch

### DESPUÉS (Nativo)
```yaml
spec:
  suspendDeployments: true
  suspendStatefulSets: true
  suspendDeploymentsPgbouncer: true
  suspendStatefulSetsPostgres: true
  suspendStatefulSetsHdfs: true
```
**Ventajas**:
- ✅ Configuración simple
- ✅ Anotaciones hardcodeadas en controller
- ✅ Fácil de mantener
- ✅ Consistente con recursos nativos

---

## 🔑 Diferencias Clave entre Tipos de CRDs

| CRD | Campo de Control | Método | Restore Patch |
|-----|------------------|--------|---------------|
| **PgBouncer** | `spec.instances` | Directo (como deployments) | ✅ Sí |
| **PgCluster** | Anotación `pgcluster.stratio.com/shutdown` | Por anotación | ❌ No (patch fijo) |
| **HDFSCluster** | Anotación `hdfscluster.stratio.com/shutdown` | Por anotación | ❌ No (patch fijo) |

---

## 💡 Ejemplo Completo de Flujo

### Estado Inicial del Namespace
```
bdadevdat-datastores/
├── PgBouncer CRDs:
│   ├── pgbouncer-meta (spec.instances: 2)
│   └── pgbouncer-other (spec.instances: 1)
│
├── PgCluster CRDs:
│   └── postgres-meta (sin anotación shutdown)
│
└── HDFSCluster CRDs:
    └── hdfs (sin anotación shutdown)
```

### Durante Sleep
```
1. SleepInfo tiene:
   suspendDeploymentsPgbouncer: true
   suspendStatefulSetsPostgres: true
   suspendStatefulSetsHdfs: true

2. Controller detecta SLEEP

3. Procesa PgBouncer:
   • Lista: ["pgbouncer-meta", "pgbouncer-other"]
   • Para cada uno:
     - Lee spec.instances (2, 1)
     - Guarda restore patches
     - Aplica patch: spec.instances = 0
   • Operador escala Deployments a 0

4. Procesa PgCluster:
   • Lista: ["postgres-meta"]
   • Aplica patch: anotación shutdown="true"
   • Operador escala StatefulSet a 0

5. Procesa HDFSCluster:
   • Lista: ["hdfs"]
   • Aplica patch: anotación shutdown="true"
   • Operador escala StatefulSet a 0
```

### Durante Wake
```
1. Controller detecta WAKE_UP

2. Procesa PgBouncer:
   • Lee restore patches: {"pgbouncer-meta": {"spec":{"instances":2}}, ...}
   • Aplica restore patches: spec.instances = 2, 1
   • Operador escala Deployments

3. Procesa PgCluster:
   • Aplica patch: anotación shutdown="false"
   • Operador escala StatefulSet

4. Procesa HDFSCluster:
   • Aplica patch: anotación shutdown="false"
   • Operador escala StatefulSet
```

---

## ✅ Ventajas de esta Arquitectura

1. **Simple**: Campos booleanos claros
2. **Nativo**: Consistente con `suspendDeployments`
3. **Dinámico**: Busca todos los recursos del tipo
4. **Hardcodeado**: Anotaciones en el código (más seguro)
5. **Extensible**: Fácil agregar nuevos campos para otros CRDs

---

## 🎯 Puntos Clave

- **PgBouncer**: Se gestiona igual que deployments nativos (spec.instances ↔ spec.replicas)
- **PgCluster/HDFSCluster**: Se gestionan por anotaciones (hardcodeadas en controller)
- **Dinámico**: Busca todos los recursos sin nombres hardcodeados
- **Sin configuración de patches**: Las anotaciones están en el código Go

