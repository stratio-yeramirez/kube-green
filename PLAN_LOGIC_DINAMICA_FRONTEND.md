# Plan de Implementación: Lógica Dinámica del Script Python al Frontend

## 📋 Análisis de la Lógica del Script Python

### Lógica Clave del Script `tenant_power.py`

#### 1. **Generación por Namespace Individual**
- Cada namespace (`datastores`, `apps`, `rocket`, `intelligence`, `airflowsso`) genera sus propios SleepInfos
- No hay un SleepInfo "global" que cubra múltiples namespaces
- Cada namespace puede tener schedules independientes

#### 2. **Lógica Escalonada Basada en CRDs Detectados (NO en nombre de namespace)**

**IMPORTANTE:** La lógica escalonada NO está hardcodeada al namespace `datastores`, sino que se aplica **dinámicamente** cuando se detectan CRDs en CUALQUIER namespace.

```python
make_datastores_native_deploys_split_days():
  # Esta función se llama para datastores, pero la lógica debe ser genérica
  - SleepInfo único para SLEEP: apaga TODOS los recursos (nativos + CRDs detectados)
  - Wake escalonado con múltiples SleepInfos separados:
    1. Wake PgCluster + HDFSCluster (t0) - solo si ambos están presentes
    2. Wake PgBouncer (t0+5m) - solo si está presente
    3. Wake Deployments nativos (t0+7m) - siempre presente
```

**Campos booleanos nativos usados (dinámicos según detección):**
- `suspendDeploymentsPgbouncer=True` → SOLO si se detecta PgBouncer CRD
- `suspendStatefulSetsPostgres=True` → SOLO si se detecta PgCluster CRD  
- `suspendStatefulSetsHdfs=True` → SOLO si se detecta HDFSCluster CRD

**Exclusiones automáticas (dinámicas según recursos encontrados):**
```python
EXCLUDE_PG_HDFS_LABELS = [
  {"matchLabels": {"app.kubernetes.io/managed-by": "postgres-operator"}},  # Solo si hay Postgres
  {"matchLabels": {"postgres.stratio.com/cluster": "true"}},              # Solo si hay Postgres
  {"matchLabels": {"app.kubernetes.io/part-of": "postgres"}},            # Solo si hay Postgres
  {"matchLabels": {"app.kubernetes.io/managed-by": "hdfs-operator"}},    # Solo si hay HDFS
  {"matchLabels": {"hdfs.stratio.com/cluster": "true"}},                  # Solo si hay HDFS
  {"matchLabels": {"app.kubernetes.io/part-of": "hdfs"}},                # Solo si hay HDFS
]
# Estas exclusiones se aplican SOLO si se detectan los recursos correspondientes
```

#### 3. **Lógica para Namespaces SIN CRDs**
```python
make_ns_split_days():
  - Si weekdays sleep == weekdays wake: SleepInfo único con sleepAt y wakeUpAt
  - Si weekdays diferentes: SleepInfos separados sleep/wake con pair-id compartido
  - Apps: excluye automáticamente Virtualizer por label (si se detecta)
  - Airflowsso: puede gestionar PgCluster con suspendStatefulSetsPostgres=True (si se detecta)
```

**Ejemplos de Lógica Dinámica:**

1. **Namespace `datastores` con PgCluster + HDFSCluster + PgBouncer:**
   - Aplica lógica escalonada completa (4 SleepInfos: 1 sleep + 3 wake)

2. **Namespace `airflowsso` con PgCluster (pero sin HDFS ni PgBouncer):**
   - Aplica lógica escalonada parcial:
     - SleepInfo SLEEP: apaga deployments + PgCluster
     - WakeInfo 1: enciende PgCluster (t0)
     - WakeInfo 2: enciende Deployments (t0+7m)

3. **Namespace `apps` sin CRDs:**
   - SleepInfo único o separado según weekdays
   - Excluye Virtualizer si se detecta

4. **Namespace `rocket` con PgBouncer pero sin Postgres/HDFS:**
   - SleepInfo SLEEP: apaga deployments + PgBouncer
   - WakeInfo 1: enciende PgBouncer (t0+5m)
   - WakeInfo 2: enciende Deployments (t0+7m)

#### 4. **Detección Dinámica de Recursos**
- El script NO detecta recursos dinámicamente, asume que existen
- El frontend DEBE detectar qué recursos hay en cada namespace para aplicar la lógica correcta

---

## 🎯 Problemas Actuales del Frontend

### 1. **Edición Global en lugar de por Namespace**
- ❌ El editor actual permite editar TODOS los namespaces del tenant a la vez
- ❌ No permite editar un namespace individualmente
- ❌ No refleja que cada namespace tiene sus propios SleepInfos independientes

### 2. **Falta de Detección Dinámica**
- ❌ No detecta si hay PgCluster, HDFSCluster, PgBouncer en el namespace
- ❌ No aplica automáticamente la lógica especial de `datastores`
- ❌ No aplica exclusiones automáticas basadas en labels encontradas

### 3. **Estructura de Datos Inadecuada**
- ❌ El tipo `CreateScheduleRequest` envía todos los namespaces juntos
- ❌ No permite configurar schedules diferentes por namespace
- ❌ No permite diferentes weekdays por namespace

---

## 🚀 Plan de Implementación

### Fase 1: Backend - Detección Dinámica de Recursos

#### 1.1 Nuevo Endpoint: Detectar CRDs en Namespace
```go
GET /api/v1/namespaces/{tenant}/resources?namespace={suffix}

Response:
{
  "success": true,
  "data": {
    "namespace": "bdadevdat-datastores",
    "hasPgCluster": true,
    "hasHdfsCluster": true,
    "hasPgBouncer": true,
    "hasVirtualizer": false,
    "resourceCounts": {
      "deployments": 5,
      "statefulSets": 3,
      "cronJobs": 2,
      "pgClusters": 1,
      "hdfsClusters": 1,
      "pgBouncers": 2
    },
    "autoExclusions": [
      {"matchLabels": {"app.kubernetes.io/managed-by": "postgres-operator"}},
      {"matchLabels": {"postgres.stratio.com/cluster": "true"}}
    ]
  }
}
```

