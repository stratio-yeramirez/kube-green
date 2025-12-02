# Persistencia para Autenticación JWT

## Resumen

Este documento explica cómo se guardaría la persistencia de datos relacionados con la autenticación JWT en kube-green.

## 1. Persistencia en el Frontend

### Tokens JWT (Access Token y Refresh Token)

**Ubicación:** Navegador del cliente (localStorage o sessionStorage)

**Opciones:**

#### Opción A: localStorage (Recomendado para UX)
```typescript
// Ventajas:
// - Persiste entre sesiones del navegador
// - Usuario no necesita volver a loguearse al cerrar/abrir navegador
// - Mejor experiencia de usuario

// Desventajas:
// - Vulnerable a XSS attacks
// - No se borra automáticamente al cerrar navegador

localStorage.setItem('kube-green-access-token', accessToken)
localStorage.setItem('kube-green-refresh-token', refreshToken)
localStorage.setItem('kube-green-expires-at', expiresAt.toString())
```

#### Opción B: sessionStorage (Más seguro)
```typescript
// Ventajas:
// - Se borra automáticamente al cerrar la pestaña/navegador
// - Más seguro contra XSS (menor tiempo de exposición)

// Desventajas:
// - Usuario debe volver a loguearse al cerrar navegador
// - Peor experiencia de usuario

sessionStorage.setItem('kube-green-access-token', accessToken)
sessionStorage.setItem('kube-green-refresh-token', refreshToken)
```

#### Opción C: Cookies HttpOnly (Más seguro, requiere backend)
```typescript
// Ventajas:
// - No accesible desde JavaScript (protección contra XSS)
// - Se envía automáticamente en cada petición
// - Puede tener flags Secure y SameSite

// Desventajas:
// - Requiere configuración en backend
// - Más complejo de implementar
// - Limitado por políticas de cookies del navegador

// Backend debe configurar:
// Set-Cookie: accessToken=xxx; HttpOnly; Secure; SameSite=Strict; Max-Age=86400
```

**Recomendación:** Usar **localStorage** con medidas de seguridad adicionales (HTTPS, Content Security Policy, sanitización de inputs).

### Implementación Frontend

```typescript
// frontend-app/src/services/auth.ts

class AuthServiceImpl implements AuthService {
  private readonly TOKEN_KEY = 'kube-green-access-token'
  private readonly REFRESH_TOKEN_KEY = 'kube-green-refresh-token'
  private readonly EXPIRES_AT_KEY = 'kube-green-expires-at'
  private readonly USERNAME_KEY = 'kube-green-username'
  
  // Usar localStorage por defecto, pero permitir cambiar a sessionStorage
  private storage: Storage = localStorage
  
  constructor(useSessionStorage: boolean = false) {
    this.storage = useSessionStorage ? sessionStorage : localStorage
  }

  setTokens(data: LoginResponse): void {
    this.storage.setItem(this.TOKEN_KEY, data.accessToken)
    this.storage.setItem(this.REFRESH_TOKEN_KEY, data.refreshToken)
    
    const expiresAt = Date.now() + (data.expiresIn * 1000)
    this.storage.setItem(this.EXPIRES_AT_KEY, expiresAt.toString())
  }

  getAccessToken(): string | null {
    return this.storage.getItem(this.TOKEN_KEY)
  }

  getRefreshToken(): string | null {
    return this.storage.getItem(this.REFRESH_TOKEN_KEY)
  }

  logout(): void {
    this.storage.removeItem(this.TOKEN_KEY)
    this.storage.removeItem(this.REFRESH_TOKEN_KEY)
    this.storage.removeItem(this.EXPIRES_AT_KEY)
    this.storage.removeItem(this.USERNAME_KEY)
  }
}
```

## 2. Persistencia en el Backend

### 2.1. Usuarios y Credenciales

#### Opción A: Kubernetes Secrets (Recomendado para producción)

**Estructura del Secret:**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: kube-green-users
  namespace: keos-core
type: Opaque
stringData:
  # Formato: username:password_hash
  # Cada línea es un usuario
  users: |
    admin:$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
    operator:$2a$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRST
```

**Implementación en Go:**

```go
// internal/api/v1/auth/users.go

package auth

import (
    "bufio"
    "context"
    "fmt"
    "strings"
    "golang.org/x/crypto/bcrypt"
    v1 "k8s.io/api/core/v1"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "sigs.k8s.io/controller-runtime/pkg/client"
)

type UserStore struct {
    client    client.Client
    namespace string
    secretName string
    users     map[string]string // username -> password_hash
}

func NewUserStore(k8sClient client.Client, namespace, secretName string) *UserStore {
    return &UserStore{
        client:     k8sClient,
        namespace:  namespace,
        secretName: secretName,
        users:      make(map[string]string),
    }
}

