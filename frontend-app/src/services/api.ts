import axios, { AxiosInstance } from 'axios'
import type {
  ApiResponse,
  TenantListResponse,
  NamespaceInfo,
  CreateScheduleRequest,
  Schedule,
  SuspendedServicesResponse,
  TimezoneConversion,
  NamespaceResourceInfo,
  NamespaceScheduleRequest,
  NamespaceScheduleResponse,
} from '@/types'

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

    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // Add auth headers if needed
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
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
  async deleteSchedule(tenant: string, namespace?: string): Promise<void> {
    const url = namespace
      ? `/schedules/${tenant}?namespace=${namespace}`
      : `/schedules/${tenant}`
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

