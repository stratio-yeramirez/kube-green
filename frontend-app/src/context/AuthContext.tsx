import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { authService, LoginRequest } from '@/services/auth'

interface AuthContextType {
  isAuthenticated: boolean
  username: string | null
  role: string | null
  login: (credentials: LoginRequest) => Promise<void>
  logout: () => void
  isLoading: boolean
  isAdmin: () => boolean
  canManageUsers: () => boolean
  canCreateSchedule: () => boolean
  canDeleteSchedule: () => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Check authentication status on mount
    const checkAuth = () => {
      const authenticated = authService.isAuthenticated()
      setIsAuthenticated(authenticated)
      setUsername(authService.getUsername())
      // getRole() now decodes from token if not in storage
      const userRole = authService.getRole()
      setRole(userRole)
      setIsLoading(false)
    }

    checkAuth()

    // Check auth status periodically (every 5 minutes)
    const interval = setInterval(checkAuth, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const login = async (credentials: LoginRequest) => {
    try {
      await authService.login(credentials)
      setIsAuthenticated(true)
      setUsername(credentials.username)
      setRole(authService.getRole())
    } catch (error) {
      setIsAuthenticated(false)
      setUsername(null)
      setRole(null)
      throw error
    }
  }

  const logout = () => {
    authService.logout()
    setIsAuthenticated(false)
    setUsername(null)
    setRole(null)
  }

  const isAdmin = () => role === 'admin'
  const canManageUsers = () => role === 'admin'
  const canCreateSchedule = () => role === 'admin' || role === 'operacion'
  const canDeleteSchedule = () => role === 'admin' || role === 'operacion'

  return (
    <AuthContext.Provider value={{ 
      isAuthenticated, 
      username, 
      role,
      login, 
      logout, 
      isLoading,
      isAdmin,
      canManageUsers,
      canCreateSchedule,
      canDeleteSchedule,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