**Implementación:**
- Buscar CRDs `PgCluster` en el namespace
- Buscar CRDs `HDFSCluster` en el namespace
- Buscar CRDs `PgBouncer` en el namespace
- Buscar Deployment con label `cct.stratio.com/application_id=virtualizer.*` (para apps)
- Retornar exclusiones automáticas basadas en labels encontradas

#### 1.2 Actualizar Endpoint de Creación/Actualización con Delays Configurables

**IMPORTANTE**: Los delays deben ser configurables por el usuario al crear/editar un schedule. Cada usuario puede configurar sus propios delays según sus necesidades.

```go
POST /api/v1/schedules/{tenant}/{namespace}
PUT /api/v1/schedules/{tenant}/{namespace}
DELETE /api/v1/schedules/{tenant}/{namespace}
```

**Request Body (por namespace) con Delays Configurables:**

```json
{
  "tenant": "bdadevdat",
  "namespace": "datastores",  // solo el suffix
  "userTimezone": "America/Bogota",
  "clusterTimezone": "UTC",
  "off": "21:30",
  "on": "06:00",
  "weekdaysSleep": "6",
  "weekdaysWake": "6",
  "delays": {
    // Delays para encendido escalonado (tiempo DESPUÉS del tiempo base de encendido)
    "pgHdfsDelay": "0m",        // Delay para PgCluster + HDFSCluster (default: 0m = t0)
    "pgbouncerDelay": "5m",     // Delay para PgBouncer (default: 5m = t0+5m)
    "deploymentsDelay": "7m"    // Delay para Deployments nativos (default: 7m = t0+7m)
  },
  "exclusions": [
    {
      "namespace": "datastores",
      "filter": {
        "matchLabels": {"cct.stratio.com/application_id": "virtualizer.bdadevdat-apps"}
      }
    }
  ]
}
```

**Lógica del Backend para Delays:**

```go
// Calcular tiempos escalonados según delays configurados
onPgHDFS := onUtc  // Base (t0)
onPgBouncer := onUtc
onDeployments := onUtc

if req.Delays != nil {
    // Parsear delays y aplicarlos
    if req.Delays.PgHdfsDelay != "" {
        pgHdfsDelayMinutes := parseDelayToMinutes(req.Delays.PgHdfsDelay)
        onPgHDFS = addMinutes(onUtc, pgHdfsDelayMinutes)
    }
    
    if req.Delays.PgbouncerDelay != "" {
        pgbouncerDelayMinutes := parseDelayToMinutes(req.Delays.PgbouncerDelay)
        onPgBouncer = addMinutes(onUtc, pgbouncerDelayMinutes)
    }
    
    if req.Delays.DeploymentsDelay != "" {
        deploymentsDelayMinutes := parseDelayToMinutes(req.Delays.DeploymentsDelay)
        onDeployments = addMinutes(onUtc, deploymentsDelayMinutes)
    }
} else {
    // Valores por defecto (igual que el script Python)
    onPgHDFS = onUtc                    // t0
    onPgBouncer = addMinutes(onUtc, 5)  // t0+5m
    onDeployments = addMinutes(onUtc, 7) // t0+7m
}
```

**Validación de Delays:**
- Formato válido: `"5m"`, `"10m"`, `"30s"`, `"0m"`, `"1h"`, etc.
- Debe ser un número seguido de unidad (s, m, h)
- Los delays pueden ser `"0m"` si se quiere encender todo al mismo tiempo
- Los delays deben ser >= 0 (no negativos)

**Lógica del Backend (COMPLETAMENTE DINÁMICA):**

La lógica debe basarse en los recursos detectados, NO en el nombre del namespace:

1. **Si se detectan CRDs (PgCluster, HDFSCluster, PgBouncer):**
   - Aplicar lógica de encendido escalonado
   - Generar SleepInfo SLEEP que apaga TODO (nativos + CRDs detectados)
   - Generar WakeInfos escalonados según qué CRDs están presentes:
     - Si hay PgCluster Y HDFSCluster: WakeInfo para ambos (t0)
     - Si hay PgBouncer: WakeInfo para PgBouncer (t0+5m)
     - WakeInfo final para Deployments nativos (t0+7m)
   - Aplicar exclusiones automáticas solo para los operadores detectados

2. **Si NO se detectan CRDs:**
   - Generar SleepInfo único o separado según weekdays
   - Aplicar exclusiones personalizadas si las hay
   - Si es `apps`: aplicar exclusión automática de Virtualizer (si se detecta)

3. **Casos Especiales:**
   - Si solo hay PgCluster (sin HDFS ni PgBouncer): WakeInfo solo para PgCluster
   - Si solo hay PgBouncer (sin Postgres): WakeInfo solo para PgBouncer
   - Si solo hay HDFSCluster: WakeInfo solo para HDFSCluster
   - Combinaciones parciales se manejan dinámicamente

**Ejemplo de Lógica Dinámica:**

