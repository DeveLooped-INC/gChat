import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn, exec, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios from 'axios';
import net from 'net';
import { fileURLToPath } from 'url';
import readline from 'readline';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURATION ---
const PORT = 3001;
const TOR_SOCKS_PORT = 9990;
const TOR_CONTROL_PORT = 9991;
const INCOMING_PORT = 3456;
const CONNECTION_TIMEOUT_MS = 600000; // 10 Minutes

// Determine Data Directory (Default to System AppData)
const USER_DATA_DIR = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share");
const APP_DATA_ROOT = path.join(USER_DATA_DIR, 'gchat');

const HIDDEN_SERVICE_DIR = path.join(APP_DATA_ROOT, 'tor', 'service');
const TOR_DATA_DIR = path.join(APP_DATA_ROOT, 'tor', 'data');

console.log(`[Server] Data Directory: ${APP_DATA_ROOT}`);

// --- PREVENT EIO CRASHES ---
const suppressStdinError = (err) => {
    if (err.code === 'EIO') return;
    console.error('Stdin Error:', err);
};
process.stdin.on('error', suppressStdinError);

process.on('uncaughtException', (err) => {
    if (err.code === 'EIO') return;
    console.error('Uncaught Exception:', err);
    if (err.code !== 'EIO') process.exit(1);
});

// --- TERMUX SPECIFIC SETUP ---
const TERMUX_PREFIX = '/data/data/com.termux/files/usr';
const TERMUX_BIN = path.join(TERMUX_PREFIX, 'bin');

const app = express();
const httpServer = createServer(app);

// Increase Server Timeout to match client timeout
httpServer.setTimeout(CONNECTION_TIMEOUT_MS);

const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000
});

// --- GLOBAL STATE ---
let isShuttingDown = false;

// --- LOGGING HELPER ---
function broadcastLog(level, area, message, details = null) {
    if (isShuttingDown && (level === 'WARN' || level === 'ERROR') && area === 'NETWORK') {
        return;
    }

    const entry = {
        timestamp: Date.now(),
        level,
        area,
        message,
        details
    };
    try {
        io.emit('debug-log', entry);
    } catch (e) { }

    const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[32m';
    console.log(`${color}[${level}] [${area}] ${message}\x1b[0m`);
    if (details) console.log(details);
}

// Fix PATH for Termux Environment
if (process.platform === 'android' || fs.existsSync(TERMUX_BIN)) {
    if (!process.env.PATH.includes(TERMUX_BIN)) {
        process.env.PATH = `${TERMUX_BIN}:${process.env.PATH}`;
    }
}

// --- BINARY DETECTION ---
let TOR_CMD = 'tor';

const localBinPath = path.join(__dirname, 'bin', process.platform === 'win32' ? 'tor.exe' : 'tor');
const termuxTorPath = path.join(TERMUX_BIN, 'tor');

if (process.platform === 'android' || fs.existsSync(TERMUX_BIN)) {
    if (fs.existsSync(termuxTorPath)) {
        TOR_CMD = termuxTorPath;
    } else {
        try {
            execSync('pkg update -y && pkg install tor -y', { stdio: 'inherit' });
            if (fs.existsSync(termuxTorPath)) TOR_CMD = termuxTorPath;
        } catch (installErr) {
            broadcastLog('ERROR', 'BACKEND', `❌ Auto-install failed: ${installErr.message}`);
        }
    }
}
else if (fs.existsSync(localBinPath)) {
    TOR_CMD = localBinPath;
}
else {
    try {
        const systemTor = execSync('which tor').toString().trim();
        if (systemTor && fs.existsSync(systemTor)) {
            TOR_CMD = systemTor;
        }
    } catch (e) { }
}

let torProcess = null;
let myOnionAddress = null;
let controlSocket = null;

// --- EXIT HELPER ---
function cleanupAndExit() {
    isShuttingDown = true;

    try {
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        process.stdin.removeAllListeners();
        process.stdin.pause();
        process.stdin.destroy();
        process.stdin.on('error', () => { });
    } catch (e) { }

    if (torProcess) {
        torProcess.kill('SIGKILL');
    }

    setTimeout(() => {
        process.exit(0);
    }, 100);
}

if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
}
readline.emitKeypressEvents(process.stdin);

