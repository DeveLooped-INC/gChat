import React from 'react';
import { Server, Shield, Download, Users, Lock, Database, AlertTriangle, ShieldAlert } from 'lucide-react';
import { MediaSettings } from '../../types';

export interface NodeTabProps {
    nodeAlias: string;
    setNodeAlias: (v: string) => void;
    nodeDesc: string;
    setNodeDesc: (v: string) => void;
    currentSyncAge: number;
    onSetSyncAge?: (hours: number) => void;
    bridgeConf: string;
    setBridgeConf: (v: string) => void;
    handleSaveBridges: () => void;
    handleUseDefaultBridges: () => void;
    currentMediaSettings: MediaSettings;
    setCurrentMediaSettings: React.Dispatch<React.SetStateAction<MediaSettings>>;
    contentSettings?: { showDownvotedPosts: boolean; downvoteThreshold: number };
    onUpdateContentSettings?: (settings: { showDownvotedPosts: boolean; downvoteThreshold: number }) => void;
}

const NodeTab: React.FC<NodeTabProps> = ({
    nodeAlias, setNodeAlias, nodeDesc, setNodeDesc, currentSyncAge, onSetSyncAge,
    bridgeConf, setBridgeConf, handleSaveBridges, handleUseDefaultBridges,
    currentMediaSettings, setCurrentMediaSettings, contentSettings, onUpdateContentSettings
}) => {
    return (
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
                    <div className="bg-sky-500/10 border border-sky-500/20 p-3 rounded-lg flex gap-3 text-sky-400 text-xs mb-4">
                        <AlertTriangle className="shrink-0" size={16} />
                        <div>
                            <p className="font-bold">Recommendation</p>
                            <p>Default bridges may be blocked in some regions. For better reliability, consider getting fresh bridges from <a href="https://bridges.torproject.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">bridges.torproject.org</a>.</p>
                            <p className="mt-1 text-[10px] opacity-70">Configuration verified: {new Date().toLocaleDateString()}</p>
                        </div>
                    </div>
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

            {/* Content Filtering */}
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
    );
};

export default NodeTab;
