# Security Model & Simulation

> **IMPORTANT**: This application is a prototype. The security features described below are **SIMULATED** for User Experience (UX) demonstration purposes.

## Cryptographic Primitives (Simulated)

The design assumes the use of the **NaCl / Sodium** cryptographic suite, which is standard for modern P2P applications.

### 1. Identity (Ed25519)
*   **Usage**: User profiles and signing.
*   **Simulation**: We generate a UUID and display a visual "fingerprint" in the UI. In a real app, this would be the Ed25519 Public Key.
*   **Authentication**: Proof of ownership is demonstrated by signing posts.

### 2. Transport Encryption (ChaCha20-Poly1305)
*   **Usage**: All chat messages and private feed posts.
*   **Simulation**: The UI shows "Encrypted via Onion" or "E2E Encrypted".
*   **Visuals**: The `Lock` icons and green/purple color coding indicate the encryption state of the transport layer.

### 3. Key Exchange (X25519)
*   **Usage**: Deriving shared secrets for chat sessions.
*   **Simulation**: The "Add Contact" flow simulates an out-of-band QR code scan. This represents the exchange of Public Keys to establish a shared secret.

## Privacy Features

### Onion Routing
Traffic is not sent directly to a central server. It is routed through 3 hops (Guard -> Middle -> Exit) to obscure the metadata (who is talking to whom).
*   **UX**: The application shows connection types (`Onion` vs `LAN`) to inform the user of the current privacy level.

### Ephemeral Messaging
*   **Concept**: Messages that self-destruct after being read to ensure Forward Secrecy.
*   **Implementation**: A toggle in the chat menu. Messages sent in this mode are visually distinct (dashed border, bomb icon) and would be purged from the disk in a real implementation.

### Local-First Data
*   **Concept**: Data lives on the user's device.
*   **Benefit**: If the internet goes down, or the platform is censored, the user still has access to their own data and keys.