```go
// Pseudocódigo de la lógica del backend
func generateSleepInfos(namespace string, resources NamespaceResourceInfo, schedule ScheduleRequest) []SleepInfo {
  hasCRDs := resources.hasPgCluster || resources.hasHdfsCluster || resources.hasPgBouncer
  
  if hasCRDs {
    // Aplicar lógica escalonada según qué CRDs están presentes
    return generateStaggeredSleepInfos(resources, schedule)
  } else {
    // Lógica simple sin CRDs
    return generateSimpleSleepInfos(namespace, schedule)
  }
}

func generateStaggeredSleepInfos(resources NamespaceResourceInfo, schedule ScheduleRequest) []SleepInfo {
  // SleepInfo único que apaga TODO
  sleepInfo := createSleepInfo(schedule, 
    suspendDeployments: true,
    suspendStatefulSets: true,
    suspendStatefulSetsPostgres: resources.hasPgCluster,
    suspendStatefulSetsHdfs: resources.hasHdfsCluster,
    suspendDeploymentsPgbouncer: resources.hasPgBouncer,
  )
  
  wakeInfos := []
  
  // Wake 1: PgCluster + HDFSCluster (solo si ambos están presentes)
  if resources.hasPgCluster && resources.hasHdfsCluster {
    wakeInfos.append(createWakeInfo(schedule, t0,
      suspendStatefulSetsPostgres: true,
      suspendStatefulSetsHdfs: true,
    ))
  } else if resources.hasPgCluster {
    // Solo PgCluster
    wakeInfos.append(createWakeInfo(schedule, t0,
      suspendStatefulSetsPostgres: true,
    ))
  } else if resources.hasHdfsCluster {
    // Solo HDFSCluster
    wakeInfos.append(createWakeInfo(schedule, t0,
      suspendStatefulSetsHdfs: true,
    ))
  }
  
  // Wake 2: PgBouncer (solo si está presente)
  if resources.hasPgBouncer {
    wakeInfos.append(createWakeInfo(schedule, t0+5m,
      suspendDeploymentsPgbouncer: true,
    ))
  }
  
  // Wake 3: Deployments nativos (siempre al final)
  wakeInfos.append(createWakeInfo(schedule, t0+7m,
    suspendDeployments: true,
    suspendStatefulSets: true,
    suspendCronJobs: true,
    // Si hay PgBouncer, también gestionarlo aquí para que se restaure
    suspendDeploymentsPgbouncer: resources.hasPgBouncer,
  ))
  
  return [sleepInfo] + wakeInfos
}
```

#### 1.3 Nuevo Endpoint: Obtener Schedule por Namespace
```go
GET /api/v1/schedules/{tenant}/{namespace}

Response:
{
  "success": true,
  "data": {
    "tenant": "bdadevdat",
    "namespace": "datastores",
    "sleepInfos": [
      {
        "name": "sleep-ds-deploys-bdadevdat",
        "role": "sleep",
        "weekdays": "6",
        "sleepAt": "02:30",
        "timeZone": "UTC",
        "suspendDeployments": true,
        "suspendStatefulSets": true,
        "suspendStatefulSetsPostgres": true,
        "suspendStatefulSetsHdfs": true,
        "suspendDeploymentsPgbouncer": true
      },
      {
        "name": "wake-ds-deploys-bdadevdat-pg-hdfs",
        "role": "wake",
        "weekdays": "6",
        "sleepAt": "11:00",
        "timeZone": "UTC",
        "suspendStatefulSetsPostgres": true,
        "suspendStatefulSetsHdfs": true
      }
      // ... más SleepInfos
    ],
    "exclusions": [...],
    "detectedResources": {
      "hasPgCluster": true,
      "hasHdfsCluster": true,
      "hasPgBouncer": true
    }
  }
}
```

---

### Fase 2: Frontend - Nuevos Tipos y Servicios

#### 2.1 Actualizar Tipos TypeScript

```typescript
// types/index.ts

export interface NamespaceResourceInfo {
  namespace: string
  hasPgCluster: boolean
  hasHdfsCluster: boolean
  hasPgBouncer: boolean
  hasVirtualizer: boolean
  resourceCounts: {
    deployments: number
    statefulSets: number
    cronJobs: number
    pgClusters: number
    hdfsClusters: number
    pgBouncers: number
  }
  autoExclusions: Exclusion[]
}

export interface NamespaceScheduleRequest {
  tenant: string
  namespace: string  // solo el suffix: "datastores", "apps", etc.
  userTimezone: string
  clusterTimezone: string
  off: string
  on: string
  weekdaysSleep: string
  weekdaysWake: string
  delays?: WakeDelayConfig  // Delays para encendido escalonado
  exclusions?: Exclusion[]
}

export interface WakeDelayConfig {
  // Delays para encendido escalonado (tiempo DESPUÉS del tiempo base de encendido)
  pgHdfsDelay?: string      // Delay para PgCluster + HDFSCluster (default: "0m")
  pgbouncerDelay?: string   // Delay para PgBouncer (default: "5m")
  deploymentsDelay?: string // Delay para Deployments nativos (default: "7m")
}

export interface NamespaceScheduleResponse {
  tenant: string
  namespace: string
  sleepInfos: SleepInfoDetail[]
  exclusions: Exclusion[]
  detectedResources: {
    hasPgCluster: boolean
    hasHdfsCluster: boolean
    hasPgBouncer: boolean
  }
}

export interface SleepInfoDetail {
  name: string
  role: 'sleep' | 'wake'
  weekdays: string
  sleepAt?: string
  wakeUpAt?: string
  timeZone: string
  suspendDeployments?: boolean
  suspendStatefulSets?: boolean
  suspendCronJobs?: boolean
  suspendDeploymentsPgbouncer?: boolean
  suspendStatefulSetsPostgres?: boolean
  suspendStatefulSetsHdfs?: boolean
  excludeRef?: Exclusion[]
}
```

#### 2.2 Actualizar Servicio API

```typescript
// services/api.ts

class ApiClient {
  // Detectar recursos CRDs en un namespace
  async getNamespaceResources(tenant: string, namespace: string): Promise<NamespaceResourceInfo> {
    const response = await this.client.get<ApiResponse<NamespaceResourceInfo>>(
      `/namespaces/${tenant}/resources?namespace=${namespace}`
    )
    return response.data.data
  }

  // Obtener schedule de un namespace específico
  async getNamespaceSchedule(tenant: string, namespace: string): Promise<NamespaceScheduleResponse> {
    const response = await this.client.get<ApiResponse<NamespaceScheduleResponse>>(
      `/schedules/${tenant}/${namespace}`
    )
    return response.data.data
  }

  // Crear schedule para un namespace específico
  async createNamespaceSchedule(request: NamespaceScheduleRequest): Promise<void> {
    await this.client.post<ApiResponse<void>>(
      `/schedules/${request.tenant}/${request.namespace}`,
      request
    )
  }

  // Actualizar schedule de un namespace específico
  async updateNamespaceSchedule(
    tenant: string,
    namespace: string,
    request: NamespaceScheduleRequest
  ): Promise<void> {
    await this.client.put<ApiResponse<void>>(
      `/schedules/${tenant}/${namespace}`,
      request
    )
  }

  // Eliminar schedule de un namespace específico
  async deleteNamespaceSchedule(tenant: string, namespace: string): Promise<void> {
    await this.client.delete<ApiResponse<void>>(
      `/schedules/${tenant}/${namespace}`
    )
  }
}
```

