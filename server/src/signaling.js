/**
 * @file signaling.js
 * 
 * PURPOSE:
 * - Coordinates WebRTC signaling by orchestrating rooms and forwarding messages.
 * - Ensures that SDP offers, answers, and ICE candidates are sent ONLY to peers within the same room.
 * 
 * RESPONSIBILITIES:
 * - Maintains an in-memory map of active rooms (`Map<String, Set<WebSocket>>`).
 * - Handles client message parsing and event routing (`join`, `offer`, `answer`, `ice-candidate`).
 * - Cleans up active connections on close or network error to prevent memory leaks.
 * 
 * INTERACTIONS:
 * - Called by: server.js (`handleNewConnection`) when a client opens a WebSocket connection.
 * - Calls: Node 'ws' socket API to send/receive messages to the browser clients.
 * 
 * INTERVIEW ARCHITECTURAL RATIONALE (SDE-1 DEFENSE):
 * 1. Why room-based signaling instead of broadcasting to everyone?
 *    - Scale and isolation. If the server broadcasts to all connected clients, clients would receive
 *      SDP offers for streams they never requested, causing connection failures and wasting massive bandwidth.
 *      Rooms ensure traffic isolation.
 * 2. Why store the Room ID on the socket object (e.g., `socket.roomId`)?
 *    - Performance (O(1) lookup). When a socket closes, we need to remove it from its room. If we didn't 
 *      store the Room ID on the socket, we would have to loop through every room in our Map (O(N) search)
 *      to find and remove the socket. Storing the Room ID lets us immediately target the correct Set.
 * 3. Simpler Alternative:
 *    - Broadcast every message to every socket. (Extremely prone to collision; works only for exactly 2 users).
 * 4. Production Alternative:
 *    - Use Redis Pub/Sub to share room state across multiple nodes. (Required if signaling server scales horizontally, 
 *      since WebSockets are stateful and clients in the same room might connect to different instances).
 * 5. Why this is appropriate for SDE-1:
 *    - It keeps signaling state in memory (simple JavaScript Map) to avoid infrastructure complexity (Redis),
 *      but uses clean O(1) references to prove performance consciousness.
 */

// In-memory data store for rooms.
// Key: roomId (string) -> Value: Set of connected WebSocket objects
const rooms = new Map();

/**
 * Handles initialization for a newly connected WebSocket client.
 * 
 * Why it exists: Entry point for WebSocket connection events. Sets up listeners.
 * When it executes: Invoked by server.js immediately when a new WebSocket handshake completes.
 * What it does: Logs connection details, attaches message/error/close listeners, and starts monitoring.
 * 
 * @param {import('ws').WebSocket} socket - The newly opened client WebSocket connection.
 * @param {import('http').IncomingMessage} request - The HTTP upgrade request details.
 */
function handleNewConnection(socket, request) {
  const clientIp = request.socket.remoteAddress;
  console.log(`[Signaling] New WebSocket connection from IP: ${clientIp}`);

  // Setup event listeners for this specific client
  socket.on('message', (messageBuffer) => {
    handleIncomingMessage(socket, messageBuffer);
  });

  socket.on('close', () => {
    console.log(`[Signaling] Client connection closed from IP: ${clientIp}`);
    cleanupClient(socket);
  });

  socket.on('error', (error) => {
    console.error(`[Signaling] Socket error from IP: ${clientIp}:`, error.message);
    cleanupClient(socket);
  });
}

/**
 * Parses and dispatches incoming WebSocket text messages.
 * 
 * Why it exists: Acts as the router/controller for the signaling protocol.
 * When it executes: Whenever the client sends a message over the WebSocket connection.
 * What it does: Safely parses JSON. Looks at 'type' to decide if client is joining a room or routing signaling payloads.
 * 
 * @param {import('ws').WebSocket} socket - The sending client socket.
 * @param {Buffer|String} messageBuffer - Raw payload sent by the client.
 */
