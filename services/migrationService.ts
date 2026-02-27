import JSZip from 'jszip';
import { encryptWithPassword, decryptWithPassword } from './cryptoService';
import { networkService } from './networkService';
import { storageService } from './storage';
import { kvService } from './kv'; // Added KV Service
import { Post, Message, Contact, Group, NotificationItem, ConnectionRequest, UserProfile } from '../types';

export interface MigrationPackage {
    version: number;
    timestamp: number;
    encryptedData: string;
    salt: string;
    iv: string;
    iterations?: number;
}

const waitForSocket = async (): Promise<any> => {
    if (networkService.socket?.connected) return networkService.socket;
    return new Promise((resolve) => {
        const check = setInterval(() => {
            if (networkService.socket?.connected) {
                clearInterval(check);
                resolve(networkService.socket);
            }
        }, 100);
    });
};

interface DecryptedPayload {
    kvData: {
        userProfile: UserProfile | null;
        profileRegistry: Record<string, any>;
        nodeOwner: string | null;
        nodeConfig: any;
    };
    // Legacy support for older migrations
    localStorage: Record<string, string>;
    torKeys: any;
    idbData: {
        posts: Post[];
        messages: Message[];
        contacts: Contact[];
        groups: Group[];
        notifications: NotificationItem[];
        requests: ConnectionRequest[];
    };
    ownerId: string;
}

export const createMigrationPackage = async (): Promise<{ blob: Blob; password: string }> => {
    // 1. Generate strong password (Cryptographically Secure)
    const array = new Uint8Array(20);
    window.crypto.getRandomValues(array);
    const password = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');

    // 2. Identify Current User (Owner) - Fetch from KV, fallback to LocalStorage (Legacy)
    let ownerId: string | null = await kvService.get<string>('gchat_node_owner');
    if (!ownerId) {
        ownerId = localStorage.getItem('gchat_node_owner');
    }

    if (!ownerId) throw new Error("No active node owner found. Cannot export.");

    // 3. Gather KV Store Data (CRITICAL: Contains Encryption Keys)
    const kvData = {
        userProfile: await kvService.get<UserProfile>('gchat_user_profile'),
        profileRegistry: await kvService.get<Record<string, any>>('gchat_profile_registry') || {},
        nodeOwner: ownerId,
        nodeConfig: await kvService.get<any>('gchat_node_config')
    };

    // 4. Gather LocalStorage Data (Legacy/Fallback)
    const SENSITIVE_KEYS = ['gchat_user_profile', 'gchat_node_owner', 'gchat_node_config', 'gchat_profile_registry'];
    const storageDump: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('gchat_') || key.includes(ownerId))) {
            // Skip sensitive keys - they are already handled by KV export
            if (SENSITIVE_KEYS.includes(key)) continue;
            storageDump[key] = localStorage.getItem(key) || '';
        }
    }

    // 5. Gather IndexedDB Data (The Big Stuff)
    const idbData = {
        posts: await storageService.getItems<Post>('posts', ownerId),
        messages: await storageService.getItems<Message>('messages', ownerId),
        contacts: await storageService.getItems<Contact>('contacts', ownerId),
        groups: await storageService.getItems<Group>('groups', ownerId),
        notifications: await storageService.getItems<NotificationItem>('notifications', ownerId),
        requests: await storageService.getItems<ConnectionRequest>('requests', ownerId)
    };

    // 6. Get Tor Keys from Backend
    let torKeys = {};
    if (typeof networkService.getTorKeys === 'function') {
        try {
            torKeys = await networkService.getTorKeys();
        } catch (e) {
            console.warn("Could not export Tor keys. Node identity will change on restore.");
        }
    }

    const fullPayload: DecryptedPayload = {
        kvData,
        localStorage: storageDump,
        torKeys,
        idbData,
        ownerId
    };

    // 7. Encrypt Payload
    const { encrypted, salt, iv, iterations } = await encryptWithPassword(JSON.stringify(fullPayload), password);

    const migrationData: MigrationPackage = {
        version: 3, // Version 3 includes KV Data
        timestamp: Date.now(),
        encryptedData: encrypted,
        salt,
        iv,
        iterations
    };

    // 8. Create Zip
    const zip = new JSZip();
    zip.file("gchat_migration_v3.json", JSON.stringify(migrationData, null, 2));

    // 9. Fetch and Embed Media Blobs
    const mediaFolder = zip.folder("media");
    if (mediaFolder) {
        const socket = await waitForSocket();

        // Find all media hashes (mostly from Posts and Messages)
        const allMediaIds = new Set<string>();

        idbData.posts.forEach(p => { if (p.media?.id) allMediaIds.add(p.media.id); });
        idbData.messages.forEach(m => {
            if (m.media?.id) allMediaIds.add(m.media.id);
            if (m.attachmentUrl) {
                // If attachment is a data URI, ignore. If it's a blob, we can't export it this way.
            }
        });

        for (const mid of allMediaIds) {
            try {
                const mediaBlob = await new Promise<Blob>((resolve, reject) => {
                    socket.emit('media:download', { id: mid }, (response: any) => {
                        if (response?.success && response.data) {
                            try {
                                // Extract from base64 string or ArrayBuffer
                                let buffer;
                                if (response.data instanceof ArrayBuffer) buffer = response.data;
                                else buffer = Uint8Array.from(atob(response.data.split(',')[1] || response.data), c => c.charCodeAt(0));
                                resolve(new Blob([buffer]));
                            } catch (e) { reject(e); }
                        } else {
                            reject(new Error("Media not found"));
                        }
                    });
                });
                mediaFolder.file(mid, mediaBlob);
            } catch (e) {
                console.warn(`Failed to export media ${mid}:`, e);
            }
        }
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });

    return { blob: zipBlob, password };
};

