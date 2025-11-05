/*
Copyright 2025.
*/

package v1

import (
	"context"
	"fmt"
	"sort"
	"strings"

	kubegreenv1alpha1 "github.com/kube-green/kube-green/api/v1alpha1"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const (
	// ValidNamespaceSuffixes are the supported namespace suffixes
	ValidNamespaceSuffixes = "datastores,apps,rocket,intelligence,airflowsso"
)

var (
	validSuffixes = []string{"datastores", "apps", "rocket", "intelligence", "airflowsso"}
)

// ScheduleService handles schedule operations
type ScheduleService struct {
	client client.Client
	logger logger
}

type logger interface {
	Info(msg string, keysAndValues ...interface{})
	Error(err error, msg string, keysAndValues ...interface{})
}

// NewScheduleService creates a new schedule service
func NewScheduleService(c client.Client, l logger) *ScheduleService {
	return &ScheduleService{
		client: c,
		logger: l,
	}
}

// CreateSchedule creates SleepInfo objects for the tenant
func (s *ScheduleService) CreateSchedule(ctx context.Context, req CreateScheduleRequest) error {
	// 1. Normalize weekdays
	wdDefault := "0-6"
	if req.Weekdays != "" {
		var err error
		wdDefault, err = HumanWeekdaysToKube(req.Weekdays)
		if err != nil {
			return fmt.Errorf("invalid weekdays: %w", err)
		}
	}

	wdSleep := wdDefault
	if req.SleepDays != "" {
		var err error
		wdSleep, err = HumanWeekdaysToKube(req.SleepDays)
		if err != nil {
			return fmt.Errorf("invalid sleep days: %w", err)
		}
	}

	wdWake := wdDefault
	if req.WakeDays != "" {
		var err error
		wdWake, err = HumanWeekdaysToKube(req.WakeDays)
		if err != nil {
			return fmt.Errorf("invalid wake days: %w", err)
		}
	}

	// 2. Convert times from user timezone to cluster timezone
	userTZ := req.UserTimezone
	if userTZ == "" {
		userTZ = TZLocal // Default to America/Bogota
	}
	clusterTZ := req.ClusterTimezone
	if clusterTZ == "" {
		clusterTZ = TZUTC // Default to UTC
	}

	offConv, err := ToUTCHHMMWithTimezone(req.Off, userTZ, clusterTZ)
	if err != nil {
		return fmt.Errorf("invalid off time: %w", err)
	}

	onConv, err := ToUTCHHMMWithTimezone(req.On, userTZ, clusterTZ)
	if err != nil {
		return fmt.Errorf("invalid on time: %w", err)
	}

	// 3. Adjust weekdays for timezone shift
	wdSleepUTC, err := ShiftWeekdaysStr(wdSleep, offConv.DayShift)
	if err != nil {
		return fmt.Errorf("failed to shift sleep weekdays: %w", err)
	}

	wdWakeUTC, err := ShiftWeekdaysStr(wdWake, onConv.DayShift)
	if err != nil {
		return fmt.Errorf("failed to shift wake weekdays: %w", err)
	}

	// 4. Calculate staggered wake times based on delays
	onPgHDFS := onConv.TimeUTC
	onPgBouncer := onConv.TimeUTC
	onDeployments := onConv.TimeUTC

	if req.Delays != nil {
		// Parse delays and apply them
		if req.Delays.SuspendDeploymentsPgbouncer != "" {
			pgbouncerDelay, _ := parseDelayToMinutes(req.Delays.SuspendDeploymentsPgbouncer)
			onPgBouncer, _ = AddMinutes(onConv.TimeUTC, pgbouncerDelay)
		} else {
			// Default: 5 minutes
			onPgBouncer, _ = AddMinutes(onConv.TimeUTC, 5)
		}

		if req.Delays.SuspendDeployments != "" {
			deployDelay, _ := parseDelayToMinutes(req.Delays.SuspendDeployments)
			onDeployments, _ = AddMinutes(onConv.TimeUTC, deployDelay)
		} else {
			// Default: 7 minutes
			onDeployments, _ = AddMinutes(onConv.TimeUTC, 7)
		}
	} else {
		// Default delays if not specified
		onPgBouncer, _ = AddMinutes(onConv.TimeUTC, 5)
		onDeployments, _ = AddMinutes(onConv.TimeUTC, 7)
	}

	// 5. Determine which namespaces to process
	selectedNamespaces := normalizeNamespaces(req.Namespaces)

	// 6. Build excludeRef from exclusions
	hasCustomExclusions := len(req.Exclusions) > 0

	// 7. Create SleepInfo objects for each namespace
	// NO iterar sobre validSuffixes hardcodeados - usar los namespaces seleccionados dinámicamente
	for suffix := range selectedNamespaces {
		namespace := fmt.Sprintf("%s-%s", req.Tenant, suffix)

		// Build excludeRef from exclusions
		excludeRefs := getExcludeRefsForOperators()
		if hasCustomExclusions {
			for _, excl := range req.Exclusions {
				if excl.Namespace == namespace {
					excludeRefs = append(excludeRefs, kubegreenv1alpha1.FilterRef{
						MatchLabels: excl.Filter.MatchLabels,
					})
				}
			}
		}

		// Use new functions with exclusions if custom exclusions or delays are provided
		if hasCustomExclusions || req.Delays != nil {
			// Create SleepInfos based on namespace type using new functions
			switch suffix {
			case "datastores":
				if err := s.createDatastoresSleepInfosWithExclusions(ctx, req.Tenant, namespace, offConv.TimeUTC, onDeployments, onPgHDFS, onPgBouncer, wdSleepUTC, wdWakeUTC, excludeRefs); err != nil {
					return fmt.Errorf("failed to create datastores sleepinfos: %w", err)
				}
			case "apps", "rocket", "intelligence":
				if err := s.createNamespaceSleepInfoWithExclusions(ctx, req.Tenant, namespace, suffix, offConv.TimeUTC, onDeployments, wdSleepUTC, wdWakeUTC, false, excludeRefs); err != nil {
					return fmt.Errorf("failed to create %s sleepinfo: %w", suffix, err)
				}
			case "airflowsso":
				if err := s.createNamespaceSleepInfoWithExclusions(ctx, req.Tenant, namespace, suffix, offConv.TimeUTC, onDeployments, wdSleepUTC, wdWakeUTC, true, excludeRefs); err != nil {
					return fmt.Errorf("failed to create airflowsso sleepinfo: %w", err)
				}
			}
		} else {
			// Use wrapper functions for backward compatibility when no custom delays/exclusions
			switch suffix {
			case "datastores":
				if err := s.createDatastoresSleepInfos(ctx, req.Tenant, namespace, offConv.TimeUTC, onDeployments, onPgHDFS, onPgBouncer, wdSleepUTC, wdWakeUTC); err != nil {
					return fmt.Errorf("failed to create datastores sleepinfos: %w", err)
				}
			case "apps", "rocket", "intelligence":
				if err := s.createNamespaceSleepInfo(ctx, req.Tenant, namespace, suffix, offConv.TimeUTC, onDeployments, wdSleepUTC, wdWakeUTC, false); err != nil {
					return fmt.Errorf("failed to create %s sleepinfo: %w", suffix, err)
				}
			case "airflowsso":
				if err := s.createNamespaceSleepInfo(ctx, req.Tenant, namespace, suffix, offConv.TimeUTC, onDeployments, wdSleepUTC, wdWakeUTC, true); err != nil {
					return fmt.Errorf("failed to create airflowsso sleepinfo: %w", err)
				}
			}
		}
	}

	return nil
}

// parseDelayToMinutes parses a delay string (e.g., "5m", "10m", "30s") to minutes
func parseDelayToMinutes(delayStr string) (int, error) {
	if delayStr == "" {
		return 0, nil
	}

	// Remove trailing 'm' or 's' or 'h'
	delayStr = strings.TrimSpace(delayStr)
	if len(delayStr) < 2 {
		return 0, fmt.Errorf("invalid delay format: %s", delayStr)
	}

	unit := delayStr[len(delayStr)-1:]
	valueStr := delayStr[:len(delayStr)-1]

	var value int
	if _, err := fmt.Sscanf(valueStr, "%d", &value); err != nil {
		return 0, fmt.Errorf("invalid delay value: %s", delayStr)
	}

	switch unit {
	case "s":
		return value / 60, nil
	case "m":
		return value, nil
	case "h":
		return value * 60, nil
	default:
		return 0, fmt.Errorf("invalid delay unit: %s (expected s, m, or h)", unit)
	}
}

// normalizeNamespaces normalizes namespace input
// NO filtra por validSuffixes - acepta cualquier namespace dinámicamente
func normalizeNamespaces(nsInput []string) map[string]bool {
	result := make(map[string]bool)

	// Si no hay input, retornar mapa vacío (no todos los namespaces por defecto)
	// El llamado debe especificar explícitamente los namespaces deseados
	if len(nsInput) == 0 {
		return result
	}

	// Agregar todos los namespaces proporcionados (sin filtrar por validSuffixes)
	for _, ns := range nsInput {
		ns = strings.ToLower(strings.TrimSpace(ns))
		if ns != "" {
			result[ns] = true
		}
	}

	return result
}

func isNamespaceSelected(selected map[string]bool, suffix string) bool {
	return selected[suffix]
}

// createNamespaceSleepInfoWithExclusions creates a simple SleepInfo for a namespace with custom exclusions
func (s *ScheduleService) createNamespaceSleepInfoWithExclusions(ctx context.Context, tenant, namespace, suffix, offUTC, onUTC, wdSleep, wdWake string, suspendStatefulSets bool, excludeRefs []kubegreenv1alpha1.FilterRef) error {
	// Check if weekdays are the same
	sleepDays, _ := ExpandWeekdaysStr(wdSleep)
	wakeDays, _ := ExpandWeekdaysStr(wdWake)

	daysEqual := len(sleepDays) == len(wakeDays)
	if daysEqual {
		for i, d := range sleepDays {
			if i >= len(wakeDays) || d != wakeDays[i] {
				daysEqual = false
				break
			}
		}
	}

	var sleepInfo *kubegreenv1alpha1.SleepInfo

	if daysEqual {
		// Single SleepInfo with sleepAt and wakeUpAt
		suspendDeployments := true
		suspendCronJobs := true
		sleepInfo = &kubegreenv1alpha1.SleepInfo{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("%s-%s", tenant, suffix),
				Namespace: namespace,
			},
			Spec: kubegreenv1alpha1.SleepInfoSpec{
				Weekdays:           wdSleep,
				SleepTime:          offUTC,
				WakeUpTime:         onUTC,
				TimeZone:           "UTC",
				SuspendDeployments: &suspendDeployments,
				SuspendStatefulSets: func() *bool {
					b := suspendStatefulSets
					return &b
				}(),
				SuspendCronjobs: suspendCronJobs,
			},
		}

		// Add Virtualizer exclusion for apps
		if suffix == "apps" {
			virtualizerExclusion := kubegreenv1alpha1.FilterRef{
				MatchLabels: map[string]string{
					"cct.stratio.com/application_id": fmt.Sprintf("virtualizer.%s", namespace),
				},
			}
			excludeRefs = append(excludeRefs, virtualizerExclusion)
		}

		if len(excludeRefs) > 0 {
			sleepInfo.Spec.ExcludeRef = excludeRefs
		}
	} else {
		// Separate SleepInfos for sleep and wake
		sharedID := fmt.Sprintf("%s-%s", tenant, suffix)
		suspendDeployments := true
		suspendCronJobs := true

		// Sleep SleepInfo
		sleepSleepInfo := &kubegreenv1alpha1.SleepInfo{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("sleep-%s-%s", tenant, suffix),
				Namespace: namespace,
				Annotations: map[string]string{
					"kube-green.stratio.com/pair-id":   sharedID,
					"kube-green.stratio.com/pair-role": "sleep",
				},
			},
			Spec: kubegreenv1alpha1.SleepInfoSpec{
				Weekdays:           wdSleep,
				SleepTime:          offUTC,
				TimeZone:           "UTC",
				SuspendDeployments: &suspendDeployments,
				SuspendStatefulSets: func() *bool {
					b := suspendStatefulSets
					return &b
				}(),
				SuspendCronjobs: suspendCronJobs,
			},
		}

		// Wake SleepInfo
		wakeSleepInfo := &kubegreenv1alpha1.SleepInfo{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("wake-%s-%s", tenant, suffix),
				Namespace: namespace,
				Annotations: map[string]string{
					"kube-green.stratio.com/pair-id":   sharedID,
					"kube-green.stratio.com/pair-role": "wake",
				},
			},
			Spec: kubegreenv1alpha1.SleepInfoSpec{
				Weekdays:           wdWake,
				SleepTime:          onUTC,
				TimeZone:           "UTC",
				SuspendDeployments: &suspendDeployments,
				SuspendStatefulSets: func() *bool {
					b := suspendStatefulSets
					return &b
				}(),
				SuspendCronjobs: suspendCronJobs,
			},
		}

		// Add Virtualizer exclusion for apps
		if suffix == "apps" {
			virtualizerExclusion := kubegreenv1alpha1.FilterRef{
				MatchLabels: map[string]string{
					"cct.stratio.com/application_id": fmt.Sprintf("virtualizer.%s", namespace),
				},
			}
			excludeRefs = append(excludeRefs, virtualizerExclusion)
		}

		if len(excludeRefs) > 0 {
			sleepSleepInfo.Spec.ExcludeRef = excludeRefs
			wakeSleepInfo.Spec.ExcludeRef = excludeRefs
		}

		// Create both
		if err := s.client.Create(ctx, sleepSleepInfo); err != nil {
			if !strings.Contains(err.Error(), "already exists") {
				return err
			}
		}

		sleepInfo = wakeSleepInfo
	}

	// Create or update the SleepInfo
	if err := s.createOrUpdateSleepInfo(ctx, sleepInfo); err != nil {
		return err
	}

	return nil
}

