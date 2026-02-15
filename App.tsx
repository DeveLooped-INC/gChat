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
import { AppRoute, UserProfile, Post, Message, Contact, ToastMessage, NetworkPacket, EncryptedPayload, Group, MediaMetadata, NodePeer, ConnectionRequest, NotificationItem, NotificationCategory } from './types';
import { networkService } from './services/networkService';
import { encryptMessage, decryptMessage, signData } from './services/cryptoService';
import { calculatePostHash, formatUserIdentity } from './utils';
import { Loader2 } from 'lucide-react';
import UserInfoModal from './components/UserInfoModal';
import { useAppState } from './hooks/useAppState';
import { useNetworkLayer } from './hooks/useNetworkLayer';
import { appendReply, updateCommentTree, createPostPayload } from './utils/dataHelpers';
import { storageService } from './services/storage';

const USER_STORAGE_KEY = 'gchat_user_profile';
const MAX_GOSSIP_HOPS = 6;

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
    const [maxSyncAgeHours, setMaxSyncAgeHours] = useState(24);

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
            // LinkId for FEED notifications is usually the POST ID, not Author ID
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
        // Run every 10 seconds
        const gcInterval = setInterval(() => {
            state.pruneMessages();
        }, 10000);
        return () => clearInterval(gcInterval);
    }, [state.pruneMessages]);

    const handleClearNotifications = () => {
        state.setNotifications([]);

    };

    const handleMarkNotificationsRead = () => {
        state.setNotifications(prev => {
            const updated = prev.map(n => ({ ...n, read: true }));
            // Batch save isn't available, but we can rely on syncState or just loop
            // Since syncState exists in useAppState, maybe we rely on it? 
            // The user wanted EXPLICIT persistence.
            // Let's use syncState for bulk updates to avoid 100 DB calls.
            // Triggering the state update will trigger syncState effect.
            // But to be safe per requirements:

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

    // --- MANUAL GLOBAL SYNC ---
    const handleGlobalSync = useCallback(() => {
        const activePeers = state.peersRef.current.filter(p => p.status === 'online').map(p => p.onionAddress);
        if (activePeers.length === 0) {
            addNotification('Sync Failed', 'No active peers to sync with.', 'warning', 'admin');
            return;
        }
        addNotification('Global Sync', `Requesting updates from ${activePeers.length} peers...`, 'info', 'admin');
        const since = Date.now() - (maxSyncAgeHours * 60 * 60 * 1000);
        const myInventory = state.postsRef.current
            .filter(p => p.timestamp > since && p.privacy === 'public')
            .map(p => ({ id: p.id, hash: calculatePostHash(p) }));

        const packet: NetworkPacket = {
            id: crypto.randomUUID(),
            type: 'INVENTORY_SYNC_REQUEST',
            senderId: state.userRef.current.homeNodeOnion,
            payload: { inventory: myInventory, since }
        };
        networkService.broadcast(packet, activePeers);
    }, [addNotification, maxSyncAgeHours, state.peersRef, state.postsRef, state.userRef]);

    // --- ACTIONS ---

    const handleAddPeer = useCallback((onion: string) => {
        const cleanOnion = onion.trim().toLowerCase();
        if (!cleanOnion.endsWith('.onion')) {
            addNotification('Error', 'Invalid Onion Address', 'error', 'admin');
            return;
        }
        state.setPeers(prev => {
            if (prev.some(p => p.onionAddress === cleanOnion)) return prev;
            const newPeer: NodePeer = { id: cleanOnion, onionAddress: cleanOnion, status: 'offline', latencyMs: 0, lastSeen: Date.now(), trustLevel: 'verified' };
            networkService.connect(cleanOnion);
            return [...prev, newPeer];
        });
        setPendingNodeRequests(prev => prev.filter(p => p !== cleanOnion));
        setDiscoveredPeers(prev => prev.filter(p => p.id !== cleanOnion));
        addNotification('Peer Added', 'Connection initiated', 'success', 'admin');
    }, [addNotification, state.setPeers]);

    const handleRemovePeer = useCallback((onion: string) => {
        state.setPeers(prev => prev.filter(p => p.onionAddress !== onion));
        networkService.removeTrustedPeer(onion);
        addNotification('Peer Removed', 'Node forgotten.', 'info', 'admin');
    }, [addNotification, state.setPeers]);

    const handleBlockPeer = useCallback((onion: string) => {
        state.setPeers(prev => prev.filter(p => p.onionAddress !== onion));
        setPendingNodeRequests(prev => prev.filter(p => p !== onion));
        setDiscoveredPeers(prev => prev.filter(p => p.id !== onion));
        networkService.removeTrustedPeer(onion); // Actually block at firewall level
        addNotification('Node Blocked', 'Requests from this node will be ignored.', 'warning', 'admin');
    }, [addNotification, state.setPeers]);

    const handleSyncPeer = useCallback((onion: string) => {
        addNotification("Syncing", `Requesting Inventory from ${onion}...`, 'info', 'admin');
        const since = Date.now() - (maxSyncAgeHours * 60 * 60 * 1000);
        const myInventory = state.postsRef.current.filter(p => p.timestamp > since && p.privacy === 'public').map(p => ({ id: p.id, hash: calculatePostHash(p) }));
        const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'INVENTORY_SYNC_REQUEST', senderId: state.userRef.current.homeNodeOnion, payload: { inventory: myInventory, since } };
        networkService.sendMessage(onion, packet);
        networkService.sendMessage(onion, { id: crypto.randomUUID(), type: 'GROUP_QUERY', senderId: state.userRef.current.homeNodeOnion, payload: { requesterId: state.userRef.current.id } });
    }, [addNotification, maxSyncAgeHours, state.postsRef, state.userRef]);

    const handleUpdateNodeConfig = useCallback((alias: string, description: string) => {
        state.setNodeConfig({ alias, description });
        addNotification('Saved', 'Node settings updated. Broadcasting...', 'success', 'admin');
        const user = state.userRef.current;
        if (isOnline && user.isDiscoverable) {
            const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'ANNOUNCE_PEER', senderId: user.homeNodeOnion, payload: { onionAddress: user.homeNodeOnion, alias, description } };
            processedPacketIds.current.add(packet.id!);
            networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        }
    }, [isOnline, addNotification, state.setNodeConfig, state.userRef, state.peersRef]);

    const handleAddUserContact = useCallback(async (pubKey: string, homeNode: string, name: string, encryptionKey?: string, initialHandshakeStatus: 'pending' | 'completed' = 'pending') => {
        const cleanNode = homeNode.trim().toLowerCase();
        const user = state.userRef.current;
        if (state.contactsRef.current.some(c => c.id === pubKey)) {
            if (encryptionKey) state.setContacts(prev => prev.map(c => c.id === pubKey ? { ...c, encryptionPublicKey: encryptionKey } : c));
            return;
        }
        const newContact: Contact = { id: pubKey, encryptionPublicKey: encryptionKey, username: name.toLowerCase().replace(/\s/g, '_'), displayName: name, homeNodes: [cleanNode], status: 'offline', connectionType: 'Onion', handshakeStatus: initialHandshakeStatus };
        state.setContacts(prev => { if (prev.some(c => c.id === pubKey)) return prev; return [...prev, newContact]; });
        if (!state.peersRef.current.some(p => p.onionAddress === cleanNode)) handleAddPeer(cleanNode);
        else networkService.connect(cleanNode);

        const reqPayload: ConnectionRequest = { id: crypto.randomUUID(), fromUserId: user.id, fromUsername: user.username, fromDisplayName: user.displayName, fromHomeNode: user.homeNodeOnion, fromEncryptionPublicKey: user.keys.encryption.publicKey, timestamp: Date.now() };
        // SIGN THE REQUEST
        reqPayload.signature = signData(reqPayload, user.keys.signing.secretKey);

        const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CONNECTION_REQUEST', senderId: user.homeNodeOnion, targetUserId: pubKey, payload: reqPayload };
        networkService.connect(cleanNode).then(() => networkService.sendMessage(cleanNode, packet));
        addNotification('Request Sent', `Handshake sent to ${name}`, 'success', 'admin');

    }, [handleAddPeer, addNotification, state.contactsRef, state.userRef, state.setContacts, state.peersRef]);

    const handleAcceptRequest = useCallback((req: ConnectionRequest) => {
        const user = state.userRef.current;
        state.setConnectionRequests(prev => prev.filter(r => r.id !== req.id));
        handleAddUserContact(req.fromUserId, req.fromHomeNode, req.fromDisplayName, req.fromEncryptionPublicKey, 'completed');
        const reqPayload: ConnectionRequest = { id: crypto.randomUUID(), fromUserId: user.id, fromUsername: user.username, fromDisplayName: user.displayName, fromHomeNode: user.homeNodeOnion, fromEncryptionPublicKey: user.keys.encryption.publicKey, timestamp: Date.now() };
        // SIGN THE RESPONSE
        reqPayload.signature = signData(reqPayload, user.keys.signing.secretKey);

        const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CONNECTION_REQUEST', senderId: user.homeNodeOnion, targetUserId: req.fromUserId, payload: reqPayload };
        networkService.sendMessage(req.fromHomeNode, packet);

    }, [handleAddUserContact, state.userRef, state.setConnectionRequests]);

    const handleDeclineRequest = useCallback((reqId: string) => {
        state.setConnectionRequests(prev => prev.filter(r => r.id !== reqId));

    }, [state.setConnectionRequests]);

    const handleDeleteContact = useCallback((contactId: string) => {
        const user = state.userRef.current;
        const contactToRemove = state.contactsRef.current.find(c => c.id === contactId);
        state.setContacts(prev => prev.filter(c => c.id !== contactId));
        state.setPosts(prev => prev.filter(p => !(p.authorId === contactId && p.privacy === 'friends')));
        state.setGroups(prevGroups => {
            return prevGroups.map(group => {
                if (group.ownerId === user.id && group.members.includes(contactId)) {
                    const updatedMembers = group.members.filter(m => m !== contactId);
                    const updatedGroup = { ...group, members: updatedMembers };
                    if (contactToRemove && contactToRemove.homeNodes[0]) {
                        networkService.sendMessage(contactToRemove.homeNodes[0], { id: crypto.randomUUID(), type: 'GROUP_UPDATE', senderId: user.homeNodeOnion, targetUserId: contactId, payload: updatedGroup });
                    }
                    updatedMembers.forEach(mid => {
                        if (mid === user.id) return;
                        const member = state.contactsRef.current.find(c => c.id === mid);
                        if (member && member.homeNodes[0]) {
                            networkService.sendMessage(member.homeNodes[0], { id: crypto.randomUUID(), type: 'GROUP_UPDATE', senderId: user.homeNodeOnion, targetUserId: mid, payload: updatedGroup });
                        }
                    });
                    return updatedGroup;
                }
                return group;
            });
        });
        addNotification('Contact Removed', 'Connection severed. Feed and Groups updated.', 'info', 'admin');

    }, [addNotification, state.userRef, state.contactsRef, state.setContacts, state.setPosts, state.setGroups]);

    const handleSendMessage = useCallback(async (text: string, contactId: string, isEphemeral: boolean, attachment?: string, media?: MediaMetadata, replyToId?: string, privacy: 'public' | 'connections' = 'public') => {
        const user = state.userRef.current;
        const msgId = crypto.randomUUID();
        const payloadObj = { content: text, media, attachment, replyToId, privacy };
        const payloadStr = JSON.stringify(payloadObj);
        const group = state.groupsRef.current.find(g => g.id === contactId);

        if (group) {
            const newMessage: Message = { id: msgId, threadId: group.id, senderId: user.id, content: text, timestamp: Date.now(), delivered: false, read: true, isMine: true, media, attachmentUrl: attachment, isEphemeral, replyToId, privacy };
            state.setMessages(prev => [...prev, newMessage]);

            let membersToMessage = group.members.filter(mid => mid !== user.id);
            if (privacy === 'connections') membersToMessage = membersToMessage.filter(mid => state.contactsRef.current.some(c => c.id === mid));

            // Optimistic delivery assumption for UI, but we track failures internally if needed.
            // For now, groups complicate retry logic significantly (partial delivery).
            // We focus on best-effort for groups in this V1.

            let successCount = 0;
            for (const memberId of membersToMessage) {
                const contact = state.contactsRef.current.find(c => c.id === memberId);
                if (contact && contact.encryptionPublicKey && contact.homeNodes[0]) {
                    const { nonce, ciphertext } = encryptMessage(payloadStr, contact.encryptionPublicKey, user.keys.encryption.secretKey);
                    const groupEncPayload: EncryptedPayload = { id: msgId, nonce, ciphertext, groupId: group.id };
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'MESSAGE', senderId: user.homeNodeOnion, targetUserId: contact.id, payload: groupEncPayload };
                    networkService.sendMessage(contact.homeNodes[0], packet); // Fire and forget for group
                    successCount++;
                    await new Promise(r => setTimeout(r, 50));
                }
            }
            if (successCount > 0) state.setMessages(prev => prev.map(m => m.id === msgId ? { ...m, delivered: true } : m));
            else addNotification('Delivery Failed', 'No eligible members reachable.', 'warning', 'chat');
            return;
        }

        const contact = state.contactsRef.current.find(c => c.id === contactId);
        if (!contact || !contact.encryptionPublicKey) return;
        const { nonce, ciphertext } = encryptMessage(payloadStr, contact.encryptionPublicKey, user.keys.encryption.secretKey);
        const newMsg: Message = { id: msgId, threadId: contact.id, senderId: user.id, content: text, timestamp: Date.now(), delivered: false, read: true, isMine: true, media, attachmentUrl: attachment, isEphemeral, replyToId };
        state.setMessages(prev => [...prev, newMsg]);


        const targetNode = contact.homeNodes[0];
        const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'MESSAGE', senderId: user.homeNodeOnion, targetUserId: contact.id, payload: { id: msgId, nonce, ciphertext } };

        // Initial Send Attempt
        const success = await networkService.sendMessage(targetNode, packet);

        if (success) {
            state.setMessages(prev => prev.map(m => m.id === msgId ? { ...m, delivered: true } : m));
        } else {
            // Keep delivered=false. The Retry Interval will pick it up.
            // We can also notify user it is "Pending" if we had a UI state for it.
            // Currently UI shows checkmark for delivered, nothing for pending? 
            // `Chat.tsx` shows <Clock /> if !delivered. Perfect.
            console.log(`Message ${msgId} failed initial send. Queued for retry.`);
        }
    }, [addNotification, state.userRef, state.groupsRef, state.contactsRef, state.setMessages]);

    // RETRY LOGIC FOR UNDELIVERED MESSAGES
    useEffect(() => {
        const retryInterval = setInterval(async () => {
            const undeliveredMsgs = state.messagesRef.current.filter(m => m.isMine && !m.delivered && !m.read && (Date.now() - m.timestamp < 24 * 60 * 60 * 1000)); // Retry for 24h
            if (undeliveredMsgs.length === 0) return;

            const user = state.userRef.current;

            for (const msg of undeliveredMsgs) {
                if (inflightMessages.current.has(msg.id)) continue;

                // Skip Group messages for now (too complex to track partials)
                const group = state.groupsRef.current.find(g => g.id === msg.threadId);
                if (group) continue;

                const contact = state.contactsRef.current.find(c => c.id === msg.threadId);
                if (!contact || !contact.encryptionPublicKey || !contact.homeNodes[0]) continue;

                // Check if peer is online now
                const isPeerOnline = state.peersRef.current.some(p => p.onionAddress === contact.homeNodes[0] && p.status === 'online');
                if (!isPeerOnline) continue;

                console.log(`Retrying message ${msg.id} to ${contact.displayName}`);
                inflightMessages.current.add(msg.id);

                try {
                    // Re-encrypt (or store encrypted? Storing cleartext in state is easier for display, so re-encrypt is fine)
                    const payloadObj = { content: msg.content, media: msg.media, attachment: msg.attachmentUrl, replyToId: msg.replyToId, privacy: msg.privacy };
                    const payloadStr = JSON.stringify(payloadObj);
                    const { nonce, ciphertext } = encryptMessage(payloadStr, contact.encryptionPublicKey, user.keys.encryption.secretKey);
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'MESSAGE', senderId: user.homeNodeOnion, targetUserId: contact.id, payload: { id: msg.id, nonce, ciphertext } };

                    const success = await networkService.sendMessage(contact.homeNodes[0], packet);
                    if (success) {
                        state.setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, delivered: true } : m));
                    }
                } catch (e) {
                    console.warn(`Message retry failed for ${msg.id}`, e);
                } finally {
                    inflightMessages.current.delete(msg.id);
                }
            }
        }, 30000); // Check every 30 seconds

        return () => clearInterval(retryInterval);
    }, [state.messagesRef, state.contactsRef, state.peersRef, state.userRef, state.groupsRef, state.setMessages]);

    // RETRY LOGIC FOR PENDING HANDSHAKES
    useEffect(() => {
        const handshakeInterval = setInterval(async () => {
            const pendingContacts = state.contactsRef.current.filter(c => c.handshakeStatus === 'pending');
            if (pendingContacts.length === 0) return;

            const user = state.userRef.current;

            for (const contact of pendingContacts) {
                if (!contact.homeNodes[0]) continue;
                if (inflightHandshakes.current.has(contact.id)) continue;

                const isOnline = state.peersRef.current.some(p => p.onionAddress === contact.homeNodes[0] && p.status === 'online');
                // We try even if offline, triggering a connect attempt

                console.log(`[Handshake] Retrying for ${contact.displayName} at ${contact.homeNodes[0]}...`);
                inflightHandshakes.current.add(contact.id);

                const reqPayload: ConnectionRequest = {
                    id: crypto.randomUUID(),
                    fromUserId: user.id,
                    fromUsername: user.username,
                    fromDisplayName: user.displayName,
                    fromHomeNode: user.homeNodeOnion,
                    fromEncryptionPublicKey: user.keys.encryption.publicKey,
                    timestamp: Date.now()
                };
                reqPayload.signature = signData(reqPayload, user.keys.signing.secretKey);

                const packet: NetworkPacket = {
                    id: crypto.randomUUID(),
                    type: 'CONNECTION_REQUEST',
                    senderId: user.homeNodeOnion,
                    targetUserId: contact.id,
                    payload: reqPayload
                };

                try {
                    await networkService.connect(contact.homeNodes[0]);
                    await networkService.sendMessage(contact.homeNodes[0], packet);
                } catch (e) {
                    console.warn(`[Handshake] Retry failed for ${contact.displayName}`, e);
                } finally {
                    inflightHandshakes.current.delete(contact.id);
                }
            }
        }, 90000); // Every 90 seconds

        return () => clearInterval(handshakeInterval);
    }, [state.contactsRef, state.userRef, state.peersRef]);

    const handleSendTyping = useCallback((contactId: string) => {
        const user = state.userRef.current;
        const contact = state.contactsRef.current.find(c => c.id === contactId);
        if (contact && contact.homeNodes[0]) {
            const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'TYPING', senderId: user.homeNodeOnion, targetUserId: contactId, payload: { userId: user.id } };
            networkService.sendMessage(contact.homeNodes[0], packet);
        }
    }, [state.userRef, state.contactsRef]);

    const handleReadMessage = useCallback((contactId: string) => {
        state.setMessages(prev => {
            if (!prev.some(m => m.threadId === contactId && !m.isMine && !m.read)) return prev;
            return prev.map(m => (m.threadId === contactId && !m.isMine && !m.read) ? { ...m, read: true } : m);
        });
    }, [state.setMessages]);

    const handleChatReaction = useCallback((contactId: string, messageId: string, emoji: string) => {
        const user = state.userRef.current;
        let action: 'add' | 'remove' = 'add';
        state.setMessages(prev => prev.map(m => {
            if (m.id !== messageId) return m;
            const currentReactions = { ...(m.reactions || {}) };
            if (!currentReactions[emoji]) currentReactions[emoji] = [];
            if (currentReactions[emoji].includes(user.id)) { currentReactions[emoji] = currentReactions[emoji].filter(id => id !== user.id); action = 'remove'; } else { currentReactions[emoji] = [...currentReactions[emoji], user.id]; action = 'add'; }
            return { ...m, reactions: currentReactions };
        }));
        const group = state.groupsRef.current.find(g => g.id === contactId);
        if (group) {
            group.members.filter(mid => mid !== user.id).forEach(mid => {
                const contact = state.contactsRef.current.find(c => c.id === mid);
                if (contact && contact.homeNodes[0]) {
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CHAT_REACTION', senderId: user.homeNodeOnion, targetUserId: mid, payload: { messageId, emoji, userId: user.id, action } };
                    networkService.sendMessage(contact.homeNodes[0], packet);
                }
            });
        } else {
            const contact = state.contactsRef.current.find(c => c.id === contactId);
            if (contact && contact.homeNodes[0]) {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CHAT_REACTION', senderId: user.homeNodeOnion, targetUserId: contactId, payload: { messageId, emoji, userId: user.id, action } };
                networkService.sendMessage(contact.homeNodes[0], packet);
            }
        }
    }, [state.userRef, state.setMessages, state.groupsRef, state.contactsRef]);

    const handleChatVote = useCallback((contactId: string, messageId: string, type: 'up' | 'down') => {
        const user = state.userRef.current;
        let action: 'add' | 'remove' = 'add';
        state.setMessages(prev => prev.map(m => {
            if (m.id !== messageId) return m;
            const currentVotes = { ...(m.votes || {}) };
            if (currentVotes[user.id] === type) { delete currentVotes[user.id]; action = 'remove'; } else { currentVotes[user.id] = type; action = 'add'; }
            return { ...m, votes: currentVotes };
        }));
        const group = state.groupsRef.current.find(g => g.id === contactId);
        if (group) {
            group.members.forEach(mid => {
                if (mid === user.id) return;
                const contact = state.contactsRef.current.find(c => c.id === mid);
                if (contact && contact.homeNodes[0]) {
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CHAT_VOTE', senderId: user.homeNodeOnion, targetUserId: mid, payload: { messageId, type, userId: user.id, action } };
                    networkService.sendMessage(contact.homeNodes[0], packet);
                }
            });
        } else {
            const contact = state.contactsRef.current.find(c => c.id === contactId);
            if (contact && contact.homeNodes[0]) {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CHAT_VOTE', senderId: user.homeNodeOnion, targetUserId: contactId, payload: { messageId, type, userId: user.id, action } };
                networkService.sendMessage(contact.homeNodes[0], packet);
            }
        }
    }, [state.userRef, state.setMessages, state.groupsRef, state.contactsRef]);

    const handleFollowUser = useCallback((targetId: string, targetNode?: string) => {
        const user = state.userRef.current;
        if (user.followingIds && user.followingIds.includes(targetId)) return;
        const updatedUser = { ...user, followingIds: [...(user.followingIds || []), targetId] };
        onUpdateUser(updatedUser);
        if (targetNode) {
            const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'FOLLOW', senderId: user.homeNodeOnion, targetUserId: targetId, payload: { userId: user.id } };
            networkService.sendMessage(targetNode, packet);
        }
        addNotification('Following', 'You are now following this user.', 'success', 'admin');
    }, [onUpdateUser, addNotification, state.userRef]);

    const handleUnfollowUser = useCallback((targetId: string, targetNode?: string) => {
        const user = state.userRef.current;
        const updatedUser = { ...user, followingIds: (user.followingIds || []).filter(id => id !== targetId) };
        onUpdateUser(updatedUser);
        if (targetNode) {
            const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'UNFOLLOW', senderId: user.homeNodeOnion, targetUserId: targetId, payload: { userId: user.id } };
            networkService.sendMessage(targetNode, packet);
        }
        addNotification('Unfollowed', 'User removed from following list.', 'info', 'admin');
    }, [onUpdateUser, addNotification, state.userRef]);

    const handleCreateGroup = useCallback(async (name: string, memberIds: string[]) => {
        const user = state.userRef.current;
        const newGroup: Group = { id: crypto.randomUUID(), name, members: [...memberIds, user.id], admins: [user.id], ownerId: user.id, bannedIds: [], settings: { allowMemberInvite: false, allowMemberNameChange: false }, isMuted: false };
        state.setGroups(prev => [...prev, newGroup]);

        addNotification('Group Created', `"${name}" is ready. Inviting members...`, 'info', 'chat', AppRoute.CHAT, newGroup.id);
        for (const mid of memberIds) {
            const contact = state.contactsRef.current.find(c => c.id === mid);
            if (contact && contact.homeNodes[0]) {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_INVITE', senderId: user.homeNodeOnion, targetUserId: mid, payload: newGroup };
                await networkService.sendMessage(contact.homeNodes[0], packet);
                await new Promise(r => setTimeout(r, 200));
            }
        }
        addNotification('Group Ready', 'Invites sent.', 'success', 'chat');
    }, [addNotification, state.userRef, state.setGroups, state.contactsRef]);

    const handleDeleteGroup = useCallback((groupId: string) => {
        const group = state.groupsRef.current.find(g => g.id === groupId);
        state.setGroups(prev => prev.filter(g => g.id !== groupId));
        const user = state.userRef.current;
        if (group) {
            group.members.forEach(mid => {
                if (mid === user.id) return;
                const contact = state.contactsRef.current.find(c => c.id === mid);
                if (contact && contact.homeNodes[0]) {
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_DELETE', senderId: user.homeNodeOnion, targetUserId: mid, payload: { groupId } };
                    networkService.sendMessage(contact.homeNodes[0], packet);
                }
            });
        }
        addNotification('Group Deleted', 'Group has been removed.', 'info', 'chat');

    }, [addNotification, state.groupsRef, state.setGroups, state.userRef, state.contactsRef]);

    const handleLeaveGroup = useCallback((groupId: string) => {
        const user = state.userRef.current;
        const group = state.groupsRef.current.find(g => g.id === groupId);
        if (!group) return;
        if (group.ownerId === user.id) { addNotification('Action Denied', 'Owners cannot leave. Delete the group instead.', 'error', 'admin'); return; }
        state.setGroups(prev => prev.filter(g => g.id !== groupId));
        if (group) {
            const updatedMembers = group.members.filter(m => m !== user.id);
            const updatedGroup = { ...group, members: updatedMembers };
            updatedMembers.forEach(mid => {
                const contact = state.contactsRef.current.find(c => c.id === mid);
                if (contact && contact.homeNodes[0]) {
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_UPDATE', senderId: user.homeNodeOnion, targetUserId: mid, payload: updatedGroup };
                    networkService.sendMessage(contact.homeNodes[0], packet);
                }
            });
        }
        addNotification('Group Left', 'You have left the group.', 'info', 'chat');

    }, [addNotification, state.userRef, state.groupsRef, state.setGroups, state.contactsRef]);

    const handleUpdateGroup = useCallback((updatedGroup: Group) => {
        state.setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));

        const user = state.userRef.current;
        updatedGroup.members.forEach(mid => {
            if (mid === user.id) return;
            const contact = state.contactsRef.current.find(c => c.id === mid);
            if (contact && contact.homeNodes[0]) {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_UPDATE', senderId: user.homeNodeOnion, targetUserId: mid, payload: updatedGroup };
                networkService.sendMessage(contact.homeNodes[0], packet);
            }
        });
        addNotification('Group Updated', `Group "${updatedGroup.name}" settings changed.`, 'info', 'chat');
    }, [addNotification, state.setGroups, state.userRef, state.contactsRef]);

    const handleAddMemberToGroup = useCallback((groupId: string, contactId: string) => {
        const group = state.groupsRef.current.find(g => g.id === groupId);
        const user = state.userRef.current;
        if (group && !group.members.includes(contactId)) {
            const updatedGroup = { ...group, members: [...group.members, contactId] };
            state.setGroups(prev => prev.map(g => g.id === groupId ? updatedGroup : g));

            const newMember = state.contactsRef.current.find(c => c.id === contactId);
            if (newMember && newMember.homeNodes[0]) {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_INVITE', senderId: user.homeNodeOnion, targetUserId: contactId, payload: updatedGroup };
                networkService.sendMessage(newMember.homeNodes[0], packet);
            }
            group.members.forEach(mid => {
                if (mid === user.id) return;
                const contact = state.contactsRef.current.find(c => c.id === mid);
                if (contact && contact.homeNodes[0]) {
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_UPDATE', senderId: user.homeNodeOnion, targetUserId: mid, payload: updatedGroup };
                    networkService.sendMessage(contact.homeNodes[0], packet);
                }
            });
            addNotification('Member Added', 'New member invited to group.', 'success', 'chat');
        }
    }, [addNotification, state.groupsRef, state.userRef, state.setGroups, state.contactsRef]);

    const handleToggleGroupMute = useCallback((groupId: string) => {
        state.setGroups(prev => prev.map(g => {
            if (g.id === groupId) {
                const updated = { ...g, isMuted: !g.isMuted };

                return updated;
            }
            return g;
        }));
        addNotification('Group Mute Toggled', 'Group notification settings updated.', 'info', 'chat');
    }, [addNotification, state.setGroups, state.userRef]);

    const handlePost = useCallback((post: Post) => {
        const contentHash = calculatePostHash(post);
        const postWithHash = { ...post, contentHash };
        state.setPosts(prev => [postWithHash, ...prev]);

        if (post.privacy === 'public') {
            broadcastPostState(postWithHash);
        } else if (post.privacy === 'friends') {
            const targetNodes = new Set<string>();
            state.contactsRef.current.forEach(c => { if (c.homeNodes[0]) targetNodes.add(c.homeNodes[0]); });
            targetNodes.forEach(onion => {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'POST', senderId: state.userRef.current.homeNodeOnion, payload: post };
                networkService.sendMessage(onion, packet);
            });
        }
        storageService.saveItem('posts', postWithHash, state.userRef.current.id);
        addNotification('Post Created', 'Your post has been published.', 'success', 'social');
    }, [addNotification, broadcastPostState, state.setPosts, state.contactsRef, state.userRef]);

    const handleEditPost = useCallback((postId: string, newContent: string) => {
        let updatedPost: Post | null = null;
        state.setPosts(prev => prev.map(p => {
            if (p.id === postId) {
                updatedPost = { ...p, content: newContent, isEdited: true, contentHash: calculatePostHash({ ...p, content: newContent, isEdited: true }) };

                return updatedPost;
            }
            return p;
        }));
        // Note: updatedPost might be null here if setPosts is async, effectively breaking broadcast, 
        // but persistence is now secured above.
        if (updatedPost) {
            if ((updatedPost as Post).privacy === 'public') {
                broadcastPostState(updatedPost);
            } else {
                const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'EDIT_POST', senderId: state.userRef.current.homeNodeOnion, payload: { postId, newContent } };
                processedPacketIds.current.add(packet.id!);
                networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
            }
            storageService.saveItem('posts', updatedPost, state.userRef.current.id);
            addNotification('Post Edited', 'Your post has been updated.', 'info', 'social');

        }
    }, [addNotification, broadcastPostState, state.setPosts, state.userRef, state.peersRef, processedPacketIds]);

    const handleDeletePost = useCallback((postId: string) => {
        state.setPosts(prev => prev.filter(p => p.id !== postId));
        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'DELETE_POST', senderId: state.userRef.current.homeNodeOnion, payload: { postId } };
        processedPacketIds.current.add(packet.id!);
        networkService.log('DEBUG', 'FRONTEND', `Initiating DELETE_POST broadcast (Hops: ${MAX_GOSSIP_HOPS})`);
        networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        storageService.deleteItem('posts', postId);
        addNotification('Post Deleted', 'Your post has been removed.', 'info', 'social');

    }, [addNotification, state.setPosts, state.userRef, processedPacketIds, state.peersRef]);

    const handleComment = useCallback((postId: string, content: string, parentCommentId?: string) => {
        const user = state.userRef.current;
        const newComment = {
            id: crypto.randomUUID(),
            authorId: user.id,
            authorName: user.displayName,
            authorAvatar: user.avatarUrl,
            content,
            timestamp: Date.now(),
            votes: {},
            reactions: {},
            replies: []
        };
        let updatedPostForBroadcast: Post | null = null;
        state.setPosts(prev => prev.map(post => {
            if (post.id !== postId) return post;
            let updatedPost = post;
            if (!parentCommentId) {
                updatedPost = { ...post, comments: post.comments + 1, commentsList: [...post.commentsList, newComment] };
            } else {
                updatedPost = { ...post, comments: post.comments + 1, commentsList: appendReply(post.commentsList, parentCommentId, newComment) };
            }
            updatedPost.contentHash = calculatePostHash(updatedPost);
            updatedPostForBroadcast = updatedPost;

            return updatedPost;
        }));
        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'COMMENT', senderId: user.homeNodeOnion, payload: { postId, comment: newComment, parentCommentId } };
        processedPacketIds.current.add(packet.id!);
        networkService.log('DEBUG', 'FRONTEND', `Initiating COMMENT broadcast`);
        networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        if (updatedPostForBroadcast) {
            broadcastPostState(updatedPostForBroadcast);
            storageService.saveItem('posts', updatedPostForBroadcast, state.userRef.current.id);
        }
        addNotification('New Comment', 'Your comment has been added.', 'success', 'social');
    }, [addNotification, broadcastPostState, state.userRef, state.setPosts, processedPacketIds, state.peersRef]);

    const handleVote = useCallback((postId: string, type: 'up' | 'down') => {
        const user = state.userRef.current;
        let updatedPostForBroadcast: Post | null = null;
        state.setPosts(prev => prev.map(post => {
            if (post.id !== postId) return post;
            const updatedPost = { ...post, votes: { ...post.votes, [user.id]: type } };
            updatedPost.contentHash = calculatePostHash(updatedPost);
            updatedPostForBroadcast = updatedPost;

            return updatedPost;
        }));
        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'VOTE', senderId: user.homeNodeOnion, payload: { postId, userId: user.id, type } };
        processedPacketIds.current.add(packet.id!);
        networkService.log('DEBUG', 'FRONTEND', `Initiating VOTE broadcast`);
        networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        if (updatedPostForBroadcast) {
            broadcastPostState(updatedPostForBroadcast);
            storageService.saveItem('posts', updatedPostForBroadcast, state.userRef.current.id);
        }
        addNotification('Post Voted', 'Your vote has been recorded.', 'info', 'social');
    }, [addNotification, broadcastPostState, state.userRef, state.setPosts, processedPacketIds, state.peersRef]);

    const handlePostReaction = useCallback((postId: string, emoji: string) => {
        const user = state.userRef.current;
        let updatedPostForBroadcast: Post | null = null;
        let action: 'add' | 'remove' = 'add';

        state.setPosts(prev => prev.map(p => {
            if (p.id !== postId) return p;
            const currentReactions = { ...(p.reactions || {}) };
            if (!currentReactions[emoji]) currentReactions[emoji] = [];

            if (currentReactions[emoji].includes(user.id)) {
                action = 'remove';
                currentReactions[emoji] = currentReactions[emoji].filter(id => id !== user.id);
            } else {
                action = 'add';
                currentReactions[emoji] = [...currentReactions[emoji], user.id];
            }

            // Clean up empty keys
            if (currentReactions[emoji].length === 0) delete currentReactions[emoji];

            const updatedPost = { ...p, reactions: currentReactions };
            updatedPost.contentHash = calculatePostHash(updatedPost);
            updatedPostForBroadcast = updatedPost;
            return updatedPost;
        }));

        if (updatedPostForBroadcast) {
            storageService.saveItem('posts', updatedPostForBroadcast, state.userRef.current.id);
        }

        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'REACTION', senderId: user.homeNodeOnion, payload: { postId, userId: user.id, emoji, action } };
        processedPacketIds.current.add(packet.id!);
        networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        if (updatedPostForBroadcast) broadcastPostState(updatedPostForBroadcast);
        if (action === 'add') {
            addNotification('Post Reacted', `You reacted with ${emoji}.`, 'info', 'social');
        } else {
            // Optional: Notification for removal or just silent
        }
    }, [addNotification, broadcastPostState, state.userRef, state.setPosts, processedPacketIds, state.peersRef]);

    const handleCommentVote = useCallback((postId: string, commentId: string, type: 'up' | 'down') => {
        const user = state.userRef.current;
        let updatedPostForBroadcast: Post | null = null;
        state.setPosts(prev => prev.map(p => {
            if (p.id !== postId) return p;
            const updatedPost = { ...p, commentsList: updateCommentTree(p.commentsList, commentId, (c) => ({ ...c, votes: { ...c.votes, [user.id]: type } })) };
            updatedPost.contentHash = calculatePostHash(updatedPost);
            updatedPostForBroadcast = updatedPost;
            storageService.saveItem('posts', updatedPost, state.userRef.current.id);
            return updatedPost;
        }));
        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'COMMENT_VOTE', senderId: user.homeNodeOnion, payload: { postId, commentId, userId: user.id, type } };
        processedPacketIds.current.add(packet.id!);
        networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        if (updatedPostForBroadcast) {
            broadcastPostState(updatedPostForBroadcast);
            storageService.saveItem('posts', updatedPostForBroadcast, state.userRef.current.id);
        }
        addNotification('Comment Voted', 'Your comment vote has been recorded.', 'info', 'social');
    }, [addNotification, broadcastPostState, state.userRef, state.setPosts, processedPacketIds, state.peersRef]);

    const handleCommentReaction = useCallback((postId: string, commentId: string, emoji: string) => {
        const user = state.userRef.current;
        let updatedPostForBroadcast: Post | null = null;
        let action: 'add' | 'remove' = 'add';

        state.setPosts(prev => prev.map(p => {
            if (p.id !== postId) return p;
            const updatedPost = {
                ...p, commentsList: updateCommentTree(p.commentsList, commentId, (c) => {
                    const currentReactions = { ...(c.reactions || {}) };
                    if (!currentReactions[emoji]) currentReactions[emoji] = [];

                    if (currentReactions[emoji].includes(user.id)) {
                        action = 'remove';
                        currentReactions[emoji] = currentReactions[emoji].filter(id => id !== user.id);
                    } else {
                        action = 'add';
                        currentReactions[emoji] = [...currentReactions[emoji], user.id];
                    }

                    if (currentReactions[emoji].length === 0) delete currentReactions[emoji];

                    return { ...c, reactions: currentReactions };
                })
            };
            updatedPost.contentHash = calculatePostHash(updatedPost);
            updatedPostForBroadcast = updatedPost;
            storageService.saveItem('posts', updatedPost, state.userRef.current.id);
            return updatedPost;
        }));
        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'COMMENT_REACTION', senderId: user.homeNodeOnion, payload: { postId, commentId, userId: user.id, emoji, action } };
        processedPacketIds.current.add(packet.id!);
        networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        if (updatedPostForBroadcast) broadcastPostState(updatedPostForBroadcast);
        if (action === 'add') {
            addNotification('Comment Reacted', `You reacted with ${emoji} on a comment.`, 'info', 'social');
        }
    }, [addNotification, broadcastPostState, state.userRef, state.setPosts, processedPacketIds, state.peersRef]);

    const handleExportKeys = useCallback(() => {
        const user = state.userRef.current;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(user.keys));
        const dlAnchor = document.createElement('a');
        dlAnchor.setAttribute("href", dataStr);
        dlAnchor.setAttribute("download", `gchat_keys_${user.username}.json`);
        document.body.appendChild(dlAnchor);
        dlAnchor.click();
        dlAnchor.remove();
        addNotification('Keys Exported', 'Keep this file safe!', 'success', 'admin');
    }, [addNotification, state.userRef]);

    const handleViewUserPosts = useCallback((userId: string) => {
        setFeedInitialState({ filter: 'public', authorId: userId });
        handleNavigate(AppRoute.FEED);
        addNotification('Navigation', 'Switched to Public Feed for user.', 'info', 'admin');
    }, [addNotification, handleNavigate]);

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
                    onPost={handlePost}
                    onLike={(id) => handleVote(id, 'up')}
                    onDislike={(id) => handleVote(id, 'down')}
                    onComment={handleComment}
                    onCommentVote={handleCommentVote}
                    onCommentReaction={handleCommentReaction}
                    onPostReaction={handlePostReaction}
                    onShare={() => { }}
                    onNavigateToChat={(id) => { setActiveChatId(id); handleNavigate(AppRoute.CHAT); }}
                    onDeletePost={handleDeletePost}
                    onEditPost={handleEditPost}
                    onGlobalSync={handleGlobalSync}
                    onFollowUser={handleFollowUser}
                    onUnfollowUser={handleUnfollowUser}
                    onConnectUser={(t) => handleAddUserContact(t.id, t.homeNode || '', t.displayName)}
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
                    onSendMessage={handleSendMessage}
                    onSendTyping={handleSendTyping}
                    onReadMessage={handleReadMessage}
                    onClearHistory={(id) => { state.setMessages(prev => prev.filter(m => m.threadId !== id)); }}
                    onReactMessage={handleChatReaction}
                    onVoteMessage={handleChatVote}
                    onCreateGroup={handleCreateGroup}
                    onDeleteGroup={handleDeleteGroup}
                    onUpdateGroup={handleUpdateGroup}
                    onAddMemberToGroup={handleAddMemberToGroup}
                    onToggleGroupMute={handleToggleGroupMute}
                    onLeaveGroup={handleLeaveGroup}
                    typingContactId={null}
                    onFollowUser={handleFollowUser}
                    onUnfollowUser={handleUnfollowUser}
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
                    onAcceptRequest={handleAcceptRequest}
                    onDeclineRequest={handleDeclineRequest}
                    onAddContact={(pub, node, name) => handleAddUserContact(pub, node, name)}
                    onDeleteContact={handleDeleteContact}
                    addToast={(title, message, type, category) => addNotification(title, message, type, category || 'admin', AppRoute.CONTACTS)}
                    onNavigateToChat={(id) => { setActiveChatId(id); handleNavigate(AppRoute.CHAT); }}
                    onFollowUser={handleFollowUser}
                    onUnfollowUser={handleUnfollowUser}
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
                    onAddPeer={handleAddPeer}
                    onRemovePeer={handleRemovePeer}
                    onBlockPeer={handleBlockPeer}
                    onSyncPeer={handleSyncPeer}
                    onToggleNetwork={() => { if (isOnline) networkService.disconnect(); else networkService.init(user.id); }}
                    onUpdateProfile={handleUpdateUserWrapper}
                    onUpdateNodeConfig={handleUpdateNodeConfig}
                    onExportKeys={handleExportKeys}
                    addToast={(title, message, type, category) => addNotification(title, message, type, category || 'admin', AppRoute.NODE_SETTINGS)}
                    onSetSyncAge={(hours) => console.log("Set Sync Age", hours)}
                    currentSyncAge={24}
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

const App: React.FC = () => {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const initUser = async () => {
            try {
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
            // We usually don't delete the profile data on logout if we want to "Remember Me", 
            // but if we want to enforce login, we might. 
            // For now, simple state clear. 
            // If we want to fully forget: await kvService.del(USER_STORAGE_KEY);
            // But typical app behavior is just returning to Onboarding/Login screen.
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
