#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, date, time, timedelta
try:
    from typing import List, Dict, Tuple
except ImportError:
    # Python 3.9+ has built-in generics
    from typing import List, Dict, Tuple
try:
    from zoneinfo import ZoneInfo
except ImportError:
    # Python < 3.9 compatibility
    try:
        from backports.zoneinfo import ZoneInfo
    except ImportError:
        # Fallback to pytz if backports not available
        import pytz
        ZoneInfo = pytz.timezone
        # Monkey patch for compatibility
        def _zoneinfo_get(self, key, default=None):
            return self
        ZoneInfo.__getitem__ = _zoneinfo_get

# ---------- Configurable defaults ----------
WEEKDAYS_DEFAULT = "0-6"            # todos los días (0=domingo .. 6=sábado)
TZ_LOCAL = "America/Bogota"         # entrada del usuario (Colombia)
TZ_UTC = "UTC"

# PgBouncer ON replicas (solo si usaras /spec/instances; ahora se usa anotación ON/OFF)
PGBOUNCER_ON = 2

# Namespaces soportados por sufijo
VALID_SUFFIXES = ["datastores", "apps", "rocket", "intelligence", "airflowsso"]

# Recursos manejados por operadores que NO deben suspenderse (se controlan por anotación)
EXCLUDE_PG_HDFS_LABELS = [
    # Postgres / PgBouncer (postgres-operator)
    {"matchLabels": {"app.kubernetes.io/managed-by": "postgres-operator"}},
    {"matchLabels": {"postgres.stratio.com/cluster": "true"}},
    {"matchLabels": {"app.kubernetes.io/part-of": "postgres"}},
    # HDFS (ajusta si tus labels difieren)
    {"matchLabels": {"app.kubernetes.io/managed-by": "hdfs-operator"}},
    {"matchLabels": {"hdfs.stratio.com/cluster": "true"}},
    {"matchLabels": {"app.kubernetes.io/part-of": "hdfs"}},
]

def get_exclude_pg_hdfs_refs():
    """
    Retorna exclusiones por labels para recursos de operadores gestionados por patches.

    Estos recursos se gestionan SOLO por los SleepInfos de patches (sleep-pgbouncer, sleep-pgcluster, sleep-hdfs)
    y NO deben ser gestionados por suspendDeployments/suspendStatefulSets.

    NOTA: Los patches aplican dinámicamente a TODOS los recursos del tipo correspondiente (PgBouncer, PgCluster, HDFSCluster)
    sin importar el nombre, por lo que no necesitamos excluir por nombres específicos.

    Las labels dinámicas excluirán automáticamente todos los recursos gestionados por operadores,
    independientemente de cuántos se creen o eliminen.
    """
    return list(EXCLUDE_PG_HDFS_LABELS)

# ---------- Helpers de tiempo ----------
def add_minutes_hhmm(hhmm_utc: str, minutes: int) -> str:
    """Suma minutos a un HH:MM (UTC) y devuelve HH:MM (UTC)."""
    hh, mm = map(int, hhmm_utc.split(":"))
    today = date.today()
    dt = datetime.combine(today, time(hh, mm), tzinfo=ZoneInfo("UTC"))
    dt2 = dt + timedelta(minutes=minutes)
    return dt2.strftime("%H:%M")

def to_utc_hhmm(local_hhmm: str, tz_local: str = TZ_LOCAL) -> str:
    """Convierte 'HH:MM' local -> 'HH:MM' UTC (solo hora)."""
    hh, mm = map(int, local_hhmm.split(":"))
    today = date.today()
    dt_local = datetime.combine(today, time(hh, mm), tzinfo=ZoneInfo(tz_local))
    dt_utc = dt_local.astimezone(ZoneInfo(TZ_UTC))
    return dt_utc.strftime("%H:%M")

def to_utc_hhmm_and_dayshift(local_hhmm: str, tz_local: str = TZ_LOCAL):
    """
    Convierte 'HH:MM' local -> ('HH:MM' UTC, day_shift)
    day_shift ∈ {-1, 0, +1} indica si, al convertir, el día en UTC cambió
    respecto al día local (p.ej. 22:00 COT -> 03:00 UTC del día siguiente => +1).
    """
    hh, mm = map(int, local_hhmm.split(":"))
    today_local = date.today()
    dt_local = datetime.combine(today_local, time(hh, mm), tzinfo=ZoneInfo(tz_local))
    dt_utc = dt_local.astimezone(ZoneInfo(TZ_UTC))
    day_shift = (dt_utc.date() - dt_local.date()).days
    return dt_utc.strftime("%H:%M"), day_shift

def utc_hhmm_to_local(hhmm_utc: str, tz_local: str = TZ_LOCAL) -> str:
    """Convierte 'HH:MM' UTC -> 'HH:MM' en hora local (America/Bogota) solo para mostrar."""
    if not hhmm_utc:
        return ""
    hh, mm = map(int, hhmm_utc.split(":"))
    today = date.today()
    dt_utc = datetime.combine(today, time(hh, mm), tzinfo=ZoneInfo("UTC"))
    dt_loc = dt_utc.astimezone(ZoneInfo(tz_local))
    return dt_loc.strftime("%H:%M")

# ---------- Helpers de días (semana) ----------
DAYS_ES = {
    "domingo": 0, "lunes": 1, "martes": 2, "miercoles": 3, "miércoles": 3,
    "jueves": 4, "viernes": 5, "sabado": 6, "sábado": 6,
}
DAYS_NUM_TO_ES = {v: k for k, v in DAYS_ES.items()}

def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")

def human_weekdays_to_kube(s: str) -> str:
    """
    Convierte 'lunes-viernes', 'viernes,sábado,domingo', '0-6', etc. -> 'n[,n]...'
    kube-green espera números 0..6 (0=domingo). Soporta acentos y mayúsculas.
    """
    raw = (s or "").strip()
    if not raw:
        return "0-6"

    # Si ya está en formato numérico/rango, lo aceptamos tal cual
    if re.fullmatch(r"\s*\d(?:\s*[-,]\s*\d)*\s*", raw):
        return raw.replace(" ", "")

    # Normalizar: minúsculas, quitar espacios, quitar acentos
    txt = _strip_accents(raw.lower().replace(" ", ""))

    # Separar por comas (p.ej. 'lunes-viernes,sabado,domingo')
    parts = [p for p in txt.split(",") if p]

    nums = []
    for p in parts:
        if "-" in p:
            a, b = p.split("-", 1)
            if a not in DAYS_ES or b not in DAYS_ES:
                raise ValueError(f"Dia no reconocido en rango: '{p}'")
            start, end = DAYS_ES[a], DAYS_ES[b]
            # Rango circular si end < start (p.ej. viernes-domingo -> 5,6,0)
            if start <= end:
                nums.extend(range(start, end + 1))
            else:
                nums.extend(list(range(start, 7)) + list(range(0, end + 1)))
        else:
            if p not in DAYS_ES:
                raise ValueError(f"Dia no reconocido: '{p}'")
            nums.append(DAYS_ES[p])

    # Quitar duplicados preservando orden
    seen = set()
    ordered_unique = []
    for n in nums:
        if n not in seen:
            seen.add(n)
            ordered_unique.append(n)

    return ",".join(str(n) for n in ordered_unique)

