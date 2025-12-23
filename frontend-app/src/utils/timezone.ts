import { format, parse } from 'date-fns'
import { formatInTimeZone, utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz'
import type { TimezoneConversion } from '@/types'

/**
 * Converts a time string from user timezone to cluster timezone
 * @param timeStr Time in HH:MM format
 * @param userTimezone IANA timezone (e.g., 'America/Bogota')
 * @param clusterTimezone IANA timezone (e.g., 'UTC')
 * @returns Conversion result with time and day shift
 */
export function convertTimezone(
  timeStr: string,
  userTimezone: string,
  clusterTimezone: string
): TimezoneConversion {
  try {
    // Parse time string
    const [hours, minutes] = timeStr.split(':').map(Number)
    
    // Get current date
    const now = new Date()
    
    // Create date with the specified time in user timezone
    const userDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes)
    
    // Convert from user timezone to UTC, then to cluster timezone
    const userUTC = zonedTimeToUtc(userDate, userTimezone)
    const clusterDate = utcToZonedTime(userUTC, clusterTimezone)
    
    // Format cluster time
    const clusterTime = formatInTimeZone(clusterDate, clusterTimezone, 'HH:mm')
    
    // Calculate day shift
    const userDateOnly = format(userDate, 'yyyy-MM-dd')
    const clusterDateOnly = formatInTimeZone(clusterDate, clusterTimezone, 'yyyy-MM-dd')
    
    const userDay = parse(userDateOnly, 'yyyy-MM-dd', new Date())
    const clusterDay = parse(clusterDateOnly, 'yyyy-MM-dd', new Date())
    
    const dayShift = Math.round(
      (clusterDay.getTime() - userDay.getTime()) / (1000 * 60 * 60 * 24)
    )
    
    return {
      userTime: timeStr,
      userTimezone,
      clusterTime,
      clusterTimezone,
      dayShift: dayShift as -1 | 0 | 1,
    }
  } catch (error) {
    console.error('Timezone conversion error:', error)
    // Fallback: return same time
    return {
      userTime: timeStr,
      userTimezone,
      clusterTime: timeStr,
      clusterTimezone,
      dayShift: 0,
    }
  }
}

/**
 * Shifts weekdays based on day shift
 * @param weekdays Comma-separated weekdays (e.g., "0,1,2" or "0-6")
 * @param dayShift Day shift (-1, 0, or +1)
 * @returns Shifted weekdays string
 */
export function shiftWeekdays(weekdays: string, dayShift: number): string {
  if (dayShift === 0) return weekdays

  // Expand weekdays string to array of numbers
  const days: number[] = []
  if (weekdays.includes('-')) {
    // Range like "0-6"
    const [start, end] = weekdays.split('-').map(Number)
    for (let i = start; i <= end; i++) {
      days.push(i)
    }
  } else {
    // Comma-separated like "0,1,2"
    weekdays.split(',').forEach((day) => {
      const num = Number(day.trim())
      if (!isNaN(num)) days.push(num)
    })
  }

  // Apply shift to convert from cluster timezone back to user timezone
  // El backend aplicó: ShiftWeekdaysStr(userWeekdays, shift) donde:
  //   shift = clusterYearDay - userYearDay (siempre positivo o cero)
  //   shift se normaliza a 0-6: shift = shift % 7, si shift < 0 entonces shift += 7
  //   Aplica: (day + shift) % 7
  // Ejemplo: viernes (5) 22:00 Colombia → sábado (6) 03:00 UTC
  //   Backend: shift = 1, aplica: (5 + 1) % 7 = 6 (sábado) ✓
  // 
  // Para revertir en el frontend:
  //   dayShift = userYearDay - clusterYearDay (negativo cuando cluster está adelante)
  //   Ejemplo: dayShift = -1 (viernes - sábado)
  //   Aplicamos: (day + dayShift + 7) % 7 para manejar valores negativos
  //   sábado (6): (6 + (-1) + 7) % 7 = (6 - 1 + 7) % 7 = 12 % 7 = 5 (viernes) ✓
  const shifted = days.map((day) => {
    // Aplicar shift directamente: (day + dayShift + 7) % 7
    // El +7 asegura que el resultado sea positivo incluso si dayShift es negativo
    const newDay = (day + dayShift + 7) % 7
    console.log(`DEBUG shiftWeekdays: day=${day}, dayShift=${dayShift}, calculation=((${day} + ${dayShift} + 7) % 7) = ${newDay}`)
    return newDay
  })

  // Remove duplicates and sort
  const unique = [...new Set(shifted)].sort((a, b) => a - b)
  
  // Try to compress to range if continuous
  if (unique.length > 1 && unique[unique.length - 1] - unique[0] === unique.length - 1) {
    return `${unique[0]}-${unique[unique.length - 1]}`
  }
  
  return unique.join(',')
}

