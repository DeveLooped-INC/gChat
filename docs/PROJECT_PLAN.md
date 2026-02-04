
# gChat: Master Project Plan
**Decentralized Onion-Routed Social Platform**

## 1. The Vision
To create a "Sovereign Social Node" that operates entirely peer-to-peer. Unlike Federated networks (like Mastodon) which rely on server admins, gChat relies on **you**. Every user is a server. Every device is a node.

## 2. Core Pillars (Implemented)

### A. The "Handle.Tripcode" Identity
*   **Philosophy**: No central registry. Uniqueness is mathematical.
*   **Implementation**: Users choose a handle (e.g., "Neo"). The system appends a suffix derived from the SHA-256 hash of their Ed25519 public key (e.g., "Neo.x7z9").
*   **Benefit**: Allows human-readable names while preventing impersonation.

### B. The "Dual-Lane" Network
*   **Architecture**: Traffic is split into two distinct lanes over Tor:
    1.  **Control Lane**: Low-latency JSON packets (Chat, Gossip, Handshakes).
    2.  **Data Lane**: High-latency, high-bandwidth Binary streams (Video, Audio, Images).
*   **Benefit**: Downloading a 50MB video does not block text messages from arriving.

### C. The "Truth Chain" Feed
*   **Data Structure**: Posts are not just text; they are cryptographically signed payloads containing a `truthHash` (Integrity Check).
*   **Propagation**: Uses a "Daisy-Chain" flooding protocol (`hops: 6`) to propagate content across the mesh without a central index.

## 3. Architecture Specifications

### Module 1: The Universal Backend
*   **Node.js Process**: Spawns and manages a native `tor` binary.
*   **Hidden Service**: Automatically generates and guards a v3 `.onion` address.
*   **Socket API**: Bridges the local browser (Frontend) to the Tor network (Backend) via WebSockets.

### Module 2: Client-Side Cryptography
*   **Keys**: Ed25519 (Signing) and X25519 (Encryption) keys generated via PBKDF2 from a BIP39 mnemonic.
*   **Storage**: Keys reside in memory or encrypted `localStorage`.
*   **E2E**: Messages are encrypted via NaCl (ChaCha20-Poly1305) before they ever leave the browser.

### Module 3: Resilience & Recovery
*   **Inventory Sync**: Nodes actively compare content hashes (`INVENTORY_SYNC_REQUEST`) to identify missing posts.
*   **Mesh Media Recovery**: If a node hosting a file goes offline, the network queries connected peers for cached copies using `accessKey` tokens (Self-Healing).

### Module 4: Social Interactions
*   **Rich Threading**: Infinite depth recursive comments.
*   **Reactions & Voting**: Signed reaction packets allow for distributed moderation (e.g., auto-hiding content with high negative ratios).
*   **Groups**: decentralized group state management with Admin/Owner roles.

## 4. Future Roadmap (The Scaling Phase)

Now that the core mechanics work, the focus shifts from "Possibility" to "Scalability" and "Hardening".

### Phase 1: Storage Architecture Upgrade (CRITICAL)
*   **Problem**: `localStorage` is limited (5-10MB).
*   **Solution**: Migrate all non-sensitive state (Posts, Messages) to **IndexedDB** using a wrapper like `idb`. Keep `localStorage` only for preferences and encrypted key blobs.

### Phase 2: GossipSub Implementation
*   **Problem**: Current "Flooding" (sending to all peers) scales poorly beyond ~100 nodes.
*   **Solution**: Implement structured gossip where nodes only forward to a random subset of peers (mesh subsets).

### Phase 3: Offline "Supernodes"
*   **Problem**: Mobile nodes (Termux) go offline when the phone sleeps.
*   **Solution**: Allow desktop nodes to act as encrypted "Mailboxes" for mobile friends, storing messages until the mobile node wakes up.

### Phase 4: Binary Stream Optimization
*   **Current**: Files are chunked -> Base64 Encoded -> JSON -> Tor.
*   **Target**: Implement raw binary piping through the SOCKS proxy to reduce overhead by 33% (removing Base64 bloat).

### Phase 5: Security Hardening (New)
*   **Ephemeral Enforcement**: Currently, ephemeral messages are only visually hidden. We must implement a background "Garbage Collector" that actively purges these records from the database/storage after the timer expires.
*   **Anti-Spam PoW**: Implement a lightweight "Proof of Work" (Hashcash) for public broadcasts. A node must solve a small math problem before their post is propagated by peers, preventing spam flooding.
*   **Panic Button**: A UI feature to instantly "Forget" keys from memory and lock the node, useful for users in hostile environments.

### Phase 6: Traffic Obfuscation (New)
*   **Problem**: An ISP or observer can tell *when* you are chatting based on traffic bursts, even if they can't read the content.
*   **Solution**: Implement "Traffic Padding". The node sends constant, low-bandwidth dummy noise packets. Real messages replace dummy packets, keeping the traffic profile flat and unanalyzable.
