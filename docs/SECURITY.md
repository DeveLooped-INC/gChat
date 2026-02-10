# Security Model

gChat implements a **Zero-Trust, Local-First, End-to-End Encrypted** security model.

> [!NOTE]
> All cryptography is implemented using standard, audited primitives (`tweetnacl`, `js-sha3`).
> Identity is based on Ed25519 public keys.
> Transport is secured via Tor v3 Onion Services.
> Messages are End-to-End Encrypted using XSalsa20-Poly1305.

## 1. Identity & Authentication
- **User ID**: Ed25519 Public Key (Signing Key).
- **Authentication**: All critical packets (Connection Requests, Posts) are cryptographically signed by the author.
- **Anti-Spoofing**: Connection requests include a signature verifying that the sender owns the Identity Key.

## 2. Transport Security
- **Tor Onion Services**: All traffic is routed over Tor, providing:
    - **Anonymity**: IP addresses are hidden.
    - **Encryption**: Transport layer is encrypted by Tor.
    - **NAT Traversal**: No port forwarding required.
- **Strict Firewall**: The application refuses all connections except those to the Onion Service port or expected return traffic.

## 3. End-to-End Encryption (E2EE)
- **Algorithm**: XSalsa20-Poly1305 (NaCl `box`).
- **Key Exchange**:
    - Users exchange **Encryption Public Keys** (X25519) during the authenticated Connection Handshake.
    - The handshake is signed by the **Identity Key** (Ed25519) to prevent MITM.
- **Forward Secrecy**: Currently using long-lived key pairs (TOFU - Trust On First Use). Ephemeral keys are planned for future versions.

## 4. Local-First Data
- Keys and data never leave your device unencrypted.
- Backups are encrypted with AES-GCM (Web Crypto API) derived from your Recovery Phrase.
*   **Visuals**: The `Lock` icons and green/purple color coding indicate the encryption state of the transport layer.

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
