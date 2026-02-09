> ⚠️ **WARNING: PROMETHEAN CODE INSIDE**
> 
> This platform, while rigorously tested and functionally robust, is the lovechild of a **super woke software noob Humanist** prompting a **super Genius AI** (Gemini 3 pro).
> 
> The cryptography is real. The Tor circuits are real. The code works. But please proceed with the delightful knowledge that this architecture is what happens when human idealism collides with machine precision. We built this to free the world, but if it accidentally becomes sentient, that's a feature, not a bug. 😉

# gChat: Decentralized Onion-Routed Social

> **A privacy-first, local-first social platform powered by real Tor Onion Services.**

![Status](https://img.shields.io/badge/Status-v1.2.2_Stable-green)
![License](https://img.shields.io/badge/License-MIT-blue)
![Stack](https://img.shields.io/badge/Tech-Node_Tor_React-blueviolet)

## ✊ Why the World Needs gChat

The internet is broken. We fixed it.

*   🚫 **Kill the Algorithm**: No engagement farming. No shadow-banning. No ads. You see what your friends post, chronologically. Period.
*   🕵️ **Zero Metadata**: We don't just encrypt the message; we hide *who* you are talking to. Thanks to Tor Onion Services, your social graph is invisible to ISPs and governments.
*   📱 **Local Sovereignty**: Your data lives on **your** device. If Amazon Web Services goes down, gChat stays up.
*   🕸️ **Uncensorable Mesh**: Connect directly to peers. There is no central server to seize, subpoena, or shut down.
*   🤝 **Real Human Connection**: Designed for communities, activists, and friends—not for "Busers" to be monetized.

---

## 📚 Documentation

Detailed documentation has been moved to the `docs/` folder:

*   **[User Guide](docs/USER_GUIDE.md)**: How to install, connect, and use the app.
*   **[Architecture](docs/ARCHITECTURE.md)**: Deep dive into the Node.js backend and React frontend.
*   **[Security Model](docs/SECURITY.md)**: Explanation of the Ed25519 identity and encryption simulation.
*   **[Project Plan](docs/PROJECT_PLAN.md)**: Vision, core pillars, and roadmap.
*   **[Project Status](docs/PROJECT_STATUS.md)**: Current changelog and known issues.

---

## 🚀 Features

*   **Real Tor Integration**: Spawns a native `tor` daemon and manages Hidden Services.
*   **Global Sync Protocol**: Active "Pull" mechanism to force synchronization of public posts across the mesh using daisy-chain flooding.
*   **Self-Healing Mesh**: If a node hosting media goes offline, the network automatically searches connected peers for a cached copy using `Proof of Access` tokens.
*   **Onion-Routed Privacy**: All traffic is routed through 3 hops. No IP leaks.
*   **Encrypted Messaging**: End-to-end encrypted chat using NaCl (Ed25519/Curve25519).
*   **Smart Media Auto-Download**: Configurable settings to automatically download media from friends and private chats via the secure mesh or standard HTTP.
*   **Graceful Shutdown**: Dedicated protocol to notify peers of departure, stop the Hidden Service, and cleanly terminate the Tor process to prevent data corruption.
*   **Decentralized Moderation**: Community-driven content filtering (Up/Downvotes) with configurable visibility settings and automatic "Hard Hiding" for heavily downvoted content.

## 🛠️ Quick Start

### Prerequisites

1.  **Node.js**
    * Install Node.js v24.13.0 or higher.
    * Install npm v11.6.2 or higher.

2.  **Tor (Optional)**
    * Install Tor Browser v13.0.9 or higher.

### 🖥️ Desktop (Windows, Mac, Linux)

1.  **Install Dependencies**
    ```bash
    npm install
    ```
2.  **Run Node**
    ```bash
    npm start
    ```
    This will:
    1. Start the Tor Backend.
    2. Start the Frontend Server.
    3. **Automatically open your default browser** to `http://localhost:3000`.

### 📱 Android & Apple (Termux)

gChat is designed to run on your phone using Termux.

1.  **Install Termux Requirements**
    ```bash
    pkg update
    pkg install nodejs git python make build-essential tor
    ```
    *Important: You MUST install `tor` via pkg (the system package manager).*

2.  **Clone & Install**
    ```bash
    git clone https://github.com/DeveLooped-INC/gChat.git
    cd gChat
    npm install
    ```

3.  **Run**
    ```bash
    npm start
    ```
    The app will detect it is running in Termux, patch the binary paths automatically, and launch your Android browser.

### Termux (Android)

1.  Current Termux environment recommended.
2.  Run the setup script to install dependencies (`python`, `clang`, `make`):
    ```bash
    chmod +x scripts/setup-termux.sh
    ./scripts/setup-termux.sh
    ```
3.  Start the app: `npm start`

## 🤝 Connecting Peers

1.  **Generate Identity**: Finish onboarding to get your `.onion` address.
2.  **Share**: Go to the **Contacts** tab.
3.  **Scan**: 
    *   If you are on Mobile, point your camera at a friend's gChat QR code. 
    *   The QR code contains a local link (`http://localhost:3000/?action=add...`).
    *   Your browser will open gChat and automatically add the contact.

## 🔒 Security

*   **Identity**: Ed25519 keys generated locally.
*   **Transport**: Tor v3 Onion Services (End-to-end encrypted routing).
*   **Isolation**: The backend listens strictly on `127.0.0.1`. It is not accessible from your LAN, ensuring your node remains private even on public Wi-Fi.
*   **Media Access**: Cached media files are protected by `accessKey` verification.

## 🏗️ Architecture

gChat follows a **Universal Client-Server** model:

1.  **Backend (`server.js`)**:
    *   Runs as a standard Node.js process.
    *   Manages the `tor` binary (Port 9990 for SOCKS, 9991 for Control).
    *   Exposes a Socket.IO API on Port 3001.
    *   Hosts the Hidden Service entry point on Port 3456.
2.  **Frontend (React/Vite)**:
    *   Connects to the Backend via Socket.IO (`http://localhost:3001`).
    *   Handles keys and encryption (NaCl).
    *   **Browser Cache**: Uses the Browser Cache API (`gchat-media-v1`) to persist and serve blob data.
