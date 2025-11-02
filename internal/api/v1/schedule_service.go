/*
Copyright 2025.
*/

package v1

import (
	"context"
	"fmt"
	"strings"

	kubegreenv1alpha1 "github.com/kube-green/kube-green/api/v1alpha1"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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

	// 2. Convert times to UTC
	offConv, err := ToUTCHHMM(req.Off, TZLocal)
	if err != nil {
		return fmt.Errorf("invalid off time: %w", err)
	}

	onConv, err := ToUTCHHMM(req.On, TZLocal)
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

	// 4. Calculate staggered wake times
	onPgHDFS := onConv.TimeUTC
	onPgBouncer, _ := AddMinutes(onConv.TimeUTC, 5)
	onDeployments, _ := AddMinutes(onConv.TimeUTC, 7)

	// 5. Determine which namespaces to process
	selectedNamespaces := normalizeNamespaces(req.Namespaces)

	// 6. Create SleepInfo objects for each namespace
	for _, suffix := range validSuffixes {
		if !isNamespaceSelected(selectedNamespaces, suffix) {
			continue
		}

		namespace := fmt.Sprintf("%s-%s", req.Tenant, suffix)

		// Create SleepInfos based on namespace type
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

	return nil
}

// normalizeNamespaces normalizes namespace input
func normalizeNamespaces(nsInput []string) map[string]bool {
	if len(nsInput) == 0 {
		// All namespaces
		result := make(map[string]bool)
		for _, s := range validSuffixes {
			result[s] = true
		}
		return result
	}

	result := make(map[string]bool)
	for _, ns := range nsInput {
		ns = strings.ToLower(strings.TrimSpace(ns))
		for _, valid := range validSuffixes {
			if ns == valid {
				result[valid] = true
				break
			}
		}
	}

	if len(result) == 0 {
		// If nothing valid, use all
		for _, s := range validSuffixes {
			result[s] = true
		}
	}

	return result
}

func isNamespaceSelected(selected map[string]bool, suffix string) bool {
	return selected[suffix]
}

// createNamespaceSleepInfo creates a simple SleepInfo for a namespace
func (s *ScheduleService) createNamespaceSleepInfo(ctx context.Context, tenant, namespace, suffix, offUTC, onUTC, wdSleep, wdWake string, suspendStatefulSets bool) error {
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
			sleepInfo.Spec.ExcludeRef = []kubegreenv1alpha1.FilterRef{
				{
					MatchLabels: map[string]string{
						"cct.stratio.com/application_id": fmt.Sprintf("virtualizer.%s", namespace),
					},
				},
			}
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
			excludeRef := []kubegreenv1alpha1.FilterRef{
				{
					MatchLabels: map[string]string{
						"cct.stratio.com/application_id": fmt.Sprintf("virtualizer.%s", namespace),
					},
				},
			}
			sleepSleepInfo.Spec.ExcludeRef = excludeRef
			wakeSleepInfo.Spec.ExcludeRef = excludeRef
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
	var existing kubegreenv1alpha1.SleepInfo
	err := s.client.Get(ctx, client.ObjectKeyFromObject(sleepInfo), &existing)
	if err != nil {
		if client.IgnoreNotFound(err) == nil {
			// Not found, create
			if err := s.client.Create(ctx, sleepInfo); err != nil {
				return err
			}
		} else {
			return err
		}
	} else {
		// Exists, update
		sleepInfo.ResourceVersion = existing.ResourceVersion
		if err := s.client.Update(ctx, sleepInfo); err != nil {
			return err
		}
	}

	return nil
}

// createDatastoresSleepInfos creates the complex SleepInfos for datastores namespace
// This includes staged wake-up for Postgres, HDFS, PgBouncer, and native deployments
func (s *ScheduleService) createDatastoresSleepInfos(ctx context.Context, tenant, namespace, offUTC, onDeployments, onPgHDFS, onPgBouncer, wdSleep, wdWake string) error {
	// TODO: Implement full datastores logic (similar to make_datastores_native_deploys_split_days)
	// For now, create a basic implementation
	suspendDeployments := true
	suspendStatefulSets := true
	suspendCronJobs := true
	suspendPgbouncer := true
	suspendPostgres := true
	suspendHdfs := true

	// Get exclude refs for operator-managed resources
	excludeRefs := getExcludeRefsForOperators()

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
	Tenant     string                        `json:"tenant"`
	Namespaces map[string][]SleepInfoSummary `json:"namespaces"`
}

// SleepInfoSummary represents a summary of a SleepInfo
type SleepInfoSummary struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Weekdays    string            `json:"weekdays"`
	SleepTime   string            `json:"sleepTime"`
	WakeTime    string            `json:"wakeTime,omitempty"`
	TimeZone    string            `json:"timeZone"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// ListSchedules lists all schedules grouped by tenant
func (s *ScheduleService) ListSchedules(ctx context.Context) ([]ScheduleResponse, error) {
	// List all SleepInfos across all namespaces
	sleepInfoList := &kubegreenv1alpha1.SleepInfoList{}
	if err := s.client.List(ctx, sleepInfoList); err != nil {
		return nil, fmt.Errorf("failed to list SleepInfos: %w", err)
	}

	// Group by tenant (extract from namespace: tenant-suffix)
	tenantMap := make(map[string]map[string][]SleepInfoSummary)

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
			tenantMap[tenant] = make(map[string][]SleepInfoSummary)
		}

		summary := SleepInfoSummary{
			Name:        si.Name,
			Namespace:   si.Namespace,
			Weekdays:    si.Spec.Weekdays,
			SleepTime:   si.Spec.SleepTime,
			WakeTime:    si.Spec.WakeUpTime,
			TimeZone:    si.Spec.TimeZone,
			Annotations: si.Annotations,
		}

		tenantMap[tenant][suffix] = append(tenantMap[tenant][suffix], summary)
	}

	// Convert to response format
	result := make([]ScheduleResponse, 0, len(tenantMap))
	for tenant, namespaces := range tenantMap {
		result = append(result, ScheduleResponse{
			Tenant:     tenant,
			Namespaces: namespaces,
		})
	}

	return result, nil
}

// GetSchedule gets all SleepInfos for a specific tenant
func (s *ScheduleService) GetSchedule(ctx context.Context, tenant string) (*ScheduleResponse, error) {
	// List all SleepInfos
	sleepInfoList := &kubegreenv1alpha1.SleepInfoList{}
	if err := s.client.List(ctx, sleepInfoList); err != nil {
		return nil, fmt.Errorf("failed to list SleepInfos: %w", err)
	}

	namespaces := make(map[string][]SleepInfoSummary)

	// Filter by tenant
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

		summary := SleepInfoSummary{
			Name:        si.Name,
			Namespace:   si.Namespace,
			Weekdays:    si.Spec.Weekdays,
			SleepTime:   si.Spec.SleepTime,
			WakeTime:    si.Spec.WakeUpTime,
			TimeZone:    si.Spec.TimeZone,
			Annotations: si.Annotations,
		}

		namespaces[suffix] = append(namespaces[suffix], summary)
	}

	if len(namespaces) == 0 {
		return nil, fmt.Errorf("no schedules found for tenant: %s", tenant)
	}

	return &ScheduleResponse{
		Tenant:     tenant,
		Namespaces: namespaces,
	}, nil
}

// UpdateSchedule updates schedules for a tenant
// If fields are empty, they will be extracted from existing schedule
func (s *ScheduleService) UpdateSchedule(ctx context.Context, tenant string, req CreateScheduleRequest) error {
	// If some fields are missing, try to get them from existing schedule
	if req.Weekdays == "" || req.Off == "" || req.On == "" {
		existing, err := s.GetSchedule(ctx, tenant)
		if err == nil && existing != nil {
			// Extract values from existing schedule
			// Note: This is a simplified extraction - we take the first SleepInfo we find
			for _, sleepInfos := range existing.Namespaces {
				if len(sleepInfos) > 0 {
					si := sleepInfos[0]
					if req.Weekdays == "" {
						req.Weekdays = si.Weekdays
					}
					if req.Off == "" {
						// Convert UTC back to local time for display (simplified - we'd need reverse conversion)
						// For now, we'll require off and on to be provided
						req.Off = si.SleepTime
					}
					if req.On == "" {
						if si.WakeTime != "" {
							req.On = si.WakeTime
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
func (s *ScheduleService) DeleteSchedule(ctx context.Context, tenant string) error {
	// List all SleepInfos
	sleepInfoList := &kubegreenv1alpha1.SleepInfoList{}
	if err := s.client.List(ctx, sleepInfoList); err != nil {
		return fmt.Errorf("failed to list SleepInfos: %w", err)
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
		return fmt.Errorf("no schedules found for tenant: %s", tenant)
	}

	s.logger.Info("Deleted schedules for tenant", "tenant", tenant, "count", deletedCount)
	return nil
}
