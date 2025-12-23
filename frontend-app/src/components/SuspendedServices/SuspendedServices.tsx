import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Container,
  Typography,
  Box,
  Button,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material'
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material'
import { useParams } from 'react-router-dom'
import { useSuspendedServices, useTenants } from '../../hooks/useTenants'

export default function SuspendedServices() {
  const navigate = useNavigate()
  const { tenantName } = useParams<{ tenantName?: string }>()
  const { data: tenantsData } = useTenants()
  const [selectedTenant, setSelectedTenant] = React.useState(tenantName || '')
  
  const { data, isLoading, error } = useSuspendedServices(selectedTenant)

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
        <Alert severity="error">Error al cargar servicios suspendidos: {String(error)}</Alert>
      </Container>
    )
  }

  const suspended = data?.suspended || []

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
        <Typography variant="h4" component="h1" fontWeight="bold" sx={{ flexGrow: 1 }}>
          Servicios Suspendidos
        </Typography>
        {tenantsData && (
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>Seleccionar Tenant</InputLabel>
            <Select
              value={selectedTenant}
              label="Seleccionar Tenant"
              onChange={(e) => setSelectedTenant(e.target.value)}
            >
              {tenantsData.tenants.map((tenant: any) => (
                <MenuItem key={tenant.name} value={tenant.name}>
                  {tenant.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>

      {!selectedTenant && (
        <Alert severity="info" sx={{ mb: 4 }}>
          Seleccione un tenant para ver sus servicios suspendidos.
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Nombre</TableCell>
              <TableCell>Tipo</TableCell>
              <TableCell>Namespace</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Suspendido Desde</TableCell>
              <TableCell>Se Reactivará</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {suspended.map((service: any) => (
              <TableRow key={`${service.namespace}-${service.name}`}>
                <TableCell>{service.name}</TableCell>
                <TableCell>
                  <Chip label={service.kind} size="small" />
                </TableCell>
                <TableCell>{service.namespace}</TableCell>
                <TableCell>
                  <Chip label="Suspendido" color="error" size="small" />
                </TableCell>
                <TableCell>{new Date(service.suspendedAt).toLocaleString()}</TableCell>
                <TableCell>
                  {service.willWakeAt
                    ? new Date(service.willWakeAt).toLocaleString()
                    : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {selectedTenant && suspended.length === 0 && !isLoading && (
        <Alert severity="info" sx={{ mt: 4 }}>
          No hay servicios suspendidos actualmente para el tenant {selectedTenant}.
        </Alert>
      )}
    </Container>
  )
}

