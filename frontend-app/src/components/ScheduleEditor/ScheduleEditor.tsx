import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Container,
  Typography,
  Box,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  FormControlLabel,
  Checkbox,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material'
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material'
import {
  useTenants,
  useCreateSchedule,
  useUpdateSchedule,
  useSchedules,
  useNamespaceSchedule,
  useCreateNamespaceSchedule,
  useUpdateNamespaceSchedule,
  useDeleteSchedule,
} from '../../hooks/useTenants'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../services/api'
import { convertTimezone, convertFromClusterToUser, getTimezoneDisplayName, convertWeekdaysFromClusterToUser, formatMinutesToDelay } from '../../utils/timezone'
import type { CreateScheduleRequest } from '../../types'
import { WEEKDAY_NAMES } from '../../types'

const TIMEZONES = [
  { value: 'America/Bogota', label: 'America/Bogota (Colombia)' },
  { value: 'America/Guayaquil', label: 'America/Guayaquil (Quito)' },
  { value: 'Europe/Madrid', label: 'Europe/Madrid (España)' },
  { value: 'America/New_York', label: 'America/New_York (EST)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST)' },
  { value: 'Europe/London', label: 'Europe/London (UK)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (Japón)' },
  { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo (Brasil)' },
]

export default function ScheduleEditor() {
  const { tenantName } = useParams<{ tenantName?: string }>()
  const [searchParams] = useSearchParams()
  const scheduleNameParam = searchParams.get('scheduleName') || ''
  const namespaceParam = searchParams.get('namespace') || ''
  const isNamespaceEdit = !!namespaceParam
  const isEditMode = !!tenantName
  const navigate = useNavigate()
  const [formData, setFormData] = useState<CreateScheduleRequest>({
    tenant: tenantName || '',
    scheduleName: '',
    description: '',
    userTimezone: 'America/Bogota',
    clusterTimezone: 'UTC',
    off: '21:30',
    on: '06:00',
    weekdaysSleep: '0-6', // Por defecto: todos los días
    weekdaysWake: '0-6', // Por defecto: todos los días
    namespaces: [],
    delays: {
      suspendDeployments: '5m',
      suspendStatefulSets: '7m',
      suspendCronJobs: '0m',
      suspendDeploymentsPgbouncer: '5m',
      suspendStatefulSetsPostgres: '0m',
      suspendStatefulSetsHdfs: '0m',
    },
  })
  const { data: tenantsData, isLoading: tenantsLoading, refetch: refetchTenants } = useTenants()
  const tenantForValidation = tenantName || formData.tenant
  const { data: existingSchedule, refetch: refetchSchedule, dataUpdatedAt } = useSchedules(
    tenantForValidation || '',
    undefined
  )
  const { data: namespaceSchedule, refetch: refetchNamespaceSchedule } = useNamespaceSchedule(
    tenantName || '',
    namespaceParam
  )
  const createMutation = useCreateSchedule()
  const updateMutation = useUpdateSchedule()
  const createNamespaceMutation = useCreateNamespaceSchedule()
  const updateNamespaceMutation = useUpdateNamespaceSchedule()
  const deleteMutation = useDeleteSchedule()
  const queryClient = useQueryClient()

  // Refrescar datos de tenants cuando cambia el tenant seleccionado
  useEffect(() => {
    if (formData.tenant && !tenantName) {
      refetchTenants()
    }
  }, [formData.tenant, tenantName, refetchTenants])

  // Estados separados para días de apagado y encendido
  const [selectedSleepWeekdays, setSelectedSleepWeekdays] = useState<Set<string>>(new Set(['0', '1', '2', '3', '4', '5', '6']))
  const [selectedWakeWeekdays, setSelectedWakeWeekdays] = useState<Set<string>>(new Set(['0', '1', '2', '3', '4', '5', '6']))
  const [showDelays, setShowDelays] = useState(false)
  const [showExclusions, setShowExclusions] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [exclusions, setExclusions] = useState<Array<{ namespace: string; labelKey: string; labelValue: string; selectedService?: string }>>([])
  // Estado para almacenar TODAS las exclusiones cargadas (sin filtrar)
  const [allExclusionsLoaded, setAllExclusionsLoaded] = useState<Array<{ namespace: string; labelKey: string; labelValue: string; selectedService?: string }>>([])
  
  // Estado para almacenar servicios cargados por namespace
  const [servicesByNamespace, setServicesByNamespace] = useState<Map<string, any[]>>(new Map())

  const handleDeleteSchedule = async () => {
    if (!formData.tenant) return
    const deleteName = scheduleNameParam || formData.scheduleName || ''
    if (!deleteName) {
      setDeleteError('No se encontró el nombre del schedule para eliminar.')
      return
    }
    setDeleteError(null)
    try {
      await deleteMutation.mutateAsync({
        tenant: formData.tenant,
        namespace: isNamespaceEdit ? namespaceParam : undefined,
        scheduleName: deleteName,
      })
      setDeleteDialogOpen(false)
      navigate('/')
    } catch (err: any) {
      setDeleteError(err?.response?.data?.error || err?.message || 'Error al eliminar el schedule')
    }
  }
  
  // Función helper para actualizar exclusiones y mantener sincronizadas ambas listas
  const updateExclusions = (newExclusions: Array<{ namespace: string; labelKey: string; labelValue: string; selectedService?: string }>) => {
    // Actualizar todas las exclusiones cargadas
    setAllExclusionsLoaded((prevAll) => {
      // Crear un mapa para tracking rápido
      const newMap = new Map<string, { namespace: string; labelKey: string; labelValue: string; selectedService?: string }>()
      
      // Primero agregar todas las exclusiones existentes que NO están en los namespaces seleccionados
      prevAll.forEach(excl => {
        if (!formData.namespaces.includes(excl.namespace)) {
          const key = `${excl.namespace}:${excl.labelKey}:${excl.labelValue}`
          newMap.set(key, excl)
        }
      })
      
      // Luego agregar/actualizar las exclusiones de los namespaces seleccionados
      newExclusions.forEach(excl => {
        const key = `${excl.namespace}:${excl.labelKey}:${excl.labelValue}`
        newMap.set(key, excl)
      })
      
      return Array.from(newMap.values())
    })
    
    // Actualizar exclusiones filtradas (solo las de namespaces seleccionados)
    setExclusions(newExclusions)
  }
  
  // Filtrar exclusiones basándose en los namespaces seleccionados
  useEffect(() => {
    if (formData.namespaces.length === 0) {
      // Si no hay namespaces seleccionados, no mostrar exclusiones
      setExclusions([])
    } else {
      // Filtrar exclusiones para mostrar solo las de los namespaces seleccionados
      const filteredExclusions = allExclusionsLoaded.filter(excl => 
        formData.namespaces.includes(excl.namespace)
      )
      setExclusions(filteredExclusions)
    }
  }, [formData.namespaces, allExclusionsLoaded])

  const visibleExclusions = useMemo(() => {
    return exclusions
      .map((excl, index) => ({ excl, index }))
      .filter(({ excl }) => (isNamespaceEdit ? excl.namespace === namespaceParam : true))
  }, [exclusions, isNamespaceEdit, namespaceParam])
  
  // Función para cargar servicios de un namespace
  const loadNamespaceServices = async (tenant: string, namespaceSuffix: string) => {
    try {
      const servicesData = await apiClient.getNamespaceServices(tenant, namespaceSuffix)
      const services = servicesData.services || []
      // Filtrar solo Deployments y StatefulSets
      const filteredServices = services.filter((s: any) => 
        s.kind === 'Deployment' || s.kind === 'StatefulSet'
      )
      setServicesByNamespace((prev) => {
        const newMap = new Map(prev)
        newMap.set(namespaceSuffix, filteredServices)
        return newMap
      })
    } catch (error) {
      console.error(`Error loading services for ${tenant}-${namespaceSuffix}:`, error)
      setServicesByNamespace((prev) => {
        const newMap = new Map(prev)
        newMap.set(namespaceSuffix, [])
        return newMap
      })
    }
  }
  
  // Cargar servicios cuando se selecciona un namespace para exclusiones
  const handleNamespaceSelectForExclusion = (namespaceSuffix: string) => {
    if (formData.tenant && namespaceSuffix && !servicesByNamespace.has(namespaceSuffix)) {
      loadNamespaceServices(formData.tenant, namespaceSuffix)
    }
  }

  // Cargar datos existentes cuando se edita
  // IMPORTANTE: dataUpdatedAt fuerza que el useEffect se ejecute cuando los datos se actualizan
  useEffect(() => {
    console.log('DEBUG useEffect: ejecutándose', {
      tenantName,
      scheduleNameParam,
      namespaceParam,
      isNamespaceEdit,
      hasSchedule: !!existingSchedule,
      hasNamespaceSchedule: !!namespaceSchedule,
      dataUpdatedAt,
    })
    if (tenantName && isNamespaceEdit && namespaceSchedule) {
      const loadNamespaceData = async () => {
        try {
          const sleepInfos = Array.isArray(namespaceSchedule.sleepInfos)
            ? namespaceSchedule.sleepInfos
            : []
          const matchesScheduleName = (info: any) => {
            if (!scheduleNameParam) return true
            const nameFromAnnotation = info?.annotations?.['kube-green.stratio.com/schedule-name']
            const nameFromSummary = info?.name
            return nameFromAnnotation === scheduleNameParam || nameFromSummary === scheduleNameParam
          }
          const filteredSleepInfos = sleepInfos.filter(matchesScheduleName)

          if (scheduleNameParam && filteredSleepInfos.length === 0) {
            setError(`No se encontró el schedule "${scheduleNameParam}" para este namespace.`)
            return
          }

          const sleepInfo = filteredSleepInfos.find(
            (info: any) =>
              info.role === 'sleep' ||
              info.annotations?.['kube-green.stratio.com/pair-role'] === 'sleep' ||
              info.name?.startsWith('sleep')
          )
          const wakeInfo = filteredSleepInfos.find(
            (info: any) =>
              info.role === 'wake' ||
              info.annotations?.['kube-green.stratio.com/pair-role'] === 'wake' ||
              info.name?.startsWith('wake')
          )
          const firstInfo = sleepInfo || wakeInfo || filteredSleepInfos[0]

          const sleepTimeUTC = sleepInfo?.sleepAt || sleepInfo?.time || sleepInfo?.Time || null
          const wakeTimeUTC = wakeInfo?.wakeUpAt || wakeInfo?.sleepAt || wakeInfo?.time || wakeInfo?.Time || null
          const timeZone = sleepInfo?.timeZone || wakeInfo?.timeZone || firstInfo?.timeZone || null
          const extractedUserTimezone =
            sleepInfo?.annotations?.['kube-green.stratio.com/user-timezone'] ||
            wakeInfo?.annotations?.['kube-green.stratio.com/user-timezone'] ||
            formData.userTimezone ||
            'America/Bogota'

          const sleepWeekdaysStr = sleepInfo?.weekdays || sleepInfo?.Weekdays
          const wakeWeekdaysStr = wakeInfo?.weekdays || wakeInfo?.Weekdays

          if (sleepWeekdaysStr) {
            setSelectedSleepWeekdays(parseWeekdays(sleepWeekdaysStr))
          } else {
            setSelectedSleepWeekdays(new Set(['0', '1', '2', '3', '4', '5', '6']))
          }
          if (wakeWeekdaysStr) {
            setSelectedWakeWeekdays(parseWeekdays(wakeWeekdaysStr))
          } else {
            setSelectedWakeWeekdays(new Set(['0', '1', '2', '3', '4', '5', '6']))
          }

          let sleepTime = sleepTimeUTC
          let wakeTime = wakeTimeUTC
          if (sleepTimeUTC && timeZone) {
            sleepTime = convertFromClusterToUser(sleepTimeUTC, timeZone, extractedUserTimezone)
          }
          if (wakeTimeUTC && timeZone) {
            wakeTime = convertFromClusterToUser(wakeTimeUTC, timeZone, extractedUserTimezone)
          }

          const scheduleName =
            sleepInfo?.annotations?.['kube-green.stratio.com/schedule-name'] ||
            wakeInfo?.annotations?.['kube-green.stratio.com/schedule-name'] ||
            scheduleNameParam ||
            ''
          const description =
            sleepInfo?.annotations?.['kube-green.stratio.com/schedule-description'] ||
            wakeInfo?.annotations?.['kube-green.stratio.com/schedule-description'] ||
            ''

          setFormData((prev) => ({
            ...prev,
            tenant: tenantName,
            namespaces: [namespaceParam],
            scheduleName,
            description,
            userTimezone: extractedUserTimezone,
            ...(sleepTime && { off: sleepTime }),
            ...(wakeTime && { on: wakeTime }),
            ...(timeZone && { clusterTimezone: timeZone }),
            ...(sleepWeekdaysStr && { weekdaysSleep: weekdaysToString(parseWeekdays(sleepWeekdaysStr)) }),
            ...(wakeWeekdaysStr && { weekdaysWake: weekdaysToString(parseWeekdays(wakeWeekdaysStr)) }),
          }))

          const extractedExclusions = new Map<
            string,
            { namespace: string; labelKey: string; labelValue: string; selectedService?: string }
          >()
          filteredSleepInfos.forEach((info: any) => {
            if (info.excludeRef && Array.isArray(info.excludeRef)) {
              info.excludeRef.forEach((excl: any) => {
                if (excl.matchLabels && typeof excl.matchLabels === 'object') {
                  Object.entries(excl.matchLabels).forEach(([key, value]) => {
                    const exclusionKey = `${namespaceParam}:${key}:${value}`
                    if (!extractedExclusions.has(exclusionKey)) {
                      extractedExclusions.set(exclusionKey, {
                        namespace: namespaceParam,
                        labelKey: key,
                        labelValue: String(value),
                        selectedService: '',
                      })
                    }
                  })
                }
              })
            }
          })

          const allExclusions = Array.from(extractedExclusions.values())
          setAllExclusionsLoaded(allExclusions)
          setExclusions(allExclusions)
          if (allExclusions.length > 0) {
            setShowExclusions(true)
          }
        } catch (error) {
          console.error('Error parsing namespace schedule:', error)
          setFormData((prev) => ({ ...prev, tenant: tenantName || '' }))
        }
      }

      loadNamespaceData()
      return
    }

    if (tenantName && existingSchedule) {
      const loadData = async () => {
        try {
          console.log('DEBUG loadData: cargando datos del schedule', existingSchedule)
          // Extraer namespaces del schedule existente
          const matchesScheduleName = (schedule: any) => {
            if (!scheduleNameParam) return true
            const nameFromAnnotation = schedule?.annotations?.['kube-green.stratio.com/schedule-name']
            const nameFromSummary = schedule?.name
            return nameFromAnnotation === scheduleNameParam || nameFromSummary === scheduleNameParam
          }

          const namespaces = Object.keys(existingSchedule.namespaces || {}).filter((namespace) => {
            if (!scheduleNameParam) return true
            const nsSchedules = (existingSchedule.namespaces || {})[namespace]
            const schedulesArray = Array.isArray(nsSchedules)
              ? nsSchedules
              : (nsSchedules as any)?.schedule || []
            return schedulesArray.some(matchesScheduleName)
          })
          
          // Buscar el primer schedule para extraer información común
          let firstSchedule: any = null
          const allSchedules: any[] = []
          
          // Recopilar todos los schedules y sus exclusiones
          for (const nsSchedules of Object.values(existingSchedule.namespaces || {})) {
            let schedules: any[] = []
            if (Array.isArray(nsSchedules)) {
              schedules = nsSchedules
            } else if (nsSchedules && typeof nsSchedules === 'object' && 'schedule' in nsSchedules) {
              schedules = (nsSchedules as any).schedule || []
            }

            const filtered = schedules.filter(matchesScheduleName)
            if (filtered.length > 0) {
              allSchedules.push(...filtered)
              if (!firstSchedule) {
                firstSchedule = filtered[0]
              }
            }
          }

          if (scheduleNameParam && allSchedules.length === 0) {
            setError(`No se encontró el schedule "${scheduleNameParam}" para este tenant.`)
            return
          }

          if (firstSchedule) {
            // Separar weekdays de sleep y wake
            // Buscar schedules sleep y wake por separado
            let sleepSchedule = allSchedules.find((s: any) => 
              s.role === 'sleep' || 
              s.annotations?.['kube-green.stratio.com/pair-role'] === 'sleep' ||
              s.name?.startsWith('sleep')
            )
            let wakeSchedule = allSchedules.find((s: any) => 
              s.role === 'wake' || 
              s.annotations?.['kube-green.stratio.com/pair-role'] === 'wake' ||
              s.name?.startsWith('wake')
            )
            
            // Si no se encuentran separados, buscar en el schedule único
            if (!sleepSchedule) {
              // Buscar schedule con sleepTime o que tenga ambos sleepTime y wakeUpAt
              sleepSchedule = allSchedules.find((s: any) => s.sleepTime || s.SleepTime || (s.Time && !s.wakeTime && !s.WakeTime)) || firstSchedule
            }
            if (!wakeSchedule) {
              // Buscar schedule con wakeTime o wakeUpAt
              wakeSchedule = allSchedules.find((s: any) => s.wakeTime || s.WakeTime || (s.Time && (s.wakeTime || s.WakeTime))) || firstSchedule
            }
            
            // Extraer horas REALES primero (sin fallbacks hardcodeados)
            // IMPORTANTE: Cuando weekdays son diferentes, el SleepInfo wake tiene sleepAt (no wakeUpAt)
            // Para sleep: usar Time (que viene de sleepAt en el CRD)
            const sleepTimeUTC = sleepSchedule.time || 
                            sleepSchedule.sleepTime || 
                            (sleepSchedule.role === 'sleep' ? sleepSchedule.Time : null) || 
                            sleepSchedule.SleepTime || 
                            null
            // Para wake: usar Time (que viene de sleepAt cuando es un SleepInfo separado)
            // El backend devuelve 'time' en SleepInfoSummary para wake también
            const wakeTimeUTC = wakeSchedule.time || 
                            wakeSchedule.Time || 
                            wakeSchedule.wakeTime || 
                            wakeSchedule.WakeTime || 
                            null
            
            // Detectar timezone REAL (sin fallback)
            const timeZone = sleepSchedule.timeZone || sleepSchedule.TimeZone || wakeSchedule.timeZone || wakeSchedule.TimeZone || null
            
            // Extraer weekdays REALES de sleep y wake (sin fallbacks)
            // IMPORTANTE: Los weekdays vienen en UTC (ya shiftados), necesitamos convertirlos de vuelta a la timezone del usuario
            let sleepWeekdaysStr = sleepSchedule.weekdays || sleepSchedule.Weekdays
            let wakeWeekdaysStr = wakeSchedule.weekdays || wakeSchedule.Weekdays
            
            // IMPORTANTE: Extraer userTimezone ANTES de convertir weekdays
            // Esto debe hacerse antes de las conversiones para usar la timezone correcta
            const extractedUserTimezone = sleepSchedule.annotations?.['kube-green.stratio.com/user-timezone'] ||
                                         wakeSchedule.annotations?.['kube-green.stratio.com/user-timezone'] ||
                                         formData.userTimezone || 'America/Bogota'
            
            // Convertir weekdays de UTC de vuelta a la timezone del usuario
            // IMPORTANTE: Si sleepTimeUTC es null, intentar usar el tiempo del wake schedule como fallback
            const timeForSleepConversion = sleepTimeUTC || wakeTimeUTC || null
            console.log('DEBUG: Antes de convertir weekdays:', {
              sleepWeekdaysStr,
              sleepTimeUTC,
              wakeTimeUTC,
              timeForSleepConversion,
              timeZone,
              extractedUserTimezone,
            })
            if (sleepWeekdaysStr && timeForSleepConversion && timeZone) {
              const converted = convertWeekdaysFromClusterToUser(
                sleepWeekdaysStr,
                timeForSleepConversion,
                timeZone,
                extractedUserTimezone
              )
              console.log('DEBUG: Después de convertir weekdays:', {
                original: sleepWeekdaysStr,
                converted,
              })
              sleepWeekdaysStr = converted
            } else {
              console.warn('DEBUG: NO se convirtieron weekdays porque:', {
                sleepWeekdaysStr: !!sleepWeekdaysStr,
                timeForSleepConversion: !!timeForSleepConversion,
                timeZone: !!timeZone,
              })
            }
            // Para wake, usar SOLO wakeTimeUTC (no usar sleepTimeUTC como fallback)
            // Si no hay wakeTimeUTC, no convertir porque no podemos calcular el dayShift correctamente
            if (wakeWeekdaysStr && wakeTimeUTC && timeZone) {
              wakeWeekdaysStr = convertWeekdaysFromClusterToUser(
                wakeWeekdaysStr,
                wakeTimeUTC,
                timeZone,
                extractedUserTimezone
              )
            }
            
            // DEBUG: Log para ver qué estamos recibiendo
            console.log('DEBUG: sleepSchedule:', sleepSchedule)
            console.log('DEBUG: wakeSchedule:', wakeSchedule)
            console.log('DEBUG: sleepWeekdaysStr (UTC):', sleepSchedule.weekdays || sleepSchedule.Weekdays)
            console.log('DEBUG: wakeWeekdaysStr (UTC):', wakeSchedule.weekdays || wakeSchedule.Weekdays)
            console.log('DEBUG: sleepWeekdaysStr (converted to user):', sleepWeekdaysStr)
            console.log('DEBUG: wakeWeekdaysStr (converted to user):', wakeWeekdaysStr)
            
            // Solo parsear si existen valores reales
            if (sleepWeekdaysStr) {
              const sleepWeekdays = parseWeekdays(sleepWeekdaysStr)
              console.log('DEBUG: parsed sleepWeekdays:', sleepWeekdays)
              setSelectedSleepWeekdays(sleepWeekdays)
            } else {
              // Si no hay weekdays, usar todos los días por defecto
              console.log('DEBUG: No sleepWeekdaysStr found, using default (0-6)')
              setSelectedSleepWeekdays(new Set(['0', '1', '2', '3', '4', '5', '6']))
            }
            if (wakeWeekdaysStr) {
              const wakeWeekdays = parseWeekdays(wakeWeekdaysStr)
              console.log('DEBUG: parsed wakeWeekdays:', wakeWeekdays)
              setSelectedWakeWeekdays(wakeWeekdays)
            } else {
              // Si no hay weekdays, usar todos los días por defecto
              console.log('DEBUG: No wakeWeekdaysStr found, using default (0-6)')
              setSelectedWakeWeekdays(new Set(['0', '1', '2', '3', '4', '5', '6']))
            }
            
            // Convertir tiempos de UTC a timezone del usuario si existen
            // Usar la timezone extraída de los annotations
            let sleepTime = sleepTimeUTC
            let wakeTime = wakeTimeUTC
            if (sleepTimeUTC && timeZone) {
              sleepTime = convertFromClusterToUser(sleepTimeUTC, timeZone, extractedUserTimezone)
              console.log('DEBUG: Converted sleep time', { from: sleepTimeUTC, to: sleepTime, timeZone, userTimezone: extractedUserTimezone })
            }
            if (wakeTimeUTC && timeZone) {
              wakeTime = convertFromClusterToUser(wakeTimeUTC, timeZone, extractedUserTimezone)
              console.log('DEBUG: Converted wake time', { from: wakeTimeUTC, to: wakeTime, timeZone, userTimezone: extractedUserTimezone })
            }

            // Extraer scheduleName y description de annotations si existen
            const scheduleName = sleepSchedule.annotations?.['kube-green.stratio.com/schedule-name'] || 
                               wakeSchedule.annotations?.['kube-green.stratio.com/schedule-name'] || 
                               scheduleNameParam ||
                               ''
            const description = sleepSchedule.annotations?.['kube-green.stratio.com/schedule-description'] || 
                               wakeSchedule.annotations?.['kube-green.stratio.com/schedule-description'] || 
                               ''

            // Extraer delays del schedule existente (solo para datastores con staggered wake)
            let extractedDelays: any = undefined
            const datastoresNS = existingSchedule.namespaces?.['datastores']
            if (datastoresNS && namespaces.includes('datastores')) {
              const datastoresSchedules = Array.isArray(datastoresNS) 
                ? datastoresNS 
                : (datastoresNS.schedule || [])
              
              // Buscar todos los schedules wake en datastores
              const wakeSchedules = datastoresSchedules.filter((s: any) => 
                s.role === 'wake' || 
                s.annotations?.['kube-green.stratio.com/pair-role'] === 'wake' ||
                s.name?.startsWith('wake')
              )

              if (wakeSchedules.length >= 2) {
                // Encontrar el tiempo base (el más temprano) - este es PgHDFS (t0)
                const baseTime = wakeSchedules.reduce((earliest: string, sched: any) => {
                  const time = sched.time || sched.Time || ''
                  return (!earliest || time < earliest) ? time : earliest
                }, '')

                if (baseTime) {
                  extractedDelays = {}
                  
                  // Calcular delays basándose en los tiempos
                  wakeSchedules.forEach((sched: any) => {
                    const schedTime = sched.time || sched.Time || ''
                    if (schedTime === baseTime) return // Skip el tiempo base

                    // Calcular diferencia en minutos
                    const delayMinutes = calculateTimeDifferenceMinutes(baseTime, schedTime)
                    
                    // Ajustar si el delay es negativo (cambio de día)
                    const adjustedDelayMinutes = delayMinutes < 0 ? delayMinutes + 24 * 60 : delayMinutes
                    
                    // Identificar el tipo de delay basándose en los recursos
                    const resources = (sched.resources || []).map((r: string) => r.toLowerCase())
                    const hasPostgres = resources.some((r: string) => r.includes('postgres'))
                    const hasHdfs = resources.some((r: string) => r.includes('hdfs'))
                    const hasPgbouncer = resources.some((r: string) => r.includes('pgbouncer'))
                    const hasDeployments = resources.some((r: string) => r.includes('deployment'))

                    // Mapear a los campos de DelayConfig
                    if (hasPgbouncer && !hasDeployments && !extractedDelays.suspendDeploymentsPgbouncer) {
                      extractedDelays.suspendDeploymentsPgbouncer = formatMinutesToDelay(adjustedDelayMinutes)
                    } else if (hasDeployments && !hasPostgres && !hasHdfs && !extractedDelays.suspendDeployments) {
                      extractedDelays.suspendDeployments = formatMinutesToDelay(adjustedDelayMinutes)
                    }
                  })

                  // Solo usar si se encontraron delays
                  if (Object.keys(extractedDelays).length === 0) {
                    extractedDelays = undefined
                  }
                }
              }
            }

            // Solo actualizar formData con valores REALES (no usar fallbacks)
            // IMPORTANTE: Usar la timezone extraída de los annotations
            setFormData((prev) => ({
              ...prev,
              tenant: tenantName,
              namespaces: namespaces,
              scheduleName: scheduleName,
              description: description,
              // Actualizar userTimezone con la extraída del schedule (no hardcodeada)
              userTimezone: extractedUserTimezone,
              // Solo actualizar si hay valores reales
              ...(sleepTime && { off: sleepTime }),
              ...(wakeTime && { on: wakeTime }),
              ...(timeZone && { clusterTimezone: timeZone }),
              ...(sleepWeekdaysStr && { weekdaysSleep: weekdaysToString(parseWeekdays(sleepWeekdaysStr)) }),
              ...(wakeWeekdaysStr && { weekdaysWake: weekdaysToString(parseWeekdays(wakeWeekdaysStr)) }),
              // Preservar delays extraídos si existen, sino mantener los actuales
              ...(extractedDelays && { delays: { ...prev.delays, ...extractedDelays } }),
            }))

            // Si se extrajeron delays, mostrar la sección automáticamente
            if (extractedDelays) {
              setShowDelays(true)
            }
          } else {
            // Si no hay schedule, solo establecer tenant y namespaces
            setFormData((prev) => ({
              ...prev,
              tenant: tenantName,
              namespaces: namespaces,
            }))
          }

          // Extraer exclusiones de todos los schedules (TODAS, incluyendo virtualizer y otras del sistema)
          const extractedExclusions = new Map<string, { namespace: string; labelKey: string; labelValue: string; selectedService?: string }>()
          
          // Función helper para extraer exclusiones de un schedule
          const extractExclusionsFromSchedule = (schedule: any, namespaceSuffix: string) => {
            if (schedule.excludeRef && Array.isArray(schedule.excludeRef)) {
              schedule.excludeRef.forEach((excl: any) => {
                if (excl.matchLabels && typeof excl.matchLabels === 'object') {
                  Object.entries(excl.matchLabels).forEach(([key, value]) => {
                    // Crear una clave única para evitar duplicados
                    const exclusionKey = `${namespaceSuffix}:${key}:${value}`
                    if (!extractedExclusions.has(exclusionKey)) {
                      extractedExclusions.set(exclusionKey, {
                        namespace: namespaceSuffix,
                        labelKey: key,
                        labelValue: String(value),
                        selectedService: '', // Se identificará después al cargar servicios
                      })
                    }
                  })
                }
              })
            }
          }

          // Extraer exclusiones por namespace
          Object.entries(existingSchedule.namespaces || {}).forEach(([namespaceSuffix, nsData]: [string, any]) => {
            // Manejar diferentes formatos de estructura de datos
            let schedulesArray: any[] = []
            if (Array.isArray(nsData)) {
              schedulesArray = nsData
            } else if (nsData && typeof nsData === 'object' && 'schedule' in nsData) {
              schedulesArray = Array.isArray(nsData.schedule) ? nsData.schedule : []
            }

            schedulesArray.forEach((schedule: any) => {
              if (matchesScheduleName(schedule)) {
                extractExclusionsFromSchedule(schedule, namespaceSuffix)
              }
            })
          })

          // Convertir todas las exclusiones extraídas a array
          let allExclusions = Array.from(extractedExclusions.values())

          // Cargar servicios para namespaces que tienen exclusiones
          const uniqueNamespaces = new Set(allExclusions.map(excl => excl.namespace))
          const updatedServicesByNamespace = new Map<string, any[]>()
          
          // Cargar servicios para cada namespace único directamente
          for (const namespaceSuffix of uniqueNamespaces) {
            if (tenantName && namespaceSuffix) {
              try {
                const servicesData = await apiClient.getNamespaceServices(tenantName, namespaceSuffix)
                const services = servicesData.services || []
                const filteredServices = services.filter((s: any) => 
                  s.kind === 'Deployment' || s.kind === 'StatefulSet'
                )
                updatedServicesByNamespace.set(namespaceSuffix, filteredServices)
              } catch (error) {
                console.error(`Error loading services for ${tenantName}-${namespaceSuffix}:`, error)
                updatedServicesByNamespace.set(namespaceSuffix, [])
              }
            }
          }

          // Actualizar el estado de servicesByNamespace primero
          setServicesByNamespace(updatedServicesByNamespace)

          // Ahora asociar servicios y labels usando los servicios cargados
          allExclusions = allExclusions.map((excl) => {
            const namespaceServices = updatedServicesByNamespace.get(excl.namespace) || []
            
            // PRIMERO: Buscar servicio que tenga el label key/value correspondiente EXACTO
            const matchingService = namespaceServices.find((s: any) => {
              return s.labels && s.labels[excl.labelKey] === excl.labelValue
            })

            if (matchingService) {
              return {
                ...excl,
                selectedService: matchingService.name,
              }
            }

            // SEGUNDO: Buscar cualquier servicio que tenga el labelKey (aunque el valor sea diferente)
            // Esto es útil cuando el labelValue puede haber cambiado pero el labelKey sigue siendo válido
            const serviceWithLabelKey = namespaceServices.find((s: any) => {
              return s.labels && s.labels[excl.labelKey]
            })

            if (serviceWithLabelKey) {
              // Si encontramos un servicio con el labelKey, actualizar el labelValue al del servicio
              return {
                ...excl,
                selectedService: serviceWithLabelKey.name,
                labelValue: serviceWithLabelKey.labels[excl.labelKey] || excl.labelValue,
              }
            }

            // TERCERO: Intentar buscar por el nombre del servicio basado en el labelValue
            // (ej: virtualizer.bdadevdat-apps -> buscar servicio con "virtualizer" en el nombre)
            if (excl.labelValue) {
              const labelValuePrefix = excl.labelValue.split('.')[0].toLowerCase()
              const serviceByName = namespaceServices.find((s: any) => {
                return s.name && s.name.toLowerCase().includes(labelValuePrefix)
              })

              if (serviceByName) {
                // Si encontramos por nombre, verificar si tiene el labelKey
                if (serviceByName.labels && serviceByName.labels[excl.labelKey]) {
                  return {
                    ...excl,
                    selectedService: serviceByName.name,
                    labelValue: serviceByName.labels[excl.labelKey],
                  }
                } else {
                  return {
                    ...excl,
                    selectedService: serviceByName.name,
                  }
                }
              }
            }

            // Si no encontramos el servicio, mantener la exclusión con labelKey y labelValue pero sin servicio
            // Esto es válido porque la exclusión puede estar basada en labels que no necesariamente están en un servicio específico
            return excl
          })

          // Guardar TODAS las exclusiones cargadas (sin filtrar)
          setAllExclusionsLoaded(allExclusions)
          
          // Filtrar exclusiones basándose en los namespaces seleccionados inicialmente
          const initialSelectedNamespaces = namespaces.length > 0 ? namespaces : []
          const filteredExclusions = initialSelectedNamespaces.length > 0
            ? allExclusions.filter(excl => initialSelectedNamespaces.includes(excl.namespace))
            : allExclusions
          
          setExclusions(filteredExclusions)
          
          // Si hay exclusiones, mostrar la sección automáticamente
          if (filteredExclusions.length > 0) {
            setShowExclusions(true)
          }
        } catch (error) {
          console.error('Error parsing existing schedule:', error)
          // Si hay error, solo establecer tenant
          setFormData((prev) => ({ ...prev, tenant: tenantName || '' }))
        }
      }

      loadData()
    }
  }, [
    tenantName,
    scheduleNameParam,
    namespaceParam,
    isNamespaceEdit,
    existingSchedule,
    namespaceSchedule,
    dataUpdatedAt,
  ])

  // Parsear weekdays string a Set
  const parseWeekdays = (weekdaysStr: string): Set<string> => {
    const days = new Set<string>()
    if (weekdaysStr.includes('-')) {
      // Rango como "1-5"
      const [start, end] = weekdaysStr.split('-').map(Number)
      for (let i = start; i <= end; i++) {
        days.add(i.toString())
      }
    } else {
      // Lista separada por comas como "0,6"
      weekdaysStr.split(',').forEach((day) => days.add(day.trim()))
    }
    return days
  }

  // Calcular diferencia en minutos entre dos tiempos HH:MM
  const calculateTimeDifferenceMinutes = (time1: string, time2: string): number => {
    const parts1 = time1.split(':')
    const parts2 = time2.split(':')
    if (parts1.length !== 2 || parts2.length !== 2) {
      return 0
    }

    const hour1 = parseInt(parts1[0], 10)
    const min1 = parseInt(parts1[1], 10)
    const hour2 = parseInt(parts2[0], 10)
    const min2 = parseInt(parts2[1], 10)

    const totalMinutes1 = hour1 * 60 + min1
    const totalMinutes2 = hour2 * 60 + min2

    return totalMinutes2 - totalMinutes1
  }

  // Convertir Set de weekdays a string
  const weekdaysToString = (days: Set<string>): string => {
    const sorted = Array.from(days).map(Number).sort((a, b) => a - b)
    // Verificar si es un rango continuo
    let isRange = true
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) {
        isRange = false
        break
      }
    }
    if (isRange && sorted.length > 1) {
      return `${sorted[0]}-${sorted[sorted.length - 1]}`
    }
    return sorted.join(',')
  }

  const offConversion = convertTimezone(
    formData.off,
    formData.userTimezone,
    formData.clusterTimezone
  )
  const onConversion = convertTimezone(
    formData.on,
    formData.userTimezone,
    formData.clusterTimezone
  )

  const weekdaySetToArray = (days: Set<string>): number[] => {
    return Array.from(days).map((d) => parseInt(d, 10)).filter((d) => !Number.isNaN(d))
  }

  const shiftDaysToCluster = (days: number[], dayShift: number): number[] => {
    const shifted = days.map((day) => (day + dayShift + 7) % 7)
    return Array.from(new Set(shifted)).sort((a, b) => a - b)
  }

  const parseWeekdaysToArray = (weekdaysStr: string): number[] => {
    const days: number[] = []
    if (!weekdaysStr) return days
    if (weekdaysStr.includes('-')) {
      const [start, end] = weekdaysStr.split('-').map(Number)
      for (let i = start; i <= end; i++) {
        days.push(i)
      }
    } else {
      weekdaysStr.split(',').forEach((day) => {
        const num = Number(day.trim())
        if (!Number.isNaN(num)) days.push(num)
      })
    }
    return days
  }

  const timeToMinutes = (timeStr: string): number => {
    const parts = timeStr.split(':').map(Number)
    if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
      return 0
    }
    return parts[0] * 60 + parts[1]
  }

  const buildIntervals = (weekdays: number[], startTime: string, endTime: string) => {
    const startMinutes = timeToMinutes(startTime)
    const endMinutes = timeToMinutes(endTime)
    return weekdays.map((day) => {
      const crossesMidnight = endMinutes <= startMinutes
      return {
        startDay: day,
        startMinutes,
        endDay: crossesMidnight ? (day + 1) % 7 : day,
        endMinutes,
      }
    })
  }

  const intervalToSegments = (interval: {
    startDay: number
    startMinutes: number
    endDay: number
    endMinutes: number
  }) => {
    if (interval.startDay === interval.endDay) {
      return [{ day: interval.startDay, start: interval.startMinutes, end: interval.endMinutes }]
    }
    return [
      { day: interval.startDay, start: interval.startMinutes, end: 24 * 60 },
      { day: interval.endDay, start: 0, end: interval.endMinutes },
    ]
  }

  const intervalsOverlap = (
    a: { startDay: number; startMinutes: number; endDay: number; endMinutes: number },
    b: { startDay: number; startMinutes: number; endDay: number; endMinutes: number }
  ) => {
    const aSegments = intervalToSegments(a)
    const bSegments = intervalToSegments(b)
    return aSegments.some((aSeg) =>
      bSegments.some(
        (bSeg) =>
          aSeg.day === bSeg.day && aSeg.start < bSeg.end && bSeg.start < aSeg.end
      )
    )
  }

  const isNowWithinInterval = (
    nowDay: number,
    nowMinutes: number,
    interval: { startDay: number; startMinutes: number; endDay: number; endMinutes: number }
  ) => {
    if (interval.startDay === interval.endDay) {
      return nowDay === interval.startDay && nowMinutes >= interval.startMinutes && nowMinutes < interval.endMinutes
    }
    if (nowDay === interval.startDay) {
      return nowMinutes >= interval.startMinutes
    }
    if (nowDay === interval.endDay) {
      return nowMinutes < interval.endMinutes
    }
    return false
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

      // Validaciones
      if (!formData.tenant) {
        setError('Debe seleccionar un tenant')
        return
      }
      const targetNamespaces = isNamespaceEdit ? [namespaceParam] : formData.namespaces
      if (targetNamespaces.length === 0) {
        setError('Debe seleccionar al menos un namespace')
        return
      }
      if (selectedSleepWeekdays.size === 0) {
        setError('Debe seleccionar al menos un día de la semana para apagar')
        return
      }
      if (selectedWakeWeekdays.size === 0) {
        setError('Debe seleccionar al menos un día de la semana para encender')
        return
      }

      // Validar formato de scheduleName si se proporciona
      if (formData.scheduleName) {
        const scheduleNamePattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/
        if (!scheduleNamePattern.test(formData.scheduleName)) {
          setError('El nombre del schedule debe ser un nombre válido de Kubernetes (solo letras minúsculas, números, guiones y puntos)')
          return
        }
        if (formData.scheduleName.length > 253) {
          setError('El nombre del schedule no puede tener más de 253 caracteres')
          return
        }
      }

    try {
      // Convertir exclusions al formato esperado por el API
      // Solo incluir exclusiones de los namespaces seleccionados
      const exclusionsFormatted = exclusions
        .filter((excl) => 
          excl.namespace && 
          excl.labelKey && 
          excl.labelValue &&
          targetNamespaces.includes(excl.namespace) // Solo exclusiones de namespaces seleccionados
        )
        .map((excl) => ({
          namespace: excl.namespace,
          filter: {
            matchLabels: {
              [excl.labelKey]: excl.labelValue,
            },
          },
        }))

      // DEBUG: Log ANTES de crear requestData para ver qué valores tiene formData
      console.log('DEBUG handleSubmit: formData antes de crear request:', {
        scheduleName: formData.scheduleName,
        description: formData.description,
        scheduleNameType: typeof formData.scheduleName,
        descriptionType: typeof formData.description,
        scheduleNameLength: formData.scheduleName?.length,
        descriptionLength: formData.description?.length,
      })

      // IMPORTANTE: Preservar scheduleName y description incluso si son strings vacíos
      // Convertir strings vacíos a undefined para que el backend los maneje correctamente
      const scheduleNameToSend = formData.scheduleName && formData.scheduleName.trim() !== '' 
        ? formData.scheduleName.trim() 
        : undefined
      const descriptionToSend = formData.description && formData.description.trim() !== '' 
        ? formData.description.trim() 
        : undefined

      const requestData: CreateScheduleRequest = {
        ...formData,
        namespaces: targetNamespaces,
        weekdaysSleep: weekdaysToString(selectedSleepWeekdays),
        weekdaysWake: weekdaysToString(selectedWakeWeekdays),
        exclusions: exclusionsFormatted.length > 0 ? exclusionsFormatted : undefined,
        // Asegurar que userTimezone y clusterTimezone estén presentes
        userTimezone: formData.userTimezone || 'America/Bogota',
        clusterTimezone: formData.clusterTimezone || 'UTC',
        // IMPORTANTE: Incluir scheduleName y description explícitamente para que no se pierdan al actualizar
        scheduleName: scheduleNameToSend,
        description: descriptionToSend,
      }

      const currentScheduleName =
        scheduleNameParam || (requestData.scheduleName ? requestData.scheduleName : undefined)

      if (existingSchedule && targetNamespaces.length > 0) {
        const candidateSleepDaysUTC = shiftDaysToCluster(
          weekdaySetToArray(selectedSleepWeekdays),
          offConversion.dayShift
        )
        const candidateIntervals = buildIntervals(
          candidateSleepDaysUTC,
          offConversion.clusterTime,
          onConversion.clusterTime
        )

        const nowUTC = new Date()
        const nowDay = nowUTC.getUTCDay()
        const nowMinutes = nowUTC.getUTCHours() * 60 + nowUTC.getUTCMinutes()

        const overlaps: string[] = []
        let isNowAsleepByOther = false

        targetNamespaces.forEach((namespace) => {
          const namespaceInfo = (existingSchedule.namespaces || {})[namespace]
          const schedules = namespaceInfo?.schedule || namespaceInfo || []
          const scheduleArray = Array.isArray(schedules) ? schedules : (schedules.schedule || [])

          const schedulesByName = new Map<string, { sleep?: any; wake?: any }>()

          scheduleArray.forEach((schedule: any) => {
            const nameFromAnnotation = schedule?.annotations?.['kube-green.stratio.com/schedule-name']
            const scheduleName = nameFromAnnotation || schedule?.name || ''
            if (currentScheduleName && scheduleName === currentScheduleName) {
              return
            }

            const role =
              schedule.role ||
              schedule.annotations?.['kube-green.stratio.com/pair-role'] ||
              schedule.annotations?.['kube-green.com/pair-role'] ||
              (schedule.name?.startsWith('sleep') ? 'sleep' : 'wake')

            if (!schedulesByName.has(scheduleName)) {
              schedulesByName.set(scheduleName, {})
            }
            const group = schedulesByName.get(scheduleName)!
            if (role === 'sleep') {
              group.sleep = schedule
            } else if (role === 'wake') {
              group.wake = schedule
            }
          })

          schedulesByName.forEach((group, scheduleName) => {
            const sleepEntry = group.sleep
            const wakeEntry = group.wake

            if (!sleepEntry) {
              return
            }

            const sleepTime =
              sleepEntry.time || sleepEntry.sleepTime || sleepEntry.Time || sleepEntry.SleepTime || ''
            const wakeTime =
              wakeEntry?.time || wakeEntry?.wakeTime || wakeEntry?.WakeTime || wakeEntry?.Time || sleepTime
            const sleepWeekdays =
              sleepEntry.weekdays || sleepEntry.Weekdays || ''

            const sleepDays = parseWeekdaysToArray(sleepWeekdays)
            if (sleepDays.length === 0 || !sleepTime) {
              return
            }

            const intervals = buildIntervals(sleepDays, sleepTime, wakeTime || sleepTime)

            const hasOverlap = candidateIntervals.some((candidate) =>
              intervals.some((existing) => intervalsOverlap(candidate, existing))
            )

            if (hasOverlap) {
              const clusterTZ = requestData.clusterTimezone || 'UTC'
              const userTZ = requestData.userTimezone || 'UTC'
              const sleepLocal = sleepTime
                ? convertFromClusterToUser(sleepTime, clusterTZ, userTZ)
                : sleepTime
              const wakeLocal = wakeTime
                ? convertFromClusterToUser(wakeTime, clusterTZ, userTZ)
                : wakeTime
              const weekdaysLocal = sleepWeekdays
                ? convertWeekdaysFromClusterToUser(sleepWeekdays, sleepTime || '00:00', clusterTZ, userTZ)
                : ''
              overlaps.push(
                `${namespace} → ${scheduleName || 'schedule existente'} (${weekdaysLocal || 'días'} ${sleepLocal || sleepTime || '?'}-${wakeLocal || wakeTime || '?'})`
              )
            }

            if (intervals.some((interval) => isNowWithinInterval(nowDay, nowMinutes, interval))) {
              isNowAsleepByOther = true
            }
          })
        })

        if (overlaps.length > 0) {
          setError(
            `El horario se solapa con otros schedules en tu zona horaria (${requestData.userTimezone}). ` +
              `Conflictos: ${overlaps.join(', ')}`
          )
          return
        }

        if (isNowAsleepByOther) {
          setError(
            'No se puede crear/editar el schedule porque el namespace ya está apagado por otro schedule en este momento.'
          )
          return
        }
      }

      // DEBUG: Log para ver qué estamos enviando
      console.log('DEBUG handleSubmit: Enviando al backend:', {
        off: requestData.off,
        on: requestData.on,
        weekdaysSleep: requestData.weekdaysSleep,
        weekdaysWake: requestData.weekdaysWake,
        userTimezone: requestData.userTimezone,
        clusterTimezone: requestData.clusterTimezone,
        namespaces: requestData.namespaces,
        scheduleName: requestData.scheduleName,
        description: requestData.description,
        'scheduleNameIsUndefined': requestData.scheduleName === undefined,
        'descriptionIsUndefined': requestData.description === undefined,
      })

      if (isNamespaceEdit) {
        const namespaceRequest = {
          tenant: formData.tenant,
          namespace: namespaceParam,
          userTimezone: requestData.userTimezone,
          clusterTimezone: requestData.clusterTimezone,
          off: requestData.off,
          on: requestData.on,
          weekdaysSleep: requestData.weekdaysSleep,
          weekdaysWake: requestData.weekdaysWake,
          exclusions: requestData.exclusions,
        }

        if (namespaceSchedule) {
          await updateNamespaceMutation.mutateAsync(namespaceRequest)
          setSuccess('Schedule de namespace actualizado correctamente.')
        } else {
          await createNamespaceMutation.mutateAsync(namespaceRequest)
          setSuccess('Schedule de namespace creado correctamente.')
        }

        queryClient.invalidateQueries({ queryKey: ['namespaceSchedule', tenantName, namespaceParam] })
        queryClient.invalidateQueries({ queryKey: ['schedules', tenantName] })
        queryClient.invalidateQueries({ queryKey: ['allSchedules'] })
        queryClient.invalidateQueries({ queryKey: ['tenants'] })

        await new Promise(resolve => setTimeout(resolve, 1000))
        await refetchNamespaceSchedule()
      } else if (tenantName) {
        await updateMutation.mutateAsync({ tenant: tenantName, request: requestData })
        
        setSuccess('Schedule actualizado correctamente. Recargando datos...')
        
        // Esperar un momento para que el backend procese completamente
        await new Promise(resolve => setTimeout(resolve, 1500))
        
        // Invalidar todas las queries relacionadas (esto marca los datos como stale)
        queryClient.invalidateQueries({ queryKey: ['schedules', tenantName] })
        queryClient.invalidateQueries({ queryKey: ['allSchedules'] })
        queryClient.invalidateQueries({ queryKey: ['tenants'] })
        
        // Forzar refetch del schedule actual y ESPERAR a que se complete
        const result = await refetchSchedule()
        
        console.log('DEBUG handleSubmit: resultado del refetch', { hasData: !!result.data, dataUpdatedAt: result.dataUpdatedAt })
        
        // Si tenemos datos actualizados, forzar recarga del formulario
        if (result.data) {
          // Los datos se recargarán automáticamente cuando existingSchedule cambie
          // El useEffect se ejecutará porque dataUpdatedAt cambió
          setSuccess('Schedule actualizado correctamente. Datos recargados.')
          
          // Esperar un momento adicional para que React procese el cambio y el useEffect se ejecute
          await new Promise(resolve => setTimeout(resolve, 1000))
        } else {
          setSuccess('Schedule actualizado correctamente')
        }
      } else {
        await createMutation.mutateAsync(requestData)
        setSuccess('Schedule creado correctamente')
      }

      // Opcional: Navegar después de un tiempo si el usuario quiere
      // setTimeout(() => {
      //   navigate('/')
      // }, 3000)
    } catch (error: any) {
      setError(error?.response?.data?.error || error?.message || 'Error al guardar el schedule')
      console.error('Error creating schedule:', error)
    }
  }

  const toggleSleepWeekday = (day: string) => {
    const newDays = new Set(selectedSleepWeekdays)
    if (newDays.has(day)) {
      newDays.delete(day)
    } else {
      newDays.add(day)
    }
    setSelectedSleepWeekdays(newDays)
  }

  const toggleWakeWeekday = (day: string) => {
    const newDays = new Set(selectedWakeWeekdays)
    if (newDays.has(day)) {
      newDays.delete(day)
    } else {
      newDays.add(day)
    }
    setSelectedWakeWeekdays(newDays)
  }

  // Función para seleccionar todos los días
  const selectAllDays = (type: 'sleep' | 'wake') => {
    const allDays = new Set(['0', '1', '2', '3', '4', '5', '6'])
    if (type === 'sleep') {
      setSelectedSleepWeekdays(allDays)
    } else {
      setSelectedWakeWeekdays(allDays)
    }
  }

  // Función para deseleccionar todos los días
  const deselectAllDays = (type: 'sleep' | 'wake') => {
    if (type === 'sleep') {
      setSelectedSleepWeekdays(new Set())
    } else {
      setSelectedWakeWeekdays(new Set())
    }
  }

  // Obtener namespaces dinámicamente del tenant seleccionado
  const selectedTenant = tenantsData?.tenants.find((t: any) => t.name === formData.tenant)
  const availableNamespaces = selectedTenant?.namespaces || []

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 4 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
          sx={{ mr: 2 }}
        >
          Volver
        </Button>
        <Typography variant="h4" component="h1" fontWeight="bold">
          {tenantName ? 'Editar Schedule' : 'Crear Schedule'}
        </Typography>
      </Box>

      <form onSubmit={handleSubmit}>
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Información del Schedule
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Nombre del Schedule (Opcional)"
                  value={formData.scheduleName || ''}
                  onChange={(e) => setFormData({ ...formData, scheduleName: e.target.value })}
                  helperText="Nombre personalizado para identificar este schedule. Debe ser único por namespace."
                  placeholder="Ej: schedule-produccion-nocturno"
                  inputProps={{
                    maxLength: 253,
                  }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Descripción (Opcional)"
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  helperText="Descripción corta del schedule"
                  placeholder="Ej: Horario de producción nocturno para ahorro de costos"
                  inputProps={{
                    maxLength: 200,
                  }}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Tenant y Namespaces
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Tenant</InputLabel>
                  <Select
                    value={formData.tenant}
                    label="Tenant"
                    onChange={(e) => {
                      const newTenant = e.target.value
                      // Limpiar namespaces seleccionados cuando cambia el tenant
                      setFormData({ ...formData, tenant: newTenant, namespaces: [] })
                    }}
                    disabled={!!tenantName}
                  >
                    {tenantsData?.tenants.map((t: any) => (
                      <MenuItem key={t.name} value={t.name}>
                        {t.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  Namespaces {formData.tenant && `(${availableNamespaces.length} disponibles)`}
                </Typography>
                {isNamespaceEdit && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Editando un solo namespace: {namespaceParam}
                  </Alert>
                )}
                {!formData.tenant && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Selecciona un tenant para ver los namespaces disponibles
                  </Alert>
                )}
                {formData.tenant && availableNamespaces.length === 0 && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    No se encontraron namespaces para el tenant {formData.tenant}
                  </Alert>
                )}
                {(isNamespaceEdit ? [namespaceParam] : availableNamespaces).map((ns) => (
                  <Button
                    key={ns}
                    variant={formData.namespaces.includes(ns) ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => {
                      if (isNamespaceEdit) return
                      const namespaces = formData.namespaces.includes(ns)
                        ? formData.namespaces.filter((n: string) => n !== ns)
                        : [...formData.namespaces, ns]
                      setFormData({ ...formData, namespaces })
                    }}
                    disabled={isNamespaceEdit}
                    sx={{ mr: 1, mb: 1 }}
                  >
                    {ns}
                  </Button>
                ))}
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Horarios y Timezones
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Timezone del Usuario</InputLabel>
                  <Select
                    value={formData.userTimezone}
                    label="Timezone del Usuario"
                    onChange={(e) => setFormData({ ...formData, userTimezone: e.target.value })}
                  >
                    {TIMEZONES.map((tz) => (
                      <MenuItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Timezone del Cluster</InputLabel>
                  <Select
                    value={formData.clusterTimezone}
                    label="Timezone del Cluster"
                    onChange={(e) => setFormData({ ...formData, clusterTimezone: e.target.value })}
                  >
                    {TIMEZONES.map((tz) => (
                      <MenuItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Hora de Apagado"
                  type="time"
                  value={formData.off}
                  onChange={(e) => setFormData({ ...formData, off: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
                <Alert severity="info" sx={{ mt: 1 }}>
                  {formData.off} ({getTimezoneDisplayName(formData.userTimezone)}) →{' '}
                  {offConversion.clusterTime} ({getTimezoneDisplayName(formData.clusterTimezone)})
                  {offConversion.dayShift !== 0 && ` (${offConversion.dayShift > 0 ? '+' : ''}${offConversion.dayShift} día)`}
                </Alert>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Hora de Encendido"
                  type="time"
                  value={formData.on}
                  onChange={(e) => setFormData({ ...formData, on: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
                <Alert severity="info" sx={{ mt: 1 }}>
                  {formData.on} ({getTimezoneDisplayName(formData.userTimezone)}) →{' '}
                  {onConversion.clusterTime} ({getTimezoneDisplayName(formData.clusterTimezone)})
                  {onConversion.dayShift !== 0 && ` (${onConversion.dayShift > 0 ? '+' : ''}${onConversion.dayShift} día)`}
                </Alert>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Días de Apagado */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box>
                <Typography variant="h6" gutterBottom>
                  Días de Apagado (Sleep)
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Selecciona los días en que se aplicará el apagado de servicios
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => selectAllDays('sleep')}
                >
                  Todos
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => deselectAllDays('sleep')}
                >
                  Ninguno
                </Button>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {Object.entries(WEEKDAY_NAMES).map(([day, name]) => (
                <Chip
                  key={day}
                  label={name}
                  onClick={() => toggleSleepWeekday(day)}
                  color={selectedSleepWeekdays.has(day) ? 'warning' : 'default'}
                  variant={selectedSleepWeekdays.has(day) ? 'filled' : 'outlined'}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
            {selectedSleepWeekdays.size > 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Días de apagado seleccionados: {Array.from(selectedSleepWeekdays)
                  .map((d) => WEEKDAY_NAMES[d as keyof typeof WEEKDAY_NAMES])
                  .join(', ')}
                {' '}
                ({weekdaysToString(selectedSleepWeekdays)})
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Días de Encendido */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box>
                <Typography variant="h6" gutterBottom>
                  Días de Encendido (Wake)
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Selecciona los días en que se aplicará el encendido de servicios
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => selectAllDays('wake')}
                >
                  Todos
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => deselectAllDays('wake')}
                >
                  Ninguno
                </Button>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {Object.entries(WEEKDAY_NAMES).map(([day, name]) => (
                <Chip
                  key={day}
                  label={name}
                  onClick={() => toggleWakeWeekday(day)}
                  color={selectedWakeWeekdays.has(day) ? 'success' : 'default'}
                  variant={selectedWakeWeekdays.has(day) ? 'filled' : 'outlined'}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
            {selectedWakeWeekdays.size > 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Días de encendido seleccionados: {Array.from(selectedWakeWeekdays)
                  .map((d) => WEEKDAY_NAMES[d as keyof typeof WEEKDAY_NAMES])
                  .join(', ')}
                {' '}
                ({weekdaysToString(selectedWakeWeekdays)})
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                Delays Configurables (Opcional)
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={showDelays}
                    onChange={(e) => setShowDelays(e.target.checked)}
                  />
                }
                label="Mostrar configuración avanzada"
              />
            </Box>
            {showDelays && (
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Delay Deployments"
                    value={formData.delays?.suspendDeployments || '5m'}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        delays: { ...formData.delays, suspendDeployments: e.target.value },
                      })
                    }
                    helperText="Ejemplo: 5m, 10m, 0m"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Delay StatefulSets"
                    value={formData.delays?.suspendStatefulSets || '7m'}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        delays: { ...formData.delays, suspendStatefulSets: e.target.value },
                      })
                    }
                    helperText="Ejemplo: 7m, 10m, 0m"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Delay CronJobs"
                    value={formData.delays?.suspendCronJobs || '0m'}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        delays: { ...formData.delays, suspendCronJobs: e.target.value },
                      })
                    }
                    helperText="Ejemplo: 0m, 5m"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Delay PgBouncer"
                    value={formData.delays?.suspendDeploymentsPgbouncer || '5m'}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        delays: { ...formData.delays, suspendDeploymentsPgbouncer: e.target.value },
                      })
                    }
                    helperText="Ejemplo: 5m, 0m"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Delay Postgres"
                    value={formData.delays?.suspendStatefulSetsPostgres || '0m'}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        delays: { ...formData.delays, suspendStatefulSetsPostgres: e.target.value },
                      })
                    }
                    helperText="Ejemplo: 0m, 5m"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Delay HDFS"
                    value={formData.delays?.suspendStatefulSetsHdfs || '0m'}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        delays: { ...formData.delays, suspendStatefulSetsHdfs: e.target.value },
                      })
                    }
                    helperText="Ejemplo: 0m, 5m"
                  />
                </Grid>
              </Grid>
            )}
          </CardContent>
        </Card>

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                Exclusions (Opcional)
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={showExclusions}
                    onChange={(e) => setShowExclusions(e.target.checked)}
                  />
                }
                label="Mostrar configuración de exclusiones"
              />
            </Box>
            {showExclusions && (
              <Box>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                  Excluir servicios específicos usando labels. Los servicios que coincidan con estos labels no serán suspendidos.
                </Typography>
                {visibleExclusions.length === 0 && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    No hay exclusiones configuradas. Agrega una exclusión para excluir servicios específicos del schedule.
                  </Alert>
                )}
                {visibleExclusions.length > 0 && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Exclusiones existentes: {visibleExclusions.length} exclusión{visibleExclusions.length !== 1 ? 'es' : ''} configurada{visibleExclusions.length !== 1 ? 's' : ''}
                  </Alert>
                )}
                {visibleExclusions.map(({ excl, index }) => {
                  // Cargar servicios para el namespace seleccionado
                  const namespaceServices = servicesByNamespace.get(excl.namespace) || []
                  const selectedService = namespaceServices.find((s: any) => s.name === excl.selectedService)
                  const availableLabels = selectedService?.labels || {}
                  const labelEntries = Object.entries(availableLabels)
                  
                  // Si hay un labelKey pero no hay servicio seleccionado, buscar en todos los servicios del namespace
                  let allLabelKeys = new Set<string>()
                  if (excl.labelKey && !selectedService) {
                    // Recopilar todos los labelKeys de todos los servicios del namespace
                    namespaceServices.forEach((s: any) => {
                      if (s.labels) {
                        Object.keys(s.labels).forEach(key => allLabelKeys.add(key))
                      }
                    })
                  }
                  
                  return (
                    <Card key={index} sx={{ mb: 2, p: 2, bgcolor: 'grey.50' }}>
                      <Grid container spacing={2} alignItems="flex-start">
                        <Grid item xs={12} md={3}>
                          <FormControl fullWidth>
                            <InputLabel>Namespace</InputLabel>
                            <Select
                              value={excl.namespace}
                              label="Namespace"
                              onChange={(e) => {
                                if (isNamespaceEdit) return
                                const newNamespace = e.target.value
                                const exclusionToUpdate = exclusions[index]
                                const newExclusions = [...exclusions]
                                newExclusions[index].namespace = newNamespace
                                newExclusions[index].selectedService = ''
                                newExclusions[index].labelKey = ''
                                newExclusions[index].labelValue = ''
                                updateExclusions(newExclusions)
                                // Cargar servicios del namespace
                                if (formData.tenant && newNamespace) {
                                  loadNamespaceServices(formData.tenant, newNamespace)
                                }
                              }}
                              disabled={isNamespaceEdit}
                            >
                              {(isNamespaceEdit ? [namespaceParam] : formData.namespaces).map((ns) => (
                                <MenuItem key={ns} value={ns}>
                                  {ns}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid item xs={12} md={3}>
                          <FormControl fullWidth>
                            <InputLabel>Servicio</InputLabel>
                            <Select
                              value={excl.selectedService || ''}
                              label="Servicio"
                              disabled={!excl.namespace}
                              onChange={(e) => {
                                const serviceName = e.target.value
                                const service = namespaceServices.find((s: any) => s.name === serviceName)
                                const newExclusions = [...exclusions]
                                newExclusions[index].selectedService = serviceName
                                
                                // Si hay un label key existente, verificar si el servicio lo tiene
                                if (service && excl.labelKey && service.labels && service.labels[excl.labelKey]) {
                                  // El servicio ya tiene el label key, mantener el valor
                                  newExclusions[index].labelValue = service.labels[excl.labelKey]
                                } else if (service && service.labels && Object.keys(service.labels).length > 0 && !excl.labelKey) {
                                  // Si no hay label key seleccionado, seleccionar el primero disponible
                                  const firstLabel = Object.entries(service.labels)[0]
                                  newExclusions[index].labelKey = firstLabel[0]
                                  newExclusions[index].labelValue = firstLabel[1]
                                } else {
                                  // Si el servicio no tiene el label key, limpiar
                                  newExclusions[index].labelKey = ''
                                  newExclusions[index].labelValue = ''
                                }
                                updateExclusions(newExclusions)
                              }}
                            >
                              {namespaceServices.length === 0 && excl.namespace && (
                                <MenuItem disabled>
                                  <Typography variant="body2" color="textSecondary">
                                    Cargando servicios...
                                  </Typography>
                                </MenuItem>
                              )}
                              {namespaceServices.length === 0 && !excl.namespace && (
                                <MenuItem disabled>
                                  <Typography variant="body2" color="textSecondary">
                                    Seleccione un namespace primero
                                  </Typography>
                                </MenuItem>
                              )}
                              {namespaceServices.map((service: any) => (
                                <MenuItem key={service.name} value={service.name}>
                                  {service.name} ({service.kind})
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid item xs={12} md={2}>
                          <FormControl fullWidth>
                            <InputLabel>Label Key</InputLabel>
                            <Select
                              value={excl.labelKey || ''}
                              label="Label Key"
                              disabled={!excl.namespace}
                              onChange={(e) => {
                                const key = e.target.value
                                // Si hay servicio seleccionado, usar el valor del label del servicio
                                // Si no hay servicio, mantener el labelValue existente
                                const value = selectedService ? (availableLabels[key] || excl.labelValue || '') : excl.labelValue
                                const newExclusions = [...exclusions]
                                newExclusions[index].labelKey = key
                                newExclusions[index].labelValue = value
                                updateExclusions(newExclusions)
                              }}
                            >
                              {/* Mostrar el labelKey existente si no hay servicio seleccionado pero sí hay labelKey */}
                              {!selectedService && excl.labelKey && (
                                <MenuItem value={excl.labelKey}>
                                  {excl.labelKey}
                                </MenuItem>
                              )}
                              {/* Mostrar todos los labelKeys disponibles de todos los servicios del namespace si no hay servicio seleccionado */}
                              {!selectedService && allLabelKeys.size > 0 && Array.from(allLabelKeys).map((key) => (
                                <MenuItem key={key} value={key}>
                                  {key}
                                </MenuItem>
                              ))}
                              {/* Mostrar labels del servicio seleccionado */}
                              {labelEntries.length === 0 && selectedService && (
                                <MenuItem disabled>
                                  <Typography variant="body2" color="textSecondary">
                                    Sin labels disponibles
                                  </Typography>
                                </MenuItem>
                              )}
                              {labelEntries.map(([key]) => (
                                <MenuItem key={key} value={key}>
                                  {key}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid item xs={12} md={2}>
                          <TextField
                            fullWidth
                            label="Label Value"
                            value={excl.labelValue}
                            disabled={!excl.labelKey}
                            onChange={(e) => {
                              const newExclusions = [...exclusions]
                              newExclusions[index].labelValue = e.target.value
                              updateExclusions(newExclusions)
                            }}
                            placeholder="Valor del label"
                          />
                        </Grid>
                        <Grid item xs={12} md={2}>
                          <Button
                            color="error"
                            fullWidth
                            onClick={() => {
                              const updatedExclusions = exclusions.filter((_, i) => i !== index)
                              updateExclusions(updatedExclusions)
                            }}
                          >
                            Eliminar
                          </Button>
                        </Grid>
                      </Grid>
                    </Card>
                  )
                })}
                        <Button
                          variant="outlined"
                          onClick={() => {
                            const newExclusion = {
                              namespace: formData.namespaces[0] || '',
                              labelKey: '',
                              labelValue: '',
                              selectedService: '',
                            }
                            // Agregar nueva exclusión
                            const updatedExclusions = [...exclusions, newExclusion]
                            updateExclusions(updatedExclusions)
                            // Cargar servicios del namespace seleccionado
                            if (formData.tenant && newExclusion.namespace) {
                              loadNamespaceServices(formData.tenant, newExclusion.namespace)
                            }
                          }}
                          disabled={formData.namespaces.length === 0}
                          sx={{ mt: 1 }}
                        >
                          Agregar Exclusión
                        </Button>
              </Box>
            )}
          </CardContent>
        </Card>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <Button variant="outlined" onClick={() => navigate('/')}>
            Cancelar
          </Button>
          {isEditMode && (scheduleNameParam || formData.scheduleName) && (
            <Button
              variant="outlined"
              color="error"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleteMutation.isPending}
            >
              Eliminar
            </Button>
          )}
          <Button
            type="submit"
            variant="contained"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {createMutation.isPending || updateMutation.isPending ? (
              <CircularProgress size={24} />
            ) : (
              'Guardar y Aplicar'
            )}
          </Button>
        </Box>
      </form>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false)
          setDeleteError(null)
        }}
        aria-labelledby="delete-schedule-dialog-title"
        aria-describedby="delete-schedule-dialog-description"
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="delete-schedule-dialog-title">Confirmar Eliminación</DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-schedule-dialog-description">
            ¿Está seguro de que desea eliminar el schedule{' '}
            <strong>{scheduleNameParam || formData.scheduleName}</strong>
            {isNamespaceEdit ? (
              <>
                {' '}
                en el namespace <strong>{namespaceParam}</strong>
              </>
            ) : null}
            ? Esta acción no se puede deshacer.
          </DialogContentText>
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteDialogOpen(false)
              setDeleteError(null)
            }}
            color="primary"
            disabled={deleteMutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleDeleteSchedule}
            color="error"
            variant="contained"
            disabled={deleteMutation.isPending}
            startIcon={deleteMutation.isPending ? <CircularProgress size={16} /> : null}
          >
            {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  )
}
