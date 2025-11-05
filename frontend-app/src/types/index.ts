// API Response Types
export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

// Tenant Types
export interface Tenant {
  name: string
  namespaces: string[]
  createdAt?: string
}

export interface TenantListResponse {
  tenants: Tenant[]
}

// Namespace Types
export interface NamespaceInfo {
  namespace: string
  services: Service[]
}

export interface Service {
  name: string
  kind: string
  annotations: Record<string, string>
  labels: Record<string, string>
  replicas?: number
  readyReplicas?: number
  status?: 'Running' | 'Suspended' | 'Pending'
}

// Schedule Types
export interface CreateScheduleRequest {
  tenant: string
  userTimezone: string
  clusterTimezone: string
  off: string // HH:MM format
  on: string // HH:MM format
  weekdays: string
  wakeDays?: string
  namespaces: string[]
  delays?: DelayConfig
  exclusions?: Exclusion[]
}

export interface DelayConfig {
  suspendDeployments?: string // e.g., "5m", "0m"
  suspendStatefulSets?: string
  suspendCronJobs?: string
  suspendDeploymentsPgbouncer?: string
  suspendStatefulSetsPostgres?: string
  suspendStatefulSetsHdfs?: string
}

// WakeDelayConfig represents configurable delays for staggered wake-up (time AFTER base wake time)
export interface WakeDelayConfig {
  pgHdfsDelay?: string      // Delay for PgCluster + HDFSCluster (default: "0m")
  pgbouncerDelay?: string   // Delay for PgBouncer (default: "5m")
  deploymentsDelay?: string // Delay for Deployments nativos (default: "7m")
}

export interface Exclusion {
  namespace: string
  filter: {
    matchLabels: Record<string, string>
  }
}

// Namespace Resource Detection Types
export interface NamespaceResourceInfo {
  namespace: string
  hasPgCluster: boolean
  hasHdfsCluster: boolean
  hasPgBouncer: boolean
  hasVirtualizer: boolean
  resourceCounts: ResourceCounts
  autoExclusions: ExclusionFilter[]
}

export interface ResourceCounts {
  deployments: number
  statefulSets: number
  cronJobs: number
  pgClusters: number
  hdfsClusters: number
  pgBouncers: number
}

export interface ExclusionFilter {
  matchLabels: Record<string, string>
}

// Namespace Schedule Types
export interface NamespaceScheduleRequest {
  tenant: string
  namespace: string  // solo el suffix: "datastores", "apps", etc.
  userTimezone: string
  clusterTimezone: string
  off: string
  on: string
  weekdaysSleep: string
  weekdaysWake: string
  delays?: WakeDelayConfig
  exclusions?: Exclusion[]
}

export interface SleepInfoDetail {
  name: string
  namespace: string
  weekdays: string
  sleepAt?: string
  wakeUpAt?: string
  timeZone: string
  role?: string // "sleep" or "wake" from annotations
  suspendDeployments: boolean
  suspendStatefulSets: boolean
  suspendCronJobs: boolean
  suspendDeploymentsPgbouncer?: boolean
  suspendStatefulSetsPostgres?: boolean
  suspendStatefulSetsHdfs?: boolean
  excludeRef?: ExclusionFilter[]
  annotations?: Record<string, string>
}

export interface NamespaceScheduleResponse {
  tenant: string
  namespace: string
  sleepInfos: SleepInfoDetail[]
}

export interface Schedule {
  tenant: string
  namespaces: Record<string, ScheduleSummary[]>
}

export interface ScheduleSummary {
  name: string
  namespace: string
  weekdays: string
  sleepTime?: string
  wakeTime?: string
  timeZone: string
  role?: string
  operation?: string
  resources?: string[]
  annotations?: Record<string, string>
  // Campos alternativos que pueden venir del API
  Weekdays?: string
  Time?: string
  WakeTime?: string
  TimeZone?: string
  Role?: string
}

// Suspended Services Types
export interface SuspendedService {
  name: string
  namespace: string
  kind: string
  suspendedAt: string
  reason: string
  willWakeAt?: string
}

export interface SuspendedServicesResponse {
  tenant: string
  suspended: SuspendedService[]
}

// Timezone Types
export interface TimezoneConversion {
  userTime: string
  userTimezone: string
  clusterTime: string
  clusterTimezone: string
  dayShift: number // -1, 0, or +1
}

// UI State Types
export interface AppState {
  selectedTenant: string | null
  selectedNamespaces: string[]
  userTimezone: string
  clusterTimezone: string
}

export type Weekday = '0' | '1' | '2' | '3' | '4' | '5' | '6'

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  '0': 'Domingo',
  '1': 'Lunes',
  '2': 'Martes',
  '3': 'Miércoles',
  '4': 'Jueves',
  '5': 'Viernes',
  '6': 'Sábado',
}

