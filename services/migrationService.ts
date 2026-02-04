
import JSZip from 'jszip';
import { encryptWithPassword, decryptWithPassword } from './cryptoService';
import { networkService } from './networkService';
import { storageService } from './storage';
import { Post, Message, Contact, Group, NotificationItem, ConnectionRequest } from '../types';

export interface MigrationPackage {
    version: number;
    timestamp: number;
    encryptedData: string;
    salt: string;
    iv: string;
}

interface DecryptedPayload {
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
    // 1. Generate strong password
    const password = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);

    // 2. Identify Current User (Owner)
    const ownerId = localStorage.getItem('gchat_node_owner');
    if (!ownerId) throw new Error("No active node owner found.");

    // 3. Gather LocalStorage Data (Config, Peers, Registry)
    const storageDump: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // We only backup keys relevant to the system or specific user
        if (key && (key.startsWith('gchat_') || key.includes(ownerId))) {
            storageDump[key] = localStorage.getItem(key) || '';
        }
    }

    // 4. Gather IndexedDB Data (The Big Stuff)
    const idbData = {
        posts: await storageService.getItems<Post>('posts', ownerId),
        messages: await storageService.getItems<Message>('messages', ownerId),
        contacts: await storageService.getItems<Contact>('contacts', ownerId),
        groups: await storageService.getItems<Group>('groups', ownerId),
        notifications: await storageService.getItems<NotificationItem>('notifications', ownerId),
        requests: await storageService.getItems<ConnectionRequest>('requests', ownerId)
    };

    // 5. Get Tor Keys from Backend
    let torKeys = {};
    if (typeof networkService.getTorKeys === 'function') {
        try {
            torKeys = await networkService.getTorKeys();
        } catch (e) {
            console.warn("Could not export Tor keys. Node identity will change on restore.");
        }
    }

    const fullPayload: DecryptedPayload = {
        localStorage: storageDump,
        torKeys: torKeys,
        idbData: idbData,
        ownerId: ownerId
    };

    // 6. Encrypt Payload
    const { encrypted, salt, iv } = await encryptWithPassword(JSON.stringify(fullPayload), password);

    const migrationData: MigrationPackage = {
        version: 2, // Version 2 supports IDB
        timestamp: Date.now(),
        encryptedData: encrypted,
        salt,
        iv
    };

    // 7. Create Zip
    const zip = new JSZip();
    zip.file("gchat_migration_v2.json", JSON.stringify(migrationData, null, 2));

    const zipBlob = await zip.generateAsync({ type: "blob" });

    return { blob: zipBlob, password };
};

export const restoreMigrationPackage = async (file: File, password: string): Promise<void> => {
    try {
        const zip = new JSZip();
        const unzipped = await zip.loadAsync(file);

        // Support v2 (IDB) and fallback for v1 (Legacy LS)
        let migrationFile = unzipped.file("gchat_migration_v2.json");
        let version = 2;

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
            migrationData.iv
        );

        const payload = JSON.parse(decryptedJson);

        // 2. Wipe Current State
        await storageService.deleteEverything();
        localStorage.clear();

        // 3. Restore LocalStorage
        if (payload.localStorage) {
            Object.entries(payload.localStorage).forEach(([key, value]) => {
                localStorage.setItem(key, value as string);
            });
        }

        // 4. Restore IndexedDB (Version 2 Only)
        if (version === 2 && payload.idbData && payload.ownerId) {
            const ownerId = payload.ownerId;
            await storageService.syncState('posts', payload.idbData.posts || [], ownerId);
            await storageService.syncState('messages', payload.idbData.messages || [], ownerId);
            await storageService.syncState('contacts', payload.idbData.contacts || [], ownerId);
            await storageService.syncState('groups', payload.idbData.groups || [], ownerId);
            await storageService.syncState('notifications', payload.idbData.notifications || [], ownerId);
            await storageService.syncState('requests', payload.idbData.requests || [], ownerId);
        }

        // 5. Restore Tor Keys
        if (payload.torKeys && Object.keys(payload.torKeys).length > 0) {
            if (typeof networkService.restoreTorKeys === 'function') {
                await networkService.restoreTorKeys(payload.torKeys);
            }
        }

        return;

    } catch (e: any) {
        console.error("Migration Failed", e);
        throw new Error(e.message || "Decryption failed. Check password.");
    }
};