export const restoreMigrationPackage = async (file: File, password: string): Promise<void> => {
    try {
        const zip = new JSZip();
        const unzipped = await zip.loadAsync(file);

        // Support v3 (KV), v2 (IDB), v1 (Legacy)
        let migrationFile = unzipped.file("gchat_migration_v3.json");
        let version = 3;

        if (!migrationFile) {
            migrationFile = unzipped.file("gchat_migration_v2.json");
            version = 2;
        }
        if (!migrationFile) {
            migrationFile = unzipped.file("gchat_migration.json");
            version = 1;
        }

        if (!migrationFile) throw new Error("Invalid migration file format.");

        const content = await migrationFile.async("string");
        const migrationData: MigrationPackage = JSON.parse(content);

        // 1. Decrypt
        const decryptedJson = await decryptWithPassword(
            migrationData.encryptedData,
            password,
            migrationData.salt,
            migrationData.iv,
            migrationData.iterations
        );

        const payload: DecryptedPayload = JSON.parse(decryptedJson);

        // 2. Wipe Current State
        await storageService.deleteEverything();
        localStorage.clear();
        await kvService.del('gchat_user_profile');
        await kvService.del('gchat_node_owner');
        await kvService.del('gchat_profile_registry');
        await kvService.del('gchat_node_config');

        // 3. Restore KV Data (Version 3+)
        if (version >= 3 && payload.kvData) {
            if (payload.kvData.userProfile) await kvService.set('gchat_user_profile', payload.kvData.userProfile);
            if (payload.kvData.nodeOwner) await kvService.set('gchat_node_owner', payload.kvData.nodeOwner);
            if (payload.kvData.profileRegistry) await kvService.set('gchat_profile_registry', payload.kvData.profileRegistry);
            if (payload.kvData.nodeConfig) await kvService.set('gchat_node_config', payload.kvData.nodeConfig);
        }

        // 4. Restore LocalStorage (Legacy / Fallback)
        // 4. Restore LocalStorage (Legacy / Fallback) -> WITH SECURITY FILTER
        const SENSITIVE_KEYS = ['gchat_user_profile', 'gchat_node_owner', 'gchat_node_config', 'gchat_profile_registry'];
        if (payload.localStorage) {
            for (const [key, value] of Object.entries(payload.localStorage)) {
                if (SENSITIVE_KEYS.includes(key)) {
                    // MIGRATE LEGACY DATA TO KV
                    if (key === 'gchat_user_profile') await kvService.set('gchat_user_profile', JSON.parse(value as string));
                    else if (key === 'gchat_node_owner') await kvService.set('gchat_node_owner', value);
                    else if (key === 'gchat_node_config') await kvService.set('gchat_node_config', JSON.parse(value as string));
                    else if (key === 'gchat_profile_registry') await kvService.set('gchat_profile_registry', JSON.parse(value as string));
                } else {
                    localStorage.setItem(key, value as string);
                }
            }
        }

        // 5. Restore IndexedDB
        if (version >= 2 && payload.idbData && payload.ownerId) {
            const ownerId = payload.ownerId;
            await storageService.syncState('posts', payload.idbData.posts || [], ownerId);
            await storageService.syncState('messages', payload.idbData.messages || [], ownerId);
            await storageService.syncState('contacts', payload.idbData.contacts || [], ownerId);
            await storageService.syncState('groups', payload.idbData.groups || [], ownerId);
            await storageService.syncState('notifications', payload.idbData.notifications || [], ownerId);
            await storageService.syncState('requests', payload.idbData.requests || [], ownerId);
        }

        // 6. Restore Tor Keys
        if (payload.torKeys && Object.keys(payload.torKeys).length > 0) {
            if (typeof networkService.restoreTorKeys === 'function') {
                await networkService.restoreTorKeys(payload.torKeys);
            }
        }

        // 7. Restore Media Blobs
        const mediaFolder = unzipped.folder("media");
        if (mediaFolder) {
            const socket = await waitForSocket();
            const mediaFiles = Object.keys(mediaFolder.files).filter(k => k.startsWith('media/') && !mediaFolder.files[k].dir);

            for (const mediaPath of mediaFiles) {
                try {
                    const mid = mediaPath.split('/')[1];
                    const blob = await unzipped.file(mediaPath)?.async('blob');
                    if (!blob || !mid) continue;

                    // Convert Blob to Base64 to upload via Socket
                    const reader = new FileReader();
                    const b64Promise = new Promise<string>((res, rej) => {
                        reader.onloadend = () => res(reader.result as string);
                        reader.onerror = rej;
                    });
                    reader.readAsDataURL(blob);
                    const base64data = await b64Promise;

                    // Upload it back
                    await new Promise((resolve) => {
                        socket.emit('media:upload', { id: mid, data: base64data.split(',')[1], isBase64: true }, resolve);
                    });
                } catch (e) {
                    console.warn(`Failed to restore media ${mediaPath}:`, e);
                }
            }
        }

        return;

    } catch (e: any) {
        console.error("Migration Failed", e);
        throw new Error(e.message || "Decryption failed. Check password.");
    }
};
