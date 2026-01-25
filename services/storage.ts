
import { Post, Message, Contact, Group, NotificationItem, ConnectionRequest } from '../types';

const DB_NAME = 'gChat_Data';
const DB_VERSION = 2;

type StoreName = 'posts' | 'messages' | 'contacts' | 'groups' | 'notifications' | 'requests' | 'offline_packets';

class StorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create stores with 'id' as keyPath
        const stores: StoreName[] = ['posts', 'messages', 'contacts', 'groups', 'notifications', 'requests', 'offline_packets'];
        
        stores.forEach(store => {
          if (!db.objectStoreNames.contains(store)) {
            const objectStore = db.createObjectStore(store, { keyPath: 'id' });
            // Add index for querying by 'localOwnerId' to support multi-user switching
            if (!objectStore.indexNames.contains('localOwnerId')) {
                objectStore.createIndex('localOwnerId', 'localOwnerId', { unique: false });
            }
          }
        });
      };

      request.onsuccess = () => resolve(request.result);
    });

    return this.dbPromise;
  }

  // --- GENERIC OPERATIONS ---

  public async saveItem<T extends { id: string }>(storeName: StoreName, item: T, ownerId: string): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const record = { ...item, localOwnerId: ownerId };
      const request = store.put(record);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Replaces saveBulk with a synchronization method that handles deletions
  public async syncState<T extends { id: string }>(storeName: StoreName, items: T[], ownerId: string): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const index = store.index('localOwnerId');
      
      // Get all existing keys for this user to identify what needs to be deleted
      const request = index.getAllKeys(IDBKeyRange.only(ownerId));

      request.onsuccess = () => {
        const existingIds = request.result; // Array of keys (ids)
        const newItemIds = new Set(items.map(i => i.id));

        // 1. Delete removed items
        existingIds.forEach((existingId) => {
            if (!newItemIds.has(existingId.toString())) {
                store.delete(existingId);
            }
        });

        // 2. Put (Update/Insert) current items
        items.forEach(item => {
            store.put({ ...item, localOwnerId: ownerId });
        });
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getItems<T>(storeName: StoreName, ownerId: string): Promise<T[]> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index('localOwnerId');
      const request = index.getAll(ownerId);

      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  public async deleteItem(storeName: StoreName, id: string): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async clearStore(storeName: StoreName): Promise<void> {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  }

  // --- SPECIALIZED OPERATIONS ---

  public async pruneEphemeralMessages(ownerId: string): Promise<number> {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction('messages', 'readwrite');
          const store = tx.objectStore('messages');
          const index = store.index('localOwnerId');
          const request = index.openCursor(IDBKeyRange.only(ownerId));
          
          let deletedCount = 0;
          const now = Date.now();
          // Ephemeral TTL: 60 seconds after being read
          const TTL = 60000; 

          request.onsuccess = (e) => {
              const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
              if (cursor) {
                  const msg = cursor.value as Message;
                  if (msg.isEphemeral && msg.read && (now - msg.timestamp > TTL)) {
                      cursor.delete();
                      deletedCount++;
                  }
                  cursor.continue();
              } else {
                  resolve(deletedCount);
              }
          };
          request.onerror = () => reject(request.error);
      });
  }

  // --- SYSTEM OPERATIONS ---

  public async deleteEverything(): Promise<void> {
      if (this.dbPromise) {
          const db = await this.dbPromise;
          db.close();
          this.dbPromise = null;
      }
      return new Promise((resolve, reject) => {
          const req = indexedDB.deleteDatabase(DB_NAME);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          req.onblocked = () => console.warn("Delete blocked: Close other tabs.");
      });
  }
}

export const storageService = new StorageService();
