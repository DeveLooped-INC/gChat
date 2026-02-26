import { TYPING_TIMEOUT_MS } from '../constants';
import { useState, useRef, useEffect, useCallback } from 'react';
import { UserProfile, NetworkPacket, AvailablePeer, Post, ToastMessage, AppRoute, MediaMetadata, EncryptedPayload, Message, Group, ConnectionRequest, NotificationCategory } from '../types';
import { networkService } from '../services/networkService';
import { calculatePostHash, formatUserIdentity } from '../utils';
import { verifySignature, decryptMessage } from '../services/cryptoService';
import { createPostPayload, mergePosts, appendReply, updateCommentTree, findCommentInTree } from '../utils/dataHelpers';
import { useAppState } from './useAppState';
import { storageService } from '../services/storage';
import { saveMedia, hasMedia } from '../services/mediaStorage';
import { kvService } from '../services/kv';

// New Sub-Hooks
import { useDiscovery } from './useDiscovery';
import { useMediaTransfer } from './useMediaTransfer';
import { useGossipProtocol } from './useGossipProtocol';

interface UseNetworkLayerProps {
    user: UserProfile;
    state: ReturnType<typeof useAppState>;
    addNotification: (title: string, message: string, type: ToastMessage['type'], category: NotificationCategory, linkRoute?: AppRoute, linkId?: string) => void;
    onUpdateUser: (u: UserProfile) => void;
    activeChatId: string | null;
    maxSyncAgeHours: number;
    performGracefulShutdown: () => void;
}

