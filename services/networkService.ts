// Universal Network Service using Socket.IO
import { io, Socket } from 'socket.io-client';
import { LogEntry, MediaMetadata, TorStats as ITorStats } from '../types';
import { getMedia, saveMedia, hasMedia, verifyMediaAccess, setMediaSocket } from './mediaStorage';
import { getTransferConfig, arrayBufferToBase64, base64ToArrayBuffer } from '../utils';
import { kvService } from './kv'; // Import KV Service

const BACKEND_URL = 'http://127.0.0.1:3001';

export interface PingResult {
    success: boolean;
    error?: string;
    latency?: number;
}

export type TorStats = ITorStats;

interface DownloadListener {
    onProgress: (p: number) => void;
    onComplete: (b: Blob) => void;
    onError: (e: string) => void;
}

interface ChunkRequest {
    index: number;
    sentAt: number;
    retries: number;
}

interface ActiveDownload {
    id: string;
    peerOnion: string;
    chunks: (ArrayBuffer | null)[];
    receivedCount: number;
    totalChunks: number;
    metadata: MediaMetadata;
    status: 'active' | 'paused' | 'completed' | 'error' | 'recovering';

    // Adaptive Logic
    queue: number[];
    inflight: Map<number, ChunkRequest>;
    concurrency: number; // Floating point, floored for usage
    chunkSize: number; // Fixed for the session

    // Stats
    rttSamples: number[];
    avgRtt: number;

    listeners: DownloadListener[];

    // Recovery State
    recoveryStartedAt?: number;
    lastRecoveryAttempt?: number;
}

type StatusListener = (isOnline: boolean, nodeId?: string) => void;
type PeerStatusListener = (peer: string, status: 'online' | 'offline', latency?: number) => void;

