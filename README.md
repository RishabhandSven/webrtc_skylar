# Reference Architecture: Room-Based WebRTC P2P Video Platform

This project implements a clean, production-ready, and highly defendable WebRTC peer-to-peer (P2P) video streaming architecture. Designed specifically for Backend SDE-1 technical interviews, it avoids overengineering and complex abstractions, focusing instead on core principles: **Separation of Concerns**, **Containerization**, **Docker Networking**, and **Nginx Reverse Proxying**.

---

## 1. System Architecture

```text
       +--------------------------------------------------------+
       |                     Host Machine                       |
       |                                                        |
       |    +------------------+       +-------------------+    |
       |    | Browser A (User) |       | Browser B (User)  |    |
       |    +--------+---------+       +---------+---------+    |
       |             |                           |              |
       |             | Port 3000                 | Port 3000    |
       +-------------+---------------------------+--------------+
                     |                           |
                     v                           v
       +--------------------------------------------------------+
       | Docker Compose (Bridge Network: webrtc-net)            |
       |                                                        |
       |         +------------------------------------+         |
       |         | nginx-frontend (Container)         |         |
       |         | - Serves index.html, style.css,    |         |
       |         |   app.js on Port 80                |         |
       |         | - Reverse proxies /ws to           |         |
       |         |   signaling-backend:8080           |         |
       |         +-----------------+------------------+         |
       |                           |                            |
       |                           | Internal DNS: signaling    |
       |                           v                            |
       |         +------------------------------------+         |
       |         | signaling-backend (Container)      |         |
       |         | - Node.js + WebSocket Server       |         |
       |         | - Handles rooms & routes SDP/ICE   |         |
       |         +------------------------------------+         |
       +--------------------------------------------------------+
                     |                           |
                     |                           | (WebRTC Signaling Complete)
                     |                           |
                     +=========== Media Path ====+ (Direct P2P Stream via UDP)
                                 (STUN Assisted)
```

---

## 2. Folder Structure

```text
webrtc_skylar/
├── docker-compose.yml       # Orchestrates signaling server & Nginx web server
├── README.md                # This comprehensive documentation & Interview Guide
├── PROJECT_EXPLANATION.md   # File-by-file interview defense guide
├── client/
│   ├── index.html           # Simple, modern dark theme layout
│   ├── css/
│   │   └── style.css        # Clean, usable, production-style CSS
│   ├── js/
│   │   └── app.js           # WebRTC client & signaling interactions
│   └── nginx.conf           # Simple Nginx configuration (static hosting + WS reverse proxy)
└── server/
    ├── src/
    │   ├── server.js        # Bootstraps Node.js HTTP + WebSocket server
    │   └── signaling.js     # WebSocket connection & signaling domain logic
    ├── Dockerfile           # Simple, single-stage alpine-based build
    ├── .dockerignore        # Excludes node_modules and logs from build context
    └── package.json         # Package configuration (only depends on 'ws')
```

---

## 3. Technology Stack

- **Frontend**: HTML5 (Semantic Structure), CSS3 (Custom Variables, Flexbox/Grid layouts), Vanilla JavaScript (WebRTC API, WebSocket API).
- **Backend**: Node.js (v18 Alpine), `ws` library (highly-optimized WebSocket server).
- **Reverse Proxy**: Nginx (serving static UI assets and routing WS handshakes).
- **Orchestration**: Docker & Docker Compose (Containerization, isolated bridge networking).

---

## 4. Detailed Packet Flow (WebRTC Connection lifecycle)

When **User A** joins a room and clicks **Connect Peer**, the following sequence occurs to establish the direct connection:

```text
User A (Browser)            Signaling Server (Node.js)             User B (Browser)
   |                                    |                                    |
   |-- 1. JOIN (Room: room-101) ------->|                                    |
   |                                    |<-- 2. JOIN (Room: room-101) -------|
   |                                    |                                    |
   |-- 3. Create & Set Local SDP Offer -|                                    |
   |-- 4. SEND SDP Offer -------------->|                                    |
   |                                    |-- 5. RELAY SDP Offer ------------->|
   |                                    |                                    |-- 6. Set Remote Offer
   |                                    |                                    |-- 7. Create & Set Local Answer
   |                                    |<-- 8. SEND SDP Answer -------------|
   |<-- 9. RELAY SDP Answer ------------|                                    |
   |                                    |                                    |
   |-- 10. Set Remote Answer            |                                    |
   |                                    |                                    |
   |==================== START ICE CANDIDATE GATHERING ======================|
   |                                    |                                    |
   |-- 11. Send Gathered ICE candidate->|                                    |
   |                                    |-- 12. Relay ICE candidate -------->|
   |                                    |                                    |-- 13. Add Ice Candidate
   |                                    |<-- 14. Send Gathered ICE candidate-|
   |<-- 15. Relay ICE candidate --------|                                    |
   |-- 16. Add Ice Candidate            |                                    |
   |                                    |                                    |
   +========================== P2P CONNECTION ESTABLISHED ===================+
   |                                                                         |
   |<<<<<<<<<<<<<<<<<< Direct Peer-to-Peer Media Flow (UDP) >>>>>>>>>>>>>>>>>|
   |                 (Signaling Server is OUT of the path)                   |
```

