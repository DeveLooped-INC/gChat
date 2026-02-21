import { waitForSocket } from './socketHelper';

class KVService {
    public async get<T>(key: string): Promise<T | null> {
        const socket = await waitForSocket();
        if (!socket) return null;

        return new Promise((resolve, reject) => {
            socket.emit('kv:get', key, (res: any) => {
                if (res && res.success) resolve(res.value as T);
                else resolve(null);
            });
        });
    }

    public async set<T>(key: string, value: T): Promise<void> {
        const socket = await waitForSocket();
        if (!socket) return;

        return new Promise((resolve, reject) => {
            socket.emit('kv:set', key, value, (res: any) => {
                if (res && res.success) resolve();
                else reject(res?.error);
            });
        });
    }

    public async del(key: string): Promise<void> {
        const socket = await waitForSocket();
        if (!socket) return;

        return new Promise((resolve, reject) => {
            socket.emit('kv:del', key, (res: any) => {
                if (res && res.success) resolve();
                else reject(res?.error);
            });
        });
    }
}

export const kvService = new KVService();
