/*
Copyright 2025.
*/

package v1

import (
	"fmt"
	"strings"
	"time"
)

const (
	// TZLocal is the local timezone (Colombia)
	TZLocal = "America/Bogota"
	// TZUTC is UTC timezone
	TZUTC = "UTC"
)

// TimeConversion represents a time conversion result with day shift
type TimeConversion struct {
	TimeUTC  string // Format: "HH:MM"
	DayShift int    // -1, 0, or +1 indicating day shift when converting to UTC
}

// ToUTCHHMM converts local time (HH:MM) to UTC time (HH:MM)
// Returns the UTC time and day shift (-1, 0, or +1)
func ToUTCHHMM(localHHMM, tzLocal string) (TimeConversion, error) {
	if tzLocal == "" {
		tzLocal = TZLocal
	}

	// Parse input time
	var hour, minute int
	if _, err := fmt.Sscanf(localHHMM, "%d:%d", &hour, &minute); err != nil {
		return TimeConversion{}, fmt.Errorf("invalid time format: %s (expected HH:MM)", localHHMM)
	}

	if hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return TimeConversion{}, fmt.Errorf("invalid time values: hour=%d minute=%d", hour, minute)
	}

	// Load timezones
	localTZ, err := time.LoadLocation(tzLocal)
	if err != nil {
		return TimeConversion{}, fmt.Errorf("invalid local timezone: %s", tzLocal)
	}

	utcTZ := time.UTC

	// Create datetime in local timezone
	today := time.Now().In(localTZ)
	localTime := time.Date(today.Year(), today.Month(), today.Day(), hour, minute, 0, 0, localTZ)

	// Convert to UTC
	utcTime := localTime.In(utcTZ)

	// Calculate day shift
	localYear, localMonth, localDay := localTime.Date()
	utcYear, utcMonth, utcDay := utcTime.Date()

	localDate := time.Date(localYear, localMonth, localDay, 0, 0, 0, 0, localTZ)
	utcDate := time.Date(utcYear, utcMonth, utcDay, 0, 0, 0, 0, utcTZ)

	dayShift := int(utcDate.Sub(localDate).Hours() / 24)

	// Format UTC time
	utcHHMM := fmt.Sprintf("%02d:%02d", utcTime.Hour(), utcTime.Minute())

	return TimeConversion{
		TimeUTC:  utcHHMM,
		DayShift: dayShift,
	}, nil
}

// AddMinutes adds minutes to a time string (HH:MM) and returns HH:MM
func AddMinutes(hhmm string, minutes int) (string, error) {
	var hour, minute int
	if _, err := fmt.Sscanf(hhmm, "%d:%d", &hour, &minute); err != nil {
		return "", fmt.Errorf("invalid time format: %s", hhmm)
	}

	totalMinutes := hour*60 + minute + minutes

	// Handle negative minutes (wrap around)
	for totalMinutes < 0 {
		totalMinutes += 24 * 60
	}

	// Wrap around if > 24 hours
	totalMinutes = totalMinutes % (24 * 60)

	newHour := totalMinutes / 60
	newMinute := totalMinutes % 60

	return fmt.Sprintf("%02d:%02d", newHour, newMinute), nil
}

// stripAccents removes accents and diacritics from a string
// Simple mapping approach for Spanish characters
func stripAccents(s string) string {
	replacements := map[rune]rune{
		'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
		'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
		'ñ': 'n', 'Ñ': 'N',
	}

	var result strings.Builder
	for _, r := range s {
		if replacement, ok := replacements[r]; ok {
			result.WriteRune(replacement)
		} else {
			result.WriteRune(r)
		}
	}
	return result.String()
}
