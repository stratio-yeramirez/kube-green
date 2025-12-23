# Plan de Restructuración: Gestión Unificada de Recursos Nativos y CRDs

## Resumen Ejecutivo

**Objetivo**: Unificar la gestión de recursos para que kube-green maneje todo de forma nativa (`suspendDeployments`, `suspendStatefulSets`, `suspendCronJobs`), pero detectando automáticamente cuando un Deployment/StatefulSet es generado por un CRD (PgBouncer, PgCluster, HDFSCluster) y aplicando el patch directamente al CRD padre en lugar del recurso hijo.

**Beneficios**:
- Configuración única para todos los recursos (sin necesidad de patches separados)
- Gestión automática de réplicas basada en `spec.instances` del CRD
- Compatible con recursos que se crean/eliminan dinámicamente
- Restore patches almacenados en el CRD padre, garantizando restauración correcta

---

## 1. Arquitectura Propuesta

### 1.1. Flujo Actual vs. Propuesto

#### **FLUJO ACTUAL (separado)**
```
SleepInfo con patches explícitos
  ↓
Aplicar patch a CRD (PgBouncer/PgCluster/HDFSCluster)
  ↓
Operador detecta anotación shutdown=true/false
  ↓
Operador escala recursos
```

#### **FLUJO PROPUESTO (unificado)**
```
SleepInfo con suspendDeployments/suspendStatefulSets=True
  ↓
kube-green lista Deployments/StatefulSets
  ↓
¿Es generado por CRD conocido?
  ├─ NO → Patch directo a Deployment/StatefulSet (comportamiento nativo)
  └─ SÍ → Detectar CRD padre → Patch a CRD.spec.instances
       ↓
    Operador detecta cambio en spec.instances
       ↓
    Operador escala recursos automáticamente
```

---

## 2. Diagrama de Flujo Detallado

```
┌─────────────────────────────────────────────────────────────────┐
│                    SLEEP OPERATION (Apagado)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
         ┌──────────────────────────────────────┐
         │ SleepInfo Reconcile                    │
         │ suspendDeployments=True                │
         │ suspendStatefulSets=True               │
         └──────────────────────────────────────┘
                              │
                              ▼
         ┌──────────────────────────────────────┐
         │ Listar Deployments/StatefulSets        │
         │ en el namespace                        │
         └──────────────────────────────────────┘
                              │
                              ▼
         ┌──────────────────────────────────────┐
         │ Para cada Deployment/StatefulSet:    │
         │                                       │
         │ ¿Tiene label que indica CRD padre?    │
         │ pgbouncer.stratio.com/pgbouncer-name │
         │ pgcluster.stratio.com/cluster-name   │
         │ hdfs.stratio.com/cluster-name        │
         └──────────────────────────────────────┘
                  │                    │
         ┌────────┴────────┐  ┌──────┴────────┐
         │ SÍ (CRD)        │  │ NO (Nativo)   │
         └────────┬────────┘  └──────┬────────┘
                  │                  │
         ┌────────▼────────┐  ┌──────▼────────┐
         │ Buscar CRD padre │  │ Patch directo │
         │ en namespace    │  │ spec.replicas │
         └────────┬────────┘  │ = 0           │
                  │           └───────────────┘
         ┌────────▼───────────────────────────┐
         │ Leer spec.instances actual         │
         │ Guardar como restore patch         │
         └────────┬────────────────────────────┘
                  │
         ┌────────▼───────────────────────────┐
         │ Aplicar patch al CRD:              │
         │ spec.instances = 0                  │
         └────────┬───────────────────────────┘
                  │
         ┌────────▼───────────────────────────┐
         │ Operador detecta cambio             │
         │ Escala recursos a 0 automáticamente │
         └────────────────────────────────────┘
                  │
                  ▼
         ┌──────────────────────────────────────┐
         │ Guardar restore patch en secret:      │
         │ CRD name → {"spec":{"instances":N}}   │
         └──────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│                    WAKE OPERATION (Encendido)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
         ┌──────────────────────────────────────┐
         │ SleepInfo Reconcile (wakeUpAt)         │
         └──────────────────────────────────────┘
                              │
                              ▼
         ┌──────────────────────────────────────┐
         │ Listar Deployments/StatefulSets       │
         │ en el namespace                        │
         └──────────────────────────────────────┘
                              │
                              ▼
         ┌──────────────────────────────────────┐
         │ Para cada Deployment/StatefulSet:     │
         │                                       │
         │ ¿Tiene label que indica CRD padre?    │
         └──────────────────────────────────────┘
                  │                    │
         ┌────────┴────────┐  ┌──────┴────────┐
         │ SÍ (CRD)        │  │ NO (Nativo)   │
         └────────┬────────┘  └──────┬────────┘
                  │                  │
         ┌────────▼────────┐  ┌──────▼────────┐
         │ Buscar restore  │  │ Buscar restore│
         │ patch del CRD   │  │ patch del     │
         │ padre           │  │ Deployment/   │
         └────────┬────────┘  │ StatefulSet   │
                  │           └──────┬────────┘
         ┌────────▼──────────────────▼──────────┐
         │ ¿Existe restore patch?               │
         └────────┬─────────────────────────────┘
                  │
         ┌────────┴────────┐
         │ SÍ              │ NO
         └────────┬────────┘
                  │
         ┌────────▼───────────────────────────┐
         │ Aplicar restore patch:             │
         │ CRD: spec.instances = N            │
         │ O Deployment/StatefulSet:          │
         │   spec.replicas = N                │
         └────────┬───────────────────────────┘
                  │
         ┌────────▼───────────────────────────┐
         │ Operador detecta cambio (CRD)      │
         │ O Kubernetes actualiza (nativo)    │
         │ Escala recursos automáticamente     │
         └────────────────────────────────────┘
```

