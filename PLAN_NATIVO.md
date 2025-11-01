# Plan: Gestión Nativa de CRDs con Campos Booleanos Específicos

## 🎯 Objetivo

Hacer que kube-green gestione CRDs de forma **nativa y simple**, usando campos booleanos específicos (similar a `suspendDeployments` y `suspendStatefulSets`), donde:

1. ✅ **PgBouncer** (genera Deployments): Se gestiona por `spec.instances` del CRD (igual que deployments nativos con `spec.replicas`)
2. ✅ **PgCluster** (genera StatefulSets): Se gestiona por anotación `pgcluster.stratio.com/shutdown` (hardcodeada en controller)
3. ✅ **HDFSCluster** (genera StatefulSets): Se gestiona por anotación `hdfscluster.stratio.com/shutdown` (hardcodeada en controller)
4. ✅ **Dinámico**: Busca TODOS los recursos del tipo en el namespace
5. ✅ **Sin configuración de patches**: Las anotaciones están hardcodeadas en el controller

---

## 📋 Diseño de la Solución

### 1. Extender SleepInfoSpec con Campos Booleanos Específicos

**Archivo**: `api/v1alpha1/sleepinfo_types.go`

```go
type SleepInfoSpec struct {
    // ... campos existentes ...
    
    // Si SuspendDeploymentsPgbouncer es true, en sleep todos los PgBouncer CRDs
    // del namespace serán gestionados modificando spec.instances (igual que deployments nativos).
    // NOTA: PgBouncer es un CRD que genera Deployments (no StatefulSets), por eso usa
    // el prefijo "Deployments" en el nombre del campo.
    // Por defecto false (no gestiona PgBouncer).
    // +optional
    SuspendDeploymentsPgbouncer *bool `json:"suspendDeploymentsPgbouncer,omitempty"`
    
    // Si SuspendStatefulSetsPostgres es true, en sleep todos los PgCluster CRDs
    // del namespace serán gestionados aplicando la anotación pgcluster.stratio.com/shutdown.
    // Por defecto false (no gestiona PgCluster).
    // +optional
    SuspendStatefulSetsPostgres *bool `json:"suspendStatefulSetsPostgres,omitempty"`
    
    // Si SuspendStatefulSetsHdfs es true, en sleep todos los HDFSCluster CRDs
    // del namespace serán gestionados aplicando la anotación hdfscluster.stratio.com/shutdown.
    // Por defecto false (no gestiona HDFSCluster).
    // +optional
    SuspendStatefulSetsHdfs *bool `json:"suspendStatefulSetsHdfs,omitempty"`
}
```

### 2. Métodos Helper (similar a IsDeploymentsToSuspend)

```go
func (s SleepInfo) IsPgbouncerToSuspend() bool {
    if s.Spec.SuspendDeploymentsPgbouncer == nil {
        return false
    }
    return *s.Spec.SuspendDeploymentsPgbouncer
}

func (s SleepInfo) IsPostgresToSuspend() bool {
    if s.Spec.SuspendStatefulSetsPostgres == nil {
        return false
    }
    return *s.Spec.SuspendStatefulSetsPostgres
}

func (s SleepInfo) IsHdfsToSuspend() bool {
    if s.Spec.SuspendStatefulSetsHdfs == nil {
        return false
    }
    return *s.Spec.SuspendStatefulSetsHdfs
}
```

### 3. Modificar GetPatches() para Incluir Patches Automáticos

**Archivo**: `api/v1alpha1/defaultpatches.go`

```go
var PgBouncerTarget = PatchTarget{
    Group: "postgres.stratio.com",
    Kind:  "PgBouncer",
}

var PgClusterTarget = PatchTarget{
    Group: "postgres.stratio.com",
    Kind:  "PgCluster",
}

var HDFSClusterTarget = PatchTarget{
    Group: "hdfs.stratio.com",
    Kind:  "HDFSCluster",
}

// Patch para PgBouncer: modifica spec.instances (usa replace porque el campo siempre existe)
var pgbouncerPatch = Patch{
    Target: PgBouncerTarget,
    Patch: `
