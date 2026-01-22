
# Project Status

## Overview
**Current Version**: 1.2.2 (Stability & Sync Update)
**Status**: Stable / Self-Healing Mesh Active

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

## 🛠 Recent Changelog (v1.2.2)

*   **Feature**: **Global Sync**. Added a "Sync Network" button to the Global Feed. This broadcasts a request up to 6 hops away, asking nodes to return their public posts. This solves propagation issues in sparse networks.
*   **Stability**: **Graceful Shutdown Protocol**. Implemented a strict shutdown sequence (Notify Peers -> Stop Tor -> Exit) with a UI overlay to prevent database corruption and "Socket Closed" errors in the terminal.
*   **Fix**: **Termux Compatibility**. Added automatic `$PATH` patching to locate `pkg`-installed binaries on Android.
*   **Debug**: Added "Daisy Chain Trace Logging" to the frontend console to visualize how messages hop between nodes.

## 🚧 Known Limitations

*   **Scaling**: Current "Flooding" gossip is inefficient for >1000 nodes.
*   **Large Files**: Very large video files (>50MB) may still experience timeouts over slower Tor circuits during chunk reassembly.

## 🔜 Roadmap

1.  **GossipSub**: Move from unstructured flooding to structured gossip (random subsets) to handle thousands of nodes.
2.  **Supernodes**: Implement a "Relay Mode" for desktop nodes to store-and-forward messages for mobile nodes that go offline frequently.
3.  **Binary Transport**: Optimize large file transfers using streams instead of JSON base64 payloads.