export const useNetworkLayer = ({
    user,
    state,
    addNotification,
    onUpdateUser,
    activeChatId,
    maxSyncAgeHours,
    performGracefulShutdown
}: UseNetworkLayerProps) => {

    const [isOnline, setIsOnline] = useState<boolean>(false);

    // Make refs for props to avoid stale closures
    const addNotificationRef = useRef(addNotification);
    useEffect(() => { addNotificationRef.current = addNotification; }, [addNotification]);

    // --- FORCE STARTUP RE-CHECK ---
    useEffect(() => {
        if (state.isLoaded) {
            secureLog('INFO', 'Startup: Resetting peer status to offline to force re-verification.');
            state.setPeers(prev => prev.map(p => ({ ...p, status: 'offline' })));
        }
    }, [state.isLoaded]);

    // --- SUB-HOOKS ---
    const {
        discoveredPeers,
        setDiscoveredPeers,
        pendingNodeRequests,
        setPendingNodeRequests,
        handleDiscoveryPacket
    } = useDiscovery({ user, state, addNotification, onUpdateUser });

    const { checkAndAutoDownload } = useMediaTransfer(state);

    const { broadcastPostState, daisyChainPacket } = useGossipProtocol(state, user, addNotification);

    const processedPacketIds = useRef<Set<string>>(new Set());
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Ref for Discovered Peers (sync with hook state)
    const discoveredPeersRef = useRef<AvailablePeer[]>([]);
    useEffect(() => { discoveredPeersRef.current = discoveredPeers; }, [discoveredPeers]);

    // Packet Queue
    const packetQueue = useRef<{ packet: NetworkPacket, senderNodeId: string }[]>([]);

    // Flood Prevention: Rate Limit Per Sender
    // Flood Prevention: Rate Limit Per Sender
    const packetRateLimit = useRef<Map<string, { count: number, start: number }>>(new Map());

    // Peer Sync Throttling
    const lastPeerSync = useRef<Map<string, number>>(new Map());

    // --- SECURE LOGGING HELPER ---
    // Only log to console if explicitly enabled or in dev mode.
    // Always send to networkService for internal debug buffering.
    const secureLog = useCallback((level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, data?: any) => {
        // redact sensitive onion addresses from console output if not debug
        const isDebug = (import.meta as any).env.MODE === 'development' || localStorage.getItem('gchat_debug_enabled') === 'true';

        if (isDebug) {
            const color = level === 'ERROR' ? 'color: red' : level === 'WARN' ? 'color: orange' : 'color: cyan';
            console.log(`%c[${level}] [NetworkLayer] ${message}`, color, data || '');
        }

        // Always log to internal service (which has its own buffer/filtering)
        networkService.log(level, 'NETWORK', message, data);
    }, []);

    // --- STARTUP QUEUE FLUSH ---
    useEffect(() => {
        if (state.isLoaded && packetQueue.current.length > 0) {
            secureLog('INFO', `Flushing ${packetQueue.current.length} queued packets...`);
            while (packetQueue.current.length > 0) {
                const item = packetQueue.current.shift();
                if (item) handlePacketRef.current(item.packet, item.senderNodeId, true);
            }
        }
    }, [state.isLoaded]);

    // --- SESSION REGISTRATION ---
    // Ensure the backend knows our actual userId for targeted packet routing
    useEffect(() => {
        if (state.isLoaded && user && user.id) {
            networkService.registerUser(user.id);
        }
    }, [state.isLoaded, user?.id]);

    // --- PACKET HANDLING LOGIC ---
    const handlePacketRef = useRef<(packet: NetworkPacket, senderNodeId: string, isReplay?: boolean) => Promise<void>>(async () => { });

    const handlePacket = useCallback(async (packet: NetworkPacket, senderNodeId: string, isReplay = false) => {
        // 1. SYNCHRONOUS DEDUPLICATION
        if (!isReplay && packet.id) {
            if (processedPacketIds.current.has(packet.id)) return;
            processedPacketIds.current.add(packet.id);
        }

        // 2. RATE LIMIT CHECK (Flood Prevention)
        if (!isReplay && senderNodeId) {
            const now = Date.now();
            let limit = packetRateLimit.current.get(senderNodeId);
            if (!limit || now - limit.start > 1000) {
                limit = { count: 0, start: now };
            }
            limit.count++;
            packetRateLimit.current.set(senderNodeId, limit);

            if (limit.count > 10) {
                if (limit.count === 11) secureLog('WARN', `Flood detected from ${senderNodeId}. Dropping packets.`);
                return;
            }
        }

        // 3. ANNOUNCE FLOOD PREVENTION (Pre-Log)
        if (packet.type === 'ANNOUNCE_PEER' && senderNodeId) {
            const lastAnnounce = packetRateLimit.current.get(`ANNOUNCE_${senderNodeId}`);
            const now = Date.now();
            if (lastAnnounce && (now - lastAnnounce.start) < 1000 * 60 * 15) {
                // Silent drop - we know this peer
                return;
            }
            packetRateLimit.current.set(`ANNOUNCE_${senderNodeId}`, { count: 1, start: now });
        }

        networkService.log('DEBUG', 'NETWORK', `Handling Packet: ${packet.type} from ${senderNodeId} (Hops: ${packet.hops})`);

        // 2. QUEUE IF NOT LOADED
        if (!state.isLoaded) {
            secureLog('INFO', `State not loaded. Queuing packet ${packet.type} from ${senderNodeId}`);
            packetQueue.current.push({ packet, senderNodeId });
            return;
        }

        const currentUser = state.userRef.current;
        const registry = await kvService.get<any>('gchat_profile_registry') || {};

        // --- EXPLICIT TARGETS ---
        if (packet.targetUserId && packet.targetUserId !== currentUser.id) {
            if (registry[packet.targetUserId]) {
                secureLog('DEBUG', `Parking Targeted Packet (${packet.type}) for offline user ${packet.targetUserId}`);
                await storageService.saveItem('offline_packets', {
                    id: crypto.randomUUID(),
                    packet,
                    senderNodeId,
                    timestamp: Date.now()
                }, packet.targetUserId);
                return;
            }
        }

        // --- IMPLIED TARGETS ---
        let impliedTargetId: string | null = null;
        if (!packet.targetUserId && ['COMMENT', 'VOTE', 'REACTION', 'COMMENT_VOTE', 'COMMENT_REACTION'].includes(packet.type)) {
            const postId = packet.payload.postId;
            const post = state.postsRef.current.find((p: Post) => p.id === postId);
            if (post && registry[post.authorId]) {
                impliedTargetId = post.authorId;
            }
        }

        if (impliedTargetId && impliedTargetId !== currentUser.id) {
            secureLog('DEBUG', `Parking Social Notification for offline user ${impliedTargetId}`);
            await storageService.saveItem('offline_packets', {
                id: crypto.randomUUID(),
                packet,
                senderNodeId,
                timestamp: Date.now()
            }, impliedTargetId);
        }

        // --- PEER STATUS UPDATE ---
        if (senderNodeId && packet.type !== 'USER_EXIT' && packet.type !== 'NODE_SHUTDOWN') {
            state.setPeers(prev => prev.map(p => {
                if (p.onionAddress === senderNodeId && p.status !== 'online') {
                    return { ...p, status: 'online', lastSeen: Date.now() };
                }
                return p;
            }));
        }

        // --- DELEGATE TO SUB-HOOKS ---
        if (packet.type === 'ANNOUNCE_PEER') {
            handleDiscoveryPacket(packet, senderNodeId, isReplay, daisyChainPacket);
            return;
        }

        // Detect unknown nodes
        if (senderNodeId &&
            !state.peersRef.current.some(p => p.onionAddress === senderNodeId) &&
            packet.type !== 'NODE_SHUTDOWN' &&
            packet.type !== 'USER_EXIT' &&
            packet.type !== 'INVENTORY_ANNOUNCE' &&
            packet.type !== 'INVENTORY_SYNC_REQUEST' &&
            packet.type !== 'INVENTORY_SYNC_RESPONSE' &&
            packet.type !== 'POST_DATA' &&
            packet.type !== 'MEDIA_CHUNK' &&
            packet.type !== 'MEDIA_PENDING' &&
            packet.type !== 'MEDIA_RECOVERY_FOUND' &&
            packet.type !== 'MEDIA_TRANSFER_ACK' &&
            packet.type !== 'MEDIA_RELAY_REQUEST' &&
            packet.type !== 'MEDIA_REQUEST' &&
            packet.type !== 'NODE_SHUTDOWN_ACK' &&
            packet.type !== 'USER_EXIT_ACK' &&
            packet.type !== 'GROUP_SYNC' &&
            packet.type !== 'GROUP_QUERY'
        ) {
            setPendingNodeRequests(prev => {
                if (prev.includes(senderNodeId)) return prev;
                addNotificationRef.current('New Node Signal', `Unknown peer ${senderNodeId.substring(0, 8)}... pinged you.`, 'info', 'admin', AppRoute.NODE_SETTINGS);
                return [...prev, senderNodeId];
            });
        }

        switch (packet.type) {
            case 'TYPING': {
                const { userId } = packet.payload;
                if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                state.setTypingContactId(userId);
                typingTimeoutRef.current = setTimeout(() => {
                    state.setTypingContactId(null);
                }, TYPING_TIMEOUT_MS);
                break;
            }

            case 'FOLLOW': {
                if (packet.targetUserId === currentUser.id) {
                    const updatedUser = { ...currentUser, followersCount: (currentUser.followersCount || 0) + 1 };
                    onUpdateUser(updatedUser);
                    addNotificationRef.current('New Follower', 'Someone started following you!', 'success', 'social', AppRoute.NODE_SETTINGS);
                }
                break;
            }

            case 'UNFOLLOW': {
                if (packet.targetUserId === currentUser.id) {
                    const updatedUser = { ...currentUser, followersCount: Math.max(0, (currentUser.followersCount || 0) - 1) };
                    onUpdateUser(updatedUser);
                }
                break;
            }

            case 'INVENTORY_ANNOUNCE': {
                const { postId, contentHash } = packet.payload;
                const existingPost = state.postsRef.current.find((p: Post) => p.id === postId);
                const localHash = existingPost ? calculatePostHash(existingPost) : null;

                if (!existingPost || localHash !== contentHash) {
                    networkService.log('INFO', 'NETWORK', `Detected out-of-sync post ${postId}. Fetching from ${senderNodeId}...`);
                    const reqPacket: NetworkPacket = {
                        id: crypto.randomUUID(),
                        type: 'FETCH_POST',
                        senderId: currentUser.homeNodeOnion,
                        payload: { postId }
                    };
                    networkService.sendMessage(senderNodeId, reqPacket);
                }
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            case 'FETCH_POST': {
                const { postId } = packet.payload;
                const post = state.postsRef.current.find((p: Post) => p.id === postId);
                if (post && post.privacy === 'public') {
                    networkService.log('DEBUG', 'NETWORK', `Serving post ${postId} to ${senderNodeId}`);
                    const respPacket: NetworkPacket = {
                        id: crypto.randomUUID(),
                        type: 'POST_DATA',
                        senderId: currentUser.homeNodeOnion,
                        payload: post
                    };
                    networkService.sendMessage(senderNodeId, respPacket);
                }
                break;
            }

            case 'POST_DATA': {
                const post = packet.payload as Post;
                const payload = createPostPayload(post);
                const isValid = verifySignature(payload, post.truthHash, post.authorPublicKey);

                if (isValid) {
                    const calculatedHash = calculatePostHash(post);
                    const postWithHash = { ...post, contentHash: calculatedHash };

                    const currentPosts = state.postsRef.current;
                    const existingIdx = currentPosts.findIndex((p: Post) => p.id === post.id);
                    let isNewOrUpdated = false;

                    if (existingIdx === -1) {
                        isNewOrUpdated = true;
                    } else {
                        const existingPost = currentPosts[existingIdx];
                        const existingHash = calculatePostHash(existingPost);
                        if (existingHash !== calculatedHash) {
                            isNewOrUpdated = true;
                        }
                    }

                    if (isNewOrUpdated) {
                        state.setPosts(prev => {
                            const idx = prev.findIndex(p => p.id === post.id);
                            if (idx === -1) {
                                return [postWithHash, ...prev];
                            } else {
                                const existing = prev[idx];
                                const merged = mergePosts(existing, postWithHash);
                                merged.contentHash = calculatePostHash(merged); // re-calc hash after merge

                                storageService.saveItem('posts', merged, currentUser.id).catch(e => secureLog('ERROR', "Failed to save merged post", e));
                                const next = [...prev];
                                next[idx] = merged;
                                return next;
                            }
                        });


                        if (existingIdx === -1) {
                            storageService.saveItem('posts', postWithHash, currentUser.id).catch(e => secureLog('ERROR', "Failed to save new post", e));
                        }

                        const isRecent = (Date.now() - post.timestamp) < (maxSyncAgeHours * 60 * 60 * 1000);
                        if (isRecent && post.authorId !== currentUser.id && existingIdx === -1) {
                            const { handle } = formatUserIdentity(post.authorName);
                            const preview = post.content ? post.content.substring(0, 30) : 'Media content';
                            addNotificationRef.current('New Broadcast', `${handle} posted: ${preview}...`, 'info', 'social', AppRoute.FEED, post.id);
                        }

                        broadcastPostState(postWithHash);
                    }
                } else {
                    secureLog('WARN', `Received INVALID post data from ${senderNodeId}. Signature Verification Failed.`);
                }
                break;
            }

            case 'INVENTORY_SYNC_REQUEST': {
                const { inventory, since, requestDiscoveredPeers } = packet.payload;
                const theirInv = inventory as { id: string, hash: string }[];
                const myPosts = state.postsRef.current.filter((p: Post) => p.timestamp > since && p.privacy === 'public');

                const missingOrUpdatedOnTheirSide = myPosts.filter((myP: Post) => {
                    const theirEntry = theirInv.find(i => i.id === myP.id);
                    if (!theirEntry) return true;
                    const myCurrentHash = calculatePostHash(myP);
                    return theirEntry.hash !== myCurrentHash;
                });

                let discoveredPeersPayload: AvailablePeer[] | undefined;
                if (requestDiscoveredPeers) {
                    discoveredPeersPayload = discoveredPeersRef.current.filter(p => p.id !== senderNodeId);
                }

                if (missingOrUpdatedOnTheirSide.length > 0 || (discoveredPeersPayload && discoveredPeersPayload.length > 0)) {
                    const respPacket: NetworkPacket = {
                        id: crypto.randomUUID(),
                        type: 'INVENTORY_SYNC_RESPONSE',
                        senderId: currentUser.homeNodeOnion,
                        payload: {
                            posts: missingOrUpdatedOnTheirSide,
                            discoveredPeers: discoveredPeersPayload,
                            senderIdentity: {
                                username: currentUser.username,
                                displayName: currentUser.displayName,
                                avatarUrl: currentUser.avatarUrl,
                                bio: currentUser.bio
                            }
                        }
                    };
                    networkService.sendMessage(senderNodeId, respPacket);
                } else {
                    secureLog('DEBUG', `Inventory Match with ${senderNodeId}. No updates to send.`);
                }

                const { senderIdentity } = packet.payload;
                if (senderIdentity && senderIdentity.username) {
                    state.setContacts(prev => prev.map(c => {
                        if (c.homeNodes && c.homeNodes.includes(senderNodeId)) {
                            return { ...c, displayName: senderIdentity.displayName || c.displayName, avatarUrl: senderIdentity.avatarUrl || c.avatarUrl, bio: senderIdentity.bio || c.bio };
                        }
                        return c;
                    }));
                }
                break;
            }

            case 'INVENTORY_SYNC_RESPONSE': {
                const { posts, discoveredPeers, senderIdentity } = packet.payload as any;
                const incomingPosts = Array.isArray(packet.payload) ? packet.payload : (posts || []);

                if (senderIdentity && senderIdentity.username) {
                    state.setContacts(prev => prev.map(c => {
                        if (c.homeNodes && c.homeNodes.includes(senderNodeId)) {
                            return { ...c, displayName: senderIdentity.displayName || c.displayName, avatarUrl: senderIdentity.avatarUrl || c.avatarUrl, bio: senderIdentity.bio || c.bio };
                        }
                        return c;
                    }));
                }

                if (discoveredPeers && Array.isArray(discoveredPeers) && discoveredPeers.length > 0) {
                    setDiscoveredPeers(prev => {
                        const next = [...prev];
                        discoveredPeers.forEach(peer => {
                            if (peer.id === currentUser.homeNodeOnion) return;
                            const existingIdx = next.findIndex(p => p.id === peer.id);
                            if (existingIdx === -1) {
                                next.push({ ...peer, viaPeerId: senderNodeId, hops: peer.hops ? peer.hops + 1 : 1 });
                            } else {
                                if (peer.lastSeen > next[existingIdx].lastSeen) {
                                    next[existingIdx] = { ...next[existingIdx], lastSeen: peer.lastSeen };
                                }
                            }
                        });
                        return next;
                    });
                }

                if (Array.isArray(incomingPosts) && incomingPosts.length > 0) {
                    let addedCount = 0;
                    state.setPosts(prev => {
                        const next = [...prev];
                        incomingPosts.forEach(inc => {
                            const idx = next.findIndex((p: Post) => p.id === inc.id);
                            const calculatedHash = calculatePostHash(inc);
                            const incWithHash = { ...inc, contentHash: calculatedHash };

                            if (idx === -1) {
                                if (verifySignature(createPostPayload(inc), inc.truthHash, inc.authorPublicKey)) {
                                    next.push(incWithHash);
                                    addedCount++;
                                    storageService.saveItem('posts', incWithHash, currentUser.id).catch(e => secureLog('ERROR', 'Failed to save post', e));
                                    broadcastPostState(incWithHash);
                                }
                            } else {
                                const existing = next[idx];
                                const existingHash = calculatePostHash(existing);
                                if (existingHash !== calculatedHash) {
                                    if (verifySignature(createPostPayload(inc), inc.truthHash, inc.authorPublicKey)) {
                                        const merged = mergePosts(existing, incWithHash);
                                        merged.contentHash = calculatePostHash(merged);
                                        next[idx] = merged;
                                        addedCount++;
                                        storageService.saveItem('posts', merged, currentUser.id).catch(e => console.error(e));
                                        broadcastPostState(merged);
                                    }
                                }
                            }
                        });
                        return next.sort((a, b) => b.timestamp - a.timestamp);
                    });
                    if (addedCount > 0) addNotificationRef.current('Sync', `Updated ${addedCount} posts via Inventory Sync.`, 'success', 'admin');
                }
                break;
            }

            case 'POST': {
                const postData = packet.payload as Post;
                if (senderNodeId && !postData.originNode) postData.originNode = senderNodeId;

                if (verifySignature(createPostPayload(postData), postData.truthHash, postData.authorPublicKey)) {
                    // Check if this is a genuinely new post BEFORE the state update
                    const isNewPost = !state.postsRef.current.some((p: Post) => p.id === postData.id);

                    state.setPosts(prev => {
                        const idx = prev.findIndex(p => p.id === postData.id);
                        if (idx === -1) {
                            // Genuinely new post
                            storageService.saveItem('posts', postData, currentUser.id).catch(e => secureLog('ERROR', 'Failed to save friend post', e));
                            return [postData, ...prev];
                        } else {
                            // Existing post — merge social interaction state (votes, reactions, comments)
                            const existing = prev[idx];
                            const merged = mergePosts(existing, postData);
                            merged.contentHash = calculatePostHash(merged);
                            const existingHash = calculatePostHash(existing);
                            if (existingHash === merged.contentHash) return prev; // No actual change
                            storageService.saveItem('posts', merged, currentUser.id).catch(e => secureLog('ERROR', 'Failed to save merged post', e));
                            const next = [...prev];
                            next[idx] = merged;
                            return next;
                        }
                    });

                    // Notify only for genuinely new posts (not state updates)
                    if (isNewPost && postData.authorId !== currentUser.id) {
                        const { handle } = formatUserIdentity(postData.authorName);
                        addNotificationRef.current('Friend Post', `${handle} shared a secure broadcast.`, 'info', 'social', AppRoute.FEED, postData.id);
                        if (postData.imageUrl || postData.media) checkAndAutoDownload(postData.imageUrl, postData.media, 'friends', postData.authorId, senderNodeId);
                    }

                    // CRITICAL: Propagate public posts to the mesh (Only if verified)
                    if (!isReplay && postData.privacy === 'public') {
                        daisyChainPacket(packet, senderNodeId);
                    }
                }
                break;
            }

            case 'USER_EXIT': {
                const { userId } = packet.payload;
                state.setContacts(prev => prev.map(c => c.id === userId ? { ...c, status: 'offline' } : c));
                if (senderNodeId) {
                    state.setPeers(prev => prev.map(p => p.onionAddress === senderNodeId ? { ...p, status: 'offline', lastSeen: Date.now() } : p));
                    setDiscoveredPeers(prev => prev.filter(p => p.id !== senderNodeId));
                    try {
                        const ackPacket: NetworkPacket = {
                            id: crypto.randomUUID(), type: 'USER_EXIT_ACK', senderId: currentUser.homeNodeOnion, payload: { originalPacketId: packet.id }
                        };
                        networkService.sendMessage(senderNodeId, ackPacket);
                    } catch (e) { secureLog('WARN', 'Failed to send USER_EXIT_ACK:', e); }
                }
                break;
            }

            case 'IDENTITY_UPDATE': {
                const { userId, displayName, avatarUrl, bio } = packet.payload;
                state.setContacts(prev => prev.map(c => {
                    if (c.id === userId) {
                        const updated = { ...c, displayName: displayName || c.displayName, avatarUrl: avatarUrl || c.avatarUrl, bio: bio || c.bio };
                        storageService.saveItem('contacts', updated, currentUser.id);
                        return updated;
                    }
                    return c;
                }));
                break;
            }

            case 'NODE_SHUTDOWN': {
                const targetAddress = packet.payload?.onionAddress || senderNodeId;
                if (!targetAddress) break;
                networkService.log('WARN', 'NETWORK', `Peer Shutdown Signal from ${targetAddress}`);
                addNotificationRef.current('Node Shutdown', `Peer ${targetAddress.substring(0, 8)}... has shut down.`, 'warning', 'admin', AppRoute.NODE_SETTINGS);

                state.setPeers(prev => prev.map(p => p.onionAddress === targetAddress ? { ...p, status: 'offline', lastSeen: Date.now() } : p));
                state.setContacts(prev => prev.map(c => c.homeNodes.includes(targetAddress) ? { ...c, status: 'offline' } : c));
                setDiscoveredPeers(prev => prev.filter(p => p.id !== targetAddress));

                if (senderNodeId) {
                    try {
                        const ackPacket: NetworkPacket = { id: crypto.randomUUID(), type: 'NODE_SHUTDOWN_ACK', senderId: currentUser.homeNodeOnion, payload: { originalPacketId: packet.id } };
                        networkService.sendMessage(senderNodeId, ackPacket);
                    } catch (e) { secureLog('WARN', 'Failed to send NODE_SHUTDOWN_ACK:', e); }
                }
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            case 'CONNECTION_REQUEST': {
                const req = packet.payload as ConnectionRequest;
                if (req.signature) {
                    const { signature, ...dataToVerify } = req;
                    const isValid = verifySignature(dataToVerify, signature, req.fromUserId);
                    if (!isValid) {
                        break;
                    }
                }

                if (req.fromEncryptionPublicKey) {
                    state.setContacts(prev => prev.map(c => {
                        if (c.id === req.fromUserId && (!c.encryptionPublicKey || c.encryptionPublicKey !== req.fromEncryptionPublicKey)) {
                            const updated = { ...c, encryptionPublicKey: req.fromEncryptionPublicKey };
                            storageService.saveItem('contacts', updated, currentUser.id);
                            return updated;
                        }
                        return c;
                    }));
                }

                const existingContact = state.contactsRef.current.find((c: any) => c.id === req.fromUserId);

                const matchedContact = existingContact;

                if (matchedContact) {
                    if (existingContact && !existingContact.homeNodes.includes(req.fromHomeNode)) {
                        state.setContacts(prev => prev.map(c => {
                            if (c.id === req.fromUserId) {
                                const updated = { ...c, homeNodes: [req.fromHomeNode] };
                                storageService.saveItem('contacts', updated, currentUser.id);
                                return updated;
                            }
                            return c;
                        }));
                    }
                    if (matchedContact.handshakeStatus === 'pending') {
                        state.setContacts(prev => prev.map(c => {
                            if (c.id === matchedContact.id) {
                                const updated = { ...c, handshakeStatus: 'completed' as const };
                                storageService.saveItem('contacts', updated, currentUser.id);
                                return updated;
                            }
                            return c;
                        }));
                    }
                    return;
                }

                state.setConnectionRequests(prev => {
                    if (prev.some(r => r.fromUserId === req.fromUserId)) return prev;
                    addNotificationRef.current('New Connection', `${req.fromDisplayName} wants to connect.`, 'success', 'admin', AppRoute.CONTACTS);
                    storageService.saveItem('requests', req, currentUser.id);
                    return [...prev, req];
                });

                if (req.fromHomeNode) networkService.connect(req.fromHomeNode);
                break;
            }

            case 'MESSAGE': {
                const encPayload = packet.payload as EncryptedPayload;
                const currentEncryptionKey = state.userRef.current.keys.encryption.secretKey;

                let senderContact = state.contactsRef.current.find((c: any) => {
                    if (!c.encryptionPublicKey) return false;
                    return decryptMessage(encPayload.ciphertext, encPayload.nonce, c.encryptionPublicKey, currentEncryptionKey) !== null;
                });

                if (senderContact && senderContact.encryptionPublicKey) {
                    const decrypted = decryptMessage(encPayload.ciphertext, encPayload.nonce, senderContact.encryptionPublicKey, currentEncryptionKey);
                    if (decrypted) {
                        let content = decrypted;
                        let media: MediaMetadata | undefined = undefined;
                        let attachmentUrl: string | undefined = undefined;
                        let replyToId: string | undefined = undefined;
                        let privacy: 'public' | 'connections' = 'public';

                        try {
                            const parsed = JSON.parse(decrypted);
                            content = parsed.content;
                            media = parsed.media;
                            attachmentUrl = parsed.attachment;
                            replyToId = parsed.replyToId;
                            privacy = parsed.privacy || 'public';
                        } catch (e) { secureLog('WARN', 'Failed to parse encrypted message JSON:', e); }

                        const threadId = encPayload.groupId || senderContact.id;
                        const newMsg: Message = {
                            id: encPayload.id || crypto.randomUUID(), threadId, senderId: senderContact.id, content, timestamp: Date.now(), delivered: true,
                            read: activeChatId === threadId && !isReplay, isMine: false, media, attachmentUrl, replyToId, privacy
                        };

                        state.setMessages(prev => {
                            if (prev.some(m => m.id === newMsg.id)) return prev;
                            storageService.saveItem('messages', newMsg, currentUser.id);
                            return [...prev, newMsg];
                        });

                        if (isReplay || activeChatId !== threadId) {
                            const group = state.groupsRef.current.find((g: Group) => g.id === encPayload.groupId);
                            if (!group || !group.isMuted) {
                                const title = group ? `Group: ${group.name}` : `From ${senderContact.displayName}`;
                                addNotificationRef.current('New Message', title, 'info', 'chat', AppRoute.CHAT, threadId);
                                if (attachmentUrl || media) checkAndAutoDownload(attachmentUrl, media, 'private', senderContact.id, senderNodeId);
                            }
                        }
                    }
                }
                break;
            }

            case 'CHAT_REACTION': {
                const { messageId, emoji, userId, action } = packet.payload;
                state.setMessages(prev => prev.map(m => {
                    if (m.id !== messageId) return m;
                    const currentReactions = { ...(m.reactions || {}) };
                    if (!currentReactions[emoji]) currentReactions[emoji] = [];

                    if (action === 'remove') {
                        currentReactions[emoji] = currentReactions[emoji].filter(id => id !== userId);
                    } else {
                        if (!currentReactions[emoji].includes(userId)) currentReactions[emoji] = [...currentReactions[emoji], userId];
                    }
                    const updatedMsg = { ...m, reactions: currentReactions };
                    storageService.saveItem('messages', updatedMsg, currentUser.id);
                    return updatedMsg;
                }));
                break;
            }

            case 'CHAT_VOTE': {
                const { messageId, type, userId, action } = packet.payload;
                state.setMessages(prev => prev.map(m => {
                    if (m.id !== messageId) return m;
                    const currentVotes = { ...(m.votes || {}) };
                    if (action === 'remove') {
                        if (currentVotes[userId] === type) delete currentVotes[userId];
                    } else {
                        currentVotes[userId] = type;
                    }
                    const updatedMsg = { ...m, votes: currentVotes };
                    storageService.saveItem('messages', updatedMsg, currentUser.id);
                    return updatedMsg;
                }));
                break;
            }

            case 'GROUP_INVITE': {
                const group = packet.payload as Group;
                state.setGroups(prev => {
                    if (prev.some(g => g.id === group.id)) return prev;
                    addNotificationRef.current('Group Invite', `Added to group "${group.name}"`, 'success', 'chat', AppRoute.CHAT, group.id);
                    storageService.saveItem('groups', group, currentUser.id);
                    return [...prev, group];
                });
                break;
            }

            case 'GROUP_UPDATE': {
                const updatedGroup = packet.payload as Group;
                state.setGroups(prev => {
                    const exists = prev.some(g => g.id === updatedGroup.id);
                    if (exists) {
                        return prev.map(g => {
                            if (g.id === updatedGroup.id) {
                                const updated = { ...updatedGroup, isMuted: g.isMuted };
                                storageService.saveItem('groups', updated, currentUser.id);
                                return updated;
                            }
                            return g;
                        });
                    } else {
                        if (updatedGroup.members.includes(currentUser.id)) {
                            storageService.saveItem('groups', updatedGroup, currentUser.id);
                            return [...prev, updatedGroup];
                        }
                        return prev;
                    }
                });
                break;
            }

            case 'GROUP_QUERY': {
                const requesterUserId = packet.payload.requesterId;
                if (!requesterUserId) return;
                const sharedGroups = state.groupsRef.current.filter((g: Group) => g.members.includes(requesterUserId) && g.members.includes(currentUser.id));
                if (sharedGroups.length > 0) {
                    networkService.sendMessage(senderNodeId, {
                        id: crypto.randomUUID(), type: 'GROUP_SYNC', senderId: currentUser.homeNodeOnion, payload: sharedGroups
                    });
                }
                break;
            }

            case 'GROUP_SYNC': {
                const recoveredGroups = packet.payload as Group[];
                if (Array.isArray(recoveredGroups)) {
                    state.setGroups(prev => {
                        const next = [...prev];
                        recoveredGroups.forEach(rg => {
                            if (!next.some(g => g.id === rg.id) && rg.members.includes(currentUser.id)) next.push(rg);
                        });
                        return next;
                    });
                }
                break;
            }

            case 'GROUP_DELETE': {
                const { groupId } = packet.payload;
                state.setGroups(prev => prev.filter(g => g.id !== groupId));
                storageService.deleteItem('groups', groupId);
                break;
            }

            case 'DELETE_POST':
                const { postId: delPostId } = packet.payload;
                state.setPosts(prev => prev.filter(p => p.id !== delPostId));
                storageService.deleteItem('posts', delPostId);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;

            case 'EDIT_POST':
                const { postId: editPostId, newContent } = packet.payload;
                let editedPost: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id === editPostId) {
                        const updated = { ...p, content: newContent, isEdited: true, contentHash: calculatePostHash({ ...p, content: newContent, isEdited: true }) };
                        editedPost = updated;
                        storageService.saveItem('posts', updated, currentUser.id);
                        return updated;
                    }
                    return p;
                }));
                if (editedPost) broadcastPostState(editedPost);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;


            // SOCIAL INTERACTIONS
            case 'COMMENT': {
                const { postId, comment: newComment, parentCommentId } = packet.payload;
                let postAfterComment: Post | undefined;

                state.setPosts(prev => prev.map(p => {
                    if (p.id !== postId) return p;
                    if (findCommentInTree(p.commentsList, newComment.id)) return p;
                    let updatedPost = p;
                    if (!parentCommentId) {
                        updatedPost = { ...p, comments: p.comments + 1, commentsList: [...p.commentsList, newComment] };
                    } else {
                        updatedPost = { ...p, comments: p.comments + 1, commentsList: appendReply(p.commentsList, parentCommentId, newComment) };
                    }
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterComment = updatedPost;
                    storageService.saveItem('posts', updatedPost, currentUser.id);
                    return updatedPost;
                }));

                const postForComment = state.postsRef.current.find((p: Post) => p.id === postId);
                if (postForComment && newComment.authorId !== currentUser.id) {
                    const { handle } = formatUserIdentity(newComment.authorName || 'Someone');
                    if (postForComment.authorId === currentUser.id) {
                        // Notify the post author about a new comment
                        addNotificationRef.current('New Comment', `${handle} commented on your broadcast`, 'info', 'social', AppRoute.FEED, postId);
                    } else if (parentCommentId) {
                        // Notify if someone replied to the current user's comment
                        const parentComment = findCommentInTree(postForComment.commentsList, parentCommentId);
                        if (parentComment && parentComment.authorId === currentUser.id) {
                            addNotificationRef.current('Comment Reply', `${handle} replied to your comment`, 'info', 'social', AppRoute.FEED, postId);
                        }
                    }
                }
                if (postAfterComment) broadcastPostState(postAfterComment);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            case 'COMMENT_VOTE': {
                const { postId: cvPostId, commentId: cvCommentId, userId: cvUserId, type: cvType } = packet.payload;
                let postAfterCV: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id !== cvPostId) return p;
                    const updatedPost = {
                        ...p,
                        commentsList: updateCommentTree(p.commentsList, cvCommentId, (c) => ({ ...c, votes: { ...c.votes, [cvUserId]: cvType } }))
                    };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterCV = updatedPost;
                    storageService.saveItem('posts', updatedPost, currentUser.id);
                    return updatedPost;
                }));

                // Notify comment author about the vote on their comment
                if (cvUserId !== currentUser.id) {
                    const postForCV = state.postsRef.current.find((p: Post) => p.id === cvPostId);
                    if (postForCV) {
                        const targetComment = findCommentInTree(postForCV.commentsList, cvCommentId);
                        if (targetComment && targetComment.authorId === currentUser.id) {
                            addNotificationRef.current('Comment Vote', `Someone voted on your comment`, 'info', 'social', AppRoute.FEED, cvPostId);
                        }
                    }
                }
                if (postAfterCV) broadcastPostState(postAfterCV);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            case 'COMMENT_REACTION': {
                const { postId, commentId, userId, emoji, action } = packet.payload;
                let postAfterCR: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id !== postId) return p;
                    const updatedPost = {
                        ...p,
                        commentsList: updateCommentTree(p.commentsList, commentId, (c) => {
                            const currentReactions = { ...(c.reactions || {}) };
                            if (!currentReactions[emoji]) currentReactions[emoji] = [];
                            if (action === 'remove') {
                                currentReactions[emoji] = currentReactions[emoji].filter(id => id !== userId);
                            } else {
                                if (!currentReactions[emoji].includes(userId)) currentReactions[emoji] = [...currentReactions[emoji], userId];
                            }
                            if (currentReactions[emoji].length === 0) delete currentReactions[emoji];
                            return { ...c, reactions: currentReactions };
                        })
                    };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterCR = updatedPost;
                    storageService.saveItem('posts', updatedPost, currentUser.id);
                    return updatedPost;
                }));

                // Notify comment author about the reaction on their comment
                if (action !== 'remove' && userId !== currentUser.id) {
                    const postForCR = state.postsRef.current.find((p: Post) => p.id === postId);
                    if (postForCR) {
                        const targetComment = findCommentInTree(postForCR.commentsList, commentId);
                        if (targetComment && targetComment.authorId === currentUser.id) {
                            addNotificationRef.current('Comment Reaction', `Someone reacted ${emoji} to your comment`, 'info', 'social', AppRoute.FEED, postId);
                        }
                    }
                }
                if (postAfterCR) broadcastPostState(postAfterCR);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            case 'VOTE': {
                const { postId, userId, type } = packet.payload;
                let postAfterVote: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id !== postId) return p;
                    const updatedPost = { ...p, votes: { ...p.votes, [userId]: type } };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterVote = updatedPost;
                    storageService.saveItem('posts', updatedPost, currentUser.id);
                    return updatedPost;
                }));

                // Notify post author about the vote
                if (userId !== currentUser.id) {
                    const postForVote = state.postsRef.current.find((p: Post) => p.id === postId);
                    if (postForVote && postForVote.authorId === currentUser.id) {
                        const voteLabel = type === 'up' ? 'upvoted' : 'downvoted';
                        addNotificationRef.current('New Vote', `Someone ${voteLabel} your broadcast`, 'info', 'social', AppRoute.FEED, postId);
                    }
                }
                if (postAfterVote) broadcastPostState(postAfterVote);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            case 'REACTION': {
                const { postId, userId, emoji, action } = packet.payload;
                let postAfterReact: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id !== postId) return p;
                    const currentReactions = { ...(p.reactions || {}) };
                    if (!currentReactions[emoji]) currentReactions[emoji] = [];
                    if (action === 'remove') {
                        currentReactions[emoji] = currentReactions[emoji].filter(id => id !== userId);
                    } else {
                        if (!currentReactions[emoji].includes(userId)) currentReactions[emoji] = [...currentReactions[emoji], userId];
                    }
                    if (currentReactions[emoji].length === 0) delete currentReactions[emoji];
                    const updatedPost = { ...p, reactions: currentReactions };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterReact = updatedPost;
                    storageService.saveItem('posts', updatedPost, currentUser.id);
                    return updatedPost;
                }));

                // Notify post author about the reaction
                if (action !== 'remove' && userId !== currentUser.id) {
                    const postForReact = state.postsRef.current.find((p: Post) => p.id === postId);
                    if (postForReact && postForReact.authorId === currentUser.id) {
                        addNotificationRef.current('New Reaction', `Someone reacted ${emoji} to your broadcast`, 'info', 'social', AppRoute.FEED, postId);
                    }
                }
                if (postAfterReact) broadcastPostState(postAfterReact);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            // --- MEDIA TRANSFER HANDLERS ---
            // These delegate to networkService which manages the download state machine

            case 'MEDIA_PENDING': {
                if (senderNodeId) networkService.handleMediaPending(senderNodeId, packet.payload as { mediaId: string, chunkIndex: number });
                break;
            }

            case 'MEDIA_REQUEST': {
                networkService.handleMediaRequest(senderNodeId, packet.payload);
                break;
            }

            case 'MEDIA_CHUNK': {
                networkService.handleMediaChunk(senderNodeId, packet.payload);
                break;
            }

            case 'MEDIA_RELAY_REQUEST': {
                networkService.handleRelayRequest(senderNodeId, packet.payload);
                break;
            }

            case 'MEDIA_RECOVERY_FOUND': {
                networkService.handleRecoveryFound(senderNodeId, packet.payload);
                break;
            }

            case 'MEDIA_TRANSFER_ACK': {
                networkService.handleMediaTransferAck(senderNodeId, packet.payload);
                break;
            }
        }
    }, [state, broadcastPostState, daisyChainPacket, checkAndAutoDownload, handleDiscoveryPacket, addNotificationRef, onUpdateUser, maxSyncAgeHours, user.id, user.homeNodeOnion]);

    useEffect(() => {
        handlePacketRef.current = handlePacket;
    }, [handlePacket]);

    // Socket Listener
    useEffect(() => {
        const unsubscribeStatus = networkService.subscribeToStatus((online, nodeId) => {
            setIsOnline(online);
            // Sync user.homeNodeOnion whenever the backend reports a (new) public address
            // Use state.userRef.current to avoid stale closure (this effect depends on [state.isLoaded])
            const currentUser = state.userRef.current;
            if (online && nodeId && currentUser && nodeId !== currentUser.homeNodeOnion) {
                onUpdateUser({ ...currentUser, homeNodeOnion: nodeId });
            }
        });

        networkService.onMessage = (packet, sender) => {
            if (packet.type !== 'USER_EXIT' && packet.type !== 'NODE_SHUTDOWN') {
                state.setPeers(prev => {
                    const existing = prev.find(p => p.onionAddress === sender);
                    if (existing) {
                        if (existing.status !== 'online' || (Date.now() - existing.lastSeen) > 10000) {
                            // SYNC TRIGGER: Peer came online
                            if (existing.status !== 'online') {
                                const lastSync = lastPeerSync.current.get(sender) || 0;
                                if (Date.now() - lastSync > 5 * 60 * 1000) { // 5 min throttle
                                    lastPeerSync.current.set(sender, Date.now());
                                    // Trigger sync logic (see below)
                                    // We can't call performSync() because it syncs everyone.
                                    // We need a targeted sync.
                                    // Hack: We'll do it in a timeout to break the render cycle or use a separate function.
                                    setTimeout(() => syncWithPeer(sender), 1000);
                                }
                            }
                            return prev.map(p => p.onionAddress === sender ? { ...p, status: 'online', lastSeen: Date.now() } : p);
                        }
                        return prev;
                    }
                    return prev;
                });
            }
            handlePacketRef.current(packet, sender);
        };

        const queueInterval = setInterval(() => {
            if (state.isLoaded && packetQueue.current.length > 0) {
                const item = packetQueue.current.shift();
                if (item) handlePacketRef.current(item.packet, item.senderNodeId, true);
            }
        }, 1000);

        return () => {
            unsubscribeStatus();
            clearInterval(queueInterval);
        };
    }, [state.isLoaded]);

    const PEER_STALE_TIMEOUT_MS = 5 * 60 * 1000;
    useEffect(() => {
        const stalenessInterval = setInterval(() => {
            const now = Date.now();
            state.setPeers(prev => {
                const hasStale = prev.some(p => p.status === 'online' && (now - p.lastSeen) > PEER_STALE_TIMEOUT_MS);
                if (!hasStale) return prev;
                return prev.map(p => {
                    if (p.status === 'online' && (now - p.lastSeen) > PEER_STALE_TIMEOUT_MS) {
                        return { ...p, status: 'offline' as const };
                    }
                    return p;
                });
            });
        }, 120000);
        return () => clearInterval(stalenessInterval);
    }, [state.setPeers]);

    // --- SYNC SETTINGS ---
    useEffect(() => {
        networkService.updateMediaSettings(state.mediaSettings);
    }, [state.mediaSettings]);

    // --- PERIODIC INVENTORY SYNC ---
    // --- SYNC LOGIC ---

    const sendInventorySyncRequest = useCallback((recipients: string[]) => {
        if (recipients.length === 0) return;
        const since = Date.now() - (maxSyncAgeHours * 60 * 60 * 1000);
        networkService.log('INFO', 'NETWORK', `Sending Inventory Sync Request to ${recipients.length} peers`);

        const packet: NetworkPacket = {
            id: crypto.randomUUID(), type: 'INVENTORY_SYNC_REQUEST', senderId: user.homeNodeOnion,
            payload: {
                since,
                inventory: state.postsRef.current.filter((p: Post) => p.timestamp > since && p.privacy === 'public').map((p: Post) => ({ id: p.id, hash: calculatePostHash(p) })),
                requestDiscoveredPeers: true,
                senderIdentity: { username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, bio: user.bio }
            }
        };
        networkService.broadcast(packet, recipients).catch(console.error);

        // Also sync groups
        const groupPacket: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_QUERY', senderId: user.homeNodeOnion, payload: { requesterId: user.id } };
        networkService.broadcast(groupPacket, recipients).catch(console.error);

    }, [user, state.postsRef, maxSyncAgeHours]);

    const syncWithPeer = useCallback((peerOnion: string) => {
        sendInventorySyncRequest([peerOnion]);
    }, [sendInventorySyncRequest]);

    const performFullSync = useCallback(() => {
        if (!state.isLoaded) return;
        const contactNodes = state.contactsRef.current.flatMap((c: any) => c.homeNodes || []).filter((addr: string) => addr.endsWith('.onion'));
        const peerAddrs = state.peersRef.current.map((p: any) => p.onionAddress);
        const allRecipients = Array.from(new Set([...contactNodes, ...peerAddrs])).filter(addr => addr !== user.homeNodeOnion);

        if (allRecipients.length > 0) {
            sendInventorySyncRequest(allRecipients as string[]);
        }
    }, [state.isLoaded, state.contactsRef, state.peersRef, user, sendInventorySyncRequest]);


    // --- PERIODIC INVENTORY SYNC ---
    useEffect(() => {
        if (state.isLoaded) {
            // Initial Sync on Load (with slight delay to let peers connect)
            setTimeout(performFullSync, 2000);
        }

        const interval = setInterval(performFullSync, 3600000); // Every 1 Hour
        return () => clearInterval(interval);
    }, [state.isLoaded, performFullSync]);

    // --- SMART SYNC TRIGGERS ---
    const prevOnlinePeerIds = useRef<Set<string>>(new Set());

    useEffect(() => { // Contact Status Sync
        if (!state.isLoaded) return;
        const currentPeers = state.peers;
        state.setContacts(prev => prev.map(c => {
            const homeNodes = c.homeNodes || [];
            const isOnline = homeNodes.some(nodeAddr => {
                const peer = currentPeers.find(p => p.onionAddress === nodeAddr);
                return peer?.status === 'online';
            });
            // Update logic: Only update if status or latency needs refreshing
            if (isOnline && c.status !== 'online') return { ...c, status: 'online', lastActive: Date.now() };
            if (!isOnline && c.status === 'online') return { ...c, status: 'offline' };
            return c;
        }));
    }, [state.peers, state.isLoaded]);

    useEffect(() => { // Smart Sync Trigger
        if (!state.isLoaded) return;
        const currentOnlinePeers = state.peers.filter(p => p.status === 'online');
        const currentOnlineIds = new Set(currentOnlinePeers.map(p => p.onionAddress));
        const newlyOnlinePeers = currentOnlinePeers.filter(p => !prevOnlinePeerIds.current.has(p.onionAddress));
        prevOnlinePeerIds.current = currentOnlineIds;

        if (newlyOnlinePeers.length > 0) {
            const syncTimeout = setTimeout(() => {
                secureLog('INFO', `Smart Sync: ${newlyOnlinePeers.length} peers came online. Requesting sync.`);
                const since = Date.now() - (maxSyncAgeHours * 60 * 60 * 1000);
                const syncTargets = newlyOnlinePeers.map(p => p.onionAddress);
                const inventoryPacket: NetworkPacket = {
                    id: crypto.randomUUID(), type: 'INVENTORY_SYNC_REQUEST', senderId: user.homeNodeOnion,
                    payload: {
                        since,
                        inventory: state.postsRef.current.filter((p: Post) => p.timestamp > since && p.privacy === 'public').map((p: Post) => ({ id: p.id, hash: calculatePostHash(p) })),
                        requestDiscoveredPeers: true,
                        senderIdentity: { username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, bio: user.bio }
                    }
                };
                networkService.broadcast(inventoryPacket, syncTargets);
                const groupPacket: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_QUERY', senderId: user.homeNodeOnion, payload: { requesterId: user.id } };
                networkService.broadcast(groupPacket, syncTargets);
            }, 10000);
            return () => clearTimeout(syncTimeout);
        }
    }, [state.peers, state.isLoaded, maxSyncAgeHours]);

    // --- SMART RELAY LISTENER ---
    useEffect(() => {
        const socket = (networkService as any).socket;
        if (!socket) return;

        const handleRelayRequest = async (data: { senderId: string, mediaId: string }) => {
            const { senderId, mediaId } = data;
            const myOnion = user.homeNodeOnion;
            if (senderId === myOnion) return;
            // Check local storage
            if (await hasMedia(mediaId)) {
                networkService.sendMessage(senderId, { id: crypto.randomUUID(), type: 'MEDIA_RECOVERY_FOUND', senderId: myOnion, payload: { mediaId } });
                return;
            }
            // Proxy logic
            const foundPost = state.postsRef.current.find((p: Post) => p.media?.id === mediaId);
            if (foundPost && foundPost.media && foundPost.originNode && foundPost.originNode !== senderId) {
                try {
                    await networkService.downloadMedia(foundPost.originNode, foundPost.media, () => { }, true);
                    networkService.sendMessage(senderId, { id: crypto.randomUUID(), type: 'MEDIA_RECOVERY_FOUND', senderId: myOnion, payload: { mediaId } });
                } catch (e) {
                    secureLog('ERROR', "Relay proxy failed", e);
                }
            }
        };
        socket.on('media-relay-request-internal', handleRelayRequest);
        return () => { socket.off('media-relay-request-internal', handleRelayRequest); };
    }, [state.postsRef, user]);

    useEffect(() => {
        if (!isOnline) return;

        const buildAnnouncePacket = (useGossip: boolean) => {
            const aliasToUse = state.nodeConfig.alias || user.displayName;
            const packet: NetworkPacket = {
                id: crypto.randomUUID(),
                hops: (useGossip && user.isDiscoverable) ? 6 : 0,
                type: 'ANNOUNCE_PEER',
                senderId: user.homeNodeOnion,
                payload: { onionAddress: user.homeNodeOnion, alias: aliasToUse, description: state.nodeConfig.description }
            };
            processedPacketIds.current.add(packet.id!);
            return packet;
        };

        const getAllRecipients = () => {
            const activePeers = state.peersRef.current.map((p: any) => p.onionAddress);
            const contactNodes = state.contactsRef.current.flatMap((c: any) => c.homeNodes || []);
            return Array.from(new Set([...activePeers, ...contactNodes])).filter(addr => addr !== user.homeNodeOnion);
        };

        const getOfflineRecipients = () => {
            const onlinePeerAddrs = new Set(state.peersRef.current.filter((p: any) => p.status === 'online').map((p: any) => p.onionAddress));
            return getAllRecipients().filter(addr => !onlinePeerAddrs.has(addr as string));
        };

        let reconnectAttempt = 0;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        const reconnectLoop = () => {
            const offlinePeers = getOfflineRecipients();
            if (offlinePeers.length === 0) return;

            reconnectAttempt++;
            // FIX: Less aggressive interval (30s start, max 60s) to prevent echo loops
            const interval = reconnectAttempt <= 5 ? 30000 : 60000;

            const announcePacket = buildAnnouncePacket(false);
            // Only send ANNOUNCE to wake them up.
            // When they reply, they become "online" and the Smart Sync (line 1066) will trigger the heavy sync.
            networkService.broadcast(announcePacket, offlinePeers as string[]);

            reconnectTimer = setTimeout(reconnectLoop, interval);
        };

        const initialDelay = setTimeout(() => reconnectLoop(), 5000);

        const heartbeatInterval = setInterval(() => {
            const recipients = getAllRecipients();
            if (recipients.length > 0) {
                const packet = buildAnnouncePacket(true);
                networkService.broadcast(packet, recipients as string[]);
            }
        }, 1000 * 60 * 60); // 1 Hour (Reduced from 2 mins)

        return () => {
            clearTimeout(initialDelay);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            clearInterval(heartbeatInterval);
        };
    }, [isOnline, user.isDiscoverable, state.nodeConfig, state.peersRef, user.homeNodeOnion, state.contactsRef]);

    return {
        isOnline,
        discoveredPeers,
        setDiscoveredPeers,
        pendingNodeRequests,
        setPendingNodeRequests,
        processedPacketIds,
        broadcastPostState
    };
};
