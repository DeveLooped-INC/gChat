import { arrayBufferToBase64 } from '../utils';
import { kvService } from './kv';
import { Socket } from 'socket.io-client';

let socket: Socket | null = null;

// --- FAILED UPLOAD RETRY QUEUE ---
const pendingUploads: Map<string, { blob: Blob, accessKey?: string, isCache: boolean }> = new Map();
const MAX_UPLOAD_RETRIES = 2;
const UPLOAD_RETRY_DELAY_MS = 2000;

export const setMediaSocket = (s: Socket) => {
  socket = s;

  // On reconnect, retry any pending uploads
  s.on('connect', () => {
    if (pendingUploads.size > 0) {
      console.log(`[MediaStorage] Socket reconnected. Retrying ${pendingUploads.size} pending uploads...`);
      const entries = Array.from(pendingUploads.entries());
      pendingUploads.clear();
      entries.forEach(([id, { blob, accessKey, isCache }]) => {
        saveMedia(id, blob, accessKey, isCache).catch(e =>
          console.error(`[MediaStorage] Reconnect retry failed for ${id}:`, e)
        );
      });
    }
  });
};

// Helper: Upload media buffer + metadata to backend with retries
const uploadToBackend = async (id: string, buffer: ArrayBuffer, metadata: any, isCache: boolean, retries: number = MAX_UPLOAD_RETRIES): Promise<boolean> => {
  if (!socket || !socket.connected) return false;

  return new Promise<boolean>((resolve) => {
    let resolved = false;
    // Timeout safety (15s) — prevents hanging if socket event is lost
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn(`[MediaStorage] Upload timeout for ${id}`);
        resolve(false);
      }
    }, 15000);

    socket!.emit('media:upload', {
      id,
      data: buffer,
      metadata,
      isCache
    }, (res: any) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      if (res?.success) {
        resolve(true);
      } else {
        console.error(`[MediaStorage] Upload failed for ${id}:`, res?.error);
        resolve(false);
      }
    });
  });
};

export const saveMedia = async (id: string, blob: Blob, accessKey?: string, isCache: boolean = false) => {
  try {
    // 1. Cache locally for performance (Split Cache)
    const cacheName = isCache ? 'gchat-media-cache-v1' : 'gchat-media-user-v1';
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(cacheName);
      await cache.put(new Request(`/media/${id}`), new Response(blob, {
        headers: { 'Content-Type': blob.type }
      }));
    }

    // 2. Upload to Backend (Persistence) with retry
    if (socket && socket.connected) {
      const buffer = await blob.arrayBuffer();

      // Get owner ID for metadata
      let ownerId = 'anonymous';
      try {
        const profile = await kvService.get<any>('gchat_user_profile');
        if (profile) ownerId = profile.id;
      } catch (e) { console.warn('Failed to get owner profile for media upload:', e); }

      const metadata = {
        id,
        mimeType: blob.type,
        size: blob.size,
        filename: `${id}.${blob.type.split('/')[1] || 'bin'}`,
        accessKey: accessKey || '',
        ownerId
      };

      let success = false;
      for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
        success = await uploadToBackend(id, buffer, metadata, isCache);
        if (success) break;
        if (attempt < MAX_UPLOAD_RETRIES) {
          console.warn(`[MediaStorage] Retry ${attempt + 1}/${MAX_UPLOAD_RETRIES} for ${id} in ${UPLOAD_RETRY_DELAY_MS}ms...`);
          await new Promise(r => setTimeout(r, UPLOAD_RETRY_DELAY_MS));
        }
      }

      if (!success) {
        console.error(`[MediaStorage] All upload attempts failed for ${id}. Queuing for reconnect retry.`);
        pendingUploads.set(id, { blob, accessKey, isCache });
      }
    } else {
      // Socket not connected — queue for later
      console.warn(`[MediaStorage] Socket disconnected. Queuing upload for ${id}.`);
      pendingUploads.set(id, { blob, accessKey, isCache });
    }
  } catch (e) {
    console.error("Failed to save media", e);
  }
};

