import { MESSAGE_RETRY_INTERVAL_MS, HANDSHAKE_RETRY_INTERVAL_MS, GC_INTERVAL_MS } from './constants';
import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import Layout from './components/Layout';
import Onboarding from './components/Onboarding';
import Feed from './components/Feed';
import Chat from './components/Chat';
import Contacts from './components/Contacts';
import NodeSettings from './components/NodeSettings';
import Notifications from './components/Notifications';
import ToastContainer from './components/Toast';
import HelpModal from './components/HelpModal';
import { AppRoute, UserProfile, ToastMessage, NetworkPacket, NotificationItem, NotificationCategory } from './types';
import { networkService } from './services/networkService';
import { signData } from './services/cryptoService';
import { Loader2 } from 'lucide-react';
import UserInfoModal from './components/UserInfoModal';
import { useAppState } from './hooks/useAppState';
import { useNetworkLayer } from './hooks/useNetworkLayer';
import { useActions } from './hooks/useActions';

const USER_STORAGE_KEY = 'gchat_user_profile';

// --- AUTHENTICATED APP ---
const AuthenticatedApp = ({ user, onLogout, onUpdateUser }: { user: UserProfile, onLogout: () => void, onUpdateUser: (u: UserProfile) => void }) => {
    const [activeRoute, setActiveRoute] = useState<AppRoute>(AppRoute.FEED);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [isHelpOpen, setIsHelpOpen] = useState(false);

    // Shutdown State
    const [isShuttingDown, setIsShuttingDown] = useState(false);
    const [shutdownStep, setShutdownStep] = useState('');

    // Sync Settings
    const [maxSyncAgeHours, setMaxSyncAgeHours] = useState(() => {
        const stored = localStorage.getItem('gchat_sync_age');
        return stored ? parseInt(stored, 10) || 148 : 148;
    });

    const handleSetSyncAge = useCallback((hours: number) => {
        setMaxSyncAgeHours(hours);
        localStorage.setItem('gchat_sync_age', hours.toString());
    }, []);

    // Navigation State
    const [feedInitialState, setFeedInitialState] = useState<{ filter: 'public' | 'friends'; authorId?: string; postId?: string } | null>(null);
    const [showUserModal, setShowUserModal] = useState(false);

    // Retry State
    const inflightMessages = React.useRef(new Set<string>());
    const inflightHandshakes = React.useRef(new Set<string>());

    // --- STATE MANAGEMENT HOOK ---
    const state = useAppState(user);

    // --- NAVIGATION & NOTIFICATION HANDLERS ---
    const handleNavigate = useCallback((route: AppRoute) => {
        setActiveRoute(route);
        state.setNotifications(prev => prev.map(n => {
            if (!n.read && n.linkRoute === route) {
                return { ...n, read: true };
            }
            return n;
        }));
    }, [state.setNotifications]);

    const handleNotificationNavigation = useCallback((route?: AppRoute, id?: string) => {
        if (!route) return;
        if (route === AppRoute.CHAT && id) { setActiveChatId(id); handleNavigate(AppRoute.CHAT); }
        else if (route === AppRoute.FEED && id) {
            setFeedInitialState({ filter: 'public', postId: id });
            handleNavigate(AppRoute.FEED);
        }
        else if (route === AppRoute.CONTACTS) { handleNavigate(AppRoute.CONTACTS); }
        else { handleNavigate(route); }
    }, [handleNavigate]);

    const addNotification = useCallback((title: string, message: string, type: ToastMessage['type'], category: NotificationCategory = 'admin', linkRoute?: AppRoute, linkId?: string) => {
        const id = crypto.randomUUID();
        const newNotification: NotificationItem = { id, title, message, type, category, timestamp: Date.now(), read: false, linkRoute, linkId };
        state.setNotifications(prev => [newNotification, ...prev].slice(0, state.notificationSettings.maxCount || 100));


        const action = (linkRoute) ? () => handleNotificationNavigation(linkRoute, linkId) : undefined;

        // Check muted types
        if (!state.notificationSettings.mutedCategories.includes(category)) {
            setToasts(prev => [...prev, { id, title, message, type, category, action }]);
        }
    }, [handleNotificationNavigation, state.setNotifications, state.notificationSettings, state.userRef]);

    const performGracefulShutdown = useCallback(async () => {
        if (isShuttingDown) return;
        setIsShuttingDown(true);
        setShutdownStep('Notifying peers...');
        try {
            const onlinePeers = state.peersRef.current.filter(p => p.status === 'online');
            const onlinePeerAddrs = new Set(onlinePeers.map(p => p.onionAddress));
            await networkService.announceExit(
                onlinePeers.map(p => p.onionAddress),
                state.contactsRef.current
                    .filter(c => c.homeNodes?.some(h => onlinePeerAddrs.has(h)))
                    .map(c => ({ homeNodes: c.homeNodes, id: c.id })),
                state.userRef.current.homeNodeOnion,
                state.userRef.current.id
            );
            setShutdownStep('Closing connections...');
            networkService.confirmShutdown();
        } catch (e) {
            console.error("Shutdown error", e);
            networkService.confirmShutdown();
        }
    }, [isShuttingDown, state.peersRef, state.contactsRef, state.userRef]);

    const handleUpdateUserWrapper = useCallback((updated: UserProfile) => {
        onUpdateUser(updated);

        const packet: NetworkPacket = {
            id: crypto.randomUUID(),
            type: 'IDENTITY_UPDATE',
            senderId: user.homeNodeOnion,
            payload: {
                userId: updated.id,
                displayName: updated.displayName,
                avatarUrl: updated.avatarUrl,
                bio: updated.bio
            }
        };

        state.contactsRef.current.forEach(c => {
            if (c.homeNodes[0]) networkService.sendMessage(c.homeNodes[0], packet);
        });
    }, [onUpdateUser, user.homeNodeOnion, state.contactsRef]);

    // --- NETWORK LAYER HOOK ---
    const {
        isOnline,
        discoveredPeers,
        setDiscoveredPeers,
        pendingNodeRequests,
        setPendingNodeRequests,
        processedPacketIds,
        broadcastPostState
    } = useNetworkLayer({
        user,
        state,
        addNotification,
        onUpdateUser,
        activeChatId,
        maxSyncAgeHours,
        performGracefulShutdown
    });

    // --- EPHEMERAL MESSAGE GARBAGE COLLECTOR ---
    useEffect(() => {
        const gcInterval = setInterval(() => {
            state.pruneMessages();
        }, GC_INTERVAL_MS);
        return () => clearInterval(gcInterval);
    }, [state.pruneMessages]);

    const handleClearNotifications = () => {
        state.setNotifications([]);
    };

    const handleMarkNotificationsRead = () => {
        state.setNotifications(prev => {
            const updated = prev.map(n => ({ ...n, read: true }));
            return updated;
        });
    };

    const handleNotificationClick = (item: NotificationItem) => {
        state.setNotifications(prev => prev.map(n => {
            if (n.id === item.id) {
                const updated = { ...n, read: true };
                return updated;
            }
            return n;
        }));
        if (item.linkRoute) handleNotificationNavigation(item.linkRoute, item.linkId);
    };

    // --- ACTIONS HOOK ---
    const actions = useActions({
        user, state, addNotification, onUpdateUser, isOnline, maxSyncAgeHours,
        processedPacketIds, broadcastPostState, setDiscoveredPeers, setPendingNodeRequests, handleNavigate
    });

    const handleViewUserPosts = useCallback((userId: string) => {
        setFeedInitialState({ filter: 'public', authorId: userId });
        handleNavigate(AppRoute.FEED);
        addNotification('Navigation', 'Switched to Public Feed for user.', 'info', 'admin');
    }, [addNotification, handleNavigate]);

    // --- RETRY EFFECTS ---
    useEffect(() => {
        if (!isOnline) return;
        const retryInterval = setInterval(() => {
            const undelivered = state.messagesRef.current.filter(m => m.isMine && !m.delivered);
            if (undelivered.length === 0) return;

            undelivered.forEach(msg => {
                if (inflightMessages.current.has(msg.id)) return;
                inflightMessages.current.add(msg.id);

                const contact = state.contactsRef.current.find(c => c.id === msg.threadId);
                const group = state.groupsRef.current.find(g => g.id === msg.threadId);

                if (contact && contact.homeNodes[0]) {
                    networkService.sendMessage(contact.homeNodes[0], {
                        id: crypto.randomUUID(), type: 'MESSAGE', senderId: user.homeNodeOnion, targetUserId: contact.id, payload: { id: msg.id, content: msg.content }
                    }).then(ok => {
                        if (ok) state.setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, delivered: true } : m));
                        inflightMessages.current.delete(msg.id);
                    });
                } else if (group) {
                    inflightMessages.current.delete(msg.id);
                } else {
                    inflightMessages.current.delete(msg.id);
                }
            });
        }, MESSAGE_RETRY_INTERVAL_MS);
        return () => clearInterval(retryInterval);
    }, [isOnline, user.homeNodeOnion, state.messagesRef, state.contactsRef, state.groupsRef, state.setMessages]);

    useEffect(() => {
        if (!isOnline) return;
        const handshakeInterval = setInterval(() => {
            const pendingContacts = state.contactsRef.current.filter(c => c.handshakeStatus === 'pending');
            if (pendingContacts.length === 0) return;

            pendingContacts.forEach(contact => {
                if (inflightHandshakes.current.has(contact.id)) return;
                inflightHandshakes.current.add(contact.id);
                const u = state.userRef.current;

                const reqPayload = {
                    id: crypto.randomUUID(),
                    fromUserId: u.id,
                    fromUsername: u.username,
                    fromDisplayName: u.displayName,
                    fromHomeNode: u.homeNodeOnion,
                    fromEncryptionPublicKey: u.keys.encryption.publicKey,
                    timestamp: Date.now(),
                    signature: ''
                };
                reqPayload.signature = signData(reqPayload, u.keys.signing.secretKey);

                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CONNECTION_REQUEST', senderId: u.homeNodeOnion, targetUserId: contact.id, payload: reqPayload };

                if (contact.homeNodes[0]) {
                    networkService.sendMessage(contact.homeNodes[0], packet).then(ok => {
                        if (ok) {
                            state.setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, handshakeStatus: 'completed' as const } : c));
                        }
                        inflightHandshakes.current.delete(contact.id);
                    });
                } else {
                    inflightHandshakes.current.delete(contact.id);
                }
            });
        }, HANDSHAKE_RETRY_INTERVAL_MS);
        return () => clearInterval(handshakeInterval);
    }, [isOnline, state.contactsRef, state.userRef, state.setContacts]);

    // Loading Screen for Async Data
    if (!state.isLoaded) {
        return (
            <div className="h-[100dvh] w-full bg-slate-950 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="animate-spin mb-4 text-onion-500" size={48} />
                <p className="font-mono text-sm">Loading Encrypted Store...</p>
            </div>
        );
    }

    return (
        <Layout
            activeRoute={activeRoute}
            onNavigate={handleNavigate}
            onToggleHelp={() => setIsHelpOpen(!isHelpOpen)}
            onLogout={onLogout}
            onOpenProfile={() => setShowUserModal(true)}
            user={user}
            isOnline={isOnline}
            chatUnreadCount={state.chatUnread}
            contactsUnreadCount={state.contactsUnread}
            feedUnreadCount={state.feedUnread}
            settingsUnreadCount={state.settingsUnread}
        >
            {activeRoute === AppRoute.FEED && (
                <Feed
                    posts={state.posts}
                    contacts={state.contacts}
                    user={user}
                    onPost={actions.handlePost}
                    onLike={(id) => actions.handleVote(id, 'up')}
                    onDislike={(id) => actions.handleVote(id, 'down')}
                    onComment={actions.handleComment}
                    onCommentVote={actions.handleCommentVote}
                    onCommentReaction={actions.handleCommentReaction}
                    onPostReaction={actions.handlePostReaction}
                    onShare={() => { }}
                    onNavigateToChat={(id) => { setActiveChatId(id); handleNavigate(AppRoute.CHAT); }}
                    onDeletePost={actions.handleDeletePost}
                    onEditPost={actions.handleEditPost}
                    onGlobalSync={actions.handleGlobalSync}
                    onFollowUser={actions.handleFollowUser}
                    onUnfollowUser={actions.handleUnfollowUser}
                    onConnectUser={(t) => actions.handleAddUserContact(t.id, t.homeNode || '', t.displayName)}
                    onViewUserPosts={handleViewUserPosts}
                    addToast={(title, message, type, category) => addNotification(title, message, type, category || 'admin', AppRoute.FEED)}
                    isOnline={isOnline}
                    initialState={feedInitialState}
                    onConsumeInitialState={() => setFeedInitialState(null)}
                    contentSettings={state.contentSettings}
                    onUpdateUser={handleUpdateUserWrapper}
                />
            )}

            {activeRoute === AppRoute.CHAT && (
                <Chat
                    contacts={state.contacts}
                    groups={state.groups}
                    messages={state.messages}
                    activeChatId={activeChatId}
                    user={user}
                    isOnline={isOnline}
                    addToast={(title, message, type, category) => addNotification(title, message, type, category || 'admin', AppRoute.CHAT)}
                    onSendMessage={actions.handleSendMessage}
                    onSendTyping={actions.handleSendTyping}
                    onReadMessage={actions.handleReadMessage}
                    onClearHistory={(id) => { state.setMessages(prev => prev.filter(m => m.threadId !== id)); }}
                    onReactMessage={actions.handleChatReaction}
                    onVoteMessage={actions.handleChatVote}
                    onCreateGroup={actions.handleCreateGroup}
                    onDeleteGroup={actions.handleDeleteGroup}
                    onUpdateGroup={actions.handleUpdateGroup}
                    onAddMemberToGroup={actions.handleAddMemberToGroup}
                    onToggleGroupMute={actions.handleToggleGroupMute}
                    onLeaveGroup={actions.handleLeaveGroup}
                    typingContactId={null}
                    onFollowUser={actions.handleFollowUser}
                    onUnfollowUser={actions.handleUnfollowUser}
                    onViewUserPosts={handleViewUserPosts}
                    posts={state.posts}
                />
            )}

            {activeRoute === AppRoute.CONTACTS && (
                <Contacts
                    currentUser={user}
                    contacts={state.contacts}
                    requests={state.connectionRequests}
                    discoveredPeers={discoveredPeers}
                    onAcceptRequest={actions.handleAcceptRequest}
                    onDeclineRequest={actions.handleDeclineRequest}
                    onAddContact={(pub, node, name) => actions.handleAddUserContact(pub, node, name)}
                    onDeleteContact={actions.handleDeleteContact}
                    addToast={(title, message, type, category) => addNotification(title, message, type, category || 'admin', AppRoute.CONTACTS)}
                    onNavigateToChat={(id) => { setActiveChatId(id); handleNavigate(AppRoute.CHAT); }}
                    onFollowUser={actions.handleFollowUser}
                    onUnfollowUser={actions.handleUnfollowUser}
                    onViewUserPosts={handleViewUserPosts}
                    posts={state.posts}
                />
            )}

            {activeRoute === AppRoute.NODE_SETTINGS && (
                <NodeSettings
                    user={user}
                    peers={state.peers}
                    pendingPeers={pendingNodeRequests}
                    discoveredPeers={discoveredPeers}
                    nodeConfig={state.nodeConfig}
                    isOnline={isOnline}
                    userStats={{ totalPosts: state.posts.filter(p => p.authorId === user.id).length, likes: 0, dislikes: 0, connections: state.contacts.length, followers: 0 }}
                    onAddPeer={actions.handleAddPeer}
                    onRemovePeer={actions.handleRemovePeer}
                    onBlockPeer={actions.handleBlockPeer}
                    onSyncPeer={actions.handleSyncPeer}
                    onToggleNetwork={() => { if (isOnline) networkService.disconnect(); else networkService.init(user.id); }}
                    onUpdateProfile={handleUpdateUserWrapper}
                    onUpdateNodeConfig={actions.handleUpdateNodeConfig}
                    onExportKeys={actions.handleExportKeys}
                    addToast={(title, message, type, category) => addNotification(title, message, type, category || 'admin', AppRoute.NODE_SETTINGS)}
                    onSetSyncAge={handleSetSyncAge}
                    currentSyncAge={maxSyncAgeHours}
                    data={{
                        posts: state.posts,
                        messages: state.messages,
                        contacts: state.contacts
                    }}
                    mediaSettings={state.mediaSettings}
                    onUpdateMediaSettings={state.setMediaSettings}
                    contentSettings={state.contentSettings}
                    onUpdateContentSettings={state.setContentSettings}
                />)}

            {activeRoute === AppRoute.NOTIFICATIONS && (
                <Notifications
                    notifications={state.notifications}
                    onClear={handleClearNotifications}
                    onMarkRead={handleMarkNotificationsRead}
                    onNotificationClick={handleNotificationClick}
                    mutedCategories={state.notificationSettings.mutedCategories}
                    onToggleMute={state.toggleMuteCategory}
                    maxCount={state.notificationSettings.maxCount}
                    onSetMaxCount={state.setNotificationMaxCount}
                />
            )}

            <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
            <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

            {showUserModal && (
                <UserInfoModal
                    target={{
                        id: user.id,
                        displayName: user.displayName,
                        username: user.username,
                        avatarUrl: user.avatarUrl,
                        homeNode: user.homeNodeOnion,
                        followersCount: user.followersCount,
                        bio: user.bio
                    }}
                    currentUser={user}
                    isContact={false}
                    isFollowing={false}
                    onClose={() => setShowUserModal(false)}
                    onConnect={() => { }}
                    onFollow={() => { }}
                    onUnfollow={() => { }}
                    onMessage={() => { }}
                    onViewPosts={handleViewUserPosts}
                    onLogout={onLogout}
                    onShutdown={user.isAdmin ? performGracefulShutdown : undefined}
                    onUpdateUser={handleUpdateUserWrapper}
                    posts={state.posts}
                />
            )}

            {isShuttingDown && (
                <div className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-center text-white">
                    <Loader2 size={64} className="animate-spin text-onion-500 mb-4" />
                    <h2 className="text-2xl font-bold">Shutting Down Node...</h2>
                    <p className="text-slate-400 mt-2">{shutdownStep}</p>
                </div>
            )}
        </Layout>
    );
};