---

### Fase 3: Frontend - Nuevos Componentes

#### 3.1 Componente: `NamespaceScheduleEditor`

**Ruta:** `/schedule/edit/:tenantName/:namespace`

**Funcionalidades:**
- Editar schedule de UN SOLO namespace
- **Detectar automáticamente recursos CRDs al cargar** (sin importar el nombre del namespace)
- **Aplicar lógica escalonada dinámicamente** si se detectan CRDs:
  - Mostrar opciones de encendido escalonado solo si hay CRDs detectados
  - Mostrar campos booleanos SOLO para los CRDs que están presentes
  - Aplicar exclusiones automáticas SOLO para los operadores detectados
- **Delays configurables por usuario**:
  - Mostrar sección de delays SOLO si hay CRDs detectados (para encendido escalonado)
  - Permitir configurar delays personalizados para cada tipo de recurso
  - Mostrar valores por defecto pero permitir cambiarlos
  - Validar formato de delays (ej: "5m", "10m", "0m")
  - Mostrar vista previa de tiempos escalonados con los delays configurados
- Si se detecta Virtualizer en `apps`: aplicar exclusión automática
- Permitir diferentes weekdays para sleep y wake
- Mostrar vista previa de los SleepInfos que se generarán (adaptada a recursos detectados)
- **Cargar delays existentes** al editar un schedule existente

**Estructura del Formulario (Dinámica según recursos detectados):**

**Ejemplo 1: Namespace con todos los CRDs (datastores típico):**
```
┌─────────────────────────────────────┐
│ Namespace: datastores                │
│ Tenant: bdadevdat                    │
├─────────────────────────────────────┤
│ Recursos Detectados:                 │
│ ✓ PgCluster (1)                     │
│ ✓ HDFSCluster (1)                   │
│ ✓ PgBouncer (2)                     │
│ ✓ Deployments (5)                    │
│ ✓ StatefulSets (3)                   │
├─────────────────────────────────────┤
│ ⚠️ CRDs detectados: Lógica escalonada│
├─────────────────────────────────────┤
│ Horarios:                            │
│ Timezone Usuario: [America/Bogota]  │
│ Timezone Cluster: [UTC]              │
│ Apagado: [21:30]                     │
│ Encendido Base: [06:00]              │
├─────────────────────────────────────┤
│ ⏱️ Delays de Encendido Escalonado:  │
│ [✓] Configurar delays personalizados│
│ Delay PgCluster+HDFS: [0m]          │
│ Delay PgBouncer: [5m]                │
│ Delay Deployments: [7m]              │
│                                      │
│ ⚠️ Estos delays son DESPUÉS del     │
│    tiempo base de encendido          │
├─────────────────────────────────────┤
│ Días:                                │
│ Sleep: [Sábado]                      │
│ Wake: [Domingo]                      │
├─────────────────────────────────────┤
│ Vista Previa (4 SleepInfos):         │
│ 1. sleep-* (SLEEP - apaga todo)      │
│ 2. wake-*-pg-hdfs (06:00 + 0m)       │
│ 3. wake-*-pgbouncer (06:00 + 5m)     │
│ 4. wake-*-deploys (06:00 + 7m)       │
└─────────────────────────────────────┘
```

**Ejemplo 2: Namespace con solo PgCluster (airflowsso típico):**
```
┌─────────────────────────────────────┐
│ Namespace: airflowsso                │
│ Tenant: bdadevdat                    │
├─────────────────────────────────────┤
│ Recursos Detectados:                 │
│ ✓ PgCluster (1)                     │
│ ✗ HDFSCluster (0)                   │
│ ✗ PgBouncer (0)                     │
│ ✓ Deployments (3)                    │
│ ✓ StatefulSets (2)                   │
├─────────────────────────────────────┤
│ ⚠️ CRDs detectados: Lógica escalonada│
├─────────────────────────────────────┤
│ Horarios:                            │
│ Timezone Usuario: [America/Bogota]  │
│ Timezone Cluster: [UTC]              │
│ Apagado: [21:30]                     │
│ Encendido: [06:00]                   │
├─────────────────────────────────────┤
│ Vista Previa (3 SleepInfos):         │
│ 1. sleep-* (SLEEP - apaga todo)      │
│ 2. wake-*-postgres (t0)               │
│ 3. wake-*-deploys (t0+7m)            │
└─────────────────────────────────────┘
```

**Ejemplo 3: Namespace sin CRDs (apps típico):**
```
┌─────────────────────────────────────┐
│ Namespace: apps                       │
│ Tenant: bdadevdat                    │
├─────────────────────────────────────┤
│ Recursos Detectados:                 │
│ ✗ PgCluster (0)                     │
│ ✗ HDFSCluster (0)                   │
│ ✗ PgBouncer (0)                     │
│ ✓ Deployments (8)                    │
│ ✓ StatefulSets (1)                   │
│ ✓ Virtualizer (1) - Excluido automáticamente
├─────────────────────────────────────┤
│ Horarios:                            │
│ Timezone Usuario: [America/Bogota]  │
│ Timezone Cluster: [UTC]              │
│ Apagado: [21:30]                     │
│ Encendido: [06:00]                   │
├─────────────────────────────────────┤
│ Vista Previa (1 SleepInfo):          │
│ 1. sleep-wake-* (único)              │
└─────────────────────────────────────┘
```

#### 3.2 Componente: `NamespaceScheduleCard`

**Ubicación:** Dentro de `TenantDetail`