def kube_weekdays_to_human(s: str) -> str:
    """
    '0-6' o '5,6,0' -> 'domingo-sábado' o 'viernes,sábado,domingo' (solo mostrar).
    """
    raw = (s or "").strip()
    if not raw:
        return "todos"

    # Expandir posibles rangos
    tokens = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if "-" in chunk:
            a, b = chunk.split("-", 1)
            a, b = int(a), int(b)
            if a <= b:
                tokens.extend(range(a, b + 1))
            else:
                tokens.extend(list(range(a, 7)) + list(range(0, b + 1)))
        else:
            tokens.append(int(chunk))

    # Quitar duplicados preservando orden
    seen = set()
    days = []
    for n in tokens:
        if n not in seen:
            seen.add(n)
            days.append(DAYS_NUM_TO_ES.get(n, str(n)))

    return ",".join(days)

def _expand_weekdays_str(raw: str) -> List[int]:
    """
    Convierte '0-6', '1,3,5', '5-1' (circular), etc. a lista [ints] 0..6.
    Si trae nombres (lunes, ...) se convierte primero con human_weekdays_to_kube.
    """
    if not raw:
        return list(range(7))
    s = raw.strip()
    if re.search(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]", s):
        s = human_weekdays_to_kube(s)

    tokens = []
    for chunk in s.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            a, b = chunk.split("-", 1)
            a, b = int(a), int(b)
            if a <= b:
                seq = list(range(a, b + 1))
            else:
                seq = list(range(a, 7)) + list(range(0, b + 1))
            tokens.extend(seq)
        else:
            tokens.append(int(chunk))

    seen = set()
    out = []
    for n in tokens:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out

def _shift_weekdays_str(raw: str, shift: int) -> str:
    """
    Aplica un desplazamiento de día a una especificación de weekdays (0..6).
    Devuelve 'n,n,n' (sin recomprimir a rangos).
    """
    shift = shift % 7
    lst = _expand_weekdays_str(raw)
    shifted = [ (n + shift) % 7 for n in lst ]
    seen = set()
    out = []
    for n in shifted:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return ",".join(str(n) for n in out)

# ---------- Plantillas ----------
def meta(name, namespace, annotations=None):
    """Crea metadata con opcionales annotations."""
    md = {"name": name, "namespace": namespace}
    if annotations:
        md["annotations"] = annotations
    return md

def sleepinfo_base(weekdays, sleepAtUTC, wakeUpAtUTC=None, tz="UTC",
                   suspendDeployments=False, suspendStatefulSets=False, suspendCronJobs=False,
                   suspendDeploymentsPgbouncer=False, suspendStatefulSetsPostgres=False, suspendStatefulSetsHdfs=False):
    """
    Crea spec base para SleepInfo.

    Args:
        wakeUpAtUTC: Si es None, no se incluye wakeUpAt (útil para SleepInfos separados que solo hacen sleep o wake)
        suspendDeploymentsPgbouncer: Si True, gestiona todos los PgBouncer CRDs por spec.instances
        suspendStatefulSetsPostgres: Si True, gestiona todos los PgCluster CRDs por anotación shutdown
        suspendStatefulSetsHdfs: Si True, gestiona todos los HDFSCluster CRDs por anotación shutdown
    """
    spec = {
        "weekdays": weekdays,
        "timeZone": tz,
        "sleepAt": sleepAtUTC,
        "suspendDeployments": suspendDeployments,
        "suspendStatefulSets": suspendStatefulSets,
        "suspendCronJobs": suspendCronJobs,
    }
    # Solo incluir wakeUpAt si se proporciona (y no es None)
    if wakeUpAtUTC is not None:
        spec["wakeUpAt"] = wakeUpAtUTC
    # EXTENSIÓN: Campos booleanos nativos para CRDs
    if suspendDeploymentsPgbouncer:
        spec["suspendDeploymentsPgbouncer"] = True
    if suspendStatefulSetsPostgres:
        spec["suspendStatefulSetsPostgres"] = True
    if suspendStatefulSetsHdfs:
        spec["suspendStatefulSetsHdfs"] = True
    return spec

def cr_yaml(kind, metadata, spec):
    return {
        "apiVersion": "kube-green.com/v1alpha1",
        "kind": "SleepInfo",
        "metadata": metadata,
        "spec": spec,
    }

def patch_block(group, kind, patch_yaml_str):
    return {
        "target": {"group": group, "kind": kind},
        "patch": patch_yaml_str
    }

# ---------- Generadores por namespace tipo ----------
# NOTA: Esta función ha sido eliminada porque ahora los CRDs se gestionan mediante campos booleanos nativos
# en make_datastores_native_deploys_split_days, usando suspendDeploymentsPgbouncer, suspendStatefulSetsPostgres,
# y suspendStatefulSetsHdfs. Los patches de anotaciones están hardcodeados en el controller de kube-green.