import { kvService } from './services/kv';
import { ThemeEngine } from './services/themeEngine';

const App: React.FC = () => {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const initUser = async () => {
            try {
                // Must init the socket BEFORE loading profile, otherwise
                // kvService.get() returns null (socket not connected yet).
                networkService.init();
                await ThemeEngine.init();
                const stored = await kvService.get<UserProfile>(USER_STORAGE_KEY);
                if (stored) setUser(stored);
            } catch (e) {
                console.error("Failed to load user session", e);
            } finally {
                setIsLoading(false);
            }
        };
        initUser();
    }, []);

    const handleLogout = async () => {
        if (confirm("Log out? This will clear local session keys from memory (but keep data in DB).")) {
            setUser(null);
        }
    };

    const handleUpdateUser = async (updated: UserProfile) => {
        setUser(updated);
        await kvService.set(USER_STORAGE_KEY, updated);

        // PERSIST TO REGISTRY (Fixes data loss on logout)
        try {
            const registry = (await kvService.get<any>('gchat_profile_registry')) || {};
            registry[updated.id] = {
                displayName: updated.displayName,
                username: updated.username,
                avatarUrl: updated.avatarUrl,
                bio: updated.bio,
                isDiscoverable: updated.isDiscoverable
            };
            await kvService.set('gchat_profile_registry', registry);
        } catch (e) { console.error("Registry update failed", e); }
    };

    if (isLoading) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#0B1221] text-white">
                <Loader2 className="w-12 h-12 text-[#00F0FF] animate-spin mb-4" />
                <h2 className="text-xl font-mono text-[#00F0FF]">Initializing System...</h2>
            </div>
        );
    }

    if (!user) {
        return <Onboarding onComplete={async (u) => {
            setUser(u);
            await kvService.set(USER_STORAGE_KEY, u);
        }} />;
    }

    return <AuthenticatedApp user={user} onLogout={handleLogout} onUpdateUser={handleUpdateUser} />;
};

export default App;