**Funcionalidades:**
- Mostrar cada namespace como una tarjeta independiente
- Mostrar recursos detectados en cada namespace (CRDs presentes)
- Indicador visual si tiene CRDs (aplicará lógica escalonada)
- Botón "Editar" por namespace
- Botón "Eliminar" por namespace

**Ejemplo Visual:**
```
┌─────────────────────────────────────────────┐
│ 📦 datastores                                │
│ ────────────────────────────────────────────│
│ ✓ PgCluster (1)                            │
│ ✓ HDFSCluster (1)                          │
│ ✓ PgBouncer (2)                            │
│ ⚠️ Lógica escalonada activa                  │
│ SleepInfos: 4 (1 sleep + 3 wake)           │
│                                             │
│ [Editar] [Eliminar]                         │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ 📦 airflowsso                                │
│ ────────────────────────────────────────────│
│ ✓ PgCluster (1)                            │
│ ✗ HDFSCluster (0)                          │
│ ✗ PgBouncer (0)                            │
│ ⚠️ Lógica escalonada activa                  │
│ SleepInfos: 3 (1 sleep + 2 wake)            │
│                                             │
│ [Editar] [Eliminar]                         │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ 📦 apps                                      │
│ ────────────────────────────────────────────│
│ ✗ Sin CRDs detectados                      │
│ ✓ Deployments (8)                          │
│ ✓ Virtualizer (excluido automáticamente)   │
│ SleepInfos: 1 (único)                       │
│                                             │
│ [Editar] [Eliminar]                         │
└─────────────────────────────────────────────┘
```

#### 3.3 Actualizar `TenantDetail`

**Cambios:**
- Mostrar schedules agrupados por namespace (ya lo hace parcialmente)
- Agregar botón "Editar" por namespace que navega a `/schedule/edit/:tenant/:namespace`
- Agregar botón "Eliminar" por namespace
- Mostrar recursos detectados en cada namespace
- Agregar botón "Crear Schedule" por namespace si no existe

#### 3.4 Actualizar `Dashboard`

**Cambios:**
- Al hacer clic en un tenant, mostrar vista de namespaces con schedules
- Mostrar resumen por namespace en lugar de global

---

### Fase 4: Frontend - Lógica de Detección y Generación

#### 4.1 Hook: `useNamespaceResources`

```typescript
// hooks/useNamespaceResources.ts

export function useNamespaceResources(tenant: string, namespace: string) {
  return useQuery({
    queryKey: ['namespace-resources', tenant, namespace],
    queryFn: () => apiClient.getNamespaceResources(tenant, namespace),
    enabled: !!tenant && !!namespace,
    staleTime: 60000, // 1 minuto
  })
}
```

#### 4.2 Hook: `useNamespaceSchedule`

```typescript
// hooks/useNamespaceSchedule.ts

export function useNamespaceSchedule(tenant: string, namespace: string) {
  return useQuery({
    queryKey: ['namespace-schedule', tenant, namespace],
    queryFn: () => apiClient.getNamespaceSchedule(tenant, namespace),
    enabled: !!tenant && !!namespace,
    staleTime: 30000,
  })
}

export function useCreateNamespaceSchedule() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (request: NamespaceScheduleRequest) =>
      apiClient.createNamespaceSchedule(request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ['namespace-schedule', variables.tenant, variables.namespace] 
      })
      queryClient.invalidateQueries({ 
        queryKey: ['schedules', variables.tenant] 
      })
    },
  })
}

export function useUpdateNamespaceSchedule() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ tenant, namespace, request }: {
      tenant: string
      namespace: string
      request: NamespaceScheduleRequest
    }) => apiClient.updateNamespaceSchedule(tenant, namespace, request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ['namespace-schedule', variables.tenant, variables.namespace] 
      })
      queryClient.invalidateQueries({ 
        queryKey: ['schedules', variables.tenant] 
      })
    },
  })
}

export function useDeleteNamespaceSchedule() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ tenant, namespace }: { tenant: string; namespace: string }) =>
      apiClient.deleteNamespaceSchedule(tenant, namespace),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ['namespace-schedule', variables.tenant, variables.namespace] 
      })
      queryClient.invalidateQueries({ 
        queryKey: ['schedules', variables.tenant] 
      })
      queryClient.invalidateQueries({ 
        queryKey: ['allSchedules'] 
      })
    },
  })
}
```

#### 4.5 Utilidad: Carga de Delays Existentes

```typescript
// utils/scheduleHelpers.ts

/**
 * Extrae delays de un schedule existente analizando los tiempos de los SleepInfos wake
 */
export function extractDelaysFromSchedule(
  schedule: NamespaceScheduleResponse,
  baseWakeTime: string
): WakeDelayConfig {
  const delays: WakeDelayConfig = {}
  
  // Buscar SleepInfos wake y calcular delays basándose en sleepAt
  const wakeInfos = schedule.sleepInfos.filter(si => si.role === 'wake')
  
  // Encontrar el tiempo base (el más temprano)
  const wakeTimes = wakeInfos.map(si => si.sleepAt || '').filter(Boolean)
  const earliestWake = wakeTimes.sort()[0] || baseWakeTime
  
  // Calcular delays para cada tipo
  wakeInfos.forEach(si => {
    if (!si.sleepAt) return
    
    const delayMinutes = calculateDelayMinutes(earliestWake, si.sleepAt)
    
    if (si.suspendStatefulSetsPostgres || si.suspendStatefulSetsHdfs) {
      delays.pgHdfsDelay = formatMinutesToDelay(delayMinutes)
    } else if (si.suspendDeploymentsPgbouncer && !si.suspendDeployments) {
      delays.pgbouncerDelay = formatMinutesToDelay(delayMinutes)
    } else if (si.suspendDeployments && !si.suspendStatefulSetsPostgres && !si.suspendStatefulSetsHdfs) {
      delays.deploymentsDelay = formatMinutesToDelay(delayMinutes)
    }
  })
  
  return delays
}

function calculateDelayMinutes(baseTime: string, targetTime: string): number {
  const [baseHh, baseMm] = baseTime.split(':').map(Number)
  const [targetHh, targetMm] = targetTime.split(':').map(Number)
  const baseMinutes = baseHh * 60 + baseMm
  const targetMinutes = targetHh * 60 + targetMm
  return (targetMinutes - baseMinutes + 24 * 60) % (24 * 60) // Manejar wrap-around
}
```

