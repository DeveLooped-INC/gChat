
import React, { useState } from 'react';
import { X, Server, Activity, Clock, Shield, Globe, HardDrive, Zap, Info, MapPin, Trash2, RefreshCw, Plus, XCircle } from 'lucide-react';
import UserInfoModal, { UserInfoTarget } from './UserInfoModal';
import { formatUserIdentity } from '../utils';

export interface NodeInfoTarget {
    address: string;
    alias?: string;
    description?: string;
    status?: 'online' | 'offline' | 'unknown';
    type: 'trusted' | 'discovered' | 'pending' | 'blocked';
    latency?: number;
    hops?: number;
    lastSeen?: number;
    via?: string;
}

interface NodeInfoModalProps {
    target: NodeInfoTarget;
    onClose: () => void;
    onConnect?: (address: string) => void;
    onForget?: (address: string) => void;
    onBlock?: (address: string) => void;
    onSync?: (address: string) => void;
}

const NodeInfoModal: React.FC<NodeInfoModalProps> = ({ target, onClose, onConnect, onForget, onBlock, onSync }) => {
    const [userInfoTarget, setUserInfoTarget] = useState<UserInfoTarget | null>(null);

    const timeAgo = (timestamp?: number) => {
        if (!timestamp) return 'Never';
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    };

    const getStatusColor = () => {
        if (target.status === 'online') return 'text-emerald-400';
        if (target.status === 'offline') return 'text-red-400';
        return 'text-amber-400';
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 relative flex flex-col">

                {/* Header */}
                <div className="p-6 pb-4 bg-slate-950/50 border-b border-slate-800 flex justify-between items-start">
                    <div className="flex gap-4 items-center">
                        <div className={`p-3 rounded-xl border ${target.status === 'online' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-800 border-slate-700'}`}>
                            <Server size={24} className={getStatusColor()} />
                        </div>
                        <div>
                            {target.description ? (
                                <div
                                    className="flex items-center gap-2 cursor-pointer group"
                                    onClick={() => setUserInfoTarget({
                                        id: target.address, // We use address as ID if we don't have real ID, handled by read-only mode in UserInfoModal ideally, specific User Info retrieval logic might differ. 
                                        // Wait, extracting username from description? Or is handled by parent?
                                        // "description" field in discovered node usually contains username if available.
                                        displayName: target.alias || "Unknown",
                                        username: target.description, // Assuming description holds the username/handle
                                        homeNode: target.address,
                                        avatarUrl: `https://robohash.org/${target.description || target.address}?set=set4&bgset=bg2&size=100x100`
                                    })}
                                >
                                    <img
                                        src={`https://robohash.org/${target.description || target.address}?set=set4&bgset=bg2&size=100x100`}
                                        className="w-8 h-8 rounded-full border border-slate-600 group-hover:border-onion-400 transition-colors"
                                        alt="Admin"
                                    />
                                    <div>
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2 group-hover:text-onion-400 transition-colors">
                                            {target.alias || "Unknown Node"}
                                            {target.type === 'trusted' && <Shield size={16} className="text-emerald-500" />}
                                        </h2>
                                    </div>
                                </div>
                            ) : (
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    {target.alias || "Unknown Node"}
                                    {target.type === 'trusted' && <Shield size={16} className="text-emerald-500" />}
                                </h2>
                            )}

                            <p className="text-xs font-mono text-slate-400 mt-1 break-all max-w-[200px]">
                                {target.address}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white p-1 hover:bg-slate-800 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 flex-1 overflow-y-auto">

                    {/* Description */}
                    {target.description ? (
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                            <p className="text-sm text-slate-300 italic">"{target.description}"</p>
                        </div>
                    ) : (
                        <div className="bg-slate-800/30 p-3 rounded-lg border border-slate-800 border-dashed text-center">
                            <p className="text-xs text-slate-500">No description provided via gossip.</p>
                        </div>
                    )}

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                            <div className="flex items-center gap-2 text-slate-500 text-xs uppercase font-bold mb-1">
                                <Activity size={12} /> Status
                            </div>
                            <div className={`text-sm font-medium ${getStatusColor()}`}>
                                {target.status?.toUpperCase() || 'UNKNOWN'}
                            </div>
                        </div>

                        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                            <div className="flex items-center gap-2 text-slate-500 text-xs uppercase font-bold mb-1">
                                <Zap size={12} /> Latency
                            </div>
                            <div className="text-sm font-medium text-slate-200">
                                {target.latency ? `${target.latency}ms` : 'N/A'}
                            </div>
                        </div>

                        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                            <div className="flex items-center gap-2 text-slate-500 text-xs uppercase font-bold mb-1">
                                <Globe size={12} /> Distance
                            </div>
                            <div className="text-sm font-medium text-slate-200">
                                {target.hops !== undefined ? `${target.hops} Hop(s)` : 'Direct'}
                            </div>
                        </div>

                        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                            <div className="flex items-center gap-2 text-slate-500 text-xs uppercase font-bold mb-1">
                                <Clock size={12} /> Last Seen
                            </div>
                            <div className="text-sm font-medium text-slate-200">
                                {timeAgo(target.lastSeen)}
                            </div>
                        </div>
                    </div>

                    {/* Routing Info */}
                    {target.via && (
                        <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-900 p-2 rounded border border-slate-800">
                            <MapPin size={12} />
                            <span>Routed via: <span className="font-mono text-slate-400">{target.via.substring(0, 16)}...</span></span>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-slate-800 bg-slate-950/50 grid grid-cols-2 gap-3">
                    {target.type === 'trusted' ? (
                        <>
                            <button
                                onClick={() => onSync && onSync(target.address)}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors col-span-2"
                            >
                                <RefreshCw size={16} /> Sync Inventory
                            </button>
                            <button
                                onClick={() => { onClose(); onForget && onForget(target.address); }}
                                className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors border border-slate-700"
                            >
                                <Trash2 size={16} /> Forget
                            </button>
                            <button
                                onClick={() => { onClose(); onBlock && onBlock(target.address); }}
                                className="bg-slate-800 hover:bg-red-900/30 text-slate-400 hover:text-red-400 py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors border border-slate-700"
                            >
                                <XCircle size={16} /> Block
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => { onClose(); onConnect && onConnect(target.address); }}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors col-span-2 shadow-lg shadow-emerald-900/20"
                            >
                                <Plus size={16} /> Connect to Node
                            </button>
                            <button
                                onClick={() => { onClose(); onBlock && onBlock(target.address); }}
                                className="bg-slate-800 hover:bg-red-900/30 text-slate-400 hover:text-red-400 py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors border border-slate-700 col-span-2"
                            >
                                <XCircle size={16} /> Block
                            </button>
                        </>
                    )}
                </div>
            </div>
            {userInfoTarget && (
                <UserInfoModal
                    target={userInfoTarget}
                    currentUser={{ id: 'observer', username: 'Observer', displayName: 'Observer', bio: '', keys: {} as any, isAdmin: false, homeNodeOnion: '', createdAt: 0, followersCount: 0, followingIds: [], privacySettings: {} as any }}
                    isContact={false}
                    isFollowing={false}
                    onClose={() => setUserInfoTarget(null)}
                    onConnect={() => { }}
                    onFollow={() => { }}
                    onUnfollow={() => { }}
                    onMessage={() => { }}
                    onViewPosts={() => { }}
                />
            )}
        </div>
    );
};

export default NodeInfoModal;
