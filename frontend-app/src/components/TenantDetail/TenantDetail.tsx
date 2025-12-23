import React, { useState, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Container,
  Typography,
  Box,
  Button,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material'
import { ArrowBack as ArrowBackIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material'
import { useSchedules, useDeleteSchedule } from '../../hooks/useTenants'
import { WEEKDAY_NAMES } from '../../types'
import { convertFromClusterToUser, convertWeekdaysFromClusterToUser } from '../../utils/timezone'

export default function TenantDetail() {
  const { tenantName } = useParams<{ tenantName: string }>()
  const [searchParams] = useSearchParams()
  const scheduleNameParam = searchParams.get('scheduleName') || ''
  const navigate = useNavigate()
  const { data, isLoading, error } = useSchedules(tenantName || '')
  const deleteMutation = useDeleteSchedule()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    mode: 'tenant' | 'schedule'
    scheduleName?: string
    namespace?: string
  } | null>(null)

  const handleDelete = async () => {
    if (!tenantName) return
    setDeleteError(null)
    try {
      if (deleteTarget?.mode === 'schedule' && deleteTarget.scheduleName) {
        await deleteMutation.mutateAsync({
          tenant: tenantName,
          namespace: deleteTarget.namespace,
          scheduleName: deleteTarget.scheduleName,
        })
      } else {
        await deleteMutation.mutateAsync({ tenant: tenantName })
      }
      setDeleteDialogOpen(false)
      setDeleteTarget(null)
      // Mostrar mensaje de éxito antes de navegar
      setTimeout(() => {
        navigate('/')
      }, 500)
    } catch (error: any) {
      console.error('Error deleting schedule:', error)
      setDeleteError(error?.response?.data?.error || error?.message || 'Error al eliminar el schedule')
    }
  }

  const matchesScheduleName = (schedule: any) => {
    if (!scheduleNameParam) return true
    const nameFromAnnotation = schedule?.annotations?.['kube-green.stratio.com/schedule-name']
    const nameFromSummary = schedule?.name
    return nameFromAnnotation === scheduleNameParam || nameFromSummary === scheduleNameParam
  }

  const namespacesToRender = useMemo(() => {
    if (!data || !data.namespaces) return new Map<string, any[]>()
    const result = new Map<string, any[]>()

    Object.entries(data.namespaces).forEach(([namespaceSuffix, namespaceInfo]: [string, any]) => {
      const schedules = namespaceInfo?.schedule || namespaceInfo || []
      const scheduleArray = Array.isArray(schedules) ? schedules : (schedules.schedule || [])
      const filtered = scheduleNameParam ? scheduleArray.filter(matchesScheduleName) : scheduleArray
      if (filtered.length > 0) {
        result.set(namespaceSuffix, filtered)
      }
    })

    return result
  }, [data, scheduleNameParam])

  // Extraer exclusiones de todos los schedules
  const exclusionsByNamespace = useMemo(() => {
    if (!data || !data.namespaces) return new Map<string, Array<{ labelKey: string; labelValue: string }>>()

    const exclusionsMap = new Map<string, Array<{ labelKey: string; labelValue: string }>>()
    const seenExclusions = new Set<string>()

    Object.entries(data.namespaces).forEach(([namespaceSuffix, namespaceInfo]: [string, any]) => {
      const schedules = namespaceInfo?.schedule || namespaceInfo || []
      const scheduleArray = Array.isArray(schedules) ? schedules : (schedules.schedule || [])

      scheduleArray.filter(matchesScheduleName).forEach((schedule: any) => {
        if (schedule.excludeRef && Array.isArray(schedule.excludeRef)) {
          schedule.excludeRef.forEach((excl: any) => {
            if (excl.matchLabels && typeof excl.matchLabels === 'object') {
              Object.entries(excl.matchLabels).forEach(([key, value]) => {
                // Filtrar exclusiones del sistema (operadores)
                const systemExclusions = new Set([
                  'app.kubernetes.io/managed-by',
                  'postgres.stratio.com/cluster',
                  'app.kubernetes.io/part-of',
                  'hdfs.stratio.com/cluster',
                  'cct.stratio.com/application_id',
                ])

                if (!systemExclusions.has(key)) {
                  const exclusionKey = `${namespaceSuffix}:${key}:${value}`
                  if (!seenExclusions.has(exclusionKey)) {
                    seenExclusions.add(exclusionKey)

                    if (!exclusionsMap.has(namespaceSuffix)) {
                      exclusionsMap.set(namespaceSuffix, [])
                    }
                    exclusionsMap.get(namespaceSuffix)!.push({
                      labelKey: key,
                      labelValue: String(value),
                    })
                  }
                }
              })
            }
          })
        }
      })
    })

    return exclusionsMap
  }, [data, scheduleNameParam])

  // Formatear weekdays para mostrar
  const formatWeekdaysDisplay = (weekdaysStr: string): string => {
    if (!weekdaysStr) return '-'
    if (weekdaysStr.includes('-')) {
      const [start, end] = weekdaysStr.split('-').map(Number)
      const days = []
      for (let i = start; i <= end; i++) {
        days.push(WEEKDAY_NAMES[i.toString() as keyof typeof WEEKDAY_NAMES])
      }
      return days.join(', ')
    }
    return weekdaysStr
      .split(',')
      .map((d) => WEEKDAY_NAMES[d.trim() as keyof typeof WEEKDAY_NAMES])
      .join(', ')
  }

  if (isLoading) {
    return (
      <Container maxWidth="xl" sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    )
  }

  if (error) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error">Error al cargar schedule: {String(error)}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => navigate('/')}>
          Volver al Dashboard
        </Button>
      </Container>
    )
  }

  if (!data || namespacesToRender.size === 0) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="info">
          No se encontraron schedules para el tenant {tenantName}. Puedes crear uno nuevo desde el editor.
        </Alert>
        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <Button variant="contained" onClick={() => navigate(`/schedule/new`)}>
            Crear Schedule
          </Button>
          <Button variant="outlined" onClick={() => navigate('/')}>
            Volver al Dashboard
          </Button>
        </Box>
      </Container>
    )
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 4 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
          sx={{ mr: 2 }}
        >
          Volver
        </Button>
        <Typography variant="h4" component="h1" fontWeight="bold">
          {tenantName}
        </Typography>
      </Box>

      {/* Resumen de Schedules */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                NAMESPACES CON SCHEDULES
              </Typography>
              <Typography variant="h4">{namespacesToRender.size}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                TOTAL DE SCHEDULES
              </Typography>
              <Typography variant="h4">
                {Array.from(namespacesToRender.values()).reduce(
                  (acc: number, schedules: any[]) => acc + schedules.length,
                  0
                )}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Detalles por Namespace */}
      {Array.from(namespacesToRender.entries()).map(([namespace, scheduleArrayFiltered]) => {
        const namespaceInfo = (data.namespaces as any)[namespace]
        
        // Agrupar schedules sleep y wake por pair-id
        const groupedSchedules = new Map<string, { sleep?: any; wake?: any }>()
        
        scheduleArrayFiltered.forEach((schedule: any) => {
          const pairId = schedule.annotations?.['kube-green.stratio.com/pair-id'] || 
                        schedule.annotations?.['kube-green.com/pair-id'] ||
                        schedule.name?.replace(/^(sleep|wake)-/, '').replace(/-(sleep|wake)$/, '') ||
                        schedule.name || `default-${schedule.role}`
          
          if (!groupedSchedules.has(pairId)) {
            groupedSchedules.set(pairId, {})
          }
          
          const group = groupedSchedules.get(pairId)!
          const role = schedule.role || 
                      schedule.annotations?.['kube-green.stratio.com/pair-role'] ||
                      schedule.annotations?.['kube-green.com/pair-role'] ||
                      (schedule.name?.startsWith('sleep') ? 'sleep' : 'wake')
          
          if (role === 'sleep') {
            group.sleep = schedule
          } else if (role === 'wake') {
            group.wake = schedule
          }
        })
        
        // Convertir Map a array para renderizar
        const schedulePairs = Array.from(groupedSchedules.entries())
        
        return (
          <Card key={namespace} sx={{ mb: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="h6" fontWeight="bold">
                    Namespace: {namespace}
                  </Typography>
                  <Chip label={`${tenantName}-${namespace}`} size="small" variant="outlined" />
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() =>
                    navigate(
                      `/schedule/edit/${tenantName}?scheduleName=${encodeURIComponent(scheduleNameParam)}&namespace=${encodeURIComponent(namespace)}`
                    )
                  }
                >
                  Editar Namespace
                </Button>
              </Box>
              <Divider sx={{ mb: 2 }} />
              
              {schedulePairs.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell><strong>Nombre</strong></TableCell>
                        <TableCell><strong>Descripción</strong></TableCell>
                        <TableCell><strong>Días Sleep</strong></TableCell>
                        <TableCell><strong>Hora Sleep</strong></TableCell>
                        <TableCell><strong>Días Wake</strong></TableCell>
                        <TableCell><strong>Hora Wake</strong></TableCell>
                    <TableCell><strong>Timezone</strong></TableCell>
                    <TableCell><strong>Acciones</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {schedulePairs.map(([pairId, group]) => {
                    const sleep = group.sleep
                        const wake = group.wake
                        const timezone = sleep?.timeZone || sleep?.TimeZone || wake?.timeZone || wake?.TimeZone || namespaceInfo?.timezone || 'UTC'
                        
                        // Extraer scheduleName y description de annotations
                        const scheduleName = sleep?.annotations?.['kube-green.stratio.com/schedule-name'] || 
                                          wake?.annotations?.['kube-green.stratio.com/schedule-name'] || 
                                          null
                        const description = sleep?.annotations?.['kube-green.stratio.com/schedule-description'] || 
                                          wake?.annotations?.['kube-green.stratio.com/schedule-description'] || 
                                          null
                        
                        // Mostrar nombre personalizado si existe, sino el nombre del SleepInfo o pairId
                        const displayName = scheduleName || sleep?.name || wake?.name || pairId
                        const deleteName = scheduleName || sleep?.name || wake?.name || pairId
                        
                        // Extraer weekdays de sleep y wake (con múltiples formatos posibles) - están en UTC
                        const sleepWeekdaysUTC = sleep?.weekdays || sleep?.Weekdays || ''
                        const wakeWeekdaysUTC = wake?.weekdays || wake?.Weekdays || ''
                        
                        // Extraer tiempos de sleep y wake - están en UTC
                        const sleepTimeUTC = sleep?.time || sleep?.sleepTime || sleep?.Time || ''
                        const wakeTimeUTC = wake?.time || wake?.wakeTime || wake?.WakeTime || wake?.Time || ''
                        
                        // Obtener timezone del usuario desde annotations o usar valor por defecto
                        // El backend debería guardar esto en annotations, pero por ahora usamos un valor por defecto
                        const userTimezone = sleep?.annotations?.['kube-green.stratio.com/user-timezone'] || 
                                            wake?.annotations?.['kube-green.stratio.com/user-timezone'] || 
                                            'America/Bogota' // Valor por defecto (timezone del usuario)
                        const clusterTimezone = timezone || 'UTC' // Timezone del cluster (siempre UTC)
                        
                        // Convertir weekdays de UTC a Colombia
                        let sleepWeekdays = sleepWeekdaysUTC
                        let wakeWeekdays = wakeWeekdaysUTC
                        if (sleepWeekdaysUTC && sleepTimeUTC && clusterTimezone) {
                          sleepWeekdays = convertWeekdaysFromClusterToUser(
                            sleepWeekdaysUTC,
                            sleepTimeUTC,
                            clusterTimezone,
                            userTimezone
                          )
                        }
                        if (wakeWeekdaysUTC && wakeTimeUTC && clusterTimezone) {
                          wakeWeekdays = convertWeekdaysFromClusterToUser(
                            wakeWeekdaysUTC,
                            wakeTimeUTC,
                            clusterTimezone,
                            userTimezone
                          )
                        }
                        
                        // Convertir tiempos de UTC a Colombia
                        let sleepTime = sleepTimeUTC
                        let wakeTime = wakeTimeUTC
                        if (sleepTimeUTC && clusterTimezone) {
                          sleepTime = convertFromClusterToUser(sleepTimeUTC, clusterTimezone, userTimezone)
                        }
                        if (wakeTimeUTC && clusterTimezone) {
                          wakeTime = convertFromClusterToUser(wakeTimeUTC, clusterTimezone, userTimezone)
                        }
                        
                        return (
                          <TableRow key={pairId}>
                            <TableCell>
                              <Box>
                                <Typography variant="body2" fontWeight="medium">
                                  {displayName}
                                </Typography>
                                {scheduleName && (
                                  <Chip label="Personalizado" size="small" color="primary" sx={{ mt: 0.5 }} />
                                )}
                              </Box>
                            </TableCell>
                            <TableCell>
                              {description ? (
                                <Typography variant="body2" color="textSecondary">
                                  {description}
                                </Typography>
                              ) : (
                                <Typography variant="body2" color="textSecondary" fontStyle="italic">
                                  Sin descripción
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              {sleep ? formatWeekdaysDisplay(sleepWeekdays) : '-'}
                            </TableCell>
                            <TableCell>
                              {sleep ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Chip label="Sleep" size="small" color="warning" />
                                  {sleepTime || '-'}
                                </Box>
                              ) : '-'}
                            </TableCell>
                            <TableCell>
                              {wake ? formatWeekdaysDisplay(wakeWeekdays) : '-'}
                            </TableCell>
                            <TableCell>
                              {wake ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Chip label="Wake" size="small" color="success" />
                                  {wakeTime || '-'}
                                </Box>
                              ) : '-'}
                            </TableCell>
                            <TableCell>{userTimezone}</TableCell>
                            <TableCell>
                              <Button
                                variant="outlined"
                                color="error"
                                size="small"
                                onClick={() => {
                                  setDeleteTarget({
                                    mode: 'schedule',
                                    scheduleName: deleteName,
                                    namespace,
                                  })
                                  setDeleteDialogOpen(true)
                                }}
                              >
                                Eliminar
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">No hay schedules configurados para este namespace</Alert>
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* Exclusiones Configuradas */}
      {exclusionsByNamespace.size > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" fontWeight="bold" sx={{ mb: 2 }}>
              Exclusiones Configuradas
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
              Servicios que no serán suspendidos durante los ciclos de sleep/wake
            </Typography>
            {Array.from(exclusionsByNamespace.entries()).map(([namespaceSuffix, exclusions]) => (
              <Accordion key={namespaceSuffix} sx={{ mb: 1 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                    <Typography variant="subtitle1" fontWeight="bold">
                      Namespace: {namespaceSuffix}
                    </Typography>
                    <Chip label={`${tenantName}-${namespaceSuffix}`} size="small" variant="outlined" />
                    <Chip 
                      label={`${exclusions.length} exclusión${exclusions.length !== 1 ? 'es' : ''}`} 
                      size="small" 
                      color="primary" 
                    />
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>Label Key</strong></TableCell>
                          <TableCell><strong>Label Value</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {exclusions.map((excl, idx) => (
                          <TableRow key={`${namespaceSuffix}-${excl.labelKey}-${idx}`}>
                            <TableCell>
                              <Chip label={excl.labelKey} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell>
                              <Chip label={excl.labelValue} size="small" color="primary" />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </AccordionDetails>
              </Accordion>
            ))}
          </CardContent>
        </Card>
      )}

      {exclusionsByNamespace.size === 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>
              Exclusiones Configuradas
            </Typography>
            <Alert severity="info">
              No hay exclusiones configuradas para este tenant. Todos los servicios serán suspendidos según el schedule.
            </Alert>
          </CardContent>
        </Card>
      )}

      <Box sx={{ display: 'flex', gap: 2, mt: 4 }}>
        <Button
          variant="contained"
          onClick={() =>
            navigate(
              scheduleNameParam
                ? `/schedule/edit/${tenantName}?scheduleName=${encodeURIComponent(scheduleNameParam)}`
                : `/schedule/edit/${tenantName}`
            )
          }
        >
          Editar Schedule
        </Button>
        <Button
          variant="outlined"
          color="error"
          onClick={() => {
            setDeleteTarget({ mode: 'tenant' })
            setDeleteDialogOpen(true)
          }}
        >
          {scheduleNameParam ? 'Eliminar Todo el Tenant' : 'Eliminar'}
        </Button>
      </Box>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false)
          setDeleteError(null)
          setDeleteTarget(null)
        }}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="delete-dialog-title">
          Confirmar Eliminación
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-dialog-description">
            {deleteTarget?.mode === 'schedule' ? (
              <>
                ¿Está seguro de que desea eliminar el schedule{' '}
                <strong>{deleteTarget.scheduleName}</strong>
                {deleteTarget.namespace ? (
                  <>
                    {' '}
                    en el namespace <strong>{deleteTarget.namespace}</strong>
                  </>
                ) : null}
                ? Esta acción no se puede deshacer.
              </>
            ) : (
              <>
                ¿Está seguro de que desea eliminar todos los schedules del tenant{' '}
                <strong>{tenantName}</strong>? Esta acción no se puede deshacer.
              </>
            )}
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
            onClick={handleDelete}
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