#### 4.6 Utilidad: Validación de Delays

```typescript
// utils/delayValidation.ts

export function validateDelayFormat(delay: string): { valid: boolean; error?: string } {
  if (!delay) {
    return { valid: false, error: 'Delay no puede estar vacío' }
  }
  
  // Formato: número seguido de unidad (s, m, h)
  const delayRegex = /^(\d+)([smh])$/
  const match = delay.match(delayRegex)
  
  if (!match) {
    return { valid: false, error: 'Formato inválido. Use: "5m", "10m", "30s", "1h", etc.' }
  }
  
  const value = parseInt(match[1], 10)
  const unit = match[2]
  
  if (value < 0) {
    return { valid: false, error: 'Delay no puede ser negativo' }
  }
  
  // Validar límites razonables (opcional)
  if (unit === 'h' && value > 24) {
    return { valid: false, error: 'Delay no puede ser mayor a 24 horas' }
  }
  
  return { valid: true }
}
```

```typescript
// utils/namespaceLogic.ts

export interface NamespaceLogicConfig {
  isDatastores: boolean
  hasCRDs: boolean
  requiresStaggeredWake: boolean
  autoExclusions: Exclusion[]
  managedResources: {
    deployments: boolean
    statefulSets: boolean
    cronJobs: boolean
    pgbouncer: boolean
    postgres: boolean
    hdfs: boolean
  }
}

export function detectNamespaceLogic(
  namespace: string,
  resources: NamespaceResourceInfo
): NamespaceLogicConfig {
  // IMPORTANTE: La lógica NO depende del nombre del namespace, sino de los recursos detectados
  const hasCRDs = resources.hasPgCluster || resources.hasHdfsCluster || resources.hasPgBouncer
  
  // La lógica escalonada se aplica SIEMPRE que haya CRDs detectados, sin importar el namespace
  const requiresStaggeredWake = hasCRDs

  return {
    isDatastores: false, // Ya no se usa este flag, es solo informativo
    hasCRDs,
    requiresStaggeredWake, // Basado en detección, no en nombre
    autoExclusions: resources.autoExclusions,
    managedResources: {
      deployments: true,
      // StatefulSets nativos: solo si NO hay CRDs que los gestionen
      // Si hay PgCluster o HDFSCluster, los StatefulSets nativos se excluyen automáticamente
      statefulSets: !hasCRDs || (!resources.hasPgCluster && !resources.hasHdfsCluster),
      cronJobs: true,
      // CRDs: solo si están presentes
      pgbouncer: resources.hasPgBouncer,
      postgres: resources.hasPgCluster,
      hdfs: resources.hasHdfsCluster,
    },
  }
}

export function generateSleepInfoPreview(
  config: NamespaceLogicConfig,
  schedule: NamespaceScheduleRequest
): SleepInfoDetail[] {
  // Generar lista de SleepInfos que se crearán basado en la lógica del script Python
  // Esto es solo para preview, el backend genera los SleepInfos reales
  const preview: SleepInfoDetail[] = []

  if (config.requiresStaggeredWake) {
    // Namespace con CRDs detectados: Sleep único + Wake escalonados según qué CRDs hay
    
    // 1. SleepInfo único que apaga TODO
    preview.push({
      name: `sleep-${schedule.namespace}-${schedule.tenant}`,
      role: 'sleep',
      weekdays: schedule.weekdaysSleep,
      sleepAt: convertTimezone(schedule.off, schedule.userTimezone, schedule.clusterTimezone).clusterTime,
      timeZone: schedule.clusterTimezone,
      suspendDeployments: true,
      suspendStatefulSets: config.managedResources.statefulSets,
      suspendCronJobs: true,
      suspendDeploymentsPgbouncer: config.managedResources.pgbouncer,
      suspendStatefulSetsPostgres: config.managedResources.postgres,
      suspendStatefulSetsHdfs: config.managedResources.hdfs,
    })
    
    // 2. Wake escalonados según qué CRDs están presentes
    const onUtc = convertTimezone(schedule.on, schedule.userTimezone, schedule.clusterTimezone).clusterTime
    
    // Wake 1: PgCluster + HDFSCluster (solo si ambos están presentes)
    if (config.managedResources.postgres && config.managedResources.hdfs) {
      preview.push({
        name: `wake-${schedule.namespace}-${schedule.tenant}-pg-hdfs`,
        role: 'wake',
        weekdays: schedule.weekdaysWake,
        sleepAt: onUtc, // t0
        timeZone: schedule.clusterTimezone,
        suspendStatefulSetsPostgres: true,
        suspendStatefulSetsHdfs: true,
      })
    } else if (config.managedResources.postgres) {
      // Solo PgCluster
      preview.push({
        name: `wake-${schedule.namespace}-${schedule.tenant}-postgres`,
        role: 'wake',
        weekdays: schedule.weekdaysWake,
        sleepAt: onUtc, // t0
        timeZone: schedule.clusterTimezone,
        suspendStatefulSetsPostgres: true,
      })
    } else if (config.managedResources.hdfs) {
      // Solo HDFSCluster
      preview.push({
        name: `wake-${schedule.namespace}-${schedule.tenant}-hdfs`,
        role: 'wake',
        weekdays: schedule.weekdaysWake,
        sleepAt: onUtc, // t0
        timeZone: schedule.clusterTimezone,
        suspendStatefulSetsHdfs: true,
      })
    }
    
    // Wake 2: PgBouncer (solo si está presente)
    if (config.managedResources.pgbouncer) {
      const onPgBouncer = addMinutesToTime(onUtc, 5) // t0+5m
      preview.push({
        name: `wake-${schedule.namespace}-${schedule.tenant}-pgbouncer`,
        role: 'wake',
        weekdays: schedule.weekdaysWake,
        sleepAt: onPgBouncer,
        timeZone: schedule.clusterTimezone,
        suspendDeploymentsPgbouncer: true,
      })
    }
    
    // Wake 3: Deployments nativos (siempre al final)
    const onDeployments = addMinutesToTime(onUtc, 7) // t0+7m
    preview.push({
      name: `wake-${schedule.namespace}-${schedule.tenant}`,
      role: 'wake',
      weekdays: schedule.weekdaysWake,
      sleepAt: onDeployments,
      timeZone: schedule.clusterTimezone,
      suspendDeployments: true,
      suspendStatefulSets: config.managedResources.statefulSets,
      suspendCronJobs: true,
      // Si hay PgBouncer, también gestionarlo aquí para que se restaure
      suspendDeploymentsPgbouncer: config.managedResources.pgbouncer,
    })
  } else {
    // Sin CRDs: SleepInfo único o separado según weekdays
    const weekdaysSleepSet = new Set(schedule.weekdaysSleep.split(','))
    const weekdaysWakeSet = new Set(schedule.weekdaysWake.split(','))
    const weekdaysEqual = weekdaysSleepSet.size === weekdaysWakeSet.size && 
      [...weekdaysSleepSet].every(d => weekdaysWakeSet.has(d))
    
    if (weekdaysEqual) {
      // SleepInfo único
      preview.push({
        name: `${schedule.namespace}-${schedule.tenant}`,
        role: 'sleep',
        weekdays: schedule.weekdaysSleep,
        sleepAt: convertTimezone(schedule.off, schedule.userTimezone, schedule.clusterTimezone).clusterTime,
        wakeUpAt: convertTimezone(schedule.on, schedule.userTimezone, schedule.clusterTimezone).clusterTime,
        timeZone: schedule.clusterTimezone,
        suspendDeployments: true,
        suspendStatefulSets: true,
        suspendCronJobs: true,
      })
    } else {
      // SleepInfos separados
      preview.push({
        name: `sleep-${schedule.namespace}-${schedule.tenant}`,
        role: 'sleep',
        weekdays: schedule.weekdaysSleep,
        sleepAt: convertTimezone(schedule.off, schedule.userTimezone, schedule.clusterTimezone).clusterTime,
        timeZone: schedule.clusterTimezone,
        suspendDeployments: true,
        suspendStatefulSets: true,
        suspendCronJobs: true,
      })
      preview.push({
        name: `wake-${schedule.namespace}-${schedule.tenant}`,
        role: 'wake',
        weekdays: schedule.weekdaysWake,
        sleepAt: convertTimezone(schedule.on, schedule.userTimezone, schedule.clusterTimezone).clusterTime,
        timeZone: schedule.clusterTimezone,
        suspendDeployments: true,
        suspendStatefulSets: true,
        suspendCronJobs: true,
      })
    }
  }

  return preview
}

function addMinutesToTime(timeStr: string, minutes: number): string {
  // Helper para agregar minutos a formato HH:MM
  const [hh, mm] = timeStr.split(':').map(Number)
  const totalMinutes = hh * 60 + mm + minutes
  const newHh = Math.floor(totalMinutes / 60) % 24
  const newMm = totalMinutes % 60
  return `${String(newHh).padStart(2, '0')}:${String(newMm).padStart(2, '0')}`
}
```

