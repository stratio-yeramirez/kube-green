/*
Copyright 2025.
*/

package v1

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s.io/apimachinery/pkg/api/errors"
)

// APIResponse represents a standard API response
// @Description Standard API response structure
type APIResponse struct {
	Success bool        `json:"success" example:"true"`                          // Indicates if the operation was successful
	Message string      `json:"message,omitempty" example:"Operation completed"` // Optional success message
	Data    interface{} `json:"data,omitempty"`                                  // Optional response data
	Error   string      `json:"error,omitempty"`                                 // Optional error message (if success is false)
}

// ErrorResponse represents an error response
// @Description Error response structure
type ErrorResponse struct {
	Success bool   `json:"success" example:"false"`         // Always false for error responses
	Error   string `json:"error" example:"Invalid request"` // Error message
	Code    int    `json:"code" example:"400"`              // HTTP status code
}

// handleHealth returns health status
// @Summary Health check endpoint
// @Description Returns the health status of the API server
// @Tags Health
// @Accept json
// @Produce json
// @Success 200 {object} APIResponse
// @Router /health [get]
func (s *Server) handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Message: "API server is healthy",
	})
}

// handleReady returns readiness status
// @Summary Readiness check endpoint
// @Description Returns the readiness status of the API server
// @Tags Health
// @Accept json
// @Produce json
// @Success 200 {object} APIResponse
// @Router /ready [get]
func (s *Server) handleReady(c *gin.Context) {
	// TODO: Add actual readiness checks (e.g., Kubernetes client connectivity)
	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Message: "API server is ready",
	})
}

// handleInfo returns API information
// @Summary API information endpoint
// @Description Returns information about the API
// @Tags Info
// @Accept json
// @Produce json
// @Success 200 {object} APIResponse
// @Router /api/v1/info [get]
func (s *Server) handleInfo(c *gin.Context) {
	info := map[string]interface{}{
		"version":    "1.0.0",
		"apiVersion": "v1",
		"name":       "kube-green REST API",
		"endpoints": []string{
			"GET    /api/v1/schedules",
			"GET    /api/v1/schedules/:tenant",
			"POST   /api/v1/schedules",
			"PUT    /api/v1/schedules/:tenant",
			"DELETE /api/v1/schedules/:tenant",
		},
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Data:    info,
	})
}

// handleListSchedules lists all schedules
// @Summary List all schedules
// @Description Lists all SleepInfo schedules across all namespaces
// @Tags Schedules
// @Accept json
// @Produce json
// @Success 200 {object} APIResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v1/schedules [get]
func (s *Server) handleListSchedules(c *gin.Context) {
	schedules, err := s.scheduleService.ListSchedules(c.Request.Context())
	if err != nil {
		s.logger.Error(err, "failed to list schedules")
		handleKubernetesError(c, err)
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Data:    schedules,
	})
}

// handleGetSchedule gets schedule for a specific tenant
// @Summary Get schedule for tenant
// @Description Returns all SleepInfo configurations for a specific tenant, grouped by namespace. If namespace parameter is not provided, returns all namespaces. If namespace is provided (datastores, apps, rocket, intelligence, airflowsso), returns only that namespace.
// @Tags Schedules
// @Accept json
// @Produce json
// @Param tenant path string true "Tenant name" example:"bdadevdat"
// @Param namespace query string false "Namespace suffix filter (datastores, apps, rocket, intelligence, airflowsso). Leave empty to get all namespaces" example:"datastores"
// @Success 200 {object} APIResponse{data=ScheduleResponse} "Schedule information with improved structure"
// @Failure 400 {object} ErrorResponse "Invalid request parameters"
// @Failure 404 {object} ErrorResponse "Schedule not found"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/v1/schedules/{tenant} [get]
func (s *Server) handleGetSchedule(c *gin.Context) {
	tenant := c.Param("tenant")
	if tenant == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "tenant parameter is required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	// Get optional namespace filter from query parameter
	namespaceFilter := c.Query("namespace")

	// Validate namespace if provided
	if namespaceFilter != "" {
		valid := false
		for _, validNS := range validSuffixes {
			if namespaceFilter == validNS {
				valid = true
				break
			}
		}
		if !valid {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Success: false,
				Error:   fmt.Sprintf("invalid namespace '%s'. Valid options are: %s", namespaceFilter, ValidNamespaceSuffixes),
				Code:    http.StatusBadRequest,
			})
			return
		}
	}

	schedule, err := s.scheduleService.GetSchedule(c.Request.Context(), tenant, namespaceFilter)
	if err != nil {
		if strings.Contains(err.Error(), "no schedules found") {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Success: false,
				Error:   err.Error(),
				Code:    http.StatusNotFound,
			})
			return
		}
		s.logger.Error(err, "failed to get schedule", "tenant", tenant, "namespace", namespaceFilter)
		handleKubernetesError(c, err)
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Data:    schedule,
	})
}