---

## 3. Plan de Implementación Detallado

### Fase 1: Detección de Recursos Generados por CRDs

#### 3.1. Crear Módulo de Detección de CRDs

**Archivo**: `internal/controller/sleepinfo/crddetector/crddetector.go`

```go
// Detectar si un Deployment/StatefulSet es generado por un CRD conocido
// Labels de identificación:
// - PgBouncer: pgbouncer.stratio.com/pgbouncer-name
// - PgCluster: pgcluster.stratio.com/cluster-name (via StatefulSet)
// - HDFSCluster: hdfs.stratio.com/cluster-name (via StatefulSet)

type CRDParentInfo struct {
    APIVersion string // ej: "postgres.stratio.com/v1"
    Kind       string // ej: "PgBouncer", "PgCluster", "HDFSCluster"
    Name       string // nombre del CRD
    Namespace  string
    InstancesField string // "spec.instances" o equivalente
}
```

**Funciones principales**:
- `DetectCRDParent(deployment/statefulset) → CRDParentInfo | nil`
- `GetCRDResource(ctx, client, CRDParentInfo) → unstructured.Unstructured`
- `GetCurrentInstances(crd) → int32`
- `ApplyInstancesPatch(crd, instances) → error`

#### 3.2. Mapeo de Labels a CRDs

```go
var CRDLabelMappings = map[string]CRDConfig{
    // PgBouncer (genera Deployments)
    "pgbouncer.stratio.com/pgbouncer-name": {
        APIVersion: "postgres.stratio.com/v1",
        Kind: "PgBouncer",
        InstancesField: "spec.instances",
    },
    // PgCluster (genera StatefulSets)
    "pgcluster.stratio.com/cluster-name": {
        APIVersion: "postgres.stratio.com/v1",
        Kind: "PgCluster",
        InstancesField: "spec.instances", // verificar campo real
    },
    // HDFSCluster (genera StatefulSets)
    "hdfs.stratio.com/cluster-name": {
        APIVersion: "hdfs.stratio.com/v1",
        Kind: "HDFSCluster",
        InstancesField: "spec.instances", // verificar campo real
    },
}
```

---

### Fase 2: Modificación del Flujo de Sleep/Wake

#### 3.3. Modificar `Sleep()` en `jsonpatch/jsonpatch.go`

**Cambios en la función `Sleep()`**:

```go
func (g managedResources) Sleep(ctx context.Context) error {
    for _, resourceWrapper := range g.resMapping {
        // ... código existente ...
        
        for _, resource := range resourceWrapper.data {
            // 1. Verificar si es gestionado por otro controller (código existente)
            if metav1.GetControllerOfNoCopy(&resource) != nil {
                // EXTENSIÓN: Verificar si es un Deployment/StatefulSet generado por CRD
                crdInfo := crddetector.DetectCRDParent(&resource)
                if crdInfo != nil {
                    // Aplicar patch al CRD padre en lugar del recurso hijo
                    if err := g.applyCRDPatch(ctx, crdInfo, 0); err != nil {
                        g.logger.Error(err, "fails to apply CRD patch",
                            "crdAPIVersion", crdInfo.APIVersion,
                            "crdKind", crdInfo.Kind,
                            "crdName", crdInfo.Name,
                        )
                        continue
                    }
                    continue // Skip el patch al recurso hijo
                }
                // Comportamiento original: omitir recursos con controller
                continue
            }
            
            // 2. Aplicar patch normal (comportamiento existente)
            // ... resto del código ...
        }
    }
}
```

#### 3.4. Crear Función `applyCRDPatch()`