---

### Fase 5: Rutas y Navegación

#### 5.1 Actualizar Rutas

```typescript
// App.tsx

<Routes>
  <Route path="/" element={<Dashboard />} />
  <Route path="/tenant/:tenantName" element={<TenantDetail />} />
  
  {/* Crear schedule para un namespace específico */}
  <Route path="/schedule/new/:tenantName/:namespace" element={<NamespaceScheduleEditor />} />
  
  {/* Editar schedule de un namespace específico */}
  <Route path="/schedule/edit/:tenantName/:namespace" element={<NamespaceScheduleEditor />} />
  
  {/* Mantener rutas antiguas para compatibilidad (opcional) */}
  <Route path="/schedule/new" element={<ScheduleEditor />} />
  <Route path="/schedule/edit/:tenantName" element={<ScheduleEditor />} />
  
  <Route path="/suspended" element={<SuspendedServices />} />
</Routes>
```

#### 5.2 Actualizar Navegación en `TenantDetail`

```typescript
// TenantDetail.tsx

// Por cada namespace, agregar botones:
<Button
  variant="outlined"
  onClick={() => navigate(`/schedule/edit/${tenantName}/${namespace}`)}
>
  Editar {namespace}
</Button>

<Button
  variant="outlined"
  color="error"
  onClick={() => handleDeleteNamespace(namespace)}
>
  Eliminar {namespace}
</Button>
```

---

## 📊 Diagrama de Flujo de Usuario

```
Usuario → Dashboard
  ↓
Click en Tenant → TenantDetail
  ├─ Muestra todos los namespaces con schedules
  ├─ Cada namespace tiene botón "Editar"
  └─ Cada namespace tiene botón "Eliminar"
  ↓
Click "Editar" en cualquier namespace
  ↓
NamespaceScheduleEditor carga:
  ├─ Detecta recursos CRDs dinámicamente (sin importar namespace)
  ├─ Si detecta CRDs: aplica lógica escalonada automáticamente
  ├─ Si NO detecta CRDs: aplica lógica simple
  ├─ Muestra campos booleanos SOLO para CRDs detectados
  ├─ Aplica exclusiones automáticas SOLO para operadores detectados
  └─ Muestra vista previa adaptada a recursos detectados (2-4 SleepInfos según CRDs)
  ↓
Usuario edita horarios, weekdays, delays
  ↓
Click "Guardar"
  ↓
Backend genera SleepInfos según lógica del script Python
  ↓
Retorna a TenantDetail con schedules actualizados
```

---

## 🔄 Migración desde el Sistema Actual

