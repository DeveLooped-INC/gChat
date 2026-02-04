
import { networkService } from './networkService';

class KVService {
    private async waitForSocket(): Promise<any> {
        // @ts-ignore
        const socket = networkService.socket;
        if (socket && socket.connected) return socket;

        return new Promise((resolve) => {
            const check = setInterval(() => {
                // @ts-ignore
                const s = networkService.socket;
                if (s && s.connected) {
                    clearInterval(check);
                    resolve(s);
                }
            }, 100);

            // Timeout after 5s
            setTimeout(() => {
                clearInterval(check);
                resolve(null);
            }, 5000);
        });
    }

    public async get<T>(key: string): Promise<T | null> {
        const socket = await this.waitForSocket();
        if (!socket) return null;

        return new Promise((resolve, reject) => {
            socket.emit('kv:get', key, (res: any) => {
                if (res && res.success) resolve(res.value as T);
                else resolve(null);
            });
        });
    }

    public async set<T>(key: string, value: T): Promise<void> {
        const socket = await this.waitForSocket();
        if (!socket) return; // Fail silently or throw?

        return new Promise((resolve, reject) => {
            socket.emit('kv:set', key, value, (res: any) => {
                if (res && res.success) resolve();
                else reject(res?.error);
            });
        });
    }

    public async del(key: string): Promise<void> {
        const socket = await this.waitForSocket();
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
