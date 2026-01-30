
# gChat User Guide

## 1. Getting Started

### Desktop Mode (Linux, Mac, Windows)
1.  Run `npm start` in your terminal.
2.  Your default web browser will automatically open to `http://localhost:3000`.
3.  **Do not close the terminal window**, as this runs the Tor process.

### Mobile Mode (Android/Termux)
1.  Run `npm start` in your Termux terminal.
2.  The script will attempt to launch your Android browser automatically.
3.  If it doesn't open, manually open Chrome or Firefox and go to `http://localhost:3000`.
4.  **Do not close the Termux app**, as this runs the Tor process.

### Mobile Mode (Apple)
1.  Could be Coming Soon!

## 2. Initialization
When you first launch gChat, you will see a terminal-like initialization screen.
1.  Click **"Initialize Node"**.
2.  Wait for "Tor Bootstrapped 100%".
3.  Enter a **Display Name** and a **Username**.
4.  Click **"Launch gChat"**.

## 3. The Feed & Gossip
The feed is where you see updates from the mesh network.
*   **Posting**: Use the text box at the top. You can toggle between **Public** (Global) and **Friends Only** (Encrypted).
*   **Gossip Protocol**: When you post "Publicly", your node automatically sends that post to your connected peers, who then forward it further into the mesh. You will receive notifications for new public broadcasts even from users you haven't explicitly friended.
*   **Sync Network**: If you feel you are missing posts, click the **Refresh/Sync** icon in the Global Feed header. This sends a signal through the mesh (up to 6 hops) asking other nodes to send you their latest public broadcasts.
*   **Verification**: Click on the **TRUTH_HASH** code to verify cryptographic integrity (Ed25519 signature check).

## 4. Secure Chat & Media
Navigate to the **Chat** tab to send private messages.
*   **Encryption**: All messages are E2E encrypted (ChaCha20-Poly1305) before leaving your device.
*   **Media Recording**: You can record Audio and Video messages directly. These are chunked and sent over Tor.
*   **Mesh Recovery**: If you try to view a video from a user who has gone offline, gChat will ask your *other* peers if they have a copy of the file. If found, it will seamlessly download it from them.

## 5. Group Chats
gChat supports encrypted group conversations.
*   **Creating a Group**: Click the `+` icon in the Chat sidebar. Name your group and select initial members.
*   **Adding Members**: Open the Group Settings (Gear icon) -> "Add Member". 
    *   *Note: Only members you have already added to your Contacts list can be invited.*
*   **Group Settings**:
    *   **Mute**: Stop receiving toast notifications for a specific group.
    *   **Manage Members**: Admins can Kick or Ban members. Banned members cannot be re-added.

## 6. Managing Contacts

### Your Identity
Navigate to the **Contacts** tab. The card at the top is your identity.
*   **QR Code**: This contains a "Deep Link" (`http://localhost:3000/?action=add...`).
*   **Invite Link**: Click "Copy Address" to copy the full invite link.

### Adding Peers (Mobile)
1.  Open your phone's Camera app.
2.  Scan a friend's gChat QR code.
3.  Tap the link. It will open your local gChat instance (`localhost:3000`) and automatically add the contact.

### Adding Peers (Manual)
1.  Click **"Add Contact"**.
2.  Paste their `.onion` address or the full invite link.
3.  Click **Connect**.

## 7. Settings & Tools
Navigate to the **Settings** tab.
*   **Network Status**: Toggle your connection Online/Offline.
*   **Debug Logs**: View raw real-time logs. Useful for troubleshooting connection issues.
*   **Keys**: Export your private keys for backup. **Important**: If you clear your browser data, your identity is lost unless you have this backup.
*   **Graceful Shutdown**: Click "Graceful Shutdown" in the Danger Zone to stop the node safely. A red screen will appear; wait for it to say "Server Exited" before closing the tab.
*   **Delete Node Identity**: This is the "Nuclear Option". It will:
    1.  Broadcast a deletion signal to all peers.
    2.  Mark your posts as orphaned on their devices.
    3.  Wipe your local data and reset the app.