- op: replace
  path: /spec/instances
  value: 0`,
}

// Patch para PgCluster: anotación shutdown=true (SLEEP)
var pgclusterSleepPatch = Patch{
    Target: PgClusterTarget,
    Patch: `
- op: add
  path: /metadata/annotations/pgcluster.stratio.com~1shutdown
  value: "true"`,
}

// Patch para PgCluster: anotación shutdown=false (WAKE)
var pgclusterWakePatch = Patch{
    Target: PgClusterTarget,
    Patch: `
- op: add
  path: /metadata/annotations/pgcluster.stratio.com~1shutdown
  value: "false"`,
}

// Patch para HDFSCluster: anotación shutdown=true (SLEEP)
var hdfsclusterSleepPatch = Patch{
    Target: HDFSClusterTarget,
    Patch: `
- op: add
  path: /metadata/annotations/hdfscluster.stratio.com~1shutdown
  value: "true"`,
}

// Patch para HDFSCluster: anotación shutdown=false (WAKE)
var hdfsclusterWakePatch = Patch{
    Target: HDFSClusterTarget,
    Patch: `
- op: add
  path: /metadata/annotations/hdfscluster.stratio.com~1shutdown
  value: "false"`,
}

// Modificar GetPatches() en sleepinfo_types.go
func (s SleepInfo) GetPatches() []Patch {
    patches := []Patch{}
    
    // Patches nativos (comportamiento existente)
    if s.IsDeploymentsToSuspend() {
        patches = append(patches, deploymentPatch)
    }
    if s.IsStatefulSetsToSuspend() {
        patches = append(patches, statefulSetPatch)
    }
    if s.IsCronjobsToSuspend() {
        patches = append(patches, cronjobPatch)
    }
    
    // EXTENSIÓN: Patches para CRDs
    if s.IsPgbouncerToSuspend() {
        patches = append(patches, pgbouncerPatch)
    }
    
    // EXTENSIÓN: Para PgCluster y HDFSCluster, el patch depende de la operación (sleep/wake)
    // Estos se agregarán dinámicamente en el controller según la operación
    
    // Patches explícitos del usuario
    return append(patches, s.Spec.Patches...)
}
```

**IMPORTANTE**: Para PgCluster y HDFSCluster, los patches dependen de si es SLEEP o WAKE. Esto se manejará en el controller.

---

## 🔄 Modificaciones en el Controller

### 4. Modificar sleepinfo_controller.go

**Archivo**: `internal/controller/sleepinfo/sleepinfo_controller.go`

```go
func (r *SleepInfoReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    // ... código existente hasta obtener sleepInfo ...
    
    // EXTENSIÓN: Agregar patches dinámicos para PgCluster y HDFSCluster según operación
    if sleepInfo.IsPostgresToSuspend() || sleepInfo.IsHdfsToSuspend() {
        // Los patches para anotaciones se agregan dinámicamente según SLEEP/WAKE
        // Esto se hace en el método GetPatches() extendido
        // Pero necesitamos saber si es SLEEP o WAKE aquí...
        // Alternativa: Crear método GetPatchesForOperation(operationType string)
    }
    
    // ... resto del código ...
}
```

**Mejor enfoque**: Crear método `GetPatchesForOperation()` que retorne patches según el tipo de operación.

### 5. Nuevo Método GetPatchesForOperation()

**Archivo**: `api/v1alpha1/sleepinfo_types.go`

