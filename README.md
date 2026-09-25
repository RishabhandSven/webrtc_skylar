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


---

## 9. Future Production Improvements


1. **TURN Server Integration**: Add TURN configurations (like coturn) to handle peer NAT traversal where STUN fails (typically ~15% of real-world connections).
2. **Distributed Signaling (Horizontal Scaling)**: Introduce a **Redis Pub/Sub** layer behind Node.js. If user A and user B connect to different Node instances, Redis will relay signaling messages between servers.
3. **Database Room Persistence**: Replace the in-memory JavaScript Map with a persistent store (e.g., PostgreSQL or MongoDB) to track active rooms, session duration, and user metadata.
4. **Security & Authentication**: Implement JWT-based token authentication for WebSocket connections to prevent unauthorized room joins.
5. **HTTPS/WSS**: Bind SSL certificates to Nginx to encrypt all signaling traffic and enable camera capture on non-localhost production environments.
