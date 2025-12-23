# kube-green Frontend - Deployment en keos-core

## Prerequisitos

- Acceso al cluster Kubernetes
- Permisos para crear recursos en el namespace `keos-core`
- Docker registry configurado (ej: Docker Hub)

## Pasos de Deployment

### 1. Construir la Imagen Docker

```bash
cd frontend-app
docker build --build-arg VITE_AUTH_ENABLED=true -t yeramirez/kube-front:0.7.19 .
```

### 2. Subir la Imagen al Registry

```bash
docker push yeramirez/kube-front:0.7.19
```

### 3. Verificar Namespace keos-core

```bash
kubectl get namespace keos-core
```

Si no existe, crearlo:
```bash
kubectl create namespace keos-core
```

### 4. Desplegar el Frontend

```bash
kubectl apply -f k8s/deployment.yaml
```

### 5. Verificar el Deployment

```bash
# Ver pods
kubectl get pods -n keos-core -l app=kube-green-frontend

# Ver servicios
kubectl get svc -n keos-core kube-green-frontend-service

# Ver logs
kubectl logs -n keos-core -l app=kube-green-frontend --tail=50
```

### 6. Verificar el Ingress

```bash
kubectl get ingress -n keos-core kube-green-frontend-ingress
```

### 7. Acceder al Frontend

Según la configuración del Ingress, el frontend estará disponible en:
- `http://kube-green-frontend.keos-core.local` (requiere configuración DNS/hosts)

Para acceder directamente via port-forward durante pruebas:

```bash
kubectl port-forward -n keos-core svc/kube-green-frontend-service 8080:80
```

Luego acceder en: `http://localhost:8080`

## Actualización de la Imagen

Para actualizar el deployment con una nueva versión:

```bash
# 1. Construir nueva imagen
docker build --build-arg VITE_AUTH_ENABLED=true -t yeramirez/kube-front:0.7.19 .

# 2. Subir al registry
docker push yeramirez/kube-front:0.7.19

# 3. Actualizar deployment
kubectl set image deployment/kube-green-frontend frontend=yeramirez/kube-front:0.7.19 -n keos-core

# 4. Verificar rollout
kubectl rollout status deployment/kube-green-frontend -n keos-core
```

## Troubleshooting

### Pods no inician

```bash
kubectl describe pod -n keos-core -l app=kube-green-frontend
```

### Verificar conectividad con backend

```bash
# Desde dentro del pod
kubectl exec -it -n keos-core deployment/kube-green-frontend -- wget -O- http://kube-green-controller-manager-metrics-service.keos-core.svc.cluster.local:8080/api/v1/health
```

### Verificar configuración de Nginx

```bash
kubectl exec -it -n keos-core deployment/kube-green-frontend -- cat /etc/nginx/conf.d/default.conf
```

## Rollback

Si necesitas hacer rollback:

```bash
kubectl rollout undo deployment/kube-green-frontend -n keos-core
```


