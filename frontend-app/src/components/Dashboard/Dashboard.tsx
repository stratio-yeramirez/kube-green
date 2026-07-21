import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Container,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  Box,
  Button,
  CircularProgress,
  Alert,
  Chip,
  InputAdornment,
  TextField,
  Divider,
} from '@mui/material'
import {
  Add as AddIcon,
  Search as SearchIcon,
  Schedule as ScheduleIcon,
  Dns as DnsIcon,
} from '@mui/icons-material'
import { useTenants, useAllSchedules, useAllSuspendedServices, useAllNextOperations } from '../../hooks/useTenants'
import { useAuth } from '../../context/AuthContext'

export default function Dashboard() {
  const navigate = useNavigate()
  const { canCreateSchedule } = useAuth()
  const [search, setSearch] = useState('')
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

      {/* Tenant cards */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">Schedules Activos</Typography>
        <TextField
          size="small"
          placeholder="Buscar tenant…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ width: 220 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <Grid container spacing={2}>
        {schedulesByTenant
          .filter(([tenant]) => tenant.toLowerCase().includes(search.toLowerCase()))
          .map(([tenant, schedules]) => {
            const scheduleCount = schedules.length
            const namespaceCount = new Set(
              schedules.flatMap((s: any) => Array.from(s.namespaces || []))
            ).size
            const visibleSchedules = schedules.slice(0, 4)
            const hiddenCount = schedules.length - visibleSchedules.length

            return (
              <Grid item xs={12} sm={6} md={4} lg={3} key={tenant}>
                <Card
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'box-shadow 0.2s',
                    '&:hover': { boxShadow: 6 },
                  }}
                >
                  <CardActionArea
                    onClick={() => navigate(`/tenant/${tenant}`)}
                    sx={{ flexGrow: 1, alignItems: 'flex-start', display: 'flex', flexDirection: 'column' }}
                  >
                    <CardContent sx={{ width: '100%' }}>
                      {/* Tenant name */}
                      <Typography variant="h6" fontWeight="bold" noWrap title={tenant} sx={{ mb: 1 }}>
                        {tenant}
                      </Typography>

                      {/* Counters */}
                      <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
                        <Chip
                          icon={<ScheduleIcon sx={{ fontSize: '14px !important' }} />}
                          label={`${scheduleCount} schedule${scheduleCount !== 1 ? 's' : ''}`}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                        <Chip
                          icon={<DnsIcon sx={{ fontSize: '14px !important' }} />}
                          label={`${namespaceCount} ns`}
                          size="small"
                          variant="outlined"
                        />
                      </Box>

                      <Divider sx={{ mb: 1.5 }} />

                      {/* Schedule list */}
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {visibleSchedules.map((schedule: any, i: number) => (
                          <Typography
                            key={i}
                            variant="body2"
                            color="textSecondary"
                            noWrap
                            title={schedule.scheduleName}
                            sx={{ fontSize: '0.78rem' }}
                          >
                            • {schedule.scheduleName}
                          </Typography>
                        ))}
                        {hiddenCount > 0 && (
                          <Typography variant="body2" color="primary" sx={{ fontSize: '0.78rem', mt: 0.5 }}>
                            +{hiddenCount} más
                          </Typography>
                        )}
                      </Box>
                    </CardContent>
                  </CardActionArea>

                  {/* Footer actions */}
                  {canCreateSchedule() && (
                    <Box sx={{ px: 2, pb: 1.5, display: 'flex', gap: 1 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        fullWidth
                        onClick={() => navigate(`/tenant/${tenant}`)}
                      >
                        Ver detalle
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        fullWidth
                        onClick={() => navigate(`/schedule/edit/${tenant}`)}
                      >
                        Editar
                      </Button>
                    </Box>
                  )}
                </Card>
              </Grid>
            )
          })}
      </Grid>

      {schedulesList.length === 0 && (
        <Alert severity="info" sx={{ mt: 4 }}>
          No se encontraron schedules activos. Crea un nuevo schedule para comenzar.
        </Alert>
      )}
    </Container>
  )
}
