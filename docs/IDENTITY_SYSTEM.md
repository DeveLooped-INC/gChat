
# gChat Identity System Specification
**Format: Handle.Tripcode**

## 1. The Problem
In a decentralized mesh network, there is no central database to enforce unique usernames (e.g., preventing two users from both being "Tom"). However, users need a human-readable identifier that is also cryptographically verifiable.

## 2. The Solution: Deterministic Identity
We utilize a **Handle.Tripcode** format (e.g., `Tom.x7z9`) which combines user choice with mathematical uniqueness.

### Structure

1.  **The Handle (User Chosen)**
    *   **Example**: `Tom`, `CyberPunk`, `Alice`
    *   **Constraints**: Alphanumeric, 1-20 characters. No dots (`.`).
    *   **Purpose**: Human readability and personalization.

2.  **The Separator**
    *   A literal dot (`.`).

3.  **The Tripcode (System Generated)**
    *   **Example**: `x7z9`
    *   **Derivation**: 
        1.  Input: User's Ed25519 Public Signing Key (Generated from Seed Phrase).
        2.  Hash: SHA-256 (or SHA3-256) of the Public Key.
        3.  Encode: Base32 (to avoid ambiguous chars like 0/O, 1/l).
        4.  Truncate: First 6 characters.
    *   **Purpose**: Global uniqueness. Even if another "Tom" joins, their seed phrase will be different, resulting in `Tom.b2q5`.

## 3. Benefits

1.  **Anti-Spoofing**: You cannot fake the suffix without the private key.
2.  **Portable**: The suffix travels with your seed phrase. Login on a new device, and your unique ID is restored automatically.
3.  **No Conflicts**: No "Username taken" errors during onboarding.

## 4. UI Representation
To maintain aesthetics while ensuring accuracy, the UI splits the string:
*   **Handle**: Displayed in **Bold / White**.
*   **Tripcode**: Displayed in **Small / Dim / Monospace**.

*Example*: **Tom**<span style="opacity:0.5; font-size: 0.8em">.x7z9</span>
