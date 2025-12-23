# REST API v1

Este paquete implementa el servidor HTTP REST para kube-green, permitiendo gestionar configuraciones de SleepInfo a través de una API HTTP.

## Configuración

La API REST se habilita con los siguientes flags:

```bash
--enable-api           # Habilita el servidor REST API (default: false)
--api-port 8080        # Puerto donde escucha el servidor (default: 8080)
--enable-api-cors      # Habilita CORS para la API (default: false)
```

## Endpoints

### Health Checks

- `GET /health` - Health check del servidor
- `GET /ready` - Readiness check del servidor
- `GET /api/v1/info` - Información sobre la API

### Schedule Management

- `GET /api/v1/schedules` - Lista todas las configuraciones
- `GET /api/v1/schedules/:tenant` - Obtiene configuración de un tenant
- `POST /api/v1/schedules` - Crea nueva configuración
- `PUT /api/v1/schedules/:tenant` - Actualiza configuración existente
- `DELETE /api/v1/schedules/:tenant` - Elimina configuración

## Estructura

```
internal/api/v1/
├── server.go      # Configuración del servidor HTTP y rutas
└── handlers.go    # Implementación de los handlers de endpoints
```

## Estado Actual

✅ **COMPLETADO** - Todos los endpoints están implementados y funcionando.

### Implementado

- ✅ Servidor HTTP REST con Gin
- ✅ Endpoints de health y info
- ✅ CRUD completo para schedules (CREATE, READ, UPDATE, DELETE)
- ✅ Conversión automática de timezone (America/Bogota → UTC)
- ✅ Parsing de weekdays (formato humano y numérico)
- ✅ Generación de SleepInfos para todos los namespaces
- ✅ Manejo de encendido escalonado para datastores
- ✅ Limpieza automática de Secrets al eliminar SleepInfos
- ✅ Validación de parámetros de entrada
- ✅ Swagger/OpenAPI documentation
- ✅ Mejoras en actualizaciones parciales

## Swagger Documentation

### Generar Documentación

```bash
make swagger
```

Esto generará los archivos de documentación en `internal/api/v1/docs/`.

### Acceder a Swagger UI

Una vez que el servidor está corriendo con `--enable-api`:

```bash
# Acceder a Swagger UI
open http://localhost:8080/swagger/index.html

# O simplemente
open http://localhost:8080/swagger
```

## Estructura de Archivos

```
internal/api/v1/
├── doc.go              # Configuración de Swagger
├── server.go           # Servidor HTTP y rutas
├── handlers.go         # Handlers de endpoints REST
├── schedule_service.go # Lógica de negocio para schedules
├── timezone.go         # Conversión de timezone
├── weekdays.go         # Parsing de weekdays
├── validation.go       # Validación de requests
├── docs/               # Swagger docs generados (gitignored)
│   ├── docs.go
│   ├── swagger.json
│   └── swagger.yaml
├── README.md           # Documentación del paquete
└── API_USAGE.md        # Guía de uso de la API
```

## Tests

Los tests unitarios e integración están pendientes de implementar.

