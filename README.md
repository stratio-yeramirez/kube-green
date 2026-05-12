[![Go Report Card][go-report-svg]][go-report-card]
[![Coverage][test-and-build-svg]][test-and-build]
[![Security][security-badge]][security-pipelines]
[![Coverage Status][coverage-badge]][coverage]
[![Documentations][website-badge]][website]
[![Adopters][adopters-badge]][adopters]
[![CNCF Landscape][cncf-badge]][cncf-landscape]

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kube-green/kube-green/main/logo/logo-horizontal-dark.svg">
  <img alt="Dark kube-green logo" src="https://raw.githubusercontent.com/kube-green/kube-green/main/logo/logo-horizontal.svg">
</picture>

How many of your dev/preview pods stay on during weekends? Or at night? It's a waste of resources! And money! But fear not, *kube-green* is here to the rescue.

*kube-green* is a simple **k8s addon** that automatically **shuts down** (some of) your **resources** when you don't need them.

## 🚀 Extended Features (This Fork)

This fork extends the upstream kube-green with:

- ✅ **REST API** with JWT authentication (port 8080)
- ✅ **Role-Based Access Control** (admin, operacion, lectura)
- ✅ **Web Frontend** — React 18 + TypeScript + Material-UI (Nginx, port 80)
- ✅ **Extended CRD Support** — PgCluster, HDFSCluster, OsCluster, OsDashboards, KafkaCluster, PgBouncer
- ✅ **User Management** via admin panel
- ✅ **Dynamic Resource Detection** in namespaces
- ✅ **Staged Wake-Up** sequences for proper service dependency ordering
- ✅ **Paired Sleep/Wake** pattern for schedules with different sleep and wake days
- ✅ **Multi-schedule per namespace** via `scheduleName` annotation
- ✅ **Multi-tenant Support** with `tenant_power.py` helper script
- ✅ **Comprehensive API Documentation** (Swagger + HTML)

**Current version:** `0.7.19` (chart + appVersion)

---

## Getting Started

### Prerequisites

- Go 1.21+
- Kubernetes 1.19+
- kubectl configured against a cluster

### Install dependencies

```bash
go mod download
```

### Run locally (against current kubeconfig)

```bash
go run ./cmd/main.go \
  --enable-api true \
  --enable-api-cors true \
  --sleep-delta 60
```

### Manager startup flags

| Flag | Default | Description |
|---|---|---|
| `--enable-api` | `false` | Enable the REST API |
| `--enable-api-cors` | `false` | Enable CORS for the REST API |
| `--api-port` | `8080` | REST API port |
| `--sleep-delta` | `60` | Tolerance in seconds for cron event detection |
| `--max-concurrent-reconciles` | `20` | Parallel SleepInfo reconciliations |
| `--leader-elect` | `false` | Enable leader election for HA |
| `--metrics-bind-address` | `:8443` | Metrics endpoint (HTTPS) |
| `--health-probe-bind-address` | `:8081` | Health probe port |

---

## Running the tests

```sh
make test
```

Integration tests with kustomize:

```sh
make e2e-test-kustomize
```

Integration tests with Helm:

```sh
make e2e-test
```

Run a specific test harness:

```sh
make e2e-test OPTION="-run=TestSleepInfoE2E/kuttl/run_e2e_tests/harness/{TEST_NAME}"
```

---

## Usage

Once installed, create `SleepInfo` resources in the namespaces you want to manage.

### CRD — SleepInfo

**API Group:** `kube-green.com/v1alpha1`  
**Kind:** `SleepInfo`

#### Spec fields