// DelayConfig represents configurable delays for each resource type
type DelayConfig struct {
	SuspendDeployments          string `json:"suspendDeployments,omitempty" example:"5m"`          // Delay for deployments (e.g., "5m", "0m")
	SuspendStatefulSets         string `json:"suspendStatefulSets,omitempty" example:"7m"`         // Delay for statefulsets (e.g., "7m")
	SuspendCronJobs             string `json:"suspendCronJobs,omitempty" example:"0m"`             // Delay for cronjobs (e.g., "0m")
	SuspendDeploymentsPgbouncer string `json:"suspendDeploymentsPgbouncer,omitempty" example:"5m"` // Delay for pgbouncer deployments
	SuspendStatefulSetsPostgres string `json:"suspendStatefulSetsPostgres,omitempty" example:"0m"` // Delay for postgres statefulsets
	SuspendStatefulSetsHdfs     string `json:"suspendStatefulSetsHdfs,omitempty" example:"0m"`     // Delay for hdfs statefulsets
}

// WakeDelayConfig represents configurable delays for staggered wake-up (time AFTER base wake time)
type WakeDelayConfig struct {
	PgHdfsDelay      string `json:"pgHdfsDelay,omitempty" example:"0m"`      // Delay for PgCluster + HDFSCluster (default: "0m" = t0)
	PgbouncerDelay   string `json:"pgbouncerDelay,omitempty" example:"5m"`   // Delay for PgBouncer (default: "5m" = t0+5m)
	DeploymentsDelay string `json:"deploymentsDelay,omitempty" example:"7m"` // Delay for Deployments nativos (default: "7m" = t0+7m)
}

// ExclusionFilter represents a filter for excluding resources
type ExclusionFilter struct {
	MatchLabels map[string]string `json:"matchLabels" example:"app.kubernetes.io/managed-by:postgres-operator"`
}

// Exclusion represents a resource exclusion configuration
type Exclusion struct {
	Namespace string          `json:"namespace" example:"bdadevdat-datastores"`
	Filter    ExclusionFilter `json:"filter"`
}

// CreateScheduleRequest represents a request to create a schedule
// @Description Request to create a new sleep/wake schedule for a tenant
type CreateScheduleRequest struct {
	Tenant          string       `json:"tenant" binding:"required" example:"bdadevdat"`   // Tenant name (e.g., bdadevdat, bdadevprd)
	UserTimezone    string       `json:"userTimezone,omitempty" example:"America/Bogota"` // User timezone (default: America/Bogota)
	ClusterTimezone string       `json:"clusterTimezone,omitempty" example:"UTC"`         // Cluster timezone (default: UTC)
	Off             string       `json:"off" binding:"required" example:"22:00"`          // Sleep time in user timezone (HH:MM format, 24-hour)
	On              string       `json:"on" binding:"required" example:"06:00"`           // Wake time in user timezone (HH:MM format, 24-hour)
	Weekdays        string       `json:"weekdays,omitempty" example:"lunes-viernes"`      // Days of week (human format: "lunes-viernes", or numeric: "1-5")
	SleepDays       string       `json:"sleepDays,omitempty" example:"viernes"`           // Optional: specific days for sleep (overrides weekdays)
	WakeDays        string       `json:"wakeDays,omitempty" example:"lunes"`              // Optional: specific days for wake (overrides weekdays)
	Namespaces      []string     `json:"namespaces,omitempty" example:"datastores,apps"`  // Optional: limit to specific namespaces (datastores, apps, rocket, intelligence, airflowsso)
	Delays          *DelayConfig `json:"delays,omitempty"`                                // Optional: configurable delays for each resource type
	Exclusions      []Exclusion  `json:"exclusions,omitempty"`                            // Optional: resource exclusions by annotations/labels
	Apply           bool         `json:"apply,omitempty"`                                 // Always applies to cluster (field is ignored but kept for compatibility)
}

