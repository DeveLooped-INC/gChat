import nacl from 'tweetnacl';
import jsSha3 from 'js-sha3';
import { toBase32 } from '../utils';

// @ts-ignore
const sha3_256 = jsSha3.sha3_256 || jsSha3.default?.sha3_256 || jsSha3;

const encodeUTF8 = (str: string): Uint8Array => new TextEncoder().encode(str);
const decodeUTF8 = (arr: Uint8Array): string => new TextDecoder().decode(arr);

const encodeBase64 = (arr: Uint8Array): string => {
  let binary = '';
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
};

const decodeBase64 = (str: string): Uint8Array => {
  const binaryString = atob(str);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const deterministicStringify = (obj: any): string => {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const sortedKeys = Object.keys(obj).sort();
  const result: any = {};
  sortedKeys.forEach(key => {
    result[key] = obj[key];
  });
  return JSON.stringify(result);
};

export interface KeyPair {
  publicKey: string;
  secretKey: string;
}

export interface UserKeys {
  signing: KeyPair;
  encryption: KeyPair;
}

// Updated to accept optional seed
export const generateKeys = (seed?: Uint8Array): UserKeys => {
  let signKp;
  let boxKp;

  if (seed) {
    signKp = nacl.sign.keyPair.fromSeed(seed);
    // For encryption, we can derive a different seed or use hash of seed.
    // To keep it simple and deterministic, we hash the seed for box keypair
    const encSeed = nacl.hash(seed).slice(0, 32);
    boxKp = nacl.box.keyPair.fromSecretKey(encSeed);
  } else {
    signKp = nacl.sign.keyPair();
    boxKp = nacl.box.keyPair();
  }

  return {
    signing: {
      publicKey: encodeBase64(signKp.publicKey),
      secretKey: encodeBase64(signKp.secretKey)
    },
    encryption: {
      publicKey: encodeBase64(boxKp.publicKey),
      secretKey: encodeBase64(boxKp.secretKey)
    }
  };
};

export const generateTripcode = (publicKeyBase64: string): string => {
  // 1. Decode Key
  const pubKey = decodeBase64(publicKeyBase64);
  // 2. Hash it (SHA3-256)
  const hash = sha3_256.create();
  hash.update(pubKey);
  const hashBytes = new Uint8Array(hash.arrayBuffer());
  // 3. Base32 Encode
  const b32 = toBase32(hashBytes);
  // 4. Return first 6 chars, lowercase
  return b32.substring(0, 6).toLowerCase();
};

export const deriveOnionAddress = (publicKeyBase64: string): string => {
  const pubKey = decodeBase64(publicKeyBase64);
  const prefix = encodeUTF8(".onion checksum");
  const version = new Uint8Array([0x03]);

  const checksumData = new Uint8Array(prefix.length + pubKey.length + version.length);
  checksumData.set(prefix);
  checksumData.set(pubKey, prefix.length);
  checksumData.set(version, prefix.length + pubKey.length);

  const hashHex = sha3_256(checksumData);
  const checksumByte1 = parseInt(hashHex.substring(0, 2), 16);
  const checksumByte2 = parseInt(hashHex.substring(2, 4), 16);

  const binary = new Uint8Array(pubKey.length + 2 + version.length);
  binary.set(pubKey);
  binary.set([checksumByte1, checksumByte2], pubKey.length);
  binary.set(version, pubKey.length + 2);

  const address = toBase32(binary);

  return address.toLowerCase();
};

export const signData = (data: any, secretKey: string): string => {
  const msg = encodeUTF8(deterministicStringify(data));
  const sig = nacl.sign.detached(msg, decodeBase64(secretKey));
  return encodeBase64(sig);
};

export const verifySignature = (data: any, signature: string, publicKey: string): boolean => {
  try {
    const msg = encodeUTF8(deterministicStringify(data));
    return nacl.sign.detached.verify(msg, decodeBase64(signature), decodeBase64(publicKey));
  } catch (e) {
    return false;
  }
};

export const encryptMessage = (
  content: string,
  theirPublicKey: string,
  mySecretKey: string
): { nonce: string; ciphertext: string } => {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msgUint8 = encodeUTF8(content);

  const encrypted = nacl.box(
    msgUint8,
    nonce,
    decodeBase64(theirPublicKey),
    decodeBase64(mySecretKey)
  );

  return {
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(encrypted)
  };
};

export const decryptMessage = (
  ciphertext: string,
  nonce: string,
  theirPublicKey: string,
  mySecretKey: string
): string | null => {
  try {
    const decrypted = nacl.box.open(
      decodeBase64(ciphertext),
      decodeBase64(nonce),
      decodeBase64(theirPublicKey),
      decodeBase64(mySecretKey)
    );

    if (!decrypted) return null;
    return decodeUTF8(decrypted);
  } catch (e) {
    return null;
  }
};

// --- SYMMETRIC ENCRYPTION FOR BACKUPS (AES-GCM via WebCrypto) ---

export const deriveKeyFromPassword = async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
};

export const encryptWithPassword = async (data: string, password: string): Promise<{ encrypted: string; salt: string; iv: string }> => {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPassword(password, salt);

  const enc = new TextEncoder();
  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as any },
    key,
    enc.encode(data)
  );

  return {
    encrypted: encodeBase64(new Uint8Array(encryptedContent)),
    salt: encodeBase64(salt),
    iv: encodeBase64(iv)
  };
};

export const decryptWithPassword = async (encryptedData: string, password: string, saltBase64: string, ivBase64: string): Promise<string> => {
  const salt = decodeBase64(saltBase64);
  const iv = decodeBase64(ivBase64);
  const key = await deriveKeyFromPassword(password, salt);

  const decryptedContent = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as any },
    key,
    decodeBase64(encryptedData) as any
  );

  return new TextDecoder().decode(decryptedContent);
};
