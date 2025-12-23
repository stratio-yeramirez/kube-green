# Análisis Completo de Casos de Uso del Script Python

## 📋 Casos de Uso Completo del Script `tenant_power.py`

Después de analizar el script completo, estos son TODOS los casos de uso que deben ser soportados dinámicamente:

---

## ✅ Casos de Uso CRÍTICOS que DEBEN estar en el Plan

### 1. **Weekdays Iguales vs Diferentes**

**Caso A: Weekdays Iguales (sleep y wake en mismos días)**
- Genera SleepInfo ÚNICO con `sleepAt` y `wakeUpAt`
- Más eficiente y restaura correctamente
- Ejemplo: Apagar y encender el mismo sábado

**Caso B: Weekdays Diferentes (sleep y wake en días distintos)**
- Genera SleepInfos SEPARADOS (sleep y wake)
- Usa anotaciones `pair-id` y `pair-role` para relacionarlos
- Ejemplo: Apagar viernes, encender lunes
- **CRÍTICO**: La misma `excludeRef` debe estar en ambos para que kube-green encuentre los restore patches

### 2. **Timezone Shift y Day Shift**

**Problema**: Al convertir hora local a UTC puede cambiar el día:
- Ejemplo: 22:00 COT (Colombia) → 03:00 UTC (día siguiente) → day_shift = +1
- Los weekdays deben ajustarse según el day_shift

**Solución**:
- Calcular `day_shift` para `off` y `on` por separado
- Aplicar `_shift_weekdays_str()` a los weekdays según el shift correspondiente
- Si `off` tiene shift +1, los weekdays de sleep se desplazan
- Si `on` tiene shift +1, los weekdays de wake se desplazan

### 3. **Lógica Especial de `airflowsso`**

El script tiene lógica especial para `airflowsso` que DEBE replicarse dinámicamente:

```python
# Airflowsso puede tener PgCluster
suspend_statefulsets=True                    # Suspende StatefulSets nativos
suspend_statefulsets_postgres=True           # Gestiona PgCluster por campo nativo
extra_exclude_labels=get_exclude_pg_hdfs_refs()  # Excluye recursos de operadores
```

**IMPORTANTE**: Esta lógica debe aplicarse SOLO si se detecta PgCluster en `airflowsso`, no por el nombre del namespace.

### 4. **Lógica Especial de `apps`**

```python
# apps: excluir Virtualizer automáticamente
if ns_suffix == "apps":
    exclude_ref.append({
        "matchLabels": {
            "cct.stratio.com/application_id": f"virtualizer.{ns}"
        }
    })
```

**IMPORTANTE**: Esta exclusión debe aplicarse SOLO si se detecta Virtualizer en `apps`, no por el nombre del namespace.

### 5. **Delays Configurables**

El script actualmente usa delays hardcodeados:
- `on_pg_hdfs = on_utc` (t0)
- `on_pgbouncer = add_minutes_hhmm(on_utc, 5)` (t0+5m)
- `on_deployments = add_minutes_hhmm(on_utc, 7)` (t0+7m)

**PERO**: El frontend permite configurar delays personalizados. El backend debe:
- Aceptar delays configurables en el request
- Usar los delays proporcionados o defaults si no se especifican
- Calcular tiempos escalonados según los delays

### 6. **Patches Adicionales**

El script permite inyectar `extra_sleep_patches` y `extra_wake_patches`:
- Actualmente no se usan en el código principal
- Pero la función `make_ns_split_days` los soporta
- Debe estar en el plan para futuras extensiones

### 7. **Namespaces con CRDs - Lógica Dinámica Completa**

**Escenario 1: Namespace con TODOS los CRDs (datastores típico)**
- PgCluster + HDFSCluster + PgBouncer presentes
- SleepInfo SLEEP: apaga todo (deployments, statefulsets, cronjobs, pgbouncer, postgres, hdfs)
- WakeInfo 1: PgCluster + HDFSCluster (t0)
- WakeInfo 2: PgBouncer (t0+5m)
- WakeInfo 3: Deployments nativos (t0+7m, también restaura PgBouncer)

**Escenario 2: Namespace con solo PgCluster (airflowsso típico)**
- Solo PgCluster presente
- SleepInfo SLEEP: apaga deployments + statefulsets + cronjobs + postgres
- WakeInfo 1: PgCluster (t0)
- WakeInfo 2: Deployments nativos (t0+7m)
- **NO** genera WakeInfo para PgBouncer ni HDFS porque no están presentes

