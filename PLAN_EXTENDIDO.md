# Plan Extendido: Gestión Dinámica y Extensible de CRDs

## 🎯 Objetivo Principal

**Hacer kube-green extensible** para gestionar CRDs de forma dinámica, listando directamente los recursos CRD en el namespace (no los recursos hijos), de manera que:

1. ✅ Busque **TODOS** los PgBouncer, PgCluster, HDFSCluster que existan (dinámico)
2. ✅ Sea **extensible** a nuevos CRDs mediante configuración
3. ✅ Mantenga el comportamiento nativo para Deployments/StatefulSets que NO son gobernados por CRDs
4. ✅ No requiera nombres hardcodeados

---

## 🏗️ Arquitectura Propuesta

### Estrategia Dual: CRDs + Recursos Nativos

```
┌─────────────────────────────────────────────────────────────┐
│                    SleepInfo                               │
│  suspendDeployments: true                                   │
│  suspendStatefulSets: true                                  │
│  managedCRDs:                                               │
│    - group: postgres.stratio.com                            │
│      kind: PgBouncer                                        │
│      instancesField: spec.instances                         │
│    - group: postgres.stratio.com                            │
│      kind: PgCluster                                        │
│      instancesField: spec.instances                         │
│    - group: hdfs.stratio.com                                │
│      kind: HDFSCluster                                      │
│      instancesField: spec.instances                         │
└─────────────────────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌───────────────┐      ┌───────────────┐
│ Gestionar     │      │ Gestionar     │
│ CRDs          │      │ Nativos       │
│ (Listar CRDs) │      │ (Deployments/ │
│               │      │  StatefulSets)│
└───────────────┘      └───────────────┘
        │                       │
        ▼                       ▼
┌──────────────────────────────────────────┐
│ Para cada CRD encontrado:                │
│ • Leer spec.instances actual              │
│ • Guardar como restore patch              │
│ • Aplicar patch: spec.instances = 0       │
│ • Operador escala recursos automáticamente│
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│ Para cada Deployment/StatefulSet:       │
│ • ¿Es gobernado por CRD conocido?       │
│   └─ SÍ → Omitir (ya gestionado por CRD)│
│   └─ NO → Patch directo (comportamiento  │
│            nativo)                        │
└──────────────────────────────────────────┘
```

---

## 📋 Diseño de la Solución

### 1. Extender SleepInfoSpec

**Archivo**: `api/v1alpha1/sleepinfo_types.go`

```go
type SleepInfoSpec struct {
    // ... campos existentes ...
    
    // ManagedCRDs: Lista de CRDs que kube-green debe gestionar
    // Si está configurado, kube-green listará todos los recursos de estos tipos
    // y aplicará patches directamente a los CRDs (no a los recursos hijos)
    // +optional
    ManagedCRDs []ManagedCRD `json:"managedCRDs,omitempty"`
}

type ManagedCRD struct {
    // Group del CRD (ej: "postgres.stratio.com")
    Group string `json:"group"`
    
    // Kind del CRD (ej: "PgBouncer", "PgCluster", "HDFSCluster")
    Kind string `json:"kind"`
    
    // Campo en el spec donde se almacenan las instancias/réplicas
    // (ej: "spec.instances", "spec.replicas")
    InstancesField string `json:"instancesField"`
    
    // Valor por defecto para wake si no hay restore patch
    // (opcional, si no se especifica, usa el valor actual)
    // +optional
    DefaultInstances *int32 `json:"defaultInstances,omitempty"`
}
```

### 2. Modificar NewResources()

**Archivo**: `internal/controller/sleepinfo/jsonpatch/jsonpatch.go`

```go
func NewResources(ctx context.Context, res resource.ResourceClient, namespace string, restorePatches map[string]RestorePatches) (resource.Resource, error) {
    // ... código existente para patches explícitos ...
    
    // EXTENSIÓN: Si hay managedCRDs configurados, agregar patches automáticos
    if res.SleepInfo.Spec.ManagedCRDs != nil {
        for _, managedCRD := range res.SleepInfo.Spec.ManagedCRDs {
            // Crear patch target para el CRD
            target := v1alpha1.PatchTarget{
                Group: managedCRD.Group,
                Kind:  managedCRD.Kind,
            }
            
            // Crear patch dinámico basado en InstancesField
            patch := fmt.Sprintf(`
