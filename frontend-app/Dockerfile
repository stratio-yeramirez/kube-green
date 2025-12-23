FROM node:20-alpine AS builder

WORKDIR /app

# Accept build arguments for Vite environment variables
ARG VITE_AUTH_ENABLED=false
ENV VITE_AUTH_ENABLED=$VITE_AUTH_ENABLED

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./
COPY vite.config.ts ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy source code
COPY src ./src
COPY index.html ./

# Verify files exist
RUN ls -la /app/src/hooks/ && ls -la /app/src/utils/ && ls -la /app/src/types/

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Install envsubst for environment variable substitution
RUN apk add --no-cache gettext

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration template
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]

