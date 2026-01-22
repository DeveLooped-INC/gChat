
# gChat: Detailed Project Plan
**Decentralized Onion-Routed Social**

## 1. Vision
To create a social platform that respects user sovereignty, privacy, and freedom of expression by removing central servers entirely. The platform operates on a peer-to-peer (P2P) mesh network, utilizing onion routing to anonymize traffic and local-first databases to ensure users own their data.

## 2. Core Pillars

### A. Privacy by Default
*   **No Phone Numbers/Emails**: Identities are cryptographic keypairs (Ed25519).
*   **Metadata Resistance**: Onion routing hides who is talking to whom.
*   **Encryption**: Everything is End-to-End Encrypted (E2E).

### B. Decentralization
*   **Mesh Networking**: Devices connect directly via Tor Onion Services.
*   **Gossip Protocol**: Data propagates through the network like a virus, verified by trust graphs.
*   **Local-First**: The "cloud" is just a backup; your device is the source of truth.

### C. UX First
*   Complex cryptography must be hidden behind a beautiful, familiar interface.
*   Latency must be managed with optimistic UI updates.

## 3. Feature Specifications

### Module 1: Identity & Onboarding (Completed)
*   **Key Generation**: Generate public/private keys locally on the device.
*   **Profile**: Display Name, Avatar, and Bio (stored in a mutable signed record).
*   **Onion Address**: Generate a unique `.onion` style address for routability.

### Module 2: The Feed (Completed)
*   **Content**: Text, Images, and "Truth Hashes" (Merkle roots).
*   **Distribution**:
    *   *Public*: Broadcast to connected peers via **Gossip Protocol** and **Global Sync**.
    *   *Friends*: Encrypted gossip to specific public keys.
*   **Interactions**: Likes (signed proofs), Comments, and Reshares.
*   **Recovery**: Mesh-based media recovery for orphaned content.

### Module 3: Secure Chat & Groups (Completed)
*   **Transport**: Direct P2P streams or Onion-routed packets.
*   **Features**:
    *   Text & Image support.
    *   **Group Chats**: Admin controls, bans, invites, and settings.
    *   **Ephemeral Messages**: Auto-delete functionality.
    *   **Typing Indicators**: P2P state signaling.
*   **Security**: Perfect Forward Secrecy (simulated via ephemeral flags).

### Module 4: Contact Management (Completed)
*   **Trust Levels**: Pending, Verified, Blocked.
*   **Handshake**: Scan QR codes to exchange keys out-of-band (for high trust).
*   **Identity Card**: A visual representation of the user's node stats and keys.

### Module 5: Node Settings (Completed)
*   **Network Control**: Toggle Tor/Mesh connection.
*   **Storage**: Manage local storage usage (pruning old media).
*   **Key Management**: Export private keys for backup (Self-Custody).
*   **Decommissioning**: Graceful node deletion (notifies peers, orphans content).
*   **Shutdown**: Graceful process termination overlay.

## 4. Technical Architecture

*   **Frontend**: React + Vite (UI, Encryption, State).
*   **Backend**: Node.js + Socket.IO (Tor Process Management, SOCKS Proxy, Hidden Service).
*   **Storage**: `localStorage` (Persisted state) + `Cache API` (Media).
*   **Network**: Real Tor Network (v3 Onion Services).

## 5. Future Roadmap (Scaling)

As the network grows, simple flooding (gossip) becomes inefficient. Future versions will implement:

*   **GossipSub**: Probabilistic broadcasting to a random subset of peers rather than all peers.
*   **Supernodes**: Allow users with powerful hardware (Desktops/Servers) to designate their node as a "Supernode". These will act as Always-Online Relays for mobile devices, storing messages while phones are asleep.
