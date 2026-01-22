# gChat Architecture

## High-Level Overview

gChat is designed as a **Local-First Software** (LoFi) with a **Universal Backend**.

It separates the networking logic into a standalone Node.js server (`server.js`) and a pure React frontend. This allows the application to run in any standard web browser while still accessing low-level Tor features provided by the local backend process.

## System Components

### 1. The Backend (`server.js`)
The nervous system of the node.
*   **Tor Manager**: Spawns and monitors the `tor` binary.
*   **SOCKS Proxy**: Configures Tor to listen on **Port 9990** (custom port to avoid conflicts with system Tor).
*   **Hidden Service**: Maps port 80 of the onion address to local port **3456**.
*   **API**: Exposes a `socket.io` server on **Port 3001** for the frontend to send commands.
*   **Shutdown Handler**: Manages clean exit signals (SIGINT/SIGTERM) to kill child processes.

### 2. The Frontend (React + Vite)
The visual interface and cryptographic engine.
*   **Communication**: Connects to the backend via `socket.io-client`.
*   **Cryptography**: All encryption happens here in the browser context. The backend only sees encrypted blobs.
*   **Storage**: 
    *   `localStorage`: JSON state (Posts, Messages, Contacts).
    *   `Cache Storage API`: Large binary media files (`gchat-media-v1`).

## Network Protocols

### 1. Messaging & Gossip
1.  **Outgoing Message**:
    *   Frontend Encrypts message -> Emits `send-packet` event via Socket.IO.
    *   Backend receives event -> Routes request via `socks-proxy-agent` (Port 9990) -> Tor Network -> Destination Onion.

2.  **Incoming Message**:
    *   Remote Tor Peer -> Hidden Service -> Local Backend (Port 3456).
    *   Backend receives POST request -> Emits `tor-packet` event via Socket.IO.
    *   Frontend receives event -> Decrypts payload -> Updates UI.

### 2. Network Synchronization (Global Sync)
To ensure distant nodes receive content even if intermediate peers were temporarily offline:

1.  **Request**: User clicks "Sync Network". Node broadcasts `GLOBAL_SYNC_REQUEST` with `hops: 6`.
2.  **Propagation**: Every node receiving this request decrements hops and forwards it to all *their* peers (Daisy Chain).
3.  **Response**: If a node has public posts, it initiates a **Direct Connection** back to the `requesterId` (Sender) and pushes a `SYNC_RESPONSE` containing the posts.
4.  **Result**: The requester receives content from nodes they are not directly connected to, effectively "knitting" the mesh.

### 3. Mesh Media Recovery (Self-Healing)
When a user attempts to view an image/video, the system first checks the local Cache. If missing, it attempts to download from the original author. If the author is offline:

1.  **Discovery**: The node broadcasts a `MEDIA_RECOVERY_REQUEST` packet to all known peers.
2.  **Proof of Access**: The packet includes the `mediaId` and an `accessKey`.
3.  **Verification**: Peers check if they have the file in their Cache AND if the provided `accessKey` matches.
4.  **Response**: If verified, the peer responds with `MEDIA_RECOVERY_FOUND`.
5.  **Transfer**: The requester initiates a chunked download from the new surrogate peer.

## Data Model

### 1. User Identity (`UserProfile`)
A single user node is defined by a generated UUID and an associated keypair.
*   **Storage**: `localStorage.getItem('gchat_user')`
*   **Routing**: The `onionAddress` serves as the public routable ID.

### 2. The Truth Store (`Post[]`)
The feed is a collection of signed messages (Posts).
*   **Integrity**: Each post contains a `truthHash`.
*   **Lifecycle**: Posts can be marked `isOrphaned` if the author sends a `NODE_DELETED` packet.

### 3. Media Metadata
Media is detached from the message payload to keep JSON light.
*   **Structure**: `{ id, mimeType, chunkCount, accessKey }`.
*   **Storage**: The binary Blob is stored in the browser Cache API, keyed by UUID.
