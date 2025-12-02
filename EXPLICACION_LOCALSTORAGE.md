# Explicación: localStorage vs Persistencia del Backend

## Confusión Común

**localStorage NO requiere PVC ni nada en Kubernetes** porque **localStorage es del navegador del cliente**, no del servidor.

## Diferencia Clave

### localStorage (Frontend - Navegador del Usuario)

```
┌─────────────────────────────────────────┐
│  DISPOSITIVO DEL USUARIO               │
│  (Computadora, Celular, Tablet)        │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐  │
│  │  NAVEGADOR WEB                  │  │
│  │  (Chrome, Firefox, Safari, etc)│  │
│  ├─────────────────────────────────┤  │
│  │                                 │  │
│  │  localStorage (API del navegador)│  │
│  │  ┌───────────────────────────┐ │  │
│  │  │ kube-green-access-token   │ │  │
│  │  │ kube-green-refresh-token  │ │  │
│  │  │ kube-green-expires-at     │ │  │
│  │  └───────────────────────────┘ │  │
│  │                                 │  │
│  │  Almacenado en:                 │  │
│  │  - Windows: AppData\Local\...  │  │
│  │  - Linux: ~/.config/chrome/...  │  │
│  │  - Mac: ~/Library/...          │  │
│  └─────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

**Características:**
- ✅ **NO requiere servidor** - Es del navegador
- ✅ **NO requiere Kubernetes** - Es del cliente
- ✅ **NO requiere PVC** - Se almacena en el disco del usuario
- ✅ **NO requiere etcd** - Es almacenamiento local del navegador
- ✅ **Persiste entre sesiones** - Si cierras y abres el navegador, los datos siguen ahí
- ⚠️ **Específico por dominio** - Cada sitio web tiene su propio localStorage
- ⚠️ **Limitado a ~5-10MB** por dominio

### Persistencia del Backend (Kubernetes)

```
┌─────────────────────────────────────────┐
│  CLUSTER KUBERNETES                     │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐  │
│  │  POD: kube-green-controller     │  │
│  │  ┌───────────────────────────┐  │  │
│  │  │  Backend (Go)             │  │  │
│  │  │  - Lee usuarios de Secret │  │  │
│  │  │  - Valida JWT tokens      │  │  │
│  │  └───────────────────────────┘  │  │
│  └─────────────────────────────────┘  │
│              │                          │
│              │ Lee/Escribe              │
│              ▼                          │
│  ┌─────────────────────────────────┐  │
│  │  KUBERNETES SECRETS             │  │
│  │  ┌───────────────────────────┐  │  │
│  │  │ kube-green-users          │  │  │
│  │  │ kube-green-jwt-secret     │  │  │
│  │  └───────────────────────────┘  │  │
│  └─────────────────────────────────┘  │
│              │                          │
│              │ Almacenado en            │
│              ▼                          │
│  ┌─────────────────────────────────┐  │
│  │  ETCD (Base de datos de K8s)    │  │
│  │  - Encriptado                    │  │
│  │  - Replicado                     │  │
│  │  - Persistente                   │  │
│  └─────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

**Características:**
- ✅ **Requiere Kubernetes** - Es un recurso de K8s
- ✅ **Almacenado en etcd** - Base de datos de Kubernetes
- ✅ **Persistente** - Sobrevive reinicios de pods
- ✅ **Encriptado** - etcd encripta los Secrets
- ⚠️ **Limitado a ~1MB** por Secret

## Flujo Completo

```
┌──────────────┐                    ┌──────────────┐
│   USUARIO    │                    │   BACKEND    │
│  (Navegador) │                    │  (Kubernetes)│
└──────┬───────┘                    └──────┬───────┘
       │                                    │
       │ 1. POST /api/v1/auth/login         │
       │    {username, password}           │
       ├──────────────────────────────────>│
       │                                    │
       │                                    │ 2. Valida usuario
       │                                    │    (lee de Secret)
       │                                    │
       │                                    │ 3. Genera JWT
       │                                    │
       │ 4. Respuesta:                     │
       │    {accessToken, refreshToken}     │
       │<──────────────────────────────────┤
       │                                    │
       │ 5. Guarda en localStorage         │
       │    localStorage.setItem(...)      │
       │                                    │
       │ 6. Peticiones siguientes:          │
       │    Authorization: Bearer <token>   │
       │──────────────────────────────────>│
       │                                    │
       │                                    │ 7. Valida JWT
       │                                    │    (usa JWT_SECRET)
       │                                    │
       │ 8. Respuesta                      │
       │<──────────────────────────────────┤
```

