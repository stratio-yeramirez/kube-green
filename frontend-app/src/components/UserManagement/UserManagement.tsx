import React, { useState } from 'react'
import {
  Container,
  Typography,
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Alert,
  CircularProgress,
} from '@mui/material'
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Lock as LockIcon,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import type { UserInfo, CreateUserRequest } from '@/types'

const ROLES: ('admin' | 'operacion' | 'lectura')[] = ['admin', 'operacion', 'lectura']

export default function UserManagement() {
  const { canManageUsers } = useAuth()
  const queryClient = useQueryClient()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editPasswordDialogOpen, setEditPasswordDialogOpen] = useState(false)
  const [editRoleDialogOpen, setEditRoleDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [formData, setFormData] = useState<CreateUserRequest>({
    username: '',
    password: '',
    role: 'lectura',
  })
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'operacion' | 'lectura'>('lectura')

  const { data: users, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.listUsers(),
    enabled: canManageUsers(),
  })

  const createUserMutation = useMutation({
    mutationFn: (data: CreateUserRequest) => apiClient.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setCreateDialogOpen(false)
      setFormData({ username: '', password: '', role: 'lectura' })
    },
  })

  const updatePasswordMutation = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      apiClient.updateUserPassword(username, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditPasswordDialogOpen(false)
      setSelectedUser(null)
      setPassword('')
    },
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ username, role }: { username: string; role: string }) =>
      apiClient.updateUserRole(username, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditRoleDialogOpen(false)
      setSelectedUser(null)
      setRole('lectura')
    },
  })

  const deleteUserMutation = useMutation({
    mutationFn: (username: string) => apiClient.deleteUser(username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDeleteDialogOpen(false)
      setSelectedUser(null)
    },
  })

  const handleCreateUser = () => {
    createUserMutation.mutate(formData)
  }

  const handleUpdatePassword = () => {
    if (selectedUser) {
      updatePasswordMutation.mutate({ username: selectedUser, password })
    }
  }

  const handleUpdateRole = () => {
    if (selectedUser) {
      updateRoleMutation.mutate({ username: selectedUser, role })
    }
  }

  const handleDeleteUser = () => {
    if (selectedUser) {
      deleteUserMutation.mutate(selectedUser)
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'error'
      case 'operacion':
        return 'warning'
      case 'lectura':
        return 'info'
      default:
        return 'default'
    }
  }

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Administrador'
      case 'operacion':
        return 'Operación'
      case 'lectura':
        return 'Lectura'
      default:
        return role
    }
  }

  if (!canManageUsers()) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error">No tienes permisos para acceder a esta sección</Alert>
      </Container>
    )
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Administración de Usuarios
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Crear Usuario
        </Button>
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Error al cargar usuarios: {String(error)}
        </Alert>
      )}

      {users && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Usuario</TableCell>
                <TableCell>Rol</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.username}>
                  <TableCell>{user.username}</TableCell>
                  <TableCell>
                    <Chip
                      label={getRoleLabel(user.role)}
                      color={getRoleColor(user.role) as any}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => {
                        setSelectedUser(user.username)
                        setEditPasswordDialogOpen(true)
                      }}
                      title="Cambiar contraseña"
                    >
                      <LockIcon />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setSelectedUser(user.username)
                        setRole(user.role)
                        setEditRoleDialogOpen(true)
                      }}
                      title="Cambiar rol"
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => {
                        setSelectedUser(user.username)
                        setDeleteDialogOpen(true)
                      }}
                      title="Eliminar usuario"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create User Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Crear Nuevo Usuario</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField
              label="Nombre de usuario"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Contraseña"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              fullWidth
              required
            />
            <FormControl fullWidth>
              <InputLabel>Rol</InputLabel>
              <Select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                label="Rol"
              >
                {ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {getRoleLabel(r)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancelar</Button>
          <Button
            onClick={handleCreateUser}
            variant="contained"
            disabled={!formData.username || !formData.password || createUserMutation.isPending}
          >
            {createUserMutation.isPending ? 'Creando...' : 'Crear'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Update Password Dialog */}
      <Dialog open={editPasswordDialogOpen} onClose={() => setEditPasswordDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cambiar Contraseña</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Usuario: <strong>{selectedUser}</strong>
            </Typography>
            <TextField
              label="Nueva contraseña"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              required
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditPasswordDialogOpen(false)}>Cancelar</Button>
          <Button
            onClick={handleUpdatePassword}
            variant="contained"
            disabled={!password || updatePasswordMutation.isPending}
          >
            {updatePasswordMutation.isPending ? 'Actualizando...' : 'Actualizar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Update Role Dialog */}
      <Dialog open={editRoleDialogOpen} onClose={() => setEditRoleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cambiar Rol</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Usuario: <strong>{selectedUser}</strong>
            </Typography>
            <FormControl fullWidth>
              <InputLabel>Rol</InputLabel>
              <Select value={role} onChange={(e) => setRole(e.target.value as any)} label="Rol">
                {ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {getRoleLabel(r)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditRoleDialogOpen(false)}>Cancelar</Button>
          <Button
            onClick={handleUpdateRole}
            variant="contained"
            disabled={updateRoleMutation.isPending}
          >
            {updateRoleMutation.isPending ? 'Actualizando...' : 'Actualizar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Eliminar Usuario</DialogTitle>
        <DialogContent>
          <Typography>
            ¿Estás seguro de que deseas eliminar al usuario <strong>{selectedUser}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancelar</Button>
          <Button
            onClick={handleDeleteUser}
            variant="contained"
            color="error"
            disabled={deleteUserMutation.isPending}
          >
            {deleteUserMutation.isPending ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  )
}
















