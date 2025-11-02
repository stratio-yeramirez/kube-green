# Historial de Versiones - kube-green (Fork Personalizado)

Este documento mantiene el registro de versiones y cambios de este fork personalizado de kube-green.

---

## [0.7.8] - 2025-01-19

### 🐛 Correcciones Críticas

- **Corrección del cálculo de DayShift en conversión de timezone**:
  - **Problema**: Cuando una hora local (ej: sábado 20:58 Colombia) cruzaba el límite de día en UTC (domingo 01:58 UTC), el campo `weekdays` no se ajustaba correctamente, manteniendo el día original (sábado "6") en lugar del día UTC (domingo "0")
  - **Causa**: El cálculo del `DayShift` usando `utcDate.Sub(localDate).Hours() / 24` no era confiable cuando las fechas estaban en diferentes zonas horarias
  - **Solución**: Reimplementación del cálculo de `DayShift` usando `YearDay()` para comparar directamente los días calendario:
    - Cuando local y UTC están en el mismo año: diferencia directa de `YearDay()`
    - Cuando están en años diferentes (cerca de año nuevo): cálculo usando timestamps Unix
  - **Resultado**: El `DayShift` ahora se calcula correctamente para cualquier día de la semana y cualquier hora que cruce el límite de día
  - Archivo modificado: `internal/api/v1/timezone.go`

### ✅ Resultado

- **La conversión de timezone ahora funciona correctamente para todos los días de la semana**
- Horas que cruzan el límite de día (ej: 19:00-23:59 Colombia) ahora ajustan correctamente el `weekdays` en UTC
- Horas que no cruzan el límite (ej: 00:00-18:59 Colombia) mantienen el mismo día, como se espera
- La función `ShiftWeekdaysStr` ya funcionaba correctamente; el problema estaba en el cálculo inicial del `DayShift`

### 📦 Imagen Docker

- **Repositorio**: `yeramirez/kube-green:0.7.8-rest-api`
- **Digest**: `sha256:ce930b42ff4b79579ea812da0baeca4d7c1e1417c2314539b5e8f56ddb781e5a`
- **Fecha de publicación**: 2025-01-19

---

## [0.7.6] - 2025-11-01

### ✨ Nuevas Funcionalidades

- **Filtro por namespace en todos los endpoints REST API**:
  - **GET** `/api/v1/schedules/{tenant}`: Parámetro opcional `namespace` para filtrar por namespace específico
  - **PUT** `/api/v1/schedules/{tenant}`: Parámetro opcional `namespace` para actualizar solo un namespace específico
  - **DELETE** `/api/v1/schedules/{tenant}`: Parámetro opcional `namespace` para eliminar solo un namespace específico
  - Si `namespace` está vacío o no se proporciona: opera sobre todos los namespaces del tenant
  - Si `namespace` se proporciona (datastores, apps, rocket, intelligence, airflowsso): opera solo sobre ese namespace
  - Archivos modificados: `internal/api/v1/handlers.go`, `internal/api/v1/schedule_service.go`

- **Estructura de respuesta mejorada para GET schedules**:
  - Nueva estructura `NamespaceInfo` con campos `schedule` (cronológicamente ordenado) y `summary` (resumen legible)
  - Cada entrada del schedule incluye: `role` (sleep/wake), `operation` (descripción legible), `time`, `resources` (lista de recursos gestionados)
  - Resumen ejecutivo con `sleepTime`, `wakeTime`, `operations` (lista de operaciones), `description` (descripción completa)
  - Archivos modificados: `internal/api/v1/schedule_service.go`

### 🔧 Mejoras

- **Swagger UI mejorado**:
  - Campos `tenant` y `namespace` ahora son campos de texto libre (sin dropdowns/Enums)
  - Permite escribir cualquier tenant o namespace sin restricciones
  - Descripciones mejoradas que explican el comportamiento con/sin namespace
  - Archivos modificados: `internal/api/v1/handlers.go`, `internal/api/v1/doc.go`

- **Validación de namespace**:
  - Validación en backend para namespaces válidos cuando se proporciona el parámetro
  - Mensajes de error claros indicando valores válidos
  - Archivos: `internal/api/v1/handlers.go`, `internal/api/v1/schedule_service.go`

### ✅ Resultado

- API REST más flexible: permite operar sobre todo el tenant o namespace específico
- Respuestas más legibles con estructura mejorada y resúmenes ejecutivos
- Swagger UI más intuitivo con campos de texto libre
- Soporte completo para operaciones por tenant y por tenant+namespace en GET, PUT, DELETE

### 📦 Imagen Docker

- **Repositorio**: `yeramirez/kube-green:0.7.6-rest-api`
- **Digest**: `sha256:ce930b42ff4b79579ea812da0baeca4d7c1e1417c2314539b5e8f56ddb781e5a`
- **Fecha de publicación**: 2025-11-01

---

## [0.7.5] - 2025-11-01

### 🐛 Correcciones Críticas

- **Postgres y HDFS no encendían durante WAKE**:
  - **Problema**: El sistema detectaba "resource modified between sleep and wake up" y bloqueaba el encendido de PgCluster y HDFSCluster
  - **Causa**: La verificación de `IsResourceChanged` comparaba el estado actual (`shutdown=true` después de SLEEP) con el restore patch (`shutdown=null`), detectando diferencia y bloqueando la operación
  - **Solución**: Reorganización de la lógica en `WakeUp()` para aplicar patches dinámicos de PgCluster y HDFSCluster **ANTES** de verificar restore patches
  - Los patches dinámicos (`shutdown=false`) ahora se aplican directamente sin verificación de restore patch para estos CRDs
  - Archivo modificado: `internal/controller/sleepinfo/jsonpatch/jsonpatch.go`
  