| Field | Type | Required | Description |
|---|---|---|---|
| `weekdays` | string | yes | Cron notation for days (`0`=Sun … `6`=Sat, e.g. `"1-5"` Mon–Fri) |
| `sleepAt` | string | yes | Sleep time in `HH:MM` format |
| `wakeUpAt` | string | no | Wake time in `HH:MM` format |
| `timeZone` | string | no | IANA timezone (default: UTC, e.g. `America/Bogota`) |
| `suspendDeployments` | bool | no | Suspend Deployments (default: `true`) |
| `suspendStatefulSets` | bool | no | Suspend StatefulSets (default: `true`) |
| `suspendCronJobs` | bool | no | Suspend CronJobs (default: `false`) |
| `suspendDeploymentsPgbouncer` | bool | no | Set `spec.instances=0` on PgBouncer CRDs |
| `suspendStatefulSetsPostgres` | bool | no | Set `pgcluster.stratio.com/shutdown=true` annotation on PgCluster |
| `suspendStatefulSetsHdfs` | bool | no | Set `hdfscluster.stratio.com/shutdown=true` annotation on HDFSCluster |
| `suspendStatefulSetsOpenSearch` | bool | no | Set `oscluster.stratio.com/shutdown=true` annotation on OsCluster |
| `suspendStatefulSetsOsDashboards` | bool | no | Set `spec.instances=0` on OsDashboards CRDs |
| `suspendStatefulSetsKafka` | bool | no | Set `kafkacluster.stratio.com/shutdown=true` annotation on KafkaCluster |
| `suspendScheduleUntil` | time | no | Pause the cron schedule until this timestamp (manual actions still work) |
| `excludeRef` | list | no | Exclude specific resources by name or label (AND condition) |
| `includeRef` | list | no | Include only specific resources (AND condition) |
| `patches` | list | no | Custom JSON 6902 patches |

#### Status fields

| Field | Description |
|---|---|
| `lastScheduleTime` | Timestamp of last execution |
| `operation` | Last operation: `SLEEP` or `WAKE_UP` |
| `suspendedUntil` | If set, schedule is paused until this time |

#### Basic example — pods sleep on weeknights

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: working-hours
spec:
  weekdays: "1-5"
  sleepAt: "20:00"
  wakeUpAt: "08:00"
  timeZone: "Europe/Rome"
  suspendCronJobs: true
  excludeRef:
    - apiVersion: "apps/v1"
      kind:       Deployment
      name:       api-gateway
```

#### Sleep only, no wake-up

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: sleep-only
spec:
  sleepAt: "20:00"
  timeZone: Europe/Rome
  weekdays: "*"
```

---

## Extended CRD Support

This fork natively manages these Stratio CRDs through annotation and spec patches:

| CRD | API Group | SleepInfo Flag | Sleep mechanism | Wake mechanism |
|---|---|---|---|---|
| PgBouncer | postgres.stratio.com | `suspendDeploymentsPgbouncer` | `spec.instances = 0` | restore instances |
| PgCluster | postgres.stratio.com | `suspendStatefulSetsPostgres` | annotation `pgcluster.stratio.com/shutdown=true` | annotation `=false` |
| HDFSCluster | hdfs.stratio.com | `suspendStatefulSetsHdfs` | annotation `hdfscluster.stratio.com/shutdown=true` | annotation `=false` |
| OsCluster | opensearch.stratio.com | `suspendStatefulSetsOpenSearch` | annotation `oscluster.stratio.com/shutdown=true` | annotation `=false` |
| OsDashboards | opensearch.stratio.com | `suspendStatefulSetsOsDashboards` | `spec.instances = 0` | restore instances |
| KafkaCluster | kafka.stratio.com | `suspendStatefulSetsKafka` | annotation `kafkacluster.stratio.com/shutdown=true` | annotation `=false` |

**Note:** StatefulSets managed by operators (postgres-operator, hdfs-operator, opensearch-operator, kafka-operator) are automatically excluded from the native `suspendStatefulSets` patch to prevent conflicts. Use the dedicated CRD flags instead.

### Example — suspend PostgreSQL cluster

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: postgres-schedule
  namespace: my-namespace
spec:
  weekdays: "1-5"
  sleepAt: "20:00"
  wakeUpAt: "08:00"
  timeZone: "America/Bogota"
  suspendStatefulSetsPostgres: true
```

### Example — suspend all Stratio CRDs

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: sleep-all-crds
  namespace: my-namespace
spec:
  weekdays: "5"
  sleepAt: "22:00"
  wakeUpAt: "06:00"
  timeZone: "UTC"
  suspendStatefulSetsPostgres: true
  suspendStatefulSetsHdfs: true
  suspendStatefulSetsOpenSearch: true
  suspendStatefulSetsOsDashboards: true
  suspendStatefulSetsKafka: true
  suspendDeploymentsPgbouncer: true
```

