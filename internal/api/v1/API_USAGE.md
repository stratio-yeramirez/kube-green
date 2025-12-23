# REST API Usage Guide

## Overview

The kube-green REST API provides HTTP endpoints to manage SleepInfo configurations programmatically. This API is an alternative to the `tenant_power.py` script, offering the same functionality through REST calls.

## Starting the API Server

Enable the API server when starting kube-green:

```bash
./cmd/main.go --enable-api --api-port 8080
```

Options:
- `--enable-api`: Enable the REST API server (default: false)
- `--api-port`: Port for the REST API (default: 8080)
- `--enable-api-cors`: Enable CORS for the API (default: false)

## Base URL

By default, the API runs on `http://localhost:8080` (when running locally).

## Swagger Documentation

Once the API is running, access the interactive Swagger UI at:
- **Swagger UI**: `http://localhost:8080/swagger/index.html`
- **Redirect**: `http://localhost:8080/swagger` (redirects to UI)

## Endpoints

### Health & Info

- `GET /health` - Health check
- `GET /ready` - Readiness check
- `GET /api/v1/info` - API information

### Schedule Management

#### 1. List All Schedules

```bash
curl http://localhost:8080/api/v1/schedules
```

Returns all schedules grouped by tenant.

#### 2. Get Schedule for Tenant

```bash
curl http://localhost:8080/api/v1/schedules/bdadevdat
```

Returns all SleepInfo configurations for the specified tenant.

#### 3. Create Schedule

```bash
curl -X POST http://localhost:8080/api/v1/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "tenant": "bdadevdat",
    "off": "22:00",
    "on": "06:00",
    "weekdays": "lunes-viernes"
  }'
```

**Request Body:**
- `tenant` (required): Tenant name (e.g., "bdadevdat")
- `off` (required): Sleep time in local timezone (HH:MM, 24-hour format)
- `on` (required): Wake time in local timezone (HH:MM, 24-hour format)
- `weekdays` (optional): Days of week ("lunes-viernes" or "1-5")
- `sleepDays` (optional): Specific days for sleep (overrides weekdays)
- `wakeDays` (optional): Specific days for wake (overrides weekdays)
- `namespaces` (optional): Array of namespace suffixes to limit scope

**Examples:**

Create schedule for all namespaces:
```json
{
  "tenant": "bdadevdat",
  "off": "22:00",
  "on": "06:00",
  "weekdays": "lunes-viernes"
}
```

Create schedule only for specific namespaces:
```json
{
  "tenant": "bdadevdat",
  "off": "22:00",
  "on": "06:00",
  "weekdays": "lunes-viernes",
  "namespaces": ["datastores", "apps"]
}
```

Sleep Friday, wake Monday:
```json
{
  "tenant": "bdadevdat",
  "off": "23:00",
  "on": "06:00",
  "sleepDays": "viernes",
  "wakeDays": "lunes"
}
```

#### 4. Update Schedule

```bash
curl -X PUT http://localhost:8080/api/v1/schedules/bdadevdat \
  -H "Content-Type: application/json" \
  -d '{
    "off": "23:00",
    "on": "07:00",
    "weekdays": "lunes-viernes"
  }'
```

All fields are optional. Missing fields are extracted from the existing schedule.

#### 5. Delete Schedule

```bash
curl -X DELETE http://localhost:8080/api/v1/schedules/bdadevdat
```

Deletes all SleepInfo configurations and associated secrets for the tenant.

## Timezone Handling

The API automatically converts local time (America/Bogota) to UTC and adjusts weekdays based on timezone shifts. For example:
- `22:00` local → `03:00 UTC` (next day, +1 day shift)
- Weekdays are automatically adjusted to match the UTC day

## Supported Namespaces

- `datastores` - Databases (Postgres, HDFS, PgBouncer)
- `apps` - Main applications
- `rocket` - Rocket services
- `intelligence` - Intelligence services
- `airflowsso` - Airflow SSO services

## Weekday Formats

The API accepts weekdays in both human-readable and numeric formats:

**Human format:**
- `"lunes-viernes"` (Monday-Friday)
- `"viernes,sábado,domingo"` (Friday, Saturday, Sunday)
- `"sábado"` (Saturday)

**Numeric format:**
- `"1-5"` (Monday-Friday, 0=Sunday, 6=Saturday)
- `"0-6"` (All days)
- `"5,6,0"` (Friday, Saturday, Sunday)

## Response Formats

### Success Response

```json
{
  "success": true,
  "message": "Schedule created successfully for tenant bdadevdat",
  "data": { ... }
}
```

### Error Response

```json
{
  "success": false,
  "error": "Invalid request: tenant is required",
  "code": 400
}
```

## Error Codes

- `400` - Bad Request (invalid parameters)
- `404` - Not Found (schedule doesn't exist)
- `500` - Internal Server Error

## Examples

### Complete Workflow

1. **Create a schedule:**
```bash
curl -X POST http://localhost:8080/api/v1/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "tenant": "bdadevdat",
    "off": "22:00",
    "on": "06:00",
    "weekdays": "lunes-viernes"
  }'
```

2. **Verify it was created:**
```bash
curl http://localhost:8080/api/v1/schedules/bdadevdat
```

3. **Update the schedule:**
```bash
curl -X PUT http://localhost:8080/api/v1/schedules/bdadevdat \
  -H "Content-Type: application/json" \
  -d '{
    "off": "23:00",
    "on": "07:00"
  }'
```

4. **Delete the schedule:**
```bash
curl -X DELETE http://localhost:8080/api/v1/schedules/bdadevdat
```

## Integration with Other Tools

The API can be integrated with:
- CI/CD pipelines
- Monitoring systems
- Automation scripts
- Web dashboards
- Infrastructure as Code tools

## Notes

- All times are in **local timezone** (America/Bogota) - conversion to UTC is automatic
- The API creates SleepInfos directly in Kubernetes - no need for `kubectl apply`
- Secrets are automatically managed (created/updated/deleted)
- The API uses the same Kubernetes client as the controller, ensuring consistency