// NamespaceScheduleRequest represents a request to create/update a schedule for a single namespace
// @Description Request to create or update a sleep/wake schedule for a specific namespace
type NamespaceScheduleRequest struct {
	Tenant          string           `json:"tenant" binding:"required" example:"bdadevdat"`   // Tenant name
	Namespace       string           `json:"namespace" binding:"required" example:"datastores"` // Namespace suffix (datastores, apps, etc.)
	UserTimezone    string           `json:"userTimezone,omitempty" example:"America/Bogota"`  // User timezone (default: America/Bogota)
	ClusterTimezone string           `json:"clusterTimezone,omitempty" example:"UTC"`         // Cluster timezone (default: UTC)
	Off             string           `json:"off" binding:"required" example:"21:30"`           // Sleep time in user timezone (HH:MM format)
	On              string           `json:"on" binding:"required" example:"06:00"`            // Wake time in user timezone (HH:MM format)
	WeekdaysSleep   string           `json:"weekdaysSleep" example:"6"`                        // Days for sleep (format: "0-6" or "lunes-viernes")
	WeekdaysWake    string           `json:"weekdaysWake" example:"0"`                          // Days for wake (format: "0-6" or "lunes-viernes")
	Delays          *WakeDelayConfig `json:"delays,omitempty"`                                 // Optional: configurable delays for staggered wake-up
	Exclusions      []Exclusion      `json:"exclusions,omitempty"`                              // Optional: resource exclusions by labels
}

// handleCreateSchedule creates a new schedule
// @Summary Create a new schedule
// @Description Creates SleepInfo configurations for a tenant. Automatically converts local time (America/Bogota) to UTC and handles timezone day shifts. Creates schedules for all namespaces (datastores, apps, rocket, intelligence, airflowsso) unless filtered.
// @Tags Schedules
// @Accept json
// @Produce json
// @Param request body CreateScheduleRequest true "Schedule configuration"
// @Success 201 {object} APIResponse "Schedule created successfully"
// @Failure 400 {object} ErrorResponse "Invalid request parameters"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/v1/schedules [post]
func (s *Server) handleCreateSchedule(c *gin.Context) {
	var req CreateScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   err.Error(),
			Code:    http.StatusBadRequest,
		})
		return
	}

	// Validate request
	if err := ValidateCreateSchedule(req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   err.Error(),
			Code:    http.StatusBadRequest,
		})
		return
	}

	// Create schedule using service
	serviceReq := CreateScheduleRequest{
		Tenant:     req.Tenant,
		Off:        req.Off,
		On:         req.On,
		Weekdays:   req.Weekdays,
		SleepDays:  req.SleepDays,
		WakeDays:   req.WakeDays,
		Namespaces: req.Namespaces,
	}

	if err := s.scheduleService.CreateSchedule(c.Request.Context(), serviceReq); err != nil {
		s.logger.Error(err, "failed to create schedule", "tenant", req.Tenant)
		c.JSON(http.StatusInternalServerError, ErrorResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to create schedule: %v", err),
			Code:    http.StatusInternalServerError,
		})
		return
	}

	c.JSON(http.StatusCreated, APIResponse{
		Success: true,
		Message: fmt.Sprintf("Schedule created successfully for tenant %s", req.Tenant),
	})
}

// UpdateScheduleRequest represents a request to update a schedule
// @Description Request to update an existing sleep/wake schedule for a tenant (all fields optional)
type UpdateScheduleRequest struct {
	Off        string   `json:"off,omitempty" example:"23:00"`         // Sleep time in local timezone (HH:MM format, 24-hour)
	On         string   `json:"on,omitempty" example:"07:00"`          // Wake time in local timezone (HH:MM format, 24-hour)
	Weekdays   string   `json:"weekdays,omitempty" example:"1-5"`      // Days of week (human format: "lunes-viernes", or numeric: "1-5")
	SleepDays  string   `json:"sleepDays,omitempty" example:"viernes"` // Optional: specific days for sleep (overrides weekdays)
	WakeDays   string   `json:"wakeDays,omitempty" example:"lunes"`    // Optional: specific days for wake (overrides weekdays)
	Namespaces []string `json:"namespaces,omitempty" example:"apps"`   // Optional: limit to specific namespaces
	Apply      bool     `json:"apply,omitempty"`                       // Always applies to cluster (field is ignored)
}