- op: add
  path: /%s
  value: 0`, strings.Replace(managedCRD.InstancesField, ".", "/", -1))
            
            patchData := v1alpha1.Patch{
                Target: target,
                Patch:  patch,
            }
            
            // Agregar a la lista de patches (se procesará igual que los explícitos)
            // ... procesar igual que patches normales ...
        }
    }
    
    // ... resto del código ...
}
```

### 3. Modificar Sleep() para Excluir Recursos Gobernados por CRDs

**Archivo**: `internal/controller/sleepinfo/jsonpatch/jsonpatch.go`

```go
func (g managedResources) Sleep(ctx context.Context) error {
    for _, resourceWrapper := range g.resMapping {
        // ... código existente ...
        
        for _, resource := range resourceWrapper.data {
            // EXTENSIÓN: Si este Deployment/StatefulSet es gobernado por un CRD gestionado,
            // omitirlo (el CRD padre ya fue gestionado)
            if g.isManagedByCRD(&resource, sleepInfo) {
                g.logger.V(8).Info("resource is managed by CRD, skipped (CRD handled separately)",
                    "resourceName", resource.GetName(),
                    "resourceKind", resource.GetKind(),
                )
                continue
            }
            
            // ... resto del código (comportamiento nativo) ...
        }
    }
}

// Función helper para detectar si un recurso es gobernado por un CRD gestionado
func (g managedResources) isManagedByCRD(resource *unstructured.Unstructured, sleepInfo *v1alpha1.SleepInfo) bool {
    if sleepInfo.Spec.ManagedCRDs == nil {
        return false
    }
    
    // Verificar ownerReferences o labels para cada CRD gestionado
    for _, managedCRD := range sleepInfo.Spec.ManagedCRDs {
        // Estrategia 1: Verificar ownerReferences
        ownerRefs := resource.GetOwnerReferences()
        for _, ref := range ownerRefs {
            if ref.Kind == managedCRD.Kind {
                // Verificar el grupo del owner
                if strings.HasPrefix(ref.APIVersion, managedCRD.Group+"/") {
                    return true
                }
            }
        }
        
        // Estrategia 2: Verificar labels (si el operador las pone)
        // Esto depende del operador específico
        // Ejemplo para PgBouncer:
        // labels := resource.GetLabels()
        // if val, ok := labels["pgbouncer.stratio.com/pgbouncer-name"]; ok && val != "" {
        //     return true
        // }
    }
    
    return false
}
```

---

## 🔄 Flujo Completo

### Durante Sleep (Apagado)

```
1. SleepInfo tiene managedCRDs configurado:
   - postgres.stratio.com/PgBouncer
   - postgres.stratio.com/PgCluster
   - hdfs.stratio.com/HDFSCluster

2. Para cada CRD en managedCRDs:
   a. Listar todos los recursos de ese tipo en el namespace
      kubectl get pgbouncer -n <namespace>
      kubectl get pgcluster -n <namespace>
      kubectl get hdfscluster -n <namespace>
   
   b. Para cada CRD encontrado (dinámico, sin nombres hardcodeados):
      - Leer spec.instances actual
      - Guardar restore patch: {"spec":{"instances":N}}
      - Aplicar patch: spec.instances = 0
      - Operador detecta y escala recursos hijos

3. Listar Deployments/StatefulSets (comportamiento nativo):
   a. Para cada Deployment/StatefulSet:
      - ¿Es gobernado por CRD gestionado? → Omitir
      - ¿No es gobernado por CRD? → Patch directo spec.replicas = 0
```

### Durante Wake (Encendido)

```
1. Para cada CRD en managedCRDs:
   a. Listar todos los CRDs del tipo en el namespace
   
   b. Para cada CRD:
      - Buscar restore patch: crd:<nombre-crd>
      - Si existe: Aplicar restore patch
      - Si no existe: 
        * Si defaultInstances está configurado → usar ese valor
        * Si no → leer spec.instances actual y mantenerlo
      - Operador detecta y escala recursos hijos

2. Para cada Deployment/StatefulSet nativo:
   - Buscar restore patch y restaurar (comportamiento actual)
```

---

## 📝 Ejemplo de SleepInfo

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: ds-deploys-bdadevdat
  namespace: bdadevdat-datastores
