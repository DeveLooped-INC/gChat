import React, { useRef, useState, useEffect } from 'react';
import { Activity, BarChart3, ThumbsUp, ThumbsDown, Users, Heart, Info, Plus, Camera, Trash2, RefreshCw, XCircle, RadioReceiver, Wifi, WifiOff, Power, Shield, Terminal, Database } from 'lucide-react';
import { UserProfile, NodePeer, AvailablePeer, LogEntry, StorageStats, NotificationCategory } from '../../types';
import { NodeInfoTarget } from '../NodeInfoModal';

export interface DashboardTabProps {
    user: UserProfile;
    peers: NodePeer[];
    pendingPeers: string[];
    discoveredPeers: AvailablePeer[];
    isOnline: boolean;
    userStats: { totalPosts: number; likes: number; dislikes: number; connections: number; followers: number };
    newPeerOnion: string;
    setNewPeerOnion: (v: string) => void;
    onAddPeerLocal: () => void;
    onRemovePeer: (onion: string) => void;
    onBlockPeer?: (onion: string) => void;
    onAddPeer: (onion: string) => void;
    onToggleNetwork: () => void;
    handleSyncPeer: (onion: string) => void;
    setNodeInfoTarget: (t: NodeInfoTarget | null) => void;
    setShowScanner: (v: boolean) => void;
    bridgeConf: string;
    torStats: { circuits: number; guards: number; status: string };
    storageStats: StorageStats[];
    showLogs: boolean;
    setShowLogs: (v: boolean) => void;
    systemLogs: LogEntry[];
}

const DashboardTab: React.FC<DashboardTabProps> = ({
    user, peers, pendingPeers, discoveredPeers, isOnline, userStats,
    newPeerOnion, setNewPeerOnion, onAddPeerLocal, onRemovePeer, onBlockPeer, onAddPeer,
    onToggleNetwork, handleSyncPeer, setNodeInfoTarget, setShowScanner,
    bridgeConf, torStats, storageStats, showLogs, setShowLogs, systemLogs
}) => {
    const logContainerRef = useRef<HTMLDivElement>(null);
    const [isUserScrolling, setIsUserScrolling] = useState(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const totalVotes = (userStats.likes + userStats.dislikes) || 1;
    const avgScore = Math.round((userStats.likes / totalVotes) * 100);

    useEffect(() => {
        if (showLogs && logContainerRef.current && !isUserScrolling) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [systemLogs, showLogs, isUserScrolling]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
        if (!isAtBottom) {
            setIsUserScrolling(true);
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = setTimeout(() => setIsUserScrolling(false), 5000);
        } else {
            setIsUserScrolling(false);
        }
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            {/* Stats Grid */}
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

            {/* Peer Management */}
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
                            <button onClick={onAddPeerLocal} className="bg-slate-800 hover:bg-slate-700 text-white px-4 rounded-lg flex items-center"><Plus size={18} /></button>
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

                        {/* Discovered Peers */}
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

                        {/* Pending Signals */}
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
                            <div key={item.category} style={{ width: `${(item.sizeMB / Math.max(1, storageStats.reduce((a, b) => a + b.sizeMB, 0))) * 100}%`, backgroundColor: item.color }} title={`${item.category}: ${item.sizeMB.toFixed(2)} MB`} />
                        ))}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {storageStats.map((item, i) => (
                            <div key={item.category} className="flex items-center gap-2">
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
                            <div key={`${log.timestamp}-${i}`} className="mb-1 break-all flex gap-2">
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
    );
};

export default DashboardTab;