// handleUpdateSchedule updates an existing schedule
// @Summary Update a schedule
// @Description Updates SleepInfo configurations for a tenant. If namespace parameter is not provided, updates all namespaces. If namespace is provided (datastores, apps, rocket, intelligence, airflowsso), updates only that namespace. Missing fields are extracted from existing schedule. At least 'off' or 'on' time must be provided.
// @Tags Schedules
// @Accept json
// @Produce json
// @Param tenant path string true "Tenant name" example:"bdadevdat"
// @Param namespace query string false "Namespace suffix filter (datastores, apps, rocket, intelligence, airflowsso). Leave empty to update all namespaces" example:"datastores"
// @Param request body UpdateScheduleRequest true "Schedule configuration (all fields optional)"
// @Success 200 {object} APIResponse "Schedule updated successfully"
// @Failure 400 {object} ErrorResponse "Invalid request parameters"
// @Failure 404 {object} ErrorResponse "Schedule not found"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/v1/schedules/{tenant} [put]
func (s *Server) handleUpdateSchedule(c *gin.Context) {
	tenant := c.Param("tenant")
	if tenant == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "tenant parameter is required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	// Get optional namespace filter from query parameter
	namespaceFilter := c.Query("namespace")

	// Validate namespace if provided
	if namespaceFilter != "" {
		valid := false
		for _, validNS := range validSuffixes {
			if namespaceFilter == validNS {
				valid = true
				break
			}
		}
		if !valid {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Success: false,
				Error:   fmt.Sprintf("invalid namespace '%s'. Valid options are: %s", namespaceFilter, ValidNamespaceSuffixes),
				Code:    http.StatusBadRequest,
			})
			return
		}
	}

	var req UpdateScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   err.Error(),
			Code:    http.StatusBadRequest,
		})
		return
	}

	// Validate request
	if err := ValidateUpdateSchedule(req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   err.Error(),
			Code:    http.StatusBadRequest,
		})
		return
	}

	// Convert UpdateScheduleRequest to CreateScheduleRequest
	createReq := CreateScheduleRequest{
		Tenant:     tenant,
		Off:        req.Off,
		On:         req.On,
		Weekdays:   req.Weekdays,
		SleepDays:  req.SleepDays,
		WakeDays:   req.WakeDays,
		Namespaces: req.Namespaces,
	}

	// If namespace filter is provided, override namespaces in request
	if namespaceFilter != "" {
		createReq.Namespaces = []string{namespaceFilter}
	}

	// Verify schedule exists before updating
	_, err := s.scheduleService.GetSchedule(c.Request.Context(), tenant, namespaceFilter)
	if err != nil {
		if strings.Contains(err.Error(), "no schedules found") {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Success: false,
				Error:   fmt.Sprintf("schedule not found for tenant: %s", tenant),
				Code:    http.StatusNotFound,
			})
			return
		}
		s.logger.Error(err, "failed to get existing schedule", "tenant", tenant, "namespace", namespaceFilter)
		handleKubernetesError(c, err)
		return
	}

	// Validate that at least off and on are provided (required for timezone conversion)
	if createReq.Off == "" && createReq.On == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "at least 'off' or 'on' time must be provided for update",
			Code:    http.StatusBadRequest,
		})
		return
	}

	// Update schedule
	if err := s.scheduleService.UpdateSchedule(c.Request.Context(), tenant, createReq, namespaceFilter); err != nil {
		s.logger.Error(err, "failed to update schedule", "tenant", tenant, "namespace", namespaceFilter)
		handleKubernetesError(c, err)
		return
	}

	message := fmt.Sprintf("Schedule updated successfully for tenant %s", tenant)
	if namespaceFilter != "" {
		message = fmt.Sprintf("Schedule updated successfully for tenant %s in namespace %s", tenant, namespaceFilter)
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Message: message,
	})
}

