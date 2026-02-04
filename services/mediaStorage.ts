import { arrayBufferToBase64 } from '../utils';
import { kvService } from './kv';
import { Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const setMediaSocket = (s: Socket) => {
  socket = s;
};

export const saveMedia = async (id: string, blob: Blob, accessKey?: string, isCache: boolean = false) => {
  try {
    // 1. Cache locally for performance
    const cache = await caches.open('gchat-media-v1');
    await cache.put(new Request(`/media/${id}`), new Response(blob, {
      headers: { 'Content-Type': blob.type }
    }));

    // 2. Upload to Backend (Persistence)
    if (socket && socket.connected) {
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

      socket.emit('media:upload', {
        id,
        data: buffer, // Send Raw Buffer
        metadata,
        isCache
      }, (res: any) => {
        if (!res?.success) console.error("Media upload failed:", res?.error);
      });
    }
  } catch (e) {
    console.error("Failed to save media", e);
  }
};

export const getMedia = async (id: string): Promise<Blob | null> => {
  try {
    // 1. Try Cache
    const cache = await caches.open('gchat-media-v1');
    const response = await cache.match(`/media/${id}`);
    if (response) return await response.blob();

    // 2. Try Backend
    if (socket && socket.connected) {
      return new Promise((resolve) => {
        socket!.emit('media:download', id, async (res: any) => {
          if (res && res.success && res.buffer) {
            // Buffer is likely an ArrayBuffer or Buffer object from Socket.IO
            const mimeType = res.metadata?.mimeType || 'application/octet-stream';
            const blob = new Blob([res.buffer], { type: mimeType });

            // Populate Cache
            cache.put(new Request(`/media/${id}`), new Response(blob, { headers: { 'Content-Type': mimeType } }));
            resolve(blob);
          } else {
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
    const cache = await caches.open('gchat-media-v1');
    const response = await cache.match(`/media/${id}`);
    return !!response;
  } catch (e) {
    return false;
  }
};

export const verifyMediaAccess = async (id: string, providedKey?: string): Promise<boolean> => {
  // Check backend for access
  if (socket && socket.connected) {
    return new Promise((resolve) => {
      socket!.emit('media:verify', id, providedKey, (allowed: boolean) => {
        resolve(allowed);
      });
    });
  }
  // Fallback (safe fail)
  return false;
};

export const deleteMedia = async (id: string) => {
  try {
    const cache = await caches.open('gchat-media-v1');
    await cache.delete(`/media/${id}`);

    if (socket && socket.connected) {
      socket.emit('media:delete', id);
    }
  } catch (e) { }
};

// --- SYSTEM OPERATIONS ---

export const clearMediaCache = async () => {
  try {
    // Delete the entire Cache Storage container
    const keys = await caches.keys();
    for (const key of keys) {
      if (key === 'gchat-media-v1') {
        await caches.delete(key);
      }
    }
    // Backend clear should be handled via factory reset call, not here.
  } catch (e) {
    console.error("Failed to clear media cache", e);
  }
};
