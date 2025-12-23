import axios, { AxiosInstance } from 'axios'
import type {
  ApiResponse,
  TenantListResponse,
  NamespaceInfo,
  CreateScheduleRequest,
  Schedule,
  SuspendedServicesResponse,
  SuspendedService,
  TimezoneConversion,
  NamespaceResourceInfo,
  NamespaceScheduleRequest,
  NamespaceScheduleResponse,
  NextOperationResponse,
  UserInfo,
  CreateUserRequest,
} from '@/types'
import { authService } from './auth'

// Use relative path when in production (no VITE_API_URL set), otherwise use configured URL
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: `${API_BASE_URL}/v1`,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    })

    // Request interceptor - Add token automatically
    this.client.interceptors.request.use(
      async (config) => {
        const token = authService.getAccessToken()
        if (token && authService.isAuthenticated()) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // Response interceptor - Handle 401 and refresh token
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config

        // If 401 and not a retry, try to refresh token
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true

          try {
            const newToken = await authService.refreshToken()
            originalRequest.headers.Authorization = `Bearer ${newToken}`
            return this.client(originalRequest)
          } catch (refreshError) {
            // If refresh fails, logout and redirect to login
            authService.logout()
            // Only redirect if we're in browser (not SSR)
            if (typeof window !== 'undefined') {
              window.location.href = '/login'
            }
            return Promise.reject(refreshError)
          }
        }

        if (error.response?.status === 404) {
          console.error('Resource not found:', error.config?.url)
        } else if (error.response?.status >= 500) {
          console.error('Server error:', error.response?.data)
        }
        return Promise.reject(error)
      }
    )
  }

  // Health check
  async health(): Promise<boolean> {
    try {
      const response = await this.client.get('/health')
      return response.status === 200
    } catch {
      return false
    }
  }

  // Get all tenants
  async getTenants(): Promise<TenantListResponse> {
    const response = await this.client.get<ApiResponse<TenantListResponse>>('/tenants')
    return response.data.data
  }

  // Get services for a namespace
  async getNamespaceServices(tenant: string, namespace: string): Promise<NamespaceInfo> {
    const response = await this.client.get<ApiResponse<NamespaceInfo>>(
      `/namespaces/${tenant}/services?namespace=${namespace}`
    )
    return response.data.data
  }

  // Get resources (CRDs) for a namespace
  async getNamespaceResources(tenant: string, namespace: string): Promise<NamespaceResourceInfo> {
    const response = await this.client.get<ApiResponse<NamespaceResourceInfo>>(
      `/namespaces/${tenant}/resources?namespace=${namespace}`
    )
    return response.data.data
  }

  // Get schedules for a tenant
  async getSchedules(tenant: string, namespace?: string): Promise<Schedule> {
    const url = namespace
      ? `/schedules/${tenant}?namespace=${namespace}`
      : `/schedules/${tenant}`
    const response = await this.client.get<ApiResponse<Schedule>>(url)
    return response.data.data
  }

  // Get all schedules (for filtering tenants with active schedules)
  async getAllSchedules(): Promise<Schedule[]> {
    const response = await this.client.get<ApiResponse<Schedule[]>>('/schedules')
    return response.data.data || []
  }

  // Create schedule
  async createSchedule(request: CreateScheduleRequest): Promise<void> {
    await this.client.post<ApiResponse<void>>('/schedules', request)
  }

  // Update schedule
  async updateSchedule(tenant: string, request: CreateScheduleRequest): Promise<void> {
    await this.client.put<ApiResponse<void>>(`/schedules/${tenant}`, request)
  }

  // Delete schedule
  async deleteSchedule(tenant: string, namespace?: string, scheduleName?: string): Promise<void> {
    const params = new URLSearchParams()
    if (namespace) {
      params.set('namespace', namespace)
    }
    if (scheduleName) {
      params.set('scheduleName', scheduleName)
    }
    const query = params.toString()
    const url = query ? `/schedules/${tenant}?${query}` : `/schedules/${tenant}`
    await this.client.delete<ApiResponse<void>>(url)
  }

  // Namespace-specific schedule endpoints
  // Get schedule for a specific namespace
  async getNamespaceSchedule(tenant: string, namespace: string): Promise<NamespaceScheduleResponse> {
    const response = await this.client.get<ApiResponse<NamespaceScheduleResponse>>(
      `/schedules/${tenant}/${namespace}`
    )
    return response.data.data
  }

  // Create schedule for a specific namespace
  async createNamespaceSchedule(request: NamespaceScheduleRequest): Promise<void> {
    await this.client.post<ApiResponse<void>>(
      `/schedules/${request.tenant}/${request.namespace}`,
      request
    )
  }

  // Update schedule for a specific namespace
  async updateNamespaceSchedule(request: NamespaceScheduleRequest): Promise<void> {
    await this.client.put<ApiResponse<void>>(
      `/schedules/${request.tenant}/${request.namespace}`,
      request
    )
  }

  // Delete schedule for a specific namespace
  async deleteNamespaceSchedule(tenant: string, namespace: string): Promise<void> {
    await this.client.delete<ApiResponse<void>>(`/schedules/${tenant}/${namespace}`)
  }

  // Get suspended services
  async getSuspendedServices(tenant: string): Promise<SuspendedServicesResponse> {
    const response = await this.client.get<ApiResponse<SuspendedServicesResponse>>(
      `/schedules/${tenant}/suspended`
    )
    return response.data.data
  }

  // Get next scheduled operation
  async getNextOperation(tenant: string): Promise<NextOperationResponse> {
    const response = await this.client.get<ApiResponse<NextOperationResponse>>(
      `/schedules/${tenant}/next`
    )
    return response.data.data
  }

  // Get all suspended services (aggregate across all tenants)
  async getAllSuspendedServices(): Promise<SuspendedService[]> {
    const response = await this.client.get<ApiResponse<SuspendedService[]>>(
      `/schedules/suspended`
    )
    return response.data.data || []
  }

  // Get next operation across all tenants
  async getAllNextOperations(): Promise<NextOperationResponse> {
    const response = await this.client.get<ApiResponse<NextOperationResponse>>(
      `/schedules/next`
    )
    return response.data.data
  }

  // User management endpoints (admin only)
  async listUsers(): Promise<UserInfo[]> {
    const response = await this.client.get<ApiResponse<UserInfo[]>>('/users')
    return response.data.data || []
  }

  async createUser(request: CreateUserRequest): Promise<void> {
    await this.client.post<ApiResponse<void>>('/users', request)
  }

  async updateUserPassword(username: string, password: string): Promise<void> {
    await this.client.put<ApiResponse<void>>(`/users/${username}/password`, { password })
  }

  async updateUserRole(username: string, role: string): Promise<void> {
    await this.client.put<ApiResponse<void>>(`/users/${username}/role`, { role })
  }

  async deleteUser(username: string): Promise<void> {
    await this.client.delete<ApiResponse<void>>(`/users/${username}`)
  }

  // Convert timezone
  async convertTimezone(
    time: string,
    userTimezone: string,
    clusterTimezone: string
  ): Promise<TimezoneConversion> {
    const response = await this.client.post<ApiResponse<TimezoneConversion>>(
      '/timezone/convert',
      {
        time,
        userTimezone,
        clusterTimezone,
      }
    )
    return response.data.data
  }
}

export const apiClient = new ApiClient()