## ¿Dónde se Almacena localStorage?

### Windows
```
C:\Users\<usuario>\AppData\Local\Google\Chrome\User Data\Default\Local Storage
C:\Users\<usuario>\AppData\Local\Mozilla\Firefox\Profiles\<profile>\webappsstore.sqlite
```

### Linux
```
~/.config/google-chrome/Default/Local Storage
~/.mozilla/firefox/<profile>/webappsstore.sqlite
```

### macOS
```
~/Library/Application Support/Google/Chrome/Default/Local Storage
~/Library/Application Support/Firefox/Profiles/<profile>/webappsstore.sqlite
```

## Comparación: localStorage vs sessionStorage

| Característica | localStorage | sessionStorage |
|----------------|--------------|----------------|
| **Persiste al cerrar navegador** | ✅ Sí | ❌ No |
| **Persiste entre pestañas** | ✅ Sí | ❌ No (solo misma pestaña) |
| **Ubicación** | Disco del usuario | Memoria RAM del navegador |
| **Límite** | ~5-10MB | ~5-10MB |
| **Requiere servidor** | ❌ No | ❌ No |
| **Requiere Kubernetes** | ❌ No | ❌ No |
| **Requiere PVC** | ❌ No | ❌ No |

## ¿Cuándo se Necesita PVC?

**PVC (PersistentVolumeClaim) se necesita SOLO cuando:**

1. **El POD necesita almacenamiento persistente**
   - Ejemplo: Base de datos en un pod
   - Ejemplo: Archivos de logs que deben persistir
   - Ejemplo: Cache que debe sobrevivir reinicios

2. **NO se necesita para:**
   - ❌ localStorage (es del navegador, no del pod)
   - ❌ Kubernetes Secrets (ya están en etcd)
   - ❌ ConfigMaps (ya están en etcd)
   - ❌ Tokens JWT en el frontend (es del navegador)

## Ejemplo Práctico

### Frontend (React/TypeScript)

```typescript
// Esto se ejecuta en el NAVEGADOR del usuario
// NO en el servidor, NO en Kubernetes

// Guardar token (se guarda en el disco del usuario)
localStorage.setItem('kube-green-access-token', 'eyJhbGc...')

// Leer token (se lee del disco del usuario)
const token = localStorage.getItem('kube-green-access-token')

// Esto NO requiere:
// - PVC
// - Kubernetes
// - Servidor
// - Base de datos
```

### Backend (Go)

```go
// Esto se ejecuta en el POD de Kubernetes
// SÍ requiere Kubernetes, SÍ usa etcd

// Leer usuarios del Secret (almacenado en etcd)
secret := &v1.Secret{}
err := k8sClient.Get(ctx, client.ObjectKey{
    Namespace: "keos-core",
    Name:      "kube-green-users",
}, secret)

// Esto SÍ requiere:
// - Kubernetes
// - Secret almacenado en etcd
// - Acceso al cluster
```

## Resumen

| Componente | Dónde se Almacena | Requiere PVC? | Requiere K8s? |
|------------|-------------------|---------------|---------------|
| **localStorage (tokens)** | Disco del usuario | ❌ No | ❌ No |
| **sessionStorage (tokens)** | RAM del navegador | ❌ No | ❌ No |
| **Kubernetes Secrets (usuarios)** | etcd del cluster | ❌ No* | ✅ Sí |
| **Base de datos en pod** | Volumen persistente | ✅ Sí | ✅ Sí |

*Los Secrets NO requieren PVC porque etcd ya es persistente.

## Conclusión

**localStorage es completamente independiente de Kubernetes:**
- Se almacena en el dispositivo del usuario
- No requiere configuración en Kubernetes
- No requiere PVC
- No requiere etcd
- Es una característica del navegador web

**La persistencia del backend (usuarios, JWT secret) SÍ usa Kubernetes:**
- Se almacena en etcd (a través de Secrets)
- Requiere acceso al cluster
- Es persistente y encriptado
- No requiere PVC porque etcd ya es persistente

