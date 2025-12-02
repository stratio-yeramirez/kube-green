import axios from 'axios'

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface AuthService {
  login(credentials: LoginRequest): Promise<LoginResponse>
  logout(): void
  refreshToken(): Promise<string>
  getAccessToken(): string | null
  getRefreshToken(): string | null
  isAuthenticated(): boolean
}

class AuthServiceImpl implements AuthService {
  private readonly TOKEN_KEY = 'kube-green-access-token'
  private readonly REFRESH_TOKEN_KEY = 'kube-green-refresh-token'
  private readonly EXPIRES_AT_KEY = 'kube-green-expires-at'
  private readonly USERNAME_KEY = 'kube-green-username'
  
  // Use localStorage by default, but allow switching to sessionStorage
  private storage: Storage = localStorage
  
  constructor(useSessionStorage: boolean = false) {
    this.storage = useSessionStorage ? sessionStorage : localStorage
  }

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'
    const response = await axios.post<{ success: boolean; data: LoginResponse }>(
      `${API_BASE_URL}/v1/auth/login`,
      credentials
    )
    
    if (response.data.success && response.data.data) {
      this.setTokens(response.data.data, credentials.username)
      return response.data.data
    }
    
    throw new Error('Login failed')
  }

  logout(): void {
    this.storage.removeItem(this.TOKEN_KEY)
    this.storage.removeItem(this.REFRESH_TOKEN_KEY)
    this.storage.removeItem(this.EXPIRES_AT_KEY)
    this.storage.removeItem(this.USERNAME_KEY)
  }

  async refreshToken(): Promise<string> {
    const refreshToken = this.storage.getItem(this.REFRESH_TOKEN_KEY)
    if (!refreshToken) {
      throw new Error('No refresh token available')
    }

    const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'
    const response = await axios.post<{ success: boolean; data: LoginResponse }>(
      `${API_BASE_URL}/v1/auth/refresh`,
      { refreshToken }
    )

    if (response.data.success && response.data.data) {
      const username = this.storage.getItem(this.USERNAME_KEY) || ''
      this.setTokens(response.data.data, username)
      return response.data.data.accessToken
    }

    throw new Error('Token refresh failed')
  }

  getAccessToken(): string | null {
    return this.storage.getItem(this.TOKEN_KEY)
  }

  getRefreshToken(): string | null {
    return this.storage.getItem(this.REFRESH_TOKEN_KEY)
  }

  getUsername(): string | null {
    return this.storage.getItem(this.USERNAME_KEY)
  }

  isAuthenticated(): boolean {
    const token = this.getAccessToken()
    const expiresAt = this.storage.getItem(this.EXPIRES_AT_KEY)
    
    if (!token || !expiresAt) {
      return false
    }

    // Check if token hasn't expired
    const expirationTime = parseInt(expiresAt, 10)
    return Date.now() < expirationTime
  }

  private setTokens(data: LoginResponse, username: string): void {
    this.storage.setItem(this.TOKEN_KEY, data.accessToken)
    this.storage.setItem(this.REFRESH_TOKEN_KEY, data.refreshToken)
    
    // Calculate expiration time
    const expiresAt = Date.now() + (data.expiresIn * 1000)
    this.storage.setItem(this.EXPIRES_AT_KEY, expiresAt.toString())
    this.storage.setItem(this.USERNAME_KEY, username)
  }
}

export const authService = new AuthServiceImpl()

