import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AppBar, Toolbar, Typography, Box, Button, Chip, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Tooltip, Snackbar, Alert, Avatar,
} from '@mui/material'
import {
  Logout as LogoutIcon,
  People as PeopleIcon,
  Settings as SettingsIcon,
  SpaOutlined as LeafIcon,
} from '@mui/icons-material'
import { useAuth } from '@/context/AuthContext'
import { apiClient } from '@/services/api'

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, username, role, logout, canManageUsers } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [uiConfig, setUiConfig] = useState<{ envName: string; envColor: string; envLabel: string; clusterName: string } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ envName: '', envColor: '#22c55e', envLabel: '', clusterName: '' })
  const [saving, setSaving] = useState(false)
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })

  useEffect(() => {
    const base = import.meta.env.VITE_API_URL || ''
    fetch(`${base}/api/v1/ui-config`)
      .then(r => r.json())
      .then(data => setUiConfig(data))
      .catch(() => {})
  }, [])

  const openEdit = () => {
    setEditForm({
      envName: uiConfig?.envName || 'dev',
      envColor: uiConfig?.envColor || '#22c55e',
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

  const envColor = uiConfig?.envColor || '#1a2744'
  const envLabel = uiConfig?.envLabel || ''

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const getRoleLabel = (r: string | null) => {
    switch (r) {
      case 'admin': return 'Administrador'
      case 'operacion': return 'Operación'
      case 'lectura': return 'Lectura'
      default: return r || 'Usuario'
    }
  }

  const avatarLetter = username ? username[0].toUpperCase() : 'U'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="static"
        elevation={0}
        sx={{
          background: `linear-gradient(135deg, ${envColor} 0%, ${envColor}dd 100%)`,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          {/* Logo + name */}
          <Button
            color="inherit"
            onClick={() => navigate('/')}
            sx={{ textTransform: 'none', gap: 1, mr: 1, px: 1 }}
          >
            <LeafIcon sx={{ color: '#22c55e', fontSize: 26 }} />
            <Typography variant="subtitle1" fontWeight={700} letterSpacing={0.3}>
              kube-green Manager
            </Typography>
          </Button>

          {/* Env label chip */}
          {envLabel && (
            <Chip
              label={envLabel}
              size="small"
              sx={{
                bgcolor: 'rgba(255,255,255,0.12)',
                color: 'white',
                borderColor: 'rgba(255,255,255,0.25)',
                fontSize: '0.7rem',
                height: 22,
                fontWeight: 600,
              }}
              variant="outlined"
            />
          )}

          {/* Usuarios */}
          {canManageUsers() && (
            <Button
              color="inherit"
              startIcon={<PeopleIcon />}
              onClick={() => navigate('/users')}
              variant={location.pathname === '/users' ? 'outlined' : 'text'}
              sx={{ textTransform: 'none', ml: 1 }}
            >
              Usuarios
            </Button>
          )}

          <Box sx={{ flexGrow: 1 }} />

          {/* Settings (admin only) */}
          {isAuthenticated && role === 'admin' && (
            <Tooltip title="Configuración del entorno">
              <IconButton color="inherit" onClick={openEdit} size="small">
                <SettingsIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          )}

          {/* Role badge + avatar + username + logout */}
          {isAuthenticated && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 1 }}>
              <Chip
                label={getRoleLabel(role)}
                size="small"
                sx={{
                  bgcolor: 'rgba(255,255,255,0.15)',
                  color: 'white',
                  borderColor: 'transparent',
                  fontSize: '0.72rem',
                  height: 24,
                }}
              />
              <Avatar
                sx={{
                  width: 30,
                  height: 30,
                  bgcolor: '#22c55e',
                  color: '#0d1117',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                }}
              >
                {avatarLetter}
              </Avatar>
              <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                {username}
              </Typography>
              <Button
                color="inherit"
                startIcon={<LogoutIcon sx={{ fontSize: 16 }} />}
                onClick={handleLogout}
                size="small"
                sx={{ textTransform: 'none', fontSize: '0.82rem', minWidth: 0, px: 1 }}
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

      {/* Environment config dialog — admin only */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Configuración del entorno</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="Nombre del entorno"
            value={editForm.envName}
            onChange={e => setEditForm(f => ({ ...f, envName: e.target.value }))}
            size="small" fullWidth
          />
          <TextField
            label="Etiqueta visible"
            value={editForm.envLabel}
            onChange={e => setEditForm(f => ({ ...f, envLabel: e.target.value }))}
            size="small" fullWidth
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <TextField
              label="Color (hex)"
              value={editForm.envColor}
              onChange={e => setEditForm(f => ({ ...f, envColor: e.target.value }))}
              size="small" sx={{ flex: 1 }}
            />
            <input
              type="color"
              value={editForm.envColor}
              onChange={e => setEditForm(f => ({ ...f, envColor: e.target.value }))}
              style={{ width: 48, height: 40, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 2, background: 'none' }}
            />
          </Box>
          <Box sx={{ height: 36, borderRadius: 1, background: `linear-gradient(135deg, ${editForm.envColor} 0%, ${editForm.envColor}cc 100%)` }} />
          <TextField
            label="Nombre del cluster (opcional)"
            value={editForm.clusterName}
            onChange={e => setEditForm(f => ({ ...f, clusterName: e.target.value }))}
            size="small" fullWidth
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