```go
const (
    OperationSleep = "SLEEP"
    OperationWake  = "WAKE_UP"
)

func (s SleepInfo) GetPatchesForOperation(operationType string) []Patch {
    patches := s.GetPatches() // Obtener patches base (incluye PgBouncer si está habilitado)
    
    // Agregar patches de anotaciones para SLEEP o WAKE
    if operationType == OperationSleep {
        if s.IsPostgresToSuspend() {
            patches = append(patches, pgclusterSleepPatch)
        }
        if s.IsHdfsToSuspend() {
            patches = append(patches, hdfsclusterSleepPatch)
        }
    } else if operationType == OperationWake {
        if s.IsPostgresToSuspend() {
            patches = append(patches, pgclusterWakePatch)
        }
        if s.IsHdfsToSuspend() {
            patches = append(patches, hdfsclusterWakePatch)
        }
    }
    
    return patches
}
```

### 6. Modificar jsonpatch.NewResources() para Usar Patches Dinámicos

**Archivo**: `internal/controller/sleepinfo/sleepinfo_controller.go`

```go
// En lugar de:
resources, err := jsonpatch.NewResources(ctx, resource.ResourceClient{
    SleepInfo: sleepInfo,
    // ...
}, req.Namespace, restorePatches)

// Usar:
operationType := sleepInfoData.CurrentOperationType
patchesForOperation := sleepInfo.GetPatchesForOperation(operationType)

// Crear un SleepInfo temporal con los patches correctos
tempSleepInfo := sleepInfo.DeepCopy()
tempSleepInfo.Spec.Patches = patchesForOperation

resources, err := jsonpatch.NewResources(ctx, resource.ResourceClient{
    SleepInfo: tempSleepInfo,
    // ...
}, req.Namespace, restorePatches)
```

**Mejor enfoque**: Modificar `NewResources()` para aceptar patches directamente, o modificar `SleepInfo.GetPatches()` para que sea contextual.

### 7. Solución Simplificada: Modificar GetPatches() para Ser Contextual

**Mejor opción**: Modificar el flujo para que `GetPatches()` reciba el tipo de operación.

```go
// Modificar la firma de GetPatches() para recibir operationType
func (s SleepInfo) GetPatches(operationType string) []Patch {
    patches := []Patch{}
    
    // Patches nativos
    if s.IsDeploymentsToSuspend() {
        patches = append(patches, deploymentPatch)
    }
    if s.IsStatefulSetsToSuspend() {
        patches = append(patches, statefulSetPatch)
    }
    if s.IsCronjobsToSuspend() {
        patches = append(patches, cronjobPatch)
    }
    
    // CRDs
    if s.IsPgbouncerToSuspend() {
        patches = append(patches, pgbouncerPatch)
    }
    
    // Patches con anotaciones (dependen de la operación)
    if operationType == OperationSleep {
        if s.IsPostgresToSuspend() {
            patches = append(patches, pgclusterSleepPatch)
        }
        if s.IsHdfsToSuspend() {
            patches = append(patches, hdfsclusterSleepPatch)
        }
    } else if operationType == OperationWake {
        if s.IsPostgresToSuspend() {
            patches = append(patches, pgclusterWakePatch)
        }
        if s.IsHdfsToSuspend() {
            patches = append(patches, hdfsclusterWakePatch)
        }
    }
    
    // Patches explícitos del usuario
    return append(patches, s.Spec.Patches...)
}
```

**PERO**: Esto rompe compatibilidad porque `GetPatches()` ya existe. Mejor crear `GetPatchesForOperation()` y usar ese.

### 8. Solución Final: Extender NewResources()

**Archivo**: `internal/controller/sleepinfo/jsonpatch/jsonpatch.go`

```go
func NewResources(ctx context.Context, res resource.ResourceClient, namespace string, restorePatches map[string]RestorePatches, operationType string) (resource.Resource, error) {
    // ... código existente ...
    
    // Obtener patches según operación
    var patches []v1alpha1.Patch
    if operationType != "" {
        // Usar método extendido si existe, sino usar GetPatches() normal
        if sleepInfoWithOp, ok := res.SleepInfo.(interface{ GetPatchesForOperation(string) []v1alpha1.Patch }); ok {
            patches = sleepInfoWithOp.GetPatchesForOperation(operationType)
        } else {
            patches = res.SleepInfo.GetPatches()
        }
    } else {
        patches = res.SleepInfo.GetPatches()
    }
    
    for _, patchData := range patches {
        // ... resto del código ...
    }
}
```