### Paso 1: Compatibilidad Hacia Atrás
- Mantener endpoints antiguos (`/schedules/{tenant}`) funcionando
- Los nuevos endpoints (`/schedules/{tenant}/{namespace}`) son adicionales
- El frontend puede migrar gradualmente

### Paso 2: Migración de Datos Existentes
- Al editar un schedule existente desde el editor global:
  - Detectar qué namespaces tiene
  - Permitir migrar a edición por namespace
  - O mantener el editor global para casos simples

### Paso 3: Feature Flag
- Agregar feature flag para habilitar/deshabilitar edición por namespace
- Permitir usar ambos sistemas en paralelo durante la migración

---

## ✅ Checklist de Implementación

### Backend
- [ ] Endpoint `GET /api/v1/namespaces/{tenant}/resources`
- [ ] Endpoint `GET /api/v1/schedules/{tenant}/{namespace}`
- [ ] Endpoint `POST /api/v1/schedules/{tenant}/{namespace}` con delays configurables
- [ ] Endpoint `PUT /api/v1/schedules/{tenant}/{namespace}` con delays configurables
- [ ] Endpoint `DELETE /api/v1/schedules/{tenant}/{namespace}`
- [ ] Lógica de detección de CRDs (PgCluster, HDFSCluster, PgBouncer)
- [ ] Lógica de generación de SleepInfos según tipo de namespace
- [ ] **Aplicación de delays configurables para tiempos escalonados**
- [ ] **Cálculo de tiempos escalonados basado en delays del usuario**
- [ ] **Valores por defecto de delays si no se especifican (0m, 5m, 7m)**
- [ ] **Validación de formato de delays (ej: "5m", "10m", "0m")**
- [ ] Aplicación de exclusiones automáticas
- [ ] Tests unitarios para lógica de generación
- [ ] Tests de integración para endpoints
- [ ] **Tests para delays configurables y tiempos escalonados**

### Frontend
- [ ] Nuevos tipos TypeScript (`NamespaceScheduleRequest`, `WakeDelayConfig`, etc.)
- [ ] Actualizar `api.ts` con nuevos endpoints
- [ ] Hook `useNamespaceResources`
- [ ] Hook `useNamespaceSchedule`
- [ ] Componente `NamespaceScheduleEditor`
- [ ] **Componente `DelaysConfiguration` para delays configurables**
- [ ] Componente `NamespaceScheduleCard`
- [ ] Actualizar `TenantDetail` con edición por namespace
- [ ] Actualizar rutas en `App.tsx`
- [ ] Utilidad `detectNamespaceLogic`
- [ ] **Utilidad `extractDelaysFromSchedule` para cargar delays existentes**
- [ ] **Utilidad `validateDelayFormat` para validación**
- [ ] Vista previa de SleepInfos generados
- [ ] **Vista previa de tiempos escalonados con delays configurados**
- [ ] Manejo de errores específicos por namespace
- [ ] **Mostrar delays solo cuando hay CRDs detectados**

### Testing
- [ ] Tests unitarios para `detectNamespaceLogic`
- [ ] Tests E2E para flujo completo de edición por namespace
- [ ] Tests de compatibilidad con sistema antiguo

### Documentación
- [ ] Documentar nuevos endpoints en API
- [ ] Actualizar README del frontend
- [ ] Documentar migración desde sistema antiguo

---

## 🎯 Prioridades

### Prioridad Alta (MVP)
1. Backend: Detección de recursos CRDs
2. Backend: Endpoints por namespace
3. Frontend: `NamespaceScheduleEditor` básico
4. Frontend: Edición por namespace en `TenantDetail`

### Prioridad Media
1. Vista previa de SleepInfos generados
2. Aplicación automática de exclusiones
3. Detección automática de lógica especial

### Prioridad Baja
1. Migración desde sistema antiguo
2. Feature flags
3. Documentación extensa

---

## 📚 Análisis Completo de Casos de Uso

**IMPORTANTE**: Se ha creado un análisis detallado de TODOS los casos de uso del script Python en:
`ANALISIS_CASOS_USO_COMPLETO.md`

Este análisis incluye:
- ✅ 14 casos de uso principales identificados
- ✅ 6 escenarios diferentes de combinaciones de CRDs
- ✅ Casos edge y comportamientos especiales
- ✅ Checklist de cobertura completo

**Asegúrate de revisar ese documento antes de implementar para garantizar que todos los casos estén cubiertos.**

### Casos Críticos que DEBEN estar implementados:

1. **Weekdays iguales vs diferentes** - Lógica completamente diferente
2. **Timezone shift y day shift** - Ajuste automático de weekdays
3. **6 escenarios de combinaciones de CRDs** - Lógica dinámica completa
4. **Delays configurables** - No hardcodeados
5. **Exclusiones dinámicas** - Solo aplicar si se detectan recursos
6. **Nombres de SleepInfos** - Patrones específicos según contexto
7. **Pair-ID y Pair-Role** - Para weekdays diferentes
8. **StatefulSets nativos** - Lógica condicional según CRDs presentes

---

1. **La lógica del script Python es compleja**: El backend debe replicar exactamente la lógica de generación de SleepInfos para mantener compatibilidad.

2. **Detección Dinámica es Crítica**: El frontend y backend deben detectar qué recursos hay en cada namespace para aplicar la lógica correcta. **NO se debe asumir que solo `datastores` tiene CRDs** - cualquier namespace puede tenerlos (`airflowsso` puede tener PgCluster, `rocket` puede tener PgBouncer, etc.). La lógica escalonada se aplica **donde se detecten CRDs**, no en nombres de namespace específicos.

3. **Backward Compatibility**: Mantener compatibilidad con el sistema actual durante la migración es importante para no romper workflows existentes.

4. **Testing Riguroso**: La lógica de generación de SleepInfos es crítica, debe estar bien testeada para evitar crear configuraciones incorrectas.

5. **Performance**: La detección de recursos CRDs puede ser costosa si se hace frecuentemente. Considerar caché y refetch estratégico.