// createDatastoresSleepInfosWithExclusions creates the complex SleepInfos for datastores namespace with custom exclusions
func (s *ScheduleService) createDatastoresSleepInfosWithExclusions(ctx context.Context, tenant, namespace, offUTC, onDeployments, onPgHDFS, onPgBouncer, wdSleep, wdWake string, excludeRefs []kubegreenv1alpha1.FilterRef) error {
	suspendDeployments := true
	suspendStatefulSets := true
	suspendCronJobs := true
	suspendPgbouncer := true
	suspendPostgres := true
	suspendHdfs := true

	// Check if weekdays are the same
	sleepDays, _ := ExpandWeekdaysStr(wdSleep)
	wakeDays, _ := ExpandWeekdaysStr(wdWake)

	daysEqual := len(sleepDays) == len(wakeDays)
	if daysEqual {
		for i, d := range sleepDays {
			if i >= len(wakeDays) || d != wakeDays[i] {
				daysEqual = false
				break
			}
		}
	}

	sharedID := fmt.Sprintf("%s-datastores", tenant)

	if daysEqual {
		// Single sleep SleepInfo with all resources
		sleepInfo := &kubegreenv1alpha1.SleepInfo{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("sleep-ds-deploys-%s", tenant),
				Namespace: namespace,
				Annotations: map[string]string{
					"kube-green.stratio.com/pair-id":   sharedID,
					"kube-green.stratio.com/pair-role": "sleep",
				},
			},
			Spec: kubegreenv1alpha1.SleepInfoSpec{
				Weekdays:                    wdSleep,
				SleepTime:                   offUTC,
				TimeZone:                    "UTC",
				SuspendDeployments:          &suspendDeployments,
				SuspendStatefulSets:         &suspendStatefulSets,
				SuspendCronjobs:             suspendCronJobs,
				SuspendDeploymentsPgbouncer: &suspendPgbouncer,
				SuspendStatefulSetsPostgres: &suspendPostgres,
				SuspendStatefulSetsHdfs:     &suspendHdfs,
				ExcludeRef:                  excludeRefs,
			},
		}

		// Create wake SleepInfos (staged)
		// 1. Postgres and HDFS first
		wakePgHdfs := &kubegreenv1alpha1.SleepInfo{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("wake-ds-deploys-%s-pg-hdfs", tenant),
				Namespace: namespace,
				Annotations: map[string]string{
					"kube-green.stratio.com/pair-id":   sharedID,
					"kube-green.stratio.com/pair-role": "wake",
				},
			},
			Spec: kubegreenv1alpha1.SleepInfoSpec{
				Weekdays:                    wdWake,
				SleepTime:                   onPgHDFS,
				TimeZone:                    "UTC",
				SuspendStatefulSetsPostgres: &suspendPostgres,
				SuspendStatefulSetsHdfs:     &suspendHdfs,
				ExcludeRef:                  excludeRefs,
			},
		}

		// 2. PgBouncer second
		wakePgbouncer := &kubegreenv1alpha1.SleepInfo{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("wake-ds-deploys-%s-pgbouncer", tenant),
				Namespace: namespace,
				Annotations: map[string]string{
					"kube-green.stratio.com/pair-id":   sharedID,
					"kube-green.stratio.com/pair-role": "wake",
				},
			},
			Spec: kubegreenv1alpha1.SleepInfoSpec{
				Weekdays:                    wdWake,
				SleepTime:                   onPgBouncer,
				TimeZone:                    "UTC",
				SuspendDeploymentsPgbouncer: &suspendPgbouncer,
				ExcludeRef:                  excludeRefs,
			},
		}

		// 3. Native deployments last
		wakeDeployments := &kubegreenv1alpha1.SleepInfo{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("wake-ds-deploys-%s", tenant),
				Namespace: namespace,
				Annotations: map[string]string{
					"kube-green.stratio.com/pair-id":   sharedID,
					"kube-green.stratio.com/pair-role": "wake",
				},
			},
			Spec: kubegreenv1alpha1.SleepInfoSpec{
				Weekdays:                    wdWake,
				SleepTime:                   onDeployments,
				TimeZone:                    "UTC",
				SuspendDeployments:          &suspendDeployments,
				SuspendStatefulSets:         &suspendStatefulSets,
				SuspendCronjobs:             suspendCronJobs,
				SuspendDeploymentsPgbouncer: &suspendPgbouncer,
				ExcludeRef:                  excludeRefs,
			},
		}

		sleepInfos := []*kubegreenv1alpha1.SleepInfo{sleepInfo, wakePgHdfs, wakePgbouncer, wakeDeployments}
		for _, si := range sleepInfos {
			if err := s.createOrUpdateSleepInfo(ctx, si); err != nil {
				return err
			}
		}
	} else {
		// TODO: Implement different weekdays logic
		return fmt.Errorf("different weekdays for sleep/wake not yet implemented for datastores")
	}

	return nil
}

