/**
 * @file app.js
 * 
 * PURPOSE:
 * - Manages the client-side WebRTC connection lifecycle and WebSocket signaling.
 * - Handles local media stream capture, peer connection setup, SDP exchange, and ICE candidate relay.
 * 
 * RESPONSIBILITIES:
 * - Connects to the signaling server via Nginx WebSocket proxy.
 * - Captures user video/audio using the browser's MediaDevices API.
 * - Controls UI button enabling/disabling and connection state badges.
 * - Manages RTCPeerConnection (handling ICE gathering, remote track routing, and local/remote description configuration).
 * 
 * INTERACTIONS:
 * - Called by: index.html (loaded via defer).
 * - Calls: Browser WebRTC APIs (RTCPeerConnection, navigator.mediaDevices) and WebSockets.
 * 
 * INTERVIEW ARCHITECTURAL RATIONALE (SDE-1 DEFENSE):
 * 1. Why connect to "/ws" dynamically instead of "localhost:8080"?
 *    - Avoids hardcoding URLs. Connecting to `ws://${window.location.host}/ws` guarantees that whether 
 *      the app is running on localhost, in Docker on port 3000, or deployed in production, the websocket
 *      request automatically targets the correct domain and port, proxied transparently by Nginx.
 * 2. Why is the local video element muted?
 *    - To prevent acoustic feedback loops. If the local microphone output is played back locally,
 *      it creates an escalating, high-pitched screeching loop.
 * 3. Simpler Alternative:
 *    - Hardcode the connection URL (breaks container portability).
 * 4. Production Alternative:
 *    - Implement custom retry logic for WebSocket drops, use a TURN server for symmetric NAT traversal,
 *      and implement audio track volume adjustments/video toggle controls.
 * 5. Why this is appropriate for SDE-1:
 *    - It showcases standard WebRTC APIs, STUN resolution, and clean event-driven state updates 
 *      without the clutter of third-party wrapper libraries (like SimplePeer).
 */

// 1. DOM Elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startBtn = document.getElementById('startBtn');
const callBtn = document.getElementById('callBtn');
const roomIdInput = document.getElementById('roomIdInput');
const statusBadge = document.getElementById('statusBadge');

// 2. Global WebRTC/Signaling State Variables
let localStream;
let peerConnection;
let ws;
let currentRoomId = '';

// Free public STUN server provided by Google.
// STUN (Session Traversal Utilities for NAT) resolves the client's public-facing IP and port.
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

// Immediately establish connection to the WebSocket signaling proxy on page load.
initializeWebSocket();

/**
 * Connects to the signaling server via Nginx and registers message handlers.
 * 
 * Why it exists: Establishes the real-time communication channel required for WebRTC handshake.
 * When it executes: Immediately when the script loads.
 * What it does: Opens a WebSocket connection to the host on `/ws`, and binds open/message/error listeners.
 */
function initializeWebSocket() {
  // Construct dynamic WS URL. Nginx proxies '/ws' to signaling container on 8080.
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  console.log(`[WebSocket] Connecting to signaling server at: ${wsUrl}`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WebSocket] Connected to signaling channel.');
  };

  ws.onmessage = async (event) => {
    await handleSignalingMessage(event.data);
  };

  ws.onclose = () => {
    console.warn('[WebSocket] Connection closed. Reconnect required for signaling.');
    updateStatusBadge('disconnected');
  };

  ws.onerror = (error) => {
    console.error('[WebSocket] Error occurred:', error);
  };
}

/**
 * Handles incoming signaling messages relayed from the peer.
 * 
 * Why it exists: Processes WebRTC handshakes (offers, answers, ICE candidates) from the remote peer.
 * When it executes: Automatically when the WebSocket receives a message.
 * What it does: Parses the payload, matching the type to configure the RTCPeerConnection state.
 * 
 * @param {String} rawData - Stringified JSON signaling payload.
 */
async function handleSignalingMessage(rawData) {
  let message;
  try {
    message = JSON.parse(rawData);
  } catch (err) {
    console.error('[WebSocket] Failed to parse message payload:', err.message);
    return;
  }

  // Double check that we are processing a message for the room we joined
  if (message.roomId !== currentRoomId) {
    return;
  }

  try {
    switch (message.type) {
      case 'offer':
        console.log('[WebRTC] Received SDP Offer from peer. Creating Answer...');
        // A remote peer wants to connect. Set their SDP description, create ours, and reply.
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        sendSignalingPayload({
          type: 'answer',
          answer: answer
        });
        break;

      case 'answer':
        console.log('[WebRTC] Received SDP Answer from peer. Handshake complete.');
        // Our offer was accepted. Set the peer's remote description.
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
        break;

      case 'ice-candidate':
        console.log('[WebRTC] Received ICE Candidate from peer. Adding candidate...');
        // Add the peer's network path candidate.
        await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
        break;

      default:
        console.warn(`[WebRTC] Unknown signaling message type: ${message.type}`);
    }
  } catch (err) {
    console.error('[WebRTC] Error handling signaling message:', err);
  }
}

