
import React, { useState, useMemo } from 'react';
import { X, UserPlus, MessageSquare, Shield, Globe, Users, UserCheck, Bell, LogOut, Power, Heart, BarChart3, ThumbsUp } from 'lucide-react';
import { UserProfile, Contact, Post } from '../types';
import { formatUserIdentity } from '../utils';

export interface UserInfoTarget {
    id: string;
    displayName: string;
    avatarUrl?: string;
    username?: string;
    homeNode?: string; // Optional if not known yet
    bio?: string; // Optional from Feed/Post
    followersCount?: number;
}

interface UserInfoModalProps {
    target: UserInfoTarget;
    currentUser: UserProfile;
    isContact: boolean;
    isFollowing: boolean;
    onClose: () => void;
    onConnect: (target: UserInfoTarget) => void;
    onFollow: (targetId: string, targetNode?: string) => void;
    onUnfollow: (targetId: string, targetNode?: string) => void;
    onMessage: (contactId: string) => void;
    onViewPosts: (userId: string) => void;
    onLogout?: () => void;
    onShutdown?: () => void;
    posts?: Post[]; // Passed from parent to calculate stats
}

const UserInfoModal: React.FC<UserInfoModalProps> = ({ 
    target, currentUser, isContact, isFollowing, onClose, onConnect, onFollow, onUnfollow, onMessage, onViewPosts, onLogout, onShutdown, posts = []
}) => {
    const isMe = target.id === currentUser.id;
    const [localFollowState, setLocalFollowState] = useState(isFollowing);

    const handleFollowToggle = () => {
        if (localFollowState) {
            onUnfollow(target.id, target.homeNode);
        } else {
            onFollow(target.id, target.homeNode);
        }
        setLocalFollowState(!localFollowState);
    };

    // Calculate Dynamic Stats
    const stats = useMemo(() => {
        const userPosts = posts.filter(p => p.authorId === target.id);
        const broadcastCount = userPosts.length;
        const karma = userPosts.reduce((acc, p) => acc + Object.values(p.votes).filter(v => v === 'up').length, 0);
        return { broadcastCount, karma };
    }, [posts, target.id]);

    // Determine followers count to display
    const followersDisplay = isMe 
        ? (currentUser.followersCount || 0) 
        : (target.followersCount !== undefined ? target.followersCount : 'Unknown');

    const followingDisplay = isMe
        ? (currentUser.followingIds?.length || 0)
        : null; 

    // Handle Identity Split
    const identityString = isMe ? currentUser.username : (target.username || target.displayName);
    const { handle, suffix } = formatUserIdentity(identityString);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 relative">
                
                {/* Close Button */}
                <button 
                    onClick={onClose} 
                    className="absolute top-3 right-3 text-slate-500 hover:text-white p-1 rounded-full hover:bg-slate-800 transition-colors z-10"
                >
                    <X size={20} />
                </button>

                <div className="p-6 pt-8">
                    {/* Profile Header Row */}
                    <div className="flex gap-5 mb-4">
                        {/* Avatar Left */}
                        <div className="shrink-0">
                            {target.avatarUrl ? (
                                <img 
                                    src={target.avatarUrl} 
                                    alt={target.displayName} 
                                    className="w-20 h-20 rounded-full bg-slate-800 object-cover border border-slate-700 shadow-md" 
                                />
                            ) : (
                                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-onion-400 to-indigo-600 flex items-center justify-center text-3xl font-bold text-white shadow-md border border-slate-700">
                                    {handle.charAt(0)}
                                </div>
                            )}
                        </div>

                        {/* Info Right */}
                        <div className="flex-1 min-w-0 pt-1">
                            <h2 className="text-xl font-bold text-white truncate flex items-center gap-1">
                                {handle}
                                {isContact && <Shield size={14} className="text-emerald-500 shrink-0" />}
                            </h2>
                            <p className="text-slate-500 text-sm truncate flex items-center">
                                <span className="opacity-70 font-mono">{suffix}</span>
                            </p>
                            
                            {target.homeNode && (
                                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400 bg-slate-800/50 px-2 py-1 rounded w-fit max-w-full">
                                    <Globe size={10} className="shrink-0 text-onion-400" />
                                    <span className="truncate font-mono">{target.homeNode}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Bio */}
                    {target.bio && (
                        <div className="mb-5 text-sm text-slate-300 leading-relaxed italic">
                            "{target.bio}"
                        </div>
                    )}

                    {/* Stats Grid - Enhanced */}
                    <div className="grid grid-cols-3 gap-2 border-t border-b border-slate-800 py-4 mb-5">
                        <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-white font-bold">
                                <Heart size={14} className="text-pink-500" />
                                {followersDisplay}
                            </div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-1">Followers</div>
                        </div>
                        <div className="text-center border-l border-slate-800">
                            <div className="flex items-center justify-center gap-1 text-white font-bold">
                                <BarChart3 size={14} className="text-indigo-400" />
                                {stats.broadcastCount}
                            </div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-1">Broadcasts</div>
                        </div>
                        <div className="text-center border-l border-slate-800">
                            <div className="flex items-center justify-center gap-1 text-white font-bold">
                                <ThumbsUp size={14} className="text-emerald-400" />
                                {stats.karma}
                            </div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-1">Karma</div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-3">
                        {isMe ? (
                            <>
                                <button className="w-full py-2 bg-slate-800 text-slate-400 rounded-xl text-xs font-medium cursor-default border border-slate-800">
                                    This is your public identity
                                </button>
                                <div className={`grid gap-3 pt-1 ${onShutdown ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                    {onLogout && (
                                        <button 
                                            onClick={onLogout}
                                            className="flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm transition-colors border border-slate-700 font-medium"
                                        >
                                            <LogOut size={16} /> Logout
                                        </button>
                                    )}
                                    {onShutdown && (
                                        <button 
                                            onClick={onShutdown}
                                            className="flex items-center justify-center gap-2 py-2.5 bg-red-950/30 hover:bg-red-900/50 text-red-400 rounded-xl text-sm transition-colors border border-red-900/30 font-medium"
                                        >
                                            <Power size={16} /> Shutdown
                                        </button>
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex gap-3">
                                    {!isContact ? (
                                        <button 
                                            onClick={() => onConnect(target)}
                                            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-900/20"
                                        >
                                            <UserPlus size={16} /> Connect
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={() => onMessage(target.id)}
                                            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-indigo-900/20"
                                        >
                                            <MessageSquare size={16} /> Message
                                        </button>
                                    )}
                                    
                                    <button 
                                        onClick={handleFollowToggle}
                                        className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                                            localFollowState 
                                            ? 'bg-slate-800 text-slate-300 hover:text-white border border-slate-700' 
                                            : 'bg-onion-600 hover:bg-onion-500 text-white shadow-lg shadow-onion-900/20'
                                        }`}
                                    >
                                        {localFollowState ? <UserCheck size={16} /> : <Bell size={16} />}
                                        {localFollowState ? 'Following' : 'Follow'}
                                    </button>
                                </div>

                                <button 
                                    onClick={() => onViewPosts(target.id)}
                                    className="w-full py-2.5 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Globe size={16} /> View Public Posts
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UserInfoModal;