/**
 * Converts weekdays from cluster timezone back to user timezone
 * @param weekdaysUTC Weekdays in UTC (e.g., "0,1,2" or "0-6")
 * @param timeUTC Time in UTC (HH:MM format)
 * @param clusterTimezone Cluster timezone (e.g., 'UTC')
 * @param userTimezone User timezone (e.g., 'America/Bogota')
 * @returns Weekdays in user timezone
 */
export function convertWeekdaysFromClusterToUser(
  weekdaysUTC: string,
  timeUTC: string,
  clusterTimezone: string,
  userTimezone: string
): string {
  try {
    // IMPORTANTE: Esta función debe funcionar para CUALQUIER día y CUALQUIER hora
    // Considera la diferencia de horarios y el cambio de día entre timezones
    //
    // El dayShift se calcula automáticamente según la hora:
    // - Si la hora UTC es temprana y la hora local es tarde del día anterior:
    //   Ejemplo: 03:00 UTC (sábado) vs 22:00 Colombia (viernes) → dayShift = -1
    // - Si la hora UTC es tarde y la hora local es temprana del día siguiente:
    //   Ejemplo: 20:00 UTC (viernes) vs 15:00 Colombia (sábado) → dayShift = +1
    // - Si están en el mismo día:
    //   Ejemplo: 13:00 UTC (lunes) vs 08:00 Colombia (lunes) → dayShift = 0
    //
    // Ejemplos de conversión:
    // 1. Viernes 22:00 Colombia → Sábado 03:00 UTC → dayShift = -1 → muestra Viernes ✓
    // 2. Lunes 08:00 Colombia → Lunes 13:00 UTC → dayShift = 0 → muestra Lunes ✓
    // 3. Sábado 02:00 Colombia → Sábado 07:00 UTC → dayShift = 0 → muestra Sábado ✓
    // 4. Viernes 20:00 UTC → Sábado 15:00 Colombia → dayShift = +1 → muestra Sábado ✓
    //
    // La lógica del backend:
    // - FromClusterToUserTimezone calcula: dayShift = userYearDay - clusterYearDay
    // - En UpdateSchedule aplica: ShiftWeekdaysStr(weekdays, -dayShift) ❌ (esto está mal)
    //
    // CORRECCIÓN: Aplicamos dayShift directamente (sin el negativo) para corregir el bug del backend
    
    const [hours, minutes] = timeUTC.split(':').map(Number)
    
    // Crear fecha en clusterTimezone (replicando EXACTAMENTE la lógica del backend)
    // Backend hace:
    //   today := time.Now().In(clusterTZLoc)
    //   clusterTime := time.Date(today.Year(), today.Month(), today.Day(), hour, minute, 0, 0, clusterTZLoc)
    //   userTime := clusterTime.In(userTZLoc)
    //   dayShift = userTime.YearDay() - clusterTime.YearDay()
    //
    // En JavaScript: Si clusterTimezone es UTC, crear fecha UTC directamente
    // Si no, crear fecha local e interpretarla como clusterTimezone
    const now = new Date()
    const todayInCluster = utcToZonedTime(now, clusterTimezone)
    
    // Crear fecha UTC que representa ese tiempo en clusterTimezone
    // Backend hace: time.Date(today.Year(), today.Month(), today.Day(), hour, minute, 0, 0, clusterTZLoc)
    // Esto crea una fecha en clusterTimezone, luego la convierte a UTC internamente
    let clusterDate: Date
    if (clusterTimezone === 'UTC') {
      // Crear fecha UTC directamente (03:00 UTC del día de hoy)
      clusterDate = new Date(Date.UTC(
        todayInCluster.getUTCFullYear(),
        todayInCluster.getUTCMonth(),
        todayInCluster.getUTCDate(),
        hours,
        minutes,
        0,
        0
      ))
    } else {
      // Crear fecha local e interpretarla como clusterTimezone
      const clusterDateLocal = new Date(
        todayInCluster.getFullYear(),
        todayInCluster.getMonth(),
        todayInCluster.getDate(),
        hours,
        minutes,
        0,
        0
      )
      // Convertir de clusterTimezone a UTC
      clusterDate = zonedTimeToUtc(clusterDateLocal, clusterTimezone)
    }
    
    // Convertir a userTimezone para ver qué día y hora es en la timezone del usuario
    // utcToZonedTime toma una fecha UTC y devuelve una fecha que representa ese tiempo en userTimezone
    // IMPORTANTE: Esto NO cambia el timestamp, solo cambia cómo se interpreta la fecha
    // Para obtener el día correcto, necesitamos usar los métodos getFullYear(), getMonth(), getDate() de userDate
    const userDate = utcToZonedTime(clusterDate, userTimezone)
    
    // Calcular dayShift igual que el backend: userYearDay - clusterYearDay
    // IMPORTANTE: Necesitamos usar los componentes de fecha/hora en cada timezone, no el timestamp UTC
    // clusterDate está en UTC, así que usamos getUTCFullYear(), getUTCMonth(), getUTCDate()
    // userDate está en userTimezone, así que usamos getFullYear(), getMonth(), getDate()
    const clusterYear = clusterDate.getUTCFullYear()
    const clusterMonth = clusterDate.getUTCMonth()
    const clusterDay = clusterDate.getUTCDate()
    
    const userYear = userDate.getFullYear()
    const userMonth = userDate.getMonth()
    const userDay = userDate.getDate()
    
    // Calcular yearDay usando los componentes de fecha en cada timezone
    const clusterYearDay = getYearDayFromComponents(clusterYear, clusterMonth, clusterDay)
    const userYearDay = getYearDayFromComponents(userYear, userMonth, userDay)
    
    let dayShift: number
    if (clusterYear === userYear) {
      // Mismo año: diferencia directa de días del año
      dayShift = userYearDay - clusterYearDay
    } else {
      // Diferentes años (cerca del cambio de año): calcular días desde epoch
      // Usar los componentes de fecha para crear fechas comparables
      const clusterDateForEpoch = new Date(Date.UTC(clusterYear, clusterMonth, clusterDay))
      const userDateForEpoch = new Date(Date.UTC(userYear, userMonth, userDay))
      const clusterDaysSinceEpoch = Math.floor(clusterDateForEpoch.getTime() / (1000 * 60 * 60 * 24))
      const userDaysSinceEpoch = Math.floor(userDateForEpoch.getTime() / (1000 * 60 * 60 * 24))
      dayShift = userDaysSinceEpoch - clusterDaysSinceEpoch
    }
    
    // CORRECCIÓN: El backend aplica -dayShift en UpdateSchedule, pero eso está mal.
    // Para corregir esto, aplicamos dayShift directamente:
    // - Si dayShift = -1: restamos 1 día a los weekdays (ej: sábado 6 → viernes 5)
    // - Si dayShift = 0: no cambiamos los weekdays (ej: lunes 1 → lunes 1)
    // - Si dayShift = +1: sumamos 1 día a los weekdays (ej: viernes 5 → sábado 6)
    // La función shiftWeekdays maneja correctamente valores negativos, cero y positivos
    const result = shiftWeekdays(weekdaysUTC, dayShift)
    
    console.log('DEBUG convertWeekdaysFromClusterToUser INPUT:', {
      weekdaysUTC,
      timeUTC,
      clusterTimezone,
      userTimezone,
    })
    
    console.log('DEBUG convertWeekdaysFromClusterToUser DATES:', {
      clusterDate: clusterDate.toISOString(),
      userDate: userDate.toISOString(),
      clusterDateUTC: clusterDate.toUTCString(),
      userDateUTC: userDate.toUTCString(),
    })
    
    console.log('DEBUG convertWeekdaysFromClusterToUser CALCULATION:', {
      clusterYearDay,
      userYearDay,
      dayShift,
      calculation: `userYearDay(${userYearDay}) - clusterYearDay(${clusterYearDay}) = ${dayShift}`,
      'expectedDayShift': 'Para 03:00 UTC (sábado) → 22:00 Colombia (viernes) debería ser -1',
    })
    
    console.log('DEBUG convertWeekdaysFromClusterToUser RESULT:', {
      weekdaysUTC,
      dayShift,
      'shiftWeekdays call': `shiftWeekdays("${weekdaysUTC}", ${dayShift})`,
      result,
      'expected': 'Para weekdaysUTC="6" (sábado) y dayShift=-1, debería resultar "5" (viernes)',
    })
    
    return result
  } catch (error) {
    console.error('Weekdays conversion error:', error)
    return weekdaysUTC
  }
}