// 3. User Interactions / Event Bindings

// Button 1: Captures webcam stream and initializes PeerConnection
startBtn.onclick = async () => {
  const targetRoom = roomIdInput.value.trim();
  if (!targetRoom) {
    alert('Please enter a valid Room ID first.');
    return;
  }

  currentRoomId = targetRoom;
  startBtn.disabled = true;
  roomIdInput.disabled = true;

  try {
    // 1. Request user permission for camera stream (audio omitted for easy local testing)
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    localVideo.srcObject = localStream;
    console.log('[Media] Successfully obtained local video stream.');

    // 2. Connect to the room on signaling server
    sendSignalingPayload({ type: 'join' });

    // 3. Initialize the RTCPeerConnection object
    initializePeerConnection();

    // 4. Enable the "Connect Peer" button
    callBtn.disabled = false;
  } catch (err) {
    console.error('[Media] Failed to capture camera:', err);
    alert(`Could not start camera: ${err.message}. Please verify permissions.`);
    startBtn.disabled = false;
    roomIdInput.disabled = false;
  }
};

// Button 2: Initiates call by creating and sending an SDP Offer
callBtn.onclick = async () => {
  callBtn.disabled = true;
  console.log('[WebRTC] Initiating call... Creating SDP Offer.');

  try {
    // Create an offer specifying our media configuration
    const offer = await peerConnection.createOffer();
    // Set it as our local configuration
    await peerConnection.setLocalDescription(offer);
    
    // Broadcast the SDP offer to the signaling server
    sendSignalingPayload({
      type: 'offer',
      offer: offer
    });
  } catch (err) {
    console.error('[WebRTC] Failed to create SDP offer:', err);
    callBtn.disabled = false;
  }
};

// 4. Core WebRTC Mechanics

/**
 * Creates the RTCPeerConnection instance and registers media and network event listeners.
 * 
 * Why it exists: Sets up the WebRTC protocol pipeline inside the browser.
 * When it executes: Triggered directly after successfully starting the local webcam.
 * What it does: Instantiates RTCPeerConnection, adds local tracks, registers track reception,
 *              registers ICE candidate gathering, and tracks connection state changes.
 */
function initializePeerConnection() {
  console.log('[WebRTC] Initializing RTCPeerConnection with STUN server configuration.');
  peerConnection = new RTCPeerConnection(rtcConfig);

  // 1. Add local media tracks to the peer connection so they will be streamed
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // 2. Listen for remote media tracks. When they arrive, bind them to the remote video element.
  peerConnection.ontrack = (event) => {
    console.log('[WebRTC] Received remote stream track.');
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    }
  };

  // 3. Listen for ICE candidates. When candidate is found, relay it to the remote peer.
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingPayload({
        type: 'ice-candidate',
        candidate: event.candidate
      });
    }
  };

  // 4. Monitor Connection State. Essential for displaying correct connection statuses.
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log(`[WebRTC] PeerConnection State changed to: ${state}`);
    updateStatusBadge(state);
  };
}

// 5. Utility Helpers

/**
 * Sends a structured JSON payload to the WebSocket signaling server.
 * 
 * Why it exists: Centralizes outgoing communication and automatically attaches current roomId.
 * When it executes: Whenever signaling logic wants to talk to the backend.
 * What it does: Injects roomId, wraps payload, stringifies, and sends it via WebSocket if open.
 * 
 * @param {Object} payload - Message details to send (e.g. { type: 'offer', offer: sdp }).
 */
function sendSignalingPayload(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    payload.roomId = currentRoomId; // Attach room context
    ws.send(JSON.stringify(payload));
  } else {
    console.error('[WebSocket] Cannot send payload. Connection is not OPEN.');
  }
}

/**
 * Updates the UI status badge text and color class based on the WebRTC/WS connection state.
 * 
 * Why it exists: Enhances user visibility into the hidden WebRTC connection states.
 * When it executes: Triggered when peer connection state changes or WebSocket disconnects.
 * What it does: Resets badge CSS classes, determines active state, and updates text and background color.
 * 
 * @param {String} state - The connection state (e.g., 'connected', 'connecting', 'disconnected', 'failed').
 */
function updateStatusBadge(state) {
  statusBadge.className = 'badge'; // Reset classes

  switch (state.toLowerCase()) {
    case 'connected':
      statusBadge.classList.add('badge-connected');
      statusBadge.textContent = 'Connected';
      break;
    case 'connecting':
    case 'checking':
      statusBadge.classList.add('badge-connecting');
      statusBadge.textContent = 'Connecting';
      break;
    case 'disconnected':
    case 'failed':
    case 'closed':
      statusBadge.classList.add('badge-disconnected');
      statusBadge.textContent = 'Disconnected';
      break;
    default:
      statusBadge.classList.add('badge-disconnected');
      statusBadge.textContent = 'Unknown';
  }
}
