# Contexto de Despliegue - kube-green

## 📋 Nomenclatura de Imágenes Docker

### Backend (kube-green API)
- **Repositorio**: `yeramirez/kube-green`
- **Versión actual**: `0.7.8`
- **Tag formato**: `yeramirez/kube-green:0.7.X`
- **Ejemplo**: `yeramirez/kube-green:0.7.9`

### Frontend (kube-green Frontend)
- **Repositorio**: `yeramirez/kube-front`
- **Versión actual en deployment**: `0.7.8-web`
- **Tag formato**: `yeramirez/kube-front:0.7.X-web` o `yeramirez/kube-front:0.7.X-front`
- **Ejemplo**: `yeramirez/kube-front:0.7.9-web`

## 🏗️ Información de Build

### Backend Build
```bash
cd kube-green/kube-green
make docker-build IMG=yeramirez/kube-green:0.7.9
make docker-push IMG=yeramirez/kube-green:0.7.9
```

### Frontend Build
```bash
cd kube-green/frontend-app
docker build -t yeramirez/kube-front:0.7.9-web .
docker push yeramirez/kube-front:0.7.9-web
```

## ☸️ Kubernetes Deployments - keos-core

### Namespace
- **Namespace**: `keos-core`
- **Todos los recursos van en este namespace**

### Frontend Deployment
- **Archivo**: `frontend-app/k8s/deployment.yaml`
- **Nombre**: `kube-green-frontend`
- **Namespace**: `keos-core`
- **Imagen actual**: `yeramirez/kube-front:0.7.8-web`
- **Puerto**: `80`
- **Service**: `kube-green-frontend-service`
- **Ingress**: `kube-green-frontend-ingress`

### Backend API Deployment
- **Archivo**: `kube-green/config/kube-green-api-service.yaml` (Solo Service, falta Deployment)
- **Service**: `kube-green-api-service`
- **Namespace**: `keos-core`
- **Puerto**: `8080`
- **Selector**: 
  - `control-plane: controller-manager`
  - `app.kubernetes.io/name: kube-green`

**NOTA**: El backend API corre en el mismo pod que el controller-manager de kube-green. 
El servicio `kube-green-api-service` apunta al controller-manager que tiene habilitado el API server.

## 🔧 Configuración del Controller Manager

El controller manager debe tener habilitado el API server con estos flags:
```yaml
args:
  - --enable-api
  - --api-port=8080
  - --enable-api-cors
```

## 📝 Comandos de Actualización

### Actualizar Frontend
```bash
# 1. Construir imagen
cd frontend-app
docker build -t yeramirez/kube-front:0.7.9-web .

# 2. Subir imagen
docker push yeramirez/kube-front:0.7.9-web

# 3. Actualizar deployment
kubectl set image deployment/kube-green-frontend frontend=yeramirez/kube-front:0.7.9-web -n keos-core

# 4. Verificar rollout
kubectl rollout status deployment/kube-green-frontend -n keos-core
```

### Actualizar Backend
```bash
# 1. Construir imagen
cd kube-green/kube-green
make docker-build IMG=yeramirez/kube-green:0.7.9

# 2. Subir imagen
docker push yeramirez/kube-green:0.7.9

# 3. Actualizar deployment del controller-manager
kubectl set image deployment/kube-green-controller-manager manager=yeramirez/kube-green:0.7.9 -n kube-green

# O si está en keos-core:
kubectl set image deployment/kube-green-controller-manager manager=yeramirez/kube-green:0.7.9 -n keos-core
```

## 🔍 Verificación Post-Deployment

### Verificar Frontend
```bash
kubectl get pods -n keos-core -l app=kube-green-frontend
kubectl get svc -n keos-core kube-green-frontend-service
kubectl logs -n keos-core -l app=kube-green-frontend --tail=50
```

### Verificar Backend API
```bash
kubectl get pods -n keos-core -l app.kubernetes.io/name=kube-green
kubectl get svc -n keos-core kube-green-api-service
kubectl logs -n keos-core -l app.kubernetes.io/name=kube-green --tail=50 | grep -i api
```

## 📌 Estado Actual de Implementación

### Backend (Completado ✅)
- ✅ Endpoint GET /api/v1/namespaces/{tenant}/resources
- ✅ Endpoints GET/POST/PUT/DELETE /api/v1/schedules/{tenant}/{namespace}
- ✅ Lógica dinámica basada en recursos detectados
- ✅ Soporte para delays configurables (WakeDelayConfig)
- ✅ Generación automática de SleepInfos según CRDs detectados

### Frontend (Parcial ⏳)
- ✅ Tipos TypeScript actualizados (WakeDelayConfig, NamespaceScheduleRequest, etc.)
- ✅ Cliente API actualizado con nuevos endpoints
- ✅ Hooks React Query creados (useNamespaceResources, useNamespaceSchedule, etc.)
- ⏳ Componente NamespaceScheduleEditor (pendiente)
- ⏳ Componente DelaysConfiguration (pendiente)
- ⏳ Actualización de TenantDetail (pendiente)

## 🎯 Próximos Pasos

1. **Construir y subir imágenes Docker**
   - Backend: `yeramirez/kube-green:0.7.9`
   - Frontend: `yeramirez/kube-front:0.7.9-web`

2. **Crear/Actualizar deployments en keos-core**
   - Verificar deployment del controller-manager
   - Actualizar deployment del frontend
   - Asegurar que el API server esté habilitado

3. **Continuar implementación del frontend**
   - NamespaceScheduleEditor
   - DelaysConfiguration
   - Actualizar TenantDetail

## 📝 Notas Importantes

- **Rama de trabajo**: `feature/frontend`
- **Todos los cambios deben estar en esta rama**
- **Frontend está en**: `kube-green/frontend-app/` (fuera del repo git principal)
- **Backend está en**: `kube-green/kube-green/` (dentro del repo git principal)
- **Versión**: Incrementar a `0.7.9` para los nuevos cambios

## 🔗 Referencias

- Deployment frontend: `frontend-app/k8s/deployment.yaml`
- Service API: `kube-green/config/kube-green-api-service.yaml`
- Makefile backend: `kube-green/Makefile` (VERSION=0.7.8)
- Package.json frontend: `frontend-app/package.json` (version: 0.7.1)

