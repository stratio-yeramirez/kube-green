# Ajustes para Delays Configurables por Usuario

## ⚠️ Problema Identificado

El frontend actual tiene una sección de delays pero:
1. Está oculta detrás de un checkbox "Mostrar configuración avanzada"
2. Los delays actuales están mal nombrados (suspendDeployments, suspendStatefulSets, etc.)
3. No refleja claramente que son delays para ENCENDIDO escalonado
4. No se muestran solo cuando hay CRDs detectados
5. No se cargan correctamente al editar un schedule existente

## ✅ Solución: Delays Configurables Dinámicos

### 1. **Ajustar Nombres de Delays**

Los delays deben reflejar que son para ENCENDIDO escalonado, no para suspensión:

**ANTES (incorrecto):**
```typescript
delays: {
  suspendDeployments: "5m",          // ❌ No es claro que es para encendido
  suspendStatefulSets: "7m",          // ❌ No es claro que es para encendido
  suspendDeploymentsPgbouncer: "5m",  // ❌ No es claro que es para encendido
}
```

**DESPUÉS (correcto):**
```typescript
delays: {
  pgHdfsDelay: "0m",        // ✅ Delay para encender PgCluster + HDFSCluster
  pgbouncerDelay: "5m",     // ✅ Delay para encender PgBouncer
  deploymentsDelay: "7m"    // ✅ Delay para encender Deployments nativos
}
```

### 2. **Mostrar Delays Solo Cuando Hay CRDs**

Los delays solo tienen sentido cuando hay CRDs detectados porque son para encendido escalonado:

```typescript
// En NamespaceScheduleEditor
{resources && (resources.hasPgCluster || resources.hasHdfsCluster || resources.hasPgBouncer) && (
  <DelaysConfiguration
    resources={resources}
    delays={delays}
    onDelaysChange={setDelays}
    baseWakeTime={convertedWakeTime}
  />
)}
```

### 3. **Hacer Delays Más Visibles**

NO ocultar detrás de un checkbox. Mostrar directamente cuando hay CRDs:

```typescript
// ❌ ANTES: Oculto detrás de checkbox
<FormControlLabel
  control={<Checkbox checked={showDelays} />}
  label="Mostrar configuración avanzada"
/>
{showDelays && <DelaysSection />}

// ✅ DESPUÉS: Visible directamente si hay CRDs
{hasCRDs && <DelaysSection />}
```

### 4. **Cargar Delays Existentes al Editar**

Al editar un schedule existente, extraer los delays de los SleepInfos wake:

```typescript
useEffect(() => {
  if (existingSchedule && resources && hasCRDs) {
    // Extraer delays analizando los tiempos de los SleepInfos wake
    const extractedDelays = extractDelaysFromSchedule(
      existingSchedule,
      baseWakeTime
    )
    setDelays(extractedDelays)
  }
}, [existingSchedule, resources])
```

### 5. **Vista Previa de Tiempos Escalonados**

Mostrar claramente cómo se calcularán los tiempos finales:

```
Tiempo Base de Encendido: 06:00 UTC

Con los delays configurados:
- PgCluster + HDFSCluster: 06:00 (0m después)
- PgBouncer: 06:05 (5m después)
- Deployments: 06:07 (7m después)
```

### 6. **Validación en Tiempo Real**

Validar formato mientras el usuario escribe:

```typescript
<TextField
  value={delays.pgbouncerDelay || '5m'}
  onChange={(e) => {
    const validation = validateDelayFormat(e.target.value)
    if (validation.valid || e.target.value === '') {
      setDelays({ ...delays, pgbouncerDelay: e.target.value })
    }
  }}
  error={delays.pgbouncerDelay ? !validateDelayFormat(delays.pgbouncerDelay).valid : false}
  helperText={
    delays.pgbouncerDelay && !validateDelayFormat(delays.pgbouncerDelay).valid
      ? validateDelayFormat(delays.pgbouncerDelay).error
      : `Se encenderá a las ${calculateWakeTime(baseWakeTime, delays.pgbouncerDelay || '5m')}`
  }
/>
```

## 📋 Ajustes Específicos Necesarios

### Frontend Actual (ScheduleEditor.tsx)

**Cambios necesarios:**

1. **Renombrar campos de delays**:
   ```typescript
   // ANTES
   delays: {
     suspendDeployments: '5m',
     suspendStatefulSets: '7m',
     suspendDeploymentsPgbouncer: '5m',
     suspendStatefulSetsPostgres: '0m',
     suspendStatefulSetsHdfs: '0m',
   }
   
   // DESPUÉS
   delays: {
     pgHdfsDelay: '0m',
     pgbouncerDelay: '5m',
     deploymentsDelay: '7m'
   }
   ```

2. **Mostrar delays solo cuando hay CRDs detectados**:
   ```typescript
   // En lugar de usar showDelays checkbox
   const hasCRDs = resources?.hasPgCluster || resources?.hasHdfsCluster || resources?.hasPgBouncer
   
   {hasCRDs && (
     <DelaysConfiguration
       resources={resources}
       delays={delays}
       onDelaysChange={setDelays}
     />
   )}
   ```

3. **Cargar delays al editar**:
   ```typescript
   useEffect(() => {
     if (tenantName && existingSchedule && resources) {
       // Extraer delays de los SleepInfos wake existentes
       const baseWakeTime = convertTimezone(
         formData.on,
         formData.userTimezone,
         formData.clusterTimezone
       ).clusterTime
       
       const extractedDelays = extractDelaysFromSchedule(
         existingSchedule,
         baseWakeTime
       )
       
       setDelays(extractedDelays)
     }
   }, [tenantName, existingSchedule, resources])
   ```

### Backend Actual (schedule_service.go)

**Cambios necesarios:**

