/**
 * @file server.js
 * 
 * PURPOSE:
 * - Bootstraps the Node.js HTTP server and mounts the WebSocket Server (WSS).
 * - Exposes port 8080 inside the Docker container.
 * 
 * RESPONSIBILITIES:
 * - Creates an HTTP server to satisfy standard health checks (useful in real deployments).
 * - Attaches the 'ws' WebSocket Server to the HTTP server instance.
 * - Listens for incoming connections and immediately hands them off to the signaling manager (signaling.js).
 * 
 * INTERACTIONS:
 * - Called by: Node runtime via Docker CMD or npm start.
 * - Calls: signaling.js (`initializeSignaling` function) to manage client connections and routing.
 * 
 * INTERVIEW ARCHITECTURAL RATIOANLE (SDE-1 DEFENSE):
 * 1. Why separate server.js and signaling.js?
 *    - Separation of Concerns (SoC). server.js manages the transport layer (HTTP/TCP binding), 
 *      while signaling.js manages the business domain (WebRTC rooms and message routing).
 *      This makes the code modular, easier to write unit tests for, and clean.
 * 2. Simpler Alternative:
 *    - Instantiating a raw WebSocketServer without an underlying HTTP server: `new WebSocketServer({ port: 8080 })`.
 * 3. Production Alternative:
 *    - Using a framework like Fastify or Express to serve REST endpoints alongside WebSockets,
 *      and using HTTPS (SSL/TLS) terminated at an API gateway or load balancer.
 * 4. Why this is appropriate for SDE-1:
 *    - It shows clear separation of concerns (networking vs domain logic) without introducing
 *      bloated HTTP frameworks, making it easy to explain in under 2 minutes.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const { handleNewConnection } = require('./signaling');

// Read port from environment, fallback to 8080
const PORT = process.env.PORT || 8080;

/**
 * Initializes and starts the HTTP and WebSocket servers.
 * 
 * Why it exists: Orchestrates the initialization of HTTP/TCP sockets and WebSocket servers.
 * When it executes: Immediately when the server script runs.
 * What it does: Sets up a lightweight HTTP handler for health checks, instantiates the
 * WebSocket server attached to HTTP, registers connection events, and begins listening.
 */
function startServer() {
  // 1. Create a basic HTTP server. Useful for container health checks.
  const httpServer = http.createServer((request, response) => {
    if (request.url === '/health' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'UP', timestamp: new Date().toISOString() }));
    } else {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not Found');
    }
  });

  // 2. Attach WebSocket server to the HTTP server.
  // This allows sharing the same TCP port (8080) for both HTTP requests and WebSocket handshakes.
  const wss = new WebSocketServer({ server: httpServer });

  // 3. Delegate connection logic to the signaling engine
  wss.on('connection', (socket, request) => {
    handleNewConnection(socket, request);
  });

  // 4. Start listening
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Signaling service running on http://localhost:${PORT}`);
    console.log(`[Server] WebSocket endpoints listening at ws://localhost:${PORT}`);
  });
}

// Start the server
startServer();