def make_datastores_native_deploys_split_days(tenant, off_utc, on_deployments_utc, on_pg_hdfs, on_pgbouncer,
                                              wd_sleep, wd_wake):
    """
    En <tenant>-datastores: gestiona TODOS los recursos (nativos Y CRDs) de forma unificada.

    GESTIÓN NATIVA (campos booleanos):
    - Deployments nativos → suspendDeployments=True
    - StatefulSets nativos → suspendStatefulSets=True
    - CronJobs → suspendCronJobs=True

    GESTIÓN NATIVA DE CRDs (nuevos campos booleanos):
    - PgBouncer (genera Deployments) → suspendDeploymentsPgbouncer=True
      * Gestiona spec.instances del CRD (igual que deployments nativos con spec.replicas)
    - PgCluster (genera StatefulSets) → suspendStatefulSetsPostgres=True
      * Gestiona anotación pgcluster.stratio.com/shutdown (hardcodeada en controller)
    - HDFSCluster (genera StatefulSets) → suspendStatefulSetsHdfs=True
      * Gestiona anotación hdfscluster.stratio.com/shutdown (hardcodeada en controller)

    IMPORTANTE: kube-green listará TODOS los CRDs del tipo en el namespace dinámicamente,
    sin importar nombres o labels. Los patches de anotaciones están hardcodeados en el controller.

    ENCENDIDO ESCALONADO:
    - PgCluster + HDFSCluster primero (on_pg_hdfs) - necesarios para que otros servicios funcionen
    - PgBouncer después (on_pgbouncer) - depende de Postgres
    - Deployments nativos al final (on_deployments) - dependen de los anteriores

    Estrategia:
    - Si weekdays son iguales: crea SleepInfos separados por tipo con wakeUpAt escalonado
    - Si weekdays son diferentes: crea SleepInfos separados sleep/wake con sleepAt escalonado
    """
    ns = f"{tenant}-datastores"
    objs = []
    base_name = f"ds-deploys-{tenant}"

    # Expandir weekdays para comparar
    wd_sleep_set = set(_expand_weekdays_str(wd_sleep))
    wd_wake_set = set(_expand_weekdays_str(wd_wake))

    exclude_refs = get_exclude_pg_hdfs_refs()

    # Si los weekdays son iguales, usar SleepInfo único para SLEEP y SleepInfos separados para WAKE escalonado
    # Esto garantiza que los restore patches se guarden correctamente y se compartan entre los WAKEs
    if wd_sleep_set == wd_wake_set:
        shared_id = f"{tenant}-datastores"

        # SleepInfo único para SLEEP: apaga TODOS los recursos y guarda restore patches
        shared_annotations_sleep = {
            "kube-green.stratio.com/pair-id": shared_id,
            "kube-green.stratio.com/pair-role": "sleep"
        }
        spec_sleep = sleepinfo_base(
            wd_sleep, off_utc, wakeUpAtUTC=None,
            suspendDeployments=True, suspendStatefulSets=True, suspendCronJobs=True,
            suspendDeploymentsPgbouncer=True, suspendStatefulSetsPostgres=True, suspendStatefulSetsHdfs=True
        )
        spec_sleep["excludeRef"] = exclude_refs
        objs.append(cr_yaml("SleepInfo", meta(f"sleep-{base_name}", ns, shared_annotations_sleep), spec_sleep))

        # WAKE escalonado: crear SleepInfos separados por tipo que comparten restore patches del SLEEP
        # 1. Wake PgCluster + HDFSCluster primero (on_pg_hdfs)
        shared_annotations_wake_pg_hdfs = {
            "kube-green.stratio.com/pair-id": shared_id,
            "kube-green.stratio.com/pair-role": "wake"
        }
        spec_wake_pg_hdfs = sleepinfo_base(
            wd_wake, on_pg_hdfs, wakeUpAtUTC=None,
            suspendDeployments=False, suspendStatefulSets=False, suspendCronJobs=False,
            suspendDeploymentsPgbouncer=False,
            suspendStatefulSetsPostgres=True, suspendStatefulSetsHdfs=True
        )
        spec_wake_pg_hdfs["excludeRef"] = exclude_refs
        objs.append(cr_yaml("SleepInfo", meta(f"wake-{base_name}-pg-hdfs", ns, shared_annotations_wake_pg_hdfs), spec_wake_pg_hdfs))

        # 2. Wake PgBouncer después (on_pgbouncer)
        shared_annotations_wake_pgbouncer = {
            "kube-green.stratio.com/pair-id": shared_id,
            "kube-green.stratio.com/pair-role": "wake"
        }
        spec_wake_pgbouncer = sleepinfo_base(
            wd_wake, on_pgbouncer, wakeUpAtUTC=None,
            suspendDeployments=False, suspendStatefulSets=False, suspendCronJobs=False,
            suspendDeploymentsPgbouncer=True,
            suspendStatefulSetsPostgres=False, suspendStatefulSetsHdfs=False
        )
        spec_wake_pgbouncer["excludeRef"] = exclude_refs
        objs.append(cr_yaml("SleepInfo", meta(f"wake-{base_name}-pgbouncer", ns, shared_annotations_wake_pgbouncer), spec_wake_pgbouncer))

        # 3. Wake Deployments nativos al final (on_deployments)
        shared_annotations_wake_native = {
            "kube-green.stratio.com/pair-id": shared_id,
            "kube-green.stratio.com/pair-role": "wake"
        }
        spec_wake_native = sleepinfo_base(
            wd_wake, on_deployments_utc, wakeUpAtUTC=None,
            suspendDeployments=True, suspendStatefulSets=True, suspendCronJobs=True,
            suspendDeploymentsPgbouncer=True,  # TRUE para que kube-green busque y restaure PgBouncer durante WAKE
            suspendStatefulSetsPostgres=False, suspendStatefulSetsHdfs=False
        )
        spec_wake_native["excludeRef"] = exclude_refs
        objs.append(cr_yaml("SleepInfo", meta(f"wake-{base_name}", ns, shared_annotations_wake_native), spec_wake_native))
    else:
        # Weekdays diferentes: usar SleepInfos separados sleep/wake con sleepAt escalonado
        shared_id = f"{tenant}-datastores"

        # Sleep: suspende TODOS los recursos y guarda restore patches
        shared_annotations_sleep = {
            "kube-green.stratio.com/pair-id": shared_id,
            "kube-green.stratio.com/pair-role": "sleep"
        }
        spec_sleep = sleepinfo_base(
            wd_sleep, off_utc, wakeUpAtUTC=None,
            suspendDeployments=True, suspendStatefulSets=True, suspendCronJobs=True,
            suspendDeploymentsPgbouncer=True, suspendStatefulSetsPostgres=True, suspendStatefulSetsHdfs=True
        )
        spec_sleep["excludeRef"] = exclude_refs
        objs.append(cr_yaml("SleepInfo", meta(f"sleep-{base_name}", ns, shared_annotations_sleep), spec_sleep))

        # Wake escalonado: crear SleepInfos separados por tipo con sleepAt escalonado
        # 1. Wake PgCluster + HDFSCluster primero (on_pg_hdfs)
        shared_annotations_wake_pg_hdfs = {
            "kube-green.stratio.com/pair-id": shared_id,
            "kube-green.stratio.com/pair-role": "wake"
        }
        spec_wake_pg_hdfs = sleepinfo_base(
            wd_wake, on_pg_hdfs, wakeUpAtUTC=None,
            suspendDeployments=False, suspendStatefulSets=False, suspendCronJobs=False,
            suspendDeploymentsPgbouncer=False,
            suspendStatefulSetsPostgres=True, suspendStatefulSetsHdfs=True
        )
        spec_wake_pg_hdfs["excludeRef"] = exclude_refs
        objs.append(cr_yaml("SleepInfo", meta(f"wake-{base_name}-pg-hdfs", ns, shared_annotations_wake_pg_hdfs), spec_wake_pg_hdfs))

        # 2. Wake PgBouncer después (on_pgbouncer)
        shared_annotations_wake_pgbouncer = {
            "kube-green.stratio.com/pair-id": shared_id,
            "kube-green.stratio.com/pair-role": "wake"
        }
        spec_wake_pgbouncer = sleepinfo_base(
            wd_wake, on_pgbouncer, wakeUpAtUTC=None,
            suspendDeployments=False, suspendStatefulSets=False, suspendCronJobs=False,
            suspendDeploymentsPgbouncer=True,
            suspendStatefulSetsPostgres=False, suspendStatefulSetsHdfs=False
        )
        spec_wake_pgbouncer["excludeRef"] = exclude_refs
        objs.append(cr_yaml("SleepInfo", meta(f"wake-{base_name}-pgbouncer", ns, shared_annotations_wake_pgbouncer), spec_wake_pgbouncer))

        # 3. Wake Deployments nativos al final (on_deployments)
        shared_annotations_wake_native = {
            "kube-green.stratio.com/pair-id": shared_id,
            "kube-green.stratio.com/pair-role": "wake"
        }
        spec_wake_native = sleepinfo_base(
            wd_wake, on_deployments_utc, wakeUpAtUTC=None,
            suspendDeployments=True, suspendStatefulSets=True, suspendCronJobs=True,
            suspendDeploymentsPgbouncer=True,  # TRUE para que kube-green busque y restaure PgBouncer durante WAKE
            suspendStatefulSetsPostgres=False, suspendStatefulSetsHdfs=False
        )
        spec_wake_native["excludeRef"] = exclude_refs
        objs.append(cr_yaml("SleepInfo", meta(f"wake-{base_name}", ns, shared_annotations_wake_native), spec_wake_native))

    return objs

