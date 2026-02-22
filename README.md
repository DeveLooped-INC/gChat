> ⚠️ **WARNING: PROMETHEAN CODE INSIDE**
> 
> This platform, while rigorously tested and functionally robust, is the lovechild of a **super woke software noob Humanist** prompting a **super Genius AI** (mostly Gemini 3 Pro).
> 
> The cryptography is real. The Tor circuits are real. The code works. But please proceed with the delightful knowledge that this architecture is what happens when human idealism collides with machine precision. We built this to free the world. 😉

# 🧅 gChat: The Sovereign Social Node

> **Real wide-reaching public social networking on a completely decentralized mesh. No servers. No masters. Pure privacy.**

![Status](https://img.shields.io/badge/Status-v1.4.0--Stable-green)
![License](https://img.shields.io/badge/License-MIT-blue)
![Stack](https://img.shields.io/badge/Tech-Node_Tor_React-blueviolet)

---

## ✊ Why the World Needs gChat

The internet is broken. We fixed it. gChat proves that a **global, public, wide-reaching social network** can exist without a single central server, without compromising privacy, and without algorithmic manipulation.

*   🚫 **Kill the Algorithm**: No engagement farming. No shadow-banning. No ads. You see what the mesh broadcasts, chronologically. Period.
*   🛡️ **Absolute Privacy**: No phone numbers, no emails. Your identity is a cryptographic key. The app runs locally on your device.
*   🕸️ **Uncensorable Mesh**: You connect directly to peers. There is no central server to seize, subpoena, or shut down.
*   🤝 **Real Human Connection**: Designed for communities, activists, and friends to speak freely.

---

## 🪄 The Magic: Novel Protocol Orchestration

gChat achieves serverless public broadcasting and private messaging by weaving together a unique stack of proven cryptographic protocols. This orchestrated dance turns your local device into an impenetrable fortress that can still talk to the world:

1. 🧅 **Tor v3 Onion Services (The Transport Layer)**: 
   gChat automatically spawns a native Tor daemon and generates a v3 Hidden Service (`.onion` address) on your device. All network traffic is routed through 3 randomized relay nodes in the Tor network. **Your IP address is never revealed to anyone—not even your friends.**
   
2. 🔑 **Ed25519 & ChaCha20-Poly1305 (The Identity & Crypto Layer)**:
   There are no usernames/passwords. Your identity is mathematically derived from an Ed25519 keypair. Public posts are cryptographically signed (proving author authenticity without a central registry). Private direct messages and group chats are End-to-End Encrypted (E2EE) with NaCl (ChaCha20) before they ever leave your browser.
   
3. 🌊 **Daisy-Chain Gossip (The Social Layer)**:
   How do you have a "Public Feed" without a server? When you post, your node sends the payload to your connected peers. They seamlessly forward (gossip) it to *their* peers, up to 6 hops away. This mesh-flooding protocol allows your voice to reach thousands of nodes globally while you only maintain a few direct connections.
   
4. 🎞️ **Pure Streaming Proxy (The Media Layer)**:
   Watching a 50MB video from an unknown author 4 hops away? gChat's novel media relay dynamically forms a **daisy-chain streaming proxy** through your trusted friends. The media streams seamlessly to you, chunk-by-chunk, without ever downloading fully to intermediary nodes and without ever exposing your `.onion` address to the original author.

5. 🖥️ **Master/Slave Node Topology (The Infrastructure Layer)**:
   You're no longer restricted to a single monolithic device. gChat operates with granular `NODE_ROLE` definitions (`MASTER`, `SLAVE_FRONTEND`, `SLAVE_STORAGE`, `MICRO_SITE`). A headless Master shields your identity, while Frontend Slaves connect securely over LAN to interact.

---

## 🚀 Key Features

*   **Zero-Config Tor Setup**: Automatically manages Tor on Windows, Mac, Linux, and Android (Termux).
*   **Automated Network Deployer**: Run `npm run deploy` to autonomously scan your local LAN/SSH, benchmark hardware, and distribute Master/Slave roles to multiple machines seamlessly.
*   **Dual-Onion Services**: Master nodes maintain distinct public mesh and private admin hidden services for uncompromising operational security.
*   **Plugin & Theme System**: Deeply extensible codebase dynamically loads backend `plugins/` and frontend CSS `themes/` on boot.
*   **Handle.Tripcode Identity**: Decentralized but human-readable names (`Alice.x7z9`) mathematically immune to impersonation.
*   **Dual-Lane Architecture**: Non-blocking sockets. Downloading that massive video file won't stop your text DMs from arriving instantly.
*   **Rich Media Ecosystem**: Record Audio/Video directly in the app, securely chunked and relayed.
*   **Encrypted Node Migration**: Full account backup via AES-GCM encrypted ZIP files. Move devices seamlessly.

---

## � CRITICAL PRIVACY TIPS & WARNINGS

gChat's architecture provides extreme anonymity, but **operational security relies on you**. Please read carefully:

1. **Keep Your Node Alive**: The decentralized mesh relies on active nodes. If everyone turns off their devices, the network halts. Run your node as often as possible to support the mesh!
2. **Never Click Unverified Links**: gChat protects your internal traffic, but if you click a standard `https://` link inside a chat, your normal browser will open it, exposing your real IP to that website. 
3. **Guard Your Onion**: Do not paste your `.onion` invite link in public Clearnet forums (Twitter, Reddit) unless you specifically want the entire world (and adversaries) attempting to connect to your node.
4. **Browser Fingerprinting**: While your IP is hidden by Tor, your local browser (Chrome/Firefox) can still be fingerprinted by its window size, fonts, and extensions if a malicious actor finds an exploit. 
5. **Debug Logs Hazard**: The "System Logs" tab in settings contains raw connection data and `.onion` addresses. **Do not screenshot or paste these logs publicly** without redacting `.onion` addresses.
6. **The Nuclear Option**: In Settings, the **"Delete Node Identity"** button is irreversible. It broadcasts a cryptographically signed deletion signal destroying your posts across the mesh, wipes your local database, and erases your keys. Use only in emergencies. 

PLEASE NOTE! This does NOT guarantee that your old broadcasts will get removed from all nodes because if they never reconnect to a node that knows about the deletion of your identity, they have no way of finding out.

---

## 🛠️ Quick Start

### Prerequisites
1. **Node.js**: v24.13.0 or higher.
2. **Tor Browser**: v13.0.9 or higher (Optional but recommended for Desktop).

### 🖥️ Desktop (Windows, Mac, Linux)
#### Single Node Setup
```bash
npm install
npm start
```

#### Distributed Mesh Setup (Master/Slave)
*Note: All target devices must have an SSH server enabled and running. See the User Guide for OS-specific instructions.*
```bash
npm install
npm run deploy
```
*The `deploy` wizard will ping your local network, ask for SSH passwords, automatically detect the Master IP, and install gChat to your other devices as Headless Masters, Storage Slaves, or Frontend interfaces, fully configured as PM2 system services.*

### 📱 Mobile (Android via Termux)
```bash
# In Termux:
pkg update
pkg install nodejs git python make build-essential tor

git clone https://github.com/DeveLooped-INC/gChat.git
cd gChat
npm install
npm start
```

---

## 📚 Official Documentation

Detailed reading is available in the `docs/` folder:

*   📖 **[The User Guide](docs/USER_GUIDE.md)**: How to master the UI, manage contacts, and configure settings.
*   🏗️ **[Architecture Deep-Dive](docs/ARCHITECTURE.md)**: Explore the Socket.IO + Tor bridging and State Sync engines.
*   🔐 **[Security Model](docs/SECURITY.md)**: Understand the math behind your identity and the E2E encryption.
*   🗺️ **[Project Status & Plan](docs/PROJECT_STATUS.md)**: See the latest changelog and what we are building next.

> *gChat: Built for humans. Powered by math.*