// createDatastoresSleepInfos creates the complex SleepInfos for datastores namespace (wrapper for backward compatibility)
func (s *ScheduleService) createDatastoresSleepInfos(ctx context.Context, tenant, namespace, offUTC, onDeployments, onPgHDFS, onPgBouncer, wdSleep, wdWake string) error {
	excludeRefs := getExcludeRefsForOperators()
	return s.createDatastoresSleepInfosWithExclusions(ctx, tenant, namespace, offUTC, onDeployments, onPgHDFS, onPgBouncer, wdSleep, wdWake, excludeRefs)
}

// createNamespaceSleepInfo creates a simple SleepInfo for a namespace (wrapper for backward compatibility)
func (s *ScheduleService) createNamespaceSleepInfo(ctx context.Context, tenant, namespace, suffix, offUTC, onUTC, wdSleep, wdWake string, suspendStatefulSets bool) error {
	excludeRefs := getExcludeRefsForOperators()
	return s.createNamespaceSleepInfoWithExclusions(ctx, tenant, namespace, suffix, offUTC, onUTC, wdSleep, wdWake, suspendStatefulSets, excludeRefs)
}

// getExcludeRefsForOperators returns exclude refs for operator-managed resources
func getExcludeRefsForOperators() []kubegreenv1alpha1.FilterRef {
	return []kubegreenv1alpha1.FilterRef{
		{MatchLabels: map[string]string{"app.kubernetes.io/managed-by": "postgres-operator"}},
		{MatchLabels: map[string]string{"postgres.stratio.com/cluster": "true"}},
		{MatchLabels: map[string]string{"app.kubernetes.io/part-of": "postgres"}},
		{MatchLabels: map[string]string{"app.kubernetes.io/managed-by": "hdfs-operator"}},
		{MatchLabels: map[string]string{"hdfs.stratio.com/cluster": "true"}},
		{MatchLabels: map[string]string{"app.kubernetes.io/part-of": "hdfs"}},
	}
}

// createOrUpdateSleepInfo creates or updates a SleepInfo
func (s *ScheduleService) createOrUpdateSleepInfo(ctx context.Context, sleepInfo *kubegreenv1alpha1.SleepInfo) error {
	var existing kubegreenv1alpha1.SleepInfo
	err := s.client.Get(ctx, client.ObjectKeyFromObject(sleepInfo), &existing)
	if err != nil {
		if client.IgnoreNotFound(err) == nil {
			// Not found, create
			return s.client.Create(ctx, sleepInfo)
		}
		return err
	}

	// Exists, update
	sleepInfo.ResourceVersion = existing.ResourceVersion
	return s.client.Update(ctx, sleepInfo)
}

// ScheduleResponse represents a schedule for a tenant
type ScheduleResponse struct {
	Tenant     string                   `json:"tenant"`
	Namespaces map[string]NamespaceInfo `json:"namespaces"`
}

// NamespaceInfo represents schedule information for a namespace
type NamespaceInfo struct {
	Namespace string             `json:"namespace"`
	Weekdays  string             `json:"weekdays"`
	Timezone  string             `json:"timezone"`
	Schedule  []SleepInfoSummary `json:"schedule"` // Chronologically ordered schedule
	Summary   ScheduleSummary    `json:"summary"`  // Human-readable summary
}

// ScheduleSummary provides a human-readable summary of the schedule
type ScheduleSummary struct {
	SleepTime   string   `json:"sleepTime,omitempty"` // When resources go to sleep
	WakeTime    string   `json:"wakeTime,omitempty"`  // When resources wake up
	Operations  []string `json:"operations"`          // List of operations in order
	Description string   `json:"description"`         // Human-readable description
}

// FilterRef represents a filter for excluding resources
type FilterRef struct {
	MatchLabels map[string]string `json:"matchLabels"`
}

