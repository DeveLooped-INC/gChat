import { Post, Message, Contact, Group, NotificationItem, ConnectionRequest } from '../types';
import { networkService } from './networkService';

type StoreName = 'posts' | 'messages' | 'contacts' | 'groups' | 'notifications' | 'requests' | 'offline_packets';

class StorageService {

  private async waitForSocket(): Promise<any> {
    if (networkService.socket?.connected) {
      return networkService.socket;
    }

    return new Promise((resolve) => {
      let resolved = false;
      let checkInterval: NodeJS.Timeout | null = null;
      let timeoutId: NodeJS.Timeout | null = null;

      const onConnect = () => {
        if (resolved) return;
        resolved = true;
        if (checkInterval) clearInterval(checkInterval);
        if (timeoutId) clearTimeout(timeoutId);
        const s = networkService.socket;
        if (s) resolve(s);
      };

      checkInterval = setInterval(() => {
        const s = networkService.socket;
        if (s && s.connected) {
          onConnect();
        }
      }, 100);

      timeoutId = setTimeout(() => {
        if (!resolved) {
          if (checkInterval) clearInterval(checkInterval);
          const s = networkService.socket;
          console.warn("StorageService: Socket wait timeout. Proceeding anyway (offline mode).");
          resolve(s);
        }
      }, 5000);
    });
  }

  // --- GENERIC OPERATIONS ---

  public async saveItem<T extends { id: string }>(storeName: StoreName, item: T, ownerId: string): Promise<void> {
    const socket = await this.waitForSocket();
    return new Promise((resolve, reject) => {
      socket.emit('db:save', storeName, item, ownerId, (response: any) => {
        if (response.success) resolve();
        else reject(new Error(response.error));
      });
    });
  }

  public async syncState<T extends { id: string }>(storeName: StoreName, items: T[], ownerId: string): Promise<void> {
    const socket = await this.waitForSocket();
    return new Promise((resolve, reject) => {
      // console.log(`[Storage] Syncing ${storeName}, Count: ${items.length}`);
      socket.emit('db:sync', storeName, items, ownerId, (response: any) => {
        if (response.success) {
          // console.log(`[Storage] Sync Success for ${storeName}`);
          resolve();
        }
        else {
          console.error(`[Storage] Sync Error for ${storeName}:`, response.error);
          reject(new Error(response.error));
        }
      });
    });
  }

  public async getItems<T>(storeName: StoreName, ownerId: string): Promise<T[]> {
    const socket = await this.waitForSocket();
    return new Promise((resolve, reject) => {
      socket.emit('db:get-all', storeName, ownerId, (response: any) => {
        if (response.success) resolve(response.items);
        else reject(new Error(response.error));
      });
    });
  }

  public async deleteItem(storeName: StoreName, id: string): Promise<void> {
    const socket = await this.waitForSocket();
    return new Promise((resolve, reject) => {
      socket.emit('db:delete', storeName, id, (response: any) => {
        if (response.success) resolve();
        else reject(new Error(response.error));
      });
    });
  }

  public async clearStore(storeName: StoreName): Promise<void> {
    const socket = await this.waitForSocket();
    return new Promise((resolve, reject) => {
      socket.emit('db:clear', storeName, (response: any) => {
        if (response.success) resolve();
        else reject(new Error(response.error));
      });
    });
  }

  // --- SPECIALIZED OPERATIONS ---

  // Re-implemented to use getItems + deleteItem if needed, or we can add a specialized socket event.
  // For now, client-side logic over backend data.
  public async pruneEphemeralMessages(ownerId: string): Promise<number> {
    try {
      const messages = await this.getItems<Message>('messages', ownerId);
      const now = Date.now();
      const TTL = 60000;
      let deleted = 0;

      for (const msg of messages) {
        if (msg.isEphemeral && msg.read && (now - msg.timestamp > TTL)) {
          await this.deleteItem('messages', msg.id);
          deleted++;
        }
      }
      return deleted;
    } catch (e) {
      console.error("Prune error:", e);
      return 0;
    }
  }

  public async deleteEverything(): Promise<void> {
    // This is handled by factory reset on backend mostly, but if we need a call:
    // We can just clear all stores.
    const stores: StoreName[] = ['posts', 'messages', 'contacts', 'groups', 'notifications', 'requests'];
    for (const s of stores) {
      try { await this.clearStore(s); } catch (e) { }
    }
  }
}

export const storageService = new StorageService();
