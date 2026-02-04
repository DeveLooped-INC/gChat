import path from 'path';
import fs from 'fs';

const DB_FILE = 'gchat.db';
const KV_FILE = 'gchat_kv.json';
const STORE_FILE = 'gchat_store.json';
const MEDIA_FILE = 'gchat_media.json';

// --- SQLITE BACKEND ---
class SqliteDatabase {
    constructor(dataDir, sqliteLib) {
        this.dataDir = dataDir;
        this.dbPath = path.join(dataDir, DB_FILE);
        this.sqlite3 = sqliteLib;
        this.db = null;
        this.txQueue = Promise.resolve();
    }

    async init() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        return new Promise((resolve, reject) => {
            this.db = new this.sqlite3.Database(this.dbPath, (err) => {
                if (err) return reject(err);
                this.createTables().then(resolve).catch(reject);
            });
        });
    }

    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)`,
            `CREATE TABLE IF NOT EXISTS store_items (id TEXT PRIMARY KEY, store_name TEXT NOT NULL, owner_id TEXT NOT NULL, data TEXT, created_at INTEGER)`,
            `CREATE INDEX IF NOT EXISTS idx_store_items_owner ON store_items (store_name, owner_id)`,
            `CREATE TABLE IF NOT EXISTS media_files (id TEXT PRIMARY KEY, mime_type TEXT, size INTEGER, filename TEXT, access_key TEXT, owner_id TEXT, created_at INTEGER)`
        ];
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                let completed = 0;
                tables.forEach(sql => {
                    this.db.run(sql, (err) => {
                        if (err) reject(err);
                        completed++;
                        if (completed === tables.length) resolve();
                    });
                });
            });
        });
    }

    async kvGet(key) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT value FROM kv_store WHERE key = ?", [key], (err, row) => {
                if (err) reject(err); else resolve(row ? JSON.parse(row.value) : null);
            });
        });
    }

    async kvSet(key, value) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)", [key, JSON.stringify(value)], (err) => {
                if (err) reject(err); else resolve();
            });
        });
    }

    async kvDel(key) {
        return new Promise((resolve, reject) => {
            this.db.run("DELETE FROM kv_store WHERE key = ?", [key], (err) => {
                if (err) reject(err); else resolve();
            });
        });
    }

    async saveItem(storeName, item, ownerId) {
        return new Promise((resolve, reject) => {
            this.db.run(`INSERT OR REPLACE INTO store_items (id, store_name, owner_id, data, created_at) VALUES (?, ?, ?, ?, ?)`,
                [item.id, storeName, ownerId, JSON.stringify(item), Date.now()], (err) => { if (err) reject(err); else resolve(); });
        });
    }

    async syncItems(storeName, items, ownerId) {
        this.txQueue = this.txQueue.then(() => {
            return new Promise((resolve, reject) => {
                this.db.serialize(() => {
                    this.db.run("BEGIN TRANSACTION");
                    this.db.all("SELECT id FROM store_items WHERE store_name = ? AND owner_id = ?", [storeName, ownerId], (err, rows) => {
                        if (err) { this.db.run("ROLLBACK"); return reject(err); }
                        const existingIds = new Set(rows.map(r => r.id));
                        const newIds = new Set(items.map(i => i.id));
                        const toDelete = [...existingIds].filter(id => !newIds.has(id));
                        const stmtDel = this.db.prepare("DELETE FROM store_items WHERE id = ?");
                        toDelete.forEach(id => stmtDel.run(id));
                        stmtDel.finalize();
                        const stmtPut = this.db.prepare("INSERT OR REPLACE INTO store_items (id, store_name, owner_id, data, created_at) VALUES (?, ?, ?, ?, ?)");
                        items.forEach(item => stmtPut.run(item.id, storeName, ownerId, JSON.stringify(item), Date.now()));
                        stmtPut.finalize();
                        this.db.run("COMMIT", (err) => { if (err) reject(err); else resolve(); });
                    });
                });
            });
        }).catch(err => console.error(`[DB] Sync Error:`, err));
        return this.txQueue;
    }

    async getItems(storeName, ownerId) {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT data FROM store_items WHERE store_name = ? AND owner_id = ?", [storeName, ownerId], (err, rows) => {
                if (err) reject(err); else resolve(rows.map(r => JSON.parse(r.data)));
            });
        });
    }

    async deleteItem(storeName, id) {
        return new Promise((resolve, reject) => {
            this.db.run("DELETE FROM store_items WHERE store_name = ? AND id = ?", [storeName, id], (err) => { if (err) reject(err); else resolve(); });
        });
    }

    async clearStore(storeName) {
        return new Promise((resolve, reject) => {
            this.db.run("DELETE FROM store_items WHERE store_name = ?", [storeName], (err) => { if (err) reject(err); else resolve(); });
        });
    }

    async saveMediaMetadata(meta) {
        return new Promise((resolve, reject) => {
            this.db.run(`INSERT OR REPLACE INTO media_files (id, mime_type, size, filename, access_key, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [meta.id, meta.mimeType, meta.size, meta.filename, meta.accessKey, meta.ownerId, Date.now()], (err) => { if (err) reject(err); else resolve(); });
        });
    }

    async getMediaMetadata(id) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT * FROM media_files WHERE id = ?", [id], (err, row) => {
                if (err) reject(err);
                if (row) {
                    // Convert snake_case back to camelCase explicitly to match mapped interface if needed?
                    // The SQL columns are snake_case: access_key, owner_id, mime_type
                    // The TypeScript interface expects: accessKey, ownerId, mimeType
                    // SQLite driver returns row as { access_key: ... }
                    // We should normalize or ensure caller handles it. 
                    // To be safe, let's normalize here.
                    resolve({
                        id: row.id,
                        mimeType: row.mime_type,
                        size: row.size,
                        filename: row.filename,
                        accessKey: row.access_key,
                        ownerId: row.owner_id,
                        createdAt: row.created_at
                    });
                } else resolve(null);
            });
        });
    }

    async deleteMediaMetadata(id) {
        return new Promise((resolve, reject) => {
            this.db.run("DELETE FROM media_files WHERE id = ?", [id], (err) => { if (err) reject(err); else resolve(); });
        });
    }
}

