import { arrayBufferToBase64 } from '../utils';
import { kvService } from './kv';
import { Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const setMediaSocket = (s: Socket) => {
  socket = s;
};

export const saveMedia = async (id: string, blob: Blob, accessKey?: string, isCache: boolean = false) => {
  try {
    // 1. Cache locally for performance (Split Cache)
    const cacheName = isCache ? 'gchat-media-cache-v1' : 'gchat-media-user-v1';
    // console.debug(`[MediaStorage] Saving ${id} to ${cacheName}`);
    const cache = await caches.open(cacheName);
    await cache.put(new Request(`/media/${id}`), new Response(blob, {
      headers: { 'Content-Type': blob.type }
    }));

    // 2. Upload to Backend (Persistence)
    if (socket && socket.connected) {
      // console.debug(`[MediaStorage] Uploading ${id} to Backend (isCache=${isCache})...`);
      const buffer = await blob.arrayBuffer();

      // Get owner ID for metadata
      let ownerId = 'anonymous';
      try {
        const profile = await kvService.get<any>('gchat_user_profile');
        if (profile) ownerId = profile.id;
      } catch (e) { }

      const metadata = {
        id,
        mimeType: blob.type,
        size: blob.size,
        filename: `${id}.${blob.type.split('/')[1] || 'bin'}`,
        accessKey: accessKey || '',
        ownerId
      };

      await new Promise<void>((resolve) => {
        socket!.emit('media:upload', {
          id,
          data: buffer, // Send Raw Buffer
          metadata,
          isCache
        }, (res: any) => {
          if (!res?.success) console.error("Media upload failed:", res?.error);
          resolve();
        });
      });
    }
  } catch (e) {
    console.error("Failed to save media", e);
  }
};

export const getMedia = async (id: string): Promise<Blob | null> => {
  try {
    // 1. Try User Cache (Permanent)
    const userCache = await caches.open('gchat-media-user-v1');
    const userResponse = await userCache.match(`/media/${id}`);
    if (userResponse) {
      // console.debug(`[MediaStorage] Found ${id} in User Cache`);
      return await userResponse.blob();
    }

    // 2. Try Temp Cache (Ephemeral)
    const tempCache = await caches.open('gchat-media-cache-v1');
    const tempResponse = await tempCache.match(`/media/${id}`);
    if (tempResponse) {
      // console.debug(`[MediaStorage] Found ${id} in Temp Cache`);
      return await tempResponse.blob();
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
            tempCache.put(new Request(`/media/${id}`), new Response(blob, { headers: { 'Content-Type': mimeType } }));
            resolve(blob);
          } else {
            console.warn(`[MediaStorage] Backend download failed for ${id}:`, res?.error || 'Unknown Error');
            resolve(null);
          }
        });
      });
    }

    return null;
  } catch (e) {
    console.error("Failed to get media", e);
    return null;
  }
};

export const hasMedia = async (id: string): Promise<boolean> => {
  try {
    // 1. Check Caches
    const userCache = await caches.open('gchat-media-user-v1');
    if (await userCache.match(`/media/${id}`)) return true;

    const tempCache = await caches.open('gchat-media-cache-v1');
    if (await tempCache.match(`/media/${id}`)) return true;

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
  // Check backend for access
  if (socket && socket.connected) {
    return new Promise((resolve) => {
      // Timeout safety (5s)
      const t = setTimeout(() => resolve(false), 5000);
      socket!.emit('media:verify', id, providedKey, (allowed: boolean) => {
        clearTimeout(t);
        resolve(allowed);
      });
    });
  }
  // Fallback (safe fail)
  return false;
};

export const deleteMedia = async (id: string) => {
  try {
    // Only delete from User Cache (Permanent)
    const userCache = await caches.open('gchat-media-user-v1');
    await userCache.delete(`/media/${id}`);

    // Call backend delete (which only deletes from local/user storage)
    if (socket && socket.connected) {
      socket.emit('media:delete', id);
    }
  } catch (e) { }
};

// --- SYSTEM OPERATIONS ---

export const clearMediaCache = async () => {
  try {
    // Only delete the TEMP cache
    await caches.delete('gchat-media-cache-v1');
    // Legacy cleanup (optional, one-time)
    await caches.delete('gchat-media-v1');
  } catch (e) {
    console.error("Failed to clear media cache", e);
  }
};
