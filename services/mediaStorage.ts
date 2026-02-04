import { Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const setMediaSocket = (s: Socket) => {
  socket = s;
};

export const saveMedia = async (id: string, blob: Blob, accessKey?: string) => {
  try {
    // 1. Cache locally for performance
    const cache = await caches.open('gchat-media-v1');
    await cache.put(new Request(`/media/${id}`), new Response(blob, {
      headers: { 'Content-Type': blob.type }
    }));

    // 2. Upload to Backend (Persistence)
    if (socket && socket.connected) {
      const buffer = await blob.arrayBuffer();
      // Simple toggle for now, ideal would be streaming
      socket.emit('media:upload', {
        id,
        buffer,
        type: blob.type,
        accessKey
      });
    }

    // 3. Save Metadata (Access Key) - MOVED TO BACKEND (via media:upload or db:save)
    // We assume backend handles the metadata save in 'media:upload' handler
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
            const blob = new Blob([res.buffer], { type: res.mimeType });
            // Populate Cache
            cache.put(new Request(`/media/${id}`), new Response(blob, { headers: { 'Content-Type': res.mimeType } }));
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
