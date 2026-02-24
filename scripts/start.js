import { spawn, execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
import net from 'net';
dotenv.config({ override: true });

const NODE_ROLE = process.env.NODE_ROLE || 'MASTER';

console.log('--------------------------------------------------');
console.log('gChat Universal Launcher (Robust Mode)');
console.log(`Platform: ${process.platform} | Node Role: ${NODE_ROLE}`);
console.log('--------------------------------------------------');

// Check for Force Flag
const FORCE_KILL = process.argv.includes('--force');

// --- HELPER: SAFE PORT KILLER ---
// Returns true if the port was successfully cleared or was already free. Returns false if occupied by a non-gchat app.
const killPortSafely = (port) => {
    try {
        if (process.platform === 'win32') {
            const output = execSync(`netstat -ano | findstr :${port}`, { timeout: 3000 }).toString();
            const lines = output.trim().split('\n');
            for (let line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') {
                    // Check if it's our process before killing
                    const cmdOutput = execSync(`wmic process where processid=${pid} get commandline`, { timeout: 3000 }).toString().toLowerCase();
                    const isOurs = FORCE_KILL || cmdOutput.includes('gchat') || cmdOutput.includes('vite') || cmdOutput.includes('node server.js');
                    if (isOurs) {
                        try { execSync(`taskkill /PID ${pid} /F`, { timeout: 3000 }); console.log(`[Cleaner] Killed orphaned gChat PID ${pid} on port ${port}`); } catch (e) { }
                    } else {
                        console.log(`[Cleaner] Port ${port} is occupied by an external app (PID ${pid}). Leaving it alone.`);
                        return false;
                    }
                }
            }
        } else {
            // Linux/Mac: Use ss to find PID, then ps to check command
            try {
                const output = execSync(`ss -tlnp 'sport = :${port}'`, { timeout: 3000 }).toString();
                const lines = output.trim().split('\n');
                if (lines.length > 1) {
                    // Extract PID using regex
                    const match = output.match(/pid=(\d+)/);
                    if (match && match[1]) {
                        const pid = match[1];
                        const cmdOutput = execSync(`ps -p ${pid} -o command=`, { timeout: 3000 }).toString().toLowerCase();
                        const isOurs = FORCE_KILL || cmdOutput.includes('gchat') || cmdOutput.includes('vite') || cmdOutput.includes('server.js') || cmdOutput.includes('npm run web');

                        if (isOurs) {
                            try { execSync(`kill -9 ${pid}`, { timeout: 3000 }); console.log(`[Cleaner] Killed orphaned gChat PID ${pid} on port ${port}`); } catch (e) { }
                        } else {
                            console.log(`[Cleaner] Port ${port} is occupied by an external app (PID ${pid}). Leaving it alone.`);
                            return false;
                        }
                    } else if (FORCE_KILL) {
                        try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore', timeout: 3000 }); } catch (e) { }
                    } else {
                        console.log(`[Cleaner] Port ${port} is occupied by an unknown app. Leaving it alone.`);
                        return false;
                    }
                }
            } catch (e) {
                // ss/fuser not available or no process found - safe to continue
            }
        }
    } catch (e) {
        // Ignore errors if no process was found
    }
    return true;
};

// --- HELPER: FIND FREE PORT ---
const isPortFree = (port) => {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.listen(port, () => {
            srv.close(() => resolve(true));
        });
        srv.on('error', () => resolve(false));
    });
};

const findFreePort = async (startPort) => {
    let port = startPort;
    while (true) {
        if (await isPortFree(port)) return port;
        port++;
        if (port > 65535) throw new Error('No free ports available');
    }
};

// 1. PRE-FLIGHT CLEANUP & PORT ALLOCATION
// Wrap in top-level async IIFE (if commonJS was ever used, but we are modules so we can 'await' at top level technically, doing it directly)
console.log('[Launcher] Checking expected ports and cleaning up orphans...');
killPortSafely(3000); // Vite
killPortSafely(3001); // Backend Socket
killPortSafely(3456); // Public Tor Mesh Tunnel
killPortSafely(3457); // Private Tor Mesh Tunnel

