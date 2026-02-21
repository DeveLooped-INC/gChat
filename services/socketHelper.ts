/**
 * Waits for the networkService socket to be connected.
 * Polls every 100ms with a 5-second timeout.
 * Returns the connected socket, or null if the timeout is reached.
 *
 * NOTE: Uses a lazy import of networkService to break a circular dependency:
 *   networkService → kv → socketHelper → networkService
 */
export async function waitForSocket(): Promise<any> {
    // Lazy import to avoid circular dependency at module initialization time.
    const { networkService } = await import('./networkService');

    const socket = networkService.socket;
    if (socket?.connected) return socket;

    return new Promise((resolve) => {
        let resolved = false;
        let checkInterval: ReturnType<typeof setInterval> | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const finish = (s: any) => {
            if (resolved) return;
            resolved = true;
            if (checkInterval) clearInterval(checkInterval);
            if (timeoutId) clearTimeout(timeoutId);
            resolve(s);
        };

        checkInterval = setInterval(() => {
            const s = networkService.socket;
            if (s?.connected) finish(s);
        }, 100);

        timeoutId = setTimeout(() => {
            if (!resolved) {
                console.warn('[socketHelper] Socket wait timeout (5s). Proceeding in offline mode.');
                finish(networkService.socket);
            }
        }, 5000);
    });
}