1. **Ajustar estructura de DelayConfig**:
   ```go
   type DelayConfig struct {
       // ANTES: Nombres confusos
       SuspendDeployments          string `json:"suspendDeployments,omitempty"`
       SuspendDeploymentsPgbouncer string `json:"suspendDeploymentsPgbouncer,omitempty"`
       
       // DESPUÉS: Nombres claros para encendido escalonado
       PgHdfsDelay      string `json:"pgHdfsDelay,omitempty" example:"0m"`      // Delay para PgCluster + HDFSCluster
       PgbouncerDelay   string `json:"pgbouncerDelay,omitempty" example:"5m"`    // Delay para PgBouncer
       DeploymentsDelay string `json:"deploymentsDelay,omitempty" example:"7m"`  // Delay para Deployments nativos
   }
   ```

2. **Ajustar lógica de cálculo de tiempos escalonados**:
   ```go
   // Calcular tiempos escalonados según delays configurados
   onPgHDFS := onConv.TimeUTC  // Base (t0)
   onPgBouncer := onConv.TimeUTC
   onDeployments := onConv.TimeUTC
   
   if req.Delays != nil {
       // Parsear delays para encendido escalonado
       if req.Delays.PgHdfsDelay != "" {
           pgHdfsDelayMinutes, _ := parseDelayToMinutes(req.Delays.PgHdfsDelay)
           onPgHDFS, _ = AddMinutes(onConv.TimeUTC, pgHdfsDelayMinutes)
       } else {
           // Default: 0m (mismo tiempo que base)
           onPgHDFS = onConv.TimeUTC
       }
       
       if req.Delays.PgbouncerDelay != "" {
           pgbouncerDelayMinutes, _ := parseDelayToMinutes(req.Delays.PgbouncerDelay)
           onPgBouncer, _ = AddMinutes(onConv.TimeUTC, pgbouncerDelayMinutes)
       } else {
           // Default: 5m después del tiempo base
           onPgBouncer, _ = AddMinutes(onConv.TimeUTC, 5)
       }
       
       if req.Delays.DeploymentsDelay != "" {
           deploymentsDelayMinutes, _ := parseDelayToMinutes(req.Delays.DeploymentsDelay)
           onDeployments, _ = AddMinutes(onConv.TimeUTC, deploymentsDelayMinutes)
       } else {
           // Default: 7m después del tiempo base
           onDeployments, _ = AddMinutes(onConv.TimeUTC, 7)
       }
   } else {
       // Valores por defecto (igual que el script Python)
       onPgHDFS = onConv.TimeUTC                    // t0
       onPgBouncer, _ = AddMinutes(onConv.TimeUTC, 5)  // t0+5m
       onDeployments, _ = AddMinutes(onConv.TimeUTC, 7) // t0+7m
   }
   ```

## 🎯 Flujo de Usuario con Delays Configurables

1. Usuario entra a crear/editar schedule de un namespace
2. Sistema detecta recursos CRDs automáticamente
3. **Si hay CRDs detectados**: Se muestra automáticamente la sección de delays
4. Usuario configura delays según sus necesidades:
   - Puede usar valores por defecto (0m, 5m, 7m)
   - Puede personalizar cada delay
   - Ve vista previa de tiempos escalonados en tiempo real
5. Al guardar, los delays se incluyen en el request
6. Backend usa los delays para calcular tiempos escalonados
7. Se generan SleepInfos con los tiempos calculados
8. Al editar después, los delays se cargan automáticamente desde los SleepInfos existentes

## 📝 Cambios en Types TypeScript

```typescript
// types/index.ts

// ANTES (confuso)
export interface DelayConfig {
  suspendDeployments?: string
  suspendStatefulSets?: string
  suspendDeploymentsPgbouncer?: string
  suspendStatefulSetsPostgres?: string
  suspendStatefulSetsHdfs?: string
}

// DESPUÉS (claro)
export interface WakeDelayConfig {
  // Delays para encendido escalonado (tiempo DESPUÉS del tiempo base de encendido)
  pgHdfsDelay?: string      // Delay para PgCluster + HDFSCluster (default: "0m")
  pgbouncerDelay?: string   // Delay para PgBouncer (default: "5m")
  deploymentsDelay?: string // Delay para Deployments nativos (default: "7m")
}

// Actualizar CreateScheduleRequest
export interface NamespaceScheduleRequest {
  tenant: string
  namespace: string
  userTimezone: string
  clusterTimezone: string
  off: string
  on: string
  weekdaysSleep: string
  weekdaysWake: string
  delays?: WakeDelayConfig  // ✅ Cambiar de DelayConfig a WakeDelayConfig
  exclusions?: Exclusion[]
}
```

## 🔄 Migración desde Sistema Actual

Para mantener compatibilidad durante la migración:

1. El backend debe aceptar ambos formatos de delays (antiguo y nuevo)
2. Convertir automáticamente el formato antiguo al nuevo si es necesario
3. El frontend puede migrar gradualmente al nuevo formato

```go
// Función helper para convertir delays antiguos a nuevos
func convertLegacyDelays(oldDelays *DelayConfig) *WakeDelayConfig {
    if oldDelays == nil {
        return nil
    }
    
    newDelays := &WakeDelayConfig{}
    
    // Mapear delays antiguos a nuevos
    if oldDelays.SuspendDeploymentsPgbouncer != "" {
        newDelays.PgbouncerDelay = oldDelays.SuspendDeploymentsPgbouncer
    }
    
    if oldDelays.SuspendDeployments != "" {
        newDelays.DeploymentsDelay = oldDelays.SuspendDeployments
    }
    
    // Para PgHdfsDelay, usar el menor de los dos delays de Postgres/HDFS
    // o determinar basándose en los SleepInfos existentes
    
    return newDelays
}
```