def make_ns_split_days(tenant, ns_suffix, base_name,
                       off_utc, on_deployments_utc, wd_sleep, wd_wake,
                       suspend_statefulsets=False,
                       suspend_statefulsets_postgres=False,
                       extra_sleep_patches=None,
                       extra_wake_patches=None,
                       extra_exclude_labels=None):
    """
    Genera SleepInfos para cualquier namespace del tenant.

    Estrategia:
    - Si weekdays son iguales: usa UN único SleepInfo con sleepAt y wakeUpAt (restaura correctamente)
    - Si weekdays son diferentes: usa SleepInfos separados para permitir días distintos

      - Suspende Deployments (+ opcional StatefulSets) y CronJobs
      - Permite inyectar patches extra (p.ej. PgCluster por anotación)
      - Permite exclusiones por labels (p.ej. operator/virtualizer)
    """
    ns = f"{tenant}-{ns_suffix}"
    objs = []

    # Construye excludeRef
    exclude_ref = []
    if extra_exclude_labels:
        exclude_ref.extend(extra_exclude_labels)

    # apps: excluir Virtualizer
    if ns_suffix == "apps":
        exclude_ref.append({"matchLabels": {"cct.stratio.com/application_id": f"virtualizer.{ns}"}})

    # Combinar patches si existen
    all_patches = []
    if extra_sleep_patches:
        all_patches.extend(extra_sleep_patches)
    if extra_wake_patches:
        all_patches.extend(extra_wake_patches)

    # Expandir weekdays para comparar
    wd_sleep_set = set(_expand_weekdays_str(wd_sleep))
    wd_wake_set = set(_expand_weekdays_str(wd_wake))

    # Si los weekdays son iguales, usar un único SleepInfo (más eficiente y restaura correctamente)
    if wd_sleep_set == wd_wake_set:
        spec = sleepinfo_base(
            wd_sleep, off_utc, on_deployments_utc,
            suspendDeployments=True, suspendStatefulSets=suspend_statefulsets, suspendCronJobs=True,
            suspendStatefulSetsPostgres=suspend_statefulsets_postgres
        )
        if exclude_ref:
            spec["excludeRef"] = exclude_ref
        if all_patches:
            spec["patches"] = all_patches
        # Nombre del SleepInfo debe reflejar el namespace: {tenant}-{ns_suffix}
        objs.append(cr_yaml("SleepInfo", meta(f"{tenant}-{ns_suffix}", ns), spec))
    else:
        # Weekdays diferentes: usar SleepInfos separados con anotación compartida
        # para que kube-green pueda relacionarlos y encontrar los restore patches
        shared_id = f"{tenant}-{ns_suffix}"
        shared_annotations = {
            "kube-green.stratio.com/pair-id": shared_id,
            "kube-green.stratio.com/pair-role": "sleep"
        }

        # Sleep: suspende los recursos y guarda restore patches
        # No incluir wakeUpAt para el SleepInfo de "sleep" (solo hace sleep)
        spec = sleepinfo_base(
            wd_sleep, off_utc, wakeUpAtUTC=None,
            suspendDeployments=True, suspendStatefulSets=suspend_statefulsets, suspendCronJobs=True,
            suspendStatefulSetsPostgres=suspend_statefulsets_postgres
        )
        if exclude_ref:
            spec["excludeRef"] = exclude_ref
        if extra_sleep_patches:
            spec["patches"] = list(extra_sleep_patches)
        # Nombre del SleepInfo debe reflejar el namespace: sleep-{tenant}-{ns_suffix}
        objs.append(cr_yaml("SleepInfo", meta(f"sleep-{tenant}-{ns_suffix}", ns, shared_annotations), spec))

        # Wake: restaura los recursos usando los restore patches del sleep
        # IMPORTANTE: debe tener suspendDeployments=True y la misma excludeRef exacta para que
        # kube-green busque los restore patches correctamente. La anotación compartida ayuda.
        shared_annotations_wake = {
            "kube-green.stratio.com/pair-id": shared_id,
            "kube-green.stratio.com/pair-role": "wake"
        }
        # Wake: restaura los recursos usando los restore patches del sleep
        # IMPORTANTE: debe tener suspendDeployments=True y la misma excludeRef exacta para que
        # kube-green busque los restore patches correctamente. La anotación compartida ayuda.
        # No incluir wakeUpAt para el SleepInfo de "wake" (el sleepAt es la hora de wake)
        spec = sleepinfo_base(
            wd_wake, on_deployments_utc, wakeUpAtUTC=None,
            suspendDeployments=True, suspendStatefulSets=suspend_statefulsets, suspendCronJobs=True,
            suspendStatefulSetsPostgres=suspend_statefulsets_postgres
        )
        # CRÍTICO: usar exactamente la misma excludeRef que el sleep para que kube-green
        # pueda encontrar los restore patches de los mismos recursos
        if exclude_ref:
            spec["excludeRef"] = exclude_ref
        if extra_wake_patches:
            spec["patches"] = list(extra_wake_patches)
        # Nombre del SleepInfo debe reflejar el namespace: wake-{tenant}-{ns_suffix}
        objs.append(cr_yaml("SleepInfo", meta(f"wake-{tenant}-{ns_suffix}", ns, shared_annotations_wake), spec))

    return objs

