import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppBar, Toolbar, Typography, Box, Button, Chip } from '@mui/material'
import { Logout as LogoutIcon, People as PeopleIcon, Dashboard as DashboardIcon } from '@mui/icons-material'
import { useAuth } from '@/context/AuthContext'

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, username, role, logout, canManageUsers } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

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
      <AppBar position="static" sx={{ background: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)' }}>
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
    </Box>
  )
}