### Step-by-Step Breakdown:
1. **Camera Capture**: User A and User B click "Start Camera" to capture their local video streams (`navigator.mediaDevices.getUserMedia`).
2. **Room Joining**: Both send a `join` message over their respective WebSocket connections. The server maps both sockets to `room-101` in a memory Map.
3. **Offer Creation**: User A clicks "Connect". User A's browser creates an Session Description Protocol (SDP) **Offer**, sets it as local description, and sends it via WebSocket.
4. **Offer Relay**: The signaling server intercepts the offer, identifies User A is in `room-101`, and relays the offer to User B.
5. **Answer Creation**: User B sets User A's SDP offer as their remote description. User B creates an SDP **Answer**, sets it as local description, and sends it back to the server.
6. **Answer Relay**: The server relays the answer back to User A. User A sets User B's answer as remote description.
7. **ICE Gathering**: Concurrently, both browsers talk to Google's public STUN server to discover their public IPs and ports. The discovered routing paths are packaged as **ICE Candidates**.
8. **ICE Candidate Exchange**: Both browsers exchange these ICE candidates via the signaling server and add them to their respective peer connections.
9. **P2P Flow**: Once a matching network route is confirmed, media channels open directly between the browsers. The signaling server is no longer involved.

---

## 5. System Design Decisions & Alternatives

| Tech Choice | Problem solved | Solution | Alternative considered | Why alternative was not chosen |
| :--- | :--- | :--- | :--- | :--- |
| **WebSockets** | Real-time bi-directional signaling required to exchange SDP/ICE candidates. | WebSocket connection over TCP. | HTTP Polling | High latency, high CPU overhead on server from constant polling, and lack of true server-push capability. |
| **Nginx Proxy** | Serving static assets and proxying backend WebSockets under a single host/port. | Reverse Proxy routing `/ws` internally and serving files. | Direct access to Node (Port 8080) | Hardcoding API endpoints on client, triggers CORS blockages, and causes SSL/Mixed-Content errors in production. |
| **Docker Networking** | Container communication without exposing signaling port to the host. | User-defined bridge network (`webrtc-net`). | Default bridge network | Default network lacks automatic container name-to-IP resolution (DNS), forcing hardcoded IP routing. |
| **In-Memory Map Rooms** | isolating streams and signaling traffic for concurrent users. | Map linking `roomId` to sets of sockets: `Map<string, Set<ws>>`. | Global Broadcasting | Broadcasters send offers to everyone. Any third user entering the site would crash or hijack existing connections. |

---

## 6. How to Run

### Prerequisites
- Docker Desktop installed and running.

### Execution Commands
1. **Build and Run Containers**:
   ```bash
   docker compose up --build
   ```
2. **Access the application**:
   Open two browser tabs or separate windows at:
   `http://localhost:3000`
3. **Establish Stream**:
   - Ensure the **Room ID** is identical in both tabs (e.g. `room-default`).
   - Click **1. Start Camera** on both tabs (grant browser permission).
   - Click **2. Connect Peer** on **one** of the tabs.
   - The connection status badge will update from *Disconnected* -> *Connecting* -> *Connected*, and the video streams will render.

4. **Shutdown Containers**:
   ```bash
   docker compose down
   ```

---

## 7. SDE-1 Interview Questions & Answers

### Q1: Why WebRTC?
**Answer**: WebRTC enables direct browser-to-browser transmission of high-bandwidth video and audio streams with sub-second latency (using UDP). Without WebRTC, all media streams would have to transit through our servers (e.g., via RTMP or HLS), which would create massive bandwidth bills and high latency.

### Q2: Why WebSockets?
**Answer**: WebRTC requires an initial "handshake" to exchange network and session configuration before establishing direct P2P connections. Browsers cannot talk to each other without this. WebSockets provide the low-latency, full-duplex connection needed to exchange this metadata in real time.

