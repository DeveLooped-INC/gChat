import React, { useState, useEffect, useRef } from 'react';
import { Power, Wifi, User, Terminal, Download, Server, Trash2, Plus, Save, Loader2, RefreshCw, Key, Eye, EyeOff, ToggleRight, ToggleLeft, QrCode, Upload, AlertTriangle, Activity, ShieldCheck, ShieldAlert, Zap, XCircle, CheckSquare, LogOut, HardDrive, FileArchive, Copy, Check, MapPin, Globe, Clock, Lock, Users, BarChart3, ThumbsUp, ThumbsDown, Info, Play, Pause, Camera, WifiOff, Database, Radio, Heart, RadioReceiver, Shield, LayoutDashboard, UserCog, Settings as SettingsIcon, SaveAll } from 'lucide-react';
import { UserProfile, NodePeer, ToastMessage, LogEntry, AvailablePeer, PrivacySettings, StorageStats, Post, Message, Contact, NotificationCategory, MediaSettings } from '../types';
import { networkService, TorStats } from '../services/networkService';
import IdentityModal from './IdentityModal';
import QRScanner from './QRScanner';
import { createMigrationPackage } from '../services/migrationService';
import NodeInfoModal, { NodeInfoTarget } from './NodeInfoModal';
import { formatUserIdentity, calculateObjectSize } from '../utils';
import { storageService } from '../services/storage';
import { clearMediaCache } from '../services/mediaStorage';

interface UserStats {
    totalPosts: number;
    likes: number;
    dislikes: number;
    connections: number;
    followers: number;
}

interface NodeSettingsProps {
    user: UserProfile;
    peers: NodePeer[];
    pendingPeers?: string[];
    discoveredPeers?: AvailablePeer[];
    nodeConfig?: { alias: string; description: string; };
    isOnline: boolean;
    userStats: UserStats;
    onAddPeer: (onion: string) => void;
    onRemovePeer: (onion: string) => void;
    onBlockPeer?: (onion: string) => void;
    onSyncPeer?: (onion: string) => void;
    onUpdateNodeConfig?: (alias: string, description: string) => void;
    onToggleNetwork: () => void;
    onUpdateProfile: (profile: UserProfile) => void;
    onExportKeys: () => void;
    addToast: (t: string, m: string, type: ToastMessage['type'], category?: NotificationCategory) => void;
    onSetSyncAge?: (hours: number) => void;
    currentSyncAge?: number;
    data?: {
        posts: Post[];
        messages: Message[];
        contacts: Contact[];
    };
    mediaSettings?: MediaSettings;
    onUpdateMediaSettings?: (settings: MediaSettings) => void;
    contentSettings?: { showDownvotedPosts: boolean; downvoteThreshold: number };
    onUpdateContentSettings?: (settings: { showDownvotedPosts: boolean; downvoteThreshold: number }) => void;
}

type SettingsTab = 'dashboard' | 'user' | 'node' | 'backup';