---

## Paired Sleep/Wake Pattern

A single `SleepInfo` with `sleepAt` and `wakeUpAt` assumes both events happen on the **same days**. To sleep on Friday and wake on Monday, use two paired resources linked by `pair-id` and `pair-role` annotations.

**Sleep resource** (fires on Friday):

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: sleep-datastores
  namespace: my-datastores
  annotations:
    kube-green.stratio.com/pair-id: "my-datastores-weekend"
    kube-green.stratio.com/pair-role: "sleep"
    kube-green.stratio.com/schedule-name: "weekend-shutdown"
spec:
  weekdays: "5"         # Friday
  sleepAt: "22:00"
  timeZone: "America/Bogota"
  suspendDeployments: true
  suspendStatefulSets: true
  suspendCronJobs: true
  suspendDeploymentsPgbouncer: true
  suspendStatefulSetsPostgres: true
  suspendStatefulSetsHdfs: true
  suspendStatefulSetsOpenSearch: true
  suspendStatefulSetsKafka: true
```

**Wake resource** (fires on Monday):

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: wake-datastores
  namespace: my-datastores
  annotations:
    kube-green.stratio.com/pair-id: "my-datastores-weekend"
    kube-green.stratio.com/pair-role: "wake"
    kube-green.stratio.com/schedule-name: "weekend-shutdown"
spec:
  weekdays: "1"         # Monday
  sleepAt: "08:00"      # reused as event time
  timeZone: "America/Bogota"
  suspendDeployments: false
  suspendStatefulSets: false
```

---

## Staged Wake-Up

For datastores namespaces, services must start in dependency order. Use separate `pair-role: "wake"` resources timed to fire in sequence:

```
t=0  min  → PgCluster + HDFSCluster + OsCluster + KafkaCluster  (data layer)
t=+5 min  → PgBouncer                                            (depends on Postgres)
t=+7 min  → native Deployments / StatefulSets                   (depend on all data services)
```

**Stage 1 — Postgres, HDFS, OpenSearch, Kafka** (at `07:55`):

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: wake-datastores-pg-hdfs-opensearch-kafka
  namespace: my-datastores
  annotations:
    kube-green.stratio.com/pair-id: "my-datastores-weekend"
    kube-green.stratio.com/pair-role: "wake"
spec:
  weekdays: "1"
  sleepAt: "07:55"
  timeZone: "America/Bogota"
  suspendStatefulSetsPostgres: true
  suspendStatefulSetsHdfs: true
  suspendStatefulSetsOpenSearch: true
  suspendStatefulSetsKafka: true
```

**Stage 2 — PgBouncer** (at `07:57`, 2 min after stage 1):

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: wake-datastores-pgbouncer
  namespace: my-datastores
  annotations:
    kube-green.stratio.com/pair-id: "my-datastores-weekend"
    kube-green.stratio.com/pair-role: "wake"
spec:
  weekdays: "1"
  sleepAt: "07:57"
  timeZone: "America/Bogota"
  suspendDeploymentsPgbouncer: true
```

**Stage 3 — Native workloads** (at `08:00`):

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: wake-datastores-apps
  namespace: my-datastores
  annotations:
    kube-green.stratio.com/pair-id: "my-datastores-weekend"
    kube-green.stratio.com/pair-role: "wake"
spec:
  weekdays: "1"
  sleepAt: "08:00"
  timeZone: "America/Bogota"
  suspendDeployments: true
  suspendStatefulSets: true
  suspendCronJobs: true
```

---

## Manual Actions

Trigger sleep or wake immediately without waiting for the cron schedule.

### Via REST API

```bash
# Sleep immediately
curl -X POST http://kube-green:8080/api/v1/schedules/bdaqa/manual \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"sleep","scheduleName":"weekend-shutdown","namespace":"bdaqa-datastores"}'

