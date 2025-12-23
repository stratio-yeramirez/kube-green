import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Container,
  Typography,
  Grid,
  Card,
  CardContent,
  Box,
  Button,
  CircularProgress,
  Alert,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
} from '@mui/material'
import { Add as AddIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material'
import { useTenants, useAllSchedules, useAllSuspendedServices, useAllNextOperations } from '../../hooks/useTenants'
import { useAuth } from '../../context/AuthContext'

export default function Dashboard() {
  const navigate = useNavigate()
  const { canCreateSchedule } = useAuth()
  const { data: tenantsData, isLoading: tenantsLoading, error: tenantsError } = useTenants()
  const { data: allSchedules, isLoading: schedulesLoading } = useAllSchedules()
  const { data: allSuspended, isLoading: suspendedLoading } = useAllSuspendedServices()
  const { data: nextOperation, isLoading: nextOpLoading } = useAllNextOperations()

  const isLoading = tenantsLoading || schedulesLoading
  const error = tenantsError

  // Procesar schedules individuales para mostrar
  const schedulesList = useMemo(() => {
    if (!allSchedules || !Array.isArray(allSchedules)) return []

    const grouped = new Map<
      string,
      { tenant: string; scheduleName: string; namespaces: Set<string> }
    >()

    allSchedules.forEach((schedule: any) => {
      if (!schedule?.tenant || !schedule?.namespaces) return

      Object.entries(schedule.namespaces).forEach(([namespace, nsSchedules]) => {
        const schedulesArray = Array.isArray(nsSchedules)
          ? nsSchedules
          : (nsSchedules as any)?.schedule || []

        schedulesArray.forEach((item: any) => {
          const scheduleName =
            item?.annotations?.['kube-green.stratio.com/schedule-name'] ||
            item?.name ||
            `Schedule-${schedule.tenant}`
          const key = `${schedule.tenant}:${scheduleName}`
          const existing = grouped.get(key)
          if (existing) {
            existing.namespaces.add(namespace)
          } else {
            grouped.set(key, {
              tenant: schedule.tenant,
              scheduleName,
              namespaces: new Set([namespace]),
            })
          }
        })
      })
    })

    return Array.from(grouped.values())
  }, [allSchedules])

  const schedulesByTenant = useMemo(() => {
    const grouped = new Map<string, typeof schedulesList>()
    schedulesList.forEach((schedule) => {
      const existing = grouped.get(schedule.tenant) || []
      existing.push(schedule)
      grouped.set(schedule.tenant, existing)
    })
    return Array.from(grouped.entries())
  }, [schedulesList])

  // Calculate stats
  const totalSuspended = allSuspended?.length || 0
  const totalTenants = tenantsData?.tenants?.length || 0
  const activeTenants = useMemo(() => {
    const tenantsSet = new Set<string>()
    schedulesList.forEach((schedule: any) => {
      if (schedule.tenant) tenantsSet.add(schedule.tenant)
    })
    return tenantsSet.size
  }, [schedulesList])

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
        <Alert severity="error">Error al cargar tenants: {String(error)}</Alert>
      </Container>
    )
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 4 }}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          kube-green Manager
        </Typography>
        {canCreateSchedule() && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/schedule/new')}
          >
            Nuevo Schedule
          </Button>
        )}
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                TENANTS
              </Typography>
              <Typography variant="h4">{totalTenants}</Typography>
              <Typography variant="body2" color="textSecondary">
                Descubiertos automáticamente
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                ACTIVOS
              </Typography>
              <Typography variant="h4">{activeTenants}</Typography>
              <Typography variant="body2" color="textSecondary">
                Con schedules activos
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                SUSPENDIDOS
              </Typography>
              <Typography variant="h4">
                {suspendedLoading ? (
                  <CircularProgress size={24} />
                ) : (
                  totalSuspended
                )}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Servicios actualmente apagados
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                PRÓXIMO
              </Typography>
              <Typography variant="h4">
                {nextOpLoading ? (
                  <CircularProgress size={24} />
                ) : nextOperation ? (
                  <Box>
                    <Typography variant="h6" component="div">
                      {nextOperation.operation === 'SLEEP' ? 'Apagar' : 'Encender'}
                    </Typography>
                    <Typography variant="caption" display="block" color="textSecondary">
                      {new Date(nextOperation.time).toLocaleString('es-ES', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Typography>
                  </Box>
                ) : (
                  '-'
                )}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {nextOperation?.description || 'Operación programada'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Schedules List */}
      <Typography variant="h5" sx={{ mb: 2 }}>
        Schedules Activos
      </Typography>
      {schedulesByTenant.map(([tenant, schedules]) => {
        const scheduleCount = schedules.length
        const namespaceCount = new Set(
          schedules.flatMap((schedule: any) => Array.from(schedule.namespaces || []))
        ).size

        return (
          <Accordion key={tenant} sx={{ mb: 2 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="h6">{tenant}</Typography>
                <Chip
                  label={`${scheduleCount} schedule${scheduleCount !== 1 ? 's' : ''}`}
                  size="small"
                  color="primary"
                />
                <Chip
                  label={`${namespaceCount} namespace${namespaceCount !== 1 ? 's' : ''}`}
                  size="small"
                  variant="outlined"
                />
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                {schedules.map((schedule: any, index: number) => {
                  const scheduleKey = `${schedule.tenant}-${schedule.scheduleName || index}`

                  return (
                    <Grid item xs={12} key={scheduleKey}>
                      <Card
                        sx={{
                          cursor: 'pointer',
                          '&:hover': {
                            boxShadow: 6,
                          },
                        }}
                        onClick={() =>
                          navigate(
                            `/schedule/edit/${schedule.tenant}?scheduleName=${encodeURIComponent(schedule.scheduleName)}`
                          )
                        }
                      >
                        <CardContent>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box sx={{ flexGrow: 1 }}>
                              <Typography variant="h6" fontWeight="bold">
                                {schedule.scheduleName || `Schedule-${schedule.tenant}`}
                              </Typography>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                                {Array.from(schedule?.namespaces || []).map((ns: string) => (
                                  <Chip key={ns} label={ns} size="small" variant="outlined" />
                                ))}
                              </Box>
                              <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                                {Array.from(schedule.namespaces || []).length} namespace
                                {Array.from(schedule.namespaces || []).length !== 1 ? 's' : ''}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Button
                                variant="outlined"
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  navigate(
                                    `/tenant/${schedule.tenant}?scheduleName=${encodeURIComponent(schedule.scheduleName)}`
                                  )
                                }}
                              >
                                Namespaces
                              </Button>
                              {canCreateSchedule() && (
                                <Button
                                  variant="outlined"
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    navigate(
                                      `/schedule/edit/${schedule.tenant}?scheduleName=${encodeURIComponent(schedule.scheduleName)}`
                                    )
                                  }}
                                >
                                  Editar
                                </Button>
                              )}
                            </Box>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  )
                })}
              </Grid>
              <Divider sx={{ mt: 2 }} />
            </AccordionDetails>
          </Accordion>
        )
      })}

      {schedulesList.length === 0 && (
        <Alert severity="info" sx={{ mt: 4 }}>
          No se encontraron schedules activos. Crea un nuevo schedule para comenzar.
        </Alert>
      )}
    </Container>
  )
}
