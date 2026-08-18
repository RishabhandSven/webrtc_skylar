#!/bin/sh
# ==============================================================================
# SDE-1 Interview Guide: start.sh
# 
# Purpose: Entry point script that boots both Node.js (signaling) and Nginx (proxy).
# Responsibilities:
# 1. Sets dynamic fallbacks for PORT and SIGNALING_HOST.
# 2. Runs the Node.js signaling server in the background, overriding PORT to 8080
#    to prevent port conflict with Nginx.
# 3. Executes Nginx's default docker entrypoint to process templates and run in the foreground.
# 
# Why this approach?
# Render's Free tier limits deployment to a single Web Service exposing a single port.
# Running Node.js as a background process and Nginx as the foreground master process
# allows us to serve the frontend and proxy connections from the exact same container instance.
# Overriding PORT=8080 for the node command avoids conflict when Nginx binds to Render's public PORT.
# ==============================================================================

# Set fallback environment variables for template substitution
export PORT=${PORT:-3000}
export SIGNALING_HOST=${SIGNALING_HOST:-localhost}

# 1. Start the Node.js signaling server in the background on internal port 8080
echo "[Start] Starting Node.js signaling server on internal port 8080..."
PORT=8080 node /app/server/src/server.js &

# 2. Handoff control to the Nginx base image entrypoint (starts Nginx in the foreground)
echo "[Start] Starting Nginx entrypoint on port $PORT proxying to $SIGNALING_HOST:8080..."
exec /docker-entrypoint.sh nginx -g "daemon off;"
