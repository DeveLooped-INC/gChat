
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const DB_FILE = 'gchat.db';

export class Database {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.dbPath = path.join(dataDir, DB_FILE);
        this.db = null;
        this.txQueue = Promise.resolve();
    }

    async init() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) return reject(err);
                this.createTables().then(resolve).catch(reject);
            });
        });
    }

    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS store_items (
                id TEXT PRIMARY KEY,
                store_name TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                data TEXT,
                created_at INTEGER
            )`,
            `CREATE INDEX IF NOT EXISTS idx_store_items_owner ON store_items (store_name, owner_id)`,
            `CREATE TABLE IF NOT EXISTS media_files (
                id TEXT PRIMARY KEY,
                mime_type TEXT,
                size INTEGER,
                filename TEXT,
                access_key TEXT,
                owner_id TEXT,
                created_at INTEGER
            )`
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

    // --- KV STORE ---

    async kvGet(key) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT value FROM kv_store WHERE key = ?", [key], (err, row) => {
                if (err) reject(err);
                else resolve(row ? JSON.parse(row.value) : null);
            });
        });
    }

    async kvSet(key, value) {
        return new Promise((resolve, reject) => {
            const valStr = JSON.stringify(value);
            this.db.run("INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)", [key, valStr], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async kvDel(key) {
        return new Promise((resolve, reject) => {
            this.db.run("DELETE FROM kv_store WHERE key = ?", [key], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // --- OBJECT STORE (IndexedDB Replacement) ---

    async saveItem(storeName, item, ownerId) {
        return new Promise((resolve, reject) => {
            const query = `INSERT OR REPLACE INTO store_items (id, store_name, owner_id, data, created_at) VALUES (?, ?, ?, ?, ?)`;
            const params = [
                item.id,
                storeName,
                ownerId,
                JSON.stringify(item),
                Date.now()
            ];
            this.db.run(query, params, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async syncItems(storeName, items, ownerId) {
        // Serialization wrapper to prevent "SQLITE_ERROR: cannot start a transaction within a transaction"
        this.txQueue = this.txQueue.then(() => {
            return new Promise((resolve, reject) => {
                this.db.serialize(() => {
                    this.db.run("BEGIN TRANSACTION");

                    this.db.all("SELECT id FROM store_items WHERE store_name = ? AND owner_id = ?", [storeName, ownerId], (err, rows) => {
                        if (err) {
                            this.db.run("ROLLBACK");
                            return reject(err);
                        }

                        const existingIds = new Set(rows.map(r => r.id));
                        const newIds = new Set(items.map(i => i.id));

                        const toDelete = [...existingIds].filter(id => !newIds.has(id));

                        const stmtDel = this.db.prepare("DELETE FROM store_items WHERE id = ?");
                        toDelete.forEach(id => stmtDel.run(id));
                        stmtDel.finalize();

                        const stmtPut = this.db.prepare("INSERT OR REPLACE INTO store_items (id, store_name, owner_id, data, created_at) VALUES (?, ?, ?, ?, ?)");
                        items.forEach(item => {
                            stmtPut.run(item.id, storeName, ownerId, JSON.stringify(item), Date.now());
                        });
                        stmtPut.finalize();

                        this.db.run("COMMIT", (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                });
            });
        }).catch(err => {
            console.error(`[DB] Sync Transaction Error (${storeName}):`, err);
            // We don't re-throw to break the queue for subsequent tasks, 
            // but we might want the caller to know. 
            // However, this.txQueue returns the chain. 
        });

        return this.txQueue;
    }

    async getItems(storeName, ownerId) {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT data FROM store_items WHERE store_name = ? AND owner_id = ?", [storeName, ownerId], (err, rows) => {
                if (err) reject(err);
                else {
                    const items = rows.map(r => JSON.parse(r.data));
                    resolve(items);
                }
            });
        });
    }

    async deleteItem(storeName, id) {
        return new Promise((resolve, reject) => {
            this.db.run("DELETE FROM store_items WHERE store_name = ? AND id = ?", [storeName, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async clearStore(storeName) {
        return new Promise((resolve, reject) => {
            this.db.run("DELETE FROM store_items WHERE store_name = ?", [storeName], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // --- MEDIA ---

    async saveMediaMetadata(meta) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO media_files (id, mime_type, size, filename, access_key, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [meta.id, meta.mimeType, meta.size, meta.filename, meta.accessKey, meta.ownerId, Date.now()],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async getMediaMetadata(id) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT * FROM media_files WHERE id = ?", [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async deleteMediaMetadata(id) {
        return new Promise((resolve, reject) => {
            this.db.run("DELETE FROM media_files WHERE id = ?", [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}