**Pero esto es complejo**. Mejor solución:

### 9. Solución Más Simple: Modificar sleepinfo_controller.go

```go
// En Reconcile():
operationType := sleepInfoData.CurrentOperationType

// Crear SleepInfo temporal con patches dinámicos
sleepInfoWithPatches := sleepInfo.DeepCopy()
if operationType == "SLEEP" {
    if sleepInfo.IsPostgresToSuspend() {
        sleepInfoWithPatches.Spec.Patches = append(sleepInfoWithPatches.Spec.Patches, pgclusterSleepPatch)
    }
    if sleepInfo.IsHdfsToSuspend() {
        sleepInfoWithPatches.Spec.Patches = append(sleepInfoWithPatches.Spec.Patches, hdfsclusterSleepPatch)
    }
} else if operationType == "WAKE_UP" {
    if sleepInfo.IsPostgresToSuspend() {
        sleepInfoWithPatches.Spec.Patches = append(sleepInfoWithPatches.Spec.Patches, pgclusterWakePatch)
    }
    if sleepInfo.IsHdfsToSuspend() {
        sleepInfoWithPatches.Spec.Patches = append(sleepInfoWithPatches.Spec.Patches, hdfsclusterWakePatch)
    }
}

resources, err := jsonpatch.NewResources(ctx, resource.ResourceClient{
    SleepInfo: sleepInfoWithPatches,
    // ...
}, req.Namespace, restorePatches)
```

---

## 🔍 Listado Directo de CRDs (Sin Detección por Labels)

**IMPORTANTE**: Para listar CRDs (PgBouncer, PgCluster, HDFSCluster), kube-green usa listado directo por tipo:

```go
// En jsonpatch.NewResources():
// Simplemente lista todos los recursos del tipo en el namespace
generic.data, err = generic.getListByNamespace(ctx, namespace, patchData.Target)

// Para PgBouncer:
// patchData.Target = {Group: "postgres.stratio.com", Kind: "PgBouncer"}
// → kubectl get pgbouncer -n <namespace> → lista TODOS los PgBouncer

// Para PgCluster:
// patchData.Target = {Group: "postgres.stratio.com", Kind: "PgCluster"}
// → kubectl get pgcluster -n <namespace> → lista TODOS los PgCluster

// Para HDFSCluster:
// patchData.Target = {Group: "hdfs.stratio.com", Kind: "HDFSCluster"}
// → kubectl get hdfscluster -n <namespace> → lista TODOS los HDFSCluster
```

**NO se usan**:
- ❌ Labels para detectar CRDs
- ❌ Nombres hardcodeados
- ❌ Filtros especiales

**SÍ se usa**:
- ✅ Listado directo por tipo (Group + Kind)
- ✅ Todos los recursos del tipo en el namespace
- ✅ Dinámico: encuentra recursos creados después de la configuración

**Nota sobre recursos hijos**: Para Deployments/StatefulSets nativos, sí se puede usar detección por labels/ownerReferences para OMITIR aquellos que son gobernados por CRDs gestionados. Pero esto es solo para filtrar recursos nativos, NO para encontrar los CRDs.

---

## 💾 Gestión de Restore Patches para PgBouncer

### 10. Restore Patches Automáticos

**Para PgBouncer**, el sistema funciona igual que para deployments nativos:

1. **Durante SLEEP**:
   - kube-green lee `spec.instances` actual (ej: 2)
   - Aplica patch `replace` con `value: 0`
   - Usa `jsonpatch.CreateMergePatch(modified, original)` para generar restore patch
   - El restore patch generado será: `{"spec":{"instances":2}}`
   - Se guarda en el secret con key: `pgbouncer-meta` (nombre del recurso)