// --- WAKE LOCK HELPER ---
let wakeLock: any = null;
const requestWakeLock = async () => {
    try {
        if ('wakeLock' in navigator && !wakeLock) {
            // @ts-ignore
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn('Wake Lock failed:', err);
    }
};
const releaseWakeLock = () => {
    if (wakeLock) {
        wakeLock.release().then(() => {
            wakeLock = null;
        }).catch(() => { });
    }
};

export class NetworkService {
    public socket: Socket;

    public onMessage: (data: any, senderId: string) => void = () => { };
    public onPeerStatus: PeerStatusListener = () => { };
    public onLog: (msg: string) => void = () => { };
    public onStats: (stats: TorStats) => void = () => { };
    public onShutdownRequest: () => void = () => { };

    private _statusListeners: Set<StatusListener> = new Set();
    private _logs: LogEntry[] = [];
    public isDebugEnabled: boolean = false;

    private _myOnionAddress: string | null = null;
    private _knownPeers: Set<string> = new Set();
    private _trustedPeers: Set<string> = new Set(); // Explicitly connected/added peers
    private _activeDownloads: Map<string, ActiveDownload> = new Map();
    // Daisy Chain Relay State
    private _relayState: Map<string, { listeners: Set<string>; metadata: MediaMetadata }> = new Map(); // MediaID -> { Listeners, Metadata }
    private _relayHistory: Map<string, number> = new Map(); // RequestSignature -> Timestamp
    private _contactDirectory: Map<string, string> = new Map(); // OwnerID -> HomeNodeOnion
    private _isShuttingDown: boolean = false;

    constructor() {
        // Async load debug mode later

        this.socket = io(BACKEND_URL, {
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            timeout: 20000,
            autoConnect: true,
            transports: ['websocket', 'polling']
        });

        // INJECT SOCKET INTO MEDIA SERVICE
        setMediaSocket(this.socket);

        this.setupSocketListeners();

        // --- SLIDING WINDOW MONITOR ---
        setInterval(() => {
            if (this._isShuttingDown) return;
            this.maintainDownloads();
        }, 1000);
    }

    // --- LOGGING & STATUS HELPERS ---

    public log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', area: 'BACKEND' | 'FRONTEND' | 'TOR' | 'CRYPTO' | 'NETWORK', message: string, details?: any) {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            area,
            message,
            details
        };
        this.addLogEntry(entry);
    }

    private addLogEntry(entry: LogEntry, skipForward: boolean = false) {
        this._logs.push(entry);
        if (this._logs.length > 1000) this._logs.shift(); // Keep last 1000

        // Emit to UI legacy listener
        if (this.onLog) {
            this.onLog(`[${entry.level}] [${entry.area}] ${entry.message}`);
        }

        // Forward to Backend Terminal (Only if it didn't come FROM the backend)
        if (!skipForward && this.socket && this.socket.connected) {
            this.socket.emit('client-log', entry);
        }
    }

    private notifyStatus(isOnline: boolean, nodeId?: string) {
        this._statusListeners.forEach(l => l(isOnline, nodeId));
    }

    public getLogs(): LogEntry[] {
        return this._logs;
    }

    public subscribeToStatus(listener: StatusListener): () => void {
        this._statusListeners.add(listener);
        // Immediately notify current status
        const isReady = this.socket.connected && !!this._myOnionAddress;
        listener(isReady, this._myOnionAddress || undefined);

        return () => {
            this._statusListeners.delete(listener);
        };
    }

    public setDebugMode(enabled: boolean) {
        this.isDebugEnabled = enabled;
        kvService.set('gchat_debug_enabled', enabled); // Async but fire-and-forget
    }

    public downloadLogs() {
        const blob = new Blob([JSON.stringify(this._logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gchat-debug-logs-${Date.now()}.json`;
        a.click();
    }

    public updateKnownPeers(peers: string[]) {
        peers.forEach(p => this._knownPeers.add(p));
    }

    public syncTrustedPeers(peers: string[]) {
        // Merge contacts with existing trusted peers (to keep manual connections)
        peers.forEach(p => this._trustedPeers.add(p));
        this.log('INFO', 'NETWORK', `Synced ${peers.length} Trusted Peers. Total: ${this._trustedPeers.size}`);
    }

    public syncContacts(contacts: import('../types').Contact[]) {
        contacts.forEach(c => {
            if (c.homeNodes && c.homeNodes.length > 0) {
                // Add home node to Trusted Peers (Firewall Allow)
                this._trustedPeers.add(c.homeNodes[0]);
                // Map OwnerID to HomeNode for Proxy Lookup
                this._contactDirectory.set(c.id, c.homeNodes[0]);
            }
        });
        this.log('INFO', 'NETWORK', `Synced ${contacts.length} Contacts to Directory.`);
    }

    public removeTrustedPeer(onion: string) {
        if (this._trustedPeers.has(onion)) {
            this._trustedPeers.delete(onion);
            this._knownPeers.delete(onion);
            this.log('INFO', 'NETWORK', `Removed Trusted Peer: ${onion}`);

            // Should we disconnect? ideally yes, but socket.io is connectionless for us (over http/tor)
            // The firewall will block future packets.
        }
    }

    private setupSocketListeners() {
        this.socket.on('connect', () => {
            this.log('INFO', 'FRONTEND', 'Connected to Local Backend Socket');
            if (!this._myOnionAddress) {
                this.socket.emit('get-onion-address', (addr: string) => {
                    if (addr) {
                        this._myOnionAddress = addr;
                        this.notifyStatus(true, addr);
                    }
                });
            }
        });

        this.socket.on('onion-address', (address: string) => {
            this._myOnionAddress = address;
            this.notifyStatus(true, address);
            this.log('INFO', 'FRONTEND', `Onion Address Assigned: ${address}`);
        });

        this.socket.on('tor-packet', (packet: any) => {
            const sender = packet.senderId || packet.sender;
            if (packet && sender) {
                // --- STRICT FIREWALL ---
                // We ONLY accept packets from Trusted Peers (Contacts/Manual Connections).
                // The ONLY exception is a 'CONNECTION_REQUEST' (Friend Request/Handshake).
                const isTrusted = this._trustedPeers.has(sender);
                const isConnectionRequest = packet.type === 'CONNECTION_REQUEST';
                // PROXY FIX: Allow MEDIA_REQUEST from untrusted if they have the ID (we will verify Access Key in handler)
                const isMediaRequest = packet.type === 'MEDIA_REQUEST';
                // PROXY FIX: Allow MEDIA_CHUNK from untrusted (we verify it belongs to active DL in handler)
                const isMediaChunk = packet.type === 'MEDIA_CHUNK';

                if (!isTrusted && !isConnectionRequest && !isMediaRequest && !isMediaChunk) {
                    this.log('WARN', 'NETWORK', `Blocked packet ${packet.type} from untrusted source ${sender}. Firewall active.`);
                    return; // DROP PACKET
                }
                // -----------------------

                if (sender.endsWith('.onion')) this._knownPeers.add(sender);

                if (packet.type === 'MEDIA_REQUEST') this.handleMediaRequest(sender, packet.payload);
                else if (packet.type === 'MEDIA_CHUNK') this.handleMediaChunk(sender, packet.payload);
                else if (packet.type === 'MEDIA_RELAY_REQUEST') this.handleRelayRequest(sender, packet.payload);
                else if (packet.type === 'MEDIA_RECOVERY_FOUND') this.handleRecoveryFound(sender, packet.payload);
                else {
                    if (packet.type !== 'MEDIA_CHUNK') this.log('DEBUG', 'FRONTEND', `Received Packet [${packet.type}] from ${sender}`);
                    if (this.onMessage) this.onMessage(packet, sender);
                }
            }
        });

        this.socket.on('tor-status', (status: string) => {
            if (status === 'connected' && this._myOnionAddress) this.notifyStatus(true, this._myOnionAddress);
            else if (status === 'disconnected') this.notifyStatus(false);
        });

        this.socket.on('tor-stats', (stats: TorStats) => this.onStats(stats));
        this.socket.on('tor-log', (msg: string) => this.onLog(msg));
        this.socket.on('debug-log', (entry: LogEntry) => this.addLogEntry(entry, true));

        this.socket.on('connect_error', (err) => {
            this.notifyStatus(false);
            this.log('ERROR', 'FRONTEND', `Socket Connection Error: ${err.message}`);
        });

        this.socket.on('system-shutdown-scheduled', async () => {
            this.log('WARN', 'FRONTEND', 'System Shutdown Requested. Broadcasting exit signal to peers...');
            this._isShuttingDown = true;

            const packet = {
                id: crypto.randomUUID(),
                type: 'USER_EXIT',
                senderId: this._myOnionAddress || 'unknown',
                payload: { userId: 'system-shutdown' }
            };

            const trustedPeers = Array.from(this._trustedPeers);
            const pendingAcks = new Set(trustedPeers);

            // Listener for ACKs
            const ackListener = (ackPacket: any) => {
                if (ackPacket.type === 'USER_EXIT_ACK') {
                    const sender = ackPacket.senderId || ackPacket.sender;
                    if (sender && pendingAcks.has(sender)) {
                        this.log('INFO', 'NETWORK', `Received shutdown ACK from ${sender}`);
                        pendingAcks.delete(sender);
                    }
                }
            };
            this.socket.on('tor-packet', ackListener);

            // Broadcast Exit Packet
            await this.broadcast(packet, trustedPeers);

            this.log('INFO', 'FRONTEND', `Waiting for ACKs from ${pendingAcks.size} peers (max 30s)...`);

            // Wait for ACKs or Timeout
            const startTime = Date.now();
            while (pendingAcks.size > 0 && (Date.now() - startTime) < 30000) {
                await new Promise(r => setTimeout(r, 500));
            }

            this.socket.off('tor-packet', ackListener);

            if (pendingAcks.size > 0) {
                this.log('WARN', 'FRONTEND', `Shutdown Timeout. Missing ACKs from: ${Array.from(pendingAcks).join(', ')}`);
            } else {
                this.log('INFO', 'FRONTEND', 'All peers acknowledged shutdown.');
            }

            this.socket.emit('system-shutdown-confirm');
        });

        this.socket.on('system-shutdown-request', () => {
            this.log('WARN', 'NETWORK', 'Backend requested graceful shutdown...');
            if (this.onShutdownRequest) this.onShutdownRequest();
        });
    }

    // --- DOWNLOAD MANAGER LOOP ---
    private maintainDownloads() {
        const now = Date.now();
        let hasActive = false;

        this._activeDownloads.forEach((dl) => {
            if (dl.status === 'error' || dl.status === 'completed' || dl.status === 'paused') return;

            if (dl.status === 'recovering') {
                const now = Date.now();
                if (!dl.recoveryStartedAt) dl.recoveryStartedAt = now;

                // Timeout: 10 minutes (600000ms) to allow for Proxy Downloads
                if ((now - dl.recoveryStartedAt) > 600000) {
                    this.log('ERROR', 'NETWORK', `Mesh Recovery Timed Out for ${dl.id}`);
                    dl.status = 'error';
                    dl.listeners.forEach(l => l.onError("Source offline. Mesh Recovery Failed."));
                    return;
                }

                // Retry Interval: 45s - Tor is slow, and we don't want to spam retries/AVALANCHE
                // 10s was too aggressive causing "ERR_CANCELED" loops when requests timed out at 30s.
                if (!dl.lastRecoveryAttempt || (now - dl.lastRecoveryAttempt) > 45000) {
                    dl.lastRecoveryAttempt = now;
                    this.log('INFO', 'NETWORK', `Broadcasting Mesh Relay Retry for ${dl.id}...`);
                    this.attemptMeshRecovery(dl.id, dl.metadata.originNode);
                }
                return;
            }

            hasActive = true;

            // Adaptive Timeout: Base 60s + (RTT * 4)
            // Increased base timeout significantly to allow for Tor Circuit creation
            const dynamicTimeout = Math.max(60000, dl.avgRtt * 4);

            dl.inflight.forEach((req, key) => {
                if (now - req.sentAt > dynamicTimeout) {
                    if (req.retries >= 10) {
                        this.log('WARN', 'NETWORK', `Chunk ${req.index} failed 10 times. Triggering Mesh Recovery.`);
                        this.attemptMeshRecovery(dl.id, dl.peerOnion); // Pass current peer as Origin Hint
                        dl.status = 'recovering';
                        dl.listeners.forEach(l => l.onError("Source offline. Searching mesh..."));
                        return;
                    }

                    this.log('WARN', 'NETWORK', `Chunk ${req.index} timeout (${Math.round((now - req.sentAt) / 1000)}s). Retrying...`);

                    // CONGESTION CONTROL: Multiplicative Decrease
                    dl.concurrency = 1;

                    // Move failed chunk back to front of queue
                    dl.inflight.delete(key);
                    dl.queue.unshift(req.index);
                    req.retries++;
                }
            });

            if (dl.status === 'active') this.pumpDownloadQueue(dl);
        });

        // Keep screen awake while downloading
        if (hasActive) requestWakeLock();
        else releaseWakeLock();
    }

    private pumpDownloadQueue(dl: ActiveDownload) {
        // Use floored concurrency
        const effectiveConcurrency = Math.floor(dl.concurrency);

        while (dl.inflight.size < effectiveConcurrency && dl.queue.length > 0) {
            const index = dl.queue.shift()!;
            dl.inflight.set(index, {
                index,
                sentAt: Date.now(),
                retries: 0
            });

            // Send with explicit stream ID to reuse the Agent in backend
            this.sendMessage(dl.peerOnion, {
                type: 'MEDIA_REQUEST',
                senderId: this._myOnionAddress || 'unknown',
                payload: {
                    mediaId: dl.id,
                    chunkIndex: index,
                    chunkSize: dl.chunkSize,
                    accessKey: dl.metadata.accessKey // PROXY FIX: Identity
                }
            }, `media_stream_${dl.id}`);
        }
    }

    // --- MEDIA METHODS ---

    private async handleMediaRequest(senderId: string, payload: { mediaId: string; chunkIndex: number; chunkSize: number; accessKey?: string }) {
        if (this._isShuttingDown) return;

        const { mediaId, chunkIndex, chunkSize, accessKey } = payload;

        // PROXY-SECURITY-FIX: Verify Access Key since we bypass firewall for this packet type
        const canAccess = await verifyMediaAccess(mediaId, accessKey);
        if (!canAccess) {
            this.log('WARN', 'NETWORK', `Rejected MEDIA_REQUEST from ${senderId} - Invalid Access Key. Access Denied.`);
            return;
        }

        // Default to 256KB if not provided, but respect the requester's chunk size
        const size = chunkSize || (256 * 1024);

        // --- RELAY MEMORY SERVE LOGIC ---
        // Check if we have this chunk in active download memory (High Speed Relay)
        const dl = this._activeDownloads.get(mediaId);
        if (dl && dl.status === 'active' && dl.chunks[chunkIndex]) {
            const memChunk = dl.chunks[chunkIndex] as ArrayBuffer;
            const base64Data = arrayBufferToBase64(memChunk);
            this.log('DEBUG', 'NETWORK', `Relay: Serving Chunk ${chunkIndex} for ${mediaId} from RAM to ${senderId}`);

            this.sendMessage(senderId, {
                type: 'MEDIA_CHUNK',
                senderId: this._myOnionAddress || 'system',
                payload: { mediaId, chunkIndex, totalChunks: dl.totalChunks, data: base64Data }
            }, `media_stream_${mediaId}`);
            return;
        }
        // --------------------------------

        const blob = await getMedia(mediaId);
        if (!blob) return;

        const totalChunks = Math.ceil(blob.size / size);
        if (chunkIndex >= totalChunks) return;

        const start = chunkIndex * size;
        const end = Math.min(start + size, blob.size);
        const chunkBlob = blob.slice(start, end);

        const buffer = await chunkBlob.arrayBuffer();
        // CRITICAL: Convert to Base64 to ensure it survives JSON.stringify in the backend
        const base64Data = arrayBufferToBase64(buffer);

        this.sendMessage(senderId, {
            type: 'MEDIA_CHUNK',
            senderId: this._myOnionAddress || 'system',
            payload: { mediaId, chunkIndex, totalChunks, data: base64Data }
        }, `media_stream_${mediaId}`);
    }

    private handleMediaChunk(senderId: string, payload: { mediaId: string; chunkIndex: number; totalChunks: number; data: any }) {
        if (this._isShuttingDown) return;

        const { mediaId, chunkIndex, totalChunks, data } = payload;
        const download = this._activeDownloads.get(mediaId);
        if (!download) return;

        const requestInfo = download.inflight.get(chunkIndex);
        download.inflight.delete(chunkIndex);

        if (requestInfo) {
            const rtt = Date.now() - requestInfo.sentAt;
            download.rttSamples.push(rtt);
            if (download.rttSamples.length > 5) download.rttSamples.shift();
            download.avgRtt = download.rttSamples.reduce((a, b) => a + b, 0) / download.rttSamples.length;

            // CONGESTION CONTROL: Additive Increase
            // If RTT is healthy (< 2s) and we aren't already maxed out (6), increase concurrency.
            if (rtt < 2000 && download.concurrency < 6) {
                download.concurrency += 0.1;
            }
        }

        // Convert incoming data
        let chunkData: ArrayBuffer;
        if (typeof data === 'string') {
            // It's likely the Base64 string we sent
            chunkData = base64ToArrayBuffer(data);
        } else if (data instanceof ArrayBuffer) {
            chunkData = data;
        } else {
            // Fallback if Socket.IO did something magic, or it's a raw array
            chunkData = new Uint8Array(data).buffer;
        }

        // CRITICAL: Validate Chunk Data Size
        if (chunkData.byteLength === 0) {
            this.log('WARN', 'NETWORK', `Received empty chunk ${chunkIndex} for ${mediaId}. Ignoring.`);
            // Put back in queue to retry
            download.queue.unshift(chunkIndex);
            return;
        }

        if (download.chunks[chunkIndex] === null) {
            download.chunks[chunkIndex] = chunkData;
            download.receivedCount++;
        }

        const progress = Math.round((download.receivedCount / download.totalChunks) * 100);
        download.listeners.forEach(l => l.onProgress(progress));

        if (download.receivedCount >= download.totalChunks) {
            this.finishDownload(mediaId);
        } else {
            this.pumpDownloadQueue(download);
        }

        // --- RELAY FORWARDING ---
        // If we list this peer as a listener for this media, forward the chunk?
        // NO. In the caching model, we pull the chunk for ourselves (dl.chunks),
        // and handleMediaRequest (above) serves it from dl.chunks when the peer asks for it.
        // So we do NOT need to push chunks here anymore. The "PULL" model is restored.
        // We only clear the state if the download completes.
    }

    // --- RECOVERY LOGIC ---
    // Modified to include ownerId for smart routing
    private async attemptMeshRecovery(mediaId: string, originNode?: string, ownerId?: string) {
        const dl = this._activeDownloads.get(mediaId);
        if (!dl) return;

        const packet = {
            id: crypto.randomUUID(),
            type: 'MEDIA_RELAY_REQUEST', // changed from RECOVERY to RELAY/RECOVERY hybrid
            senderId: this._myOnionAddress || 'unknown',
            payload: {
                mediaId,
                originNode, // Hint: "If you don't have it, try fetching from here"
                ownerId, // NEW: Identify owner by ID (Public Key)
                accessKey: dl.metadata.accessKey,
                metadata: dl.metadata // Include metadata for the proxy to use
            }
        };

        // Broadcast ONLY to Trusted Peers
        const recipients = Array.from(this._trustedPeers).filter(p => p !== dl.peerOnion);
        this.log('INFO', 'NETWORK', `Broadcasting RELAY Request for ${mediaId} to ${recipients.length} TRUSTED peers`);
        // Use 0 retries to prevent retry avalanche. The download loop handles reattempts.
        this.broadcast(packet, recipients, 0);
    }

    private async handleRelayRequest(senderId: string, payload: { mediaId: string; originNode?: string; ownerId?: string; accessKey?: string; metadata?: MediaMetadata }) {
        const { mediaId, originNode, ownerId, accessKey, metadata } = payload;

        // 1. Do we have it locally?
        let hasIt = await hasMedia(mediaId);

        // 2. Proxy Logic: Smart Routing
        // We check if we have an explicit Origin Node OR if we know the Owner's Home Node from our Contacts.
        let targetNode = originNode;

        if (!targetNode && ownerId) {
            targetNode = this._contactDirectory.get(ownerId);
            if (targetNode) {
                this.log('INFO', 'NETWORK', `Relay: Resolved Owner ${ownerId.substring(0, 8)}... to Node ${targetNode}`);
            }
        }

        if (!hasIt && targetNode && metadata) {
            this.log('INFO', 'NETWORK', `Proxy: Fetching ${mediaId} from ${targetNode} for ${senderId}`);

            // We launch a download. We can use our own downloadMedia.
            // We set allowUntrusted = true (if needed) but Origin should be trusted?
            // Actually, if we are B, and A is origin. We have A in our contacts? 
            // If yes, strict works. If no, we might need allowUntrusted if we are just a random bridge?
            // For V1, we assume B knows A.

            try {
                // WARMUP: Verify connection to Origin first.
                // This ensures A is online and creates a Tor circuit before triggering the download logic.
                const ping = await this.connect(targetNode);
                if (!ping.success) {
                    this.log('WARN', 'NETWORK', `Proxy: Target ${targetNode} unreachable. Attempting Mesh Relay instead.`);
                    // Fall through to Relay Logic
                } else {
                    // Trigger download in background
                    this.downloadMedia(targetNode, metadata, (p) => {
                        // Monitor progress? 
                    }, true).then(async () => {
                        // ON SUCCESS: Notify requester we have it now!
                        this.log('INFO', 'NETWORK', `Proxy: Download complete. Notifying ${senderId}`);

                        // We verify access just in case (though we just downloaded it)
                        if (await hasMedia(mediaId)) {
                            this.sendMessage(senderId, {
                                id: crypto.randomUUID(),
                                type: 'MEDIA_RECOVERY_FOUND',
                                senderId: this._myOnionAddress || 'unknown',
                                payload: { mediaId }
                            });
                        }
                    }).catch(e => {
                        this.log('WARN', 'NETWORK', `Proxy Download Failed: ${e}`);
                    });

                    // We return immediately if we successfully started the proxy download.
                    return;
                }
            } catch (e) {
                this.log('WARN', 'NETWORK', `Proxy Logic Error: ${e}`);
            }
        }

        // Re-check (Standard Check)
        hasIt = await hasMedia(mediaId);

        if (hasIt) {
            // Are we allowed to share it?
            const canAccess = await verifyMediaAccess(mediaId, accessKey);
            if (!canAccess) return;

            this.log('INFO', 'NETWORK', `Found requested media ${mediaId}. Offering to ${senderId} (Relay/Cache)`);
            this.sendMessage(senderId, {
                id: crypto.randomUUID(),
                type: 'MEDIA_RECOVERY_FOUND',
                senderId: this._myOnionAddress || 'unknown',
                payload: { mediaId }
            });
            return;
        }

        // 3. DAISY CHAIN RELAY LOGIC (New)

        const historyKey = `${mediaId}_${senderId}`;
        const now = Date.now();
        const lastSeen = this._relayHistory.get(historyKey) || 0;

        if (now - lastSeen < 10000) return;
        this._relayHistory.set(historyKey, now);

        let isNewRelay = false;
        if (!this._relayState.has(mediaId)) {
            if (!metadata) return; // Cannot start a relay without metadata
            this._relayState.set(mediaId, { listeners: new Set(), metadata });
            isNewRelay = true;
        }

        const state = this._relayState.get(mediaId)!;
        if (state.listeners.has(senderId)) return;

        state.listeners.add(senderId);
        this.log('INFO', 'NETWORK', `Relay: Added ${senderId} to waiting list for ${mediaId}`);

        if (!isNewRelay) return;

        // Forward to ALL trusted peers (Found Flood)
        const peersToForward = Array.from(this._trustedPeers).filter(p => p !== senderId);

        if (peersToForward.length > 0) {
            this.log('INFO', 'NETWORK', `Relay: Forwarding request for ${mediaId} to ${peersToForward.length} peers`);
            const forwardPacket = {
                id: crypto.randomUUID(),
                type: 'MEDIA_RELAY_REQUEST',
                senderId: this._myOnionAddress || 'unknown',
                payload: { mediaId, originNode, ownerId, accessKey, metadata }
            };
            this.broadcast(forwardPacket, peersToForward, 0);
        }
    }

    private handleRecoveryFound(senderId: string, payload: { mediaId: string }) {
        const { mediaId } = payload;

        // 1. My Download?
        const dl = this._activeDownloads.get(mediaId); // Note: might be null if we haven't started yet

        if (dl && (dl.status === 'recovering' || dl.status === 'paused')) {
            this.log('INFO', 'NETWORK', `Recovery Successful! Switching download source to ${senderId}`);
            dl.peerOnion = senderId;
            dl.status = 'active';
            dl.concurrency = 1;
            dl.avgRtt = 5000;
            dl.rttSamples = [];
            this.pumpDownloadQueue(dl);
        }

        // 2. Relay / Proxy?
        if (this._relayState.has(mediaId)) {
            const state = this._relayState.get(mediaId)!;

            // We found a source (senderId)!
            // We must now act as the Proxy.
            // A. Start downloading from senderId (if we aren't already)
            // B. Notify all listeners that WE have it.

            this.log('INFO', 'NETWORK', `Relay: Found source ${senderId} for ${mediaId}. Starting Proxy buffer...`);

            this.downloadMedia(senderId, state.metadata, (p) => {
                // Monitor
            }, true).catch(err => {
                this.log('WARN', 'NETWORK', `Relay Buffer Failed: ${err}`);
            });

            // Notify Listeners
            if (state.listeners.size > 0) {
                this.log('INFO', 'NETWORK', `Relay: Notifying ${state.listeners.size} peers that media is ready.`);
                state.listeners.forEach(peer => {
                    this.sendMessage(peer, {
                        id: crypto.randomUUID(),
                        type: 'MEDIA_RECOVERY_FOUND',
                        senderId: this._myOnionAddress || 'unknown',
                        payload: { mediaId }
                    });
                });
            }
        }
    }

    private async finishDownload(mediaId: string) {
        const download = this._activeDownloads.get(mediaId);
        if (!download || download.chunks.includes(null)) return;

        try {
            const blob = new Blob(download.chunks as BlobPart[], { type: download.metadata.mimeType });
            if (blob.size === 0) throw new Error("Empty Blob Data");
            // Mark peer downloads as 'cache' (Temp Storage)
            await saveMedia(mediaId, blob, download.metadata.accessKey, true);
            download.status = 'completed';
            download.listeners.forEach(l => l.onComplete(blob));
        } catch (e: any) {
            this.log('ERROR', 'NETWORK', `Blob assembly failed: ${e.message}`);
            download.listeners.forEach(l => l.onError(`Assembly Failed: ${e.message}`));
        } finally {
            this._activeDownloads.delete(mediaId);
            this._relayState.delete(mediaId); // Clear relay state on completion
            releaseWakeLock();
        }
    }

    public getDownloadProgress(mediaId: string): number | null {
        const dl = this._activeDownloads.get(mediaId);
        if (!dl) return null;
        if (dl.status === 'recovering') return -1;
        return Math.round((dl.receivedCount / dl.totalChunks) * 100);
    }

    public async downloadMedia(peerOnionAddress: string | undefined | null, metadata: MediaMetadata, onProgress: (p: number) => void, allowUntrusted: boolean = false): Promise<Blob> {
        if (this._isShuttingDown) throw new Error("Shutdown in progress");

        if (await hasMedia(metadata.id)) {
            onProgress(100);
            return (await getMedia(metadata.id))!;
        }

        if (this._activeDownloads.has(metadata.id)) {
            const existing = this._activeDownloads.get(metadata.id)!;
            existing.listeners.push({ onProgress, onComplete: () => { }, onError: () => { } });
            return new Promise((resolve, reject) => {
                existing.listeners[existing.listeners.length - 1].onComplete = resolve;
                existing.listeners[existing.listeners.length - 1].onError = reject;
            });
        }

        // Determine initial configuration
        const config = getTransferConfig(metadata.size);
        const totalChunks = Math.ceil(metadata.size / config.chunkSize);

        // STRICT MODE Check
        let initialStatus: 'active' | 'recovering' = 'recovering';
        let usePeer = peerOnionAddress;

        if (peerOnionAddress && this._trustedPeers.has(peerOnionAddress)) {
            initialStatus = 'active';
        } else if (peerOnionAddress) {
            if (allowUntrusted) {
                // PROXY MODE: Check allowUntrusted
                // We are acting as a proxy (or explicitly forcing a download).
                // We allow connection to stranger.
                this.log('WARN', 'NETWORK', `Proxy: Allowing connection to untrusted source ${peerOnionAddress} for download.`);
                initialStatus = 'active';
            } else {
                // It's a stranger. We REFUSE direct connection.
                // We set status to recovering to force a Relay Request to Trusted Peers.
                this.log('INFO', 'NETWORK', `Strict Mode: Refusing direct download from untrusted ${peerOnionAddress}. Attempting Mesh Relay.`);
                initialStatus = 'recovering';
            }
        }

        return new Promise((resolve, reject) => {
            const queue = Array.from({ length: totalChunks }, (_, i) => i);
            const safePeerAddr = (initialStatus === 'active') ? (usePeer || 'unknown') : 'searching...';

            this._activeDownloads.set(metadata.id, {
                id: metadata.id,
                peerOnion: safePeerAddr,
                chunks: new Array(totalChunks).fill(null),
                receivedCount: 0,
                totalChunks,
                metadata,
                status: initialStatus,
                queue,
                inflight: new Map(),
                concurrency: 1,
                chunkSize: config.chunkSize,
                rttSamples: [],
                avgRtt: 5000,
                listeners: [{ onProgress, onComplete: resolve, onError: reject }]
            });

            const dl = this._activeDownloads.get(metadata.id)!;

            if (initialStatus === 'active') {
                this.pumpDownloadQueue(dl);
            } else {
                // If we don't know the peer OR don't trust them, search trusted mesh
                // Pass 'usePeer' as originNode hint
                // Pass 'usePeer' as originNode hint if available
                dl.recoveryStartedAt = Date.now();
                dl.lastRecoveryAttempt = Date.now();
                this.attemptMeshRecovery(metadata.id, usePeer || dl.metadata.originNode);
                onProgress(-1);
            }
            requestWakeLock();
        });
    }

    // --- STANDARD METHODS (INIT, CONNECT, SEND) ---

    public init(nodeId: string) {
        if (this.socket.disconnected) this.socket.connect();
        this.socket.emit('get-onion-address', (addr: string) => {
            if (addr) {
                this._myOnionAddress = addr;
                this.notifyStatus(true, addr);
            }
        });
    }

    public restartTor() {
        this.socket.emit('restart-tor');
        this.notifyStatus(false);
    }

    public async connect(onionAddress: string): Promise<PingResult> {
        if (this._isShuttingDown) return { success: false, error: 'System Shutdown' };
        const start = Date.now();
        this._knownPeers.add(onionAddress);
        this._trustedPeers.add(onionAddress); // Mark as trusted since we initiated connection
        return new Promise((resolve) => {
            if (!this.socket.connected) { resolve({ success: false, error: 'Backend Disconnected' }); return; }
            this.socket.emit('ping-peer', { targetOnion: onionAddress }, (result: PingResult) => {
                const latency = Date.now() - start;
                if (result && result.success) {
                    this.onPeerStatus(onionAddress, 'online', latency);
                    resolve({ success: true, latency });
                } else {
                    this.onPeerStatus(onionAddress, 'offline');
                    resolve(result);
                }
            });
        });
    }

    public async sendMessage(targetOnionAddress: string, packet: any, streamId?: string, retries?: number): Promise<boolean> {
        if (targetOnionAddress.endsWith('.onion')) this._knownPeers.add(targetOnionAddress);
        if (this._isShuttingDown && packet.type !== 'NODE_SHUTDOWN' && packet.type !== 'USER_EXIT') return false;

        // --- ENFORCE LINK IDENTITY ---
        // Always stamp the packet with OUR address as the Sender.
        // This ensures the recipient knows it came from a Trusted Peer (Us),
        // effectively wrapping the content for the Strict Firewall.
        if (this._myOnionAddress) {
            packet.senderId = this._myOnionAddress;
        }
        // -----------------------------



        return new Promise((resolve) => {
            if (!this.socket.connected) { resolve(false); return; }
            this.socket.emit('send-packet', { targetOnion: targetOnionAddress, payload: packet, streamId, retries }, (response: any) => {
                resolve(response ? response.success : false);
            });
        });
    }

    public async broadcast(packet: any, recipients: string[], retries?: number) {
        if (this._isShuttingDown && packet.type !== 'USER_EXIT') return;
        const promises = recipients.map(async (onionAddress) => {
            if (onionAddress === this._myOnionAddress) return;
            await this.sendMessage(onionAddress, packet, undefined, retries);
        });
        await Promise.all(promises);
    }

    // --- EXIT & SHUTDOWN ---

    public async announceExit(peers: string[], contacts: { homeNodes: string[], id: string }[], homeNode: string, userId: string) {
        this._isShuttingDown = true;
        this.socket.emit('system-shutdown-prep');

        const packet = {
            id: crypto.randomUUID(),
            type: 'USER_EXIT',
            senderId: homeNode,
            payload: { userId }
        };

        // Best effort broadcast
        const peerPromises = peers.map(p => this.sendMessage(p, packet));

        // Best effort contact notification
        const contactPromises = contacts.map(c => {
            if (c.homeNodes && c.homeNodes.length > 0) {
                return this.sendMessage(c.homeNodes[0], packet);
            }
            return Promise.resolve(false);
        });

        await Promise.all([...peerPromises, ...contactPromises]);
    }

    public confirmShutdown() {
        this._isShuttingDown = true;
        this.socket.emit('system-shutdown-confirm');
    }

    // --- UTILS ---
    public getTorKeys(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.socket.emit('get-tor-keys', (response: any) => {
                if (response && response.success) resolve(response.keys);
                else reject(response?.error || "Failed");
            });
        });
    }

    public restoreTorKeys(keys: any): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.emit('restore-tor-keys', keys, (ack: any) => {
                if (ack && ack.success) resolve();
                else reject(ack?.error || "Failed");
            });
        });
    }

    public getBridges(): Promise<string> {
        return new Promise((resolve) => {
            this.socket.emit('get-bridges', (content: string) => resolve(content));
        });
    }

    public saveBridges(content: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.emit('save-bridges', content, (ack: any) => {
                if (ack && ack.success) resolve();
                else reject(ack?.error || "Failed to save bridges");
            });
        });
    }

    public factoryReset(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.emit('factory-reset', (ack: any) => {
                if (ack && ack.success) resolve();
                else reject(ack?.error || "Reset Failed");
            });
        });
    }

    public disconnect() {
        this.notifyStatus(false);
        this.socket.disconnect();
    }
}

export const networkService = new NetworkService();