# ---------- Ensamblador principal ----------
def make_all_objects_for_tenant(tenant, off_local, on_local,
                                weekdays=WEEKDAYS_DEFAULT,
                                sleepdays=None, wakedays=None,
                                selected_suffixes=None):
    # 1) Normaliza días definidos en hora local
    try:
        wd_default = human_weekdays_to_kube(weekdays)
        wd_sleep_local = human_weekdays_to_kube(sleepdays) if sleepdays else wd_default
        wd_wake_local  = human_weekdays_to_kube(wakedays)  if wakedays  else wd_default
    except ValueError as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)

    # 2) Horas UTC + desplazamiento de día (local→UTC)
    off_utc, off_shift = to_utc_hhmm_and_dayshift(off_local)  # apagado
    on_utc,  on_shift  = to_utc_hhmm_and_dayshift(on_local)   # encendido base

    # 3) Ajusta weekdays al día efectivo en UTC
    wd_sleep_utc = _shift_weekdays_str(wd_sleep_local, off_shift)
    wd_wake_utc  = _shift_weekdays_str(wd_wake_local,  on_shift)

    # 4) Encendido escalonado en UTC
    on_pg_hdfs     = on_utc                      # PgCluster + HDFS
    on_pgbouncer   = add_minutes_hhmm(on_utc, 5) # PgBouncer +5
    on_deployments = add_minutes_hhmm(on_utc, 7) # Deployments +7

    # Normaliza el filtro de namespaces
    selected = normalize_namespaces(selected_suffixes)

    objs = []
    # Datastores: gestiona CRDs y nativos de forma unificada con campos booleanos nativos
    if allow_ns(selected, "datastores"):
        objs += make_datastores_native_deploys_split_days(
            tenant, off_utc, on_deployments, on_pg_hdfs, on_pgbouncer, wd_sleep_utc, wd_wake_utc
        )

    # Apps
    if allow_ns(selected, "apps"):
        objs += make_ns_split_days(
            tenant, "apps", "apps",
            off_utc, on_deployments, wd_sleep_utc, wd_wake_utc,
            suspend_statefulsets=False,
            extra_exclude_labels=None,              # Virtualizer se añade dentro
            extra_sleep_patches=None,
            extra_wake_patches=None,
        )

    # Rocket
    if allow_ns(selected, "rocket"):
        objs += make_ns_split_days(
            tenant, "rocket", "rocket",
            off_utc, on_deployments, wd_sleep_utc, wd_wake_utc,
            suspend_statefulsets=False
        )

    # Intelligence
    if allow_ns(selected, "intelligence"):
        objs += make_ns_split_days(
            tenant, "intelligence", "intelligence",
            off_utc, on_deployments, wd_sleep_utc, wd_wake_utc,
            suspend_statefulsets=False
        )

    # Airflowsso: PgCluster por campo nativo + deployments nativos unificados
    if allow_ns(selected, "airflowsso"):
        objs += make_ns_split_days(
            tenant, "airflowsso", "airflowsso",
            off_utc, on_deployments, wd_sleep_utc, wd_wake_utc,
            suspend_statefulsets=True,                 # aquí sí suspendemos StatefulSets nativos
            extra_exclude_labels=get_exclude_pg_hdfs_refs(),  # no tocar los sets del operador (labels + nombres)
            suspend_statefulsets_postgres=True,  # EXTENSIÓN: gestiona PgCluster por campo nativo
            extra_sleep_patches=None,
            extra_wake_patches=None,
        )

    return objs

# ---------- Namespaces helpers ----------
def normalize_namespaces(ns_arg):
    """
    Recibe: None, 'apps', 'apps,rocket', ['apps','airflowsso'], etc.
    Devuelve: set con sufijos válidos (o set(VALID_SUFFIXES) si None/vacío).
    """
    if not ns_arg:
        return set(VALID_SUFFIXES)
    if isinstance(ns_arg, str):
        parts = re.split(r"[,\s]+", ns_arg.strip())
    else:
        # lista/tupla -> flatten
        parts = []
        for x in ns_arg:
            parts += re.split(r"[,\s]+", str(x).strip())
    out = set()
    for p in parts:
        if not p:
            continue
        p = p.lower()
        if p not in VALID_SUFFIXES:
            print(f"[WARN] Namespace desconocido '{p}' ignorado. Válidos: {', '.join(VALID_SUFFIXES)}")
            continue
        out.add(p)
    return out or set(VALID_SUFFIXES)

def allow_ns(selected_set, suffix):
    """True si el sufijo está permitido (o no hay filtro)."""
    return suffix in (selected_set or set(VALID_SUFFIXES))

def namespaces_for_tenant(tenant, selected_suffixes=None):
    sel = normalize_namespaces(selected_suffixes)
    return [f"{tenant}-{s}" for s in VALID_SUFFIXES if s in sel]

# ---------- YAML output ----------
def write_or_print(yaml_str, outdir=None, tenant=None):
    """Guarda el YAML en archivo o imprime por pantalla."""
    if outdir:
        os.makedirs(outdir, exist_ok=True)
        fn = os.path.join(outdir, f"{tenant}.sleepinfos.yaml")
        with open(fn, "w", encoding="utf-8") as f:
            f.write(yaml_str)
        print(f"[OK] Rendered: {fn}")
    else:
        print(yaml_str)

def to_yaml_docs(objs):
    from io import StringIO
    from ruamel.yaml import YAML
    from ruamel.yaml.scalarstring import LiteralScalarString
    import re as _re

    for o in objs:
        spec = o.get("spec", {})

        # Seguridad extra: normaliza weekdays si viniera en español por accidente
        wd = spec.get("weekdays")
        if isinstance(wd, str) and _re.search(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]", wd):
            spec["weekdays"] = human_weekdays_to_kube(wd)

        patches = spec.get("patches", [])
        for p in patches:
            if isinstance(p, dict) and "patch" in p and isinstance(p["patch"], str):
                p["patch"] = LiteralScalarString(p["patch"])

        # Asegura que kube-green reciba strings en estos campos
        for k in ("weekdays", "timeZone", "sleepAt", "wakeUpAt"):
            if k in spec and not isinstance(spec[k], str):
                spec[k] = str(spec[k])

    yaml = YAML()
    yaml.default_flow_style = False
    yaml.indent(mapping=2, sequence=2, offset=0)

    buf = StringIO()
    for idx, obj in enumerate(objs):
        yaml.dump(obj, buf)
        if idx != len(objs) - 1:
            buf.write("---\n")
    return buf.getvalue() + ("" if buf.getvalue().endswith("\n") else "\n")

# ---------- kubectl helpers ----------
def kubectl_get_sleepinfo(ns):
    """Devuelve el JSON de sleepinfos en ns, o None si el ns no existe / no hay CRs."""
    try:
        out = subprocess.check_output(
            ["kubectl", "-n", ns, "get", "sleepinfo", "-o", "json"],
            stderr=subprocess.STDOUT,
            text=True,
        )
        return json.loads(out)
    except subprocess.CalledProcessError:
        # Namespace inexistente o recurso no encontrado → devolvemos None
        return None