// Compute definitive safe ports
const TARGET_API_PORT = parseInt(process.env.API_PORT || '3001', 10);
const TARGET_FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '3000', 10);

const safeApiPort = await findFreePort(TARGET_API_PORT);
const safeFrontendPort = await findFreePort(Math.max(TARGET_FRONTEND_PORT, safeApiPort + 1));

// Inject into environment before spawning
process.env.API_PORT = safeApiPort;
process.env.VITE_API_PORT = safeApiPort;
process.env.FRONTEND_PORT = safeFrontendPort;

if (safeApiPort !== TARGET_API_PORT || safeFrontendPort !== TARGET_FRONTEND_PORT) {
    console.log(`[Launcher] Detected port collisions with non-gChat apps. Automatically shifted ports to: API=${safeApiPort}, UI=${safeFrontendPort}`);
} else {
    console.log(`[Launcher] Ports OK. Using API=${safeApiPort}, UI=${safeFrontendPort}`);
}

// GLOBAL EIO CATCHER (Final safeguard)
process.on('uncaughtException', (err) => {
    if (err.code === 'EIO') return;
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.stdin.on('error', (err) => {
    if (err.code === 'EIO') return;
    console.error('Launcher Stdin Error:', err);
});

// 2. Start Backend
let server = null;
if (NODE_ROLE !== 'SLAVE_FRONTEND') {
    server = spawn('node', ['server.js'], {
        stdio: 'inherit',
        env: process.env
    });

    server.on('close', (code) => {
        console.log(`[Launcher] Backend exited with code ${code}. Shutting down...`);
        cleanup();
        process.exit(code || 0);
    });
}

// 3. Start Vite
let vite = null;
const forceUi = process.env.FORCE_UI !== 'false'; // Default to true unless explicitly false

if (NODE_ROLE === 'SLAVE_FRONTEND' || forceUi) {
    // We enable 'detached' on non-Windows to create a new Process Group.
    vite = spawn('npm run web', {
        stdio: ['ignore', 'inherit', 'inherit'],
        shell: true,
        detached: process.platform !== 'win32'
    });
}

// 4. Android / Termux Launch Logic
if (process.platform === 'android' || process.env.PREFIX?.includes('com.termux')) {
    console.log('📱 Android detected: Attempting to launch Chrome/Browser via Activity Manager...');
    setTimeout(() => {
        try {
            // Force open port
            const cmd = `am start -a android.intent.action.VIEW -d http://localhost:${safeFrontendPort}`;
            const child = spawn(cmd, { shell: true, stdio: 'ignore' });
            child.unref();
        } catch (e) {
            console.log(`⚠️ Could not auto-launch browser. Please manually open http://localhost:${safeFrontendPort}`);
        }
    }, 4000); // Wait longer for Vite to boot on mobile
}

// CLEANUP FUNCTION
const cleanup = () => {
    console.log('[Launcher] Cleaning up processes...');

    // Kill Backend
    if (server && !server.killed) {
        server.kill('SIGINT');
    }

    // Kill Vite Process Tree
    if (vite && !vite.killed) {
        if (process.platform === 'win32') {
            try { execSync(`taskkill /pid ${vite.pid} /T /F`); } catch (e) { }
        } else {
            // Kill process group (-pid)
            try { process.kill(-vite.pid, 'SIGKILL'); } catch (e) {
                // Fallback if detached failed
                try { vite.kill('SIGKILL'); } catch (e2) { }
            }
        }
    }
};

// Handle Termination Signals
process.on('SIGINT', () => {
    console.log('\n[Launcher] Caught interrupt signal');
    cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
});

process.on('exit', () => {
    cleanup();
});