func (us *UserStore) LoadUsers(ctx context.Context) error {
    secret := &v1.Secret{}
    err := us.client.Get(ctx, client.ObjectKey{
        Namespace: us.namespace,
        Name:      us.secretName,
    }, secret)
    
    if err != nil {
        return fmt.Errorf("failed to load users secret: %w", err)
    }
    
    usersData := secret.Data["users"]
    if usersData == nil {
        return fmt.Errorf("users key not found in secret")
    }
    
    // Parsear usuarios (formato: username:password_hash)
    scanner := bufio.NewScanner(strings.NewReader(string(usersData)))
    us.users = make(map[string]string)
    
    for scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())
        if line == "" || strings.HasPrefix(line, "#") {
            continue // Saltar líneas vacías y comentarios
        }
        
        parts := strings.SplitN(line, ":", 2)
        if len(parts) == 2 {
            username := strings.TrimSpace(parts[0])
            passwordHash := strings.TrimSpace(parts[1])
            us.users[username] = passwordHash
        }
    }
    
    return scanner.Err()
}

func (us *UserStore) ValidateUser(username, password string) bool {
    storedHash, exists := us.users[username]
    if !exists {
        return false
    }
    
    err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password))
    return err == nil
}

func (us *UserStore) CreateUser(username, password string) error {
    hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
    if err != nil {
        return err
    }
    
    us.users[username] = string(hash)
    return us.saveUsers(context.Background())
}

func (us *UserStore) saveUsers(ctx context.Context) error {
    var lines []string
    for username, hash := range us.users {
        lines = append(lines, fmt.Sprintf("%s:%s", username, hash))
    }
    
    usersData := strings.Join(lines, "\n")
    
    secret := &v1.Secret{
        ObjectMeta: metav1.ObjectMeta{
            Name:      us.secretName,
            Namespace: us.namespace,
        },
        StringData: map[string]string{
            "users": usersData,
        },
    }
    
    // Intentar actualizar primero
    existingSecret := &v1.Secret{}
    err := us.client.Get(ctx, client.ObjectKey{
        Namespace: us.namespace,
        Name:      us.secretName,
    }, existingSecret)
    
    if err != nil {
        // Si no existe, crear
        return us.client.Create(ctx, secret)
    } else {
        // Si existe, actualizar
        existingSecret.StringData = secret.StringData
        return us.client.Update(ctx, existingSecret)
    }
}
```

**Ventajas:**
- ✅ Integrado con Kubernetes
- ✅ Encriptado en etcd
- ✅ Fácil de gestionar con kubectl
- ✅ RBAC para controlar acceso
- ✅ No requiere base de datos adicional

**Desventajas:**
- ⚠️ Limitado a ~1MB por Secret
- ⚠️ No ideal para muchos usuarios (miles)
- ⚠️ Requiere recargar Secret cuando cambian usuarios

#### Opción B: ConfigMap (Solo para desarrollo/testing)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: kube-green-users
  namespace: keos-core
data:
  users: |
    admin:admin123
    operator:operator123
```

**⚠️ NO RECOMENDADO para producción** - Los passwords estarían en texto plano.

#### Opción C: Base de Datos (Para escalabilidad)

```go
// Estructura de tabla (PostgreSQL ejemplo)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP,
    active BOOLEAN DEFAULT TRUE
);

CREATE TABLE refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    revoked BOOLEAN DEFAULT FALSE
);
```

**Ventajas:**
- ✅ Escalable a miles de usuarios
- ✅ Búsquedas eficientes
- ✅ Auditoría completa
- ✅ Gestión avanzada de usuarios

**Desventajas:**
- ⚠️ Requiere base de datos adicional
- ⚠️ Más complejo de mantener
- ⚠️ Punto de falla adicional

### 2.2. Refresh Tokens Invalidados (Opcional)

Si quieres invalidar refresh tokens al hacer logout, necesitas persistir los tokens revocados:

#### Opción A: En memoria (Simple, pero se pierde al reiniciar)

```go
type TokenBlacklist struct {
    revokedTokens map[string]time.Time
    mu            sync.RWMutex
}

func (tb *TokenBlacklist) IsRevoked(tokenHash string) bool {
    tb.mu.RLock()
    defer tb.mu.RUnlock()
    
    expiresAt, exists := tb.revokedTokens[tokenHash]
    if !exists {
        return false
    }
    
    // Limpiar tokens expirados
    if time.Now().After(expiresAt) {
        delete(tb.revokedTokens, tokenHash)
        return false
    }
    
    return true
}
```

#### Opción B: Kubernetes Secret (Persistente)

```go
// Guardar tokens revocados en un Secret
// Formato: token_hash:expires_at (uno por línea)
```

#### Opción C: Base de Datos (Recomendado si usas DB)

```sql
CREATE TABLE revoked_tokens (
    token_hash VARCHAR(255) PRIMARY KEY,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_revoked_tokens_expires ON revoked_tokens(expires_at);
```

