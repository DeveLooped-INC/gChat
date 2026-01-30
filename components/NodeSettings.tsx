
import React, { useState, useEffect, useRef } from 'react';
import { Power, Wifi, User, Terminal, Download, Server, Trash2, Plus, Save, Loader2, RefreshCw, Key, Eye, EyeOff, ToggleRight, ToggleLeft, QrCode, Upload, AlertTriangle, Activity, ShieldCheck, Zap, XCircle, CheckSquare, LogOut, HardDrive, FileArchive, Copy, Check, MapPin, Globe, Clock, Lock, Users, BarChart3, ThumbsUp, ThumbsDown, Info, Play, Pause, Camera, WifiOff, Database, Radio, Heart, RadioReceiver } from 'lucide-react';
import { UserProfile, NodePeer, ToastMessage, LogEntry, AvailablePeer, PrivacySettings, StorageStats, Post, Message, Contact, NotificationCategory } from '../types';
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
}

const NodeSettings: React.FC<NodeSettingsProps> = ({
    user, peers, pendingPeers = [], discoveredPeers = [], nodeConfig, isOnline, userStats, onAddPeer, onRemovePeer, onBlockPeer, onSyncPeer, onUpdateNodeConfig, onToggleNetwork, onUpdateProfile, onExportKeys, addToast, onSetSyncAge, currentSyncAge = 24, data
}) => {
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
            setIsSaving(false);
            addToast("Settings Updated", "Your new identity is propagating.", 'success');
        }, 800);
    };

    const handleRegenerateAvatar = () => {
        const randomSeed = Math.random().toString(36).substring(7);
        setAvatarUrl(`https://robohash.org/${randomSeed}?set=set4&bgset=bg2&size=200x200`);
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

    return (
        <div className="h-full overflow-y-auto w-full max-w-6xl mx-auto p-4 md:p-8 space-y-8 pb-20">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-onion-500/20 rounded-xl">
                        <Server size={32} className="text-onion-500" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">Settings</h1>
                        <p className="text-slate-400 text-sm">Node & User Configuration</p>
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

            {/* 1. Stats Section */}
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

            {/* 2. User Profile Section */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                <div className="flex items-center space-x-3 mb-6 border-b border-slate-800 pb-2">
                    <User className="text-emerald-500" size={24} />
                    <h2 className="text-lg font-bold text-white">User Profile</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="flex flex-col items-center space-y-3">
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="Avatar" className="w-24 h-24 rounded-full bg-slate-800 object-cover shadow-xl border-2 border-onion-500/50" />
                        ) : (
                            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-onion-400 to-indigo-600 flex items-center justify-center text-3xl font-bold text-white shadow-xl">
                                {displayName.charAt(0)}
                            </div>
                        )}
                        <button
                            onClick={handleRegenerateAvatar}
                            className="text-xs text-onion-400 hover:text-onion-300 flex items-center space-x-1 hover:underline transition-all"
                        >
                            <RefreshCw size={12} />
                            <span>Regenerate Avatar</span>
                        </button>
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

                <div className="flex justify-end mt-6">
                    <button onClick={handleSaveProfile} disabled={isSaving} className="bg-onion-600 hover:bg-onion-500 text-white px-6 py-2.5 rounded-lg font-medium flex items-center space-x-2 transition-all disabled:opacity-50 shadow-lg shadow-onion-900/20">{isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}<span>Save Changes</span></button>
                </div>
            </div>

            {/* --- ADMIN NETWORK STATUS --- */}
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
            )}

            {/* --- STORAGE STATS --- */}
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

            {/* ADMIN SECTIONS */}
            {user.isAdmin && (
                <>
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

                    {/* Network & Peers List */}
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
                </>
            )}

            {/* Modals */}
            {showNodeIdentity && user.isAdmin && <IdentityModal type="node" data={{ id: user.homeNodeOnion || 'offline', name: "My Local Node" }} onClose={() => setShowNodeIdentity(false)} />}
            {showScanner && <QRScanner onScan={parseDeepLink} onClose={() => setShowScanner(false)} />}
            {nodeInfoTarget && <NodeInfoModal target={nodeInfoTarget} onClose={() => setNodeInfoTarget(null)} onConnect={onAddPeer} onForget={onRemovePeer} onBlock={onBlockPeer} onSync={handleSyncPeer} />}

        </div>
    );
};

export default NodeSettings;