- **Priorización de aplicación de patches**:
  - Para PgCluster y HDFSCluster, los patches de WAKE se aplican con máxima prioridad, antes de cualquier verificación de restore patch
  - Esto garantiza que `shutdown=false` se aplique siempre, permitiendo que el operador restaure los servicios
  - La verificación de restore patch solo se aplica a recursos nativos (Deployments, StatefulSets) y PgBouncer

### ✅ Resultado

- **Postgres y HDFS ahora se encienden correctamente durante WAKE**
- Los patches dinámicos se aplican siempre para PgCluster y HDFSCluster, sin importar el estado del restore patch
- PgBouncer y deployments nativos siguen funcionando correctamente (usan restore patches con verificación)
- Corrección de linting: eliminada redeclaración de variable `resourceKind`

### 📦 Imagen Docker

- **Repositorio**: `yeramirez/kube-green:0.7.5`
- **Digest**: `sha256:25f904decb2b7c9a5ed0d7bc12d5ea28955164d2f6e8837fb11182a2835a4bac`
- **Fecha de publicación**: 2025-11-01

---

## [0.7.4] - 2025-10-31

### ✨ Nuevas Funcionalidades

- **Encendido Escalonado para CRDs**:
  - Modificado `tenant_power.py` para crear SleepInfos separados por tipo de recurso con horarios escalonados
  - SleepInfo único para SLEEP que guarda restore patches de todos los recursos
  - SleepInfos separados para WAKE: PgCluster+HDFS primero, luego PgBouncer, finalmente Deployments
  - Todos los SleepInfos comparten `pair-id` para compartir restore patches
  - Archivo: `tenant_power.py`

### 🐛 Correcciones

- **Mejora en aplicación de patches durante WAKE**:
  - Agregada lógica de fallback: si `replace` falla (anotación no existe), intenta con `add`
  - Si `add` falla (anotación ya existe), intenta con `replace`
  - Garantiza que los patches se apliquen correctamente incluso si el estado del recurso cambió
  - Archivo: `internal/controller/sleepinfo/jsonpatch/jsonpatch.go`

- **Logging mejorado**:
  - Agregados logs a nivel Info para debugging de CRDs
  - Logs muestran cuando se agregan patches de PgCluster y HDFSCluster durante SLEEP/WAKE
  - Logs muestran cuando se encuentran recursos para cada patch target
  - Archivos: `sleepinfo_controller.go`, `jsonpatch/jsonpatch.go`

### ✅ Resultado

- Encendido escalonado funciona correctamente (PgCluster+HDFS → PgBouncer → Deployments)
- PgCluster y HDFSCluster se encienden correctamente durante WAKE usando restore patches o patches definidos
- Manejo robusto de errores de patches (fallback add/replace)
- Mejor debugging con logs informativos

### 📦 Imagen Docker

- **Repositorio**: `yeramirez/kube-green:0.7.4`
- **Digest**: `sha256:b58415d00ebada281cf0690fc79df8f8211b3f12d4d0917ba442a7cb37f091fd`
- **Fecha de publicación**: 2025-10-31

---

## [0.7.3] - 2025-10-31

### 🐛 Correcciones

- **CRDs no se encendían durante WAKE**: 
  - Modificado `jsonpatch.go` para NO saltar CRDs (PgBouncer, PgCluster, HDFSCluster) aunque tengan `ownerReferences`
  - Aplicado tanto en `Sleep()` como en `WakeUp()`
  - Archivo: `internal/controller/sleepinfo/jsonpatch/jsonpatch.go`

- **Patches de WAKE para PgCluster y HDFSCluster**:
  - Cambiado de `op: add` a `op: replace` en los patches de WAKE
  - La anotación `shutdown` ya existe después de SLEEP, por lo que `add` fallaba
  - Archivo: `api/v1alpha1/defaultpatches.go`
  - Afecta: `PgclusterWakePatch` y `HdfsclusterWakePatch`

### ✅ Resultado

- PgBouncer ya funcionaba correctamente (usa restore patches con `spec.instances`)
- PgCluster ahora se enciende correctamente durante WAKE
- HDFSCluster ahora se enciende correctamente durante WAKE

### 📦 Imagen Docker

- **Repositorio**: `yeramirez/kube-green:0.7.3`
- **Digest**: `sha256:27919d12c4eac121028b8b6fe78e6764a105d902c78d6ec80618ea07b0925bdd`
- **Fecha de publicación**: 2025-10-31

---

## [0.7.2] - Versión Base

### 📝 Notas

- Versión base basada en kube-green upstream v0.7.1
- Extensión para gestión nativa de CRDs (PgBouncer, PgCluster, HDFSCluster)

---

## Cambios Previos (No documentados en este formato)

Las versiones anteriores no llevaban un registro detallado. A partir de v0.7.3 se mantiene este historial.

---

## Formato de Versionado

- **Semantic Versioning**: `MAJOR.MINOR.PATCH`
- **MAJOR**: Cambios incompatibles en la API
- **MINOR**: Nuevas funcionalidades compatibles hacia atrás
- **PATCH**: Correcciones de bugs compatibles hacia atrás

---

## Convenciones del Changelog

- 🔧 **Cambios técnicos**: Modificaciones internas de código
- 🐛 **Correcciones**: Bug fixes
- ✨ **Nuevas características**: Nuevas funcionalidades
- 📚 **Documentación**: Cambios en documentación
- ⚠️ **Cambios rompedores**: Cambios que requieren acción del usuario
- 📦 **Despliegue**: Cambios relacionados con build/despliegue
- ✅ **Resultado**: Efecto esperado de los cambios