// handleDeleteSchedule deletes a schedule
// @Summary Delete a schedule
// @Description Deletes SleepInfo configurations and associated secrets for a tenant. If namespace parameter is not provided, deletes all namespaces. If namespace is provided (datastores, apps, rocket, intelligence, airflowsso), deletes only that namespace.
// @Tags Schedules
// @Accept json
// @Produce json
// @Param tenant path string true "Tenant name" example:"bdadevdat"
// @Param namespace query string false "Namespace suffix filter (datastores, apps, rocket, intelligence, airflowsso). Leave empty to delete all namespaces" example:"datastores"
// @Success 200 {object} APIResponse "Schedule deleted successfully"
// @Failure 400 {object} ErrorResponse "Invalid request parameters"
// @Failure 404 {object} ErrorResponse "Schedule not found"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/v1/schedules/{tenant} [delete]
func (s *Server) handleDeleteSchedule(c *gin.Context) {
	tenant := c.Param("tenant")
	if tenant == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "tenant parameter is required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	// Get optional namespace filter from query parameter
	namespaceFilter := c.Query("namespace")

	// Validate namespace if provided
	if namespaceFilter != "" {
		valid := false
		for _, validNS := range validSuffixes {
			if namespaceFilter == validNS {
				valid = true
				break
			}
		}
		if !valid {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Success: false,
				Error:   fmt.Sprintf("invalid namespace '%s'. Valid options are: %s", namespaceFilter, ValidNamespaceSuffixes),
				Code:    http.StatusBadRequest,
			})
			return
		}
	}

	if err := s.scheduleService.DeleteSchedule(c.Request.Context(), tenant, namespaceFilter); err != nil {
		if strings.Contains(err.Error(), "no schedules found") {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Success: false,
				Error:   err.Error(),
				Code:    http.StatusNotFound,
			})
			return
		}
		s.logger.Error(err, "failed to delete schedule", "tenant", tenant, "namespace", namespaceFilter)
		handleKubernetesError(c, err)
		return
	}

	message := fmt.Sprintf("Schedule deleted successfully for tenant %s", tenant)
	if namespaceFilter != "" {
		message = fmt.Sprintf("Schedule deleted successfully for tenant %s in namespace %s", tenant, namespaceFilter)
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Message: message,
	})
}

// handleKubernetesError converts Kubernetes API errors to HTTP responses
// handleListTenants lists all discovered tenants
// @Summary List all tenants
// @Description Discovers all tenants by scanning namespaces that follow the pattern {tenant}-{suffix}
// @Tags Tenants
// @Accept json
// @Produce json
// @Success 200 {object} APIResponse{data=TenantListResponse}
// @Failure 500 {object} ErrorResponse
// @Router /api/v1/tenants [get]
func (s *Server) handleListTenants(c *gin.Context) {
	tenants, err := s.scheduleService.ListTenants(c.Request.Context())
	if err != nil {
		s.logger.Error(err, "failed to list tenants")
		handleKubernetesError(c, err)
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Data:    tenants,
	})
}

// handleGetNamespaceServices lists services in a namespace
// @Summary List services in namespace
// @Description Lists all services (Deployments, StatefulSets, CronJobs) in a tenant namespace with their annotations
// @Tags Services
// @Accept json
// @Produce json
// @Param tenant path string true "Tenant name" example:"bdadevdat"
// @Param namespace query string true "Namespace suffix (datastores, apps, rocket, intelligence, airflowsso)" example:"datastores"
// @Success 200 {object} APIResponse{data=NamespaceServicesResponse}
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v1/namespaces/{tenant}/services [get]
func (s *Server) handleGetNamespaceServices(c *gin.Context) {
	tenant := c.Param("tenant")
	namespace := c.Query("namespace")

	if tenant == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "tenant parameter is required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	if namespace == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "namespace query parameter is required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	services, err := s.scheduleService.GetNamespaceServices(c.Request.Context(), tenant, namespace)
	if err != nil {
		s.logger.Error(err, "failed to get namespace services", "tenant", tenant, "namespace", namespace)
		handleKubernetesError(c, err)
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Data:    services,
	})
}

