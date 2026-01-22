import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import tar from 'tar';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const BIN_DIR = path.join(ROOT_DIR, 'bin');

// Configuration: Tor Browser 13.0.9 uses Tor 0.4.8.x
const TOR_VERSION = '13.0.9';
const BASE_URL = `https://archive.torproject.org/tor-package-archive/torbrowser/${TOR_VERSION}/`;

const PLATFORM_MAP = {
  'win32': 'windows',
  'darwin': 'macos',
  'linux': 'linux',
  'android': 'android' 
};

const ARCH_MAP = {
  'x64': 'x86_64',
  'arm64': 'aarch64',
  'ia32': 'i686',
  'arm': 'aarch64'
};

const getDownloadUrl = () => {
  const platform = PLATFORM_MAP[process.platform];
  let arch = ARCH_MAP[process.arch];

  // --- ANDROID / TERMUX HANDLING ---
  // We check for 'android' platform or TERMUX environment variables
  if (platform === 'android' || process.env.TERMUX_VERSION || process.env.PREFIX?.includes('termux')) {
      console.log('--------------------------------------------------');
      console.log('📱 Android (Termux) Detected');
      console.log('--------------------------------------------------');
      console.log('1. Skipping bundled Tor download (Using system "pkg install tor").');
      console.log('2. NOTICE: If you saw an "Electron" error above, IGNORE IT.');
      console.log('   Electron is optional and not needed for Termux mode.');
      console.log('--------------------------------------------------');
      console.log('✅ Setup Complete for Android.');
      // Exit successfully (0) so npm install completes even if Electron failed
      process.exit(0);
  }

  if (!platform) {
    console.warn(`[gChat] Platform '${process.platform}' is not officially supported for Tor automation. Skipping download.`);
    return null;
  }

  // Fallback for Windows arm64 to x64
  if (platform === 'windows' && arch === 'aarch64') {
    arch = 'x86_64';
  }
  
  if (!arch) {
     console.warn(`[gChat] Warning: Architecture ${process.arch} not explicitly mapped. Defaulting to x86_64.`);
     arch = 'x86_64';
  }

  const filename = `tor-expert-bundle-${platform}-${arch}-${TOR_VERSION}.tar.gz`;
  return {
    url: `${BASE_URL}${filename}`,
    filename
  };
};

const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download Tor: HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
};

const setupTor = async () => {
  console.log('--------------------------------------------------');
  console.log('gChat: Automating Tor Setup');
  console.log('--------------------------------------------------');

  // 1. Prepare bin directory
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  // 2. Determine URL
  let downloadConfig;
  try {
    downloadConfig = getDownloadUrl();
    if (!downloadConfig) {
        return; // Already handled exit or skip
    }
    console.log(`Detected Platform: ${process.platform} (${process.arch})`);
    console.log(`Target URL: ${downloadConfig.url}`);
  } catch (e) {
    console.error('Setup Failed:', e.message);
    process.exit(1);
  }

  const tarPath = path.join(BIN_DIR, 'tor.tar.gz');

  // 3. Download
  console.log('Downloading Tor Expert Bundle...');
  try {
    await downloadFile(downloadConfig.url, tarPath);
    console.log('Download complete.');
  } catch (e) {
    console.error('Download Failed:', e.message);
    // On Linux ARM (e.g. Raspberry Pi) links might fail. Don't crash install.
    console.warn('⚠️  Could not download bundled Tor. Please install Tor globally.');
    process.exit(0);
  }

  // 4. Extract
  console.log('Extracting binary...');
  try {
    await tar.x({
      file: tarPath,
      cwd: BIN_DIR,
      filter: (path) => {
        return path.endsWith('tor') || path.endsWith('tor.exe');
      },
      strip: 1 
    });
    
    fs.unlinkSync(tarPath);
    
    const possibleSubDir = path.join(BIN_DIR, 'tor'); 
    const winExe = path.join(BIN_DIR, 'tor.exe');
    const unixExe = path.join(BIN_DIR, 'tor');
    
    if (fs.existsSync(path.join(possibleSubDir, 'tor'))) {
        fs.renameSync(path.join(possibleSubDir, 'tor'), unixExe);
    } else if (fs.existsSync(path.join(possibleSubDir, 'tor.exe'))) {
        fs.renameSync(path.join(possibleSubDir, 'tor.exe'), winExe);
    }
    
    if (fs.existsSync(possibleSubDir) && fs.lstatSync(possibleSubDir).isDirectory()) {
        try { fs.rmdirSync(possibleSubDir); } catch(e) {}
    }

    if (process.platform !== 'win32') {
        if (fs.existsSync(unixExe)) {
            fs.chmodSync(unixExe, 0o755);
            console.log('Permissions set to executable.');
        }
    }

    console.log('✅ Tor Binary Installed Successfully');

  } catch (e) {
    console.error('Extraction Failed:', e);
    console.warn("Warning: Tor extraction had issues. You may need to install Tor manually.");
  }
};

setupTor();