# Plan de Implementación: Autenticación JWT

## Resumen Ejecutivo

Implementar autenticación basada en JWT (JSON Web Tokens) para proteger la comunicación entre el frontend y el backend de kube-green.

## Arquitectura Propuesta

### Flujo de Autenticación

```
1. Usuario → Frontend: Ingresa credenciales
2. Frontend → Backend: POST /api/v1/auth/login {username, password}
3. Backend: Valida credenciales y genera JWT
4. Backend → Frontend: {token, refreshToken, expiresIn}
5. Frontend: Almacena tokens en localStorage/sessionStorage
6. Frontend → Backend: Todas las peticiones incluyen header: Authorization: Bearer <token>
7. Backend: Middleware valida JWT en cada petición protegida
8. Si token expira: Frontend usa refreshToken para obtener nuevo token
```

## Componentes a Implementar

### Backend (Go)

#### 1. Dependencias
```bash
go get github.com/golang-jwt/jwt/v5
go get golang.org/x/crypto/bcrypt
```

#### 2. Estructura de Archivos
```
internal/api/v1/
├── auth/
│   ├── auth.go          # Lógica de autenticación
│   ├── jwt.go           # Generación y validación de JWT
│   ├── middleware.go     # Middleware de autenticación
│   └── handlers.go       # Handlers de login/logout/refresh
├── server.go            # Agregar rutas de auth
└── handlers.go          # Proteger rutas existentes
```

#### 3. Configuración
- Variables de entorno:
  - `JWT_SECRET`: Secreto para firmar tokens (requerido)
  - `JWT_EXPIRATION`: Tiempo de expiración del token (default: 24h)
  - `JWT_REFRESH_EXPIRATION`: Tiempo de expiración del refresh token (default: 7d)
  - `AUTH_ENABLED`: Habilitar/deshabilitar autenticación (default: false para backward compatibility)

#### 4. Endpoints de Autenticación
- `POST /api/v1/auth/login` - Login y obtención de tokens
- `POST /api/v1/auth/refresh` - Renovación de token usando refreshToken
- `POST /api/v1/auth/logout` - Invalidar refresh token (opcional)
- `GET /api/v1/auth/me` - Obtener información del usuario autenticado

#### 5. Middleware de Autenticación
- Proteger todas las rutas excepto:
  - `/health`
  - `/ready`
  - `/api/v1/auth/login`
  - `/api/v1/auth/refresh`
  - `/swagger/*` (opcional)

### Frontend (React/TypeScript)

#### 1. Estructura de Archivos
```
frontend-app/src/
├── services/
│   ├── api.ts           # Modificar para agregar token
│   └── auth.ts          # Servicio de autenticación
├── hooks/
│   └── useAuth.ts       # Hook para manejo de autenticación
├── context/
│   └── AuthContext.tsx  # Context para estado de autenticación
├── components/
│   └── Login/
│       └── Login.tsx    # Componente de login
└── utils/
    └── token.ts         # Utilidades para manejo de tokens
```

#### 2. Almacenamiento de Tokens
- **localStorage**: Para persistencia entre sesiones
- **sessionStorage**: Alternativa más segura (se borra al cerrar navegador)
- **Recomendación**: Usar localStorage con opción de cambiar a sessionStorage

#### 3. Interceptor de Axios
- Agregar token automáticamente a todas las peticiones
- Manejar errores 401 (Unauthorized) para redirigir a login
- Intentar refresh automático cuando el token expire

#### 4. Protección de Rutas
- Componente `ProtectedRoute` que verifica autenticación
- Redirigir a `/login` si no está autenticado

## Implementación Detallada

### Backend: auth/jwt.go

