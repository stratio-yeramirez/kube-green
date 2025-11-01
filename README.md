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

If you already use *kube-green*, add yourself as an [adopter][add-adopters]!

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes. See how to install the project on a live system in our [docs](https://kube-green.dev/docs/installation/).

### Prerequisites

Make sure you have Go installed ([download](https://go.dev/dl/)). Version 1.19 or higher is required.

## Installation

To have *kube-green* running locally just clone this repository and install the dependencies running:

```golang
go get
```

## Running the tests

There are different types of tests in this repository.

It is possible to run all the unit tests with

```sh
make test
```

To run integration tests installing kube-green with kustomize, run:

```sh
make e2e-test-kustomize
```

otherwise, to run integration tests installing kube-green with helm, run:

```sh
make e2e-test
```

It is possible to run only a specific harness integration test, running e2e-test with the OPTION variable:

```sh
make e2e-test OPTION="-run=TestSleepInfoE2E/kuttl/run_e2e_tests/harness/{TEST_NAME}"
```

## Deployment

To deploy *kube-green* in live systems, follow the [docs](https://kube-green.dev/docs/installation/).

To run kube-green for development purpose, you can use [ko](https://ko.build/) to deploy
in a KinD cluster.
It is possible to start a KinD cluster running `kind create cluster --name kube-green-development`.
To deploy kube-green using ko, run:

```sh
make local-run clusterName=kube-green-development
```

## Usage

The use of this operator is very simple. Once installed on the cluster, configure the desired CRD to make it works.

See [here](https://kube-green.dev/docs/configuration/) the documentation about the configuration of the CRD.

### CRD Examples

**Note:** The `timeZone` field uses IANA time zone identifiers. If not set, it defaults to UTC. You can set it to any valid timezone such as `Europe/Rome`, `America/New_York`, etc.

Pods running during working hours with Europe/Rome timezone, suspend CronJobs and exclude a deployment named `api-gateway`:

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

Pods sleep every night without restore:

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: working-hours-no-wakeup
spec:
  sleepAt: "20:00"
  timeZone: Europe/Rome
  weekdays: "*"
```

### Extended CRD Examples

**Note:** The following examples show how to use the extended functionality for managing CRDs (PgCluster, HDFSCluster, PgBouncer) directly without the helper script.

**Example 1: Suspend PostgreSQL cluster using native CRD support**

This example suspends a PgCluster CRD by setting the shutdown annotation. The postgres-operator will handle the actual shutdown:

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
  excludeRef:
    - matchLabels:
        app.kubernetes.io/managed-by: postgres-operator
        postgres.stratio.com/cluster: "true"
```

**Example 2: Suspend HDFS cluster using native CRD support**

This example suspends an HDFSCluster CRD by setting the shutdown annotation:

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: hdfs-schedule
  namespace: my-namespace
spec:
  weekdays: "1-5"
  sleepAt: "20:00"
  wakeUpAt: "08:00"
  timeZone: "America/Bogota"
  suspendStatefulSetsHdfs: true
  excludeRef:
    - matchLabels:
        app.kubernetes.io/managed-by: hdfs-operator
        hdfs.stratio.com/cluster: "true"
```

**Example 3: Suspend PgBouncer instances using native CRD support**

This example suspends PgBouncer CRDs by modifying the `spec.instances` field:

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: pgbouncer-schedule
  namespace: my-namespace
spec:
  weekdays: "1-5"
  sleepAt: "20:00"
  wakeUpAt: "08:00"
  timeZone: "America/Bogota"
  suspendDeploymentsPgbouncer: true
```

**Example 4: Staged wake-up for datastores namespace (Postgres, HDFS, PgBouncer, and native deployments)**

This example uses separate SleepInfos with shared annotations to implement staged wake-up. The `pair-id` and `pair-role` annotations allow the wake SleepInfos to find restore patches from the sleep SleepInfo:

**Sleep SleepInfo** (suspends all resources):

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: sleep-datastores
  namespace: my-datastores
  annotations:
    kube-green.stratio.com/pair-id: "my-datastores"
    kube-green.stratio.com/pair-role: "sleep"
spec:
  weekdays: "1-5"
  sleepAt: "20:00"
  timeZone: "America/Bogota"
  suspendDeployments: true
  suspendStatefulSets: true
  suspendCronJobs: true
  suspendDeploymentsPgbouncer: true
  suspendStatefulSetsPostgres: true
  suspendStatefulSetsHdfs: true
  excludeRef:
    - matchLabels:
        app.kubernetes.io/managed-by: postgres-operator
    - matchLabels:
        postgres.stratio.com/cluster: "true"
    - matchLabels:
        app.kubernetes.io/managed-by: hdfs-operator
    - matchLabels:
        hdfs.stratio.com/cluster: "true"
```

**Wake SleepInfo for Postgres and HDFS** (first stage - 5 minutes before others):

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: wake-datastores-pg-hdfs
  namespace: my-datastores
  annotations:
    kube-green.stratio.com/pair-id: "my-datastores"
    kube-green.stratio.com/pair-role: "wake"
spec:
  weekdays: "1-5"
  sleepAt: "07:55"
  timeZone: "America/Bogota"
  suspendStatefulSetsPostgres: true
  suspendStatefulSetsHdfs: true
  excludeRef:
    - matchLabels:
        app.kubernetes.io/managed-by: postgres-operator
    - matchLabels:
        postgres.stratio.com/cluster: "true"
    - matchLabels:
        app.kubernetes.io/managed-by: hdfs-operator
    - matchLabels:
        hdfs.stratio.com/cluster: "true"
```

**Wake SleepInfo for PgBouncer** (second stage - 2 minutes after Postgres/HDFS):

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: wake-datastores-pgbouncer
  namespace: my-datastores
  annotations:
    kube-green.stratio.com/pair-id: "my-datastores"
    kube-green.stratio.com/pair-role: "wake"
spec:
  weekdays: "1-5"
  sleepAt: "07:57"
  timeZone: "America/Bogota"
  suspendDeploymentsPgbouncer: true
```

**Wake SleepInfo for native deployments** (final stage - at wake time):

```yaml
apiVersion: kube-green.com/v1alpha1
kind: SleepInfo
metadata:
  name: wake-datastores
  namespace: my-datastores
  annotations:
    kube-green.stratio.com/pair-id: "my-datastores"
    kube-green.stratio.com/pair-role: "wake"
spec:
  weekdays: "1-5"
  sleepAt: "08:00"
  timeZone: "America/Bogota"
  suspendDeployments: true
  suspendStatefulSets: true
  suspendCronJobs: true
  suspendDeploymentsPgbouncer: true
  excludeRef:
    - matchLabels:
        app.kubernetes.io/managed-by: postgres-operator
    - matchLabels:
        postgres.stratio.com/cluster: "true"
    - matchLabels:
        app.kubernetes.io/managed-by: hdfs-operator
    - matchLabels:
        hdfs.stratio.com/cluster: "true"
```

**Note:** The staged wake-up ensures services start in the correct order: Postgres/HDFS first (needed by all), then PgBouncer (depends on Postgres), and finally native deployments (depend on databases).

To see other examples, go to [our docs](https://kube-green.dev/docs/configuration/#examples).

## Extensions

This fork includes extended functionality for managing Custom Resource Definitions (CRDs) like PgCluster, HDFSCluster, and PgBouncer, along with a helper script for multi-tenant environments.

### Extended CRD Support

This fork extends kube-green with native support for managing these CRDs:

- **PgCluster**: PostgreSQL clusters managed by the postgres-operator
- **HDFSCluster**: HDFS clusters managed by the hdfs-operator  
- **PgBouncer**: PgBouncer instances managed by the postgres-operator

These CRDs are managed through annotation-based patches:
- PgCluster: `pgcluster.stratio.com/shutdown=true|false`
- HDFSCluster: `hdfscluster.stratio.com/shutdown=true|false`
- PgBouncer: `spec.instances` field (native support)

### Staged Wake-Up

The extended version supports staged wake-up sequences to ensure proper service dependencies:
1. Postgres and HDFS clusters (needed for all services)
2. PgBouncer instances (5 minutes after, depends on Postgres)
3. Native Deployments/StatefulSets (7 minutes after, depend on databases)

### tenant_power.py Helper Script

For multi-tenant environments, use the `tenant_power.py` script to easily configure sleep/wake schedules. This script simplifies management by:

- Automatically converting local time (America/Bogota) to UTC
- Adjusting weekdays based on timezone conversion
- Creating SleepInfo configurations for all namespaces
- Applying staged wake-up sequences
- Managing Postgres, HDFS, PgBouncer, and native applications

#### Prerequisites

```bash
pip install ruamel.yaml
```

#### Quick Start Examples

**Example 1: Configure all services to sleep Monday-Friday at 10 PM and wake at 6 AM**

```bash
python3 tenant_power.py create --tenant bdadevprd --off 22:00 --on 06:00 \
    --weekdays "lunes-viernes" --apply
```

**Example 2: Configure only a specific namespace (airflowsso) to sleep Friday at 11 PM and wake Monday at 6 AM**

```bash
python3 tenant_power.py create --tenant bdadevprd --off 23:00 --on 06:00 \
    --sleepdays "viernes" --wakedays "lunes" --namespaces airflowsso --apply
```

**Example 3: Generate YAML file without applying (useful for review)**

```bash
python3 tenant_power.py create --tenant bdadevprd --off 22:00 --on 06:00 \
    --weekdays "lunes-viernes" --outdir ./yamls
```

**Example 4: View current configurations**

```bash
python3 tenant_power.py show --tenant bdadevprd
```

**Example 5: Update existing configurations**

```bash
python3 tenant_power.py update --tenant bdadevprd --off 23:00 --on 07:00 \
    --weekdays "lunes-viernes" --apply
```

#### Available Commands

- **create**: Create new sleep/wake configurations for a tenant
- **update**: Update existing configurations
- **show**: Display current configurations in a human-readable format

#### Command Options

- `--tenant`: Tenant name (required, e.g., `bdadevprd`, `bdadevdat`, `bdadevlab`)
- `--off`: Sleep time in local timezone (required, format `HH:MM`, e.g., `22:00`, `14:15`)
- `--on`: Wake time in local timezone (required, format `HH:MM`, e.g., `06:00`, `14:25`)
- `--weekdays`: Days of the week (default: all days). Can use human format (`"lunes-viernes"`, `"sábado"`) or numeric (`"1-5"`, `"6"`)
- `--sleepdays`: (Optional) Specific days for sleep. If not specified, uses `--weekdays`
- `--wakedays`: (Optional) Specific days for wake. If not specified, uses `--weekdays`
- `--namespaces`: (Optional) Limit to specific namespaces. Valid values: `datastores`, `apps`, `rocket`, `intelligence`, `airflowsso`
- `--apply`: Apply changes directly to Kubernetes cluster (without this, only generates YAML)
- `--outdir`: Directory to save generated YAML file (when not using `--apply`)

#### Supported Namespaces

The script manages these namespace types:
- **datastores**: Databases (Postgres, HDFS, PgBouncer)
- **apps**: Main applications
- **rocket**: Rocket services
- **intelligence**: Intelligence services
- **airflowsso**: Airflow SSO services

For more detailed usage, run:

```bash
python3 tenant_power.py --help
```

Or for specific command help:

```bash
python3 tenant_power.py create --help
python3 tenant_power.py update --help
python3 tenant_power.py show --help
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [release on this repository](https://github.com/kube-green/kube-green/releases).

### How to upgrade the version

To upgrade the version:

1. `make release version=v{{NEW_VERSION_TO_TAG}}` where `{{NEW_VERSION_TO_TAG}}` should be replaced with the next version to upgrade. N.B.: version should include `v` as first char.
2. `git push --tags origin v{{NEW_VERSION_TO_TAG}}`

## API Reference documentation

API reference is automatically generated with [this tool](https://github.com/ahmetb/gen-crd-api-reference-docs). To generate it automatically, are added in api versioned folder a file `doc.go` with the content of file `groupversion_info.go` and a comment with `+genclient` in the `sleepinfo_types.go` file for the resource type.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

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
