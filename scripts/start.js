import { spawn, execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const NODE_ROLE = process.env.NODE_ROLE || 'MASTER';

console.log('--------------------------------------------------');
console.log('gChat Universal Launcher (Robust Mode)');
console.log(`Platform: ${process.platform} | Node Role: ${NODE_ROLE}`);
console.log('--------------------------------------------------');

// Check for Force Flag
const FORCE_KILL = process.argv.includes('--force');

// --- HELPER: KILL PORT HOGS ---
const killPort = (port) => {
    try {
        if (process.platform === 'win32') {
            const output = execSync(`netstat -ano | findstr :${port}`, { timeout: 3000 }).toString();
            const lines = output.trim().split('\n');
            lines.forEach(line => {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') {
                    if (FORCE_KILL) {
                        try {
                            execSync(`taskkill /PID ${pid} /F`, { timeout: 3000 });
                            console.log(`[Cleaner] Killed PID ${pid} on port ${port}`);
                        } catch (e) { }
                    } else {
                        console.warn(`[WARNING] Port ${port} is occupied by PID ${pid}. Use --force to auto-kill.`);
                    }
                }
            });
        } else {
            // Linux/Mac: Use ss (faster & more reliable than lsof) with a timeout
            try {
                const output = execSync(`ss -tlnp 'sport = :${port}'`, { timeout: 3000 }).toString();
                const inUse = output.trim().split('\n').length > 1; // Header + at least 1 result

                if (inUse) {
                    if (FORCE_KILL) {
                        try {
                            execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore', timeout: 3000 });
                            console.log(`[Cleaner] Cleared port ${port}`);
                        } catch (e) { }
                    } else {
                        console.warn(`[WARNING] Port ${port} is in use. Run with --force to auto-kill, or free it manually.`);
                    }
                }
            } catch (e) {
                // ss/fuser not available or no process found - safe to continue
            }
        }
    } catch (e) {
        // Ignore errors if no process was found
    }
};

// 1. PRE-FLIGHT CLEANUP
console.log('[Launcher] Checking ports 3000, 3001, 3002...');
killPort(3000); // Vite
killPort(3001); // Backend Socket
killPort(3002); // Alternative Vite

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
            // Force open port 3000
            const cmd = 'am start -a android.intent.action.VIEW -d http://localhost:3000';
            const child = spawn(cmd, { shell: true, stdio: 'ignore' });
            child.unref();
        } catch (e) {
            console.log('⚠️ Could not auto-launch browser. Please manually open http://localhost:3000');
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
