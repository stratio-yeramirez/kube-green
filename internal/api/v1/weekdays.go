/*
Copyright 2025.
*/

package v1

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var (
	// DaysES maps Spanish day names to numbers (0=Sunday, 6=Saturday)
	DaysES = map[string]int{
		"domingo":   0,
		"lunes":     1,
		"martes":    2,
		"miercoles": 3,
		"miércoles": 3,
		"jueves":    4,
		"viernes":   5,
		"sabado":    6,
		"sábado":    6,
	}

	// DaysNumToES maps numbers to Spanish day names
	DaysNumToES = map[int]string{
		0: "domingo",
		1: "lunes",
		2: "martes",
		3: "miércoles",
		4: "jueves",
		5: "viernes",
		6: "sábado",
	}

	// numericPattern matches numeric ranges like "0-6", "1,2,3"
	numericPattern = regexp.MustCompile(`^\s*\d(?:\s*[-,]\s*\d)*\s*$`)
)

// HumanWeekdaysToKube converts human-readable weekdays to kube-green format
// Examples:
//   - "lunes-viernes" -> "1-5"
//   - "viernes,sábado,domingo" -> "5,6,0"
//   - "0-6" -> "0-6" (already in numeric format)
func HumanWeekdaysToKube(s string) (string, error) {
	raw := strings.TrimSpace(s)
	if raw == "" {
		return "0-6", nil
	}

	// If already in numeric format, accept it as-is (normalize spaces)
	if numericPattern.MatchString(raw) {
		return strings.ReplaceAll(raw, " ", ""), nil
	}

	// Normalize: lowercase, remove spaces, strip accents
	txt := stripAccents(strings.ToLower(strings.ReplaceAll(raw, " ", "")))

	// Split by comma
	parts := strings.Split(txt, ",")
	var nums []int

	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}

		// Handle ranges (e.g., "lunes-viernes")
		if strings.Contains(p, "-") {
			rangeParts := strings.Split(p, "-")
			if len(rangeParts) != 2 {
				return "", fmt.Errorf("invalid day range: %s", p)
			}

			startStr := strings.TrimSpace(rangeParts[0])
			endStr := strings.TrimSpace(rangeParts[1])

			start, ok := DaysES[startStr]
			if !ok {
				return "", fmt.Errorf("day not recognized in range start: %s", startStr)
			}

			end, ok := DaysES[endStr]
			if !ok {
				return "", fmt.Errorf("day not recognized in range end: %s", endStr)
			}

			// Handle circular ranges (e.g., viernes-domingo -> 5,6,0)
			if start <= end {
				for i := start; i <= end; i++ {
					nums = append(nums, i)
				}
			} else {
				// Circular range
				for i := start; i < 7; i++ {
					nums = append(nums, i)
				}
				for i := 0; i <= end; i++ {
					nums = append(nums, i)
				}
			}
		} else {
			// Single day
			dayNum, ok := DaysES[p]
			if !ok {
				return "", fmt.Errorf("day not recognized: %s", p)
			}
			nums = append(nums, dayNum)
		}
	}

	// Remove duplicates preserving order
	seen := make(map[int]bool)
	var unique []int
	for _, n := range nums {
		if !seen[n] {
			seen[n] = true
			unique = append(unique, n)
		}
	}

	// Convert to comma-separated string
	result := make([]string, len(unique))
	for i, n := range unique {
		result[i] = strconv.Itoa(n)
	}

	return strings.Join(result, ","), nil
}

// ExpandWeekdaysStr expands a weekday string to a list of integers
// Examples:
//   - "0-6" -> [0,1,2,3,4,5,6]
//   - "1,3,5" -> [1,3,5]
//   - "5-1" (circular) -> [5,6,0,1]
func ExpandWeekdaysStr(s string) ([]int, error) {
	raw := strings.TrimSpace(s)
	if raw == "" {
		return []int{0, 1, 2, 3, 4, 5, 6}, nil
	}

	// If contains letters, convert first
	var err error
	if matched, _ := regexp.MatchString(`[A-Za-zÁÉÍÓÚáéíóúÑñ]`, raw); matched {
		raw, err = HumanWeekdaysToKube(raw)
		if err != nil {
			return nil, err
		}
	}

	var nums []int
	parts := strings.Split(raw, ",")

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		if strings.Contains(part, "-") {
			// Range
			rangeParts := strings.Split(part, "-")
			if len(rangeParts) != 2 {
				return nil, fmt.Errorf("invalid range: %s", part)
			}

			start, err := strconv.Atoi(strings.TrimSpace(rangeParts[0]))
			if err != nil {
				return nil, fmt.Errorf("invalid start of range: %s", rangeParts[0])
			}

			end, err := strconv.Atoi(strings.TrimSpace(rangeParts[1]))
			if err != nil {
				return nil, fmt.Errorf("invalid end of range: %s", rangeParts[1])
			}

			if start <= end {
				for i := start; i <= end; i++ {
					nums = append(nums, i)
				}
			} else {
				// Circular range
				for i := start; i < 7; i++ {
					nums = append(nums, i)
				}
				for i := 0; i <= end; i++ {
					nums = append(nums, i)
				}
			}
		} else {
			// Single number
			num, err := strconv.Atoi(part)
			if err != nil {
				return nil, fmt.Errorf("invalid weekday number: %s", part)
			}
			if num < 0 || num > 6 {
				return nil, fmt.Errorf("weekday out of range (0-6): %d", num)
			}
			nums = append(nums, num)
		}
	}

	// Remove duplicates
	seen := make(map[int]bool)
	var unique []int
	for _, n := range nums {
		if !seen[n] {
			seen[n] = true
			unique = append(unique, n)
		}
	}

	return unique, nil
}

// ShiftWeekdaysStr applies a day shift to a weekday specification
// Returns comma-separated string (not compressed to ranges)
func ShiftWeekdaysStr(weekdays string, shift int) (string, error) {
	shift = shift % 7
	if shift < 0 {
		shift += 7
	}

	nums, err := ExpandWeekdaysStr(weekdays)
	if err != nil {
		return "", err
	}

	shifted := make([]int, len(nums))
	for i, n := range nums {
		shifted[i] = (n + shift) % 7
	}

	// Remove duplicates
	seen := make(map[int]bool)
	var unique []int
	for _, n := range shifted {
		if !seen[n] {
			seen[n] = true
			unique = append(unique, n)
		}
	}

	// Convert to comma-separated string
	result := make([]string, len(unique))
	for i, n := range unique {
		result[i] = strconv.Itoa(n)
	}

	return strings.Join(result, ","), nil
}