```go
func (g managedResources) applyCRDPatch(ctx context.Context, crdInfo *crddetector.CRDParentInfo, targetInstances int32) error {
    // 1. Obtener el CRD actual
    crd := &unstructured.Unstructured{}
    crd.SetGroupVersionKind(schema.GroupVersionKind{
        Group:   crdInfo.APIVersion[:strings.Index(crdInfo.APIVersion, "/")],
        Version: crdInfo.APIVersion[strings.Index(crdInfo.APIVersion, "/")+1:],
        Kind:    crdInfo.Kind,
    })
    
    if err := g.client.Get(ctx, client.ObjectKey{
        Namespace: crdInfo.Namespace,
        Name:      crdInfo.Name,
    }, crd); err != nil {
        return fmt.Errorf("failed to get CRD: %w", err)
    }
    
    // 2. Leer spec.instances actual (para restore patch)
    currentInstances, found, err := unstructured.NestedInt64(crd.Object, "spec", "instances")
    if err != nil || !found {
        return fmt.Errorf("failed to read current instances: %w", err)
    }
    
    // 3. Guardar restore patch
    restorePatch := fmt.Sprintf(`{"spec":{"instances":%d}}`, currentInstances)
    // Almacenar usando CRD name como key
    g.restorePatches[crdInfo.Name] = restorePatch
    
    // 4. Aplicar patch al CRD
    if err := unstructured.SetNestedField(crd.Object, int64(targetInstances), "spec", "instances"); err != nil {
        return fmt.Errorf("failed to set instances: %w", err)
    }
    
    // 5. Actualizar el CRD
    return g.client.Update(ctx, crd)
}
```

#### 3.5. Modificar `WakeUp()` en `jsonpatch/jsonpatch.go`

**Cambios similares**: Detectar CRD, buscar restore patch del CRD, aplicar patch al CRD.

---

### Fase 3: Actualización de `tenant_power.py`

#### 3.6. Simplificar Generación de SleepInfos

**Cambios en `tenant_power.py`**:

```python
# ELIMINAR: make_datastores_objs_staggered_split_days()
# ELIMINAR: patches explícitos para PgBouncer/PgCluster/HDFSCluster

# SIMPLIFICAR: make_datastores_native_deploys_split_days()
def make_datastores_native_deploys_split_days(tenant, off_utc, on_deployments_utc,
                                              wd_sleep, wd_wake):
    """
    Gestiona TODOS los Deployments/StatefulSets en datastores de forma nativa.
    kube-green detectará automáticamente cuáles son CRDs y aplicará patches al CRD padre.
    """
    ns = f"{tenant}-datastores"
    objs = []
    base_name = f"ds-deploys-{tenant}"
    
    # SleepInfo único o separado según weekdays
    # suspendDeployments=True, suspendStatefulSets=True
    # kube-green se encargará de detectar CRDs y aplicar patches al CRD padre
```

**Eliminar exclusiones**: Ya no necesitamos `excludeRef` porque kube-green detectará automáticamente los CRDs.

---

### Fase 4: Almacenamiento de Restore Patches

#### 3.7. Modificar Estructura de Restore Patches

**Cambio en `jsonpatch.go`**:

```go
// Actual: RestorePatches map[string]string (nombre recurso → patch JSON)
// Nuevo: Soportar tanto recursos nativos como CRDs

// Almacenar restore patches con prefijo para CRDs:
// "crd:pgbouncer-meta" → patch del CRD
// "deployment:my-app" → patch del Deployment nativo
```

---

## 4. Detalles de Implementación

### 4.1. Detección de CRDs por Labels

**Labels a verificar**:

| CRD | Label en Deployment/StatefulSet | Valor |
|-----|--------------------------------|-------|
| PgBouncer | `pgbouncer.stratio.com/pgbouncer-name` | nombre del PgBouncer |
| PgCluster | `postgres.stratio.com/cluster` o via ownerReference | nombre del PgCluster |
| HDFSCluster | `hdfs.stratio.com/cluster` o via ownerReference | nombre del HDFSCluster |

**Estrategia**:
1. Primero verificar labels
2. Si no hay label, verificar `ownerReferences` para CRDs conocidos
3. Si no hay ownerReference, tratar como recurso nativo

### 4.2. Campos de Instancias en CRDs

| CRD | Campo | Tipo |
|-----|-------|------|
| PgBouncer | `spec.instances` | `int32` |
| PgCluster | `spec.instances` o `spec.replicas` | `int32` (verificar) |
| HDFSCluster | `spec.instances` o `spec.replicas` | `int32` (verificar) |

**Verificar con**: `kubectl get pgcluster <nombre> -o yaml | grep -A 5 spec`

### 4.3. Restore Patches

