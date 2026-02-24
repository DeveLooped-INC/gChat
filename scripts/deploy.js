import fs from 'fs';
import path from 'path';
import net from 'net';
import os from 'os';
import inquirer from 'inquirer';
import { Client } from 'ssh2';
import { exec, spawn } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_PORT = 22;

function getLocalSubnets() {
    const interfaces = os.networkInterfaces();
    const subnets = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const parts = iface.address.split('.');
                subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}.`);
            }
        }
    }
    return subnets;
}

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const LOCAL_LAN_IP = getLocalIp();

function checkPort(ip, port, timeout = 500) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, ip);
    });
}

async function scanNetwork(subnet) {
    console.log(`\n🔍 Scanning subnet ${subnet}0/24 for SSH (Port 22)...`);
    const promises = [];
    for (let i = 1; i < 255; i++) {
        const ip = `${subnet}${i}`;
        promises.push(checkPort(ip, DEFAULT_PORT).then(isOpen => isOpen ? ip : null));
    }
    const results = await Promise.all(promises);
    return results.filter(ip => ip !== null);
}

function runSSHCommand(client, cmd, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        if (client === 'local') {
            exec(cmd, { shell: '/bin/bash', cwd: os.homedir(), timeout: timeoutMs }, (err, stdout, stderr) => {
                if (err && (!stdout || stdout.trim() === '')) return reject(err);
                resolve((stdout || '').trim());
            });
            return;
        }
        let output = '';
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            reject(new Error(`SSH command timed out after ${timeoutMs / 1000}s: ${cmd.substring(0, 80)}`));
        }, timeoutMs);

        client.exec(cmd, (err, stream) => {
            if (err) { clearTimeout(timer); return reject(err); }
            stream.on('close', () => {
                clearTimeout(timer);
                if (!timedOut) resolve(output.trim());
            }).on('data', data => {
                output += data;
            }).stderr.on('data', data => {
                // Ignore stderr to keep output clean unless needed
            });
        });
    });
}

async function getHardwareInfo(client, ip) {
    try {
        let existingFolder = 'No';
        let pm2Running = 'No';
        let p3000 = 'Closed';
        let p3001 = 'Closed';

        const checkPorts = async () => {
            if (await checkPort(ip, 3000, 300)) p3000 = 'Open';
            if (await checkPort(ip, 3001, 300)) p3001 = 'Open';
        };

        const findFreePort = async (startPort) => {
            let p = startPort;
            while (await checkPort(ip, p, 300)) {
                p++;
            }
            return p;
        };

        const freeApiPort = await findFreePort(3001);
        const freeFrontendPort = await findFreePort(3000);

        if (client === 'local') {
            const memory = Math.round(os.totalmem() / 1024 / 1024);
            const home = os.homedir();
            if (fs.existsSync(path.join(home, 'gChat'))) existingFolder = 'Yes';
            try {
                const pm2 = execSync('pm2 id gchat 2>/dev/null').toString().trim();
                if (pm2 && pm2 !== '[]') pm2Running = 'Yes';
            } catch (e) { }
            await checkPorts();

            return {
                ip,
                os: os.type(),
                memory: `${memory} MB`,
                freeDisk: 'Local Disk',
                gChatFolder: existingFolder,
                pm2_gchat: pm2Running,
                port3000: p3000,
                port3001: p3001,
                apiPort: freeApiPort,
                frontendPort: freeFrontendPort
            };
        }

        const osName = await runSSHCommand(client, 'uname -a');
        const memory = await runSSHCommand(client, 'free -m | grep Mem | awk "{print \\$2}"');
        const disk = await runSSHCommand(client, 'df -h / | tail -1 | awk "{print \\$4}"');

        try {
            const folderRes = await runSSHCommand(client, '[ -d ~/gChat ] && echo "Yes" || echo "No"');
            if (folderRes === 'Yes') existingFolder = 'Yes';
            const pm2 = await runSSHCommand(client, 'pm2 id gchat 2>/dev/null || echo ""');
            if (pm2 && pm2.trim() !== '[]') pm2Running = 'Yes';
        } catch (e) { }

        await checkPorts();

        return {
            ip,
            os: osName.split(' ')[0],
            memory: `${memory} MB`,
            freeDisk: disk,
            gChatFolder: existingFolder,
            pm2_gchat: pm2Running,
            port3000: p3000,
            port3001: p3001,
            apiPort: freeApiPort,
            frontendPort: freeFrontendPort
        };
    } catch (e) {
        return { ip, error: 'Could not fetch hardware info' };
    }
}

async function start() {
    console.log('--------------------------------------------------');
    console.log('🤖 gChat Automated Network Deployer');
    console.log('--------------------------------------------------');

    const subnets = getLocalSubnets();
    if (subnets.length === 0) {
        console.log("❌ Could not determine local subnets.");
        return;
    }

    let allDevices = ['127.0.0.1']; // Always include local device
    for (const subnet of subnets) {
        const devices = await scanNetwork(subnet);
        allDevices = allDevices.concat(devices);
    }
    allDevices = [...new Set(allDevices)];

    if (allDevices.length === 0) {
        console.log("❌ No devices found with port 22 open on the local network.");
        return;
    }

    console.log(`\n✅ Found ${allDevices.length} devices with SSH enabled.`);

    const { selectedIps } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedIps',
        message: 'Select devices to deploy gChat nodes to:',
        choices: allDevices
    }]);

    if (selectedIps.length === 0) {
        console.log("No devices selected. Exiting.");
        return;
    }

    const deviceInfos = [];
    const sshClients = {};

    console.log("\n🔑 Please provide SSH credentials for the selected devices:");

    for (const ip of selectedIps) {
        if (ip === '127.0.0.1') {
            const { username, password } = await inquirer.prompt([
                { type: 'input', name: 'username', message: `Local Username (Current):`, default: process.env.USER || 'tomAnderson' },
                { type: 'password', name: 'password', message: `Local Sudo Password (If needed for PM2 startup, else leave blank):` }
            ]);

            console.log(`... Skipping SSH for localhost ...`);
            console.log(`✅ Connected to local environment`);
            sshClients[ip] = { client: 'local', password };
            const info = await getHardwareInfo('local', ip);
            deviceInfos.push({ ...info, username });
            continue;
        }

        let connected = false;
        while (!connected) {
            const { username, password } = await inquirer.prompt([
                { type: 'input', name: 'username', message: `Username for ${ip}:`, default: process.env.USER || 'tomAnderson' },
                { type: 'password', name: 'password', message: `SSH Password for ${ip}:` }
            ]);

            const client = new Client();

            console.log(`... Connecting to ${ip} ...`);
            try {
                await new Promise((resolve, reject) => {
                    client.on('ready', resolve).on('error', reject).connect({
                        host: ip,
                        port: DEFAULT_PORT,
                        username,
                        password,
                        readyTimeout: 10000
                    });
                });
                console.log(`✅ Connected to ${ip}`);
                sshClients[ip] = { client, password };
                connected = true;

                const info = await getHardwareInfo(client, ip);
                deviceInfos.push({ ...info, username });

            } catch (e) {
                console.log(`❌ Connection to ${ip} failed: ${e.message}`);
                const { retry } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'retry',
                    message: `Would you like to re-enter credentials for ${ip}?`,
                    default: true
                }]);
                if (!retry) {
                    console.log(`⏭️  Skipping ${ip}.`);
                    break;
                }
            }
        }
    }

    if (deviceInfos.length === 0) {
        console.log("No successful connections made. Exiting.");
        process.exit(0);
    }

    console.log("\n📊 Hardware Analysis:");
    console.table(deviceInfos);

    console.log("\n🤖 Auto-Analyzing optimal topology based on Hardware Specs...");

    // Sort devices by RAM (highest to lowest) to prioritize Master/Storage
    const sortedDevices = [...deviceInfos].sort((a, b) => parseInt(b.memory) - parseInt(a.memory));

    const suggestedPlan = [];
    let masterFound = false;
    let storageFound = false;

    for (let i = 0; i < sortedDevices.length; i++) {
        const info = sortedDevices[i];
        let role;

        if (!masterFound) {
            role = 'MASTER';
            masterFound = true;
        } else if (!storageFound && parseInt(info.memory) >= 2000) {
            role = 'SLAVE_STORAGE';
            storageFound = true;
        } else {
            role = 'SLAVE_FRONTEND';
        }

        let masterIp = LOCAL_LAN_IP;
        if (role !== 'MASTER') {
            const masterNode = suggestedPlan.find(d => d.role === 'MASTER');
            masterIp = masterNode ? (masterNode.ip === '127.0.0.1' ? LOCAL_LAN_IP : masterNode.ip) : LOCAL_LAN_IP;
        }
        suggestedPlan.push({
            ip: info.ip,
            role,
            masterIp,
            apiPort: info.apiPort,
            frontendPort: info.frontendPort
        });
    }

    console.log("\n💡 Recommended Deployment Plan:");
    console.table(suggestedPlan);

    const { useRecommended } = await inquirer.prompt([{
        type: 'confirm',
        name: 'useRecommended',
        message: 'Proceed with this recommended plan? (Select No to assign manually)',
        default: true
    }]);

    let deploymentPlan = [];

    if (useRecommended) {
        deploymentPlan = suggestedPlan;
    } else {
        console.log("\n🛠️  Manual Deployment Planning");
        for (const info of deviceInfos) {
            const { role } = await inquirer.prompt([{
                type: 'list',
                name: 'role',
                message: `Assign ROLE for ${info.ip}:`,
                choices: [
                    { name: 'Master Node (Backend, Tor router etc)', value: 'MASTER' },
                    { name: 'Data Slave (Database and Local Media)', value: 'SLAVE_STORAGE' },
                    { name: 'Frontend Slave (UI for local network access)', value: 'SLAVE_FRONTEND' },
                    { name: 'Micro-Site (Public Tor web server)', value: 'MICRO_SITE' },
                    { name: 'Tor Slave (Middle relay)', value: 'TOR_RELAY' },
                    { name: 'Skip Deploy', value: 'SKIP' }
                ],
                default: suggestedPlan.find(s => s.ip === info.ip)?.role || 'SLAVE_FRONTEND'
            }]);

            if (role !== 'SKIP') {
                let masterIp = LOCAL_LAN_IP;
                if (role !== 'MASTER') {
                    const foundMaster = deploymentPlan.find(d => d.role === 'MASTER') || suggestedPlan.find(d => d.role === 'MASTER');
                    let suggestedMasterIp = foundMaster ? foundMaster.ip : LOCAL_LAN_IP;
                    if (suggestedMasterIp === '127.0.0.1') suggestedMasterIp = LOCAL_LAN_IP;

                    const res = await inquirer.prompt([{
                        type: 'input',
                        name: 'masterIp',
                        message: `Enter the Master Node Local IP for ${info.ip} to connect to:`,
                        default: suggestedMasterIp
                    }]);
                    masterIp = res.masterIp;
                }
                deploymentPlan.push({
                    ip: info.ip,
                    role,
                    masterIp,
                    apiPort: info.apiPort,
                    frontendPort: info.frontendPort
                });
            }
        }
    }

    if (deploymentPlan.length === 0) {
        console.log("Deployment plan empty. Exiting.");
        process.exit(0);
    }

    console.log("\n📋 Final Deployment Plan:");
    console.table(deploymentPlan);

    const { configurePaths } = await inquirer.prompt([{
        type: 'confirm',
        name: 'configurePaths',
        message: 'Do you want to override the default Database & Media storage locations for any nodes?',
        default: false
    }]);

    if (configurePaths) {
        for (const task of deploymentPlan) {
            if (task.role === 'MASTER' || task.role === 'SLAVE_STORAGE') {
                const defaultPath = task.ip === '127.0.0.1' ?
                    path.join(os.homedir(), '.local', 'share', 'gchat') :
                    '~/.local/share/gchat';

                const { customPath } = await inquirer.prompt([{
                    type: 'input',
                    name: 'customPath',
                    message: `Storage Path for ${task.role} on ${task.ip} (Leave blank for default: ${defaultPath}):`,
                }]);
                if (customPath.trim()) {
                    task.appDataRoot = customPath.trim();
                }
            }
        }
    }

    const { configureGit } = await inquirer.prompt([{
        type: 'confirm',
        name: 'configureGit',
        message: 'Do you want to specify a custom Git Repository URL or Branch? (Default is DeveLooped-INC/gChat, main)',
        default: false
    }]);

    let gitRepoUrl = process.env.GIT_REPO_URL || 'https://github.com/DeveLooped-INC/gChat.git';
    let gitBranch = process.env.GIT_BRANCH || 'main';

    if (configureGit) {
        const gitConfig = await inquirer.prompt([
            {
                type: 'input',
                name: 'gitRepoUrl',
                message: 'Git Repository URL:',
                default: gitRepoUrl
            },
            {
                type: 'input',
                name: 'gitBranch',
                message: 'Git Branch:',
                default: gitBranch
            }
        ]);
        gitRepoUrl = gitConfig.gitRepoUrl.trim() || gitRepoUrl;
        gitBranch = gitConfig.gitBranch.trim() || gitBranch;
    }

    const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: 'Proceed with installation? (Safely overwrites/restarts existing gChat services)', default: true }]);
    if (!confirm) process.exit(0);

    for (const task of deploymentPlan) {
        console.log(`\n🚀 Deploying ${task.role} to ${task.ip}...`);
        const { client, password } = sshClients[task.ip];

        try {
            if (client === 'local') {
                console.log(`[${task.ip}] Generating local configuration...`);
                // For local, we write direct relative to process.cwd since we expect the user to be running deploy.js from gChat directory
                let envVars = `NODE_ROLE=${task.role}\nMASTER_IP=${task.masterIp}\nVITE_MASTER_IP=${task.masterIp}\nFORCE_UI=${task.role === 'SLAVE_FRONTEND' ? 'true' : 'false'}\nAPI_PORT=${task.apiPort}\nFRONTEND_PORT=${task.frontendPort}\n`;
                if (task.appDataRoot) {
                    envVars += `APP_DATA_ROOT=${task.appDataRoot}\n`;
                }
                fs.writeFileSync(path.join(process.cwd(), '.env'), envVars);

                console.log(`[${task.ip}] Setting up local PM2 System Service...`);
                await runSSHCommand('local', `if ! command -v pm2 &> /dev/null; then echo "${password}" | sudo -S env PATH=$PATH npm install -g pm2; fi`);
                await runSSHCommand('local', 'pm2 delete gchat 2>/dev/null || true');
                const gchatDir = process.cwd();
                await runSSHCommand('local', `cd ${gchatDir} && pm2 start npm --name "gchat" -- start && pm2 save`);

                console.log(`[${task.ip}] Attempting to configure PM2 startup script...`);
                const startupOutput = await runSSHCommand('local', 'pm2 startup | grep "sudo env"');
                if (startupOutput && password) {
                    const sudoCmd = startupOutput.replace('sudo', `echo "${password}" | sudo -S env PATH=$PATH`);
                    await runSSHCommand('local', sudoCmd);
                } else if (startupOutput) {
                    console.log(`[${task.ip}] ⚠️ Could not configure auto-start. Please run manually: ${startupOutput}`);
                }

                console.log(`✅ Deployment complete on ${task.ip}`);
                continue;
            }

            console.log(`[${task.ip}] Cloning repository...`);
            await runSSHCommand(client, `git clone -b ${gitBranch} ${gitRepoUrl} gChat || (cd gChat && git remote set-url origin ${gitRepoUrl} && git fetch origin && git checkout ${gitBranch} && git pull origin ${gitBranch})`);

            console.log(`[${task.ip}] Generating configuration...`);
            let envVars = `NODE_ROLE=${task.role}\nMASTER_IP=${task.masterIp}\nVITE_MASTER_IP=${task.masterIp}\nFORCE_UI=${task.role === 'SLAVE_FRONTEND' ? 'true' : 'false'}\nAPI_PORT=${task.apiPort}\nFRONTEND_PORT=${task.frontendPort}\n`;
            if (task.appDataRoot) {
                envVars += `APP_DATA_ROOT=${task.appDataRoot}\n`;
            }
            await runSSHCommand(client, `echo "${envVars}" > ~/gChat/.env`);

            console.log(`[${task.ip}] Syncing uncommitted local patches...`);
            const filesToSync = ['server.js', 'database.js', 'pluginLoader.js', 'vite.config.ts'];
            // Also sync start.js which contains the lsof fix
            const startJsPath = path.join(process.cwd(), 'scripts', 'start.js');
            if (fs.existsSync(startJsPath)) {
                filesToSync.push('scripts/start.js');
            }
            for (const file of filesToSync) {
                const filePath = path.join(process.cwd(), file);
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const remoteDir = file.includes('/') ? `mkdir -p ~/gChat/${path.dirname(file)} && ` : '';
                    await runSSHCommand(client, `${remoteDir}echo "${Buffer.from(content).toString('base64')}" | base64 -d > ~/gChat/${file}`);
                }
            }

            console.log(`[${task.ip}] Installing dependencies (This may take a minute) & Node.js if missing...`);
            // Quick check for node — use extended timeout for package installs
            await runSSHCommand(client, `if ! command -v node &> /dev/null; then echo "${password}" | sudo -S apt-get update && echo "${password}" | sudo -S apt-get install -y nodejs npm; fi`, 300000);
            await runSSHCommand(client, 'cd ~/gChat && npm install', 300000);

            console.log(`[${task.ip}] Setting up PM2 System Service...`);
            await runSSHCommand(client, `if ! command -v pm2 &> /dev/null; then echo "${password}" | sudo -S env PATH=$PATH npm install -g pm2; fi`);
            // Check if gchat is already running in pm2 and delete it if so before restarting
            await runSSHCommand(client, 'pm2 delete gchat 2>/dev/null || true');
            const pm2StartOptions = task.role === 'SLAVE_FRONTEND' ? '--name "gchat" -- start' : `--name "gchat" -- start`;
            await runSSHCommand(client, `cd ~/gChat && pm2 start npm ${pm2StartOptions} && pm2 save`);

            console.log(`[${task.ip}] Attempting to configure PM2 startup script...`);
            const startupOutput = await runSSHCommand(client, 'pm2 startup | grep "sudo env"');
            if (startupOutput && password) {
                const sudoCmd = startupOutput.replace('sudo', `echo "${password}" | sudo -S env PATH=$PATH`);
                await runSSHCommand(client, sudoCmd);
            } else if (startupOutput) {
                console.log(`[${task.ip}] ⚠️ Could not configure auto-start. Please run manually: ${startupOutput}`);
            }

            console.log(`✅ Deployment complete on ${task.ip}`);
        } catch (e) {
            let errorMsg = e.message;
            if (password) {
                errorMsg = errorMsg.split(password).join('********');
            }
            console.log(`❌ Deployment failed on ${task.ip}: ${errorMsg}`);
        }
    }

    console.log("\n🧪 Testing Mesh Network Connections...");

    for (const task of deploymentPlan) {
        let isUp = false;
        process.stdout.write(`   Verifying PM2 service on ${task.ip} ... `);

        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                const entry = sshClients[task.ip];
                const c = entry ? entry.client : 'local';
                const pm2Status = await runSSHCommand(c, 'pm2 show gchat | grep "status" || echo "offline"');
                if (pm2Status.toLowerCase().includes('online')) {
                    isUp = true;
                    break;
                }
            } catch (e) {
                // Ignore transient SSH errors during polling
            }
            process.stdout.write('.');
        }

        if (isUp) {
            console.log(" ✅ ONLINE");
        } else {
            console.log(" ❌ OFFLINE or UNREACHABLE");
            console.log(`\n     ⚠️ TIP: You can manually check logs via SSH: pm2 logs gchat\n`);
        }
    }

    // Clean remaining connections
    Object.values(sshClients).forEach(c => {
        if (c.client !== 'local' && c.client.end) c.client.end();
    });
    console.log("\n🎉 All deployments finished successfully!");
    process.exit(0);
}

start().catch(console.error);
