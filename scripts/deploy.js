import fs from 'fs';
import path from 'path';
import net from 'net';
import os from 'os';
import inquirer from 'inquirer';
import { Client } from 'ssh2';
import { exec, spawn } from 'child_process';

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

function runSSHCommand(client, cmd) {
    return new Promise((resolve, reject) => {
        client.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let output = '';
            stream.on('close', () => resolve(output.trim())).on('data', data => {
                output += data;
            }).stderr.on('data', data => {
                // Ignore stderr to keep output clean unless needed
            });
        });
    });
}

async function getHardwareInfo(client, ip) {
    try {
        const osName = await runSSHCommand(client, 'uname -a');
        const memory = await runSSHCommand(client, 'free -m | grep Mem | awk "{print \\$2}"');
        const disk = await runSSHCommand(client, 'df -h / | tail -1 | awk "{print \\$4}"');

        return {
            ip,
            os: osName.split(' ')[0],
            memory: `${memory} MB`,
            freeDisk: disk
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

    let allDevices = [];
    for (const subnet of subnets) {
        const devices = await scanNetwork(subnet);
        allDevices = allDevices.concat(devices);
    }

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
        const { username, authType } = await inquirer.prompt([
            { type: 'input', name: 'username', message: `Username for ${ip}:`, default: 'root' },
            { type: 'list', name: 'authType', message: 'Authentication Method:', choices: ['Password', 'Private Key Path'] }
        ]);

        let password = null;
        let privateKey = null;

        if (authType === 'Password') {
            const res = await inquirer.prompt([{ type: 'password', name: 'pwd', message: `Password:` }]);
            password = res.pwd;
        } else {
            const res = await inquirer.prompt([{ type: 'input', name: 'keyPath', message: `Absolute path to private key:` }]);
            try {
                privateKey = fs.readFileSync(res.keyPath);
            } catch (e) {
                console.log(`❌ Failed to read key: ${e.message}`);
                continue;
            }
        }

        const client = new Client();

        console.log(`... Connecting to ${ip} ...`);
        try {
            await new Promise((resolve, reject) => {
                client.on('ready', resolve).on('error', reject).connect({
                    host: ip,
                    port: DEFAULT_PORT,
                    username,
                    password,
                    privateKey,
                    readyTimeout: 10000
                });
            });
            console.log(`✅ Connected to ${ip}`);
            sshClients[ip] = client;

            const info = await getHardwareInfo(client, ip);
            deviceInfos.push({ ...info, username });

        } catch (e) {
            console.log(`❌ Connection to ${ip} failed: ${e.message}`);
        }
    }

    if (deviceInfos.length === 0) {
        console.log("No successful connections made. Exiting.");
        process.exit(0);
    }

    console.log("\n📊 Hardware Analysis:");
    console.table(deviceInfos);

    console.log("\n🛠️  Deployment Planning");
    const deploymentPlan = [];

    for (const info of deviceInfos) {
        const { role } = await inquirer.prompt([{
            type: 'list',
            name: 'role',
            message: `Assign ROLE for ${info.ip}:`,
            choices: [
                { name: 'Master Node (Headless Router, API, Tor)', value: 'MASTER' },
                { name: 'Storage Slave (Database sync)', value: 'SLAVE_STORAGE' },
                { name: 'Frontend Slave (User Interface)', value: 'SLAVE_FRONTEND' },
                { name: 'Micro-Site (Public Tor web server)', value: 'MICRO_SITE' },
                { name: 'Skip Deploy', value: 'SKIP' }
            ],
            // Auto suggest based on RAM logic could be here:
            default: info.memory && parseInt(info.memory) < 1000 ? 'SLAVE_FRONTEND' : 'MASTER'
        }]);

        if (role !== 'SKIP') {
            let masterIp = '127.0.0.1';
            let forceUi = 'false';
            if (role !== 'MASTER') {
                const res = await inquirer.prompt([{
                    type: 'input',
                    name: 'masterIp',
                    message: `Enter the Master Node Local IP for ${info.ip} to connect to:`,
                    default: subnets[0] + 'x'
                }]);
                masterIp = res.masterIp;
            }
            deploymentPlan.push({ ip: info.ip, role, masterIp });
        }
    }

    if (deploymentPlan.length === 0) {
        console.log("Deployment plan empty. Exiting.");
        process.exit(0);
    }

    console.log("\n📋 Final Deployment Plan:");
    console.table(deploymentPlan);

    const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: 'Proceed with installation?', default: true }]);
    if (!confirm) process.exit(0);

    for (const task of deploymentPlan) {
        console.log(`\n🚀 Deploying ${task.role} to ${task.ip}...`);
        const client = sshClients[task.ip];

        try {
            console.log(`[${task.ip}] Cloning repository...`);
            await runSSHCommand(client, 'git clone https://github.com/DeveLooped-INC/gChat.git || (cd gChat && git pull)');

            console.log(`[${task.ip}] Generating configuration...`);
            const envVars = `NODE_ROLE=${task.role}\nMASTER_IP=${task.masterIp}\nFORCE_UI=${task.role === 'SLAVE_FRONTEND' ? 'true' : 'false'}\n`;
            await runSSHCommand(client, `echo "${envVars}" > ~/gChat/.env`);

            console.log(`[${task.ip}] Installing dependencies (This may take a minute)...`);
            await runSSHCommand(client, 'cd ~/gChat && npm install');

            console.log(`[${task.ip}] Setting up PM2 System Service...`);
            await runSSHCommand(client, 'npm install -g pm2'); // ensure pm2 exists
            await runSSHCommand(client, 'cd ~/gChat && pm2 start npm --name "gchat" -- start && pm2 save && pm2 startup | grep "sudo env" | bash');

            console.log(`✅ Deployment complete on ${task.ip}`);
            client.end();
            delete sshClients[task.ip];
        } catch (e) {
            console.log(`❌ Deployment failed on ${task.ip}: ${e.message}`);
        }
    }

    // Clean remaining connections
    Object.values(sshClients).forEach(c => c.end());
    console.log("\n🎉 All deployments finished successfully!");
    process.exit(0);
}

start().catch(console.error);