// --- JSON FALLBACK BACKEND ---
class JsonDatabase {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.kvPath = path.join(dataDir, KV_FILE);
        this.storePath = path.join(dataDir, STORE_FILE);
        this.mediaPath = path.join(dataDir, MEDIA_FILE);
        this.kv = {};
        this.store = []; // Array of { id, storeName, ownerId, data, createdAt }
        this.media = {}; // Map id -> meta
        this.queue = Promise.resolve();
    }

    async init() {
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });

        // Load KV
        try { if (fs.existsSync(this.kvPath)) this.kv = JSON.parse(fs.readFileSync(this.kvPath, 'utf8')); } catch (e) { console.error("KV Load Error", e); }
        // Load Store
        try { if (fs.existsSync(this.storePath)) this.store = JSON.parse(fs.readFileSync(this.storePath, 'utf8')); } catch (e) { console.error("Store Load Error", e); }
        // Load Media
        try { if (fs.existsSync(this.mediaPath)) this.media = JSON.parse(fs.readFileSync(this.mediaPath, 'utf8')); } catch (e) { console.error("Media Load Error", e); }

        console.log("[DB] Initialized JSON Storage (Termux Support Mode)");
    }

    async _persist(type) {
        // Simple serialization queue
        this.queue = this.queue.then(async () => {
            try {
                if (type === 'kv') await fs.promises.writeFile(this.kvPath, JSON.stringify(this.kv, null, 2));
                if (type === 'store') await fs.promises.writeFile(this.storePath, JSON.stringify(this.store));
                if (type === 'media') await fs.promises.writeFile(this.mediaPath, JSON.stringify(this.media, null, 2));
            } catch (e) { console.error(`Failed to persist ${type}`, e); }
        });
        return this.queue;
    }

    async kvGet(key) { return this.kv[key] || null; }
    async kvSet(key, value) { this.kv[key] = value; await this._persist('kv'); }
    async kvDel(key) { delete this.kv[key]; await this._persist('kv'); }

    async saveItem(storeName, item, ownerId) {
        const idx = this.store.findIndex(i => i.id === item.id && i.storeName === storeName);
        const record = { id: item.id, storeName, ownerId, data: item, createdAt: Date.now() };
        if (idx >= 0) this.store[idx] = record;
        else this.store.push(record);
        await this._persist('store');
    }

    async syncItems(storeName, items, ownerId) {
        // Remove old items for this owner/store that are NOT in the new list
        const newIds = new Set(items.map(i => i.id));
        this.store = this.store.filter(i => {
            if (i.storeName === storeName && i.ownerId === ownerId) {
                return newIds.has(i.id);
            }
            return true;
        });

        // Add/Update new items
        items.forEach(item => {
            const idx = this.store.findIndex(i => i.id === item.id && i.storeName === storeName);
            const record = { id: item.id, storeName, ownerId, data: item, createdAt: Date.now() };
            if (idx >= 0) this.store[idx] = record;
            else this.store.push(record);
        });
        await this._persist('store');
    }

    async getItems(storeName, ownerId) {
        return this.store
            .filter(i => i.storeName === storeName && i.ownerId === ownerId)
            .map(i => i.data);
    }

    async deleteItem(storeName, id) {
        this.store = this.store.filter(i => !(i.storeName === storeName && i.id === id));
        await this._persist('store');
    }

    async clearStore(storeName) {
        this.store = this.store.filter(i => i.storeName !== storeName);
        await this._persist('store');
    }

    async saveMediaMetadata(meta) {
        this.media[meta.id] = { ...meta, createdAt: Date.now() };
        await this._persist('media');
    }

    async getMediaMetadata(id) {
        return this.media[id] || null;
    }

    async deleteMediaMetadata(id) {
        delete this.media[id];
        await this._persist('media');
    }
}