// Helper function to calculate day of year (1-365/366) from date components
// Replica la lógica de Go's time.Time.YearDay()
function getYearDayFromComponents(year: number, month: number, day: number): number {
  // Crear fecha de inicio del año (1 de enero)
  const startOfYear = new Date(year, 0, 1)
  // Crear fecha con los componentes dados
  const targetDate = new Date(year, month, day)
  // Calcular diferencia en milisegundos
  const diff = targetDate.getTime() - startOfYear.getTime()
  // Convertir a días y sumar 1 (porque YearDay() en Go es 1-indexed, no 0-indexed)
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1
}

// Helper function to calculate day of year (1-365/366) from a Date object
// Replica la lógica de Go's time.Time.YearDay()
function getYearDay(date: Date): number {
  // Crear fecha de inicio del año en UTC (1 de enero a las 00:00:00 UTC)
  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0))
  // Calcular diferencia en milisegundos
  const diff = date.getTime() - startOfYear.getTime()
  // Convertir a días y sumar 1 (porque YearDay() en Go es 1-indexed, no 0-indexed)
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1
}

/**
 * Formats delay string to minutes
 * @param delayStr Delay string (e.g., "5m", "10m", "30s")
 * @returns Minutes as number
 */
export function parseDelayToMinutes(delayStr: string): number {
  const match = delayStr.match(/^(\d+)([smh])$/)
  if (!match) return 0

  const [, value, unit] = match
  const numValue = parseInt(value, 10)

  switch (unit) {
    case 's':
      return Math.floor(numValue / 60)
    case 'm':
      return numValue
    case 'h':
      return numValue * 60
    default:
      return 0
  }
}