```go
package auth

import (
    "time"
    "github.com/golang-jwt/jwt/v5"
)

type Claims struct {
    Username string `json:"username"`
    jwt.RegisteredClaims
}

type TokenPair struct {
    AccessToken  string `json:"accessToken"`
    RefreshToken string `json:"refreshToken"`
    ExpiresIn    int64  `json:"expiresIn"`
}

func GenerateTokenPair(username string, secret []byte, accessExpiration, refreshExpiration time.Duration) (*TokenPair, error) {
    // Generar access token
    accessClaims := &Claims{
        Username: username,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(accessExpiration)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            Issuer:    "kube-green-api",
        },
    }
    
    accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
    accessTokenString, err := accessToken.SignedString(secret)
    if err != nil {
        return nil, err
    }
    
    // Generar refresh token
    refreshClaims := &Claims{
        Username: username,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(refreshExpiration)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            Issuer:    "kube-green-api",
        },
    }
    
    refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
    refreshTokenString, err := refreshToken.SignedString(secret)
    if err != nil {
        return nil, err
    }
    
    return &TokenPair{
        AccessToken:  accessTokenString,
        RefreshToken: refreshTokenString,
        ExpiresIn:    int64(accessExpiration.Seconds()),
    }, nil
}

func ValidateToken(tokenString string, secret []byte) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        return secret, nil
    })
    
    if err != nil {
        return nil, err
    }
    
    if claims, ok := token.Claims.(*Claims); ok && token.Valid {
        return claims, nil
    }
    
    return nil, jwt.ErrSignatureInvalid
}
```

### Backend: auth/middleware.go

```go
package auth

import (
    "net/http"
    "strings"
    "github.com/gin-gonic/gin"
)

func JWTAuthMiddleware(secret []byte) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Permitir rutas públicas
        publicPaths := []string{"/health", "/ready", "/api/v1/auth/login", "/api/v1/auth/refresh", "/swagger"}
        path := c.Request.URL.Path
        
        for _, publicPath := range publicPaths {
            if strings.HasPrefix(path, publicPath) {
                c.Next()
                return
            }
        }
        
        // Extraer token del header
        authHeader := c.GetHeader("Authorization")
        if authHeader == "" {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
            c.Abort()
            return
        }
        
        // Formato: "Bearer <token>"
        parts := strings.Split(authHeader, " ")
        if len(parts) != 2 || parts[0] != "Bearer" {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
            c.Abort()
            return
        }
        
        token := parts[1]
        
        // Validar token
        claims, err := ValidateToken(token, secret)
        if err != nil {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
            c.Abort()
            return
        }
        
        // Agregar información del usuario al contexto
        c.Set("username", claims.Username)
        c.Next()
    }
}
```

### Frontend: services/auth.ts

```typescript
import axios from 'axios'
import { apiClient } from './api'

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface AuthService {
  login(credentials: LoginRequest): Promise<LoginResponse>
  logout(): void
  refreshToken(): Promise<string>
  getAccessToken(): string | null
  isAuthenticated(): boolean
}

class AuthServiceImpl implements AuthService {
  private readonly TOKEN_KEY = 'kube-green-access-token'
  private readonly REFRESH_TOKEN_KEY = 'kube-green-refresh-token'
  private readonly EXPIRES_AT_KEY = 'kube-green-expires-at'

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await axios.post<{ success: boolean; data: LoginResponse }>(
      `${import.meta.env.VITE_API_URL || '/api'}/v1/auth/login`,
      credentials
    )
    
    if (response.data.success && response.data.data) {
      this.setTokens(response.data.data)
      return response.data.data
    }
    
    throw new Error('Login failed')
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY)
    localStorage.removeItem(this.REFRESH_TOKEN_KEY)
    localStorage.removeItem(this.EXPIRES_AT_KEY)
  }

  async refreshToken(): Promise<string> {
    const refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY)
    if (!refreshToken) {
      throw new Error('No refresh token available')
    }

    const response = await axios.post<{ success: boolean; data: LoginResponse }>(
      `${import.meta.env.VITE_API_URL || '/api'}/v1/auth/refresh`,
      { refreshToken }
    )

    if (response.data.success && response.data.data) {
      this.setTokens(response.data.data)
      return response.data.data.accessToken
    }

    throw new Error('Token refresh failed')
  }

  getAccessToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY)
  }

  isAuthenticated(): boolean {
    const token = this.getAccessToken()
    const expiresAt = localStorage.getItem(this.EXPIRES_AT_KEY)
    
    if (!token || !expiresAt) {
      return false
    }

    // Verificar si el token no ha expirado
    const expirationTime = parseInt(expiresAt, 10)
    return Date.now() < expirationTime
  }

  private setTokens(data: LoginResponse): void {
    localStorage.setItem(this.TOKEN_KEY, data.accessToken)
    localStorage.setItem(this.REFRESH_TOKEN_KEY, data.refreshToken)
    
    // Calcular tiempo de expiración
    const expiresAt = Date.now() + (data.expiresIn * 1000)
    localStorage.setItem(this.EXPIRES_AT_KEY, expiresAt.toString())
  }
}

export const authService = new AuthServiceImpl()
```