**Escenario 3: Namespace con solo PgBouncer**
- Solo PgBouncer presente
- SleepInfo SLEEP: apaga deployments + pgbouncer
- WakeInfo 1: PgBouncer (t0+5m)
- WakeInfo 2: Deployments nativos (t0+7m, también restaura PgBouncer)

**Escenario 4: Namespace con solo HDFSCluster**
- Solo HDFSCluster presente
- SleepInfo SLEEP: apaga deployments + statefulsets + cronjobs + hdfs
- WakeInfo 1: HDFSCluster (t0)
- WakeInfo 2: Deployments nativos (t0+7m)

**Escenario 5: Namespace con PgCluster + PgBouncer (sin HDFS)**
- PgCluster + PgBouncer presentes
- SleepInfo SLEEP: apaga todo (deployments, statefulsets, cronjobs, pgbouncer, postgres)
- WakeInfo 1: PgCluster (t0)
- WakeInfo 2: PgBouncer (t0+5m)
- WakeInfo 3: Deployments nativos (t0+7m, también restaura PgBouncer)

**Escenario 6: Namespace con HDFSCluster + PgBouncer (sin Postgres)**
- HDFSCluster + PgBouncer presentes
- SleepInfo SLEEP: apaga todo (deployments, statefulsets, cronjobs, pgbouncer, hdfs)
- WakeInfo 1: HDFSCluster (t0)
- WakeInfo 2: PgBouncer (t0+5m)
- WakeInfo 3: Deployments nativos (t0+7m, también restaura PgBouncer)

### 8. **Namespaces SIN CRDs**

**Escenario: Namespace sin CRDs (apps, rocket, intelligence típicos)**
- No hay CRDs detectados
- Si weekdays iguales: SleepInfo único con sleepAt y wakeUpAt
- Si weekdays diferentes: SleepInfos separados sleep/wake
- Exclusiones: Solo si se detectan (ej: Virtualizer en apps)

### 9. **Exclusiones Dinámicas**

Las exclusiones deben aplicarse SOLO si se detectan los recursos correspondientes:

**Exclusiones de Postgres** (solo si `hasPgCluster`):
- `{"matchLabels": {"app.kubernetes.io/managed-by": "postgres-operator"}}`
- `{"matchLabels": {"postgres.stratio.com/cluster": "true"}}`
- `{"matchLabels": {"app.kubernetes.io/part-of": "postgres"}}`

**Exclusiones de HDFS** (solo si `hasHdfsCluster`):
- `{"matchLabels": {"app.kubernetes.io/managed-by": "hdfs-operator"}}`
- `{"matchLabels": {"hdfs.stratio.com/cluster": "true"}}`
- `{"matchLabels": {"app.kubernetes.io/part-of": "hdfs"}}`

**Exclusión de Virtualizer** (solo si se detecta en apps):
- `{"matchLabels": {"cct.stratio.com/application_id": "virtualizer.{tenant}-apps"}}`

### 10. **Nombres de SleepInfos**

Los nombres siguen patrones específicos que deben replicarse:

**Para namespaces con CRDs (lógica escalonada):**
- Sleep: `sleep-{namespace}-{tenant}` o `sleep-ds-deploys-{tenant}` (datastores)
- Wake PgCluster+HDFS: `wake-{namespace}-{tenant}-pg-hdfs` o `wake-ds-deploys-{tenant}-pg-hdfs`
- Wake PgBouncer: `wake-{namespace}-{tenant}-pgbouncer` o `wake-ds-deploys-{tenant}-pgbouncer`
- Wake Deployments: `wake-{namespace}-{tenant}` o `wake-ds-deploys-{tenant}`

**Para namespaces sin CRDs:**
- Weekdays iguales: `{tenant}-{suffix}`
- Weekdays diferentes: `sleep-{tenant}-{suffix}` y `wake-{tenant}-{suffix}`

### 11. **Pair-ID y Pair-Role Annotations**

Cuando weekdays son diferentes, se usan anotaciones compartidas:
- `pair-id`: `{tenant}-{suffix}` (identificador compartido)
- `pair-role`: `"sleep"` o `"wake"` (rol del SleepInfo)

**CRÍTICO**: Estos ayudan a kube-green a relacionar sleep/wake y encontrar restore patches compartidos.

### 12. **SuspendStatefulSets en el Wake Final**

En el WakeInfo final de deployments (t0+7m), cuando hay CRDs:
- `suspendDeploymentsPgbouncer=True` debe estar presente SI hay PgBouncer
- Esto permite que kube-green busque y restaure PgBouncer durante el wake
- Los otros campos de CRDs (Postgres, HDFS) deben ser False