spec:
  weekdays: '5'
  timeZone: UTC
  sleepAt: 17:12
  wakeUpAt: 17:37
  suspendDeployments: true
  suspendStatefulSets: true
  suspendCronJobs: true
  
  # EXTENSIÓN: CRDs a gestionar dinámicamente
  managedCRDs:
    # PgBouncer: busca TODOS los PgBouncer en el namespace
    - group: postgres.stratio.com
      kind: PgBouncer
      instancesField: spec.instances
      defaultInstances: 2  # Valor por defecto si no hay restore patch
    
    # PgCluster: busca TODOS los PgCluster en el namespace
    - group: postgres.stratio.com
      kind: PgCluster
      instancesField: spec.instances
      defaultInstances: 1
    
    # HDFSCluster: busca TODOS los HDFSCluster en el namespace
    - group: hdfs.stratio.com
      kind: HDFSCluster
      instancesField: spec.instances
      defaultInstances: 3
  
  # Exclusiones (solo para recursos nativos)
  excludeRef:
    - matchLabels:
        app.kubernetes.io/managed-by: postgres-operator
    - matchLabels:
        app.kubernetes.io/managed-by: hdfs-operator
```

---

## 🔍 Detección de Recursos Gobernados por CRDs

### Estrategia para Omitir Recursos Hijos

Cuando kube-green lista Deployments/StatefulSets, debe omitir los que son generados por CRDs gestionados.

**Métodos de detección**:

1. **OwnerReferences** (más confiable):
   ```go
   ownerRefs := deployment.GetOwnerReferences()
   for _, ref := range ownerRefs {
       if ref.Kind == "PgBouncer" && ref.APIVersion == "postgres.stratio.com/v1" {
           return true // Es gobernado por PgBouncer
       }
   }
   ```

2. **Labels** (fallback):
   ```go
   labels := deployment.GetLabels()
   if val, ok := labels["pgbouncer.stratio.com/pgbouncer-name"]; ok && val != "" {
       return true // Es gobernado por PgBouncer
   }
   ```

---

## 🔧 Modificaciones Requeridas

### 1. API Extension (`api/v1alpha1/sleepinfo_types.go`)

```go
// Agregar al struct SleepInfoSpec
ManagedCRDs []ManagedCRD `json:"managedCRDs,omitempty"`

// Nuevo struct
type ManagedCRD struct {
    Group          string `json:"group"`
    Kind           string `json:"kind"`
    InstancesField string `json:"instancesField"`
    DefaultInstances *int32 `json:"defaultInstances,omitempty"`
}
```

### 2. Modificar `NewResources()` (`jsonpatch/jsonpatch.go`)

```go
// Agregar lógica para procesar managedCRDs y crear patches automáticos
```

### 3. Modificar `Sleep()` y `WakeUp()` (`jsonpatch/jsonpatch.go`)

```go
// Agregar función isManagedByCRD() para omitir recursos hijos
```

### 4. Actualizar `tenant_power.py`

```python
# SIMPLIFICAR: Solo generar managedCRDs en el SleepInfo
# Eliminar todos los patches explícitos y SleepInfos separados

def make_datastores_native_deploys_split_days(...):
    spec["managedCRDs"] = [
        {
            "group": "postgres.stratio.com",
            "kind": "PgBouncer",
            "instancesField": "spec.instances",
            "defaultInstances": 2
        },
        {
            "group": "postgres.stratio.com",
            "kind": "PgCluster",
            "instancesField": "spec.instances",
            "defaultInstances": 1
        },
        {
            "group": "hdfs.stratio.com",
            "kind": "HDFSCluster",
            "instancesField": "spec.instances",
            "defaultInstances": 3
        }
    ]
```

---

## ✅ Ventajas de esta Arquitectura

1. **Dinámico**: Lista TODOS los CRDs del tipo en el namespace (sin nombres hardcodeados)
2. **Extensible**: Agregar nuevos CRDs solo requiere configurarlos en `managedCRDs`
3. **Unificado**: Mismo mecanismo de patches para CRDs y recursos nativos
4. **Flexible**: Soporta cualquier CRD que tenga un campo de instancias/réplicas
5. **Mantenible**: Una sola configuración en `tenant_power.py`

---

## 🔄 Ejemplo Completo: Flujo de Sleep

```
NAMESPACE: bdadevdat-datastores