2. **Durante WAKE**:
   - kube-green busca restore patch: `secret["pgbouncer-meta"]`
   - Encuentra: `{"spec":{"instances":2}}`
   - Aplica el restore patch usando Server Side Apply
   - El restore patch restaura `spec.instances` al valor original (2)

**No se necesita cambio especial** - el sistema de restore patches genérico ya funciona para cualquier campo.

**Ejemplo de comando equivalente**:
```bash
# Sleep (apagado)
kubectl patch PgBouncer pgbouncer-meta --type=json \
  -p='[{"op":"replace","path":"/spec/instances","value":0}]'

# Wake (encendido - usando restore patch)
kubectl patch PgBouncer pgbouncer-meta --type=merge \
  -p='{"spec":{"instances":2}}'  # Valor original guardado
```

---

## 📝 Ejemplo de Configuración

### Antes (con patches explícitos)
```yaml
spec:
  weekdays: '5'
  sleepAt: 00:56
  wakeUpAt: 00:56
  suspendDeployments: false
  suspendStatefulSets: false
  suspendCronJobs: false
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

### Después (nativo)
```yaml
spec:
  weekdays: '5'
  sleepAt: 00:56
  wakeUpAt: 00:56
  suspendDeployments: true
  suspendStatefulSets: true
  suspendCronJobs: true
  suspendDeploymentsPgbouncer: true   # ← NUEVO
  suspendStatefulSetsPostgres: true    # ← NUEVO
  suspendStatefulSetsHdfs: true        # ← NUEVO
  # Ya no necesitas patches explícitos
```

---

## 🔄 Flujo Completo

### SLEEP (Apagado)

```
1. SleepInfo tiene:
   - suspendDeploymentsPgbouncer: true
   - suspendStatefulSetsPostgres: true
   - suspendStatefulSetsHdfs: true

2. Controller detecta operación SLEEP

3. GetPatches() o GetPatchesForOperation("SLEEP") retorna:
   - pgbouncerPatch (spec.instances = 0)
   - pgclusterSleepPatch (anotación shutdown=true)
   - hdfsclusterSleepPatch (anotación shutdown=true)

4. jsonpatch.NewResources() lista TODOS los CRDs directamente por tipo:
   - Lista todos los PgBouncer: `kubectl get pgbouncer -n <namespace>` (sin filtros, dinámico)
   - Lista todos los PgCluster: `kubectl get pgcluster -n <namespace>` (sin filtros, dinámico)
   - Lista todos los HDFSCluster: `kubectl get hdfscluster -n <namespace>` (sin filtros, dinámico)
   
   NOTA: No se usa detección por labels ni nombres. Simplemente se listan TODOS los recursos del tipo.

5. Para cada recurso:
   - PgBouncer: 
     * Leer spec.instances actual (ej: 2)
     * Guardar restore patch: {"spec":{"instances":2}}
     * Aplicar patch: op=replace, path=/spec/instances, value=0
   - PgCluster: Aplicar patch (anotación shutdown=true)
   - HDFSCluster: Aplicar patch (anotación shutdown=true)
```

### WAKE (Encendido)

```
1. Controller detecta operación WAKE_UP

2. GetPatches() o GetPatchesForOperation("WAKE_UP") retorna:
   - pgclusterWakePatch (anotación shutdown=false)
   - hdfsclusterWakePatch (anotación shutdown=false)
   - (PgBouncer usa restore patch, no patch nuevo)

3. jsonpatch.WakeUp() procesa:
   - PgBouncer: 
     * Buscar restore patch en secret (ej: {"spec":{"instances":2}})
     * Aplicar restore patch (merge patch) → spec.instances = 2
     * Operador detecta cambio y escala Deployment
   - PgCluster: Aplicar patch (anotación shutdown=false)
   - HDFSCluster: Aplicar patch (anotación shutdown=false)
