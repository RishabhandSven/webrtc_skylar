# Dockerfile
# ==============================================================================
# Purpose: Containerize the Node.js WebSocket signaling server.
# Responsibilities: Pulls lightweight Node runtime, installs dependencies,
#                   exposes internal port 8080, and boots the signaling server.
# Interactions: Docker Compose builds this container and places it on the bridge network.
#
# Interview Rationale:
# - Why node:18-alpine? Alpine is a minimal security-focused Linux distro (~5MB base size).
#   It keeps the image footprint small and reduces the vulnerability attack surface.
# - Why COPY package.json first? Docker builds in layers. Copying package.json and running
#   npm install before copying src allows Docker to cache the node_modules layer. If source
#   code changes but dependencies do not, Docker skips package installation, speeding up builds.
# - Simplest Alternative: Run node directly on the host. (Prone to "works on my machine" issues).
# - Production Alternative: Multi-stage builds to discard build dependencies, or distroless images.
# ==============================================================================

FROM node:18-alpine

# Set working directory inside the container
WORKDIR /app

# Copy dependency configuration
COPY package.json ./

# Install only production dependencies (no devDependencies needed for running)
RUN npm install --omit=dev

# Copy the rest of the application source code
COPY src/ ./src/

# Inform Docker that the container listens on port 8080 at runtime
EXPOSE 8080

# Command to execute the signaling server
CMD ["node", "src/server.js"]
