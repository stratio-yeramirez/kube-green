#!/bin/sh
set -e

# Substitute environment variables in nginx.conf.template
envsubst '${API_SERVICE_NAME} ${API_SERVICE_PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# Start nginx
exec nginx -g 'daemon off;'


