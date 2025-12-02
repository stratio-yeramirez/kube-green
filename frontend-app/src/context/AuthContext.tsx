import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { authService, LoginRequest } from '@/services/auth'

interface AuthContextType {
  isAuthenticated: boolean
  username: string | null
  login: (credentials: LoginRequest) => Promise<void>
  logout: () => void
  isLoading: boolean
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
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Check authentication status on mount
    const checkAuth = () => {
      const authenticated = authService.isAuthenticated()
      setIsAuthenticated(authenticated)
      setUsername(authService.getUsername())
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
    } catch (error) {
      setIsAuthenticated(false)
      setUsername(null)
      throw error
    }
  }

  const logout = () => {
    authService.logout()
    setIsAuthenticated(false)
    setUsername(null)
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, username, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

