
export const saveMedia = async (id: string, blob: Blob, accessKey?: string) => {
  try {
    const cache = await caches.open('gchat-media-v1');
    await cache.put(new Request(`/media/${id}`), new Response(blob, {
        headers: { 'Content-Type': blob.type }
    }));

    if (accessKey) {
        try {
            const keys = JSON.parse(localStorage.getItem('gchat_media_keys') || '{}');
            keys[id] = accessKey;
            localStorage.setItem('gchat_media_keys', JSON.stringify(keys));
        } catch(e) {}
    }
  } catch (e) {
    console.error("Failed to save media", e);
  }
};

export const getMedia = async (id: string): Promise<Blob | null> => {
  try {
    const cache = await caches.open('gchat-media-v1');
    const response = await cache.match(`/media/${id}`);
    return response ? await response.blob() : null;
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
    // If we have the media, we check if there's a stored key restriction
    if (!(await hasMedia(id))) return false;

    try {
        const keys = JSON.parse(localStorage.getItem('gchat_media_keys') || '{}');
        const storedKey = keys[id];
        // If no key is stored, assume public/legacy access is fine.
        // If key is stored, provided key must match.
        if (!storedKey) return true;
        return storedKey === providedKey;
    } catch(e) {
        return true; // Fail open if DB corrupted to avoid data loss, or fail closed? Fail open for mesh resilience.
    }
};

export const deleteMedia = async (id: string) => {
    try {
        const cache = await caches.open('gchat-media-v1');
        await cache.delete(`/media/${id}`);

        const keys = JSON.parse(localStorage.getItem('gchat_media_keys') || '{}');
        delete keys[id];
        localStorage.setItem('gchat_media_keys', JSON.stringify(keys));
    } catch(e) {}
};

export const clearMediaCache = async () => {
    try {
        await caches.delete('gchat-media-v1');
        localStorage.removeItem('gchat_media_keys');
    } catch(e) {}
};
