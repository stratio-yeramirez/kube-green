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
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  IconButton,
} from '@mui/material'
import {
  Add as AddIcon,
  Search as SearchIcon,
  Schedule as ScheduleIcon,
  Dns as DnsIcon,
  PowerSettingsNew as PowerIcon,
  WbSunny as WakeIcon,
  PauseCircleOutline as PauseIcon,
  PlayCircleOutline as ResumeIcon,
  FilterList as FilterIcon,
  AccessTime as ClockIcon,
  Edit as EditIcon,
  Storage as StorageIcon,
} from '@mui/icons-material'
import { useTenants, useAllSchedules, useAllSuspendedServices, useAllNextOperations } from '../../hooks/useTenants'
import { useAuth } from '../../context/AuthContext'
import { apiClient } from '../../services/api'

export default function Dashboard() {
  const navigate = useNavigate()
  const { canCreateSchedule } = useAuth()
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [suspendDialog, setSuspendDialog] = useState<{ open: boolean; tenant: string }>({ open: false, tenant: '' })
  const [suspendUntil, setSuspendUntil] = useState('')
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })

  const { data: tenantsData, isLoading: tenantsLoading, error: tenantsError } = useTenants()
  const { data: allSchedules, isLoading: schedulesLoading } = useAllSchedules()
  const { data: allSuspended, isLoading: suspendedLoading } = useAllSuspendedServices()
  const { data: nextOperation, isLoading: nextOpLoading } = useAllNextOperations()

  const isLoading = tenantsLoading || schedulesLoading
  const error = tenantsError

  const schedulesList = useMemo(() => {
    if (!allSchedules || !Array.isArray(allSchedules)) return []
    const grouped = new Map<string, { tenant: string; scheduleName: string; namespaces: Set<string> }>()
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
            grouped.set(key, { tenant: schedule.tenant, scheduleName, namespaces: new Set([namespace]) })
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

  const sleepingTenants = useMemo(() => {
    const sleeping = new Set<string>()
    if (!allSuspended?.length) return sleeping
    const suspendedNs = new Set((allSuspended as any[]).map((s) => s.namespace))
    schedulesByTenant.forEach(([tenant, schedules]) => {
      const tenantNs = new Set(schedules.flatMap((s: any) => Array.from(s.namespaces || [])))
      for (const ns of tenantNs) {
        if (suspendedNs.has(ns)) { sleeping.add(tenant); break }
      }
    })
    return sleeping
  }, [allSuspended, schedulesByTenant])

  const totalSuspended = allSuspended?.length || 0
  const totalTenants = tenantsData?.tenants?.length || 0
  const activeTenants = useMemo(() => {
    const tenantsSet = new Set<string>()
    schedulesList.forEach((s: any) => { if (s.tenant) tenantsSet.add(s.tenant) })
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
      {/* Page header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Panel de operaciones
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Gestiona horarios y consumo de tus entornos Kubernetes.
          </Typography>
        </Box>
        {canCreateSchedule() && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/schedule/new')}
            sx={{ bgcolor: '#22c55e', '&:hover': { bgcolor: '#16a34a' }, fontWeight: 600 }}
          >
            Nuevo schedule
          </Button>
        )}
      </Box>

      {/* Summary stats */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* TENANTS */}
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" fontWeight={600} letterSpacing={1}>
                TENANTS
              </Typography>
              <Typography variant="h3" fontWeight={700} sx={{ my: 0.5 }}>
                {totalTenants}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Descubiertos automáticamente
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* ACTIVOS */}
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} letterSpacing={1}>
                  ACTIVOS
                </Typography>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e', boxShadow: '0 0 6px #22c55e88' }} />
              </Box>
              <Typography variant="h3" fontWeight={700} sx={{ my: 0.5 }}>
                {activeTenants}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Con schedules activos
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* SUSPENDIDOS */}
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} letterSpacing={1}>
                  SUSPENDIDOS
                </Typography>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#f59e0b', boxShadow: '0 0 6px #f59e0b88' }} />
              </Box>
              <Typography variant="h3" fontWeight={700} sx={{ my: 0.5 }}>
                {suspendedLoading ? <CircularProgress size={28} /> : totalSuspended}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Servicios actualmente apagados
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* PRÓXIMA OPERACIÓN */}
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" fontWeight={600} letterSpacing={1}>
                PRÓXIMA OPERACIÓN
              </Typography>
              {nextOpLoading ? (
                <CircularProgress size={28} sx={{ my: 0.5 }} />
              ) : nextOperation ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, my: 0.5 }}>
                  <ClockIcon sx={{ color: '#f59e0b', fontSize: 32 }} />
                  <Box>
                    <Typography variant="h6" fontWeight={700} color={nextOperation.operation === 'SLEEP' ? 'warning.main' : 'success.main'}>
                      {nextOperation.operation === 'SLEEP' ? 'Apagar' : 'Encender'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(nextOperation.time).toLocaleString('es-ES', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Typography variant="h4" sx={{ my: 0.5 }}>—</Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                {nextOperation?.description || 'Operación programada'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Section header + search */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
        <Typography variant="h5" fontWeight={600}>
          Schedules activos
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Buscar tenant…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ width: 220 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
            }}
          />
          <Tooltip title="Filtrar">
            <IconButton size="small" sx={{ border: '1px solid', borderColor: 'divider' }}>
              <FilterIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Tenant cards grid */}
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
                    bgcolor: 'background.paper',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    '&:hover': {
                      borderColor: 'rgba(34,197,94,0.35)',
                      boxShadow: '0 0 0 1px rgba(34,197,94,0.15)',
                    },
                  }}
                >
                  <CardActionArea
                    onClick={() => navigate(`/tenant/${tenant}`)}
                    sx={{ flexGrow: 1, alignItems: 'flex-start', display: 'flex', flexDirection: 'column' }}
                  >
                    <CardContent sx={{ width: '100%', pb: 1 }}>
                      <Typography variant="subtitle1" fontWeight={700} noWrap title={tenant} sx={{ mb: 1.5 }}>
                        {tenant}
                      </Typography>

                      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                        <Chip
                          icon={<ScheduleIcon sx={{ fontSize: '13px !important' }} />}
                          label={`${scheduleCount} schedule${scheduleCount !== 1 ? 's' : ''}`}
                          size="small"
                          variant="outlined"
                          sx={{ borderColor: 'divider', fontSize: '0.72rem', height: 24 }}
                        />
                        <Chip
                          icon={<StorageIcon sx={{ fontSize: '13px !important' }} />}
                          label={`${namespaceCount} namespace${namespaceCount !== 1 ? 's' : ''}`}
                          size="small"
                          variant="outlined"
                          sx={{ borderColor: 'divider', fontSize: '0.72rem', height: 24 }}
                        />
                      </Box>

                      <Divider sx={{ mb: 1.5 }} />

                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                        {visibleSchedules.map((schedule: any, i: number) => (
                          <Typography
                            key={i}
                            variant="body2"
                            color="text.secondary"
                            noWrap
                            title={schedule.scheduleName}
                            sx={{ fontSize: '0.75rem' }}
                          >
                            • {schedule.scheduleName}
                          </Typography>
                        ))}
                        {hiddenCount > 0 && (
                          <Typography variant="body2" color="primary" sx={{ fontSize: '0.75rem', mt: 0.3 }}>
                            +{hiddenCount} más
                          </Typography>
                        )}
                      </Box>
                    </CardContent>
                  </CardActionArea>

                  {/* Footer actions */}
                  <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {canCreateSchedule() && (
                      <>
                        {/* Manual: Apagar / Encender */}
                        <Box sx={{ display: 'flex', gap: 0.75 }}>
                          <Tooltip title="Apagar todos los namespaces ahora (inmediato)">
                            <Button
                              size="small"
                              fullWidth
                              variant="contained"
                              color="warning"
                              startIcon={actionLoading === `sleep-${tenant}` ? <CircularProgress size={13} color="inherit" /> : <PowerIcon sx={{ fontSize: '16px !important' }} />}
                              disabled={actionLoading !== null}
                              sx={{ fontSize: '0.78rem', py: 0.6 }}
                              onClick={async (e) => {
                                e.stopPropagation()
                                setActionLoading(`sleep-${tenant}`)
                                try {
                                  await apiClient.triggerManualAction(tenant, 'sleep')
                                  setSnack({ open: true, message: `Tenant ${tenant} apagado`, severity: 'success' })
                                } catch { setSnack({ open: true, message: 'Error al apagar', severity: 'error' }) }
                                finally { setActionLoading(null) }
                              }}
                            >
                              Apagar
                            </Button>
                          </Tooltip>
                          <Tooltip title="Encender todos los namespaces ahora (inmediato)">
                            <Button
                              size="small"
                              fullWidth
                              variant="contained"
                              color="success"
                              startIcon={actionLoading === `wake-${tenant}` ? <CircularProgress size={13} color="inherit" /> : <WakeIcon sx={{ fontSize: '16px !important' }} />}
                              disabled={actionLoading !== null}
                              sx={{ fontSize: '0.78rem', py: 0.6 }}
                              onClick={async (e) => {
                                e.stopPropagation()
                                setActionLoading(`wake-${tenant}`)
                                try {
                                  await apiClient.triggerManualAction(tenant, 'wake')
                                  setSnack({ open: true, message: `Tenant ${tenant} encendido`, severity: 'success' })
                                } catch { setSnack({ open: true, message: 'Error al encender', severity: 'error' }) }
                                finally { setActionLoading(null) }
                              }}
                            >
                              Encender
                            </Button>
                          </Tooltip>
                        </Box>

                        {/* Cron: Suspender / Reactivar */}
                        <Box sx={{ display: 'flex', gap: 0.75 }}>
                          <Tooltip title="Pausar el cron schedule hasta una fecha">
                            <Button
                              size="small"
                              fullWidth
                              variant="outlined"
                              color="secondary"
                              startIcon={<PauseIcon sx={{ fontSize: '16px !important' }} />}
                              disabled={actionLoading !== null}
                              sx={{ fontSize: '0.78rem', py: 0.6 }}
                              onClick={(e) => {
                                e.stopPropagation()
                                const next1h = new Date(Date.now() + 60 * 60 * 1000)
                                setSuspendUntil(next1h.toISOString().slice(0, 16))
                                setSuspendDialog({ open: true, tenant })
                              }}
                            >
                              Suspender cron
                            </Button>
                          </Tooltip>
                          <Tooltip title="Reactivar el cron schedule">
                            <Button
                              size="small"
                              fullWidth
                              variant="outlined"
                              color="info"
                              startIcon={actionLoading === `resume-${tenant}` ? <CircularProgress size={13} color="inherit" /> : <ResumeIcon sx={{ fontSize: '16px !important' }} />}
                              disabled={actionLoading !== null}
                              sx={{ fontSize: '0.78rem', py: 0.6 }}
                              onClick={async (e) => {
                                e.stopPropagation()
                                setActionLoading(`resume-${tenant}`)
                                try {
                                  await apiClient.unsuspendSchedule(tenant)
                                  setSnack({ open: true, message: `Cron de ${tenant} reactivado`, severity: 'success' })
                                } catch { setSnack({ open: true, message: 'Error al reactivar', severity: 'error' }) }
                                finally { setActionLoading(null) }
                              }}
                            >
                              Reactivar cron
                            </Button>
                          </Tooltip>
                        </Box>
                      </>
                    )}

                    {/* Navigation */}
                    <Box sx={{ display: 'flex', gap: 0.75 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        fullWidth
                        startIcon={<DnsIcon sx={{ fontSize: '15px !important' }} />}
                        sx={{ fontSize: '0.78rem', py: 0.6, borderColor: 'divider', color: 'text.secondary', '&:hover': { borderColor: 'text.secondary' } }}
                        onClick={(e) => { e.stopPropagation(); navigate(`/tenant/${tenant}`) }}
                      >
                        Namespaces
                      </Button>
                      {canCreateSchedule() && (
                        <Button
                          size="small"
                          variant="outlined"
                          fullWidth
                          startIcon={<EditIcon sx={{ fontSize: '15px !important' }} />}
                          sx={{ fontSize: '0.78rem', py: 0.6, borderColor: 'divider', color: 'text.secondary', '&:hover': { borderColor: 'text.secondary' } }}
                          onClick={(e) => { e.stopPropagation(); navigate(`/schedule/edit/${tenant}`) }}
                        >
                          Editar
                        </Button>
                      )}
                    </Box>
                  </Box>
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

      {/* Suspend schedule dialog */}
      <Dialog open={suspendDialog.open} onClose={() => setSuspendDialog(d => ({ ...d, open: false }))} maxWidth="xs" fullWidth>
        <DialogTitle>Suspender cron — {suspendDialog.tenant}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            El apagado/encendido automático quedará pausado hasta la fecha indicada. Los recursos no cambiarán de estado.
          </Typography>
          <TextField
            label="Suspender hasta"
            type="datetime-local"
            value={suspendUntil}
            onChange={e => setSuspendUntil(e.target.value)}
            fullWidth size="small"
            InputLabelProps={{ shrink: true }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuspendDialog(d => ({ ...d, open: false }))}>Cancelar</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!suspendUntil || actionLoading !== null}
            onClick={async () => {
              const tenant = suspendDialog.tenant
              setSuspendDialog(d => ({ ...d, open: false }))
              setActionLoading(`suspend-${tenant}`)
              try {
                await apiClient.suspendSchedule(tenant, new Date(suspendUntil))
                setSnack({ open: true, message: `Cron de ${tenant} suspendido hasta ${new Date(suspendUntil).toLocaleString('es-ES')}`, severity: 'success' })
              } catch { setSnack({ open: true, message: 'Error al suspender cron', severity: 'error' }) }
              finally { setActionLoading(null) }
            }}
          >
            Confirmar
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Container>
  )
}