process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'q') {
        broadcastLog('WARN', 'BACKEND', 'Shutdown Sequence Initiated via Terminal...');
        const connectedClients = io.engine.clientsCount;
        if (connectedClients > 0) {
            io.emit('system-shutdown-request');
            setTimeout(() => {
                cleanupAndExit();
            }, 8000);
        } else {
            cleanupAndExit();
        }
    }
    if (key.ctrl && key.name === 'c') {
        cleanupAndExit();
    }
});

// --- EXPRESS ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use((err, req, res, next) => {
    if (err.type === 'aborted' || err.code === 'ECONNABORTED') {
        return;
    }
    if (err.status === 400 && err.type === 'entity.parse.failed') {
        res.status(400).send({ status: 'error', code: 'invalid_json' });
        return;
    }
    if (err.name === 'BadRequestError' && err.message === 'request aborted') {
        return;
    }
    next(err);
});

app.get('/gchat/health', (req, res) => {
    res.status(200).send({ status: 'online', nodeId: myOnionAddress });
});

app.post('/gchat/packet', (req, res) => {
    broadcastLog('INFO', 'NETWORK', `Packet received from ${req.ip}`, { type: req.body?.type, sender: req.body?.senderId });
    io.emit('tor-packet', req.body);
    res.status(200).send({ status: 'received' });
});

// Outbound Packet Endpoint (Internal) - Called by networkService via Socket IO actually?
// Wait, networkService uses socket.emit('send-packet').
// I need to find the socket handler for 'send-packet' in server.js.
// It was not visible in previous views? It must be there.
// View lines 500-600 or similar? I viewed 150-300 and 350-450.
// Let's find 'send-packet' handler first.



// --- DATABASE ---
import { Database } from './database.js';
const db = new Database(APP_DATA_ROOT);
const MEDIA_BASE_DIR = path.join(APP_DATA_ROOT, 'media');
const MEDIA_LOCAL_DIR = path.join(MEDIA_BASE_DIR, 'local');
const MEDIA_CACHE_DIR = path.join(MEDIA_BASE_DIR, 'cache');

if (!fs.existsSync(MEDIA_LOCAL_DIR)) fs.mkdirSync(MEDIA_LOCAL_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_CACHE_DIR)) fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });

// --- MIGRATION & PRUNING ---
// 1. Migration: Move root media files to local (Legacy Support)
try {
    fs.readdirSync(MEDIA_BASE_DIR).forEach(file => {
        const oldPath = path.join(MEDIA_BASE_DIR, file);
        if (fs.lstatSync(oldPath).isFile()) {
            fs.renameSync(oldPath, path.join(MEDIA_LOCAL_DIR, file));
        }
    });
} catch (e) {
    console.error("[Server] Migration Warning:", e.message);
}

// 2. Prune Cache (> 7 Days)
try {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    fs.readdirSync(MEDIA_CACHE_DIR).forEach(file => {
        const filePath = path.join(MEDIA_CACHE_DIR, file);
        if (Date.now() - fs.statSync(filePath).mtimeMs > SEVEN_DAYS_MS) {
            fs.unlinkSync(filePath);
            console.log(`[Server] Pruned old cache file: ${file}`);
        }
    });
} catch (e) {
    console.error("[Server] Pruning Warning:", e.message);
}

function killGhostTor() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            const cmd = 'pkill -9 tor || killall -9 tor || killall tor';
            exec(cmd, () => {
                setTimeout(resolve, 500);
            });
        } else {
            resolve();
        }
    });
}

function waitForPort(port, retries = 20) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = setInterval(() => {
            attempts++;
            const client = new net.Socket();
            client.once('connect', () => {
                client.destroy();
                clearInterval(check);
                resolve(true);
            });
            client.once('error', () => {
                client.destroy();
                if (attempts >= retries) {
                    clearInterval(check);
                    resolve(false);
                }
            });
            client.connect(port, '127.0.0.1');
        }, 1000);
    });
}