# Wake immediately
curl -X POST http://kube-green:8080/api/v1/schedules/bdaqa/manual \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"wake","scheduleName":"weekend-shutdown","namespace":"bdaqa-datastores"}'
```

### Via kubectl annotation

```bash
kubectl annotate sleepinfo <name> -n <namespace> \
  kube-green.stratio.com/manual-action=sleep \
  kube-green.stratio.com/manual-at=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --overwrite
```

**Note:** The `manual-at` annotation has a TTL of 5 minutes. Actions older than 5 minutes are ignored.

### Suspend schedule temporarily

```bash
# Pause cron until Monday 08:00 (manual actions still work)
curl -X POST http://kube-green:8080/api/v1/schedules/bdaqa/suspend \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"until":"2025-06-16T08:00:00Z","scheduleName":"weekend-shutdown","namespace":"bdaqa-datastores"}'

# Remove suspension
curl -X DELETE "http://kube-green:8080/api/v1/schedules/bdaqa/suspend?namespace=bdaqa-datastores&scheduleName=weekend-shutdown" \
  -H "Authorization: Bearer $TOKEN"
```

Equivalent: set `spec.suspendScheduleUntil` directly on the SleepInfo.

---

## REST API

Port **8080** · Base path **`/api/v1`** · Auth: `Authorization: Bearer <token>`

### Endpoints

#### Public (no auth required)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/ready` | Readiness check |
| GET | `/api/v1/info` | API version and endpoint list |
| POST | `/api/v1/auth/login` | Obtain JWT tokens |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| GET | `/api/v1/auth/me` | Current user info |

#### Schedules (auth required)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/schedules` | List all schedules |
| GET | `/api/v1/schedules/:tenant` | Get schedules for a tenant |
| POST | `/api/v1/schedules` | Create a schedule |
| PUT | `/api/v1/schedules/:tenant` | Update a schedule |
| DELETE | `/api/v1/schedules/:tenant` | Delete a schedule |
| POST | `/api/v1/schedules/:tenant/manual` | Trigger immediate sleep or wake |
| POST | `/api/v1/schedules/:tenant/suspend` | Suspend schedule temporarily |
| DELETE | `/api/v1/schedules/:tenant/suspend` | Remove suspension |
| GET | `/api/v1/schedules/:tenant/suspended` | List currently suspended services |
| GET | `/api/v1/schedules/:tenant/next` | Get next scheduled operation |
| GET | `/api/v1/schedules/suspended` | All suspended services (all tenants) |
| GET | `/api/v1/schedules/next` | Next operation (all tenants) |

#### Tenant discovery

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/tenants` | List all tenants |
| GET | `/api/v1/namespaces/:tenant/services` | Services in namespace |
| GET | `/api/v1/namespaces/:tenant/resources` | Detect CRDs present in namespace |

#### User management (admin only)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/users` | List users |
| POST | `/api/v1/users` | Create user |
| PUT | `/api/v1/users/:username/password` | Update password |
| PUT | `/api/v1/users/:username/role` | Update role |
| DELETE | `/api/v1/users/:username` | Delete user |

### Standard response format

```json
{
  "success": true,
  "message": "Operation completed",
  "data": { ... },
  "error": null
}
```

### Authentication

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.data.accessToken')

# 2. Use token
curl -X GET http://localhost:8080/api/v1/tenants \
  -H "Authorization: Bearer $TOKEN"
```

### Create a schedule

```bash
curl -X POST http://localhost:8080/api/v1/schedules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant": "bdadevprd",
    "namespaces": ["datastores"],
    "off": "22:00",
    "on": "06:00",
    "sleepDays": "5",
    "wakeDays": "1",
    "scheduleName": "weekend-schedule",
    "description": "Weekend shutdown",
    "delays": {
      "pgHdfsDelay": 0,
      "pgbouncerDelay": 5,
      "deploymentsDelay": 7
    }
  }'
```

### API documentation

- **Swagger UI**: `http://localhost:8080/swagger`
- **HTML docs**: `http://localhost:8080/docs`

---

## Role-Based Access Control

| Permission | admin | operacion | lectura |
|---|:---:|:---:|:---:|
| View schedules | ✅ | ✅ | ✅ |
| Create schedule | ✅ | ✅ | ❌ |
| Update schedule | ✅ | ✅ | ❌ |
| Delete schedule | ✅ | ✅ | ❌ |
| Manual sleep/wake | ✅ | ✅ | ❌ |
| Manage users | ✅ | ❌ | ❌ |