function handleIncomingMessage(socket, messageBuffer) {
  let payload;
  try {
    payload = JSON.parse(messageBuffer.toString());
  } catch (err) {
    console.error('[Signaling] Failed to parse JSON message:', err.message);
    return;
  }

  const { type, roomId } = payload;

  // Basic validation: signaling messages require a type and a target room
  if (!type || !roomId) {
    console.warn('[Signaling] Received message missing type or roomId:', payload);
    return;
  }

  switch (type) {
    case 'join':
      handleRoomJoin(socket, roomId);
      break;

    case 'offer':
    case 'answer':
    case 'ice-candidate':
      forwardSignalingMessage(socket, roomId, payload);
      break;

    default:
      console.warn(`[Signaling] Received unknown message type: ${type}`);
  }
}

/**
 * Handles adding a client to an active signaling room.
 * 
 * Why it exists: Implements the room membership logic.
 * When it executes: Triggered when a client sends a { type: 'join' } message.
 * What it does: Creates room Set if it doesn't exist, adds socket, and links the roomId to the socket object.
 * 
 * @param {import('ws').WebSocket} socket - The client socket wishing to join.
 * @param {String} roomId - The identifier of the room to join.
 */
function handleRoomJoin(socket, roomId) {
  // If socket was already in a room, remove them from it first
  if (socket.roomId && socket.roomId !== roomId) {
    cleanupClient(socket);
  }

  // Create room Set if it's new
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  const clientSet = rooms.get(roomId);
  
  // Optional limit: WebRTC P2P in this basic setup is 1-to-1.
  // We can let multiple join, but we warn if more than 2 are in the room.
  if (clientSet.size >= 2) {
    console.log(`[Signaling] Room ${roomId} already has ${clientSet.size} peers. Connecting a third peer may cause conflicts.`);
  }

  clientSet.add(socket);
  socket.roomId = roomId; // Store Room ID directly on socket for O(1) cleanup reference

  console.log(`[Signaling] Peer joined Room: "${roomId}". Active peers in room: ${clientSet.size}`);
}

/**
 * Forwards signaling messages (Offers, Answers, ICE Candidates) to all other peers in the room.
 * 
 * Why it exists: Performs the core relay function of WebRTC signaling.
 * When it executes: When an 'offer', 'answer', or 'ice-candidate' is received from a client.
 * What it does: Looks up the room Set and forwards the message string to every socket except the sender.
 * 
 * @param {import('ws').WebSocket} senderSocket - The socket that sent the signaling data.
 * @param {String} roomId - The room target.
 * @param {Object} payload - The signaling payload to forward.
 */
function forwardSignalingMessage(senderSocket, roomId, payload) {
  const clientSet = rooms.get(roomId);
  
  if (!clientSet) {
    console.warn(`[Signaling] Attempted to route to non-existent room: ${roomId}`);
    return;
  }

  let broadcastCount = 0;
  const messageString = JSON.stringify(payload);

  clientSet.forEach((clientSocket) => {
    // Forward only to OTHER open connections in the room
    if (clientSocket !== senderSocket && clientSocket.readyState === 1) { // 1 = WebSocket.OPEN
      clientSocket.send(messageString);
      broadcastCount++;
    }
  });

  console.log(`[Signaling] Relayed "${payload.type}" message in room "${roomId}" to ${broadcastCount} peer(s)`);
}

/**
 * Cleans up room records when a client disconnects.
 * 
 * Why it exists: Prevents memory leaks by cleaning up references to disconnected sockets.
 * When it executes: Triggered when a socket emits a 'close' or 'error' event.
 * What it does: Checks if the socket has a stored roomId. Removes socket from that room.
 *              Deletes the room from map if it becomes empty.
 * 
 * @param {import('ws').WebSocket} socket - The socket to clean up.
 */
function cleanupClient(socket) {
  const { roomId } = socket;
  if (!roomId) return; // Client was never in a room

  const clientSet = rooms.get(roomId);
  if (clientSet) {
    clientSet.delete(socket);
    console.log(`[Signaling] Removed client from Room: "${roomId}". Remaining: ${clientSet.size}`);

    // If room is now empty, delete it to free memory
    if (clientSet.size === 0) {
      rooms.delete(roomId);
      console.log(`[Signaling] Room "${roomId}" is empty. Cleaned up room instance.`);
    }
  }

  // Clear roomId attribute to prevent double cleanup
  socket.roomId = null;
}

module.exports = {
  handleNewConnection,
  rooms // Exported mainly for debugging or inspection purposes
};