// --- NETWORK AGENTS ---
// We use two separate agents:
// 1. Control Agent: For small packets (Handshakes, Posts, Text). Fast, responsive.
// 2. Data Agent: For large streams (Media). Persistent, handles backpressure.
// Reusing agents with Keep-Alive prevents socket exhaustion on the local machine.

let _controlAgent = null;
let _dataAgent = null;

function getControlAgent() {
    if (!_controlAgent) {
        _controlAgent = new SocksProxyAgent(`socks5h://127.0.0.1:${TOR_SOCKS_PORT}`, {
            keepAlive: true,
            keepAliveMsecs: 1000,
            timeout: 30000 // 30s socket timeout
        });
    }
    return _controlAgent;
}

function getDataAgent() {
    if (!_dataAgent) {
        _dataAgent = new SocksProxyAgent(`socks5h://127.0.0.1:${TOR_SOCKS_PORT}`, {
            keepAlive: true,
            keepAliveMsecs: 5000,
            timeout: CONNECTION_TIMEOUT_MS // Long timeout for large files
        });
    }
    return _dataAgent;
}

async function fetchWithRetry(url, options, streamId = null, retries = 3) {
    // If it's a stream (media transfer), we reduce internal retries to avoid duplicate data pushing.
    // The frontend handles the retry logic for media chunks more intelligently.
    // If retries arg is explicitly provided passed (e.g. 0), use it, otherwise default logic.
    const effectiveRetries = streamId ? 1 : retries;
    const isStream = !!streamId;

    for (let i = 0; i < effectiveRetries; i++) {
        if (isShuttingDown && i > 0) return;

        // Select appropriate agent to avoid blocking control traffic behind large downloads
        const agent = isStream ? getDataAgent() : getControlAgent();

        const controller = new AbortController();
        // Use global timeout for data, shorter for control
        const timeoutDuration = isStream ? CONNECTION_TIMEOUT_MS : 30000;
        const timeout = setTimeout(() => controller.abort(), timeoutDuration);

        try {
            const headers = { ...(options.headers || {}) };

            // Allow Keep-Alive to reuse the Tor circuit connection
            headers['Connection'] = 'keep-alive';

            const config = {
                url,
                method: options.method || 'GET',
                headers,
                httpAgent: agent,
                httpsAgent: agent,
                signal: controller.signal,
                validateStatus: () => true,
                data: options.body,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: timeoutDuration
            };

            const res = await axios(config);
            clearTimeout(timeout);

            return {
                ok: res.status >= 200 && res.status < 300,
                status: res.status
            };
        } catch (err) {
            clearTimeout(timeout);
            if (isShuttingDown) return;

            if (i === effectiveRetries - 1) throw err;

            // Backoff logic
            const delay = (1000 * Math.pow(2, i)) + (Math.random() * 500);
            if (!isStream) {
                // Only log control packet retries to keep logs clean
                broadcastLog('WARN', 'NETWORK', `Retry ${i + 1}/${effectiveRetries} for ${url}. Error: ${err.code || err.message || err}`);
            }
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

function connectToControlPort() {
    if (controlSocket) controlSocket.destroy();
    controlSocket = new net.Socket();
    controlSocket.connect(TOR_CONTROL_PORT, '127.0.0.1', () => {
        controlSocket.write('AUTHENTICATE ""\r\n');
        setInterval(() => {
            if (controlSocket && !controlSocket.destroyed) controlSocket.write('GETINFO circuit-status\r\n');
        }, 5000);
    });
    controlSocket.on('data', (data) => {
        const str = data.toString();
        if (str.includes('circuit-status=')) {
            const builtCircuits = (str.match(/BUILT/g) || []).length;
            const guards = (str.match(/GUARD/g) || []).length;
            io.emit('tor-stats', { circuits: builtCircuits, guards: guards, status: 'Active' });
        }
    });
    controlSocket.on('error', () => { });
}

async function startTor() {
    await killGhostTor();

    if (!fs.existsSync(HIDDEN_SERVICE_DIR)) fs.mkdirSync(HIDDEN_SERVICE_DIR, { recursive: true });
    if (!fs.existsSync(TOR_DATA_DIR)) fs.mkdirSync(TOR_DATA_DIR, { recursive: true });
    if (process.platform !== 'win32') {
        try { fs.chmodSync(TOR_DATA_DIR, 0o700); } catch (e) { }
        try { fs.chmodSync(HIDDEN_SERVICE_DIR, 0o700); } catch (e) { }
    }

    // Define paths
    const torrcPath = path.join(TOR_DATA_DIR, 'torrc');
    const bridgesPath = path.join(APP_DATA_ROOT, 'bridges.txt');
    const binDir = path.dirname(TOR_CMD);

    // Locate OBFS4 Proxy
    const obfs4Name = process.platform === 'win32' ? 'obfs4proxy.exe' : 'obfs4proxy';
    // Check common locations: same dir as tor, or in PluggableTransports subdir
    let obfs4Path = path.join(binDir, obfs4Name);
    if (!fs.existsSync(obfs4Path)) {
        obfs4Path = path.join(binDir, 'PluggableTransports', obfs4Name);
    }

    // --- GENERATE TORRC ---
    let torrcContent = `
SocksPort ${TOR_SOCKS_PORT}
ControlPort ${TOR_CONTROL_PORT}
CookieAuthentication 0
DataDirectory ${TOR_DATA_DIR}
HiddenServiceDir ${HIDDEN_SERVICE_DIR}
HiddenServicePort 80 127.0.0.1:${INCOMING_PORT}
`;

    // Configure Bridges if available
    if (fs.existsSync(obfs4Path)) {
        torrcContent += `\nClientTransportPlugin obfs4 exec ${obfs4Path}\n`;

        if (fs.existsSync(bridgesPath)) {
            const bridgesInfo = fs.readFileSync(bridgesPath, 'utf-8').trim();
            if (bridgesInfo.length > 0) {
                broadcastLog('INFO', 'TOR', 'Using Configured Bridges from bridges.txt');
                torrcContent += `UseBridges 1\n`;
                // Add "Bridge" prefix if user just pasted the line
                const lines = bridgesInfo.split('\n');
                lines.forEach(line => {
                    let safeLine = line.trim();
                    if (!safeLine || safeLine.startsWith('#')) return;
                    if (!safeLine.startsWith('Bridge ')) safeLine = `Bridge ${safeLine}`;
                    torrcContent += `${safeLine}\n`;
                });
            }
        }
    } else {
        broadcastLog('WARN', 'TOR', 'OBFS4 Proxy not found. Bridges unavailable.');
    }

    fs.writeFileSync(torrcPath, torrcContent);

    try {
        // Launch Tor with torrc
        const args = ['-f', torrcPath];
        torProcess = spawn(TOR_CMD, args, { env: process.env });

        torProcess.stdout.on('data', (data) => {
            const log = data.toString().trim();
            if (log.includes('Bootstrapped 100%')) {
                broadcastLog('INFO', 'TOR', 'Bootstrapped 100%');
                waitForPort(TOR_SOCKS_PORT).then((isOpen) => {
                    if (isOpen) {
                        readOnionAddress();
                        io.emit('tor-status', 'connected');
                        connectToControlPort();
                    }
                });
            }
        });
        torProcess.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            // Ignore non-critical notices
            if (msg.includes('NOTICE') && !msg.includes('error')) return;

            if (msg.includes('Could not bind to 127.0.0.1:9990')) {
                broadcastLog('ERROR', 'TOR', 'Port 9990 in use.');
                setTimeout(startTor, 2000);
            } else {
                console.log(`[TOR STDERR] ${msg}`);
            }
        });
        torProcess.on('close', (code) => {
            io.emit('tor-status', 'disconnected');
        });
    } catch (e) {
        broadcastLog('ERROR', 'TOR', `Exception during spawn: ${e.message}`);
    }
}

function readOnionAddress() {
    const hostnamePath = path.join(HIDDEN_SERVICE_DIR, 'hostname');
    let attempts = 0;
    const check = setInterval(() => {
        attempts++;
        if (fs.existsSync(hostnamePath)) {
            try {
                const address = fs.readFileSync(hostnamePath, 'utf-8').trim();
                if (address) {
                    myOnionAddress = address;
                    broadcastLog('INFO', 'TOR', `Service Address Created: ${myOnionAddress}`);
                    io.emit('onion-address', myOnionAddress);
                    clearInterval(check);
                }
            } catch (e) { }
        }
        if (attempts > 30 && !myOnionAddress) clearInterval(check);
    }, 1000);
}

io.on('connection', (socket) => {
    if (myOnionAddress) {
        socket.emit('onion-address', myOnionAddress);
        socket.emit('tor-status', 'connected');
    }
    socket.on('get-onion-address', (cb) => { if (cb) cb(myOnionAddress); });
    socket.on('get-tor-keys', (cb) => {
        try {
            const keys = {};
            ['hostname', 'hs_ed25519_secret_key', 'hs_ed25519_public_key'].forEach(file => {
                const filePath = path.join(HIDDEN_SERVICE_DIR, file);
                if (fs.existsSync(filePath)) keys[file] = fs.readFileSync(filePath).toString('base64');
            });
            cb({ success: true, keys });
        } catch (e) { cb({ success: false, error: e.message }); }
    });
    socket.on('restore-tor-keys', (keys, cb) => {
        try {
            if (!fs.existsSync(HIDDEN_SERVICE_DIR)) fs.mkdirSync(HIDDEN_SERVICE_DIR, { recursive: true });
            if (process.platform !== 'win32') fs.chmodSync(HIDDEN_SERVICE_DIR, 0o700);
            Object.entries(keys).forEach(([filename, contentBase64]) => {
                const buffer = Buffer.from(contentBase64, 'base64');
                const filePath = path.join(HIDDEN_SERVICE_DIR, filename);
                fs.writeFileSync(filePath, buffer);
                if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600);
            });
            if (torProcess) torProcess.kill();
            killGhostTor().then(() => startTor());
            cb({ success: true });
        } catch (e) { cb({ success: false, error: e.message }); }
    });
    socket.on('restart-tor', async () => {
        if (torProcess) torProcess.kill();
        await killGhostTor();
        startTor();
    });

    // --- BRIDGE MANAGEMENT ---
    socket.on('get-bridges', (cb) => {
        const bridgesPath = path.join(APP_DATA_ROOT, 'bridges.txt');
        if (fs.existsSync(bridgesPath)) {
            const content = fs.readFileSync(bridgesPath, 'utf-8');
            cb(content);
        } else {
            cb('');
        }
    });

    socket.on('save-bridges', (content, cb) => {
        try {
            const bridgesPath = path.join(APP_DATA_ROOT, 'bridges.txt');
            fs.writeFileSync(bridgesPath, content.trim());
            cb({ success: true });
            // Restart Tor to apply changes
            if (torProcess) torProcess.kill();
            killGhostTor().then(() => startTor());
        } catch (e) {
            cb({ success: false, error: e.message });
        }
    });

    // --- DATABASE OPERATIONS ---

    // KV STORE
    socket.on('kv:get', async (key, cb) => {
        try {
            const val = await db.kvGet(key);
            cb({ success: true, value: val });
        } catch (e) { cb({ success: false, error: e.message }); }
    });
    socket.on('kv:set', async (key, value, cb) => {
        try {
            await db.kvSet(key, value);
            cb({ success: true });
        } catch (e) { cb({ success: false, error: e.message }); }
    });
    socket.on('kv:del', async (key, cb) => {
        try {
            await db.kvDel(key);
            cb({ success: true });
        } catch (e) { cb({ success: false, error: e.message }); }
    });

    // OBJECT STORE
    socket.on('db:save', async (storeName, item, ownerId, cb) => {
        try {
            await db.saveItem(storeName, item, ownerId);
            cb({ success: true });
        } catch (e) { cb({ success: false, error: e.message }); }
    });
    socket.on('db:sync', async (storeName, items, ownerId, cb) => {
        try {
            if (storeName === 'notifications') {
                const logMsg = `[BACKEND] ${new Date().toISOString()} db:sync notifications. Owner: ${ownerId}, Count: ${items.length}\n`;
                fs.appendFileSync(path.join(APP_DATA_ROOT, 'debug_backend.log'), logMsg);
                console.log(logMsg.trim());
            }
            await db.syncItems(storeName, items, ownerId);
            cb({ success: true });
        } catch (e) {
            const errorMsg = `[BACKEND] ${new Date().toISOString()} db:sync failed for ${storeName}: ${e.message}\n`;
            fs.appendFileSync(path.join(APP_DATA_ROOT, 'debug_backend.log'), errorMsg);
            console.error(errorMsg.trim());
            cb({ success: false, error: e.message });
        }
    });
    socket.on('db:get-all', async (storeName, ownerId, cb) => {
        try {
            const items = await db.getItems(storeName, ownerId);
            if (storeName === 'notifications') {
                const logMsg = `[BACKEND] ${new Date().toISOString()} db:get-all notifications. Owner: ${ownerId}, Count: ${items.length}, FirstID: ${items[0]?.id || 'NONE'}\n`;
                fs.appendFileSync(path.join(APP_DATA_ROOT, 'debug_backend.log'), logMsg);
                console.log(logMsg.trim());
            }
            cb({ success: true, items });
        } catch (e) { cb({ success: false, error: e.message }); }
    });
    socket.on('db:delete', async (storeName, id, cb) => {
        try {
            await db.deleteItem(storeName, id);
            cb({ success: true });
        } catch (e) { cb({ success: false, error: e.message }); }
    });
    socket.on('db:clear', async (storeName, cb) => {
        try {
            await db.clearStore(storeName);
            cb({ success: true });
        } catch (e) { cb({ success: false, error: e.message }); }
    });

    // --- MEDIA OPERATIONS ---
    socket.on('media:upload', async ({ id, data, metadata, isCache }, cb) => {
        try {
            const targetDir = isCache ? MEDIA_CACHE_DIR : MEDIA_LOCAL_DIR;
            const filePath = path.join(targetDir, id);

            let buffer;
            if (Buffer.isBuffer(data)) {
                buffer = data;
            } else {
                buffer = Buffer.from(data, 'base64');
            }
            fs.writeFileSync(filePath, buffer);

            await db.saveMediaMetadata(metadata);
            if (typeof cb === 'function') cb({ success: true });
        } catch (e) {
            console.error("Media Upload Error", e);
            if (typeof cb === 'function') cb({ success: false, error: e.message });
        }
    });

    socket.on('media:download', async ({ id }, cb) => {
        try {
            // Check Local First
            let filePath = path.join(MEDIA_LOCAL_DIR, id);
            if (!fs.existsSync(filePath)) {
                // Check Cache
                filePath = path.join(MEDIA_CACHE_DIR, id);
                if (!fs.existsSync(filePath)) {
                    cb({ success: false, error: 'Not Found' });
                    return;
                }
            }
            const buffer = fs.readFileSync(filePath);
            const metadata = await db.getMediaMetadata(id);
            // Send raw buffer for efficiency
            cb({ success: true, buffer, metadata });
        } catch (e) { cb({ success: false, error: e.message }); }
    });

    socket.on('media:exists', async ({ id }, cb) => {
        try {
            const local = fs.existsSync(path.join(MEDIA_LOCAL_DIR, id));
            const cache = fs.existsSync(path.join(MEDIA_CACHE_DIR, id));
            cb({ success: local || cache });
        } catch (e) { cb({ success: false }); }
    });

    socket.on('media:verify', async (id, providedKey, cb) => {
        try {
            const metadata = await db.getMediaMetadata(id);
            if (!metadata) {
                cb(false); // Media not found, deny access
                return;
            }
            // If accessKey matches, OR if no accessKey set (public?), allow.
            // For now, assume simple equality.
            const allowed = (metadata.accessKey === providedKey) || (!metadata.accessKey);
            cb(allowed);
        } catch (e) {
            console.error("Verify Error", e);
            cb(false);
        }
    });

    socket.on('factory-reset', async (cb) => {
        try {
            broadcastLog('WARN', 'BACKEND', '⚠️ FACTORY RESET INITIATED ⚠️');

            // 1. Kill Tor
            if (torProcess) torProcess.kill();

            // 2. Kill Ghost Tor
            await killGhostTor();

            // 3. Delete Data Directory
            try {
                if (fs.existsSync(APP_DATA_ROOT)) {
                    fs.rmSync(APP_DATA_ROOT, { recursive: true, force: true });
                }
                broadcastLog('INFO', 'BACKEND', 'Data directory wiped.');
                cb({ success: true });
            } catch (err) {
                cb({ success: false, error: err.message });
            }

            // 4. Exit to force restart (System/Supervisor should restart)
            setTimeout(() => {
                process.exit(0);
            }, 500);
        } catch (e) {
            cb({ success: false, error: e.message });
        }
    });

    socket.on('system-shutdown-prep', () => { isShuttingDown = true; });
    socket.on('system-shutdown-confirm', () => {
        isShuttingDown = true;
        broadcastLog('WARN', 'BACKEND', 'Graceful Shutdown Confirmed.');
        setTimeout(() => {
            cleanupAndExit();
        }, 2000);
    });
    socket.on('client-log', (entry) => {
        const color = entry.level === 'ERROR' ? '\x1b[31m' : entry.level === 'WARN' ? '\x1b[33m' : '\x1b[36m';
        const msg = `[CLIENT][${entry.level}] [${entry.area}] ${entry.message}`;
        console.log(`${color}${msg}\x1b[0m`);
        try {
            fs.appendFileSync(path.join(APP_DATA_ROOT, 'debug_backend.log'), `${new Date().toISOString()} ${msg}\n`);
        } catch (e) { }
    });
    socket.on('ping-peer', async ({ targetOnion }, callback) => {
        try {
            const response = await fetchWithRetry(`http://${targetOnion}/gchat/health`, { method: 'GET' }, 'discovery');
            callback({ success: response.ok, error: response.ok ? null : `HTTP ${response.status}` });
        } catch (e) {
            callback({ success: false, error: e.message });
        }
    });
    socket.on('send-packet', async ({ targetOnion, payload, streamId }, callback) => {
        try {
            const response = await fetchWithRetry(`http://${targetOnion}/gchat/packet`, {
                method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }
            }, streamId);
            callback({ success: response.ok, error: response.ok ? null : `HTTP ${response.status}` });
        } catch (e) {
            callback({ success: false, error: e.message });
        }
    });
});

db.init().then(() => {
    console.log('[Server] Database initialized.');
    httpServer.listen(PORT, '127.0.0.1', () => {
        console.log(`[Server] Backend running on http://127.0.0.1:${PORT}`);
        app.listen(INCOMING_PORT, '127.0.0.1', () => {
            startTor();
        });
    });
}).catch(err => {
    console.error('[Server] Failed to initialize Database:', err);
    process.exit(1);
});

process.on('SIGINT', () => {
    // Attempt Graceful Shutdown (Notify Client to broadcast Exit Packet)
    if (io.engine.clientsCount > 0) {
        broadcastLog('WARN', 'BACKEND', 'SIGINT received. Requesting Graceful Shutdown from Client...');
        io.emit('system-shutdown-scheduled');
        // Force exit if client hangs (Wait 35s to allow for slow Tor ACKs)
        setTimeout(() => cleanupAndExit(), 35000);
    } else {
        cleanupAndExit();
    }
});
