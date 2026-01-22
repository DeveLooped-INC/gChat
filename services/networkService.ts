
// Universal Network Service using Socket.IO
import { io, Socket } from 'socket.io-client';
import { LogEntry, MediaMetadata } from '../types';
import { getMedia, saveMedia, hasMedia, verifyMediaAccess } from './mediaStorage';
import { getTransferConfig } from '../utils';

const BACKEND_URL = 'http://127.0.0.1:3001';

export interface PingResult {
    success: boolean;
    error?: string;
    latency?: number;
}

export interface TorStats {
    circuits: number;
    guards: number;
    status: string;
}

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
    // Chunks can now hold ArrayBuffer (binary) directly, not string
    chunks: (ArrayBuffer | null)[];
    receivedCount: number;
    totalChunks: number;
    metadata: MediaMetadata;
    status: 'active' | 'paused' | 'completed' | 'error' | 'recovering';
    
    // Sliding Window Logic
    queue: number[]; // Indices waiting to be requested
    inflight: Map<number, ChunkRequest>; // Indices currently on the wire
    
    // Adaptive Timeout Logic
    rttSamples: number[]; // Moving average of Round Trip Times
    avgRtt: number;
    
    listeners: DownloadListener[];
}

type StatusListener = (isOnline: boolean, nodeId?: string) => void;
type PeerStatusListener = (peer: string, status: 'online' | 'offline', latency?: number) => void;

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
        transports: ['websocket', 'polling'] // Prefer websocket to avoid polling session issues
    });

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
            if (sender.endsWith('.onion')) {
                this._knownPeers.add(sender);
            }
            
            if (packet.type === 'MEDIA_REQUEST') {
                this.handleMediaRequest(sender, packet.payload);
            } else if (packet.type === 'MEDIA_CHUNK') {
                this.handleMediaChunk(sender, packet.payload);
            } else if (packet.type === 'MEDIA_RECOVERY_REQUEST') {
                this.handleRecoveryRequest(sender, packet.payload);
            } else if (packet.type === 'MEDIA_RECOVERY_FOUND') {
                this.handleRecoveryFound(sender, packet.payload);
            } else {
                // Log non-media packets for debugging
                if (packet.type !== 'MEDIA_CHUNK') {
                    this.log('DEBUG', 'FRONTEND', `Received Packet [${packet.type}] from ${sender}`);
                }
                if (this.onMessage) {
                    this.onMessage(packet, sender);
                }
            }
        }
    });

    this.socket.on('tor-status', (status: string) => {
        if (status === 'connected' && this._myOnionAddress) {
            this.notifyStatus(true, this._myOnionAddress);
        } else if (status === 'disconnected') {
            this.notifyStatus(false);
        }
    });

    this.socket.on('tor-stats', (stats: TorStats) => {
        this.onStats(stats);
    });

    this.socket.on('tor-log', (msg: string) => {
        this.onLog(msg);
    });

    this.socket.on('debug-log', (entry: LogEntry) => {
        this.addLogEntry(entry);
    });
    
    this.socket.on('connect_error', (err) => {
        this.notifyStatus(false);
        this.log('ERROR', 'FRONTEND', `Socket Connection Error: ${err.message}`);
    });

    this.socket.on('system-shutdown-request', () => {
        this.log('WARN', 'NETWORK', 'Backend requested graceful shutdown...');
        if(this.onShutdownRequest) this.onShutdownRequest();
    });

    // --- SLIDING WINDOW MONITOR ---
    setInterval(() => {
        if (this._isShuttingDown) return;
        this.maintainDownloads();
    }, 1000); // Check every second
  }

  // --- DOWNLOAD MANAGER LOOP ---
  private maintainDownloads() {
      const now = Date.now();

      this._activeDownloads.forEach((dl) => {
          if (dl.status !== 'active') return;

          // 1. Check for Timeouts
          // Base timeout is 30s, but we adapt based on average RTT
          const dynamicTimeout = Math.max(30000, dl.avgRtt * 4); 

          dl.inflight.forEach((req, index) => {
              if (now - req.sentAt > dynamicTimeout) {
                  // TIMEOUT DETECTED
                  if (req.retries >= 5) {
                      // Critical failure for this chunk
                      this.log('ERROR', 'NETWORK', `Chunk ${index} failed 5 times. Pausing download.`);
                      dl.status = 'paused';
                      dl.listeners.forEach(l => l.onError("Connection unstable. Paused."));
                      return;
                  }

                  this.log('WARN', 'NETWORK', `Chunk ${index} timed out (${Math.round((now - req.sentAt)/1000)}s). Retrying...`);
                  
                  // Move back to queue to be re-processed
                  dl.inflight.delete(index);
                  dl.queue.unshift(index); // Priority retry
                  req.retries++;
              }
          });

          // 2. Pump the Queue (Keep pipeline full)
          this.pumpDownloadQueue(dl);
      });
  }

  private pumpDownloadQueue(dl: ActiveDownload) {
      const { concurrency } = getTransferConfig(dl.metadata.size);
      
      // While we have room in the pipeline AND items in the queue
      while (dl.inflight.size < concurrency && dl.queue.length > 0) {
          const index = dl.queue.shift()!;
          
          // Add to inflight tracking
          dl.inflight.set(index, {
              index,
              sentAt: Date.now(),
              retries: 0
          });

          // Send Request
          this.sendMessage(dl.peerOnion, {
              type: 'MEDIA_REQUEST',
              senderId: this._myOnionAddress || 'unknown',
              payload: { mediaId: dl.id, chunkIndex: index }
          });
      }
  }

  // --- FUNCTION 1: ANNOUNCE EXIT (The UI Triggered Action) ---
  public async announceExit(peers: string[], contacts: { homeNodes: string[], id: string }[], myOnion: string, myUserId: string): Promise<void> {
      // 1. Lock Network & Stop Media
      this._isShuttingDown = true;
      this.socket.emit('system-shutdown-prep'); // Tell backend to prepare (suppress noise)
      
      this.log('WARN', 'NETWORK', 'Function 1: Stopping media & broadcasting exit...');
      
      this._activeDownloads.clear();

      // 2. Prepare Packets
      const promises: Promise<any>[] = [];

      // Notify Contacts (User Level)
      const contactNodes = new Set<string>();
      contacts.forEach(c => { if(c.homeNodes[0]) contactNodes.add(c.homeNodes[0]); });
      
      contactNodes.forEach(nodeAddr => {
          const p = this.sendMessage(nodeAddr, {
              id: crypto.randomUUID(),
              type: 'USER_EXIT',
              senderId: myOnion,
              payload: { userId: myUserId }
          });
          promises.push(p);
      });

      // Notify Mesh Peers (Node Level)
      peers.forEach(nodeAddr => {
          if (nodeAddr !== myOnion) {
              const p = this.sendMessage(nodeAddr, {
                  id: crypto.randomUUID(),
                  hops: 6, // Enable daisy chaining
                  type: 'NODE_SHUTDOWN',
                  senderId: myOnion,
                  payload: { onionAddress: myOnion }
              });
              promises.push(p);
          }
      });

      this.log('INFO', 'NETWORK', `Waiting for ${promises.length} ACKs or 90s Timeout...`);

      // 3. Wait with Timeout (90s)
      const timeoutPromise = new Promise(resolve => setTimeout(() => {
          this.log('WARN', 'NETWORK', 'Shutdown announcement timed out. Proceeding anyway.');
          resolve('timeout');
      }, 90000));
      
      await Promise.race([
          Promise.allSettled(promises),
          timeoutPromise
      ]);

      this.log('WARN', 'NETWORK', 'Function 1 Complete. Ready for termination.');
  }

  // --- FUNCTION 2 TRIGGER ---
  public confirmShutdown() {
      // This triggers the backend to actually kill the process
      this.socket.emit('system-shutdown-confirm');
  }

  public subscribeToStatus(listener: StatusListener): () => void {
      this._statusListeners.add(listener);
      if (this.socket.connected && this._myOnionAddress) {
          listener(true, this._myOnionAddress);
      }
      return () => {
          this._statusListeners.delete(listener);
      };
  }

  private notifyStatus(isOnline: boolean, id?: string) {
      this._statusListeners.forEach(listener => listener(isOnline, id));
  }

  public setDebugMode(enabled: boolean) {
      this.isDebugEnabled = enabled;
      localStorage.setItem('gchat_debug_enabled', String(enabled));
      this.log('INFO', 'FRONTEND', `Debug Mode ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  public log(level: LogEntry['level'], area: LogEntry['area'], message: string, details?: any) {
      const entry: LogEntry = {
          timestamp: Date.now(),
          level,
          area,
          message,
          details
      };
      this.addLogEntry(entry);
      this.socket.emit('client-log', entry);
  }

  private addLogEntry(entry: LogEntry) {
      this._logs.push(entry);
      if (this._logs.length > 5000) this._logs.shift();
      if (this.isDebugEnabled) {
          const style = entry.level === 'ERROR' ? 'color: red' : entry.level === 'WARN' ? 'color: orange' : 'color: cyan';
          console.log(`%c[${entry.area}] ${entry.message}`, style, entry.details || '');
      }
  }

  public getLogs(): LogEntry[] {
      return this._logs;
  }

  public downloadLogs() {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this._logs, null, 2));
      const dlAnchor = document.createElement('a');
      dlAnchor.setAttribute("href", dataStr);
      dlAnchor.setAttribute("download", `gchat_debug_logs_${Date.now()}.json`);
      document.body.appendChild(dlAnchor);
      dlAnchor.click();
      dlAnchor.remove();
  }

  public updateKnownPeers(peers: string[]) {
      peers.forEach(p => {
          if (p && p.endsWith('.onion')) this._knownPeers.add(p);
      });
  }

  // --- PUBLIC METHODS FOR MIGRATION ---

  public getTorKeys(): Promise<any> {
      return new Promise((resolve, reject) => {
          if (!this.socket.connected) {
              reject("Backend disconnected");
              return;
          }
          this.socket.emit('get-tor-keys', (response: any) => {
              if (response && response.success) {
                  resolve(response.keys);
              } else {
                  reject(response?.error || "Failed to retrieve Tor keys.");
              }
          });
      });
  }

  public restoreTorKeys(keys: any): Promise<void> {
      return new Promise((resolve, reject) => {
          if (!this.socket.connected) {
              reject("Backend disconnected");
              return;
          }
          this.socket.emit('restore-tor-keys', keys, (ack: any) => {
              if (ack && ack.success) resolve();
              else reject(ack?.error || "Failed to restore Tor keys.");
          });
      });
  }

  // --- MEDIA METHODS (BINARY STREAMING OPTIMIZED) ---

  private async handleMediaRequest(senderId: string, payload: { mediaId: string; chunkIndex: number }) {
      if (this._isShuttingDown) return; 

      const { mediaId, chunkIndex } = payload;
      
      const blob = await getMedia(mediaId);
      if (!blob) {
          // Silent fail for now, peer will retry or timeout
          return;
      }

      // Use transfer config for this file size
      const { chunkSize } = getTransferConfig(blob.size);
      const totalChunks = Math.ceil(blob.size / chunkSize);
      
      if (chunkIndex >= totalChunks) return;

      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, blob.size);
      const chunkBlob = blob.slice(start, end);
      
      // Send as ArrayBuffer directly (Binary)
      const buffer = await chunkBlob.arrayBuffer();
      
      this.sendMessage(senderId, {
          type: 'MEDIA_CHUNK',
          senderId: this._myOnionAddress || 'system',
          payload: { mediaId, chunkIndex, totalChunks, data: buffer }
      });
  }

  private handleMediaChunk(senderId: string, payload: { mediaId: string; chunkIndex: number; totalChunks: number; data: any }) {
      if (this._isShuttingDown) return; 

      const { mediaId, chunkIndex, totalChunks, data } = payload;
      const download = this._activeDownloads.get(mediaId);
      if (!download) return; 

      // 1. Remove from inflight (Stop Timeout Timer)
      const requestInfo = download.inflight.get(chunkIndex);
      download.inflight.delete(chunkIndex);

      // 2. Adaptive RTT Calculation
      if (requestInfo) {
          const rtt = Date.now() - requestInfo.sentAt;
          download.rttSamples.push(rtt);
          if (download.rttSamples.length > 5) download.rttSamples.shift();
          download.avgRtt = download.rttSamples.reduce((a, b) => a + b, 0) / download.rttSamples.length;
      }

      // 3. Convert incoming data to ArrayBuffer
      let chunkData: ArrayBuffer;
      
      // Handle the case where socket.io might have fallen back to JSON/Base64 in rare edge cases (polling)
      // or if it arrived as a raw Buffer (Node.js/Socket.io behavior)
      if (data instanceof ArrayBuffer) {
          chunkData = data;
      } else if (typeof data === 'string') {
          // Fallback for legacy or encoded
          const binary = atob(data);
          const len = binary.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
          chunkData = bytes.buffer;
      } else {
          // Node Buffer to ArrayBuffer
          chunkData = new Uint8Array(data).buffer;
      }

      // 4. Update Download State
      // Sync total chunks if metadata was estimation
      if (totalChunks !== download.totalChunks) {
          download.totalChunks = totalChunks;
          if (download.chunks.length < totalChunks) {
              const diff = totalChunks - download.chunks.length;
              download.chunks = [...download.chunks, ...new Array(diff).fill(null)];
          }
      }

      if (download.chunks[chunkIndex] === null) {
          download.chunks[chunkIndex] = chunkData;
          download.receivedCount++;
      }

      // 5. Notify Progress
      const progress = Math.round((download.receivedCount / download.totalChunks) * 100);
      download.listeners.forEach(l => l.onProgress(progress));

      // 6. Check Completion
      if (download.receivedCount >= download.totalChunks) {
          this.finishDownload(mediaId);
      } else {
          // 7. Pump Queue to fetch next
          this.pumpDownloadQueue(download);
      }
  }

  private async attemptMeshRecovery(mediaId: string) {
      if (this._isShuttingDown) return;

      const download = this._activeDownloads.get(mediaId);
      if (!download) return;

      if (download.status !== 'recovering') {
          download.status = 'recovering';
          download.inflight.clear(); // Clear pending
          this.log('WARN', 'NETWORK', `Attempting mesh recovery for ${mediaId}...`);
      }
      
      const peersToAsk = Array.from(this._knownPeers).filter(p => p !== download.peerOnion && p !== this._myOnionAddress);
      
      if (peersToAsk.length === 0) {
          download.listeners.forEach(l => l.onProgress(-1));
          return;
      }

      download.listeners.forEach(l => l.onProgress(-1));

      await this.broadcast({
          type: 'MEDIA_RECOVERY_REQUEST',
          senderId: this._myOnionAddress || 'system',
          payload: { mediaId: mediaId, accessKey: download.metadata.accessKey }
      }, peersToAsk);
  }

  private async handleRecoveryRequest(senderId: string, payload: { mediaId: string; accessKey?: string }) {
      if (this._isShuttingDown) return;

      const { mediaId, accessKey } = payload;
      const authorized = await verifyMediaAccess(mediaId, accessKey);
      if (authorized) {
          await this.sendMessage(senderId, {
              type: 'MEDIA_RECOVERY_FOUND',
              senderId: this._myOnionAddress || 'system',
              payload: { mediaId }
          });
      }
  }

  private handleRecoveryFound(senderId: string, payload: { mediaId: string }) {
      if (this._isShuttingDown) return;

      const { mediaId } = payload;
      const download = this._activeDownloads.get(mediaId);
      if (download && download.status === 'recovering') {
          this.log('INFO', 'NETWORK', `Found source for ${mediaId}: ${senderId}`);
          download.peerOnion = senderId;
          download.status = 'active';
          // Restart queue pump
          this.pumpDownloadQueue(download);
      }
  }

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
          const currentProg = existing.status === 'recovering' ? -1 : Math.round((existing.receivedCount / existing.totalChunks) * 100);
          onProgress(currentProg);
          return new Promise((resolve, reject) => {
              existing.listeners.push({ onProgress, onComplete: resolve, onError: reject });
          });
      }

      return new Promise((resolve, reject) => {
          const totalChunks = metadata.chunkCount;
          // Initial Queue: [0, 1, 2, ..., totalChunks-1]
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
              rttSamples: [],
              avgRtt: 5000, // Conservative start (5s)
              listeners: [{ onProgress, onComplete: resolve, onError: reject }]
          });
          
          // Kickoff
          this.pumpDownloadQueue(this._activeDownloads.get(metadata.id)!);
      });
  }

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
     // CRITICAL: Block outgoing pings during shutdown to reduce noise
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
    
    // CRITICAL: Allow only shutdown packets during shutdown phase
    if (this._isShuttingDown && packet.type !== 'NODE_SHUTDOWN' && packet.type !== 'USER_EXIT') {
        return false; 
    }

    return new Promise((resolve) => {
        if (!this.socket.connected) { resolve(false); return; }
        this.socket.emit('send-packet', { targetOnion: targetOnionAddress, payload: packet, streamId }, (response: any) => {
             resolve(response ? response.success : false);
        });
    });
  }

  public async broadcast(packet: any, recipients: string[]) {
    // CRITICAL: Prevent broadcast storms during shutdown except for exit signals
    if (this._isShuttingDown && packet.type !== 'NODE_SHUTDOWN') return;

    const promises = recipients.map(async (onionAddress) => {
        if (onionAddress === this._myOnionAddress) return;
        await this.sendMessage(onionAddress, packet);
    });
    await Promise.all(promises);
  }

  public disconnect() {
     this.notifyStatus(false);
     this.socket.disconnect();
  }
}

export const networkService = new NetworkService();
