# Extensiones para kube-green

## Resumen

Se ha agregado una extensión principal al código de kube-green para resolver el problema de restore patches cuando se usan SleepInfos separados:

### 1. Búsqueda de restore patches en SleepInfos relacionados (`sleepinfodata_extended.go`)

**Problema resuelto:** Cuando tienes SleepInfos separados (`sleep-*` y `wake-*`) con weekdays diferentes, el restore patch se guarda en el secret del SleepInfo de "sleep", pero el de "wake" no lo encuentra.

**Solución:** La función `getRelatedRestorePatches()` busca restore patches en SleepInfos relacionados mediante anotaciones:
- `kube-green.stratio.com/pair-id`: Identificador común que relaciona sleep y wake
- `kube-green.stratio.com/pair-role`: Rol del SleepInfo (`sleep` o `wake`)

**Uso:** Cuando un SleepInfo con `pair-role=wake` se ejecuta, automáticamente busca restore patches del SleepInfo relacionado con `pair-role=sleep` y el mismo `pair-id`.

**Archivo modificado:** `sleepinfo_controller.go` - Línea 122-140

**Comportamiento importante:** Si un recurso ya estaba apagado (réplicas=0) antes de que kube-green lo gestionara, NO se restaurará automáticamente cuando llegue la hora de "wake". Esto es el comportamiento esperado: kube-green solo restaura recursos que él mismo apagó.

## Archivos modificados

1. **`internal/controller/sleepinfo/sleepinfodata_extended.go`** (NUEVO)
   - Función `getRelatedRestorePatches()` para buscar restore patches relacionados

2. **`internal/controller/sleepinfo/sleepinfo_controller.go`** (MODIFICADO)
   - Líneas 122-140: Lógica para buscar y combinar restore patches relacionados cuando es WAKE_UP

3. **`internal/controller/sleepinfo/jsonpatch/jsonpatch.go`** (MODIFICADO)
   - Líneas 190-199: Mantiene el comportamiento original: si no hay restore patch, se omite el recurso (no se intenta restaurar)

## Cómo compilar y probar

```bash
cd /home/yeramirez/Documentos/Pichincha/scripts/kube-green/kube-green

# Compilar
make build

# Ejecutar tests
make test

# Generar imagen Docker
make docker-build
```

## Notas importantes

1. **Anotaciones requeridas:** Para que funcione la búsqueda de restore patches relacionados, los SleepInfos deben tener las anotaciones `pair-id` y `pair-role` que ya está generando tu script `tenant_power.py`.

2. **Recursos ya apagados:** Si un deployment/statefulset ya estaba apagado (réplicas=0) antes de aplicar SleepInfo, kube-green NO lo encenderá cuando llegue la hora de "wake". Esto es el comportamiento esperado: kube-green solo restaura recursos que él mismo apagó durante una operación SLEEP.

3. **Apagado por patch vs nativo:**
   - **PgCluster, PgBouncer, HDFSCluster**: Se apagan mediante patches (anotaciones) gestionados por sus respectivos operadores
   - **Deployments, StatefulSets, CronJobs nativos**: Se apagan mediante patches JSON de kube-green (réplicas=0)

## Testing

Para probar las extensiones:

1. Crea SleepInfos relacionados con `pair-id` y `pair-role` (sleep/wake)
2. Asegúrate de que el `sleep-*` se ejecute primero y guarde restore patches
3. Cuando el `wake-*` se ejecute, verifica en los logs que encuentre los restore patches del `sleep-*` relacionado
4. Verifica que los recursos se restauren correctamente

