# Dockerfile
# ==============================================================================
# SDE-1 Interview Guide: Single-Container Render Deployment Dockerfile
# 
# Purpose: Bundles Nginx and Node.js signaling server into a single run context.
# Responsibilities:
# 1. Installs Node.js & NPM on top of the nginx:alpine base image.
# 2. Bundles and installs Node.js package dependencies (ws).
# 3. Copies client frontend files to Nginx directory.
# 4. Sets up Nginx templates for dynamic environment substitution.
# 
# Why this approach?
# Standard Docker projects use multiple containers. For Render Free tier, we package
# both services into one. Node.js runs internally on port 8080. Nginx listens on Render's
# public PORT and reverse proxies `/ws` to Node.js locally.
# ==============================================================================

FROM nginx:alpine

# Install Node.js and NPM on Alpine
RUN apk add --no-cache nodejs npm

# Set up signaling backend directories
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --omit=dev

# Copy backend source code
COPY server/src/ ./src/

# Copy client frontend static files (HTML, CSS, JS)
COPY client/ /usr/share/nginx/html/

# Copy the Nginx template file into the standard Nginx template path
COPY client/nginx.conf.template /etc/nginx/templates/nginx.conf.template

# Configure envsubst to write directly to /etc/nginx/nginx.conf (replacing Nginx default)
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx

# Copy and configure the custom startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Start the combined services
CMD ["/bin/sh", "/app/start.sh"]
