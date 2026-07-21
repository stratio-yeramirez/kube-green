import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppBar, Toolbar, Typography, Box, Button, Chip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Tooltip, Snackbar, Alert } from '@mui/material'
import { Logout as LogoutIcon, People as PeopleIcon, Dashboard as DashboardIcon, Palette as PaletteIcon } from '@mui/icons-material'
import { useAuth } from '@/context/AuthContext'
import { apiClient } from '@/services/api'

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, username, role, logout, canManageUsers } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [uiConfig, setUiConfig] = useState<{ envName: string; envColor: string; envLabel: string; clusterName: string } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ envName: '', envColor: '#1e3c72', envLabel: '', clusterName: '' })
  const [saving, setSaving] = useState(false)
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })

  useEffect(() => {
    const base = import.meta.env.VITE_API_URL || ''
    fetch(`${base}/api/v1/ui-config`)
      .then(r => r.json())
      .then(data => setUiConfig(data))
      .catch(() => {}) // silently ignore, use defaults
  }, [])

  const openEdit = () => {
    setEditForm({
      envName: uiConfig?.envName || 'dev',
      envColor: uiConfig?.envColor || '#1e3c72',
      envLabel: uiConfig?.envLabel || '',
      clusterName: uiConfig?.clusterName || '',
    })
    setEditOpen(true)
  }

  const saveEdit = async () => {
    setSaving(true)
    try {
      await apiClient.updateUIConfig(editForm)
      setUiConfig({ ...editForm })
      setEditOpen(false)
      setSnack({ open: true, message: 'Configuración guardada', severity: 'success' })
    } catch {
      setSnack({ open: true, message: 'Error al guardar configuración', severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const envColor = uiConfig?.envColor || '#1e3c72'
  const envLabel = uiConfig?.envLabel || ''
  const envName = uiConfig?.envName || 'dev'

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const getRoleLabel = (role: string | null) => {
    switch (role) {
      case 'admin':
        return 'Administrador'
      case 'operacion':
        return 'Operación'
      case 'lectura':
        return 'Lectura'
      default:
        return role || 'Usuario'
    }
  }

  const getRoleColor = (role: string | null) => {
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static" sx={{ background: `linear-gradient(135deg, ${envColor} 0%, ${envColor}cc 100%)` }}>
        <Toolbar>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexGrow: 1 }}>
            <Button
              color="inherit"
              startIcon={<DashboardIcon />}
              onClick={() => navigate('/')}
              sx={{ textTransform: 'none' }}
            >
              <Typography variant="h6" component="div">
                kube-green Manager
              </Typography>
            </Button>
            {envLabel && (
              <Chip
                label={envLabel}
                size="small"
                sx={{
                  bgcolor: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  borderColor: 'rgba(255,255,255,0.5)',
                  fontSize: '0.7rem',
                  height: 20,
                }}
                variant="outlined"
              />
            )}
            {canManageUsers() && (
              <Button
                color="inherit"
                startIcon={<PeopleIcon />}
                onClick={() => navigate('/users')}
                variant={location.pathname === '/users' ? 'outlined' : 'text'}
                sx={{ textTransform: 'none' }}
              >
                Usuarios
              </Button>
            )}
          </Box>
          {isAuthenticated && role === 'admin' && (
            <Tooltip title="Color del entorno">
              <IconButton color="inherit" onClick={openEdit} size="small" sx={{ mr: 1 }}>
                <PaletteIcon />
              </IconButton>
            </Tooltip>
          )}
          {isAuthenticated && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Chip
                label={getRoleLabel(role)}
                color={getRoleColor(role) as any}
                size="small"
                variant="outlined"
                sx={{ borderColor: 'rgba(255,255,255,0.5)', color: 'white' }}
              />
              <Typography variant="body2">{username}</Typography>
              <Button
                color="inherit"
                startIcon={<LogoutIcon />}
                onClick={handleLogout}
                size="small"
              >
                Salir
              </Button>
            </Box>
          )}
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ flexGrow: 1 }}>
        {children}
      </Box>

      {/* Environment color editor — admin only */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Configuración del entorno</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="Nombre del entorno"
            value={editForm.envName}
            onChange={e => setEditForm(f => ({ ...f, envName: e.target.value }))}
            size="small"
            fullWidth
          />
          <TextField
            label="Etiqueta visible"
            value={editForm.envLabel}
            onChange={e => setEditForm(f => ({ ...f, envLabel: e.target.value }))}
            size="small"
            fullWidth
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <TextField
              label="Color (hex)"
              value={editForm.envColor}
              onChange={e => setEditForm(f => ({ ...f, envColor: e.target.value }))}
              size="small"
              sx={{ flex: 1 }}
            />
            <input
              type="color"
              value={editForm.envColor}
              onChange={e => setEditForm(f => ({ ...f, envColor: e.target.value }))}
              style={{ width: 48, height: 40, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 2 }}
            />
          </Box>
          <Box sx={{ height: 36, borderRadius: 1, background: `linear-gradient(135deg, ${editForm.envColor} 0%, ${editForm.envColor}cc 100%)` }} />
          <TextField
            label="Nombre del cluster (opcional)"
            value={editForm.clusterName}
            onChange={e => setEditForm(f => ({ ...f, clusterName: e.target.value }))}
            size="small"
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancelar</Button>
          <Button onClick={saveEdit} disabled={saving} variant="contained">
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack(s => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  )
}