### 2.3. JWT Secret

**Ubicación:** Kubernetes Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: kube-green-jwt-secret
  namespace: keos-core
type: Opaque
stringData:
  jwt-secret: "your-super-secret-key-minimum-32-characters-long-change-this"
```

**Cargar en el código:**

```go
// internal/api/v1/auth/config.go

func LoadJWTSecret(k8sClient client.Client, namespace string) ([]byte, error) {
    secret := &v1.Secret{}
    err := k8sClient.Get(context.Background(), client.ObjectKey{
        Namespace: namespace,
        Name:      "kube-green-jwt-secret",
    }, secret)
    
    if err != nil {
        return nil, fmt.Errorf("failed to load JWT secret: %w", err)
    }
    
    jwtSecret := secret.Data["jwt-secret"]
    if jwtSecret == nil {
        return nil, fmt.Errorf("jwt-secret key not found")
    }
    
    return jwtSecret, nil
}
```

## 3. Configuración Recomendada

### Para Desarrollo/Testing

```yaml
# config/local-development/auth-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: kube-green-jwt-secret
  namespace: default
type: Opaque
stringData:
  jwt-secret: "dev-secret-key-change-in-production-12345678901234567890"

---
apiVersion: v1
kind: Secret
metadata:
  name: kube-green-users
  namespace: default
type: Opaque
stringData:
  users: |
    admin:$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
    # Password: admin123
```

### Para Producción

```yaml
# config/production/auth-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: kube-green-jwt-secret
  namespace: keos-core
type: Opaque
stringData:
  jwt-secret: ""  # Generar con: openssl rand -base64 32

---
apiVersion: v1
kind: Secret
metadata:
  name: kube-green-users
  namespace: keos-core
type: Opaque
stringData:
  users: |
    # Agregar usuarios con passwords hasheados
    admin:$2a$10$...
```

## 4. Scripts de Utilidad

### Generar hash de password

```bash
# Script: scripts/generate-password-hash.sh
#!/bin/bash
go run -tags tools github.com/golang/crypto/bcrypt/cmd/bcrypt "$1"
```

### Crear usuario

```bash
# Script: scripts/create-user.sh
#!/bin/bash
USERNAME=$1
PASSWORD=$2
NAMESPACE=${3:-keos-core}

# Generar hash
HASH=$(go run -tags tools github.com/golang/crypto/bcrypt/cmd/bcrypt "$PASSWORD" | tail -1)

# Agregar al Secret
kubectl get secret kube-green-users -n $NAMESPACE -o json | \
  jq --arg user "$USERNAME" --arg hash "$HASH" \
  '.stringData.users += "\n\($user):\($hash)"' | \
  kubectl apply -f -
```

## 5. Flujo Completo de Persistencia

```
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND (Navegador)                                        │
├─────────────────────────────────────────────────────────────┤
│ localStorage:                                                │
│   - accessToken                                             │
│   - refreshToken                                            │
│   - expiresAt                                               │
│   - username                                                │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ HTTP Request
                          │ Authorization: Bearer <token>
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ BACKEND (Kubernetes Pod)                                     │
├─────────────────────────────────────────────────────────────┤
│ Memoria (caché):                                            │
│   - userStore.users (map[string]string)                     │
│   - tokenBlacklist (map[string]time.Time)                   │
│                                                              │
│ Kubernetes Secrets:                                         │
│   - kube-green-jwt-secret                                   │
│     └─ jwt-secret: <secret key>                             │
│   - kube-green-users                                        │
│     └─ users: "username:password_hash\n..."                │
│   - kube-green-revoked-tokens (opcional)                    │
│     └─ tokens: "token_hash:expires_at\n..."                │
└─────────────────────────────────────────────────────────────┘
```

## 6. Recomendaciones Finales

### Para kube-green (Producción)

1. **Frontend:** localStorage para tokens (con HTTPS obligatorio)
2. **Backend Usuarios:** Kubernetes Secrets (suficiente para < 100 usuarios)
3. **Backend JWT Secret:** Kubernetes Secret
4. **Refresh Tokens Revocados:** En memoria con limpieza periódica (o Secret si necesitas persistencia)
5. **Hot Reload:** Implementar watch en el Secret de usuarios para recargar sin reiniciar

### Consideraciones de Seguridad

- ✅ **HTTPS obligatorio** en producción
- ✅ **JWT Secret mínimo 32 caracteres** aleatorios
- ✅ **Passwords hasheados con bcrypt** (cost 10+)
- ✅ **Content Security Policy** en el frontend
- ✅ **Rate limiting** en endpoint de login
- ✅ **Auditoría de accesos** (logs de login/logout)

### Migración Gradual

1. Fase 1: Implementar con usuarios hardcodeados en código
2. Fase 2: Migrar a Kubernetes Secrets
3. Fase 3: (Opcional) Migrar a base de datos si se necesita escalar

