/*
Copyright 2025.
*/

package v1

import (
	"fmt"
	"regexp"
)

var (
	// timePattern matches HH:MM format (24-hour)
	timePattern = regexp.MustCompile(`^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$`)
	// scheduleNamePattern matches Kubernetes resource name requirements: lowercase alphanumeric and hyphens, max 253 chars
	scheduleNamePattern = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$`)
)

// ValidateCreateSchedule validates a CreateScheduleRequest
func ValidateCreateSchedule(req CreateScheduleRequest) error {
	if req.Tenant == "" {
		return fmt.Errorf("tenant is required")
	}

	if req.Off == "" {
		return fmt.Errorf("off time is required")
	}

	if !timePattern.MatchString(req.Off) {
		return fmt.Errorf("off time must be in HH:MM format (24-hour), got: %s", req.Off)
	}

	if req.On == "" {
		return fmt.Errorf("on time is required")
	}

	if !timePattern.MatchString(req.On) {
		return fmt.Errorf("on time must be in HH:MM format (24-hour), got: %s", req.On)
	}

	// Validate scheduleName if provided (must be valid Kubernetes resource name)
	if req.ScheduleName != "" {
		if len(req.ScheduleName) > 253 {
			return fmt.Errorf("scheduleName must be 253 characters or less")
		}
		if !scheduleNamePattern.MatchString(req.ScheduleName) {
			return fmt.Errorf("scheduleName must be a valid Kubernetes resource name (lowercase alphanumeric, hyphens, and dots allowed): %s", req.ScheduleName)
		}
	}

	// Validate weekdays if provided
	if req.Weekdays != "" {
		if _, err := HumanWeekdaysToKube(req.Weekdays); err != nil {
			return fmt.Errorf("invalid weekdays: %w", err)
		}
	}

	// Validate sleepDays if provided
	if req.SleepDays != "" {
		if _, err := HumanWeekdaysToKube(req.SleepDays); err != nil {
			return fmt.Errorf("invalid sleepDays: %w", err)
		}
	}

	// Validate wakeDays if provided
	if req.WakeDays != "" {
		if _, err := HumanWeekdaysToKube(req.WakeDays); err != nil {
			return fmt.Errorf("invalid wakeDays: %w", err)
		}
	}

	// NO VALIDAR namespaces contra validSuffixes hardcodeados
	// Los namespaces serán validados dinámicamente contra los namespaces reales del cluster
	// Solo validar formato básico (no vacío, sin caracteres especiales)
	if len(req.Namespaces) > 0 {
		for _, ns := range req.Namespaces {
			if ns == "" {
				return fmt.Errorf("namespace cannot be empty")
			}
			// Validar formato básico: solo letras, números y guiones
			if !regexp.MustCompile(`^[a-z0-9-]+$`).MatchString(ns) {
				return fmt.Errorf("invalid namespace format: %s (only lowercase letters, numbers, and hyphens allowed)", ns)
			}
		}
	}

	return nil
}

// ValidateUpdateSchedule validates an UpdateScheduleRequest
func ValidateUpdateSchedule(req UpdateScheduleRequest) error {
	// At least one field must be provided
	if req.Off == "" && req.On == "" && req.Weekdays == "" && req.SleepDays == "" && req.WakeDays == "" && len(req.Namespaces) == 0 {
		return fmt.Errorf("at least one field must be provided for update")
	}

	// Validate time formats if provided
	if req.Off != "" && !timePattern.MatchString(req.Off) {
		return fmt.Errorf("off time must be in HH:MM format (24-hour), got: %s", req.Off)
	}

	if req.On != "" && !timePattern.MatchString(req.On) {
		return fmt.Errorf("on time must be in HH:MM format (24-hour), got: %s", req.On)
	}

	// Validate weekdays if provided
	if req.Weekdays != "" {
		if _, err := HumanWeekdaysToKube(req.Weekdays); err != nil {
			return fmt.Errorf("invalid weekdays: %w", err)
		}
	}

	// Validate sleepDays if provided
	if req.SleepDays != "" {
		if _, err := HumanWeekdaysToKube(req.SleepDays); err != nil {
			return fmt.Errorf("invalid sleepDays: %w", err)
		}
	}

	// Validate wakeDays if provided
	if req.WakeDays != "" {
		if _, err := HumanWeekdaysToKube(req.WakeDays); err != nil {
			return fmt.Errorf("invalid wakeDays: %w", err)
		}
	}

	// NO VALIDAR namespaces contra validSuffixes hardcodeados
	// Los namespaces serán validados dinámicamente contra los namespaces reales del cluster
	// Solo validar formato básico (no vacío, sin caracteres especiales)
	if len(req.Namespaces) > 0 {
		for _, ns := range req.Namespaces {
			if ns == "" {
				return fmt.Errorf("namespace cannot be empty")
			}
			// Validar formato básico: solo letras, números y guiones
			if !regexp.MustCompile(`^[a-z0-9-]+$`).MatchString(ns) {
				return fmt.Errorf("invalid namespace format: %s (only lowercase letters, numbers, and hyphens allowed)", ns)
			}
		}
	}

	return nil
}

// ValidateNamespaceSchedule validates a NamespaceScheduleRequest
func ValidateNamespaceSchedule(req NamespaceScheduleRequest) error {
	if req.Tenant == "" {
		return fmt.Errorf("tenant is required")
	}

	if req.Namespace == "" {
		return fmt.Errorf("namespace is required")
	}

	if req.Off == "" {
		return fmt.Errorf("off time is required")
	}

	if !timePattern.MatchString(req.Off) {
		return fmt.Errorf("off time must be in HH:MM format (24-hour), got: %s", req.Off)
	}

	if req.On == "" {
		return fmt.Errorf("on time is required")
	}

	if !timePattern.MatchString(req.On) {
		return fmt.Errorf("on time must be in HH:MM format (24-hour), got: %s", req.On)
	}

	// Validate scheduleName if provided (must be valid Kubernetes resource name)
	if req.ScheduleName != "" {
		if len(req.ScheduleName) > 253 {
			return fmt.Errorf("scheduleName must be 253 characters or less")
		}
		if !scheduleNamePattern.MatchString(req.ScheduleName) {
			return fmt.Errorf("scheduleName must be a valid Kubernetes resource name (lowercase alphanumeric, hyphens, and dots allowed): %s", req.ScheduleName)
		}
	}

	// Validate weekdays if provided
	if req.WeekdaysSleep != "" {
		if _, err := HumanWeekdaysToKube(req.WeekdaysSleep); err != nil {
			return fmt.Errorf("invalid weekdaysSleep: %w", err)
		}
	}

	if req.WeekdaysWake != "" {
		if _, err := HumanWeekdaysToKube(req.WeekdaysWake); err != nil {
			return fmt.Errorf("invalid weekdaysWake: %w", err)
		}
	}

	return nil
}
