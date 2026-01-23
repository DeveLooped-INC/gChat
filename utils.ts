
import jsSha3 from 'js-sha3';

// @ts-ignore
const sha3_256 = jsSha3.sha3_256 || jsSha3.default?.sha3_256 || jsSha3;

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

export const generateRandomId = () => crypto.randomUUID();

// RFC 4648 Base32 alphabet (used by Tor)
export const toBase32 = (buffer: Uint8Array): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
};

// UI Helper for the new Identity System
export const formatUserIdentity = (fullUsername: string): { handle: string; suffix: string | null } => {
    const parts = fullUsername.split('.');
    if (parts.length > 1) {
        const suffix = parts.pop()!;
        const handle = parts.join('.');
        return { handle, suffix: `.${suffix}` };
    }
    return { handle: fullUsername, suffix: null };
};

export const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export interface TransferConfig {
    chunkSize: number;
    concurrency: number;
}

export const getTransferConfig = (bytes: number): TransferConfig => {
    // Tor favors fewer, larger cells over many small interactions due to RTT.
    // We use 256KB across the board to be safe against timeouts on slow circuits.
    // The previous 512KB was occasionally causing timeouts on 2min connection limits.
    // With AIMD concurrency, 256KB parallel requests will saturate the link effectively.
    return { chunkSize: 256 * 1024, concurrency: 2 };
};

// --- EMOTICONS ---
export const SOCIAL_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '🔥'];
export const DM_REACTIONS = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🔥', '🎉', '👀', '✅'];

// Simple generator for random user names
const ADJECTIVES = ['Cyber', 'Neon', 'Quantum', 'Dark', 'Hidden', 'Crypto', 'Silent', 'Rapid', 'Null', 'Void', 'Solar'];
const NOUNS = ['Ninja', 'Signal', 'Node', 'Drifter', 'Punk', 'Ghost', 'Surfer', 'Coder', 'Relay', 'Daemon', 'Glitch'];

export const generateRandomProfile = () => {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 999);
  const displayName = `${adj} ${noun}`;
  const username = `${adj.toLowerCase()}_${noun.toLowerCase()}_${num}`;
  
  return { displayName, username };
};

export const calculateObjectSize = (obj: any): number => {
  const str = JSON.stringify(obj);
  return new TextEncoder().encode(str).length;
};

export const calculatePostHash = (post: any): string => {
    // IMPORTANT: This payload must include mutable fields (comments/votes) 
    // so that the hash changes when activity happens.
    // This allows the Inventory Sync protocol to detect outdated posts.
    const payload = {
        id: post.id,
        content: post.content,
        authorId: post.authorId,
        timestamp: post.timestamp,
        mediaId: post.media?.id,
        imageUrl: post.imageUrl?.length, 
        isEdited: post.isEdited,
        // --- Social Sync Fields ---
        commentsCount: post.comments,
        latestCommentTime: post.commentsList && post.commentsList.length > 0 
            ? post.commentsList[post.commentsList.length-1].timestamp 
            : 0,
        votesCount: Object.keys(post.votes || {}).length,
        reactionsCount: Object.keys(post.reactions || {}).length
    };
    return sha3_256(JSON.stringify(payload));
};
