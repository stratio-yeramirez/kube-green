import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import type { 
  Tenant, 
  Schedule, 
  CreateScheduleRequest, 
  SuspendedServicesResponse, 
  ApiResponse,
  NamespaceResourceInfo,
  NamespaceScheduleRequest,
  NamespaceScheduleResponse,
} from '@/types'

// Query keys
export const queryKeys = {
  tenants: ['tenants'] as const,
  tenant: (name: string) => ['tenant', name] as const,
  schedules: (tenant: string, namespace?: string) =>
    ['schedules', tenant, namespace] as const,
  namespaceSchedule: (tenant: string, namespace: string) =>
    ['namespaceSchedule', tenant, namespace] as const,
  services: (tenant: string, namespace: string) =>
    ['services', tenant, namespace] as const,
  resources: (tenant: string, namespace: string) =>
    ['resources', tenant, namespace] as const,
  suspended: (tenant: string) => ['suspended', tenant] as const,
  allSchedules: ['allSchedules'] as const,
}

// Hook: Get all schedules (for filtering tenants with active schedules)
export function useAllSchedules() {
  return useQuery({
    queryKey: queryKeys.allSchedules,
    queryFn: () => apiClient.getAllSchedules(),
    staleTime: 30000, // 30 seconds
  })
}

// Hook: Get all tenants
export function useTenants() {
  return useQuery({
    queryKey: queryKeys.tenants,
    queryFn: () => apiClient.getTenants(),
    staleTime: 60000, // 1 minute
  })
}

// Hook: Get schedules for tenant
export function useSchedules(tenant: string, namespace?: string) {
  return useQuery({
    queryKey: queryKeys.schedules(tenant, namespace),
    queryFn: () => apiClient.getSchedules(tenant, namespace),
    enabled: !!tenant,
    staleTime: 30000, // 30 seconds
  })
}

// Hook: Get namespace services
export function useNamespaceServices(tenant: string, namespace: string) {
  return useQuery({
    queryKey: queryKeys.services(tenant, namespace),
    queryFn: () => apiClient.getNamespaceServices(tenant, namespace),
    enabled: !!tenant && !!namespace,
    staleTime: 60000, // 1 minute
  })
}

// Hook: Get namespace resources (CRDs detection)
export function useNamespaceResources(tenant: string, namespace: string) {
  return useQuery({
    queryKey: queryKeys.resources(tenant, namespace),
    queryFn: () => apiClient.getNamespaceResources(tenant, namespace),
    enabled: !!tenant && !!namespace,
    staleTime: 60000, // 1 minute - resources don't change frequently
  })
}

// Hook: Get namespace schedule
export function useNamespaceSchedule(tenant: string, namespace: string) {
  return useQuery({
    queryKey: queryKeys.namespaceSchedule(tenant, namespace),
    queryFn: () => apiClient.getNamespaceSchedule(tenant, namespace),
    enabled: !!tenant && !!namespace,
    staleTime: 30000, // 30 seconds
  })
}

// Hook: Get suspended services
export function useSuspendedServices(tenant: string) {
  return useQuery({
    queryKey: queryKeys.suspended(tenant),
    queryFn: () => apiClient.getSuspendedServices(tenant),
    enabled: !!tenant,
    refetchInterval: 30000, // Refresh every 30 seconds
  })
}

// Hook: Create schedule
export function useCreateSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: CreateScheduleRequest) => apiClient.createSchedule(request),
    onSuccess: (_, variables) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants })
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules(variables.tenant) })
    },
  })
}

// Hook: Update schedule
export function useUpdateSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ tenant, request }: { tenant: string; request: CreateScheduleRequest }) =>
      apiClient.updateSchedule(tenant, request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules(variables.tenant) })
    },
  })
}

// Hook: Delete schedule
export function useDeleteSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ tenant, namespace }: { tenant: string; namespace?: string }) =>
      apiClient.deleteSchedule(tenant, namespace),
    onSuccess: (_, variables) => {
      // Invalidate all relevant queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants })
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules(variables.tenant) })
      queryClient.invalidateQueries({ queryKey: queryKeys.allSchedules })
    },
  })
}

// Hook: Create namespace schedule
export function useCreateNamespaceSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: NamespaceScheduleRequest) => apiClient.createNamespaceSchedule(request),
    onSuccess: (_, variables) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants })
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules(variables.tenant) })
      queryClient.invalidateQueries({ queryKey: queryKeys.namespaceSchedule(variables.tenant, variables.namespace) })
      queryClient.invalidateQueries({ queryKey: queryKeys.allSchedules })
    },
  })
}

// Hook: Update namespace schedule
export function useUpdateNamespaceSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: NamespaceScheduleRequest) => apiClient.updateNamespaceSchedule(request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules(variables.tenant) })
      queryClient.invalidateQueries({ queryKey: queryKeys.namespaceSchedule(variables.tenant, variables.namespace) })
      queryClient.invalidateQueries({ queryKey: queryKeys.allSchedules })
    },
  })
}

// Hook: Delete namespace schedule
export function useDeleteNamespaceSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ tenant, namespace }: { tenant: string; namespace: string }) =>
      apiClient.deleteNamespaceSchedule(tenant, namespace),
    onSuccess: (_, variables) => {
      // Invalidate all relevant queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants })
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules(variables.tenant) })
      queryClient.invalidateQueries({ queryKey: queryKeys.namespaceSchedule(variables.tenant, variables.namespace) })
      queryClient.invalidateQueries({ queryKey: queryKeys.allSchedules })
    },
  })
}

