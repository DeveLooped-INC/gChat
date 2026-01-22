
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

interface ActiveDownload {
    id: string;
    peerOnion: string;
    chunks: (string | null)[];
    receivedCount: number;
    totalChunks: number;
    metadata: MediaMetadata;
    status: 'active' | 'paused' | 'completed' | 'error' | 'recovering';
    lastActivity: number;
    lastRetryTime: number; // Added to prevent spamming retries
    retryCount: number;
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
        // Resume stalled downloads on reconnect
        this.resumeAllDownloads();
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
            
            // Check if we need to resume downloads for this peer
            this.resumeDownloadsForPeer(sender);

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

    // --- BACKGROUND HEARTBEAT FOR DOWNLOADS ---
    setInterval(() => {
        if (this._isShuttingDown) return; // Halt background activity during shutdown

        const now = Date.now();

        this._activeDownloads.forEach((download, mediaId) => {
            const timeSinceActivity = now - download.lastActivity;
            
            // Case 1: Active but stalled
            if (download.status === 'active') {
                // Stalled for > 30 seconds
                if (timeSinceActivity > 30000) {
                    const timeSinceRetry = now - download.lastRetryTime;
                    
                    // Don't retry too often (every 30s max)
                    if (timeSinceRetry > 30000) {
                        
                        // GIVE UP CONDITION: Max 10 retries
                        if (download.retryCount >= 10) {
                             this.log('ERROR', 'NETWORK', `Download ${mediaId} failed after ${download.retryCount} retries. Pausing until peer reconnects.`);
                             download.status = 'paused';
                             download.listeners.forEach(l => l.onError("Connection unstable. Download paused."));
                             return;
                        }

                        this.log('WARN', 'NETWORK', `Download ${mediaId} stalled (${Math.round(timeSinceActivity/1000)}s). Retrying... (Attempt ${download.retryCount + 1}/10)`);
                        
                        download.retryCount++;
                        download.lastRetryTime = now;
                        
                        const firstMissing = download.chunks.findIndex(c => c === null);
                        if (firstMissing !== -1) {
                            // Reduce concurrency for retries to 1 to force recovery
                            const batchSize = 1;
                            this.requestChunksBatch(download.peerOnion, mediaId, firstMissing, batchSize, download.totalChunks);
                        } else {
                            this.finishDownload(mediaId);
                        }
                    }
                }
            }

            // Case 2: Recovering/Searching but silent (45s no peers)
            if (download.status === 'recovering' && timeSinceActivity > 45000) {
                const timeSinceRetry = now - download.lastRetryTime;
                if (timeSinceRetry > 45000) {
                    this.log('WARN', 'NETWORK', `Still searching for source for ${mediaId}... Re-broadcasting.`);
                    download.lastRetryTime = now;
                    this.attemptMeshRecovery(mediaId);
                }
            }
        });
    }, 5000);
  }

  // --- AUTO-RESUME LOGIC ---
  private resumeDownloadsForPeer(peerId: string) {
      this._activeDownloads.forEach((dl, id) => {
          if (dl.peerOnion === peerId && dl.status === 'paused') {
              this.log('INFO', 'NETWORK', `Resuming paused download ${id} from ${peerId} due to new activity.`);
              dl.status = 'active';
              dl.retryCount = 0; // Reset retry count
              dl.lastActivity = Date.now();
              dl.lastRetryTime = 0;
              
              // Trigger immediate fetch of missing chunks
              const firstMissing = dl.chunks.findIndex(c => c === null);
              if (firstMissing !== -1) {
                   this.requestChunksBatch(peerId, id, firstMissing, 2, dl.totalChunks);
              }
          }
      });
  }

  // --- FUNCTION 1: ANNOUNCE EXIT (The UI Triggered Action) ---
  public async announceExit(peers: string[], contacts: { homeNodes: string[], id: string }[], myOnion: string, myUserId: string): Promise<void> {
      // 1. Lock Network & Stop Media
      this._isShuttingDown = true;
      this.socket.emit('system-shutdown-prep'); // Tell backend to prepare (suppress noise)
      
      this.log('WARN', 'NETWORK', 'Function 1: Stopping media & broadcasting exit...');
      
      this._activeDownloads.forEach(dl => {
          dl.listeners.forEach(l => l.onError("System Shutdown"));
      });
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
      // We use race to ensure we don't hang forever if a peer is stubborn
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

  // --- MEDIA METHODS ---

  private async handleMediaRequest(senderId: string, payload: { mediaId: string; chunkIndex: number }) {
      if (this._isShuttingDown) return; // Halt serving media during shutdown

      const { mediaId, chunkIndex } = payload;
      const blob = await getMedia(mediaId);
      if (!blob) return;

      const { chunkSize } = getTransferConfig(blob.size);
      const totalChunks = Math.ceil(blob.size / chunkSize);
      
      if (chunkIndex >= totalChunks) return;

      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, blob.size);
      const chunkBlob = blob.slice(start, end);
      
      const reader = new FileReader();
      reader.onload = async () => {
          const base64Data = (reader.result as string).split(',')[1];
          await this.sendMessage(senderId, {
              type: 'MEDIA_CHUNK',
              senderId: this._myOnionAddress || 'system',
              payload: { mediaId, chunkIndex, totalChunks, data: base64Data }
          }, mediaId);
      };
      reader.readAsDataURL(chunkBlob);
  }

  private handleMediaChunk(senderId: string, payload: { mediaId: string; chunkIndex: number; totalChunks: number; data: string }) {
      if (this._isShuttingDown) return; // Halt receiving media during shutdown

      const { mediaId, chunkIndex, totalChunks, data } = payload;
      const download = this._activeDownloads.get(mediaId);
      if (!download) return; 

      // Logging for troubleshooting
      if (chunkIndex % 5 === 0 || chunkIndex === totalChunks - 1) {
          this.log('DEBUG', 'NETWORK', `Received chunk ${chunkIndex}/${totalChunks} for ${mediaId}`);
      }

      // Update metadata if sender corrects us (important if resizing occurred)
      if (totalChunks !== download.totalChunks) {
          download.totalChunks = totalChunks;
          if (download.chunks.length < totalChunks) {
              const diff = totalChunks - download.chunks.length;
              download.chunks = [...download.chunks, ...new Array(diff).fill(null)];
          }
      }

      if (download.chunks[chunkIndex] === null) {
          download.chunks[chunkIndex] = data;
          download.receivedCount++;
          download.lastActivity = Date.now(); // Reset watchdog
          download.retryCount = 0; // Success resets retry count
      }

      const progress = Math.round((download.receivedCount / download.totalChunks) * 100);
      download.listeners.forEach(l => l.onProgress(progress));

      if (download.receivedCount >= download.totalChunks) {
          if (!download.chunks.includes(null)) {
              this.finishDownload(mediaId);
          } else {
              const missingIndex = download.chunks.indexOf(null);
              if (missingIndex !== -1) {
                  // Retry the missing one immediately
                  this.requestChunksBatch(senderId, mediaId, missingIndex, 1, download.totalChunks);
              }
          }
      }
  }

  private async attemptMeshRecovery(mediaId: string) {
      if (this._isShuttingDown) return;

      const download = this._activeDownloads.get(mediaId);
      if (!download) return;

      if (download.status !== 'recovering') {
          download.status = 'recovering';
          this.log('WARN', 'NETWORK', `Attempting mesh recovery for ${mediaId}...`);
      }
      
      download.lastActivity = Date.now();

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
          download.retryCount = 0;
          download.lastActivity = Date.now();
          download.lastRetryTime = 0;
          const firstMissing = download.chunks.findIndex(c => c === null);
          if (firstMissing !== -1) {
              const { batchSize } = getTransferConfig(download.metadata.size);
              this.requestChunksBatch(senderId, mediaId, firstMissing, batchSize, download.totalChunks);
          }
      }
  }

  private async finishDownload(mediaId: string) {
      const download = this._activeDownloads.get(mediaId);
      if (!download || download.chunks.includes(null)) return;

      try {
          const byteArrays = download.chunks.map(b64 => {
              const binary = atob(b64 || '');
              const len = binary.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
              return bytes;
          });

          const blob = new Blob(byteArrays, { type: download.metadata.mimeType });
          
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

  private resumeAllDownloads() {
      this._activeDownloads.forEach((download, mediaId) => {
          if (download.status !== 'completed' && download.status !== 'error') {
              this.log('INFO', 'NETWORK', `Resuming download for ${mediaId}`);
              const firstMissing = download.chunks.findIndex(c => c === null);
              if (firstMissing !== -1) {
                  const { batchSize } = getTransferConfig(download.metadata.size);
                  this.requestChunksBatch(download.peerOnion, mediaId, firstMissing, batchSize, download.totalChunks);
              }
          }
      });
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
          // Determine optimal batch size for this file profile
          const { batchSize } = getTransferConfig(metadata.size);

          this._activeDownloads.set(metadata.id, {
              id: metadata.id,
              peerOnion: peerOnionAddress,
              chunks: new Array(totalChunks).fill(null),
              receivedCount: 0,
              totalChunks,
              metadata,
              status: 'active',
              retryCount: 0,
              lastActivity: Date.now(),
              lastRetryTime: 0,
              listeners: [{ onProgress, onComplete: resolve, onError: reject }]
          });
          
          this.requestChunksBatch(peerOnionAddress, metadata.id, 0, batchSize, totalChunks);
      });
  }

  private async requestChunksBatch(targetOnion: string, mediaId: string, startIndex: number, batchSize: number, total: number) {
      if (this._isShuttingDown) return;

      const download = this._activeDownloads.get(mediaId);
      if(!download) return;
      if (!this.socket.connected) return;

      this.log('DEBUG', 'NETWORK', `Requesting chunks ${startIndex}-${Math.min(startIndex+batchSize, total)} for ${mediaId} from ${targetOnion}`);

      const { pacingDelay } = getTransferConfig(download.metadata.size);

      const limit = Math.min(startIndex + batchSize, total);
      for (let i = startIndex; i < limit; i++) {
          if (download.chunks[i] === null) {
              const streamId = download.retryCount > 0 ? `${mediaId}_retry` : mediaId;
              this.sendMessage(targetOnion, {
                  type: 'MEDIA_REQUEST',
                  senderId: this._myOnionAddress || 'unknown',
                  payload: { mediaId, chunkIndex: i }
              }, streamId);
              
              // Dynamic pacing delay between chunks in a batch
              await new Promise(r => setTimeout(r, pacingDelay)); 
          }
      }

      if (limit < total) {
          // If we haven't finished, queue next check/batch
          setTimeout(() => {
              const currentDownload = this._activeDownloads.get(mediaId);
              if (!currentDownload) return;
              
              const nextMissing = currentDownload.chunks.findIndex(c => c === null);
              if (nextMissing !== -1) {
                  if (nextMissing >= limit) {
                      this.requestChunksBatch(targetOnion, mediaId, nextMissing, batchSize, total);
                  }
              }
          }, 2000); // 2s watchdog between batches
      }
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