**Para CRDs**: Almacenar `{"spec":{"instances":N}}` donde N es el valor original
**Para recursos nativos**: Mantener comportamiento actual `{"spec":{"replicas":N}}`

---

## 5. Casos de Uso

### Caso 1: PgBouncer (Deployment)

```
1. kube-green lista Deployments con suspendDeployments=True
2. Encuentra "pgbouncer-meta" Deployment
3. Detecta label: pgbouncer.stratio.com/pgbouncer-name=pgbouncer-meta
4. Busca CRD: PgBouncer "pgbouncer-meta" en namespace
5. Lee spec.instances=2 (actual)
6. Guarda restore patch: {"spec":{"instances":2}}
7. Aplica patch: spec.instances=0
8. Operador detecta cambio y escala Deployment a 0
```

### Caso 2: Deployment Nativo

```
1. kube-green lista Deployments con suspendDeployments=True
2. Encuentra "my-app" Deployment (sin labels de CRD)
3. Trata como recurso nativo
4. Lee spec.replicas=3 (actual)
5. Guarda restore patch: {"spec":{"replicas":3}}
6. Aplica patch: spec.replicas=0
```

### Caso 3: PgCluster (StatefulSet)

```
1. kube-green lista StatefulSets con suspendStatefulSets=True
2. Encuentra "postgres-meta" StatefulSet
3. Detecta ownerReference o label apuntando a PgCluster
4. Busca CRD: PgCluster "postgres-meta" en namespace
5. Lee spec.instances=1 (actual)
6. Guarda restore patch: {"spec":{"instances":1}}
7. Aplica patch: spec.instances=0
8. Operador detecta cambio y escala StatefulSet a 0
```

---

## 6. Ventajas de esta Arquitectura

✅ **Unificación**: Un solo mecanismo para todos los recursos
✅ **Automático**: Detección automática de CRDs vs. recursos nativos
✅ **Mantenible**: Menos configuración en `tenant_power.py`
✅ **Robusto**: Restore patches garantizan restauración correcta
✅ **Escalable**: Fácil agregar nuevos CRDs en el futuro
✅ **Compatible**: No rompe el comportamiento actual de recursos nativos

---

## 7. Consideraciones

### 7.1. Verificación de Campos

**Acción requerida**: Verificar los campos exactos de instancias en:
- PgCluster: ¿`spec.instances` o `spec.replicas`?
- HDFSCluster: ¿`spec.instances` o `spec.replicas`?

**Comando de verificación**:
```bash
kubectl get pgcluster <nombre> -o jsonpath='{.spec}' | jq
kubectl get hdfscluster <nombre> -o jsonpath='{.spec}' | jq
```

### 7.2. Labels vs. OwnerReferences

**Preferencia**: Labels son más confiables porque:
- Persisten aunque el ownerReference cambie
- Más explícitos
- Fáciles de verificar

**Fallback**: Si no hay labels, usar `ownerReferences` para encontrar el CRD padre.

### 7.3. Performance

**Optimización**: Cachear la detección de CRDs para evitar múltiples queries al API server.

---

## 8. Plan de Pruebas

### 8.1. Pruebas Unitarias
- Detección de CRDs por labels
- Detección de CRDs por ownerReferences
- Aplicación de patches a CRDs
- Restore patches de CRDs

### 8.2. Pruebas de Integración
- Sleep de PgBouncer → verificar que `spec.instances` cambia a 0
- Wake de PgBouncer → verificar que `spec.instances` se restaura
- Sleep de Deployment nativo → comportamiento original intacto
- Wake de Deployment nativo → comportamiento original intacto

---

## 9. Orden de Implementación

1. ✅ Crear módulo `crddetector` con funciones de detección
2. ✅ Implementar `applyCRDPatch()` para Sleep
3. ✅ Implementar `applyCRDPatch()` para Wake
4. ✅ Modificar `Sleep()` para usar detección de CRDs
5. ✅ Modificar `WakeUp()` para usar detección de CRDs
6. ✅ Actualizar almacenamiento de restore patches
7. ✅ Simplificar `tenant_power.py` (eliminar patches explícitos)
8. ✅ Pruebas y validación

---

## 10. Preguntas para Validar

1. ¿Los PgCluster y HDFSCluster usan `spec.instances` o `spec.replicas`?
2. ¿Qué labels tienen los StatefulSets generados por PgCluster?
3. ¿Qué labels tienen los StatefulSets generados por HDFSCluster?
4. ¿Prefieres usar labels o ownerReferences para la detección?

---

## Siguiente Paso

Una vez aprobado este plan, procederé con la implementación comenzando por el módulo `crddetector` y luego integrando la lógica en el flujo de Sleep/Wake.




