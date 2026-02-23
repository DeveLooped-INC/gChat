import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

console.log("[DEBUG] Evaluating pluginLoader.js imports...");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGINS_DIR = path.join(__dirname, 'plugins');

// Plugin Registry
const loadedPlugins = [];

export async function loadPlugins(app, io, db) {
    if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true });
        // Create an example plugin
        const exampleDir = path.join(PLUGINS_DIR, 'hello-world');
        fs.mkdirSync(exampleDir, { recursive: true });
        fs.writeFileSync(path.join(exampleDir, 'index.js'), `
export default {
    name: 'Hello World Plugin',
    version: '1.0.0',
    onInit: ({ app, io, db }) => {
        console.log('[Plugin: Hello World] Initialized!');
    },
    onExpressRoute: (app) => {
        app.get('/api/plugin/hello', (req, res) => res.json({ message: 'Hello from plugin' }));
    },
    onSocketConnection: (socket, io) => {
        socket.on('hello-plugin', (cb) => {
            if(cb) cb({ reply: 'Hello from the backend plugin!' });
        });
    }
};
`);
    }

    try {
        const pluginFolders = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const folder of pluginFolders) {
            const indexPath = path.join(PLUGINS_DIR, folder, 'index.js');
            if (fs.existsSync(indexPath)) {
                try {
                    // Dynamic import needs file:// protocol on Windows if absolute path
                    const pluginModule = await import(`file://${indexPath}`);
                    const plugin = pluginModule.default || pluginModule;

                    if (!plugin.name) throw new Error("Plugin missing 'name' property.");

                    // Run Hooks
                    if (typeof plugin.onInit === 'function') {
                        plugin.onInit({ app, io, db });
                    }
                    if (typeof plugin.onExpressRoute === 'function') {
                        plugin.onExpressRoute(app);
                    }

                    loadedPlugins.push(plugin);
                    console.log(`[Plugin Loader] Loaded plugin: ${plugin.name} v${plugin.version || 'unknown'}`);
                } catch (e) {
                    console.error(`[Plugin Loader] Failed to load plugin ${folder}:`, e);
                }
            }
        }
    } catch (e) {
        console.error('[Plugin Loader] Error reading plugins directory:', e);
    }
}

export function registerSocketHooks(socket, io) {
    for (const plugin of loadedPlugins) {
        if (typeof plugin.onSocketConnection === 'function') {
            try {
                plugin.onSocketConnection(socket, io);
            } catch (e) {
                console.error(`[Plugin Loader] Error running socket hook for ${plugin.name}:`, e);
            }
        }
    }
}