def show_schedules_for_tenant(tenant, selected_suffixes=None):
    namespaces = namespaces_for_tenant(tenant, selected_suffixes)
    found_any = False
    for ns in namespaces:
        data = kubectl_get_sleepinfo(ns)
        if not data or "items" not in data or not data["items"]:
            continue
        found_any = True
        print(f"\n# Namespace: {ns}")
        for it in data["items"]:
            name = it["metadata"]["name"]
            spec = it.get("spec", {})
            wd_kube = spec.get("weekdays", "")
            wd_human = kube_weekdays_to_human(wd_kube)
            sa_utc = spec.get("sleepAt", "")
            wu_utc = spec.get("wakeUpAt", "")
            sa_loc = utc_hhmm_to_local(sa_utc) if sa_utc else ""
            wu_loc = utc_hhmm_to_local(wu_utc) if wu_utc else ""
            print(f"- {name}: weekdays={wd_kube} ({wd_human})  "
                  f"sleepAt UTC={sa_utc} (COT={sa_loc})  "
                  f"wakeUpAt UTC={wu_utc} (COT={wu_loc})")
    if not found_any:
        print("(No SleepInfo found for tenant)")

def check_and_wake_deployments(tenant, selected_suffixes=None):
    """
    Verifica deployments que estén apagados (réplicas=0) antes de aplicar SleepInfo.
    Solo informa, NO intenta encenderlos automáticamente.

    NOTA: Si un deployment ya está apagado antes de aplicar SleepInfo, kube-green NO lo encenderá
    cuando llegue la hora de wake, ya que no tendrá restore patch guardado.
    """
    namespaces = namespaces_for_tenant(tenant, selected_suffixes)
    any_found = False

    for ns in namespaces:
        try:
            # Obtener deployments con réplicas en 0
            out = subprocess.check_output(
                ["kubectl", "-n", ns, "get", "deployments", "-o", "json"],
                stderr=subprocess.DEVNULL,
                text=True,
            )
            data = json.loads(out)

            for item in data.get("items", []):
                name = item["metadata"]["name"]
                spec_replicas = item.get("spec", {}).get("replicas", 1)
                ready_replicas = item.get("status", {}).get("readyReplicas", 0)

                # Si está configurado a 0 o tiene 0 réplicas activas
                if spec_replicas == 0 or ready_replicas == 0:
                    # Verificar si es un deployment que debería estar gestionado por SleepInfo
                    # (excluir Virtualizer y operadores)
                    labels = item.get("metadata", {}).get("labels", {})
                    app_id = labels.get("cct.stratio.com/application_id", "")

                    # No reportar Virtualizer
                    if "virtualizer" in app_id.lower():
                        continue

                    # No reportar recursos de operadores (Postgres, HDFS)
                    managed_by = labels.get("app.kubernetes.io/managed-by", "")
                    if "postgres-operator" in managed_by or "hdfs-operator" in managed_by:
                        continue

                    any_found = True
                    print(f"[INFO] Deployment '{name}' en namespace '{ns}' está apagado (réplicas=0).")
                    print(f"       kube-green NO lo encenderá automáticamente al hacer wake si no tiene restore patch.")

        except (subprocess.CalledProcessError, json.JSONDecodeError):
            # Namespace no existe o error al obtener deployments
            continue

    if any_found:
        print("\n[INFO] Los deployments apagados se mantendrán apagados incluso cuando llegue la hora de wake.")
        print("       Esto es el comportamiento esperado: kube-green solo restaura recursos que él mismo apagó.")

def apply_yaml(yaml_text):
    try:
        p = subprocess.run(["kubectl", "apply", "-f", "-"], input=yaml_text,
                           text=True, check=True, capture_output=True)
        print(p.stdout)
    except subprocess.CalledProcessError as e:
        print(e.stdout)
        print(e.stderr, file=sys.stderr)
        sys.exit(1)

