
# Project Status

## Overview
**Current Version**: 1.3.1 (The Polished Mesh Update)
**Status**: Stable / Feature Rich

gChat has evolved into a robust decentralized platform. It now features a sophisticated **State Synchronization Engine** that ensures nodes stay in sync even after periods of disconnection, and a comprehensive **Social Layer** including threaded comments, reactions, and moderation.

## ✅ Recent Changelog (v1.3.1)
*   **Fix**: Camera Modal now correctly overlays the "New Broadcast" modal (Z-Index fix).
*   **Fix**: "New Broadcast" notifications now trigger reliably for public posts from unknown nodes (refactored state logic).
*   **Fix**: `INVENTORY_ANNOUNCE` packets are now daisy-chained (forwarded) to ensure posts propagate beyond immediate neighbors.
*   **Fix**: Peer Heartbeat (`ANNOUNCE_PEER`) now works even if a Node Alias is not explicitly set in settings (fallbacks to Display Name).
*   **Improvement**: Enhanced debug logging for Inventory Sync operations.

## ✅ Completed Features

### 1. Core Networking & Tor
*   [x] **Automated Bootstrapping**: Zero-config Tor setup on Windows, Mac, Linux, and Android.
*   [x] **Dual-Agent Routing**: Separation of Control vs. Data traffic to prevent head-of-line blocking.
*   [x] **Keep-Alive Circuits**: Reusing Tor circuits for media chunks to improve throughput.

### 2. Identity & Security
*   [x] **Handle.Tripcode System**: Deterministic, collision-free identities (`User.x7z9`).
*   [x] **Encrypted Backup**: Full node migration via AES-GCM encrypted ZIP files.
*   [x] **Session Security**: Keys derived from Seed Phrase; never transmitted unencrypted.

### 3. Social Mechanics
*   [x] **Inventory Sync**: Proactive pulling of missing posts based on hash comparison.
*   [x] **Recursive Comments**: Reddit-style threaded conversations.
*   [x] **Distributed Moderation**: Local blocking logic based on peer voting ratios.
*   [x] **Rich Media**: Audio/Video recording with immediate chunked upload.

### 4. Group Dynamics
*   [x] **Role Management**: Owner/Admin permissions (Kick/Ban).
*   [x] **State Consistency**: Updates (renames, mutes) propagate to all members.
*   [x] **Group Encryption**: Multi-recipient encryption for group payloads.

### 5. UX & Polish
*   [x] **Notifications**: System-wide toast notifications for background events.
*   [x] **Mobile Optimization**: Responsive layout with touch-friendly controls.
*   [x] **Debug Console**: Built-in terminal for monitoring network traffic and Tor logs.

## 🚧 Known Issues & Tech Debt

### 1. Missing Recovery Implementation (Critical)
*   **Issue**: In `services/networkService.ts`, the functions `attemptMeshRecovery`, `handleRecoveryRequest`, and `handleRecoveryFound` are empty placeholders.
*   **Impact**: **Self-Healing does not work.** If a media file is missing, the app *pretends* to look for it but never actually sends the request to peers.

### 2. LocalStorage Capacity Risk (Critical)
*   **Issue**: All data (posts, messages, large base64 strings) is stored in `localStorage`.
*   **Impact**: Browsers limit this to 5MB. Active users will hit this limit quickly, causing the app to crash or stop saving. **Migration to IndexedDB is required immediately.**

### 3. Security: Ephemeral Messages Persist
*   **Issue**: "Disappearing messages" are flagged in the UI (`isEphemeral: true`) but are not actually deleted from the underlying storage.
*   **Impact**: A forensic analysis of the `localStorage` would reveal messages that the user thought were deleted.

### 4. Performance: Feed Rendering
*   **Issue**: `Feed.tsx` performs filtering, sorting, and searching on the entire post array during every render cycle.
*   **Impact**: As the feed grows (100+ posts), the UI will become sluggish, especially on mobile devices.

### 5. Gossip Flooding
*   **Issue**: Broadcasting uses simple flooding (`hops: 6`).
*   **Impact**: High bandwidth usage on idle nodes. Need to move to probabilistic gossip.

## 🔜 Immediate Priorities

1.  **IndexedDB Migration**: Move storage out of `localStorage` to handle more than 5MB of data.
2.  **Implement Mesh Recovery**: Fill in the missing logic in `networkService.ts`.
3.  **Ephemeral Garbage Collector**: Implement a background timer to physically delete expired messages.