// --- FACTORY ---
export class Database {
    constructor(dataDir) {
        this.backend = null;
        this.dataDir = dataDir;
    }

    async init() {
        try {
            // Attempt to load sqlite3 dynamically
            const sqlite3 = (await import('sqlite3')).default;
            console.log("[DB] SQLite3 Native Module Loaded.");
            this.backend = new SqliteDatabase(this.dataDir, sqlite3);
        } catch (e) {
            console.warn("[DB] SQLite3 Native Module NOT found. Falling back to JSON Storage (Pure JS).");
            console.warn("[DB] Build Error Details:", e.message);
            this.backend = new JsonDatabase(this.dataDir);
        }
        return this.backend.init();
    }

    // Proxy methods to backend
    async kvGet(k) { return this.backend.kvGet(k); }
    async kvSet(k, v) { return this.backend.kvSet(k, v); }
    async kvDel(k) { return this.backend.kvDel(k); }
    async saveItem(s, i, o) { return this.backend.saveItem(s, i, o); }
    async syncItems(s, i, o) { return this.backend.syncItems(s, i, o); }
    async getItems(s, o) { return this.backend.getItems(s, o); }
    async deleteItem(s, id) { return this.backend.deleteItem(s, id); }
    async clearStore(s) { return this.backend.clearStore(s); }
    async saveMediaMetadata(m) { return this.backend.saveMediaMetadata(m); }
    async getMediaMetadata(id) { return this.backend.getMediaMetadata(id); }
    async deleteMediaMetadata(id) { return this.backend.deleteMediaMetadata(id); }
}