### Users storage

Users are stored in a Kubernetes Secret (`kube-green-users`). Format: one user per line — `username:bcrypt_hash:role`.

```bash
# Create user secret
kubectl create secret generic kube-green-users \
  --from-literal=users="admin:\$2a\$10\$...:admin" \
  -n kube-green

# Create JWT signing secret
kubectl create secret generic kube-green-jwt \
  --from-literal=secret="your-random-secret-key" \
  -n kube-green
```

---

## Web Frontend

A React 18 + TypeScript + Material-UI frontend served by Nginx on port **80**.

**Image:** `yeramirez/kube-front:0.7.1-frontend-d08110b-manual2`

### Routes

| Path | Description |
|---|---|
| `/login` | Login page |
| `/` | Dashboard — tenant list |
| `/tenant/:name` | Tenant schedule detail |
| `/schedule/new` | Create schedule |
| `/schedule/edit/:tenant` | Edit schedule |
| `/suspended` | Currently suspended services |
| `/users` | User management (admin only) |

---

## Deployment (Helm)

**Chart:** `charts/kube-green/` · **Version:** `0.7.19`

```bash
helm install kube-green ./charts/kube-green \
  --namespace kube-green \
  --create-namespace \
  -f my-values.yaml
```

### Key values

```yaml
manager:
  image:
    repository: yeramirez/kube-green
    tag: "0.7.19"
  resources:
    limits:
      cpu: 400m
      memory: 400Mi
    requests:
      cpu: 100m
      memory: 50Mi

  api:
    enabled: true
    port: 8080
    cors: true

  auth:
    enabled: true
    jwtSecretName: "kube-green-jwt"
    usersSecretName: "kube-green-users"

  metrics:
    enabled: true
    port: 8443
    secure: true
    serviceMonitor:
      enabled: false

frontend:
  enabled: true
  replicaCount: 2
  image:
    repository: yeramirez/kube-front
    tag: "0.7.1-frontend-d08110b-manual2"
  resources:
    limits:
      cpu: 100m
      memory: 128Mi
  service:
    type: ClusterIP
    port: 80

crds:
  enabled: true
  keep: true       # CRDs are NOT deleted on helm uninstall

rbac:
  customClusterRole:
    enabled: false  # set to true to add extra rules (e.g. for Stratio CRDs)
```

### Kubernetes RBAC required

The manager's ClusterRole requires access to:

- `""` (core) — `secrets`
- `apps` — `deployments`, `statefulsets`
- `batch` — `cronjobs`
- `kube-green.com` — `sleepinfos`, `sleepinfos/status`, `sleepinfos/finalizers`
- `postgres.stratio.com` — `pgbouncer`, `pgcluster`
- `hdfs.stratio.com` — `hdfscluster`
- `opensearch.stratio.com` — `oscluster`, `osdashboardses`
- `kafka.stratio.com` — `kafkacluster`

---

## Multi-tenant Helper Script

For multi-tenant environments the `tenant_power.py` script simplifies creating SleepInfo resources:

```bash
pip install ruamel.yaml
```

```bash
# Sleep Mon–Fri at 22:00 local time, wake at 06:00
python3 tenant_power.py create --tenant bdadevprd --off 22:00 --on 06:00 \
    --weekdays "lunes-viernes" --apply

# Sleep Friday only, wake Monday (uses Paired pattern)
python3 tenant_power.py create --tenant bdadevprd --off 23:00 --on 06:00 \
    --sleepdays "viernes" --wakedays "lunes" --namespaces datastores --apply

# Generate YAML for review without applying
python3 tenant_power.py create --tenant bdadevprd --off 22:00 --on 06:00 \
    --weekdays "lunes-viernes" --outdir ./yamls

# Show current configuration
python3 tenant_power.py show --tenant bdadevprd

# Update existing configuration
python3 tenant_power.py update --tenant bdadevprd --off 23:00 --on 07:00 \
    --weekdays "lunes-viernes" --apply
```