const NodeSettings: React.FC<NodeSettingsProps> = ({
    user, peers, pendingPeers = [], discoveredPeers = [], nodeConfig, isOnline, userStats, onAddPeer, onRemovePeer, onBlockPeer, onSyncPeer, onUpdateNodeConfig, onToggleNetwork, onUpdateProfile, onExportKeys, addToast, onSetSyncAge, currentSyncAge = 24, data, mediaSettings, onUpdateMediaSettings, contentSettings, onUpdateContentSettings
}) => {
    const [activeTab, setActiveTab] = useState<SettingsTab>('dashboard');
    const [newPeerOnion, setNewPeerOnion] = useState('');
    const [torStats, setTorStats] = useState<TorStats>({ circuits: 0, guards: 0, status: 'Initializing' });
    const [systemLogs, setSystemLogs] = useState<LogEntry[]>([]);
    const [showLogs, setShowLogs] = useState(false);
    const logContainerRef = useRef<HTMLDivElement>(null);

    const [isUserScrolling, setIsUserScrolling] = useState(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [displayName, setDisplayName] = useState(user.displayName);
    const [bio, setBio] = useState(user.bio);
    const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
    const [isDiscoverable, setIsDiscoverable] = useState(user.isDiscoverable || false);
    const [isSaving, setIsSaving] = useState(false);

    const [currentMediaSettings, setCurrentMediaSettings] = useState<MediaSettings>(mediaSettings || {
        enabled: false,
        maxFileSizeMB: 10,
        autoDownloadFriends: false,
        autoDownloadPrivate: false,
        cacheRelayedMedia: false
    });

    const [privacySettings, setPrivacySettings] = useState<PrivacySettings>(user.privacySettings || {
        isPrivateProfile: false,
        showBioPublicly: true,
        showFollowersPublicly: true
    });

    const [nodeAlias, setNodeAlias] = useState(nodeConfig?.alias || '');
    const [nodeDesc, setNodeDesc] = useState(nodeConfig?.description || '');

    const [showNodeIdentity, setShowNodeIdentity] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [nodeInfoTarget, setNodeInfoTarget] = useState<NodeInfoTarget | null>(null);

    const [migrationPassword, setMigrationPassword] = useState<string | null>(null);
    const [isMigrating, setIsMigrating] = useState(false);
    const [passwordCopied, setPasswordCopied] = useState(false);

    // Storage Stats State
    const [storageStats, setStorageStats] = useState<StorageStats[]>([]);

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

    // Identity Debug
    const nodeOwnerId = localStorage.getItem('gchat_node_owner');
    const { handle: currentHandle, suffix: currentSuffix } = formatUserIdentity(user.username);

    // Calculate Storage Stats
    useEffect(() => {
        if (data && user.isAdmin) {
            const messagesSize = calculateObjectSize(data.messages);
            const feedSize = calculateObjectSize(data.posts);
            let mediaSize = 0;
            data.posts.forEach(p => { if (p.imageUrl) mediaSize += p.imageUrl.length });
            data.messages.forEach(m => { if (m.attachmentUrl) mediaSize += m.attachmentUrl.length });

            const calculatedStats: StorageStats[] = [
                { category: 'Messages', sizeMB: (messagesSize - mediaSize * 0.5) / (1024 * 1024), color: '#818cf8' }, // Indigo-400
                { category: 'Feed DB', sizeMB: (feedSize - mediaSize * 0.5) / (1024 * 1024), color: '#34d399' }, // Emerald-400
                { category: 'Media', sizeMB: mediaSize / (1024 * 1024), color: '#fbbf24' }, // Amber-400
                { category: 'System', sizeMB: 0.5, color: '#f87171' }, // Red-400
            ];
            setStorageStats(calculatedStats);
        }
    }, [data, user.isAdmin]);

    useEffect(() => {
        const interval = setInterval(() => {
            if (showLogs) {
                setSystemLogs([...networkService.getLogs()]);
            }
        }, 1000);
        networkService.onStats = (newStats) => { setTorStats(newStats); };
        return () => clearInterval(interval);
    }, [showLogs]);

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
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = setTimeout(() => setIsUserScrolling(false), 30000);
        } else {
            setIsUserScrolling(false);
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        }
    };

    const handleAddPeer = () => {
        if (!newPeerOnion.endsWith('.onion')) {
            addToast("Invalid Address", "Must be a valid .onion address", 'error');
            return;
        }
        onAddPeer(newPeerOnion);
        setNewPeerOnion('');
    };

    const handleSyncPeer = (onion: string) => {
        if (onSyncPeer) onSyncPeer(onion);
        else {
            addToast("Syncing", `Pinging ${onion}...`, 'info');
            networkService.connect(onion).then(res => {
                if (res.success) addToast("Verified", "Peer is online and reachable.", 'success');
                else addToast("Offline", "Peer did not respond.", 'error');
            });
        }
    };

    const parseDeepLink = (url: string) => {
        try {
            const urlObj = new URL(url);
            if (urlObj.searchParams.get('action') === 'add-peer') {
                const address = urlObj.searchParams.get('address');
                if (address) {
                    onAddPeer(address);
                    setShowScanner(false);
                    addToast("Peer Added", "Connection initiated via Tor", 'success');
                    return;
                }
            }
            addToast("Invalid QR", "Code does not contain a Node Address.", 'error');
        } catch (e) {
            addToast("Error", "Could not parse QR code.", 'error');
        }
    };

    const handleSaveProfile = () => {
        setIsSaving(true);
        setTimeout(() => {
            const newUsername = `${displayName}${currentSuffix}`;
            onUpdateProfile({
                ...user,
                displayName,
                username: newUsername,
                bio,
                avatarUrl,
                isDiscoverable,
                privacySettings
            });
            if (onUpdateNodeConfig && user.isAdmin) onUpdateNodeConfig(nodeAlias, nodeDesc);
            if (onUpdateMediaSettings && currentMediaSettings) onUpdateMediaSettings(currentMediaSettings);
            setIsSaving(false);
            addToast("Settings Updated", "Your new identity is propagating.", 'success');
        }, 800);
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

    const handleFactoryReset = async () => {
        if (confirm("DANGER: This will wipe ALL data, messages, and your identity from this device. Proceed?")) {
            await storageService.deleteEverything();
            await clearMediaCache();
            localStorage.clear();
            window.location.reload();
        }
    };

    const handleMigrateUser = async () => {
        setIsMigrating(true);
        try {
            const { blob, password } = await createMigrationPackage();
            setMigrationPassword(password);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gchat_backup_${new Date().toISOString().split('T')[0]}.zip`;
            a.click();
            addToast("Backup Ready", "Password displayed below. Save it!", "success");
        } catch (e: any) {
            console.error(e);
            addToast("Migration Failed", e.message || "Could not create backup", "error");
        } finally { setIsMigrating(false); }
    };

    const copyPassword = () => { if (migrationPassword) { navigator.clipboard.writeText(migrationPassword); setPasswordCopied(true); setTimeout(() => setPasswordCopied(false), 2000); } };
    const updatePrivacy = (key: keyof PrivacySettings, value: boolean) => { setPrivacySettings(prev => ({ ...prev, [key]: value })); };
    const totalVotes = (userStats.likes + userStats.dislikes) || 1;
    const avgScore = Math.round((userStats.likes / totalVotes) * 100);

    const TabButton = ({ id, label, icon: Icon }: { id: SettingsTab, label: string, icon: any }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${activeTab === id
                ? 'border-onion-500 text-onion-400 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
        >
            <Icon size={16} />
            <span>{label}</span>
        </button>
    );

    return (
        <div className="h-full w-full max-w-6xl mx-auto flex flex-col relative bg-black">
            {/* Main Header */}
            <div className="flex-none p-4 md:p-8 pb-0 border-b border-slate-800 bg-slate-900/50 backdrop-blur">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-onion-500/20 rounded-xl">
                            <Server size={32} className="text-onion-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">Settings</h1>
                            <p className="text-slate-400 text-sm">Node Configuration & Preferences</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {user.isAdmin && (
                            <button
                                onClick={() => setShowNodeIdentity(true)}
                                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg transition-colors text-sm"
                            >
                                <QrCode size={16} /> Node QR
                            </button>
                        )}
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="flex overflow-x-auto no-scrollbar gap-2">
                    <TabButton id="dashboard" label="Dashboard" icon={LayoutDashboard} />
                    <TabButton id="user" label="User Info & Settings" icon={UserCog} />
                    <TabButton id="node" label="Node Info & Settings" icon={SettingsIcon} />
                    <TabButton id="backup" label="Backup & Restore" icon={SaveAll} />
                </div>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 pb-20">

                {/* ---------------- DASHBOARD TAB ---------------- */}
                {activeTab === 'dashboard' && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                        {/* 1. Stats Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center">
                                <BarChart3 className="text-indigo-400 mb-2" size={24} />
                                <span className="text-2xl font-bold text-white">{userStats.totalPosts}</span>
                                <span className="text-xs text-slate-500 uppercase tracking-wide">Broadcasts</span>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center">
                                <ThumbsUp className="text-emerald-400 mb-2" size={24} />
                                <span className="text-2xl font-bold text-white">{userStats.likes}</span>
                                <span className="text-xs text-slate-500 uppercase tracking-wide">Positive Karma</span>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center">
                                <div className="flex gap-1 mb-2">
                                    <ThumbsUp className="text-emerald-500" size={16} />
                                    <ThumbsDown className="text-red-500" size={16} />
                                </div>
                                <span className="text-2xl font-bold text-white">{avgScore}%</span>
                                <span className="text-xs text-slate-500 uppercase tracking-wide">Avg Approval</span>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center">
                                <Users className="text-blue-400 mb-2" size={24} />
                                <span className="text-2xl font-bold text-white">{userStats.connections}</span>
                                <span className="text-xs text-slate-500 uppercase tracking-wide">Contacts</span>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center col-span-2 md:col-span-1">
                                <Heart className="text-onion-400 mb-2" size={24} />
                                <span className="text-2xl font-bold text-white">{userStats.followers}</span>
                                <span className="text-xs text-slate-500 uppercase tracking-wide">Followers</span>
                            </div>
                        </div>

                        {/* Peer Management (Moved to Dashboard for visibility) */}
                        {user.isAdmin && (
                            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                                <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-2">
                                    <div className="flex items-center space-x-3">
                                        <Activity className="text-blue-500" size={24} />
                                        <h2 className="text-lg font-bold text-white">Peer Management</h2>
                                    </div>
                                    <div className="text-xs text-slate-500">Connected: {peers.filter(p => p.status === 'online').length}</div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="Add Peer (.onion address)"
                                            value={newPeerOnion}
                                            onChange={(e) => setNewPeerOnion(e.target.value)}
                                            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-onion-500"
                                        />
                                        <button onClick={handleAddPeer} className="bg-slate-800 hover:bg-slate-700 text-white px-4 rounded-lg flex items-center"><Plus size={18} /></button>
                                        <button onClick={() => setShowScanner(true)} className="bg-slate-800 hover:bg-slate-700 text-white px-4 rounded-lg flex items-center"><Camera size={18} /></button>
                                    </div>

                                    {/* Peer List */}
                                    <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                                        {peers.map(peer => (
                                            <div key={peer.onionAddress} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg group">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-2 h-2 rounded-full ${peer.status === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-600'}`} />
                                                    <div>
                                                        <p className="text-sm font-mono text-slate-300">{peer.alias || peer.onionAddress.substring(0, 16) + '...'}</p>
                                                        <p className="text-[10px] text-slate-500">{peer.status} • {peer.latencyMs}ms</p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => handleSyncPeer(peer.onionAddress)} className="p-1.5 hover:bg-indigo-500/20 text-indigo-400 rounded"><RefreshCw size={14} /></button>
                                                    <button onClick={() => setNodeInfoTarget({ address: peer.onionAddress, alias: peer.alias, type: 'trusted', status: peer.status, latency: peer.latencyMs, lastSeen: peer.lastSeen })} className="p-1.5 hover:bg-slate-800 text-slate-300 rounded"><Info size={14} /></button>
                                                    <button onClick={() => onRemovePeer(peer.onionAddress)} className="p-1.5 hover:bg-red-500/20 text-red-400 rounded"><Trash2 size={14} /></button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Discovered Peers Section */}
                                    {discoveredPeers.length > 0 && (
                                        <div className="mt-4 pt-4 border-t border-slate-800">
                                            <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Discovered via Gossip ({discoveredPeers.length})</h3>
                                            <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                                                {discoveredPeers.map(peer => (
                                                    <div key={peer.id} className="flex items-center justify-between p-3 bg-slate-950/50 border border-slate-800 border-dashed rounded-lg">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-bold text-slate-300">{peer.displayName}</span>
                                                                <span className="text-[10px] bg-slate-800 px-1.5 rounded text-slate-500">{peer.hops} Hops</span>
                                                            </div>
                                                            <p className="text-xs font-mono text-slate-500 truncate w-48">{peer.id}</p>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button onClick={() => onAddPeer(peer.id)} className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded transition-colors" title="Connect"><Plus size={14} /></button>
                                                            <button onClick={() => setNodeInfoTarget({ address: peer.id, alias: peer.displayName, description: peer.username, type: 'discovered', hops: peer.hops, lastSeen: peer.lastSeen, via: peer.viaPeerId })} className="p-1.5 bg-slate-800 text-slate-300 hover:text-white rounded transition-colors" title="Info"><Info size={14} /></button>
                                                            <button onClick={() => onBlockPeer && onBlockPeer(peer.id)} className="p-1.5 bg-slate-800 hover:bg-red-900/30 text-slate-500 hover:text-red-400 rounded transition-colors" title="Block"><XCircle size={14} /></button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Pending Signals Section */}
                                    {pendingPeers.length > 0 && (
                                        <div className="mt-4 pt-4 border-t border-slate-800">
                                            <h3 className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-2"><RadioReceiver size={12} className="text-onion-400 animate-pulse" /> Unknown Signals ({pendingPeers.length})</h3>
                                            <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                                                {pendingPeers.map(peerId => (
                                                    <div key={peerId} className="flex items-center justify-between p-3 bg-onion-950/10 border border-onion-500/20 rounded-lg">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full bg-onion-500 animate-pulse" />
                                                            <p className="text-xs font-mono text-onion-200 truncate w-48">{peerId}</p>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button onClick={() => onAddPeer(peerId)} className="text-xs bg-onion-600 hover:bg-onion-500 text-white px-2 py-1 rounded transition-colors">Accept</button>
                                                            <button onClick={() => setNodeInfoTarget({ address: peerId, type: 'pending', status: 'unknown' })} className="text-xs bg-slate-800 text-slate-300 hover:text-white px-2 py-1 rounded transition-colors"><Info size={12} /></button>
                                                            <button onClick={() => onBlockPeer && onBlockPeer(peerId)} className="text-xs bg-slate-800 hover:bg-red-900/30 text-slate-400 hover:text-red-400 px-2 py-1 rounded transition-colors">Block</button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Network Status & Circuits */}
                        {user.isAdmin && (
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

                                <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 hover:border-onion-500/30 transition-colors relative">
                                    {bridgeConf.trim().length > 0 && (
                                        <div className="absolute top-2 right-2">
                                            <Shield size={16} className="text-emerald-500/50" />
                                        </div>
                                    )}
                                    <h3 className="text-slate-400 text-sm font-medium mb-1">Active Circuits</h3>
                                    <p className="text-2xl font-bold text-onion-400">{isOnline ? `${torStats.circuits} Relays` : '0 Relays'}</p>
                                    <div className="text-xs text-slate-500 mt-2 flex items-center gap-2">
                                        <span>Real-time Tor Data</span>
                                        {bridgeConf.trim().length > 0 && (
                                            <span className="bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded flex items-center gap-1 border border-emerald-500/20">
                                                <Shield size={10} /> Bridge Active
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 hover:border-indigo-500/30 transition-colors">
                                    <h3 className="text-slate-400 text-sm font-medium mb-1">Mesh Discovery</h3>
                                    <p className="text-2xl font-bold text-indigo-400">{isOnline ? 'Active' : 'Standby'}</p>
                                    <p className="text-xs text-slate-500 mt-2">Listening on {user.homeNodeOnion ? 'Onion V3' : 'Localhost'}</p>
                                </div>
                            </div>
                        )}

                        {/* Storage Stats */}
                        {user.isAdmin && storageStats.length > 0 && (
                            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                                <div className="flex items-center space-x-3 mb-4 border-b border-slate-800 pb-2">
                                    <Database className="text-blue-400" size={24} />
                                    <h2 className="text-lg font-bold text-white">Storage Usage</h2>
                                </div>
                                <div className="flex h-4 rounded-full overflow-hidden bg-slate-950 border border-slate-800 mb-4">
                                    {storageStats.map((item, i) => (
                                        <div key={i} style={{ width: `${(item.sizeMB / Math.max(1, storageStats.reduce((a, b) => a + b.sizeMB, 0))) * 100}%`, backgroundColor: item.color }} title={`${item.category}: ${item.sizeMB.toFixed(2)} MB`} />
                                    ))}
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {storageStats.map((item, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                                            <div>
                                                <p className="text-xs font-bold text-white">{item.category}</p>
                                                <p className="text-[10px] text-slate-500">{item.sizeMB.toFixed(2)} MB</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* System Logs */}
                        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center space-x-3">
                                    <Terminal className="text-slate-400" size={24} />
                                    <h2 className="text-lg font-bold text-white">System Logs</h2>
                                </div>
                                <button onClick={() => setShowLogs(!showLogs)} className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-white transition-colors">
                                    {showLogs ? 'Hide Console' : 'Show Console'}
                                </button>
                            </div>

                            {showLogs && (
                                <div
                                    ref={logContainerRef}
                                    onScroll={handleScroll}
                                    className="bg-black rounded-lg p-4 font-mono text-xs h-64 overflow-y-auto border border-slate-800 shadow-inner relative"
                                >
                                    {isUserScrolling && (
                                        <button onClick={() => { setIsUserScrolling(false); if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight; }} className="absolute bottom-4 right-4 bg-onion-600 text-white px-3 py-1 rounded-full text-xs shadow-lg animate-bounce z-10">
                                            Resume Scroll
                                        </button>
                                    )}
                                    {systemLogs.map((log, i) => (
                                        <div key={i} className="mb-1 break-all flex gap-2">
                                            <span className="text-slate-600">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                            <span className={log.level === 'ERROR' ? 'text-red-500' : log.level === 'WARN' ? 'text-amber-500' : 'text-emerald-500'}>{log.level}</span>
                                            <span className="text-blue-400">[{log.area}]</span>
                                            <span className="text-slate-300">{log.message}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ---------------- USER TAB ---------------- */}
                {activeTab === 'user' && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                        {/* User Profile Section */}
                        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                            <div className="flex items-center space-x-3 mb-6 border-b border-slate-800 pb-2">
                                <User className="text-emerald-500" size={24} />
                                <h2 className="text-lg font-bold text-white">User Profile</h2>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="flex flex-col items-center space-y-3">
                                    <div className="relative group cursor-pointer">
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
                                    <p className="text-[10px] text-slate-500">Click to upload (max 128px)</p>
                                </div>

                                <div className="md:col-span-2 space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1 uppercase">Handle (Display Name)</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={displayName}
                                                onChange={(e) => setDisplayName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 15))}
                                                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-onion-500 transition-colors"
                                            />
                                            <div className="bg-black/40 border border-slate-800 rounded-lg px-3 py-2 text-slate-500 font-mono text-sm">
                                                {currentSuffix}
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mt-1">
                                            Your globally unique ID is <strong>{displayName}{currentSuffix}</strong>
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1 uppercase">Bio / Status</label>
                                        <textarea
                                            value={bio}
                                            onChange={(e) => setBio(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-onion-500 transition-colors resize-none h-24"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Privacy Section */}
                        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                            <div className="flex items-center space-x-3 mb-6 border-b border-slate-800 pb-2">
                                <ShieldCheck className="text-indigo-500" size={24} />
                                <h2 className="text-lg font-bold text-white">Privacy & Visibility</h2>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div onClick={() => updatePrivacy('isPrivateProfile', !privacySettings.isPrivateProfile)} className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${privacySettings.isPrivateProfile ? 'bg-indigo-900/20 border-indigo-500/50' : 'bg-slate-950 border-slate-800 hover:bg-slate-800'}`}>
                                    <div className="flex items-center gap-3">
                                        {privacySettings.isPrivateProfile ? <Lock size={20} className="text-indigo-400" /> : <Globe size={20} className="text-slate-500" />}
                                        <div><h3 className="text-slate-200 font-bold text-sm">Private Account</h3><p className="text-xs text-slate-500">{privacySettings.isPrivateProfile ? "Only contacts see details" : "Publicly visible"}</p></div>
                                    </div>
                                    {privacySettings.isPrivateProfile ? <ToggleRight size={24} className="text-indigo-500" /> : <ToggleLeft size={24} className="text-slate-600" />}
                                </div>

                                {user.isAdmin && (
                                    <div onClick={() => setIsDiscoverable(!isDiscoverable)} className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${isDiscoverable ? 'bg-onion-900/20 border-onion-500/50' : 'bg-slate-950 border-slate-800 hover:bg-slate-800'}`}>
                                        <div className="flex items-center gap-3">
                                            {isDiscoverable ? <Eye size={20} className="text-onion-400" /> : <EyeOff size={20} className="text-slate-500" />}
                                            <div><h3 className="text-slate-200 font-bold text-sm">Node Discovery</h3><p className="text-xs text-slate-500">{isDiscoverable ? "Broadcasting to mesh" : "Invisible to non-contacts"}</p></div>
                                        </div>
                                        {isDiscoverable ? <ToggleRight size={24} className="text-onion-500" /> : <ToggleLeft size={24} className="text-slate-600" />}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Security Section */}
                        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                            <div className="flex items-center space-x-3 mb-6 border-b border-slate-800 pb-2">
                                <Key className="text-white" size={24} />
                                <h2 className="text-lg font-bold text-white">Security & Keys</h2>
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
                    </div>
                )}

                {/* ---------------- NODE TAB ---------------- */}
                {activeTab === 'node' && user.isAdmin && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                        {/* Node Configuration */}
                        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                            <div className="flex items-center space-x-3 mb-6 border-b border-slate-800 pb-2">
                                <Server className="text-onion-500" size={24} />
                                <h2 className="text-lg font-bold text-white">Node Configuration</h2>
                            </div>

                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1 uppercase">Node Alias</label>
                                        <input
                                            type="text"
                                            value={nodeAlias}
                                            onChange={(e) => setNodeAlias(e.target.value)}
                                            placeholder="e.g. My Home Relay"
                                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-onion-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1 uppercase">Sync History (Hours)</label>
                                        <input
                                            type="number"
                                            value={currentSyncAge}
                                            onChange={(e) => onSetSyncAge && onSetSyncAge(parseInt(e.target.value) || 24)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-onion-500"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1 uppercase">Description</label>
                                    <input
                                        type="text"
                                        value={nodeDesc}
                                        onChange={(e) => setNodeDesc(e.target.value)}
                                        placeholder="Public description broadcasted to peers"
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-onion-500"
                                    />
                                </div>
                            </div>
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

                        {/* Media Auto-Download Settings */}
                        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                            <div className="flex items-center space-x-3 mb-6 border-b border-slate-800 pb-2">
                                <Download className="text-pink-500" size={24} />
                                <h2 className="text-lg font-bold text-white">Media Auto-Download</h2>
                            </div>

                            <div className="space-y-6">
                                {/* Auto-Download Warning */}
                                <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg flex gap-3 text-amber-500 text-sm">
                                    <AlertTriangle className="shrink-0" size={20} />
                                    <p>CAUTION: Only enable auto-download if you trust your peers. Malicious files could potentially be distributed via relay.</p>
                                </div>

                                {/* Master Switch */}
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-white font-medium">Auto-Download Media</h3>
                                        <p className="text-slate-400 text-xs">Automatically download attachments from any source.</p>
                                    </div>
                                    <button
                                        onClick={() => setCurrentMediaSettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                                        className={`w-12 h-6 rounded-full p-1 transition-colors ${currentMediaSettings.enabled ? 'bg-onion-500' : 'bg-slate-700'}`}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${currentMediaSettings.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                                    </button>
                                </div>

                                {currentMediaSettings.enabled && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                                        {/* Max Size Slider */}
                                        <div>
                                            <div className="flex justify-between mb-2">
                                                <label className="text-xs font-bold text-slate-500 uppercase">Max File Size Limit</label>
                                                <span className="text-xs font-bold text-onion-400">{currentMediaSettings.maxFileSizeMB} MB</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="1"
                                                max="1024"
                                                value={currentMediaSettings.maxFileSizeMB}
                                                onChange={(e) => setCurrentMediaSettings(prev => ({ ...prev, maxFileSizeMB: parseInt(e.target.value) }))}
                                                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-onion-500"
                                            />
                                            <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                                                <span>1 MB</span>
                                                <span>1 GB</span>
                                            </div>
                                        </div>

                                        {/* Context Toggles */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <Users size={18} className="text-indigo-400" />
                                                    <div>
                                                        <h4 className="text-sm font-medium text-slate-200">Friends Broadcasts</h4>
                                                        <p className="text-[10px] text-slate-500">Auto-download from connections and followed users</p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => setCurrentMediaSettings(prev => ({ ...prev, autoDownloadFriends: !prev.autoDownloadFriends }))}
                                                    className={`w-10 h-5 rounded-full p-0.5 transition-colors ${currentMediaSettings.autoDownloadFriends ? 'bg-indigo-500' : 'bg-slate-700'}`}
                                                >
                                                    <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${currentMediaSettings.autoDownloadFriends ? 'translate-x-5' : 'translate-x-0'}`} />
                                                </button>
                                            </div>

                                            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <Lock size={18} className="text-emerald-400" />
                                                    <div>
                                                        <h4 className="text-sm font-medium text-slate-200">Private Chats</h4>
                                                        <p className="text-[10px] text-slate-500">Auto-download in DMs & Groups</p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => setCurrentMediaSettings(prev => ({ ...prev, autoDownloadPrivate: !prev.autoDownloadPrivate }))}
                                                    className={`w-10 h-5 rounded-full p-0.5 transition-colors ${currentMediaSettings.autoDownloadPrivate ? 'bg-emerald-500' : 'bg-slate-700'}`}
                                                >
                                                    <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${currentMediaSettings.autoDownloadPrivate ? 'translate-x-5' : 'translate-x-0'}`} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Relay Cache Settings - Always Visible */}
                                <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Database size={18} className="text-blue-400" />
                                        <div>
                                            <h4 className="text-sm font-medium text-slate-200">Cache Relayed Media</h4>
                                            <p className="text-[10px] text-slate-500">Save copies of media you help others download. Disable to save space (Ephemeral Relay).</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setCurrentMediaSettings(prev => ({ ...prev, cacheRelayedMedia: !prev.cacheRelayedMedia }))}
                                        className={`w-10 h-5 rounded-full p-0.5 transition-colors ${currentMediaSettings.cacheRelayedMedia ? 'bg-blue-500' : 'bg-slate-700'}`}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${currentMediaSettings.cacheRelayedMedia ? 'translate-x-5' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Content Filtering (Refactored) */}
                        <div className="bg-slate-900 rounded-xl border border-rose-900/30 p-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                                <AlertTriangle size={120} className="text-rose-500" />
                            </div>
                            <div className="flex items-center space-x-3 mb-6 border-b border-slate-800 pb-2 relative z-10">
                                <ShieldAlert className="text-rose-500" size={24} />
                                <h2 className="text-lg font-bold text-white">Content Filtering</h2>
                            </div>
                            <div className="relative z-10">
                                <div className="bg-rose-950/20 border border-rose-900/50 p-4 rounded-xl mb-4">
                                    <h5 className="text-rose-400 font-bold text-xs flex items-center gap-2 mb-1"><AlertTriangle size={12} /> WARNING</h5>
                                    <p className="text-[10px] text-rose-300/80 leading-relaxed">
                                        Enabling interaction with community flagged content allows you to view and engage with broadcasts that have been flagged by the community (2/3+ negative feedback). Proceed with caution.
                                    </p>
                                </div>

                                <div className="flex items-center justify-between bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                                    <div>
                                        <p className="text-sm font-medium text-white">Allow Interaction with Community Flagged Content</p>
                                        <p className="text-xs text-slate-500 mt-1">If enabled, you can click to reveal "Soft Blocked" content.</p>
                                    </div>
                                    <button
                                        onClick={() => onUpdateContentSettings && onUpdateContentSettings({ ...contentSettings!, showDownvotedPosts: !contentSettings?.showDownvotedPosts, downvoteThreshold: contentSettings?.downvoteThreshold || -1 })}
                                        className={`w-10 h-5 rounded-full p-0.5 transition-colors ${contentSettings?.showDownvotedPosts ? 'bg-rose-600' : 'bg-slate-700'}`}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${contentSettings?.showDownvotedPosts ? 'translate-x-5' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ---------------- BACKUP TAB ---------------- */}
                {activeTab === 'backup' && user.isAdmin && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                        {/* Data Migration */}
                        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                            <div className="flex items-center space-x-3 mb-6 border-b border-slate-800 pb-2">
                                <HardDrive className="text-indigo-400" size={24} />
                                <h2 className="text-lg font-bold text-white">Data Migration</h2>
                            </div>
                            <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-xl p-6 text-center">
                                <FileArchive className="mx-auto text-indigo-400 mb-3" size={48} />
                                <h3 className="text-white font-bold mb-2">Create Encrypted Backup</h3>
                                <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
                                    Export your entire node state, including keys, contacts, and history.
                                    The backup is encrypted with a generated password.
                                </p>

                                {migrationPassword ? (
                                    <div className="bg-slate-900 p-4 rounded-xl border border-indigo-500 max-w-xs mx-auto animate-in zoom-in-95">
                                        <p className="text-xs text-indigo-400 uppercase font-bold mb-2">Backup Password (Save This!)</p>
                                        <div className="flex items-center justify-between bg-black/50 p-2 rounded border border-slate-700 mb-3">
                                            <code className="text-white font-mono text-sm">{migrationPassword}</code>
                                            <button onClick={copyPassword} className="text-slate-400 hover:text-white"><Copy size={16} /></button>
                                        </div>
                                        <div className="text-xs text-green-400 flex items-center justify-center gap-1">
                                            <Check size={12} /> File Downloaded
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleMigrateUser}
                                        disabled={isMigrating}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 mx-auto transition-colors disabled:opacity-50"
                                    >
                                        {isMigrating ? <Loader2 className="animate-spin" /> : <Download size={20} />}
                                        <span>Generate Backup</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Danger Zone */}
                        <div className="bg-red-950/20 rounded-xl border border-red-900/50 p-6">
                            <div className="flex items-center space-x-3 mb-6 border-b border-red-900/30 pb-2">
                                <AlertTriangle className="text-red-500" size={24} />
                                <h2 className="text-lg font-bold text-red-500">Danger Zone</h2>
                            </div>
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-white font-bold">Factory Reset Node</h3>
                                    <p className="text-red-400/70 text-sm">Wipes all data, keys, and identity. Irreversible.</p>
                                </div>
                                <button
                                    onClick={handleFactoryReset}
                                    className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors"
                                >
                                    Reset Everything
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modals */}
                {showNodeIdentity && user.isAdmin && <IdentityModal type="node" data={{ id: user.homeNodeOnion || 'offline', name: "My Local Node" }} onClose={() => setShowNodeIdentity(false)} />}
                {showScanner && <QRScanner onScan={parseDeepLink} onClose={() => setShowScanner(false)} />}
                {nodeInfoTarget && <NodeInfoModal target={nodeInfoTarget} onClose={() => setNodeInfoTarget(null)} onConnect={onAddPeer} onForget={onRemovePeer} onBlock={onBlockPeer} onSync={handleSyncPeer} />}

            </div >

            {/* Sticky Footer */}
            < div className="p-4 border-t border-slate-800 bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-slate-900/60 flex justify-between items-center z-10 shrink-0" >
                <span className="text-sm text-slate-500 hidden md:block">Configuration changes require a save to propagate.</span>
                <button onClick={handleSaveProfile} disabled={isSaving} className="bg-onion-600 hover:bg-onion-500 text-white px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 transition-all disabled:opacity-50 shadow-lg shadow-onion-900/20 ml-auto">
                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    <span>Save Changes</span>
                </button>
            </div >

        </div >
    );
};

export default NodeSettings;
