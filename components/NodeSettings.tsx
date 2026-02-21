import React, { useState, useEffect, useRef } from 'react';
import { Server, Save, Loader2, QrCode, LayoutDashboard, UserCog, Settings as SettingsIcon, SaveAll } from 'lucide-react';
import { UserProfile, NodePeer, ToastMessage, LogEntry, AvailablePeer, PrivacySettings, StorageStats, Post, Message, Contact, NotificationCategory, MediaSettings } from '../types';
import { networkService, TorStats } from '../services/networkService';
import IdentityModal from './IdentityModal';
import QRScanner from './QRScanner';
import { createMigrationPackage } from '../services/migrationService';
import NodeInfoModal, { NodeInfoTarget } from './NodeInfoModal';
import { formatUserIdentity, calculateObjectSize } from '../utils';
import { storageService } from '../services/storage';
import { clearMediaCache } from '../services/mediaStorage';
import DashboardTab from './settings/DashboardTab';
import UserTab from './settings/UserTab';
import NodeTab from './settings/NodeTab';
import BackupTab from './settings/BackupTab';

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
    onUpdateProfile: (user: UserProfile) => void;
    onExportKeys?: () => void;
    addToast: (title: string, message: string, type: ToastMessage['type'], category?: NotificationCategory) => void;
    onSetSyncAge?: (hours: number) => void;
    currentSyncAge?: number;
    data?: { posts: Post[]; messages: Message[]; contacts: Contact[] };
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
                { category: 'Messages', sizeMB: (messagesSize - mediaSize * 0.5) / (1024 * 1024), color: '#818cf8' },
                { category: 'Feed DB', sizeMB: (feedSize - mediaSize * 0.5) / (1024 * 1024), color: '#34d399' },
                { category: 'Media', sizeMB: mediaSize / (1024 * 1024), color: '#fbbf24' },
                { category: 'System', sizeMB: 0.5, color: '#f87171' },
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

    const handleAddPeer = () => {
        if (newPeerOnion.trim()) {
            onAddPeer(newPeerOnion.trim());
            setNewPeerOnion('');
        }
    };

    const handleSyncPeer = (onion: string) => {
        if (onSyncPeer) {
            onSyncPeer(onion);
            addToast('Sync Initiated', `Requesting state from ${onion.substring(0, 12)}...`, 'info');
        } else {
            addToast('Error', 'Sync not available', 'error');
        }
    };

    const parseDeepLink = (url: string) => {
        try {
            const parsed = new URL(url);
            if (parsed.protocol === 'gchat:') {
                const action = parsed.hostname;
                if (action === 'add-peer') {
                    const onion = parsed.searchParams.get('address');
                    if (onion) { onAddPeer(onion); addToast('Peer Added', `From QR: ${onion.substring(0, 16)}...`, 'success'); }
                } else if (action === 'add-contact') {
                    const pubKey = parsed.searchParams.get('pubkey');
                    const homeNode = parsed.searchParams.get('node');
                    if (pubKey && homeNode) { addToast('Contact Added', `From QR scan`, 'success'); }
                }
            }
        } catch (e) {
            addToast('Error', 'Invalid QR Code data', 'error');
        }
        setShowScanner(false);
    };

    const handleSaveProfile = async () => {
        setIsSaving(true);
        try {
            const updatedUser: UserProfile = {
                ...user,
                displayName,
                bio,
                avatarUrl,
                isDiscoverable,
                privacySettings
            };

            onUpdateProfile(updatedUser);
            if (onUpdateNodeConfig) onUpdateNodeConfig(nodeAlias, nodeDesc);
            if (onUpdateMediaSettings) onUpdateMediaSettings(currentMediaSettings);
            addToast('Settings Saved', 'Your profile and node configuration have been updated.', 'success');
        } catch (e) {
            addToast('Error', 'Failed to save settings', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 500000) { addToast('Error', 'Avatar too large (max 500KB)', 'error'); return; }

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxSize = 128;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
                } else {
                    if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

                if (dataUrl.length > 200000) {
                    addToast('Error', 'Compressed avatar still too large', 'error');
                    return;
                }
                setAvatarUrl(dataUrl);
                addToast('Avatar Updated', 'Click Save to apply', 'info');
            };
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
    };

    const handleFactoryReset = () => {
        if (window.confirm('FACTORY RESET: This will permanently delete ALL data including your identity, contacts, messages, and encryption keys. This cannot be undone. Continue?')) {
            storageService.deleteEverything();
            clearMediaCache();
            localStorage.clear();
            window.location.reload();
        }
    };

    const handleMigrateUser = async () => {
        setIsMigrating(true);
        try {
            const result = await createMigrationPackage();
            setMigrationPassword(result.password);

            const url = URL.createObjectURL(result.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gchat_backup_${user.username}_${Date.now()}.enc`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            addToast('Error', 'Migration failed', 'error');
        } finally {
            setIsMigrating(false);
        }
    };

    const copyPassword = () => { if (migrationPassword) { navigator.clipboard.writeText(migrationPassword); setPasswordCopied(true); setTimeout(() => setPasswordCopied(false), 2000); } };
    const updatePrivacy = (key: keyof PrivacySettings, value: boolean) => { setPrivacySettings(prev => ({ ...prev, [key]: value })); };

    const TabButton = ({ id, label, icon: Icon }: { id: SettingsTab, label: string, icon: any }) => (
        <button
            onClick={() => setActiveTab(id)}
            title={label}
            className={`flex items-center gap-2 px-3 sm:px-4 py-3 border-b-2 transition-colors ${activeTab === id
                ? 'border-onion-500 text-onion-400 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
        >
            <Icon size={16} />
            <span className="hidden sm:inline">{label}</span>
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

                {activeTab === 'dashboard' && (
                    <DashboardTab
                        user={user}
                        peers={peers}
                        pendingPeers={pendingPeers}
                        discoveredPeers={discoveredPeers}
                        isOnline={isOnline}
                        userStats={userStats}
                        newPeerOnion={newPeerOnion}
                        setNewPeerOnion={setNewPeerOnion}
                        onAddPeerLocal={handleAddPeer}
                        onRemovePeer={onRemovePeer}
                        onBlockPeer={onBlockPeer}
                        onAddPeer={onAddPeer}
                        onToggleNetwork={onToggleNetwork}
                        handleSyncPeer={handleSyncPeer}
                        setNodeInfoTarget={setNodeInfoTarget}
                        setShowScanner={setShowScanner}
                        bridgeConf={bridgeConf}
                        torStats={torStats}
                        storageStats={storageStats}
                        showLogs={showLogs}
                        setShowLogs={setShowLogs}
                        systemLogs={systemLogs}
                    />
                )}

                {activeTab === 'user' && (
                    <UserTab
                        user={user}
                        displayName={displayName}
                        setDisplayName={setDisplayName}
                        bio={bio}
                        setBio={setBio}
                        avatarUrl={avatarUrl}
                        handleAvatarUpload={handleAvatarUpload}
                        isDiscoverable={isDiscoverable}
                        setIsDiscoverable={setIsDiscoverable}
                        privacySettings={privacySettings}
                        updatePrivacy={updatePrivacy}
                        onExportKeys={onExportKeys}
                        currentSuffix={currentSuffix}
                    />
                )}

                {activeTab === 'node' && user.isAdmin && (
                    <NodeTab
                        nodeAlias={nodeAlias}
                        setNodeAlias={setNodeAlias}
                        nodeDesc={nodeDesc}
                        setNodeDesc={setNodeDesc}
                        currentSyncAge={currentSyncAge}
                        onSetSyncAge={onSetSyncAge}
                        bridgeConf={bridgeConf}
                        setBridgeConf={setBridgeConf}
                        handleSaveBridges={handleSaveBridges}
                        handleUseDefaultBridges={handleUseDefaultBridges}
                        currentMediaSettings={currentMediaSettings}
                        setCurrentMediaSettings={setCurrentMediaSettings}
                        contentSettings={contentSettings}
                        onUpdateContentSettings={onUpdateContentSettings}
                    />
                )}

                {activeTab === 'backup' && user.isAdmin && (
                    <BackupTab
                        migrationPassword={migrationPassword}
                        isMigrating={isMigrating}
                        passwordCopied={passwordCopied}
                        handleMigrateUser={handleMigrateUser}
                        copyPassword={copyPassword}
                        handleFactoryReset={handleFactoryReset}
                    />
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
