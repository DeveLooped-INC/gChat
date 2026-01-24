
# Project Status

## Overview
**Current Version**: 1.2.3 (Media Transport Update)
**Status**: Stable / Robust Media Transfer

The application has matured into a resilient decentralized platform running natively in the browser. It supports **Global Synchronization**, allowing nodes to actively pull content from the mesh, and **Mesh Media Recovery** for content persistence.

## ✅ Completed Features

### 1. Onboarding & Identity
*   [x] "Matrix-style" terminal initialization sequence.
*   [x] **Real Tor Bootstrapping**: Spawns native `tor` daemon and waits for circuit establishment.
*   [x] **Ed25519 Identity**: Real cryptographic key generation (Signing & Encryption).
*   [x] **Persistent Identity**: Profile saved to LocalStorage, Keys saved to memory (exportable).

### 2. Social Feed & Gossip
*   [x] Posting text and images.
*   [x] **Cryptographic Signatures**: All posts are signed with Ed25519 keys.
*   [x] **Unstructured Gossip**: Public posts are automatically re-broadcasted to connected peers.
*   [x] **Global Sync**: A manual "Pull" button (`GLOBAL_SYNC_REQUEST`) that floods the network to retrieve recent content from all reachable nodes.
*   [x] **Moderation**: Local "Soft Delete" based on like/dislike ratios.

### 3. Encrypted Chat & Groups
*   [x] **E2E Encryption**: Messages encrypted via ChaCha20-Poly1305 (NaCl).
*   [x] **Tor Transport**: Packets routed via SOCKS5 proxy to hidden services.
*   [x] **Group Chats**: 
    *   [x] Creation, Admin Tools (Kick/Ban), and Settings (Mute/Rename).
    *   [x] **Graceful Deletion**: If an owner deletes a group, it is removed from all members.
*   [x] **Media Attachments**: Audio/Video recording and Image sharing with chunked transfer.

### 4. Connectivity & Resilience
*   [x] **Deep Link Invites**: QR Codes for instant peering.
*   [x] **Handshake Protocol**: Automated key exchange upon connection.
*   [x] **Self-Healing Mesh**: 
    *   [x] **Media Recovery**: If a download fails, the node queries the mesh for peers holding the same content.
    *   [x] **Proof of Access**: Media queries use `accessKey` tokens to validate permissions.

### 5. Node Management
*   [x] **Graceful Shutdown**: "System Shutdown" overlay that ensures Tor shuts down cleanly without leaving ghost processes or corrupting data.
*   [x] **Graceful Exit**: Deleting a node broadcasts a `NODE_DELETED` packet.
*   [x] **Browser Native**: App launches in system default browser.
*   [x] **Termux Support**: Automatic detection and patching of binary paths for Android.

## 🛠 Recent Changelog (v1.2.3)

*   **Architecture**: **Dual Network Agents**. Split backend traffic into "Control" (chat/sync) and "Data" (media) lanes. This prevents large file downloads from stalling text messages.
*   **Performance**: **Keep-Alive Circuits**. Re-enabled persistent connections for media transfers, significantly reducing latency by avoiding Tor circuit rebuilding for every chunk.
*   **Fix**: **Binary Serialization**. Switched to explicit Base64 encoding for media chunks. This resolved the "Empty Blob" error caused by JSON serialization dropping raw buffers.
*   **Stability**: **Chunk Validation**. Frontend now strictly validates chunk size before assembly, requesting retries for corrupted frames immediately.

## 🚧 Known Limitations

*   **Scaling**: Current "Flooding" gossip is inefficient for >1000 nodes.
*   **Initial Latency**: First connection to a peer still takes 15-30s while Tor builds the circuit. Subsequent requests utilize Keep-Alive and are much faster.

## 🔜 Roadmap

1.  **GossipSub**: Move from unstructured flooding to structured gossip (random subsets) to handle thousands of nodes.
2.  **Supernodes**: Implement a "Relay Mode" for desktop nodes to store-and-forward messages for mobile nodes that go offline frequently.
3.  **Binary Transport**: Optimize large file transfers using streams instead of JSON base64 payloads.