### 13. **StatefulSets Nativos**

La gestión de StatefulSets nativos depende del contexto:
- **Con CRDs**: Si hay PgCluster o HDFSCluster, los StatefulSets nativos se excluyen automáticamente (porque los CRDs generan StatefulSets)
- **Sin CRDs**: StatefulSets nativos se gestionan normalmente
- **airflowsso especial**: `suspend_statefulsets=True` incluso si hay CRDs (para gestionar StatefulSets nativos adicionales)

### 14. **Formato de Weekdays**

El script soporta múltiples formatos de entrada:
- Formato humano: `"lunes-viernes"`, `"viernes,sábado,domingo"`, `"sábado"`
- Formato numérico: `"1-5"`, `"6"`, `"0-6"`
- Rangos circulares: `"viernes-domingo"` → `5,6,0`
- Con acentos: `"miércoles"`, `"sábado"`

El backend debe soportar todos estos formatos.

---

## ⚠️ Casos Edge que NO están completamente cubiertos en el plan actual

### 1. **make_datastores_native_deploys_split_days siempre se llama para datastores**

El script actualmente siempre llama `make_datastores_native_deploys_split_days` para `datastores`, independientemente de si hay CRDs o no. Esto significa que:

- Si `datastores` NO tiene CRDs, igualmente genera la lógica escalonada (pero con campos False)
- Esto puede ser un bug o comportamiento intencional

**Decisión necesaria**: ¿Debemos generar lógica escalonada solo si se detectan CRDs, o siempre para datastores?

### 2. **Delays configurables no están en el request actual**

El plan actual menciona delays pero no los especifica claramente en el request. Debe agregarse:

```json
{
  "delays": {
    "pgHdfsDelay": "0m",      // Delay para PgCluster + HDFSCluster (default: 0m)
    "pgbouncerDelay": "5m",    // Delay para PgBouncer (default: 5m)
    "deploymentsDelay": "7m"   // Delay para Deployments nativos (default: 7m)
  }
}
```

### 3. **Patches adicionales no están en el plan**

El plan no menciona cómo manejar `extra_sleep_patches` y `extra_wake_patches`. Debe agregarse soporte para futuras extensiones.

### 4. **Validación de nombres de SleepInfos**

El plan no menciona validación de nombres de SleepInfos existentes antes de crear nuevos. Debe agregarse para evitar conflictos.

### 5. **Reconciliación de SleepInfos**

El script tiene función `reconcile_sleepinfos` que elimina SleepInfos no deseados. Esto debe estar en el plan para mantener el cluster limpio.

### 6. **Limpieza de Secrets huérfanos**

El script tiene función `cleanup_orphan_secrets` que elimina secrets sin SleepInfo asociado. Esto debe estar en el plan.

---

## 🔧 Ajustes Necesarios al Plan

1. **Agregar delays configurables al request**
2. **Especificar lógica de weekdays iguales vs diferentes más claramente**
3. **Agregar soporte para patches adicionales (futuro)**
4. **Agregar validación de nombres de SleepInfos**
5. **Agregar reconciliación y limpieza de recursos**
6. **Especificar comportamiento cuando datastores no tiene CRDs**
7. **Agregar todos los escenarios de combinaciones de CRDs**
8. **Mejorar documentación de timezone shift y day shift**

---

## ✅ Checklist de Cobertura de Casos de Uso

- [x] Weekdays iguales (SleepInfo único)
- [x] Weekdays diferentes (SleepInfos separados con pair-id)
- [x] Timezone shift y day shift
- [x] Namespace con todos los CRDs (PgCluster + HDFSCluster + PgBouncer)
- [x] Namespace con solo PgCluster
- [x] Namespace con solo HDFSCluster
- [x] Namespace con solo PgBouncer
- [x] Namespace con PgCluster + PgBouncer (sin HDFS)
- [x] Namespace con HDFSCluster + PgBouncer (sin Postgres)
- [x] Namespace sin CRDs
- [x] Exclusiones dinámicas según recursos detectados
- [x] Lógica especial de airflowsso (si tiene PgCluster)
- [x] Lógica especial de apps (si tiene Virtualizer)
- [ ] Delays configurables (necesita ajuste)
- [ ] Patches adicionales (necesita agregarse)
- [ ] Validación de nombres (necesita agregarse)
- [ ] Reconciliación (necesita agregarse)
- [ ] Limpieza de Secrets (necesita agregarse)
- [ ] Comportamiento cuando datastores no tiene CRDs (necesita decisión)

