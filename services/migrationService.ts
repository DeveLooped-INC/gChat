import JSZip from 'jszip';
import { encryptWithPassword, decryptWithPassword } from './cryptoService';
import { networkService } from './networkService';

export interface MigrationPackage {
    version: number;
    timestamp: number;
    encryptedData: string;
    salt: string;
    iv: string;
}

export const createMigrationPackage = async (): Promise<{ blob: Blob; password: string }> => {
    // 1. Generate strong password
    const password = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
    
    // 2. Gather LocalStorage Data
    const storageDump: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('gchat_') || key?.startsWith('user_')) {
            storageDump[key] = localStorage.getItem(key) || '';
        }
    }

    // 3. Get Tor Keys from Backend
    let torKeys = {};
    // Safety check for HMR environments
    if (typeof networkService.getTorKeys === 'function') {
        torKeys = await networkService.getTorKeys();
    } else {
        console.error("NetworkService.getTorKeys is missing. Please refresh the page.");
        throw new Error("System update pending. Please refresh the page and try again.");
    }

    const fullPayload = JSON.stringify({
        localStorage: storageDump,
        torKeys: torKeys
    });

    // 4. Encrypt Payload
    const { encrypted, salt, iv } = await encryptWithPassword(fullPayload, password);

    const migrationData: MigrationPackage = {
        version: 1,
        timestamp: Date.now(),
        encryptedData: encrypted,
        salt,
        iv
    };

    // 5. Create Zip
    const zip = new JSZip();
    zip.file("gchat_migration.json", JSON.stringify(migrationData, null, 2));
    
    const zipBlob = await zip.generateAsync({ type: "blob" });
    
    return { blob: zipBlob, password };
};

export const restoreMigrationPackage = async (file: File, password: string): Promise<void> => {
    try {
        const zip = new JSZip();
        const unzipped = await zip.loadAsync(file);
        
        const migrationFile = unzipped.file("gchat_migration.json");
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

        // 2. Restore LocalStorage
        if (payload.localStorage) {
            // Clear existing gChat data to avoid conflicts
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('gchat_') || k.startsWith('user_')) localStorage.removeItem(k);
            });

            Object.entries(payload.localStorage).forEach(([key, value]) => {
                localStorage.setItem(key, value as string);
            });
        }

        // 3. Restore Tor Keys
        if (payload.torKeys) {
            if (typeof networkService.restoreTorKeys === 'function') {
                await networkService.restoreTorKeys(payload.torKeys);
            } else {
                console.warn("restoreTorKeys function missing during restore");
            }
        }

        return;

    } catch (e: any) {
        console.error("Migration Failed", e);
        throw new Error(e.message || "Decryption failed. Check password.");
    }
};