package v1alpha1

// +kubebuilder:rbac:groups=apps,resources=deployments;statefulsets,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=batch,resources=cronjobs,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=postgres.stratio.com,resources=pgbouncer;pgcluster,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=hdfs.stratio.com,resources=hdfscluster,verbs=get;list;watch;update;patch

var DeploymentTarget = PatchTarget{
	Group: "apps",
	Kind:  "Deployment",
}

var StatefulSetTarget = PatchTarget{
	Group: "apps",
	Kind:  "StatefulSet",
}

var CronJobTarget = PatchTarget{
	Group: "batch",
	Kind:  "CronJob",
}

var deploymentPatch = Patch{
	Target: DeploymentTarget,
	Patch: `
- op: add
  path: /spec/replicas
  value: 0`,
}

var statefulSetPatch = Patch{
	Target: StatefulSetTarget,
	Patch: `
- op: add
  path: /spec/replicas
  value: 0`,
}

var cronjobPatch = Patch{
	Target: CronJobTarget,
	Patch: `
- op: add
  path: /spec/suspend
  value: true`,
}

// EXTENSIÓN: Patches para CRDs personalizados

var PgBouncerTarget = PatchTarget{
	Group: "postgres.stratio.com",
	Kind:  "PgBouncer",
}

var PgClusterTarget = PatchTarget{
	Group: "postgres.stratio.com",
	Kind:  "PgCluster",
}

var HDFSClusterTarget = PatchTarget{
	Group: "hdfs.stratio.com",
	Kind:  "HDFSCluster",
}

// Patch para PgBouncer: modifica spec.instances (usa replace porque el campo siempre existe)
var pgbouncerPatch = Patch{
	Target: PgBouncerTarget,
	Patch: `
- op: replace
  path: /spec/instances
  value: 0`,
}

// Patch para PgCluster: anotación shutdown=true (SLEEP)
var PgclusterSleepPatch = Patch{
	Target: PgClusterTarget,
	Patch: `
- op: add
  path: /metadata/annotations/pgcluster.stratio.com~1shutdown
  value: "true"`,
}

// Patch para PgCluster: anotación shutdown=false (WAKE)
// Usa "replace" porque la anotación ya existe (fue agregada durante SLEEP)
var PgclusterWakePatch = Patch{
	Target: PgClusterTarget,
	Patch: `
- op: replace
  path: /metadata/annotations/pgcluster.stratio.com~1shutdown
  value: "false"`,
}

// Patch para HDFSCluster: anotación shutdown=true (SLEEP)
// HDFSCluster se controla por anotación hdfscluster.stratio.com/shutdown (igual que PgCluster).
// El operador detecta la anotación y escala los StatefulSets a 0.
var HdfsclusterSleepPatch = Patch{
	Target: HDFSClusterTarget,
	Patch: `
- op: add
  path: /metadata/annotations/hdfscluster.stratio.com~1shutdown
  value: "true"`,
}

// Patch para HDFSCluster: anotación shutdown=false (WAKE)
// Usa "replace" porque la anotación ya existe (fue agregada durante SLEEP)
// El operador detecta la anotación false y restaura los StatefulSets.
// NOTA: No se guarda restore patch porque el operador restaura basándose en el spec original.
var HdfsclusterWakePatch = Patch{
	Target: HDFSClusterTarget,
	Patch: `
- op: replace
  path: /metadata/annotations/hdfscluster.stratio.com~1shutdown
  value: "false"`,
}
