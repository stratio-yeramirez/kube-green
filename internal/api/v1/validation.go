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

	// Validate namespaces if provided
	if len(req.Namespaces) > 0 {
		for _, ns := range req.Namespaces {
			valid := false
			for _, validSuffix := range validSuffixes {
				if ns == validSuffix {
					valid = true
					break
				}
			}
			if !valid {
				return fmt.Errorf("invalid namespace: %s (valid values: %s)", ns, ValidNamespaceSuffixes)
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

	// Validate namespaces if provided
	if len(req.Namespaces) > 0 {
		for _, ns := range req.Namespaces {
			valid := false
			for _, validSuffix := range validSuffixes {
				if ns == validSuffix {
					valid = true
					break
				}
			}
			if !valid {
				return fmt.Errorf("invalid namespace: %s (valid values: %s)", ns, ValidNamespaceSuffixes)
			}
		}
	}

	return nil
}