```

---

## 🔧 Cambios Requeridos

### Resumen de Archivos a Modificar

1. **`api/v1alpha1/sleepinfo_types.go`**
   - Agregar campos: `SuspendDeploymentsPgbouncer`, `SuspendStatefulSetsPostgres`, `SuspendStatefulSetsHdfs`
   - Agregar métodos: `IsPgbouncerToSuspend()`, `IsPostgresToSuspend()`, `IsHdfsToSuspend()`
   - Modificar `GetPatches()` para incluir `pgbouncerPatch`

2. **`api/v1alpha1/defaultpatches.go`**
   - Agregar: `pgbouncerPatch`, `pgclusterSleepPatch`, `pgclusterWakePatch`, `hdfsclusterSleepPatch`, `hdfsclusterWakePatch`
   - Agregar: `PgBouncerTarget`, `PgClusterTarget`, `HDFSClusterTarget`

3. **`internal/controller/sleepinfo/sleepinfo_controller.go`**
   - Modificar `Reconcile()` para agregar patches dinámicos según operación antes de llamar `NewResources()`

4. **`internal/controller/sleepinfo/jsonpatch/jsonpatch.go`**
   - No requiere cambios (el sistema genérico ya funciona)
   - Pero podemos agregar logging específico para CRDs

5. **`api/v1alpha1/zz_generated.deepcopy.go`**
   - Regenerar con `make generate` (automático)

---

## ✅ Ventajas de esta Solución

1. **Nativo**: Campos booleanos como `suspendDeployments`
2. **Simple**: Configuración fácil, sin patches JSON complejos
3. **Dinámico**: Busca TODOS los recursos del tipo
4. **Extensible**: Fácil agregar nuevos campos para otros CRDs
5. **Hardcodeado**: Anotaciones en el código (no en configuración)
6. **Consistente**: Mismo patrón que recursos nativos

---

## 📊 Tabla de Resumen: Tipos de Recursos

| CRD | Genera | Campo SleepInfo | Método de Control | Restore Patch |
|-----|--------|----------------|------------------|---------------|
| **PgBouncer** | Deployments | `suspendDeploymentsPgbouncer` | `spec.instances` (replace) | ✅ Sí |
| **PgCluster** | StatefulSets | `suspendStatefulSetsPostgres` | Anotación `pgcluster.stratio.com/shutdown` | ❌ No (patch fijo) |
| **HDFSCluster** | StatefulSets | `suspendStatefulSetsHdfs` | Anotación `hdfscluster.stratio.com/shutdown` | ❌ No (patch fijo) |

**NOTA IMPORTANTE**: 
- PgBouncer genera **Deployments**, por eso el campo es `suspendDeploymentsPgbouncer`
- PgCluster y HDFSCluster generan **StatefulSets**, por eso los campos son `suspendStatefulSetsPostgres` y `suspendStatefulSetsHdfs`

---

## 📊 Comparación

| Aspecto | Actual (Patches) | Propuesto (Nativo) |
|---------|------------------|-------------------|
| **Configuración** | `patches:` con JSON | Campos booleanos |
| **Anotaciones** | En el YAML | Hardcodeadas en controller |
| **Complejidad** | Alta | Baja |
| **Mantenibilidad** | Baja | Alta |
| **Extensibilidad** | Media | Alta |

---

## 🚀 Próximos Pasos

1. Verificar campos exactos:
   - ¿PgCluster y HDFSCluster usan `spec.instances` o `spec.replicas`?
   
2. Implementar cambios en orden:
   - Primero: Agregar campos y métodos en `sleepinfo_types.go`
   - Segundo: Agregar patches en `defaultpatches.go`
   - Tercero: Modificar controller para patches dinámicos
   - Cuarto: Actualizar `tenant_power.py`

¿Te parece bien este enfoque? ¿Quieres que proceda con la implementación?