export const getMedia = async (id: string): Promise<Blob | null> => {
  try {
    if (typeof caches !== 'undefined') {
      // 1. Try User Cache (Permanent)
      const userCache = await caches.open('gchat-media-user-v1');
      const userResponse = await userCache.match(`/media/${id}`);
      if (userResponse) {
        console.debug(`[MediaStorage] Found ${id} in User Cache`);
        return await userResponse.blob();
      }

      // 2. Try Temp Cache (Ephemeral)
      const tempCache = await caches.open('gchat-media-cache-v1');
      const tempResponse = await tempCache.match(`/media/${id}`);
      if (tempResponse) {
        console.debug(`[MediaStorage] Found ${id} in Temp Cache`);
        return await tempResponse.blob();
      }
    }

    // 3. Try Backend
    if (socket && socket.connected) {
      console.debug(`[MediaStorage] Fetching ${id} from Backend...`);
      return new Promise((resolve) => {
        socket!.emit('media:download', { id }, async (res: any) => {
          if (res && res.success && res.buffer) {
            // Buffer is likely an ArrayBuffer or Buffer object from Socket.IO
            const mimeType = res.metadata?.mimeType || 'application/octet-stream';
            const blob = new Blob([res.buffer], { type: mimeType });

            // Populate Cache based on source
            // We don't know if it's user or cache from download response alone easily w/o metadata context
            // But usually downloads are for viewing, so we put in temp cache UNLESS we specifically save it elsewhere.
            // However, to be safe and consistent with "downloaded = cache", we use temp cache.
            if (typeof caches !== 'undefined') {
              const tempCache = await caches.open('gchat-media-cache-v1');
              tempCache.put(new Request(`/media/${id}`), new Response(blob, { headers: { 'Content-Type': mimeType } }));
            }
            resolve(blob);
          } else {
            console.warn(`[MediaStorage] Backend download failed for ${id}:`, res?.error || 'Unknown Error');
            resolve(null);
          }
        });
      });
    } else {
      console.warn(`[MediaStorage] Socket disconnected. Cannot fetch ${id} from backend.`);
    }

    return null;
  } catch (e) {
    console.error("Failed to get media", e);
    return null;
  }
};

export const hasMedia = async (id: string): Promise<boolean> => {
  try {
    if (typeof caches !== 'undefined') {
      // 1. Check Caches
      const userCache = await caches.open('gchat-media-user-v1');
      if (await userCache.match(`/media/${id}`)) return true;

      const tempCache = await caches.open('gchat-media-cache-v1');
      if (await tempCache.match(`/media/${id}`)) return true;
    }

    // 2. Check Backend
    if (socket && socket.connected) {
      return new Promise((resolve) => {
        socket!.emit('media:exists', { id }, (res: any) => {
          resolve(res && res.success);
        });
      });
    }

    return false;
  } catch (e) {
    return false;
  }
};

export const verifyMediaAccess = async (id: string, providedKey?: string): Promise<boolean> => {
  console.log(`[MediaVerify] Checking access for ${id}. Key: ${providedKey}`);
  // Check backend for access
  if (socket && socket.connected) {
    return new Promise((resolve) => {
      let resolved = false;
      // Timeout safety (5s)
      const t = setTimeout(() => {
        if (!resolved) {
          console.warn(`[MediaVerify] Timeout waiting for backend response for ${id}`);
          resolve(false);
          resolved = true;
        }
      }, 5000);

      socket!.emit('media:verify', id, providedKey, (allowed: boolean) => {
        if (resolved) return;
        clearTimeout(t);
        console.log(`[MediaVerify] Backend response for ${id}: ${allowed}`);
        resolve(allowed);
        resolved = true;
      });
    });
  }
  // Fallback (safe fail)
  console.warn(`[MediaVerify] Socket disconnected or unavailable. Denying access.`);
  return false;
};

export const deleteMedia = async (id: string) => {
  try {
    if (typeof caches !== 'undefined') {
      // Only delete from User Cache (Permanent)
      const userCache = await caches.open('gchat-media-user-v1');
      await userCache.delete(`/media/${id}`);
    }

    // Call backend delete (which only deletes from local/user storage)
    if (socket && socket.connected) {
      socket.emit('media:delete', id);
    }
  } catch (e) { console.warn(`Failed to delete media ${id}:`, e); }
};

// --- SYSTEM OPERATIONS ---

export const clearMediaCache = async () => {
  try {
    if (typeof caches !== 'undefined') {
      // Only delete the TEMP cache
      await caches.delete('gchat-media-cache-v1');
      // Legacy cleanup (optional, one-time)
      await caches.delete('gchat-media-v1');
    }
  } catch (e) {
    console.error("Failed to clear media cache", e);
  }
};