// SleepInfoSummary represents a summary of a SleepInfo
type SleepInfoSummary struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Role        string            `json:"role"`      // "sleep" or "wake"
	Operation   string            `json:"operation"` // Human-readable description
	Time        string            `json:"time"`      // Sleep or wake time
	Weekdays    string            `json:"weekdays"`
	TimeZone    string            `json:"timeZone"`
	Resources   []string          `json:"resources"` // List of resources managed (Postgres, HDFS, PgBouncer, Deployments, etc.)
	WakeTime    string            `json:"wakeTime,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
	ExcludeRef  []FilterRef       `json:"excludeRef,omitempty"` // Exclusion filters
}

// ListSchedules lists all schedules grouped by tenant
func (s *ScheduleService) ListSchedules(ctx context.Context) ([]ScheduleResponse, error) {
	// List all SleepInfos across all namespaces
	sleepInfoList := &kubegreenv1alpha1.SleepInfoList{}
	if err := s.client.List(ctx, sleepInfoList); err != nil {
		return nil, fmt.Errorf("failed to list SleepInfos: %w", err)
	}

	// Group by tenant (extract from namespace: tenant-suffix)
	tenantMap := make(map[string]map[string][]kubegreenv1alpha1.SleepInfo)

	for _, si := range sleepInfoList.Items {
		// Extract tenant from namespace (e.g., "bdadevdat-datastores" -> "bdadevdat")
		nsParts := strings.Split(si.Namespace, "-")
		if len(nsParts) < 2 {
			continue // Skip namespaces that don't match tenant-suffix pattern
		}

		// Reconstruct tenant (handle cases like "bdadevdat-datastores")
		// Take all parts except the last one as tenant
		tenant := strings.Join(nsParts[:len(nsParts)-1], "-")
		suffix := nsParts[len(nsParts)-1]

		if tenantMap[tenant] == nil {
			tenantMap[tenant] = make(map[string][]kubegreenv1alpha1.SleepInfo)
		}

		tenantMap[tenant][suffix] = append(tenantMap[tenant][suffix], si)
	}

	// Convert to response format
	result := make([]ScheduleResponse, 0, len(tenantMap))
	for tenant, namespaceGroups := range tenantMap {
		namespaces := make(map[string]NamespaceInfo)
		for suffix, sleepInfos := range namespaceGroups {
			namespaces[suffix] = buildNamespaceInfo(sleepInfos)
		}
		result = append(result, ScheduleResponse{
			Tenant:     tenant,
			Namespaces: namespaces,
		})
	}

	return result, nil
}

// GetSchedule gets all SleepInfos for a specific tenant
func (s *ScheduleService) GetSchedule(ctx context.Context, tenant string, namespaceSuffix ...string) (*ScheduleResponse, error) {
	// List all SleepInfos
	sleepInfoList := &kubegreenv1alpha1.SleepInfoList{}
	if err := s.client.List(ctx, sleepInfoList); err != nil {
		return nil, fmt.Errorf("failed to list SleepInfos: %w", err)
	}

	namespaces := make(map[string]NamespaceInfo)
	var filterNamespace string
	if len(namespaceSuffix) > 0 && namespaceSuffix[0] != "" {
		filterNamespace = namespaceSuffix[0]
	}

	// Filter by tenant and group by namespace suffix
	namespaceGroups := make(map[string][]kubegreenv1alpha1.SleepInfo)
	for _, si := range sleepInfoList.Items {
		// Extract tenant from namespace
		nsParts := strings.Split(si.Namespace, "-")
		if len(nsParts) < 2 {
			continue
		}

		tenantFromNS := strings.Join(nsParts[:len(nsParts)-1], "-")
		if tenantFromNS != tenant {
			continue
		}

		suffix := nsParts[len(nsParts)-1]

		// Filter by namespace suffix if provided
		if filterNamespace != "" && suffix != filterNamespace {
			continue
		}

		namespaceGroups[suffix] = append(namespaceGroups[suffix], si)
	}

	if len(namespaceGroups) == 0 {
		if filterNamespace != "" {
			return nil, fmt.Errorf("no schedules found for tenant: %s in namespace: %s", tenant, filterNamespace)
		}
		return nil, fmt.Errorf("no schedules found for tenant: %s", tenant)
	}

	// Process each namespace group
	for suffix, sleepInfos := range namespaceGroups {
		namespaceInfo := buildNamespaceInfo(sleepInfos)
		namespaces[suffix] = namespaceInfo
	}

	return &ScheduleResponse{
		Tenant:     tenant,
		Namespaces: namespaces,
	}, nil
}

// buildNamespaceInfo creates a NamespaceInfo from a list of SleepInfos
func buildNamespaceInfo(sleepInfos []kubegreenv1alpha1.SleepInfo) NamespaceInfo {
	if len(sleepInfos) == 0 {
		return NamespaceInfo{}
	}

	// Get common info from first SleepInfo
	first := sleepInfos[0]
	nsInfo := NamespaceInfo{
		Namespace: first.Namespace,
		Weekdays:  first.Spec.Weekdays,
		Timezone:  first.Spec.TimeZone,
	}

	// Convert weekdays to human-readable (keep numeric for now, can enhance later)
	// For now, just use the numeric format

	// Build summaries for each SleepInfo
	summaries := make([]SleepInfoSummary, 0, len(sleepInfos))
	var sleepTime, wakeTime string
	var operations []string

	for _, si := range sleepInfos {
		summary := buildSleepInfoSummary(si)
		summaries = append(summaries, summary)

		// Track times for summary
		if summary.Role == "sleep" && sleepTime == "" {
			sleepTime = summary.Time
		}
		if summary.Role == "wake" {
			if wakeTime == "" || summary.Time > wakeTime {
				wakeTime = summary.Time
			}
			operations = append(operations, fmt.Sprintf("%s a las %s (%s)", summary.Operation, summary.Time, strings.Join(summary.Resources, ", ")))
		} else if summary.Role == "sleep" {
			operations = append(operations, fmt.Sprintf("%s a las %s", summary.Operation, summary.Time))
		}
	}

	// Sort summaries by time
	sortSummariesByTime(summaries)
	nsInfo.Schedule = summaries

	// Build human-readable summary
	nsInfo.Summary = ScheduleSummary{
		SleepTime:   sleepTime,
		WakeTime:    wakeTime,
		Operations:  operations,
		Description: buildScheduleDescription(summaries),
	}

	return nsInfo
}

// buildSleepInfoSummary creates a SleepInfoSummary from a SleepInfo
func buildSleepInfoSummary(si kubegreenv1alpha1.SleepInfo) SleepInfoSummary {
	// Determine role from annotations or name
	role := "wake"
	operation := "Encender servicios"
	if pairRole, ok := si.Annotations["kube-green.stratio.com/pair-role"]; ok {
		role = pairRole
	} else if strings.HasPrefix(si.Name, "sleep-") {
		role = "sleep"
		operation = "Apagar servicios"
	}

	// Determine time
	time := si.Spec.SleepTime
	if time == "" {
		time = si.Spec.WakeUpTime
	}

	// Determine resources managed
	resources := determineManagedResources(si, role)

	// Build operation description
	operation = buildOperationDescription(role, resources)

	// Convert ExcludeRef to FilterRef format for API response
	excludeRefs := make([]FilterRef, 0)
	// IMPORTANTE: Verificar si ExcludeRef está presente y copiar correctamente
	if si.Spec.ExcludeRef != nil && len(si.Spec.ExcludeRef) > 0 {
		for _, excl := range si.Spec.ExcludeRef {
			// Asegurarse de que MatchLabels no es nil
			if excl.MatchLabels != nil && len(excl.MatchLabels) > 0 {
				excludeRefs = append(excludeRefs, FilterRef{
					MatchLabels: excl.MatchLabels,
				})
			}
		}
	}

	summary := SleepInfoSummary{
		Name:        si.Name,
		Namespace:   si.Namespace,
		Role:        role,
		Operation:   operation,
		Time:        time,
		Weekdays:    si.Spec.Weekdays,
		TimeZone:    si.Spec.TimeZone,
		WakeTime:    si.Spec.WakeUpTime,
		Resources:   resources,
		Annotations: si.Annotations,
		ExcludeRef:  excludeRefs,
	}

	return summary
}

// determineManagedResources determines which resources are managed by a SleepInfo
func determineManagedResources(si kubegreenv1alpha1.SleepInfo, role string) []string {
	var resources []string

	// Check CRD-specific flags
	if si.Spec.SuspendStatefulSetsPostgres != nil && *si.Spec.SuspendStatefulSetsPostgres {
		resources = append(resources, "Postgres")
	}
	if si.Spec.SuspendStatefulSetsHdfs != nil && *si.Spec.SuspendStatefulSetsHdfs {
		resources = append(resources, "HDFS")
	}
	if si.Spec.SuspendDeploymentsPgbouncer != nil && *si.Spec.SuspendDeploymentsPgbouncer {
		resources = append(resources, "PgBouncer")
	}

	// Check native resource flags
	if si.Spec.SuspendDeployments != nil && *si.Spec.SuspendDeployments {
		resources = append(resources, "Deployments")
	}
	if si.Spec.SuspendStatefulSets != nil && *si.Spec.SuspendStatefulSets {
		resources = append(resources, "StatefulSets")
	}
	if si.Spec.SuspendCronjobs {
		resources = append(resources, "CronJobs")
	}

	// If no specific resources, check role
	if len(resources) == 0 {
		if role == "sleep" {
			resources = []string{"Todos los servicios"}
		} else {
			resources = []string{"Todos los servicios"}
		}
	}

	return resources
}

// buildOperationDescription creates a human-readable operation description
func buildOperationDescription(role string, resources []string) string {
	action := "Encender"
	if role == "sleep" {
		action = "Apagar"
	}

	if len(resources) == 0 {
		return fmt.Sprintf("%s servicios", action)
	}

	if len(resources) == 1 {
		return fmt.Sprintf("%s %s", action, resources[0])
	}

	// Join all except last with comma, last with "y"
	if len(resources) == 2 {
		return fmt.Sprintf("%s %s y %s", action, resources[0], resources[1])
	}

	allButLast := strings.Join(resources[:len(resources)-1], ", ")
	return fmt.Sprintf("%s %s y %s", action, allButLast, resources[len(resources)-1])
}

// buildScheduleDescription creates a human-readable description of the schedule
func buildScheduleDescription(summaries []SleepInfoSummary) string {
	if len(summaries) == 0 {
		return "Sin programación configurada"
	}

	var parts []string
	for _, s := range summaries {
		parts = append(parts, fmt.Sprintf("%s a las %s", s.Operation, s.Time))
	}
	return strings.Join(parts, " → ")
}

// sortSummariesByTime sorts summaries chronologically (sleep first, then wake by time)
func sortSummariesByTime(summaries []SleepInfoSummary) {
	// Simple bubble sort for small lists
	for i := 0; i < len(summaries); i++ {
		for j := i + 1; j < len(summaries); j++ {
			// Sleep always comes before wake at same time
			if summaries[i].Role == "wake" && summaries[j].Role == "sleep" {
				if summaries[i].Time == summaries[j].Time {
					summaries[i], summaries[j] = summaries[j], summaries[i]
					continue
				}
			}
			// Sort by time
			if summaries[i].Time > summaries[j].Time {
				summaries[i], summaries[j] = summaries[j], summaries[i]
			}
		}
	}
}

// UpdateSchedule updates schedules for a tenant
// If fields are empty, they will be extracted from existing schedule
func (s *ScheduleService) UpdateSchedule(ctx context.Context, tenant string, req CreateScheduleRequest, namespaceSuffix ...string) error {
	var filterNamespace string
	if len(namespaceSuffix) > 0 && namespaceSuffix[0] != "" {
		filterNamespace = namespaceSuffix[0]
	}

	// If some fields are missing, try to get them from existing schedule
	if req.Weekdays == "" || req.Off == "" || req.On == "" {
		existing, err := s.GetSchedule(ctx, tenant, filterNamespace)
		if err == nil && existing != nil {
			// Extract values from existing schedule
			// Note: This is a simplified extraction - we take the first namespace schedule we find
			for _, nsInfo := range existing.Namespaces {
				if len(nsInfo.Schedule) > 0 {
					first := nsInfo.Schedule[0]
					if req.Weekdays == "" {
						req.Weekdays = first.Weekdays
					}
					if req.Off == "" {
						// Convert UTC back to local time for display (simplified - we'd need reverse conversion)
						// For now, we'll require off and on to be provided
						req.Off = first.Time
					}
					if req.On == "" {
						if first.WakeTime != "" {
							req.On = first.WakeTime
						}
					}
					break
				}
			}
		}
	}

	req.Tenant = tenant
	return s.CreateSchedule(ctx, req)
}

// DeleteSchedule deletes all SleepInfos for a tenant
func (s *ScheduleService) DeleteSchedule(ctx context.Context, tenant string, namespaceSuffix ...string) error {
	// List all SleepInfos
	sleepInfoList := &kubegreenv1alpha1.SleepInfoList{}
	if err := s.client.List(ctx, sleepInfoList); err != nil {
		return fmt.Errorf("failed to list SleepInfos: %w", err)
	}

	var filterNamespace string
	if len(namespaceSuffix) > 0 && namespaceSuffix[0] != "" {
		filterNamespace = namespaceSuffix[0]
	}

	// Find and delete all SleepInfos for the tenant
	deletedCount := 0
	for _, si := range sleepInfoList.Items {
		// Extract tenant from namespace
		nsParts := strings.Split(si.Namespace, "-")
		if len(nsParts) < 2 {
			continue
		}

		tenantFromNS := strings.Join(nsParts[:len(nsParts)-1], "-")
		if tenantFromNS != tenant {
			continue
		}

		suffix := nsParts[len(nsParts)-1]

		// Filter by namespace suffix if provided
		if filterNamespace != "" && suffix != filterNamespace {
			continue
		}

		// Delete associated secret first (if it exists)
		secretName := fmt.Sprintf("sleepinfo-%s", si.Name)
		secret := &v1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      secretName,
				Namespace: si.Namespace,
			},
		}
		if err := s.client.Delete(ctx, secret); err != nil {
			// Ignore not found errors (secret might not exist)
			if client.IgnoreNotFound(err) == nil {
				s.logger.Info("Secret not found or already deleted", "secret", secretName, "namespace", si.Namespace)
			} else {
				s.logger.Error(err, "failed to delete secret", "secret", secretName, "namespace", si.Namespace)
			}
		} else {
			s.logger.Info("Associated secret deleted", "secret", secretName, "namespace", si.Namespace)
		}

		// Delete the SleepInfo
		if err := s.client.Delete(ctx, &si); err != nil {
			s.logger.Error(err, "failed to delete SleepInfo", "name", si.Name, "namespace", si.Namespace)
			continue
		}

		deletedCount++
		s.logger.Info("SleepInfo deleted", "name", si.Name, "namespace", si.Namespace)
	}

	if deletedCount == 0 {
		if filterNamespace != "" {
			return fmt.Errorf("no schedules found for tenant: %s in namespace: %s", tenant, filterNamespace)
		}
		return fmt.Errorf("no schedules found for tenant: %s", tenant)
	}

	if filterNamespace != "" {
		s.logger.Info("Deleted schedules for tenant and namespace", "tenant", tenant, "namespace", filterNamespace, "count", deletedCount)
	} else {
		s.logger.Info("Deleted schedules for tenant", "tenant", tenant, "count", deletedCount)
	}
	return nil
}

// TenantInfo represents a discovered tenant
type TenantInfo struct {
	Name       string   `json:"name"`
	Namespaces []string `json:"namespaces"`
	CreatedAt  string   `json:"createdAt,omitempty"`
}

// TenantListResponse represents the response for listing tenants
type TenantListResponse struct {
	Tenants []TenantInfo `json:"tenants"`
}

// ListTenants discovers all tenants by scanning namespaces
func (s *ScheduleService) ListTenants(ctx context.Context) (*TenantListResponse, error) {
	// List all namespaces
	namespaceList := &v1.NamespaceList{}
	if err := s.client.List(ctx, namespaceList); err != nil {
		return nil, fmt.Errorf("failed to list namespaces: %w", err)
	}

	s.logger.Info("ListTenants", "total_namespaces_found", len(namespaceList.Items))

	// Map to track tenants and their namespaces (dinámico - sin filtrar por validSuffixes)
	tenantMap := make(map[string]map[string]bool)

	for _, ns := range namespaceList.Items {
		nsName := ns.Name

		// Check if namespace matches tenant-suffix pattern
		nsParts := strings.Split(nsName, "-")
		if len(nsParts) < 2 {
			continue // Skip namespaces that don't match pattern
		}

		// Extract tenant (all parts except last)
		tenant := strings.Join(nsParts[:len(nsParts)-1], "-")
		suffix := nsParts[len(nsParts)-1]

		// NO FILTRAR por validSuffixes - aceptar TODOS los namespaces que coincidan con el patrón
		// Esto permite descubrimiento dinámico de cualquier namespace que siga el patrón {tenant}-{prefix}

		// Initialize tenant map if needed
		if tenantMap[tenant] == nil {
			tenantMap[tenant] = make(map[string]bool)
		}

		// Add namespace suffix (prefix) dinámicamente
		tenantMap[tenant][suffix] = true
	}

	s.logger.Info("ListTenants", "total_tenants_found", len(tenantMap))
	if bdadevNamespaces, ok := tenantMap["bdadev"]; ok {
		s.logger.Info("ListTenants", "bdadev_namespaces_count", len(bdadevNamespaces))
	}

	// Convert to response format
	tenants := make([]TenantInfo, 0, len(tenantMap))
	for tenant, namespaces := range tenantMap {
		nsList := make([]string, 0, len(namespaces))
		for ns := range namespaces {
			nsList = append(nsList, ns)
		}
		// Sort namespaces for consistent ordering
		sort.Strings(nsList)

		tenants = append(tenants, TenantInfo{
			Name:       tenant,
			Namespaces: nsList,
		})
	}
	// Sort tenants by name for consistent ordering
	sort.Slice(tenants, func(i, j int) bool {
		return tenants[i].Name < tenants[j].Name
	})

	return &TenantListResponse{
		Tenants: tenants,
	}, nil
}

// ServiceInfo represents a Kubernetes service/resource
type ServiceInfo struct {
	Name          string            `json:"name"`
	Kind          string            `json:"kind"`
	Annotations   map[string]string `json:"annotations"`
	Labels        map[string]string `json:"labels"`
	Replicas      *int32            `json:"replicas,omitempty"`
	ReadyReplicas *int32            `json:"readyReplicas,omitempty"`
	Status        string            `json:"status,omitempty"`
}

// NamespaceServicesResponse represents services in a namespace
type NamespaceServicesResponse struct {
	Namespace string        `json:"namespace"`
	Services  []ServiceInfo `json:"services"`
}

// GetNamespaceServices lists all services (Deployments, StatefulSets, CronJobs) in a namespace
func (s *ScheduleService) GetNamespaceServices(ctx context.Context, tenant, namespaceSuffix string) (*NamespaceServicesResponse, error) {
	namespace := fmt.Sprintf("%s-%s", tenant, namespaceSuffix)

	services := make([]ServiceInfo, 0)

	// List Deployments
	deploymentList := &appsv1.DeploymentList{}
	if err := s.client.List(ctx, deploymentList, client.InNamespace(namespace)); err == nil {
		for _, dep := range deploymentList.Items {
			replicas := int32(0)
			if dep.Spec.Replicas != nil {
				replicas = *dep.Spec.Replicas
			}
			readyReplicas := dep.Status.ReadyReplicas

			status := "Running"
			if replicas == 0 {
				status = "Suspended"
			} else if readyReplicas < replicas {
				status = "Pending"
			}

			services = append(services, ServiceInfo{
				Name:          dep.Name,
				Kind:          "Deployment",
				Annotations:   dep.Annotations,
				Labels:        dep.Labels,
				Replicas:      &replicas,
				ReadyReplicas: &readyReplicas,
				Status:        status,
			})
		}
	}

	// List StatefulSets
	statefulSetList := &appsv1.StatefulSetList{}
	if err := s.client.List(ctx, statefulSetList, client.InNamespace(namespace)); err == nil {
		for _, sts := range statefulSetList.Items {
			replicas := int32(0)
			if sts.Spec.Replicas != nil {
				replicas = *sts.Spec.Replicas
			}
			readyReplicas := sts.Status.ReadyReplicas

			status := "Running"
			if replicas == 0 {
				status = "Suspended"
			} else if readyReplicas < replicas {
				status = "Pending"
			}

			services = append(services, ServiceInfo{
				Name:          sts.Name,
				Kind:          "StatefulSet",
				Annotations:   sts.Annotations,
				Labels:        sts.Labels,
				Replicas:      &replicas,
				ReadyReplicas: &readyReplicas,
				Status:        status,
			})
		}
	}

	// List CronJobs
	cronJobList := &batchv1.CronJobList{}
	if err := s.client.List(ctx, cronJobList, client.InNamespace(namespace)); err == nil {
		for _, cj := range cronJobList.Items {
			suspended := false
			if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
				suspended = true
			}

			status := "Running"
			if suspended {
				status = "Suspended"
			}

			services = append(services, ServiceInfo{
				Name:        cj.Name,
				Kind:        "CronJob",
				Annotations: cj.Annotations,
				Labels:      cj.Labels,
				Status:      status,
			})
		}
	}

	return &NamespaceServicesResponse{
		Namespace: namespace,
		Services:  services,
	}, nil
}

// SuspendedServiceInfo represents a suspended service
type SuspendedServiceInfo struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Kind        string `json:"kind"`
	SuspendedAt string `json:"suspendedAt"`
	Reason      string `json:"reason"`
	WillWakeAt  string `json:"willWakeAt,omitempty"`
}

// SuspendedServicesResponse represents suspended services for a tenant
type SuspendedServicesResponse struct {
	Tenant    string                 `json:"tenant"`
	Suspended []SuspendedServiceInfo `json:"suspended"`
}

// GetSuspendedServices lists currently suspended services for a tenant
func (s *ScheduleService) GetSuspendedServices(ctx context.Context, tenant string) (*SuspendedServicesResponse, error) {
	// List all SleepInfos for the tenant
	_, err := s.GetSchedule(ctx, tenant)
	if err != nil {
		return nil, fmt.Errorf("failed to get schedule: %w", err)
	}

	suspended := make([]SuspendedServiceInfo, 0)

	// TODO: Implement logic to check actual resource states
	// This would require:
	// 1. List Deployments/StatefulSets in each namespace
	// 2. Check if replicas are 0
	// 3. Check associated SleepInfo to determine when they were suspended
	// 4. Check when they will wake up based on wake schedule

	return &SuspendedServicesResponse{
		Tenant:    tenant,
		Suspended: suspended,
	}, nil
}

// NamespaceResourceInfo represents detected resources in a namespace
type NamespaceResourceInfo struct {
	Namespace      string            `json:"namespace"`
	HasPgCluster   bool              `json:"hasPgCluster"`
	HasHdfsCluster bool              `json:"hasHdfsCluster"`
	HasPgBouncer   bool              `json:"hasPgBouncer"`
	HasVirtualizer bool              `json:"hasVirtualizer"`
	ResourceCounts ResourceCounts    `json:"resourceCounts"`
	AutoExclusions []ExclusionFilter `json:"autoExclusions"`
}

// ResourceCounts represents counts of different resource types
type ResourceCounts struct {
	Deployments  int `json:"deployments"`
	StatefulSets int `json:"statefulSets"`
	CronJobs     int `json:"cronJobs"`
	PgClusters   int `json:"pgClusters"`
	HdfsClusters int `json:"hdfsClusters"`
	PgBouncers   int `json:"pgBouncers"`
}

// GetNamespaceResources detects CRDs and other resources in a namespace
func (s *ScheduleService) GetNamespaceResources(ctx context.Context, tenant, namespaceSuffix string) (*NamespaceResourceInfo, error) {
	namespace := fmt.Sprintf("%s-%s", tenant, namespaceSuffix)

	info := &NamespaceResourceInfo{
		Namespace:      namespace,
		HasPgCluster:   false,
		HasHdfsCluster: false,
		HasPgBouncer:   false,
		HasVirtualizer: false,
		ResourceCounts: ResourceCounts{},
		AutoExclusions: []ExclusionFilter{},
	}

	// List Deployments
	deploymentList := &appsv1.DeploymentList{}
	if err := s.client.List(ctx, deploymentList, client.InNamespace(namespace)); err == nil {
		info.ResourceCounts.Deployments = len(deploymentList.Items)

		// Check for Virtualizer (apps namespace)
		for _, dep := range deploymentList.Items {
			if appID, ok := dep.Labels["cct.stratio.com/application_id"]; ok {
				if strings.Contains(appID, "virtualizer") {
					info.HasVirtualizer = true
					break
				}
			}
		}
	}

	// List StatefulSets
	statefulSetList := &appsv1.StatefulSetList{}
	if err := s.client.List(ctx, statefulSetList, client.InNamespace(namespace)); err == nil {
		info.ResourceCounts.StatefulSets = len(statefulSetList.Items)
	}

	// List CronJobs
	cronJobList := &batchv1.CronJobList{}
	if err := s.client.List(ctx, cronJobList, client.InNamespace(namespace)); err == nil {
		info.ResourceCounts.CronJobs = len(cronJobList.Items)
	}

	// Detect PgCluster CRDs
	pgClusterGVR := schema.GroupVersionResource{
		Group:    "postgres.stratio.com",
		Version:  "v1",
		Resource: "pgclusters",
	}
	pgClusterList := &unstructured.UnstructuredList{}
	pgClusterList.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   pgClusterGVR.Group,
		Version: pgClusterGVR.Version,
		Kind:    "PgClusterList",
	})
	if err := s.client.List(ctx, pgClusterList, client.InNamespace(namespace)); err == nil {
		info.ResourceCounts.PgClusters = len(pgClusterList.Items)
		info.HasPgCluster = len(pgClusterList.Items) > 0
	} else {
		// Try alternative API group
		pgClusterGVR2 := schema.GroupVersionResource{
			Group:    "postgresql.cnpg.io",
			Version:  "v1",
			Resource: "clusters",
		}
		pgClusterList2 := &unstructured.UnstructuredList{}
		pgClusterList2.SetGroupVersionKind(schema.GroupVersionKind{
			Group:   pgClusterGVR2.Group,
			Version: pgClusterGVR2.Version,
			Kind:    "ClusterList",
		})
		if err2 := s.client.List(ctx, pgClusterList2, client.InNamespace(namespace)); err2 == nil {
			info.ResourceCounts.PgClusters = len(pgClusterList2.Items)
			info.HasPgCluster = len(pgClusterList2.Items) > 0
		}
	}

	// Detect HDFSCluster CRDs
	hdfsClusterGVR := schema.GroupVersionResource{
		Group:    "hdfs.stratio.com",
		Version:  "v1",
		Resource: "hdfsclusters",
	}
	hdfsClusterList := &unstructured.UnstructuredList{}
	hdfsClusterList.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   hdfsClusterGVR.Group,
		Version: hdfsClusterGVR.Version,
		Kind:    "HDFSClusterList",
	})
	if err := s.client.List(ctx, hdfsClusterList, client.InNamespace(namespace)); err == nil {
		info.ResourceCounts.HdfsClusters = len(hdfsClusterList.Items)
		info.HasHdfsCluster = len(hdfsClusterList.Items) > 0
	}

	// Detect PgBouncer CRDs
	pgBouncerGVR := schema.GroupVersionResource{
		Group:    "postgres.stratio.com",
		Version:  "v1",
		Resource: "pgbouncers",
	}
	pgBouncerList := &unstructured.UnstructuredList{}
	pgBouncerList.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   pgBouncerGVR.Group,
		Version: pgBouncerGVR.Version,
		Kind:    "PgBouncerList",
	})
	if err := s.client.List(ctx, pgBouncerList, client.InNamespace(namespace)); err == nil {
		info.ResourceCounts.PgBouncers = len(pgBouncerList.Items)
		info.HasPgBouncer = len(pgBouncerList.Items) > 0
	}

	// Build auto-exclusions based on detected resources
	if info.HasPgCluster || info.HasPgBouncer {
		info.AutoExclusions = append(info.AutoExclusions, ExclusionFilter{
			MatchLabels: map[string]string{
				"app.kubernetes.io/managed-by": "postgres-operator",
			},
		})
		info.AutoExclusions = append(info.AutoExclusions, ExclusionFilter{
			MatchLabels: map[string]string{
				"postgres.stratio.com/cluster": "true",
			},
		})
		info.AutoExclusions = append(info.AutoExclusions, ExclusionFilter{
			MatchLabels: map[string]string{
				"app.kubernetes.io/part-of": "postgres",
			},
		})
	}

	if info.HasHdfsCluster {
		info.AutoExclusions = append(info.AutoExclusions, ExclusionFilter{
			MatchLabels: map[string]string{
				"app.kubernetes.io/managed-by": "hdfs-operator",
			},
		})
		info.AutoExclusions = append(info.AutoExclusions, ExclusionFilter{
			MatchLabels: map[string]string{
				"hdfs.stratio.com/cluster": "true",
			},
		})
		info.AutoExclusions = append(info.AutoExclusions, ExclusionFilter{
			MatchLabels: map[string]string{
				"app.kubernetes.io/part-of": "hdfs",
			},
		})
	}

	return info, nil
}

// NamespaceScheduleResponse represents a schedule response for a single namespace
type NamespaceScheduleResponse struct {
	Tenant     string            `json:"tenant"`
	Namespace  string            `json:"namespace"`
	SleepInfos []SleepInfoDetail `json:"sleepInfos"`
}

// SleepInfoDetail represents detailed information about a SleepInfo
type SleepInfoDetail struct {
	Name                        string            `json:"name"`
	Namespace                   string            `json:"namespace"`
	Weekdays                    string            `json:"weekdays"`
	SleepAt                     string            `json:"sleepAt,omitempty"`
	WakeUpAt                    string            `json:"wakeUpAt,omitempty"`
	TimeZone                    string            `json:"timeZone"`
	Role                        string            `json:"role,omitempty"` // "sleep" or "wake" from annotations
	SuspendDeployments          bool              `json:"suspendDeployments"`
	SuspendStatefulSets         bool              `json:"suspendStatefulSets"`
	SuspendCronJobs             bool              `json:"suspendCronJobs"`
	SuspendDeploymentsPgbouncer bool              `json:"suspendDeploymentsPgbouncer,omitempty"`
	SuspendStatefulSetsPostgres bool              `json:"suspendStatefulSetsPostgres,omitempty"`
	SuspendStatefulSetsHdfs     bool              `json:"suspendStatefulSetsHdfs,omitempty"`
	ExcludeRef                  []ExclusionFilter `json:"excludeRef,omitempty"`
	Annotations                 map[string]string `json:"annotations,omitempty"`
}

// GetNamespaceSchedule gets SleepInfos for a specific namespace
func (s *ScheduleService) GetNamespaceSchedule(ctx context.Context, tenant, namespaceSuffix string) (*NamespaceScheduleResponse, error) {
	namespace := fmt.Sprintf("%s-%s", tenant, namespaceSuffix)

	// List SleepInfos in the namespace
	sleepInfoList := &kubegreenv1alpha1.SleepInfoList{}
	if err := s.client.List(ctx, sleepInfoList, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list SleepInfos: %w", err)
	}

	if len(sleepInfoList.Items) == 0 {
		return nil, fmt.Errorf("no schedules found for tenant %s in namespace %s", tenant, namespaceSuffix)
	}

	// Convert to detail format
	sleepInfos := make([]SleepInfoDetail, 0, len(sleepInfoList.Items))
	for _, si := range sleepInfoList.Items {
		detail := SleepInfoDetail{
			Name:                        si.Name,
			Namespace:                   si.Namespace,
			Weekdays:                    si.Spec.Weekdays,
			SleepAt:                     si.Spec.SleepTime,
			WakeUpAt:                    si.Spec.WakeUpTime,
			TimeZone:                    si.Spec.TimeZone,
			SuspendDeployments:          si.Spec.SuspendDeployments != nil && *si.Spec.SuspendDeployments,
			SuspendStatefulSets:         si.Spec.SuspendStatefulSets != nil && *si.Spec.SuspendStatefulSets,
			SuspendCronJobs:             si.Spec.SuspendCronjobs,
			SuspendDeploymentsPgbouncer: si.Spec.SuspendDeploymentsPgbouncer != nil && *si.Spec.SuspendDeploymentsPgbouncer,
			SuspendStatefulSetsPostgres: si.Spec.SuspendStatefulSetsPostgres != nil && *si.Spec.SuspendStatefulSetsPostgres,
			SuspendStatefulSetsHdfs:     si.Spec.SuspendStatefulSetsHdfs != nil && *si.Spec.SuspendStatefulSetsHdfs,
			Annotations:                 si.Annotations,
		}

		// Extract role from annotations
		if role, ok := si.Annotations["kube-green.stratio.com/pair-role"]; ok {
			detail.Role = role
		}

		// Convert excludeRef
		if len(si.Spec.ExcludeRef) > 0 {
			detail.ExcludeRef = make([]ExclusionFilter, 0, len(si.Spec.ExcludeRef))
			for _, ref := range si.Spec.ExcludeRef {
				detail.ExcludeRef = append(detail.ExcludeRef, ExclusionFilter{
					MatchLabels: ref.MatchLabels,
				})
			}
		}

		sleepInfos = append(sleepInfos, detail)
	}

	return &NamespaceScheduleResponse{
		Tenant:     tenant,
		Namespace:  namespaceSuffix,
		SleepInfos: sleepInfos,
	}, nil
}

// CreateNamespaceSchedule creates SleepInfos for a specific namespace using dynamic resource detection
func (s *ScheduleService) CreateNamespaceSchedule(ctx context.Context, req NamespaceScheduleRequest) error {
	// 1. Detect resources in the namespace
	resources, err := s.GetNamespaceResources(ctx, req.Tenant, req.Namespace)
	if err != nil {
		return fmt.Errorf("failed to detect resources: %w", err)
	}

	// 2. Normalize weekdays
	wdSleep := req.WeekdaysSleep
	if wdSleep == "" {
		wdSleep = "0-6"
	}
	wdSleepKube, err := HumanWeekdaysToKube(wdSleep)
	if err != nil {
		return fmt.Errorf("invalid sleep weekdays: %w", err)
	}

	wdWake := req.WeekdaysWake
	if wdWake == "" {
		wdWake = wdSleepKube
	}
	wdWakeKube, err := HumanWeekdaysToKube(wdWake)
	if err != nil {
		return fmt.Errorf("invalid wake weekdays: %w", err)
	}

	// 3. Convert times to UTC
	userTZ := req.UserTimezone
	if userTZ == "" {
		userTZ = TZLocal
	}
	clusterTZ := req.ClusterTimezone
	if clusterTZ == "" {
		clusterTZ = TZUTC
	}

	offConv, err := ToUTCHHMMWithTimezone(req.Off, userTZ, clusterTZ)
	if err != nil {
		return fmt.Errorf("invalid off time: %w", err)
	}

	onConv, err := ToUTCHHMMWithTimezone(req.On, userTZ, clusterTZ)
	if err != nil {
		return fmt.Errorf("invalid on time: %w", err)
	}

	// 4. Adjust weekdays for timezone shift
	wdSleepUTC, err := ShiftWeekdaysStr(wdSleepKube, offConv.DayShift)
	if err != nil {
		return fmt.Errorf("failed to shift sleep weekdays: %w", err)
	}

	wdWakeUTC, err := ShiftWeekdaysStr(wdWakeKube, onConv.DayShift)
	if err != nil {
		return fmt.Errorf("failed to shift wake weekdays: %w", err)
	}

	// 5. Calculate staggered wake times based on delays
	onPgHDFS := onConv.TimeUTC
	onPgBouncer := onConv.TimeUTC
	onDeployments := onConv.TimeUTC

	if req.Delays != nil {
		if req.Delays.PgHdfsDelay != "" {
			delayMinutes, _ := parseDelayToMinutes(req.Delays.PgHdfsDelay)
			onPgHDFS, _ = AddMinutes(onConv.TimeUTC, delayMinutes)
		}
		if req.Delays.PgbouncerDelay != "" {
			delayMinutes, _ := parseDelayToMinutes(req.Delays.PgbouncerDelay)
			onPgBouncer, _ = AddMinutes(onConv.TimeUTC, delayMinutes)
		}
		if req.Delays.DeploymentsDelay != "" {
			delayMinutes, _ := parseDelayToMinutes(req.Delays.DeploymentsDelay)
			onDeployments, _ = AddMinutes(onConv.TimeUTC, delayMinutes)
		}
	} else {
		// Default delays (like Python script)
		onPgHDFS = onConv.TimeUTC                        // t0
		onPgBouncer, _ = AddMinutes(onConv.TimeUTC, 5)   // t0+5m
		onDeployments, _ = AddMinutes(onConv.TimeUTC, 7) // t0+7m
	}

	// 6. Build excludeRefs
	excludeRefs := resources.AutoExclusions
	if len(req.Exclusions) > 0 {
		for _, excl := range req.Exclusions {
			if excl.Namespace == req.Namespace || excl.Namespace == fmt.Sprintf("%s-%s", req.Tenant, req.Namespace) {
				excludeRefs = append(excludeRefs, ExclusionFilter{
					MatchLabels: excl.Filter.MatchLabels,
				})
			}
		}
	}

	// Add Virtualizer exclusion for apps namespace
	if req.Namespace == "apps" && resources.HasVirtualizer {
		excludeRefs = append(excludeRefs, ExclusionFilter{
			MatchLabels: map[string]string{
				"cct.stratio.com/application_id": fmt.Sprintf("virtualizer.%s-%s", req.Tenant, req.Namespace),
			},
		})
	}

	// Convert to kubegreen FilterRef
	kubeExcludeRefs := make([]kubegreenv1alpha1.FilterRef, 0, len(excludeRefs))
	for _, excl := range excludeRefs {
		kubeExcludeRefs = append(kubeExcludeRefs, kubegreenv1alpha1.FilterRef{
			MatchLabels: excl.MatchLabels,
		})
	}

	namespace := fmt.Sprintf("%s-%s", req.Tenant, req.Namespace)

	// 7. Generate SleepInfos based on detected resources (DYNAMIC LOGIC)
	hasCRDs := resources.HasPgCluster || resources.HasHdfsCluster || resources.HasPgBouncer

	if hasCRDs {
		// Apply staggered wake logic when CRDs are detected
		if err := s.createDatastoresSleepInfosWithExclusions(ctx, req.Tenant, namespace, offConv.TimeUTC, onDeployments, onPgHDFS, onPgBouncer, wdSleepUTC, wdWakeUTC, kubeExcludeRefs); err != nil {
			return fmt.Errorf("failed to create staggered sleepinfos: %w", err)
		}
	} else {
		// Simple namespace without CRDs
		suspendStatefulSets := false

		// Special case: airflowsso can have PgCluster
		if req.Namespace == "airflowsso" && resources.HasPgCluster {
			suspendStatefulSets = true
		}

		if err := s.createNamespaceSleepInfoWithExclusions(ctx, req.Tenant, namespace, req.Namespace, offConv.TimeUTC, onDeployments, wdSleepUTC, wdWakeUTC, suspendStatefulSets, kubeExcludeRefs); err != nil {
			return fmt.Errorf("failed to create namespace sleepinfo: %w", err)
		}
	}

	return nil
}

// UpdateNamespaceSchedule updates SleepInfos for a specific namespace
func (s *ScheduleService) UpdateNamespaceSchedule(ctx context.Context, req NamespaceScheduleRequest) error {
	// Delete existing schedule first
	if err := s.DeleteNamespaceSchedule(ctx, req.Tenant, req.Namespace); err != nil {
		// If not found, that's okay - we'll create new
		if !strings.Contains(err.Error(), "not found") {
			return fmt.Errorf("failed to delete existing schedule: %w", err)
		}
	}

	// Create new schedule
	return s.CreateNamespaceSchedule(ctx, req)
}

// DeleteNamespaceSchedule deletes all SleepInfos for a specific namespace
func (s *ScheduleService) DeleteNamespaceSchedule(ctx context.Context, tenant, namespaceSuffix string) error {
	namespace := fmt.Sprintf("%s-%s", tenant, namespaceSuffix)

	// List all SleepInfos in the namespace
	sleepInfoList := &kubegreenv1alpha1.SleepInfoList{}
	if err := s.client.List(ctx, sleepInfoList, client.InNamespace(namespace)); err != nil {
		return fmt.Errorf("failed to list SleepInfos: %w", err)
	}

	if len(sleepInfoList.Items) == 0 {
		return fmt.Errorf("no schedules found for tenant %s in namespace %s", tenant, namespaceSuffix)
	}

	// Delete each SleepInfo
	for _, si := range sleepInfoList.Items {
		if err := s.client.Delete(ctx, &si); err != nil {
			return fmt.Errorf("failed to delete SleepInfo %s: %w", si.Name, err)
		}
	}

	return nil
}