// handleGetNamespaceResources detects CRDs and resources in a namespace
// @Summary Get namespace resources
// @Description Detects CRDs (PgCluster, HDFSCluster, PgBouncer) and other resources in a namespace
// @Tags Resources
// @Accept json
// @Produce json
// @Param tenant path string true "Tenant name" example:"bdadevdat"
// @Param namespace query string true "Namespace suffix (datastores, apps, rocket, intelligence, airflowsso)" example:"datastores"
// @Success 200 {object} APIResponse{data=NamespaceResourceInfo}
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v1/namespaces/{tenant}/resources [get]
func (s *Server) handleGetNamespaceResources(c *gin.Context) {
	tenant := c.Param("tenant")
	namespace := c.Query("namespace")

	if tenant == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "tenant parameter is required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	if namespace == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "namespace query parameter is required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	resources, err := s.scheduleService.GetNamespaceResources(c.Request.Context(), tenant, namespace)
	if err != nil {
		s.logger.Error(err, "failed to get namespace resources", "tenant", tenant, "namespace", namespace)
		handleKubernetesError(c, err)
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Data:    resources,
	})
}

// handleGetSuspendedServices lists suspended services for a tenant
// @Summary List suspended services
// @Description Lists currently suspended services for a tenant
// @Tags Schedules
// @Accept json
// @Produce json
// @Param tenant path string true "Tenant name" example:"bdadevdat"
// @Success 200 {object} APIResponse{data=SuspendedServicesResponse}
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v1/schedules/{tenant}/suspended [get]
func (s *Server) handleGetSuspendedServices(c *gin.Context) {
	tenant := c.Param("tenant")
	if tenant == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "tenant parameter is required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	suspended, err := s.scheduleService.GetSuspendedServices(c.Request.Context(), tenant)
	if err != nil {
		if strings.Contains(err.Error(), "no schedules found") {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Success: false,
				Error:   err.Error(),
				Code:    http.StatusNotFound,
			})
			return
		}
		s.logger.Error(err, "failed to get suspended services", "tenant", tenant)
		handleKubernetesError(c, err)
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Data:    suspended,
	})
}

// handleGetNamespaceSchedule gets schedule for a specific namespace
// @Summary Get namespace schedule
// @Description Gets SleepInfo configurations for a specific namespace
// @Tags Schedules
// @Accept json
// @Produce json
// @Param tenant path string true "Tenant name" example:"bdadevdat"
// @Param namespace path string true "Namespace suffix" example:"datastores"
// @Success 200 {object} APIResponse "Schedule retrieved successfully"
// @Failure 404 {object} ErrorResponse "Schedule not found"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/v1/schedules/{tenant}/{namespace} [get]
func (s *Server) handleGetNamespaceSchedule(c *gin.Context) {
	tenant := c.Param("tenant")
	namespace := c.Param("namespace")

	if tenant == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "tenant parameter is required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	if namespace == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "namespace parameter is required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	schedule, err := s.scheduleService.GetNamespaceSchedule(c.Request.Context(), tenant, namespace)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Success: false,
				Error:   err.Error(),
				Code:    http.StatusNotFound,
			})
			return
		}
		s.logger.Error(err, "failed to get namespace schedule", "tenant", tenant, "namespace", namespace)
		handleKubernetesError(c, err)
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Data:    schedule,
	})
}

// handleCreateNamespaceSchedule creates a schedule for a specific namespace
// @Summary Create namespace schedule
// @Description Creates SleepInfo configurations for a specific namespace using dynamic resource detection
// @Tags Schedules
// @Accept json
// @Produce json
// @Param tenant path string true "Tenant name" example:"bdadevdat"
// @Param namespace path string true "Namespace suffix" example:"datastores"
// @Param request body NamespaceScheduleRequest true "Schedule configuration"
// @Success 201 {object} APIResponse "Schedule created successfully"
// @Failure 400 {object} ErrorResponse "Invalid request parameters"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/v1/schedules/{tenant}/{namespace} [post]
func (s *Server) handleCreateNamespaceSchedule(c *gin.Context) {
	tenant := c.Param("tenant")
	namespace := c.Param("namespace")

	if tenant == "" || namespace == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "tenant and namespace parameters are required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	var req NamespaceScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   err.Error(),
			Code:    http.StatusBadRequest,
		})
		return
	}

	// Override tenant and namespace from path (more secure)
	req.Tenant = tenant
	req.Namespace = namespace

	if err := s.scheduleService.CreateNamespaceSchedule(c.Request.Context(), req); err != nil {
		s.logger.Error(err, "failed to create namespace schedule", "tenant", tenant, "namespace", namespace)
		handleKubernetesError(c, err)
		return
	}

	c.JSON(http.StatusCreated, APIResponse{
		Success: true,
		Message: fmt.Sprintf("Schedule created successfully for namespace %s-%s", tenant, namespace),
	})
}

