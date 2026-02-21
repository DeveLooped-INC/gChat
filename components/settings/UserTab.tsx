import React from 'react';
import { User, Camera, ShieldCheck, Lock, Globe, Eye, EyeOff, ToggleRight, ToggleLeft, Key, Download } from 'lucide-react';
import { UserProfile, PrivacySettings } from '../../types';

export interface UserTabProps {
    user: UserProfile;
    displayName: string;
    setDisplayName: (v: string) => void;
    bio: string;
    setBio: (v: string) => void;
    avatarUrl: string;
    handleAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    isDiscoverable: boolean;
    setIsDiscoverable: (v: boolean) => void;
    privacySettings: PrivacySettings;
    updatePrivacy: (key: keyof PrivacySettings, value: boolean) => void;
    onExportKeys?: () => void;
    currentSuffix: string;
    themeName: string | null;
    setThemeName: (v: string | null) => void;
}

const UserTab: React.FC<UserTabProps> = ({
    user, displayName, setDisplayName, bio, setBio, avatarUrl, handleAvatarUpload,
    isDiscoverable, setIsDiscoverable, privacySettings, updatePrivacy, onExportKeys, currentSuffix, themeName, setThemeName
}) => {
    return (
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
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className="block text-xs font-medium text-slate-500 mb-1 uppercase">Bio / Status</label>
                                <textarea
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-onion-500 transition-colors resize-none h-24"
                                />
                            </div>
                            <div className="w-1/3">
                                <label className="block text-xs font-medium text-slate-500 mb-1 uppercase">App Theme</label>
                                <select
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-onion-500 transition-colors h-[42px]"
                                    value={themeName || 'default'}
                                    onChange={(e) => {
                                        const val = e.target.value === 'default' ? null : e.target.value;
                                        setThemeName(val);
                                    }}
                                >
                                    <option value="default">Default Dark</option>
                                    <option value="dark-neon">Neon Dark</option>
                                </select>
                            </div>
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
                    <div onClick={() => updatePrivacy('isPrivateProfile', !privacySettings.isPrivateProfile)} role="switch" tabIndex={0} aria-checked={privacySettings.isPrivateProfile} onKeyDown={e => e.key === 'Enter' && updatePrivacy('isPrivateProfile', !privacySettings.isPrivateProfile)} className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${privacySettings.isPrivateProfile ? 'bg-indigo-900/20 border-indigo-500/50' : 'bg-slate-950 border-slate-800 hover:bg-slate-800'}`}>
                        <div className="flex items-center gap-3">
                            {privacySettings.isPrivateProfile ? <Lock size={20} className="text-indigo-400" /> : <Globe size={20} className="text-slate-500" />}
                            <div><h3 className="text-slate-200 font-bold text-sm">Private Account</h3><p className="text-xs text-slate-500">{privacySettings.isPrivateProfile ? "Only contacts see details" : "Publicly visible"}</p></div>
                        </div>
                        {privacySettings.isPrivateProfile ? <ToggleRight size={24} className="text-indigo-500" /> : <ToggleLeft size={24} className="text-slate-600" />}
                    </div>

                    {user.isAdmin && (
                        <div onClick={() => setIsDiscoverable(!isDiscoverable)} role="switch" tabIndex={0} aria-checked={isDiscoverable} onKeyDown={e => e.key === 'Enter' && setIsDiscoverable(!isDiscoverable)} className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${isDiscoverable ? 'bg-onion-900/20 border-onion-500/50' : 'bg-slate-950 border-slate-800 hover:bg-slate-800'}`}>
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
    );
};

export default UserTab;
