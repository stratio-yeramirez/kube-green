# REST API Implementation - Summary

## 📋 Overview

This document summarizes the implementation of the REST API for kube-green, providing programmatic access to SleepInfo management functionality.

## ✅ Completed Features

### 1. HTTP Server Implementation
- ✅ Separate HTTP server in the same pod (Option A)
- ✅ Integrated with controller-runtime Manager
- ✅ Configurable via command-line flags
- ✅ CORS support (optional)

### 2. Core Endpoints
- ✅ `GET /health` - Health check
- ✅ `GET /ready` - Readiness check  
- ✅ `GET /api/v1/info` - API information
- ✅ `GET /api/v1/schedules` - List all schedules
- ✅ `GET /api/v1/schedules/:tenant` - Get tenant schedule
- ✅ `POST /api/v1/schedules` - Create schedule
- ✅ `PUT /api/v1/schedules/:tenant` - Update schedule
- ✅ `DELETE /api/v1/schedules/:tenant` - Delete schedule

### 3. Business Logic
- ✅ Timezone conversion (America/Bogota → UTC)
- ✅ Day shift calculation for timezone changes
- ✅ Weekday parsing (human format: "lunes-viernes" → numeric: "1-5")
- ✅ Staggered wake-up for datastores namespace
- ✅ Support for all namespace types (datastores, apps, rocket, intelligence, airflowsso)

### 4. Improvements
- ✅ Automatic secret cleanup when deleting SleepInfos
- ✅ Partial update support (extracts missing fields from existing schedule)
- ✅ Comprehensive input validation
- ✅ Better error handling with appropriate HTTP status codes

### 5. Documentation
- ✅ Swagger/OpenAPI documentation
- ✅ Interactive Swagger UI at `/swagger`
- ✅ API usage guide (`API_USAGE.md`)
- ✅ Package documentation (`README.md`)

## 📁 Files Created

```
internal/api/v1/
├── doc.go              # Swagger configuration
├── server.go           # HTTP server setup and routing
├── handlers.go         # REST endpoint handlers
├── schedule_service.go # Business logic for schedules
├── timezone.go         # Timezone conversion utilities
├── weekdays.go         # Weekday parsing utilities
├── validation.go     # Input validation
├── docs/              # Generated Swagger docs (gitignored)
│   ├── docs.go
│   ├── swagger.json
│   └── swagger.yaml
├── README.md          # Package documentation
└── API_USAGE.md       # Usage guide

cmd/main.go            # Modified to include API server
Makefile.swagger       # Swagger generation targets
```

## 🚀 Usage

### Start the API Server

```bash
./cmd/main.go --enable-api --api-port 8080
```

### Generate Swagger Docs

```bash
make swagger
```

### Access Swagger UI

Once the server is running:
```
http://localhost:8080/swagger/index.html
```

## 🔧 Configuration

### Command-Line Flags

- `--enable-api`: Enable REST API server (default: false)
- `--api-port`: Port for REST API (default: 8080)
- `--enable-api-cors`: Enable CORS for API (default: false)

### Example Deployment

The API server runs alongside the controller in the same pod. When deployed:

```yaml
containers:
- name: manager
  args:
  - --enable-api
  - --api-port=8080
```

## 📊 API Response Examples

### Create Schedule Response

```json
{
  "success": true,
  "message": "Schedule created successfully for tenant bdadevdat"
}
```

### Get Schedule Response

```json
{
  "success": true,
  "data": {
    "tenant": "bdadevdat",
    "namespaces": {
      "datastores": [
        {
          "name": "sleep-ds-deploys-bdadevdat",
          "namespace": "bdadevdat-datastores",
          "weekdays": "1-5",
          "sleepTime": "03:00",
          "timeZone": "UTC"
        }
      ],
      "apps": [...]
    }
  }
}
```

## 🔐 Security Considerations

- API runs on a separate port from controller metrics
- No authentication implemented (should be added for production)
- CORS is optional and disabled by default
- Input validation prevents malicious input

## 🧪 Testing

Currently, manual testing is recommended:

```bash
# Start server
go run ./cmd/main.go --enable-api --api-port 8080

# Test endpoints
curl http://localhost:8080/api/v1/info
curl -X POST http://localhost:8080/api/v1/schedules \
  -H "Content-Type: application/json" \
  -d '{"tenant":"bdadevdat","off":"22:00","on":"06:00","weekdays":"lunes-viernes"}'
```

## 📝 Notes

1. **Timezone**: All times in requests are in local timezone (America/Bogota), converted automatically to UTC
2. **Weekdays**: Supports both human-readable ("lunes-viernes") and numeric ("1-5") formats
3. **Namespaces**: Creates SleepInfos for all supported namespaces unless filtered
4. **Secrets**: Automatically managed (created/updated/deleted with SleepInfos)
5. **Staged Wake-up**: Datastores namespace uses staged wake-up (Postgres/HDFS → PgBouncer → Deployments)

## 🔄 Migration from tenant_power.py

The REST API provides equivalent functionality to `tenant_power.py`:

| tenant_power.py | REST API |
|----------------|----------|
| `create --apply` | `POST /api/v1/schedules` |
| `show` | `GET /api/v1/schedules/:tenant` |
| `update --apply` | `PUT /api/v1/schedules/:tenant` |
| Manual deletion | `DELETE /api/v1/schedules/:tenant` |

## 🐛 Known Limitations

1. Update requires at least `off` or `on` time (full timezone conversion logic needed for reverse conversion)
2. No authentication/authorization (should be added for production)
3. No rate limiting
4. Unit tests pending

## 📚 Related Documentation

- [API Usage Guide](./internal/api/v1/API_USAGE.md)
- [Package README](./internal/api/v1/README.md)
- [Swagger Documentation](http://localhost:8080/swagger/index.html) (when server is running)

## 🎯 Next Steps (Future Enhancements)

1. Add authentication/authorization (RBAC, OAuth2, API keys)
2. Implement rate limiting
3. Add unit and integration tests
4. Implement reverse timezone conversion for UPDATE (to show local times)
5. Add metrics for API usage
6. Support for webhooks/notifications