# ---------- Limpieza de Secrets huérfanos ----------
def cleanup_orphan_secrets(tenant, selected_suffixes=None):
    """
    Elimina todos los Secrets huérfanos (secrets que no tienen un SleepInfo asociado).
    Busca secrets con nombre 'sleepinfo-*' y verifica si existe el SleepInfo correspondiente.

    Args:
        tenant: Nombre del tenant
        selected_suffixes: Sufijos de namespaces a limpiar (ej: "datastores,apps")
    """
    all_suffixes = ["datastores", "apps", "rocket", "intelligence", "airflowsso"]

    if selected_suffixes:
        # normaliza y filtra sufijos válidos
        target_suffixes = []
        for s in re.split(r"[,\s]+", selected_suffixes.strip()):
            if not s:
                continue
            if s not in all_suffixes:
                continue
            target_suffixes.append(s)
        if not target_suffixes:
            return
    else:
        target_suffixes = all_suffixes

    cleaned_count = 0
    for suf in target_suffixes:
        ns = f"{tenant}-{suf}"

        # Obtener todos los secrets que empiecen con "sleepinfo-"
        try:
            out = subprocess.check_output(
                ["kubectl", "-n", ns, "get", "secrets", "-o", "json"],
                stderr=subprocess.DEVNULL,
                text=True,
            )
            secrets_data = json.loads(out)
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            # Namespace no existe o error
            continue

        # Obtener todos los SleepInfos existentes en el namespace
        sleepinfo_data = kubectl_get_sleepinfo(ns)
        existing_sleepinfos = set()
        if sleepinfo_data and "items" in sleepinfo_data:
            for item in sleepinfo_data["items"]:
                existing_sleepinfos.add(item["metadata"]["name"])

        # Buscar secrets huérfanos
        for secret_item in secrets_data.get("items", []):
            secret_name = secret_item["metadata"]["name"]

            # Solo procesar secrets que empiecen con "sleepinfo-"
            if not secret_name.startswith("sleepinfo-"):
                continue

            # Extraer el nombre del SleepInfo del secret
            # sleepinfo-<sleepinfo-name> -> <sleepinfo-name>
            sleepinfo_name = secret_name.replace("sleepinfo-", "", 1)

            # Si no existe el SleepInfo, el secret es huérfano
            if sleepinfo_name not in existing_sleepinfos:
                print(f"[CLEANUP] Secret huérfano encontrado: {secret_name} ({ns})")
                print(f"         SleepInfo '{sleepinfo_name}' no existe")
                result = subprocess.run(
                    ["kubectl", "-n", ns, "delete", "secret", secret_name, "--ignore-not-found"],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                if result.returncode == 0 and ("deleted" in result.stdout or "NotFound" not in result.stdout):
                    cleaned_count += 1
                    print(f"         ✓ Secret eliminado")

    if cleaned_count > 0:
        print(f"[CLEANUP] {cleaned_count} Secret(s) huérfano(s) eliminado(s)")

# ---------- Reconciliación (borra SleepInfos que no estén en el YAML generado) ----------
def reconcile_sleepinfos(tenant, yaml_objs, selected_suffixes=None):
    """
    Borra SleepInfos no deseados en los namespaces del tenant.
    Si selected_suffixes se indica (p.ej. ["airflowsso"]), sólo reconcilia esos.
    """
    all_suffixes = ["datastores", "apps", "rocket", "intelligence", "airflowsso"]

    if selected_suffixes:
        # normaliza y filtra sufijos válidos
        target_suffixes = []
        for s in re.split(r"[,\s]+", selected_suffixes.strip()):
            if not s:
                continue
            if s not in all_suffixes:
                # sufijo desconocido → lo ignoramos silenciosamente
                continue
            target_suffixes.append(s)
        if not target_suffixes:
            return
    else:
        target_suffixes = all_suffixes

    desired_names = {o["metadata"]["name"] for o in yaml_objs}

    for suf in target_suffixes:
        ns = f"{tenant}-{suf}"
        data = kubectl_get_sleepinfo(ns)
        if not data or "items" not in data:
            # ns no existe o no hay SleepInfos → nada que reconciliar
            continue

        for item in data["items"]:
            name = item["metadata"]["name"]
            if name not in desired_names:
                print(f"[RECONCILE] Eliminando SleepInfo no deseado: {name} ({ns})")
                subprocess.run(
                    ["kubectl", "-n", ns, "delete", "sleepinfo", name, "--ignore-not-found"],
                    check=False,
                )
                # Limpiar también el Secret asociado para evitar acumulación de basura
                secret_name = f"sleepinfo-{name}"
                print(f"[RECONCILE] Eliminando Secret huérfano: {secret_name} ({ns})")
                subprocess.run(
                    ["kubectl", "-n", ns, "delete", "secret", secret_name, "--ignore-not-found"],
                    check=False,
                )

# ---------- CLI ----------
def main():
    description = """
═══════════════════════════════════════════════════════════════════════════════
  HERRAMIENTA DE GESTIÓN AUTOMÁTICA DE APAGADO/ENCENDIDO PARA KUBE-GREEN
═══════════════════════════════════════════════════════════════════════════════

📋 ¿QUÉ HACE ESTA HERRAMIENTA?

Esta herramienta te permite configurar fácilmente el apagado y encendido automático 
de tus aplicaciones en Kubernetes usando kube-green. Solo necesitas indicar:
  • A qué hora apagar (ej: 22:00)
  • A qué hora encender (ej: 06:00)
  • Qué días de la semana (ej: lunes a viernes)
  • Para qué tenant (ej: bdadevprd)

El script se encarga automáticamente de:
  ✓ Convertir las horas de Colombia (America/Bogota) a UTC
  ✓ Ajustar los días de la semana según la zona horaria
  ✓ Crear las configuraciones de kube-green para todos los namespaces
  ✓ Aplicar encendido escalonado (primero Postgres/HDFS, luego otros servicios)
  ✓ Gestionar Postgres, HDFS, PgBouncer y aplicaciones normales

🔧 REQUISITOS PREVIOS

Antes de usar esta herramienta, instala Python y la librería necesaria:

  pip install ruamel.yaml

💡 CONCEPTOS SIMPLES

• TENANT: Es el nombre de tu ambiente (ej: bdadevprd, bdadevdat, bdadevlab)
• NAMESPACE: Son las áreas donde viven tus aplicaciones:
  - datastores: Bases de datos (Postgres, HDFS, PgBouncer)
  - apps: Aplicaciones principales
  - rocket: Servicios de Rocket
  - intelligence: Servicios de Intelligence
  - airflowsso: Servicios de Airflow SSO

• APAGADO/ENCENDIDO: Las horas que defines están en hora de Colombia (COT).
  El script las convierte automáticamente a UTC para que funcionen correctamente.

• ENCENDIDO ESCALONADO: Los servicios se encienden en orden:
  1. Postgres y HDFS (necesarios para que todo funcione)
  2. PgBouncer (5 minutos después, necesita Postgres)
  3. Aplicaciones normales (7 minutos después, necesitan las bases de datos)

📝 COMANDOS DISPONIBLES

1. CREATE: Crea nuevas configuraciones de apagado/encendido
2. UPDATE: Actualiza configuraciones existentes
3. SHOW: Muestra las configuraciones actuales

🎯 EJEMPLOS PRÁCTICOS

═══════════════════════════════════════════════════════════════════════════════
EJEMPLO 1: Apagar todos los servicios de lunes a viernes a las 10 PM y 
           encenderlos a las 6 AM (para el tenant bdadevprd)

  python3 tenant_power.py create --tenant bdadevprd --off 22:00 --on 06:00 \\
      --weekdays "lunes-viernes" --apply

═══════════════════════════════════════════════════════════════════════════════
EJEMPLO 2: Solo para un namespace específico (por ejemplo, airflowsso)
           Apagar el viernes a las 11 PM y encender el lunes a las 6 AM

  python3 tenant_power.py create --tenant bdadevprd --off 23:00 --on 06:00 \\
      --sleepdays "viernes" --wakedays "lunes" --namespaces airflowsso --apply

═══════════════════════════════════════════════════════════════════════════════
EJEMPLO 3: Solo generar el archivo YAML sin aplicar (útil para revisar primero)

  python3 tenant_power.py create --tenant bdadevprd --off 22:00 --on 06:00 \\
      --weekdays "lunes-viernes" --outdir ./yamls

  Esto creará un archivo bdadevprd.sleepinfos.yaml en la carpeta ./yamls
  que puedes revisar antes de aplicar manualmente con kubectl.

═══════════════════════════════════════════════════════════════════════════════
EJEMPLO 4: Ver qué configuraciones están activas actualmente

  python3 tenant_power.py show --tenant bdadevprd

  Esto mostrará todos los horarios configurados en formato legible.

═══════════════════════════════════════════════════════════════════════════════
EJEMPLO 5: Cambiar los horarios de un tenant que ya está configurado

  python3 tenant_power.py update --tenant bdadevprd --off 23:00 --on 07:00 \\
      --weekdays "lunes-viernes" --apply

═══════════════════════════════════════════════════════════════════════════════
EJEMPLO 6: Apagar solo los sábados a las 14:15 y encender a las 14:25
           (útil para mantenimientos o pruebas rápidas)

  python3 tenant_power.py create --tenant bdadevlab --off 14:15 --on 14:25 \\
      --weekdays "sábado" --apply

═══════════════════════════════════════════════════════════════════════════════

📌 OPCIONES PRINCIPALES

--tenant    : Nombre del tenant (obligatorio)
--off       : Hora de apagado en formato HH:MM (ej: 22:00, 14:15)
--on        : Hora de encendido en formato HH:MM (ej: 06:00, 14:25)
--weekdays  : Días de la semana. Puedes usar:
              • Formato humano: "lunes-viernes", "viernes,sábado,domingo", "sábado"
              • Formato numérico: "1-5" (lunes-viernes), "6" (sábado), "0-6" (todos)
--sleepdays : (Opcional) Días específicos para apagar. Si no se indica, usa --weekdays
--wakedays  : (Opcional) Días específicos para encender. Si no se indica, usa --weekdays
--namespaces: (Opcional) Limitar a ciertos namespaces. Valores válidos:
              datastores, apps, rocket, intelligence, airflowsso
              Ejemplo: --namespaces "apps,rocket"
--apply     : Aplicar directamente los cambios al cluster (sin esto solo genera YAML)
--outdir    : Directorio donde guardar el archivo YAML generado (sin --apply)

⚠️  NOTAS IMPORTANTES

• Si no usas --apply, el script solo generará el archivo YAML para que lo revises
• Las horas son siempre en hora de Colombia (America/Bogota)
• El script automáticamente excluye el Virtualizer en el namespace apps
• Los nombres de días aceptan acentos: "sábado", "miércoles", etc.
• Puedes combinar días: "viernes,sábado,domingo" o usar rangos: "lunes-viernes"

═══════════════════════════════════════════════════════════════════════════════
"""
    parser = argparse.ArgumentParser(
        prog="tenant_power.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=description
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    # create/render/apply
    p_create = sub.add_parser(
        "create",
        help="Crea nuevas configuraciones de apagado/encendido para un tenant"
    )
    p_create.add_argument("--tenant", required=True, 
                         help="Nombre del tenant (ej: 'bdadevprd', 'bdadevdat', 'bdadevlab')")
    p_create.add_argument("--off", required=True, 
                         help="Hora de apagado en hora de Colombia (formato HH:MM). Ejemplo: '22:00', '14:15'")
    p_create.add_argument("--on", required=True, 
                         help="Hora de encendido en hora de Colombia (formato HH:MM). Ejemplo: '06:00', '14:25'")
    p_create.add_argument("--weekdays", default=WEEKDAYS_DEFAULT,
                         help="Días de la semana. Puedes usar formato humano ('lunes-viernes', 'sábado') "
                              "o numérico ('1-5', '6'). Por defecto: todos los días (0-6)")
    p_create.add_argument("--sleepdays", 
                         help="(Opcional) Días específicos para APAGAR en formato humano o numérico. "
                              "Ejemplos: 'viernes', '5', 'viernes,sábado'. Si no se indica, usa --weekdays")
    p_create.add_argument("--wakedays",  
                         help="(Opcional) Días específicos para ENCENDER en formato humano o numérico. "
                              "Ejemplos: 'lunes', '1', 'lunes,martes'. Si no se indica, usa --weekdays")
    p_create.add_argument("--namespaces", 
                         help="(Opcional) Limitar a ciertos namespaces. Valores válidos: datastores, apps, "
                              "rocket, intelligence, airflowsso. Ejemplo: 'airflowsso' o 'apps,rocket'. "
                              "Si omites, se incluyen todos los namespaces del tenant")
    p_create.add_argument("--outdir", 
                         help="(Opcional) Directorio donde guardar el archivo YAML generado. "
                              "Si no se indica, el YAML se imprime en la consola")
    p_create.add_argument("--apply", action="store_true", 
                         help="Aplicar los cambios directamente al cluster de Kubernetes. "
                              "Sin esta opción, solo se genera el YAML sin aplicar")

    # show
    p_show = sub.add_parser(
        "show",
        help="Muestra las configuraciones de apagado/encendido actuales del tenant"
    )
    p_show.add_argument("--tenant", required=True, 
                       help="Nombre del tenant a consultar (ej: 'bdadevprd', 'bdadevdat')")
    p_show.add_argument("--namespaces", 
                       help="(Opcional) Limitar a ciertos namespaces. Ejemplos: 'airflowsso', 'apps,rocket'. "
                            "Si omites, se muestran todos los namespaces del tenant")

    # update
    p_update = sub.add_parser(
        "update",
        help="Actualiza las configuraciones existentes de apagado/encendido del tenant"
    )
    p_update.add_argument("--tenant", required=True, 
                         help="Nombre del tenant a actualizar (ej: 'bdadevprd', 'bdadevdat')")
    p_update.add_argument("--off", required=True, 
                         help="Nueva hora de apagado en hora de Colombia (formato HH:MM). Ejemplo: '23:00', '14:15'")
    p_update.add_argument("--on", required=True, 
                         help="Nueva hora de encendido en hora de Colombia (formato HH:MM). Ejemplo: '07:00', '14:25'")
    p_update.add_argument("--weekdays", default=WEEKDAYS_DEFAULT,
                         help="Días de la semana por defecto. Puedes usar formato humano ('lunes-viernes') "
                              "o numérico ('1-5'). Por defecto: todos los días (0-6)")
    p_update.add_argument("--sleepdays", 
                         help="(Opcional) Días específicos para APAGAR. Ejemplos: 'viernes', '5'. "
                              "Si no se indica, usa --weekdays")
    p_update.add_argument("--wakedays",  
                         help="(Opcional) Días específicos para ENCENDER. Ejemplos: 'lunes', '1'. "
                              "Si no se indica, usa --weekdays")
    p_update.add_argument("--namespaces", 
                         help="(Opcional) Limitar a ciertos namespaces. Ejemplos: 'airflowsso', 'apps,rocket'. "
                              "Si omites, se actualizan todos los namespaces del tenant")
    p_update.add_argument("--apply", action="store_true", 
                         help="Aplicar los cambios directamente al cluster de Kubernetes. "
                              "Sin esta opción, solo se genera el YAML actualizado sin aplicar")

    args = parser.parse_args()

    if args.cmd in ("create", "update"):
        objs = make_all_objects_for_tenant(
            args.tenant, args.off, args.on,
            weekdays=args.weekdays,
            sleepdays=getattr(args, "sleepdays", None),
            wakedays=getattr(args, "wakedays", None),
            selected_suffixes=getattr(args, "namespaces", None),
        )
        yaml_text = to_yaml_docs(objs)
        write_or_print(yaml_text, getattr(args, "outdir", None), args.tenant)
        if getattr(args, "apply", False):
            # Verificar deployments apagados antes de aplicar
            check_and_wake_deployments(args.tenant, selected_suffixes=getattr(args, "namespaces", None))
            apply_yaml(yaml_text)
            # Reconciliar: borrar SleepInfos que NO estén en el YAML recién generado
            # También limpia los Secrets de los SleepInfos eliminados
            reconcile_sleepinfos(args.tenant, objs, selected_suffixes=getattr(args, "namespaces", None))
            # Limpiar Secrets huérfanos (secrets sin SleepInfo asociado)
            cleanup_orphan_secrets(args.tenant, selected_suffixes=getattr(args, "namespaces", None))
    elif args.cmd == "show":
        show_schedules_for_tenant(args.tenant, selected_suffixes=getattr(args, "namespaces", None))

if __name__ == "__main__":
    main()