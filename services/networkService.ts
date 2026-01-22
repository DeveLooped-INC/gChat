
// Universal Network Service using Socket.IO
import { io, Socket } from 'socket.io-client';
import { LogEntry, MediaMetadata, TorStats as ITorStats } from '../types';
import { getMedia, saveMedia, hasMedia, verifyMediaAccess } from './mediaStorage';

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
    size: number; // Track size requested to adjust metrics
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
    currentChunkSize: number; // Dynamic
    minChunkSize: number;
    maxChunkSize: number;
    
    // Stats
    rttSamples: number[];
    avgRtt: number;
    
    listeners: DownloadListener[];
}

type StatusListener = (isOnline: boolean, nodeId?: string) => void;
type PeerStatusListener = (peer: string, status: 'online' | 'offline', latency?: number) => void;

// --- WAKE LOCK HELPER ---
let wakeLock: any = null;
const requestWakeLock = async () => {
    try {
        if ('wakeLock' in navigator) {
            // @ts-ignore
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn('Wake Lock failed:', err);
    }
};
const releaseWakeLock = () => {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
};

export class NetworkService {
  private socket: Socket;
  
  public onMessage: (data: any, senderId: string) => void = () => {};
  public onPeerStatus: PeerStatusListener = () => {};
  public onLog: (msg: string) => void = () => {};
  public onStats: (stats: TorStats) => void = () => {};
  public onShutdownRequest: () => void = () => {};
  
  private _statusListeners: Set<StatusListener> = new Set();
  private _logs: LogEntry[] = [];
  public isDebugEnabled: boolean = false;
  
  private _myOnionAddress: string | null = null;
  private _knownPeers: Set<string> = new Set(); 
  private _activeDownloads: Map<string, ActiveDownload> = new Map();
  private _isShuttingDown: boolean = false;

  constructor() {
    const savedDebug = localStorage.getItem('gchat_debug_enabled');
    this.isDebugEnabled = savedDebug === 'true';

    this.socket = io(BACKEND_URL, {
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 20000,
        autoConnect: true,
        transports: ['websocket', 'polling']
    });

    this.setupSocketListeners();

    // --- SLIDING WINDOW MONITOR ---
    setInterval(() => {
        if (this._isShuttingDown) return;
        this.maintainDownloads();
    }, 1000); 
  }

  // --- LOGGING & STATUS HELPERS ---

  private log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', area: 'BACKEND' | 'FRONTEND' | 'TOR' | 'CRYPTO' | 'NETWORK', message: string, details?: any) {
      const entry: LogEntry = {
          timestamp: Date.now(),
          level,
          area,
          message,
          details
      };
      this.addLogEntry(entry);
  }

  private addLogEntry(entry: LogEntry) {
      this._logs.push(entry);
      if (this._logs.length > 1000) this._logs.shift(); // Keep last 1000
      
      // Emit to UI legacy listener
      if (this.onLog) {
          this.onLog(`[${entry.level}] [${entry.area}] ${entry.message}`);
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
      localStorage.setItem('gchat_debug_enabled', String(enabled));
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

  private setupSocketListeners() {
    this.socket.on('connect', () => {
        this.log('INFO', 'FRONTEND', 'Connected to Local Backend Socket');
        if(!this._myOnionAddress) {
             this.socket.emit('get-onion-address', (addr: string) => {
                if(addr) {
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
        if(packet && sender) {
            if (sender.endsWith('.onion')) this._knownPeers.add(sender);
            
            if (packet.type === 'MEDIA_REQUEST') this.handleMediaRequest(sender, packet.payload);
            else if (packet.type === 'MEDIA_CHUNK') this.handleMediaChunk(sender, packet.payload);
            else if (packet.type === 'MEDIA_RECOVERY_REQUEST') this.handleRecoveryRequest(sender, packet.payload);
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
    this.socket.on('debug-log', (entry: LogEntry) => this.addLogEntry(entry));
    
    this.socket.on('connect_error', (err) => {
        this.notifyStatus(false);
        this.log('ERROR', 'FRONTEND', `Socket Connection Error: ${err.message}`);
    });

    this.socket.on('system-shutdown-request', () => {
        this.log('WARN', 'NETWORK', 'Backend requested graceful shutdown...');
        if(this.onShutdownRequest) this.onShutdownRequest();
    });
  }

  // --- DOWNLOAD MANAGER LOOP ---
  private maintainDownloads() {
      const now = Date.now();
      let hasActive = false;

      this._activeDownloads.forEach((dl) => {
          if (dl.status !== 'active') return;
          hasActive = true;

          // Adaptive Timeout: 2.5x RTT or min 20s
          const dynamicTimeout = Math.max(20000, dl.avgRtt * 2.5); 

          dl.inflight.forEach((req, key) => {
              if (now - req.sentAt > dynamicTimeout) {
                  if (req.retries >= 5) {
                      this.log('ERROR', 'NETWORK', `Chunk ${req.index} failed 5 times. Pausing.`);
                      dl.status = 'paused';
                      dl.listeners.forEach(l => l.onError("Connection unstable. Paused."));
                      return;
                  }

                  this.log('WARN', 'NETWORK', `Chunk ${req.index} timeout (${Math.round((now - req.sentAt)/1000)}s). Halving size.`);
                  
                  // CONGESTION CONTROL: Multiplicative Decrease
                  dl.currentChunkSize = Math.max(dl.minChunkSize, Math.floor(dl.currentChunkSize / 2));
                  
                  dl.inflight.delete(key);
                  dl.queue.unshift(req.index);
                  req.retries++;
              }
          });

          this.pumpDownloadQueue(dl);
      });

      if (hasActive) requestWakeLock();
      else releaseWakeLock();
  }

  private pumpDownloadQueue(dl: ActiveDownload) {
      let concurrency = 1;
      if (dl.avgRtt < 2000) concurrency = 4;
      else if (dl.avgRtt < 5000) concurrency = 2;
      
      while (dl.inflight.size < concurrency && dl.queue.length > 0) {
          const index = dl.queue.shift()!;
          dl.inflight.set(index, {
              index,
              sentAt: Date.now(),
              retries: 0,
              size: dl.currentChunkSize
          });

          // Send with explicit stream ID to reuse the Agent in backend
          this.sendMessage(dl.peerOnion, {
              type: 'MEDIA_REQUEST',
              senderId: this._myOnionAddress || 'unknown',
              payload: { mediaId: dl.id, chunkIndex: index, chunkSize: dl.currentChunkSize }
          }, `media_stream_${dl.id}`);
      }
  }

  // --- MEDIA METHODS ---

  private async handleMediaRequest(senderId: string, payload: { mediaId: string; chunkIndex: number; chunkSize: number }) {
      if (this._isShuttingDown) return; 

      const { mediaId, chunkIndex, chunkSize } = payload;
      // Use requested size or default to 256KB if missing
      const size = chunkSize || (256 * 1024);
      
      const blob = await getMedia(mediaId);
      if (!blob) return;

      const totalChunks = Math.ceil(blob.size / size);
      if (chunkIndex >= totalChunks) return;

      const start = chunkIndex * size;
      const end = Math.min(start + size, blob.size);
      const chunkBlob = blob.slice(start, end);
      
      const buffer = await chunkBlob.arrayBuffer();
      
      this.sendMessage(senderId, {
          type: 'MEDIA_CHUNK',
          senderId: this._myOnionAddress || 'system',
          payload: { mediaId, chunkIndex, totalChunks, data: buffer, usedChunkSize: size }
      }, `media_stream_${mediaId}`);
  }

  private handleMediaChunk(senderId: string, payload: { mediaId: string; chunkIndex: number; totalChunks: number; data: any; usedChunkSize?: number }) {
      if (this._isShuttingDown) return; 

      const { mediaId, chunkIndex, totalChunks, data, usedChunkSize } = payload;
      const download = this._activeDownloads.get(mediaId);
      if (!download) return; 

      const requestInfo = download.inflight.get(chunkIndex);
      download.inflight.delete(chunkIndex);

      if (requestInfo) {
          const rtt = Date.now() - requestInfo.sentAt;
          download.rttSamples.push(rtt);
          if (download.rttSamples.length > 5) download.rttSamples.shift();
          download.avgRtt = download.rttSamples.reduce((a, b) => a + b, 0) / download.rttSamples.length;
          
          if (this.isDebugEnabled) {
              this.log('DEBUG', 'NETWORK', `Chunk ${chunkIndex} received. RTT: ${rtt}ms. Avg: ${Math.round(download.avgRtt)}ms`);
          }
      }

      // Convert incoming data
      let chunkData: ArrayBuffer;
      if (data instanceof ArrayBuffer) chunkData = data;
      else if (typeof data === 'string') {
          const binary = atob(data);
          const len = binary.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
          chunkData = bytes.buffer;
      } else {
          chunkData = new Uint8Array(data).buffer;
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
  }

  // --- RECOVERY LOGIC (Placeholders for now) ---
  private async attemptMeshRecovery(mediaId: string) { /* ... existing ... */ }
  private async handleRecoveryRequest(senderId: string, payload: { mediaId: string; accessKey?: string }) { /* ... existing ... */ }
  private handleRecoveryFound(senderId: string, payload: { mediaId: string }) { /* ... existing ... */ }

  private async finishDownload(mediaId: string) {
      const download = this._activeDownloads.get(mediaId);
      if (!download || download.chunks.includes(null)) return;

      try {
          const blob = new Blob(download.chunks as BlobPart[], { type: download.metadata.mimeType });
          if (blob.size === 0) throw new Error("Empty Blob");
          await saveMedia(mediaId, blob, download.metadata.accessKey);
          download.status = 'completed';
          download.listeners.forEach(l => l.onComplete(blob));
      } catch(e: any) {
          this.log('ERROR', 'NETWORK', `Blob assembly failed: ${e.message}`);
          download.listeners.forEach(l => l.onError(`Assembly Failed: ${e.message}`));
      } finally {
          this._activeDownloads.delete(mediaId);
          releaseWakeLock();
      }
  }

  public getDownloadProgress(mediaId: string): number | null {
      const dl = this._activeDownloads.get(mediaId);
      if (!dl) return null;
      if (dl.status === 'recovering') return -1;
      return Math.round((dl.receivedCount / dl.totalChunks) * 100);
  }

  public async downloadMedia(peerOnionAddress: string, metadata: MediaMetadata, onProgress: (p: number) => void): Promise<Blob> {
      if (this._isShuttingDown) throw new Error("Shutdown in progress");

      if (await hasMedia(metadata.id)) {
          onProgress(100);
          return (await getMedia(metadata.id))!;
      }

      if (this._activeDownloads.has(metadata.id)) {
          const existing = this._activeDownloads.get(metadata.id)!;
          existing.listeners.push({ onProgress, onComplete: () => {}, onError: () => {} });
          return new Promise((resolve, reject) => {
              existing.listeners[existing.listeners.length-1].onComplete = resolve;
              existing.listeners[existing.listeners.length-1].onError = reject;
          });
      }

      // Initial Chunk Size: 256KB. Small enough for Tor, big enough for throughput.
      const initialChunkSize = 256 * 1024;
      const totalChunks = Math.ceil(metadata.size / initialChunkSize);
      
      return new Promise((resolve, reject) => {
          const queue = Array.from({length: totalChunks}, (_, i) => i);

          this._activeDownloads.set(metadata.id, {
              id: metadata.id,
              peerOnion: peerOnionAddress,
              chunks: new Array(totalChunks).fill(null),
              receivedCount: 0,
              totalChunks,
              metadata,
              status: 'active',
              queue,
              inflight: new Map(),
              currentChunkSize: initialChunkSize,
              minChunkSize: 64 * 1024,
              maxChunkSize: 512 * 1024,
              rttSamples: [],
              avgRtt: 2000, 
              listeners: [{ onProgress, onComplete: resolve, onError: reject }]
          });
          
          this.pumpDownloadQueue(this._activeDownloads.get(metadata.id)!);
          requestWakeLock();
      });
  }

  // --- STANDARD METHODS (INIT, CONNECT, SEND) ---
  
  public init(nodeId: string) {
    if (this.socket.disconnected) this.socket.connect();
    this.socket.emit('get-onion-address', (addr: string) => {
        if(addr) {
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

  public async sendMessage(targetOnionAddress: string, packet: any, streamId?: string): Promise<boolean> {
    if(targetOnionAddress.endsWith('.onion')) this._knownPeers.add(targetOnionAddress);
    if (this._isShuttingDown && packet.type !== 'NODE_SHUTDOWN' && packet.type !== 'USER_EXIT') return false;

    return new Promise((resolve) => {
        if (!this.socket.connected) { resolve(false); return; }
        this.socket.emit('send-packet', { targetOnion: targetOnionAddress, payload: packet, streamId }, (response: any) => {
             resolve(response ? response.success : false);
        });
    });
  }

  public async broadcast(packet: any, recipients: string[]) {
    if (this._isShuttingDown && packet.type !== 'NODE_SHUTDOWN') return;
    const promises = recipients.map(async (onionAddress) => {
        if (onionAddress === this._myOnionAddress) return;
        await this.sendMessage(onionAddress, packet);
    });
    await Promise.all(promises);
  }

  // --- EXIT & SHUTDOWN ---

  public async announceExit(peers: string[], contacts: {homeNodes: string[], id: string}[], homeNode: string, userId: string) {
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

  public disconnect() {
     this.notifyStatus(false);
     this.socket.disconnect();
  }
}

export const networkService = new NetworkService();
