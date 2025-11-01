# Resumen Ejecutivo: Restructuración de kube-green

## 🎯 Objetivo Principal

**Unificar la gestión de recursos** para que kube-green maneje todo de forma nativa (`suspendDeployments`, `suspendStatefulSets`), pero detectando automáticamente cuando un Deployment/StatefulSet es generado por un CRD y aplicando el patch al CRD padre en lugar del recurso hijo.

---

## 🔄 Cambio Fundamental

### ANTES (Separado)
- **Recursos nativos**: SleepInfo con `suspendDeployments=True`
- **CRDs (PgBouncer/PgCluster/HDFS)**: SleepInfo con `patches` explícitos
- **Configuración**: Dos estrategias diferentes

### DESPUÉS (Unificado)
- **Todo**: SleepInfo con `suspendDeployments=True`, `suspendStatefulSets=True`
- **kube-green detecta automáticamente**: ¿Es CRD o recurso nativo?
- **Aplica patch según corresponda**: CRD → `spec.instances`, Nativo → `spec.replicas`

---

## 🏗️ Arquitectura Simplificada

```
┌─────────────────────────────────────────────────────────┐
│  SleepInfo                                              │
│  suspendDeployments: true                               │
│  suspendStatefulSets: true                              │
└─────────────────────────────────────────────────────────┘
                    │
                    ▼
         ┌──────────────────┐
         │ Listar Recursos  │
         └──────────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │ ¿Es generado por CRD?         │
    │ (Detectar por labels)         │
    └───────────────────────────────┘
           │              │
      ┌────┴────┐     ┌────┴────┐
      │   SÍ    │     │   NO    │
      └────┬────┘     └────┬────┘
           │               │
      ┌────▼─────┐     ┌────▼─────┐
      │ Patch CRD│     │ Patch    │
      │ instances│     │ replicas │
      └──────────┘     └──────────┘
```

---

## 📋 Implementación por Fases

### **Fase 1: Detección** (Nuevo módulo `crddetector`)
- Función: `DetectCRDParent(deployment/statefulset) → CRD Info`
- Método: Verificar labels específicos de cada CRD
- Fallback: Verificar `ownerReferences` si no hay labels

### **Fase 2: Patch Inteligente**
- Función: `applyCRDPatch(ctx, crdInfo, targetInstances)`
- Para CRDs: Patch `spec.instances` en el CRD
- Para nativos: Patch `spec.replicas` en el recurso (comportamiento actual)

### **Fase 3: Restore Patches**
- Almacenar restore patches con prefijo `crd:` para CRDs
- Almacenar restore patches con prefijo `deployment:`/`statefulset:` para nativos
- Wake: Buscar restore patch y aplicar según el tipo

### **Fase 4: Simplificación de tenant_power.py**
- **Eliminar**: `make_datastores_objs_staggered_split_days()` (patches explícitos)
- **Simplificar**: `make_datastores_native_deploys_split_days()` (solo suspendDeployments/suspendStatefulSets)
- **Eliminar**: `excludeRef` (ya no necesario, detección automática)

---

## 🔍 Detección de CRDs

### Labels a Verificar

| CRD | Label en Deployment/StatefulSet | Ejemplo |
|-----|--------------------------------|---------|
| **PgBouncer** | `pgbouncer.stratio.com/pgbouncer-name` | `pgbouncer-meta` |
| **PgCluster** | `pgcluster.stratio.com/cluster-name` o via ownerRef | `postgres-meta` |
| **HDFSCluster** | `hdfs.stratio.com/cluster-name` o via ownerRef | `hdfs` |

### Campos a Parchear

| CRD | Campo | Ejemplo |
|-----|-------|---------|
| **PgBouncer** | `spec.instances` | `0` (sleep) → `2` (wake) |
| **PgCluster** | `spec.instances` (verificar) | `0` (sleep) → `1` (wake) |
| **HDFSCluster** | `spec.instances` (verificar) | `0` (sleep) → `3` (wake) |

---

## 💾 Restore Patches

### Estructura

```json
{
  "crd:pgbouncer-meta": "{\"spec\":{\"instances\":2}}",
  "crd:postgres-meta": "{\"spec\":{\"instances\":1}}",
  "deployment:my-app": "{\"spec\":{\"replicas\":3}}",
  "statefulset:my-db": "{\"spec\":{\"replicas\":3}}"
}
```

### Comportamiento

- **Sleep**: Guardar valor actual antes de cambiarlo a 0
- **Wake**: Restaurar valor guardado, o usar valor actual si no hay restore patch

---

## ✅ Ventajas

1. **Unificación**: Un solo mecanismo para todos los recursos
2. **Automático**: Detección transparente de CRDs
3. **Mantenible**: Menos código de configuración
4. **Robusto**: Restore patches garantizan restauración correcta
5. **Escalable**: Fácil agregar nuevos CRDs en el futuro

---

## ⚠️ Preguntas a Resolver

1. ¿`PgCluster` usa `spec.instances` o `spec.replicas`?
2. ¿`HDFSCluster` usa `spec.instances` o `spec.replicas`?
3. ¿Qué labels exactos tienen los StatefulSets de PgCluster/HDFSCluster?
4. ¿Prefieres labels o ownerReferences para la detección?

---

## 📊 Comparación: Configuración

### ANTES
```yaml
# 3 SleepInfos diferentes:
- sleep-pgbouncer-* (patches)
- sleep-pgcluster-* (patches)
- sleep-hdfs-* (patches)
- ds-deploys-* (suspendDeployments)
```

### DESPUÉS
```yaml
# 1 SleepInfo único:
- ds-deploys-* (suspendDeployments + suspendStatefulSets)
  # kube-green detecta automáticamente y aplica patches al CRD
```

---

## 🚀 Siguiente Paso

**Validar las preguntas** y luego proceder con la implementación.