### Q3: Why SDP?
**Answer**: SDP (Session Description Protocol) is a text format that details a browser's media capabilities (supported video/audio codecs, resolutions, encryption parameters, and stream settings). Exchanging SDP allows both peers to agree on how to encode/decode the media streams.

### Q4: Why ICE?
**Answer**: ICE (Interactive Connectivity Establishment) is a framework used to find all possible network paths (candidates) between two peers. This includes local IP networks, public NAT configurations (via STUN), and media relays (via TURN).

### Q5: Why STUN?
**Answer**: Browsers typically sit behind routers and Firewalls using Network Address Translation (NAT), meaning they do not know their own public IP address. A STUN server sits on the public internet and simply replies to a client's request with the client's public-facing IP and port.

### Q6: Why Node.js?
**Answer**: Node.js is asynchronous and event-driven. It operates on a single-threaded event loop, making it highly efficient for handling thousands of concurrent, I/O-bound WebSocket connections with minimal memory footprint.

### Q7: Why Docker?
**Answer**: Docker packages our application and all of its runtime dependencies (Node version, Nginx configurations) into isolated containers. This guarantees "works on my machine" consistency across development, staging, and production environments.

### Q8: Why Docker Compose?
**Answer**: Docker Compose allows us to declare and spin up multi-container applications (our signaling container and our Nginx web server) with a single command. It configures ports, volume mounts, and custom networks automatically.

### Q9: Why Nginx?
**Answer**: In production, Nginx acts as our web server and reverse proxy. It serves static assets extremely fast and acts as a gateway proxying WebSocket traffic. By having Nginx serve as a single port entry point, we avoid CORS errors and can easily add SSL encryption in the future.

### Q10: Why room-based signaling instead of broadcasting?
**Answer**: Global broadcasting routes signaling messages to every single connected user. In production, this causes collisions: Client A's offer is received by Clients B, C, D, and E, failing the connection. Room-based signaling groups clients by custom IDs, isolating signaling flows.

---

## 8. Common Interview Mistakes & FAQs

### Q1: What happens if the signaling server crashes after the WebRTC connection is established?
**Answer**: The active video call **remains connected and unaffected**. Because WebRTC media flows directly browser-to-browser (P2P), it does not go through the signaling server. However, if the connection drops due to a network change, the peers will not be able to perform an "ICE restart" or reconnect until the signaling server is back online.

### Q2: Why doesn't WebRTC media pass through Node.js?
**Answer**: Routing media through Node.js would consume enormous CPU (for decrypting/transcoding) and network bandwidth, resulting in high cloud costs. WebRTC bypasses the server by establishing a direct UDP tunnel using Secure Real-time Transport Protocol (SRTP) to deliver media directly with minimum latency.

### Q3: What if both users are behind Symmetric NATs (e.g. enterprise firewalls or cellular networks)?
**Answer**: If both clients are behind Symmetric NATs, STUN will fail because the port mapping changes for every destination connection. In this scenario, we must deploy a **TURN (Traversal Using Relays around NAT)** server. The TURN server acts as a public media fallback relay, receiving packets from Client A and forwarding them to Client B. Under TURN, the media is *not* P2P, but it is still end-to-end encrypted.

### Q4: Why client -> Nginx -> Signaling Server instead of Browser -> Node directly?
**Answer**: 
- **CORS Mitigation**: Since the UI is served on port 3000, calling Node directly on port 8080 would cross port boundaries, requiring complex CORS headers.
- **Port Consolidation**: Exposing a single port (3000) keeps the security footprint small.
- **Production Readiness**: Nginx can act as a load balancer and handle SSL certificate (HTTPS/WSS) termination, shielding the Node.js server from traffic spikes and encryption overhead.

---

## 9. Future Production Improvements

Although this architecture is optimized for SDE-1 interview defense, the next steps for a production deployment include:
1. **TURN Server Integration**: Add TURN configurations (like coturn) to handle peer NAT traversal where STUN fails (typically ~15% of real-world connections).
2. **Distributed Signaling (Horizontal Scaling)**: Introduce a **Redis Pub/Sub** layer behind Node.js. If user A and user B connect to different Node instances, Redis will relay signaling messages between servers.
3. **Database Room Persistence**: Replace the in-memory JavaScript Map with a persistent store (e.g., PostgreSQL or MongoDB) to track active rooms, session duration, and user metadata.
4. **Security & Authentication**: Implement JWT-based token authentication for WebSocket connections to prevent unauthorized room joins.
5. **HTTPS/WSS**: Bind SSL certificates to Nginx to encrypt all signaling traffic and enable camera capture on non-localhost production environments.
