# Project Explanation: File-by-File Interview Defense Guide

This guide breaks down each core file of the WebRTC project. A Backend SDE-1 candidate should review this document to explain and defend any file in under 5 minutes during a technical interview.

---

### 1. `server/src/server.js`
- **Why it exists**: Serves as the server entry point, bootstrapping the HTTP server for health checks and attaching the WebSocket Server (WSS).
- **Who calls it**: Node.js runtime inside the container via `npm start` (CMD in Dockerfile).
- **If removed**: The backend fails to boot, meaning WebSocket listeners are never established and signaling cannot take place.
- **Protocols used**: TCP, HTTP (for `/health`), WebSocket (WS handshake upgrade).
- **Docker concepts**: Port exposure (`8080`), container entry point (`CMD`).
- **Interview questions**: Why separate server bootstrap from signaling logic? (Separation of Concerns). How do HTTP and WebSockets share a port? (HTTP Upgrade Header).

### 2. `server/src/signaling.js`
- **Why it exists**: Manages in-memory WebRTC rooms (`Map<roomId, Set<wsClient>>`) and routes SDP/ICE payloads to correct peers.
- **Who calls it**: `server.js` passes incoming WebSocket connection instances and message buffers to this module.
- **If removed**: WebSocket connections succeed, but the server won't parse messages, track rooms, or forward signaling data between peers.
- **Protocols used**: WebSocket (WS frame parsing, JSON messaging).
- **Docker concepts**: Internal container communication on user-defined networks.
- **Interview questions**: Why room-based signaling instead of broadcasting? (Security, network optimization). How does connection cleanup work in $O(1)$? (By attaching `roomId` directly to the socket connection object).

### 3. `server/Dockerfile`
- **Why it exists**: Defines the environment and build steps needed to bundle and run the Node.js signaling application in a container.
- **Who calls it**: Docker engine during `docker compose up --build` or manual image building.
- **If removed**: The signaling server cannot be containerized, breaking environment consistency and preventing Docker Compose execution.
- **Protocols used**: HTTP/HTTPS (to download Alpine base image and NPM packages).
- **Docker concepts**: Image inheritance (`FROM`), build caching (`COPY package.json` order), environment sandbox (`WORKDIR`).
- **Interview questions**: Why use `node:18-alpine`? (Small foot-print, security). Why copy `package.json` before `src/`? (Caches NPM layers, optimizing build times).

### 4. `docker-compose.yml`
- **Why it exists**: Orchestrates building, configuration, and execution of frontend (Nginx) and backend (Node.js) containers.
- **Who calls it**: Developer running `docker compose` commands in CLI.
- **If removed**: Developers must build and run each container manually via long CLI strings, mapping ports and networks individually.
- **Protocols used**: Internal Docker networking protocols.
- **Docker concepts**: Service definitions, volume mapping (`volumes`), port mapping (`ports`), custom bridge networking (`driver: bridge`).
- **Interview questions**: What is the difference between `expose` and `ports`? (Expose is internal network only; ports maps to host). Why use a custom bridge network? (Allows container resolution via DNS).

### 5. `client/nginx.conf`
- **Why it exists**: Configures Nginx to serve static files and act as a reverse proxy routing `/ws` connections to the backend.
- **Who calls it**: Nginx service within the `client` container on startup.
- **If removed**: Nginx uses default configuration, failing to route WebSocket `/ws` traffic to the backend, causing client connection errors.
- **Protocols used**: HTTP, WebSocket (Upgrade headers: Connection & Upgrade).
- **Docker concepts**: Configuration mounting via read-only volumes (`:ro`), container DNS hostname resolution (`http://signaling:8080`).
- **Interview questions**: Why use a reverse proxy? (Solves CORS, enables single-port entry, hides backend topology). How does Nginx find the signaling server? (Via Docker bridge DNS).

### 6. `client/js/app.js`
- **Why it exists**: Executes the WebRTC connection lifecycle on the client (SDP offer/answer, ICE gathering, and state UI updates).
- **Who calls it**: The user's browser, loaded by `index.html`.
- **If removed**: The client UI is non-interactive; camera capture, signaling connections, and P2P negotiations cannot function.
- **Protocols used**: WebSocket (client socket API), WebRTC (SDP, ICE, SRTP for media).
- **Docker concepts**: None (runs entirely inside user browser environment).
- **Interview questions**: What is the purpose of STUN? (Resolves client public IP/port behind NATs). What is an ICE candidate? (A network routing path option). What does the local video require to prevent feedback? (Mute option).

### 7. `client/index.html`
- **Why it exists**: Provides the semantic structure and UI layout for the WebRTC video client.
- **Who calls it**: Serves as the index page when Nginx processes a root GET request on port `3000`.
- **If removed**: Accessing `http://localhost:3000` returns a blank page or directory listing; users have no UI to interact with.
- **Protocols used**: HTTP (requesting document).
- **Docker concepts**: File serving via Nginx container volume mounts.
- **Interview questions**: Why defer JavaScript execution? (Ensures DOM is loaded before elements are selected). Why are autoplay and playsinline properties set on videos? (Forces instant rendering without user-click on mobile devices).
