import { describe, it, expect } from 'vitest'
import {
  parseDelayToMinutes,
  formatMinutesToDelay,
  formatMinutesToApiDelay,
  toApiDelays,
  fromApiDelays,
  shiftWeekdays,
  isValidTimezone,
} from './timezone'
import type { DelayConfig, WakeDelayConfig } from '@/types'

// El encendido escalonado de un tenant depende de que los delays del formulario lleguen a la
// API con los nombres que esta entiende. Cuando no coincidían, el backend los descartaba sin
// error, no aplicaba tampoco sus valores por defecto y todos los SleepInfo del tenant
// acababan a la misma hora: las aplicaciones arrancaban antes que sus bases de datos.

describe('toApiDelays', () => {
  it('traduce los delays del formulario a las tres claves de la API', () => {
    const delFormulario: DelayConfig = {
      suspendStatefulSetsPostgres: '0m',
      suspendStatefulSetsHdfs: '0m',
      suspendDeploymentsPgbouncer: '5m',
      suspendDeployments: '10m',
    }

    expect(toApiDelays(delFormulario)).toEqual({
      pgHdfsDelay: '0m',
      pgbouncerDelay: '5m',
      deploymentsDelay: '10m',
    })
  })

  it('no emite las claves del formulario, que la API descarta en silencio', () => {
    const resultado = toApiDelays({ suspendDeploymentsPgbouncer: '5m' })

    expect(resultado).not.toHaveProperty('suspendDeploymentsPgbouncer')
    expect(resultado).toEqual({ pgbouncerDelay: '5m' })
  })

  it('cuando Postgres y HDFS difieren se queda con el mayor', () => {
    // Los dos comparten el primer escalón: si se tomara el menor, el segundo escalón
    // empezaría con uno de los dos almacenes aún arrancando.
    const resultado = toApiDelays({
      suspendStatefulSetsPostgres: '2m',
      suspendStatefulSetsHdfs: '7m',
    })

    expect(resultado?.pgHdfsDelay).toBe('7m')
  })

  it('ignora los campos sin equivalente en la API', () => {
    const resultado = toApiDelays({
      suspendStatefulSets: '3m',
      suspendCronJobs: '4m',
    })

    expect(resultado).toBeUndefined()
  })

  it('devuelve undefined cuando no hay delays', () => {
    expect(toApiDelays(undefined)).toBeUndefined()
    expect(toApiDelays({})).toBeUndefined()
  })

  it('expresa los delays en minutos, que es lo único que la API sabe leer', () => {
    // La API parsea un número seguido de una sola unidad, de modo que "1h30m" se leería mal.
    const resultado = toApiDelays({ suspendDeployments: '1h' })

    expect(resultado?.deploymentsDelay).toBe('60m')
  })
})

describe('fromApiDelays', () => {
  it('reparte el escalón de la API entre los campos del formulario', () => {
    const deLaApi: WakeDelayConfig = {
      pgHdfsDelay: '0m',
      pgbouncerDelay: '5m',
      deploymentsDelay: '10m',
    }

    expect(fromApiDelays(deLaApi)).toEqual({
      suspendStatefulSetsPostgres: '0m',
      suspendStatefulSetsHdfs: '0m',
      suspendDeploymentsPgbouncer: '5m',
      suspendDeployments: '10m',
    })
  })

  it('devuelve undefined cuando no hay nada que repartir', () => {
    expect(fromApiDelays(undefined)).toBeUndefined()
    expect(fromApiDelays({})).toBeUndefined()
  })
})

describe('ida y vuelta entre formulario y API', () => {
  it('conserva el escalonado del cluster', () => {
    // El patrón que usan los tenants: bases de datos, PgBouncer a los cinco minutos y el
    // resto a los diez.
    const original: WakeDelayConfig = {
      pgHdfsDelay: '0m',
      pgbouncerDelay: '5m',
      deploymentsDelay: '10m',
    }

    expect(toApiDelays(fromApiDelays(original))).toEqual(original)
  })
})

describe('parseDelayToMinutes', () => {
  it('interpreta minutos, horas y segundos', () => {
    expect(parseDelayToMinutes('0m')).toBe(0)
    expect(parseDelayToMinutes('5m')).toBe(5)
    expect(parseDelayToMinutes('90m')).toBe(90)
    expect(parseDelayToMinutes('1h')).toBe(60)
    expect(parseDelayToMinutes('120s')).toBe(2)
  })

  it('devuelve cero ante un valor que no reconoce', () => {
    expect(parseDelayToMinutes('')).toBe(0)
    expect(parseDelayToMinutes('cinco')).toBe(0)
    expect(parseDelayToMinutes('1h30m')).toBe(0)
  })
})

describe('formatMinutesToApiDelay', () => {
  it('siempre expresa el valor en minutos', () => {
    expect(formatMinutesToApiDelay(0)).toBe('0m')
    expect(formatMinutesToApiDelay(5)).toBe('5m')
    // formatMinutesToDelay produce "1h30m" para la interfaz, que la API no sabe leer.
    expect(formatMinutesToDelay(90)).toBe('1h30m')
    expect(formatMinutesToApiDelay(90)).toBe('90m')
  })

  it('no admite valores negativos', () => {
    expect(formatMinutesToApiDelay(-5)).toBe('0m')
  })
})

describe('shiftWeekdays', () => {
  it('no toca los días cuando no hay cambio de día', () => {
    expect(shiftWeekdays('1-5', 0)).toBe('1-5')
  })

  it('retrocede un día y comprime el rango', () => {
    // Viernes 22:00 en Bogotá es sábado 03:00 en el cluster: la interfaz tiene que volver a
    // mostrar de lunes a viernes.
    expect(shiftWeekdays('2-6', -1)).toBe('1-5')
  })

  it('cruza el fin de semana en ambos sentidos', () => {
    expect(shiftWeekdays('6', 1)).toBe('0')
    expect(shiftWeekdays('0', -1)).toBe('6')
  })
})

describe('isValidTimezone', () => {
  it('acepta las zonas que se usan en el cluster', () => {
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('America/Bogota')).toBe(true)
  })

  it('rechaza lo que no es una zona horaria', () => {
    expect(isValidTimezone('No/Existe')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })
})
