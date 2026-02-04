import React, { useState, useEffect, useRef } from 'react';
import { Database, Trash2, HardDrive, Wifi, Activity, ShieldAlert, Loader2, WifiOff, Power, Key, Download, User, RefreshCw, Save, Terminal, FileJson, ToggleLeft, ToggleRight, LogOut, Pause, Play, Eye, EyeOff, Camera, Shield } from 'lucide-react';
import { StorageStats, ToastMessage, UserProfile, Post, Message, Contact, LogEntry } from '../types';
import { calculateObjectSize } from '../utils';
import { networkService, TorStats } from '../services/networkService';

interface SettingsProps {
  user: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  addToast: (title: string, message: string, type: ToastMessage['type']) => void;
  isOnline: boolean;
  onToggleNetwork: () => void;
  onResetNode: () => void;
  onLogout: () => void;
  onExportKeys: () => void;
  data: {
    posts: Post[];
    messages: Message[];
    contacts: Contact[];
  };
}

const Settings: React.FC<SettingsProps> = ({ user, onUpdateProfile, addToast, isOnline, onToggleNetwork, onResetNode, onLogout, onExportKeys, data }) => {
  const [stats, setStats] = useState<StorageStats[]>([]);
  const [torStats, setTorStats] = useState<TorStats>({ circuits: 0, guards: 0, status: 'Initializing' });
  const [systemLogs, setSystemLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [isDebug, setIsDebug] = useState(networkService.isDebugEnabled);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Profile State
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [isDiscoverable, setIsDiscoverable] = useState(user.isDiscoverable || false);
  const [isSaving, setIsSaving] = useState(false);

  // Bridge State
  const [bridgeConf, setBridgeConf] = useState('');

  useEffect(() => {
    networkService.getBridges().then(setBridgeConf);
  }, []);

  const handleSaveBridges = async () => {
    await networkService.saveBridges(bridgeConf);
    addToast('Bridges Saved', 'Tor is restarting with new configuration...', 'success');
  };

  const handleUseDefaultBridges = () => {
    const defaults = `
obfs4 192.95.36.142:443 CDF2E852BF539B82BD10E27E9115A31734E378C2 cert=qUVQ0/NG+QmDuhmUUc5c8A8gDjbM9eZgqYkbt5pU3fPqJ576uYB7YCLL0w3Fjz7DkuyD0w iat-mode=0
obfs4 85.31.186.98:443 011F2599C0E9B27EE74B353155E244813763C3E5 cert=VwEFPk9F/UN9JEDiXpG1ALJ0q2GR2bXd8G4viot2SpjYyF0WTHWvE1q9Q7m5wHyMeHVmtA iat-mode=0
    `.trim();
    setBridgeConf(defaults);
  };

  // Poll for logs manually to avoid re-rendering entire app on every log
  useEffect(() => {
    const interval = setInterval(() => {
      if (showLogs) {
        setSystemLogs([...networkService.getLogs()]);
      }
    }, 1000); // 1 sec poll for UI

    // Subscribe to stats
    networkService.onStats = (newStats) => {
      setTorStats(newStats);
    };

    return () => clearInterval(interval);
  }, [showLogs]);

  // Auto-scroll logs logic
  useEffect(() => {
    if (showLogs && logContainerRef.current && !isUserScrolling) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [systemLogs, showLogs, isUserScrolling]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 20;

    if (!isBottom) {
      setIsUserScrolling(true);
      // Reset existing timeout
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

      // Resume auto-scroll after 30 seconds of inactivity
      scrollTimeoutRef.current = setTimeout(() => {
        setIsUserScrolling(false);
      }, 30000);
    } else {
      setIsUserScrolling(false);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    }
  };

  const resumeAutoScroll = () => {
    setIsUserScrolling(false);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
  };

  useEffect(() => {
    const messagesSize = calculateObjectSize(data.messages);
    const feedSize = calculateObjectSize(data.posts);
    let mediaSize = 0;
    data.posts.forEach(p => { if (p.imageUrl) mediaSize += p.imageUrl.length });
    data.messages.forEach(m => { if (m.attachmentUrl) mediaSize += m.attachmentUrl.length });

    const calculatedStats: StorageStats[] = [
      { category: 'Messages', sizeMB: (messagesSize - mediaSize * 0.5) / (1024 * 1024), color: '#8884d8' },
      { category: 'Feed DB', sizeMB: (feedSize - mediaSize * 0.5) / (1024 * 1024), color: '#82ca9d' },
      { category: 'Media', sizeMB: mediaSize / (1024 * 1024), color: '#ffc658' },
      { category: 'System', sizeMB: 0.5, color: '#ff8042' },
      { category: 'Truth Chain', sizeMB: 0.05 + (data.posts.length * 0.001), color: '#a4de6c' },
    ];

    setStats(calculatedStats);
  }, [data]);

  const handleSaveProfile = () => {
    setIsSaving(true);
    onUpdateProfile({
      ...user,
      displayName,
      bio,
      avatarUrl,
      isDiscoverable
    });
    setIsSaving(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith('image/')) return;

      try {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const maxSize = 128;

            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > maxSize) {
                height *= maxSize / width;
                width = maxSize;
              }
            } else {
              if (height > maxSize) {
                width *= maxSize / height;
                height = maxSize;
              }
            }

            canvas.width = width;
            canvas.height = height;
            ctx?.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            setAvatarUrl(dataUrl);
          };
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error("Avatar upload failed", err);
      }
    }
  };

  const toggleDebug = () => {
    const newVal = !isDebug;
    setIsDebug(newVal);
    networkService.setDebugMode(newVal);
  };

  const saveLogsToFile = () => {
    networkService.downloadLogs();
    addToast('Logs Exported', 'Debug logs saved to your device.', 'success');
  };

  return (
    <div className="h-full overflow-y-auto w-full">
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in duration-500 pb-20">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-white">Node Settings</h1>
          <button
            onClick={onLogout}
            className="flex items-center space-x-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            <LogOut size={16} />
            <span>Log Out</span>
          </button>
        </div>

        {/* Bridge Configuration */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 bg-slate-800 rounded-lg">
              <Shield className="text-white" size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Censorship Resistance (Bridges)</h2>
              <p className="text-sm text-slate-400">Configure Tor Bridges to bypass ISP filtering and hide Tor usage.</p>
            </div>
          </div>

          <div className="space-y-4">
            <textarea
              value={bridgeConf}
              onChange={(e) => setBridgeConf(e.target.value)}
              placeholder="Starts with 'obfs4'..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-300 h-24 focus:outline-none focus:border-onion-500 transition-colors resize-none"
            />
            <div className="flex justify-between items-center">
              <button
                onClick={handleUseDefaultBridges}
                className="text-xs text-onion-400 hover:text-white hover:underline"
              >
                Use Default Bridges (Public)
              </button>
              <button
                onClick={handleSaveBridges}
                className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Save & Restart Tor
              </button>
            </div>
          </div>
        </div>

        {/* Network Stats & Control */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            onClick={onToggleNetwork}
            className={`p-5 rounded-xl border relative overflow-hidden group cursor-pointer transition-all ${isOnline
              ? 'bg-emerald-950/20 border-emerald-500/30 hover:bg-emerald-950/30'
              : 'bg-red-950/20 border-red-500/30 hover:bg-red-950/30'
              }`}
          >
            <div className="absolute top-0 right-0 p-2 opacity-10">
              {isOnline ? <Wifi size={100} /> : <WifiOff size={100} />}
            </div>
            <div className="flex justify-between items-start">
              <h3 className="text-slate-300 text-sm font-medium mb-1">Network Status</h3>
              <Power size={18} className={isOnline ? 'text-emerald-500' : 'text-red-500'} />
            </div>
            <p className={`text-2xl font-bold flex items-center space-x-2 ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
              <span>{isOnline ? 'Online' : 'Offline'}</span>
              {isOnline && (
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
              )}
            </p>
            <p className="text-xs text-slate-500 mt-2 z-10 relative">
              {isOnline ? 'Tap to disconnect Tor' : 'Tap to restart relay'}
            </p>
          </div>

          <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 hover:border-onion-500/30 transition-colors">
            <h3 className="text-slate-400 text-sm font-medium mb-1">Active Circuits</h3>
            <p className="text-2xl font-bold text-onion-400">{isOnline ? `${torStats.circuits} Relays` : '0 Relays'}</p>
            <p className="text-xs text-slate-500 mt-2">Real-time Tor Network Data</p>
          </div>

          <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 hover:border-indigo-500/30 transition-colors">
            <h3 className="text-slate-400 text-sm font-medium mb-1">Mesh Discovery</h3>
            <p className="text-2xl font-bold text-indigo-400">{isOnline ? 'Active' : 'Standby'}</p>
            <p className="text-xs text-slate-500 mt-2">Listening on {user.homeNodeOnion ? 'Onion V3' : 'Localhost'}</p>
          </div>
        </div>

        {/* Profile Section */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-slate-800 rounded-lg">
              <User className="text-white" size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Public Profile</h2>
              <p className="text-sm text-slate-400">Manage how you appear on the mesh.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex flex-col items-center space-y-3">
              <div className="relative group cursor-pointer animate-in fade-in zoom-in duration-300">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="w-24 h-24 rounded-full bg-slate-800 object-cover shadow-xl border-2 border-onion-500/50" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-onion-400 to-indigo-600 flex items-center justify-center text-3xl font-bold text-white shadow-xl">
                    {displayName.charAt(0)}
                  </div>
                )}
                <label className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded-full transition-opacity cursor-pointer text-white">
                  <Camera size={24} />
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                </label>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Click to upload (max 128px)</p>
            </div>

            <div className="md:col-span-2 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1 uppercase">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-onion-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1 uppercase">Bio / Status</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-onion-500 transition-colors resize-none h-24"
                />
              </div>

              <div
                onClick={() => setIsDiscoverable(!isDiscoverable)}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${isDiscoverable
                  ? 'bg-blue-900/20 border-blue-500/50'
                  : 'bg-slate-950 border-slate-800 hover:bg-slate-800'
                  }`}
              >
                <div className="flex items-center space-x-3">
                  {isDiscoverable ? <Eye size={20} className="text-blue-400" /> : <EyeOff size={20} className="text-slate-500" />}
                  <div>
                    <p className={`text-sm font-bold ${isDiscoverable ? 'text-blue-400' : 'text-slate-300'}`}>
                      {isDiscoverable ? 'Discoverable' : 'Hidden'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {isDiscoverable
                        ? "Your Node ID is broadcasted to the mesh via daisy-chaining."
                        : "You are invisible to nodes not in your contact list."}
                    </p>
                  </div>
                </div>
                {isDiscoverable ? <ToggleRight size={24} className="text-blue-500" /> : <ToggleLeft size={24} className="text-slate-600" />}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveProfile}
                  disabled={isSaving}
                  className="bg-onion-600 hover:bg-onion-500 text-white px-4 py-2 rounded-lg font-medium flex items-center space-x-2 transition-all disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  <span>{isSaving ? 'Propagating...' : 'Save Changes'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-slate-800 rounded-lg">
              <Key className="text-white" size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Security & Keys</h2>
              <p className="text-sm text-slate-400">Manage your identity and encryption keys.</p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-slate-950/50 p-4 rounded-xl border border-slate-800">
            <div>
              <p className="text-sm font-medium text-white">Export Private Identity</p>
              <p className="text-xs text-slate-500 mt-1">Download your Ed25519 private key for backup. Keep this safe.</p>
            </div>
            <button
              onClick={onExportKeys}
              className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center space-x-2 transition-colors"
            >
              <Download size={16} />
              <span>Export Keys</span>
            </button>
          </div>
        </div>

        {/* System Logs */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-slate-800 rounded-lg">
                <Terminal className="text-white" size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Debug & Diagnostics</h2>
                <p className="text-sm text-slate-400">Inspect process logs and network events.</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={saveLogsToFile}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg flex items-center space-x-2 transition-colors"
                title="Download Logs"
              >
                <FileJson size={16} />
                <span className="hidden md:inline">Export</span>
              </button>
              <button
                onClick={toggleDebug}
                className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors"
                title="Toggle Debug Mode"
              >
                {isDebug ? <ToggleRight className="text-emerald-500" size={32} /> : <ToggleLeft size={32} />}
              </button>
            </div>
          </div>

          <button
            onClick={() => setShowLogs(!showLogs)}
            className="w-full text-center text-xs text-slate-500 hover:text-white py-2 border-t border-slate-800"
          >
            {showLogs ? 'Hide Console' : 'Show Console'}
          </button>

          {showLogs && (
            <div className="relative">
              {isUserScrolling && (
                <div className="absolute bottom-4 right-4 z-10">
                  <button
                    onClick={resumeAutoScroll}
                    className="bg-onion-600 hover:bg-onion-500 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-1 shadow-lg animate-in fade-in slide-in-from-bottom-2"
                  >
                    <Play size={10} className="fill-current" />
                    <span>Resume Auto-Scroll</span>
                  </button>
                </div>
              )}
              <div
                ref={logContainerRef}
                onScroll={handleScroll}
                className="mt-2 bg-black rounded-lg p-4 font-mono text-[10px] md:text-xs text-slate-300 h-80 overflow-y-auto border border-slate-800 shadow-inner scroll-smooth"
              >
                {systemLogs.length === 0 && <p className="text-slate-600 italic text-center pt-20">No logs captured yet.</p>}
                {systemLogs.map((log, i) => (
                  <div key={i} className="mb-1 border-b border-white/5 pb-1 last:border-0 last:pb-0 flex gap-2">
                    <span className="text-slate-500 whitespace-nowrap">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span className={`font-bold whitespace-nowrap w-16 ${log.level === 'ERROR' ? 'text-red-500' :
                      log.level === 'WARN' ? 'text-orange-400' :
                        log.level === 'DEBUG' ? 'text-slate-500' : 'text-emerald-400'
                      }`}>{log.level}</span>
                    <span className="text-slate-400 whitespace-nowrap w-20">[{log.area}]</span>
                    <span className="break-all">{log.message}</span>
                    {log.details && (
                      <span className="text-xs text-slate-600">{JSON.stringify(log.details)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border border-red-900/30 bg-red-900/10 rounded-xl p-6">
          <h3 className="text-red-400 font-bold flex items-center space-x-2 mb-2">
            <ShieldAlert size={20} />
            <span>Danger Zone</span>
          </h3>
          <p className="text-sm text-slate-400 mb-4">
            Deleting your node ID is irreversible. Your friends will no longer be able to contact you until you exchange new keys physically.
          </p>
          <button
            onClick={onResetNode}
            className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Delete Node Identity
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;