### Frontend: Modificar services/api.ts

```typescript
// Agregar al constructor de ApiClient
import { authService } from './auth'

constructor() {
  this.client = axios.create({
    baseURL: `${API_BASE_URL}/v1`,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  })

  // Request interceptor - Agregar token
  this.client.interceptors.request.use(
    async (config) => {
      const token = authService.getAccessToken()
      if (token && authService.isAuthenticated()) {
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    },
    (error) => {
      return Promise.reject(error)
    }
  )

  // Response interceptor - Manejar 401 y refresh token
  this.client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config

      // Si es 401 y no es un retry, intentar refresh
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true

        try {
          const newToken = await authService.refreshToken()
          originalRequest.headers.Authorization = `Bearer ${newToken}`
          return this.client(originalRequest)
        } catch (refreshError) {
          // Si refresh falla, redirigir a login
          authService.logout()
          window.location.href = '/login'
          return Promise.reject(refreshError)
        }
      }

      return Promise.reject(error)
    }
  )
}
```

## Configuración de Seguridad

### Variables de Entorno

**Backend (.env o ConfigMap de Kubernetes):**
```bash
JWT_SECRET=your-super-secret-key-change-this-in-production
JWT_EXPIRATION=24h
JWT_REFRESH_EXPIRATION=168h  # 7 días
AUTH_ENABLED=true
```

**Frontend (.env):**
```bash
VITE_API_URL=http://localhost:8080
VITE_AUTH_ENABLED=true
```

### Gestión de Usuarios

**Opción 1: Simple (Para desarrollo/testing)**
- Usuarios hardcodeados en el código
- Passwords hasheados con bcrypt

**Opción 2: Kubernetes Secrets (Recomendado para producción)**
- Almacenar usuarios en Kubernetes Secrets
- Leer desde el ConfigMap/Secret al iniciar

**Opción 3: Base de datos (Para escalabilidad)**
- Tabla de usuarios en base de datos
- Implementar CRUD de usuarios

## Consideraciones de Seguridad

1. **HTTPS obligatorio en producción**: Los tokens JWT deben transmitirse solo sobre HTTPS
2. **Secretos seguros**: El JWT_SECRET debe ser una cadena aleatoria fuerte (mínimo 32 caracteres)
3. **Expiración de tokens**: Tokens de acceso cortos (24h), refresh tokens más largos (7d)
4. **Refresh token rotation**: Considerar invalidar el refresh token anterior al generar uno nuevo
5. **Rate limiting**: Implementar rate limiting en el endpoint de login para prevenir brute force
6. **CORS**: Ajustar CORS para permitir credenciales solo desde dominios autorizados

## Plan de Implementación por Fases

### Fase 1: Backend Básico (Sin usuarios reales)
- [ ] Implementar generación y validación de JWT
- [ ] Crear middleware de autenticación
- [ ] Endpoint de login con usuario/password hardcodeado
- [ ] Proteger rutas existentes con middleware

### Fase 2: Frontend Básico
- [ ] Crear servicio de autenticación
- [ ] Modificar interceptor de Axios
- [ ] Crear componente de Login
- [ ] Proteger rutas del frontend

### Fase 3: Gestión de Usuarios
- [ ] Implementar almacenamiento de usuarios (Secrets/DB)
- [ ] Endpoint de gestión de usuarios (admin)
- [ ] Cambio de contraseñas

### Fase 4: Mejoras de Seguridad
- [ ] Rate limiting
- [ ] Refresh token rotation
- [ ] Logout con invalidación de tokens
- [ ] Auditoría de accesos

## Testing

### Backend
- Unit tests para generación/validación de JWT
- Integration tests para endpoints de auth
- Tests de middleware

### Frontend
- Tests de servicio de autenticación
- Tests de interceptor de Axios
- Tests de componente de Login

## Migración

Para mantener backward compatibility:
1. Agregar flag `AUTH_ENABLED=false` por defecto
2. Si está deshabilitado, el middleware no valida tokens
3. Permitir migración gradual activando auth por namespace/tenant