1. SleepInfo se activa (sleepAt: 17:12)
   │
   ├─ managedCRDs configurado:
   │   - PgBouncer (postgres.stratio.com/v1)
   │   - PgCluster (postgres.stratio.com/v1)
   │   - HDFSCluster (hdfs.stratio.com/v1)
   │
   ├─ kube-green lista CRDs:
   │   • kubectl get pgbouncer -n bdadevdat-datastores
   │     → Encuentra: pgbouncer-meta, pgbouncer-other (dinámico)
   │   • kubectl get pgcluster -n bdadevdat-datastores
   │     → Encuentra: postgres-meta, postgres-data (dinámico)
   │   • kubectl get hdfscluster -n bdadevdat-datastores
   │     → Encuentra: hdfs (dinámico)
   │
   ├─ Para cada CRD encontrado:
   │   • Leer spec.instances actual
   │   • Guardar restore patch
   │   • Aplicar patch: spec.instances = 0
   │   • Operador escala recursos automáticamente
   │
   └─ Listar Deployments/StatefulSets nativos:
      • Omitir los gobernados por CRDs gestionados
      • Aplicar patch directo a los nativos
```

---

## 🎯 Extensibilidad

### Agregar un Nuevo CRD

**Ejemplo**: Agregar soporte para `OpenSearchCluster`

1. **Configurar en SleepInfo**:
   ```yaml
   managedCRDs:
     - group: opensearch.stratio.com
       kind: OpenSearchCluster
       instancesField: spec.replicas  # o spec.instances según el CRD
       defaultInstances: 3
   ```

2. **kube-green automáticamente**:
   - Listará todos los `OpenSearchCluster` en el namespace
   - Aplicará patches a `spec.replicas` (o el campo configurado)
   - Omitirá los recursos hijos (Deployments/StatefulSets) gobernados por OpenSearchCluster

**Sin cambios en el código Go** - Solo configuración.

---

## ⚙️ Configuración en tenant_power.py

```python
def make_datastores_native_deploys_split_days(tenant, off_utc, on_deployments_utc,
                                              wd_sleep, wd_wake):
    """
    Gestiona Deployments/StatefulSets/CronJobs nativos Y CRDs de forma unificada.
    """
    ns = f"{tenant}-datastores"
    objs = []
    base_name = f"ds-deploys-{tenant}"
    
    spec = sleepinfo_base(
        wd_sleep, off_utc, on_deployments_utc,
        suspendDeployments=True, suspendStatefulSets=True, suspendCronJobs=True
    )
    
    # CRDs a gestionar dinámicamente (busca TODOS en el namespace)
    spec["managedCRDs"] = [
        {
            "group": "postgres.stratio.com",
            "kind": "PgBouncer",
            "instancesField": "spec.instances",
            "defaultInstances": 2
        },
        {
            "group": "postgres.stratio.com",
            "kind": "PgCluster",
            "instancesField": "spec.instances",  # verificar campo real
            "defaultInstances": 1
        },
        {
            "group": "hdfs.stratio.com",
            "kind": "HDFSCluster",
            "instancesField": "spec.instances",  # verificar campo real
            "defaultInstances": 3
        }
    ]
    
    # Exclusiones para recursos nativos que son gestionados por operadores
    # (los recursos hijos de CRDs se omiten automáticamente)
    spec["excludeRef"] = get_exclude_pg_hdfs_refs()
    
    objs.append(cr_yaml("SleepInfo", meta(base_name, ns), spec))
    return objs
```

---

## 🔍 Preguntas para Validar

1. **Campos de instancias**:
   - PgCluster: ¿`spec.instances` o `spec.replicas`?
   - HDFSCluster: ¿`spec.instances` o `spec.replicas`?

2. **Valores por defecto**: ¿Qué valores por defecto usar si no hay restore patch?

3. **Extensibilidad**: ¿Hay otros CRDs además de PgBouncer/PgCluster/HDFSCluster que quieras gestionar?

---

## 📊 Comparación Final

| Aspecto | Actual (Separado) | Propuesto (Unificado) |
|---------|-------------------|------------------------|
| **Configuración** | Múltiples SleepInfos con patches | Un SleepInfo con `managedCRDs` |
| **Detección** | Manual por nombre | Automática: lista TODOS los CRDs |
| **Extensibilidad** | Requiere código nuevo | Solo configuración |
| **Mantenimiento** | Complejo | Simple |
| **Dinámico** | Nombres hardcodeados | Busca todos los recursos del tipo |

---

## 🚀 Siguiente Paso

Validar campos de instancias en PgCluster y HDFSCluster, y luego proceder con la implementación.