/**
 * Formats minutes to delay string
 * @param minutes Minutes as number
 * @returns Delay string (e.g., "5m")
 */
export function formatMinutesToDelay(minutes: number): string {
  if (minutes === 0) return '0m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`
}

/**
 * Gets timezone display name
 */
export function getTimezoneDisplayName(timezone: string): string {
  const names: Record<string, string> = {
    'America/Bogota': 'Colombia',
    'America/Guayaquil': 'Quito',
    'Europe/Madrid': 'España',
    'America/New_York': 'EST',
    'America/Los_Angeles': 'PST',
    'Europe/London': 'UK',
    'UTC': 'UTC',
    'Asia/Tokyo': 'Japón',
    'America/Sao_Paulo': 'Brasil',
  }
  return names[timezone] || timezone
}

/**
 * Converts a time string from cluster timezone to user timezone
 * @param timeStr Time in HH:MM format (in cluster timezone)
 * @param clusterTimezone IANA timezone (e.g., 'UTC')
 * @param userTimezone IANA timezone (e.g., 'America/Bogota')
 * @returns Time in HH:MM format (in user timezone)
 */
export function convertFromClusterToUser(
  timeStr: string,
  clusterTimezone: string,
  userTimezone: string
): string {
  try {
    // Parse time string
    const [hours, minutes] = timeStr.split(':').map(Number)
    
    // Get current date
    const now = new Date()
    
    // Create date with the specified time in cluster timezone
    const clusterDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes)
    
    // Convert from cluster timezone to UTC, then to user timezone
    const clusterUTC = zonedTimeToUtc(clusterDate, clusterTimezone)
    const userDate = utcToZonedTime(clusterUTC, userTimezone)
    
    // Format user time
    return formatInTimeZone(userDate, userTimezone, 'HH:mm')
  } catch (error) {
    console.error('Timezone conversion error:', error)
    // Fallback: return same time
    return timeStr
  }
}

/**
 * Validates timezone string
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