// handleUpdateNamespaceSchedule updates a schedule for a specific namespace
// @Summary Update namespace schedule
// @Description Updates SleepInfo configurations for a specific namespace
// @Tags Schedules
// @Accept json
// @Produce json
// @Param tenant path string true "Tenant name" example:"bdadevdat"
// @Param namespace path string true "Namespace suffix" example:"datastores"
// @Param request body NamespaceScheduleRequest true "Schedule configuration"
// @Success 200 {object} APIResponse "Schedule updated successfully"
// @Failure 400 {object} ErrorResponse "Invalid request parameters"
// @Failure 404 {object} ErrorResponse "Schedule not found"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/v1/schedules/{tenant}/{namespace} [put]
func (s *Server) handleUpdateNamespaceSchedule(c *gin.Context) {
	tenant := c.Param("tenant")
	namespace := c.Param("namespace")

	if tenant == "" || namespace == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "tenant and namespace parameters are required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	var req NamespaceScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   err.Error(),
			Code:    http.StatusBadRequest,
		})
		return
	}

	// Override tenant and namespace from path (more secure)
	req.Tenant = tenant
	req.Namespace = namespace

	if err := s.scheduleService.UpdateNamespaceSchedule(c.Request.Context(), req); err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Success: false,
				Error:   err.Error(),
				Code:    http.StatusNotFound,
			})
			return
		}
		s.logger.Error(err, "failed to update namespace schedule", "tenant", tenant, "namespace", namespace)
		handleKubernetesError(c, err)
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Message: fmt.Sprintf("Schedule updated successfully for namespace %s-%s", tenant, namespace),
	})
}

// handleDeleteNamespaceSchedule deletes a schedule for a specific namespace
// @Summary Delete namespace schedule
// @Description Deletes all SleepInfo configurations for a specific namespace
// @Tags Schedules
// @Accept json
// @Produce json
// @Param tenant path string true "Tenant name" example:"bdadevdat"
// @Param namespace path string true "Namespace suffix" example:"datastores"
// @Success 200 {object} APIResponse "Schedule deleted successfully"
// @Failure 404 {object} ErrorResponse "Schedule not found"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/v1/schedules/{tenant}/{namespace} [delete]
func (s *Server) handleDeleteNamespaceSchedule(c *gin.Context) {
	tenant := c.Param("tenant")
	namespace := c.Param("namespace")

	if tenant == "" || namespace == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Success: false,
			Error:   "tenant and namespace parameters are required",
			Code:    http.StatusBadRequest,
		})
		return
	}

	if err := s.scheduleService.DeleteNamespaceSchedule(c.Request.Context(), tenant, namespace); err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Success: false,
				Error:   err.Error(),
				Code:    http.StatusNotFound,
			})
			return
		}
		s.logger.Error(err, "failed to delete namespace schedule", "tenant", tenant, "namespace", namespace)
		handleKubernetesError(c, err)
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Message: fmt.Sprintf("Schedule deleted successfully for namespace %s-%s", tenant, namespace),
	})
}

func handleKubernetesError(c *gin.Context, err error) {
	if errors.IsNotFound(err) {
		c.JSON(http.StatusNotFound, ErrorResponse{
			Success: false,
			Error:   err.Error(),
			Code:    http.StatusNotFound,
		})
		return
	}

	if errors.IsConflict(err) {
		c.JSON(http.StatusConflict, ErrorResponse{
			Success: false,
			Error:   err.Error(),
			Code:    http.StatusConflict,
		})
		return
	}

	// Generic error
	c.JSON(http.StatusInternalServerError, ErrorResponse{
		Success: false,
		Error:   err.Error(),
		Code:    http.StatusInternalServerError,
	})
}
