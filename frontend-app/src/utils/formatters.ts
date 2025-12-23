import { WEEKDAY_NAMES } from '@/types'

/**
 * Format weekdays string to human readable
 */
export function formatWeekdays(weekdays: string): string {
  if (weekdays === '*') return 'Todos los días'
  if (weekdays.includes('-')) {
    const [start, end] = weekdays.split('-').map(Number)
    const days = []
    for (let i = start; i <= end; i++) {
      days.push(WEEKDAY_NAMES[i.toString() as keyof typeof WEEKDAY_NAMES])
    }
    return days.join(', ')
  }
  const days = weekdays.split(',').map(
    (d) => WEEKDAY_NAMES[d.trim() as keyof typeof WEEKDAY_NAMES]
  )
  return days.join(', ')
}

