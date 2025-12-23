# kube-green Frontend

Frontend web profesional para gestionar kube-green schedules mediante una interfaz gráfica intuitiva.

## 🚀 Tecnologías

- **React 18** - Framework UI
- **TypeScript** - Type safety
- **Vite** - Build tool rápida
- **Material-UI** - Componentes UI
- **React Query** - Gestión de estado servidor
- **Zustand** - Gestión de estado cliente
- **date-fns** - Manejo de fechas y timezones
- **Axios** - Cliente HTTP

## 📁 Estructura del Proyecto

```
frontend-app/
├── src/
│   ├── components/          # Componentes React
│   │   ├── Dashboard/       # Vista principal
│   │   ├── TenantDetail/    # Vista detallada de tenant
│   │   ├── ScheduleEditor/  # Editor de schedules
│   │   └── common/          # Componentes compartidos
│   ├── services/            # Servicios API
│   ├── hooks/               # Custom hooks
│   ├── types/               # TypeScript types
│   └── utils/               # Utilidades
├── k8s/                     # Manifiestos Kubernetes
├── Dockerfile               # Imagen Docker
└── nginx.conf               # Configuración Nginx
```

## 🏗️ Desarrollo

### Instalación

```bash
cd frontend-app
npm install
```

### Desarrollo Local

```bash
npm run dev
```

La aplicación estará disponible en `http://localhost:3000`

### Build

```bash
npm run build
```

### Preview Build

```bash
npm run preview
```

## 🐳 Docker

### Construir Imagen

```bash
docker build --build-arg VITE_AUTH_ENABLED=true -t yeramirez/kube-front:0.7.19 .
```

### Ejecutar Localmente

```bash
docker run -p 8080:80 yeramirez/kube-front:0.7.19
```

## ☸️ Kubernetes Deployment

### Desplegar en keos-core

```bash
kubectl apply -f k8s/deployment.yaml
```

### Verificar Deployment

```bash
kubectl get pods -n keos-core -l app=kube-green-frontend
kubectl get svc -n keos-core kube-green-frontend-service
```

### Acceder al Frontend

El frontend estará disponible según la configuración del Ingress:
- URL: `http://kube-green-frontend.keos-core.local` (configurar en tu DNS local o hosts)

## 🔧 Configuración

### Variables de Entorno

- **Desarrollo**: `.env.development`
  - `VITE_API_URL=http://localhost:8080`

- **Producción**: `.env.production`
  - `VITE_API_URL=http://kube-green-controller-manager-metrics-service.keos-core.svc.cluster.local:8080`
  - `VITE_AUTH_ENABLED=true` (solo aplica en build)

## 📝 Features Implementadas

- ✅ Descubrimiento automático de tenants
- ✅ Identificación automática de servicios
- ✅ Delays configurables por tipo de recurso
- ✅ Visualización de servicios suspendidos
- ✅ Gestión de exclusiones mediante anotaciones
- ✅ Conversión flexible de timezones
- ✅ Timeline visual de operaciones
- ✅ Colores corporativos Stratio Bigdata

## 🎨 Colores Corporativos

- **Primary**: `#1e3c72` (Azul oscuro Stratio)
- **Secondary**: `#2a5298` (Azul medio)
- **Accent**: `#0ea5e9` (Azul claro)
- **Success**: `#10b981` (Verde)
- **Warning**: `#f59e0b` (Ámbar)
- **Error**: `#ef4444` (Rojo)

## 📦 Versionado

Las imágenes Docker siguen el patrón:
- `yeramirez/kube-front:{VERSION}-front`

Ejemplo: `yeramirez/kube-front:0.7.19-front`

## 🔗 Integración con Backend

El frontend se comunica con el backend REST API de kube-green en:
- **Desarrollo**: `http://localhost:8080/api/v1`
- **Producción**: `http://kube-green-controller-manager-metrics-service.keos-core.svc.cluster.local:8080/api/v1`

## 📚 Documentación

Ver `frontend/PLAN_FRONTEND.md` para el plan completo de implementación.