**Supported namespaces:** `datastores`, `apps`, `rocket`, `intelligence`, `airflowsso`

---

## Versioning

### Version history

| Version | Key changes |
|---|---|
| **0.7.19** | Current. Stability fixes and final image build |
| **0.7.18** | Auto-detection of native StatefulSets. Fixed status-fix loop. Auto-exclusion of CRD-managed StatefulSets |
| **0.7.16** | OsDashboards patch fix (`spec.instances=0`). Manual action TTL. Post-sleep CRD restore validation |
| **0.7.12** | Weekday UTC↔timezone conversion when displaying schedules |
| **0.7.11** | Fix weekday mapping frontend→backend (`weekdaysSleep`/`weekdaysWake` fields) |
| **0.7.9** | `scheduleName` and `description` preserved in API responses |
| **0.7.8** | Dynamic tenant discovery. Configurable delays per schedule |
| **0.7.7** | JWT authentication middleware |

### How to release a new version

```sh
make release version=v{{NEW_VERSION}}
git push --tags origin v{{NEW_VERSION}}
```

---

## Development

```bash
# Regenerate CRD manifests after changing types.go
make manifests

# Run all unit tests
make test

# Run e2e tests (Helm)
make e2e-test

# Deploy to local KinD cluster
kind create cluster --name kube-green-development
make local-run clusterName=kube-green-development
```

### Build Docker images

```bash
# Backend (controller + API)
docker build -t yeramirez/kube-green:0.7.19 -f Dockerfile .

# Frontend
docker build -t yeramirez/kube-front:0.7.19 -f frontend-app/Dockerfile frontend-app/
```

---

## Operational Scripts

| Script | Purpose |
|---|---|
| `../jobs/validate-status.yaml` | Kubernetes Job to validate SleepInfo pair consistency |
| `../jobs/fix-status.sh` | Patch SleepInfo status fields to resolve inconsistencies |

```bash
# Validate pairs
kubectl apply -f ../jobs/validate-status.yaml
kubectl logs job/validate-sleepinfo-status -n kube-green

# Fix inconsistent status
../jobs/fix-status.sh

# List all SleepInfos in the cluster
kubectl get sleepinfo -A

# Inspect status of a specific SleepInfo
kubectl get sleepinfo <name> -n <namespace> -o jsonpath='{.status}'
```

---

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Acknowledgement

Special thanks to [JGiola](https://github.com/JGiola) for the tech review.

## Give a Star! ⭐

If you like or are using this project, please give it a star. Thanks!

## Adopters

[Here](https://kube-green.dev/docs/adopters/) the list of adopters of *kube-green*.

If you already use *kube-green*, add yourself as an [adopter][add-adopters]!

[go-report-svg]: https://goreportcard.com/badge/github.com/kube-green/kube-green
[go-report-card]: https://goreportcard.com/report/github.com/kube-green/kube-green
[test-and-build-svg]: https://github.com/kube-green/kube-green/actions/workflows/test.yml/badge.svg
[test-and-build]: https://github.com/kube-green/kube-green/actions/workflows/test.yml
[coverage-badge]: https://coveralls.io/repos/github/kube-green/kube-green/badge.svg?branch=main
[coverage]: https://coveralls.io/github/kube-green/kube-green?branch=main
[website-badge]: https://img.shields.io/static/v1?label=kube-green&color=blue&message=docs&style=flat
[website]: https://kube-green.dev
[security-badge]: https://github.com/kube-green/kube-green/actions/workflows/security.yml/badge.svg
[security-pipelines]: https://github.com/kube-green/kube-green/actions/workflows/security.yml
[adopters-badge]: https://img.shields.io/static/v1?label=ADOPTERS&color=blue&message=docs&style=flat
[adopters]: https://kube-green.dev/docs/adopters/
[add-adopters]: https://github.com/kube-green/kube-green.github.io/blob/main/CONTRIBUTING.md#add-your-organization-to-adopters
[cncf-badge]: https://img.shields.io/badge/CNCF%20Landscape-5699C6
[cncf-landscape]: https://landscape.cncf.io/?item=orchestration-management--scheduling-orchestration--kube-green
