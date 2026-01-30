
import { useState, useRef, useEffect, useCallback } from 'react';
import { UserProfile, NetworkPacket, AvailablePeer, Post, ToastMessage, AppRoute, MediaMetadata, EncryptedPayload, Message, Group, ConnectionRequest, NotificationItem, NotificationCategory } from '../types';
import { networkService } from '../services/networkService';
import { calculatePostHash, formatUserIdentity } from '../utils';
import { verifySignature, decryptMessage } from '../services/cryptoService';
import { createPostPayload, mergePosts, appendReply, updateCommentTree, findCommentInTree } from '../utils/dataHelpers';
import { useAppState } from './useAppState';
import { storageService } from '../services/storage';

const MAX_GOSSIP_HOPS = 6;

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
    const [discoveredPeers, setDiscoveredPeers] = useState<AvailablePeer[]>([]);
    const [pendingNodeRequests, setPendingNodeRequests] = useState<string[]>([]);

    const processedPacketIds = useRef<Set<string>>(new Set());
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Ensure we always use the latest addNotification to avoid stale state in async loops
    const addNotificationRef = useRef(addNotification);
    useEffect(() => { addNotificationRef.current = addNotification; }, [addNotification]);

    // Packet Queue for pre-load handling
    const packetQueue = useRef<{ packet: NetworkPacket, senderNodeId: string }[]>([]);

    // --- HELPER: Broadcast Post State (Ensures propagation of edits/comments) ---
    const broadcastPostState = useCallback((post: Post) => {
        if (post.privacy !== 'public') return;

        // Calculate fresh hash representing current state (content + comments + votes)
        const hash = calculatePostHash(post);

        const packet: NetworkPacket = {
            id: crypto.randomUUID(),
            type: 'INVENTORY_ANNOUNCE',
            hops: MAX_GOSSIP_HOPS,
            senderId: state.userRef.current.homeNodeOnion,
            payload: {
                postId: post.id,
                contentHash: hash,
                authorId: post.authorId,
                timestamp: post.timestamp
            }
        };
        // Broadcast to all connected peers so they know the state has changed
        networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
    }, [state.userRef, state.peersRef]);

    // --- DAISY CHAIN GOSSIP (OPTIMIZED) ---
    const daisyChainPacket = useCallback(async (packet: NetworkPacket, sourceNodeId?: string) => {
        const currentHops = packet.hops || 0;
        if (currentHops <= 0) return;

        const nextPacket = { ...packet, hops: currentHops - 1 };
        const allPeers = state.peersRef.current.map(p => p.onionAddress);

        const possibleRecipients = allPeers.filter(addr => {
            const isSource = addr === sourceNodeId;
            const isOrigin = addr === packet.senderId;
            const isSelf = addr === state.userRef.current.homeNodeOnion;
            return !isSource && !isOrigin && !isSelf;
        });

        if (possibleRecipients.length === 0) return;

        const recipients = possibleRecipients.sort(() => 0.5 - Math.random()).slice(0, 4);

        recipients.forEach(async (recipient) => {
            await new Promise(r => setTimeout(r, Math.random() * 300));
            networkService.sendMessage(recipient, nextPacket);
        });
    }, [state.peersRef, state.userRef]);

    // --- PACKET HANDLING LOGIC ---
    // We use a REF to hold the latest version of this function to avoid stale closures in the socket listener
    const handlePacketRef = useRef<(packet: NetworkPacket, senderNodeId: string, isReplay?: boolean) => Promise<void>>(async () => { });

    const handlePacket = useCallback(async (packet: NetworkPacket, senderNodeId: string, isReplay = false) => {
        // CRITICAL FIX: If state is not loaded (contacts empty), queue packet.
        if (!state.isLoaded) {
            console.log(`[Network] State not loaded. Queuing packet ${packet.type} from ${senderNodeId}`);
            packetQueue.current.push({ packet, senderNodeId });
            return;
        }

        const currentUser = state.userRef.current;
        const registry = JSON.parse(localStorage.getItem('gchat_profile_registry') || '{}');

        // --- 1. HANDLING EXPLICIT TARGETS (Direct Messages, Handshakes) ---
        if (packet.targetUserId && packet.targetUserId !== currentUser.id) {
            if (registry[packet.targetUserId]) {
                console.log(`[Network] Parking Targeted Packet (${packet.type}) for offline user ${packet.targetUserId}`);
                await storageService.saveItem('offline_packets', {
                    id: crypto.randomUUID(),
                    packet,
                    senderNodeId,
                    timestamp: Date.now()
                }, packet.targetUserId);
                return;
            }
        }

        // --- 2. HANDLING IMPLIED TARGETS (Social Broadcasts) ---
        let impliedTargetId: string | null = null;
        if (!packet.targetUserId && ['COMMENT', 'VOTE', 'REACTION', 'COMMENT_VOTE', 'COMMENT_REACTION'].includes(packet.type)) {
            const postId = packet.payload.postId;
            const post = state.postsRef.current.find(p => p.id === postId);
            if (post && registry[post.authorId]) {
                impliedTargetId = post.authorId;
            }
        }

        if (impliedTargetId && impliedTargetId !== currentUser.id) {
            console.log(`[Network] Parking Social Notification for offline user ${impliedTargetId}`);
            await storageService.saveItem('offline_packets', {
                id: crypto.randomUUID(),
                packet,
                senderNodeId,
                timestamp: Date.now()
            }, impliedTargetId);
        }

        // --- DEDUPLICATION ---
        if (packet.id && processedPacketIds.current.has(packet.id)) {
            return;
        }
        if (packet.id) processedPacketIds.current.add(packet.id);

        // --- PEER STATUS UPDATE ---
        if (senderNodeId) {
            state.setPeers(prev => prev.map(p => {
                if (p.onionAddress === senderNodeId && p.status !== 'online') {
                    return { ...p, status: 'online', lastSeen: Date.now() };
                }
                return p;
            }));
        }

        // Detect unknown nodes
        if (senderNodeId &&
            !state.peersRef.current.some(p => p.onionAddress === senderNodeId) &&
            packet.type !== 'NODE_SHUTDOWN' &&
            packet.type !== 'USER_EXIT' &&
            packet.type !== 'INVENTORY_ANNOUNCE' &&
            packet.type !== 'INVENTORY_SYNC_REQUEST'
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
                }, 3000);
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
                const existingPost = state.postsRef.current.find(p => p.id === postId);
                const localHash = existingPost ? calculatePostHash(existingPost) : null;

                if (!existingPost || localHash !== contentHash) {
                    console.log(`[Network] Detected out-of-sync post ${postId}. Fetching from ${senderNodeId}...`);
                    const reqPacket: NetworkPacket = {
                        id: crypto.randomUUID(),
                        type: 'FETCH_POST',
                        senderId: currentUser.homeNodeOnion,
                        payload: { postId }
                    };
                    networkService.sendMessage(senderNodeId, reqPacket);
                }
                // PROPAGATION: Daisy chain this announcement so neighbors of neighbors hear it
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            case 'FETCH_POST': {
                const { postId } = packet.payload;
                const post = state.postsRef.current.find(p => p.id === postId);
                if (post && post.privacy === 'public') {
                    console.log(`[Network] Serving post ${postId} to ${senderNodeId}`);
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

                    // Determine if new or updated by checking REF directly
                    const currentPosts = state.postsRef.current;
                    const existingIdx = currentPosts.findIndex(p => p.id === post.id);
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
                                // Merge Logic inside setter to be safe against concurrent updates
                                const existing = prev[idx];
                                const merged = mergePosts(existing, postWithHash);
                                merged.contentHash = calculatePostHash(merged);
                                const next = [...prev];
                                next[idx] = merged;
                                return next;
                            }
                        });

                        // Notification Logic
                        const isRecent = (Date.now() - post.timestamp) < (maxSyncAgeHours * 60 * 60 * 1000);
                        if (isRecent && post.authorId !== currentUser.id) {
                            const { handle } = formatUserIdentity(post.authorName);
                            const preview = post.content ? post.content.substring(0, 30) : 'Media content';
                            addNotificationRef.current('New Broadcast', `${handle} posted: ${preview}...`, 'info', 'social', AppRoute.FEED, post.id);
                        }

                        // PROPAGATION TRIGGER: Announce new state to my peers
                        broadcastPostState(postWithHash);
                    }
                } else {
                    console.warn(`[Network] Received INVALID post data from ${senderNodeId}. Signature Verification Failed.`);
                }
                break;
            }

            case 'INVENTORY_SYNC_REQUEST': {
                console.log(`[Network] Handling Sync Request from ${senderNodeId}`);
                const { inventory, since } = packet.payload;
                const theirInv = inventory as { id: string, hash: string }[];
                const myPosts = state.postsRef.current.filter(p => p.timestamp > since && p.privacy === 'public');

                const missingOrUpdatedOnTheirSide = myPosts.filter(myP => {
                    const theirEntry = theirInv.find(i => i.id === myP.id);
                    if (!theirEntry) return true;
                    const myCurrentHash = calculatePostHash(myP);
                    return theirEntry.hash !== myCurrentHash;
                });

                console.log(`[Network] Found ${missingOrUpdatedOnTheirSide.length} updates for ${senderNodeId}`);

                if (missingOrUpdatedOnTheirSide.length > 0) {
                    const respPacket: NetworkPacket = {
                        id: crypto.randomUUID(),
                        type: 'INVENTORY_SYNC_RESPONSE',
                        senderId: currentUser.homeNodeOnion,
                        payload: missingOrUpdatedOnTheirSide
                    };
                    networkService.sendMessage(senderNodeId, respPacket);
                }
                break;
            }

            case 'INVENTORY_SYNC_RESPONSE': {
                const incomingPosts = packet.payload as Post[];
                if (Array.isArray(incomingPosts)) {
                    console.log(`[Network] Received Sync Response with ${incomingPosts.length} posts`);
                    let addedCount = 0;
                    state.setPosts(prev => {
                        const next = [...prev];
                        incomingPosts.forEach(inc => {
                            const idx = next.findIndex(p => p.id === inc.id);
                            const calculatedHash = calculatePostHash(inc);
                            const incWithHash = { ...inc, contentHash: calculatedHash };

                            if (idx === -1) {
                                if (verifySignature(createPostPayload(inc), inc.truthHash, inc.authorPublicKey)) {
                                    next.push(incWithHash);
                                    addedCount++;
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

            case 'ANNOUNCE_PEER': {
                const info = packet.payload;
                if (info && info.onionAddress) {
                    const existingPeer = state.peersRef.current.find(p => p.onionAddress === info.onionAddress);

                    if (existingPeer) {
                        state.setPeers(prev => prev.map(p =>
                            p.onionAddress === info.onionAddress
                                ? { ...p, alias: info.alias || p.alias, status: 'online', lastSeen: Date.now() }
                                : p
                        ));
                        setDiscoveredPeers(prev => prev.filter(p => p.id !== info.onionAddress));
                    } else {
                        setDiscoveredPeers(prev => {
                            const existing = prev.find(p => p.id === info.onionAddress);
                            if (existing) {
                                return prev.map(p => p.id === info.onionAddress ? { ...p, lastSeen: Date.now(), hops: MAX_GOSSIP_HOPS - (packet.hops || 0) } : p);
                            }
                            return [...prev, {
                                id: info.onionAddress,
                                displayName: info.alias || 'Unknown Node',
                                username: info.description || 'Discovered via Mesh',
                                viaPeerId: senderNodeId,
                                hops: MAX_GOSSIP_HOPS - (packet.hops || 0),
                                lastSeen: Date.now()
                            }];
                        });
                    }
                    if (!isReplay) daisyChainPacket(packet, senderNodeId);
                }
                break;
            }

            case 'POST': {
                const postData = packet.payload as Post;
                if (verifySignature(createPostPayload(postData), postData.truthHash, postData.authorPublicKey)) {
                    state.setPosts(prev => {
                        if (prev.some(p => p.id === postData.id)) return prev;
                        const { handle } = formatUserIdentity(postData.authorName);
                        // Corrected linkId to postData.id so navigation works
                        addNotificationRef.current('Friend Post', `${handle} shared a secure broadcast.`, 'info', 'social', AppRoute.FEED, postData.id);
                        return [postData, ...prev];
                    });
                }
                break;
            }

            case 'USER_EXIT': {
                const { userId } = packet.payload;
                state.setContacts(prev => prev.map(c =>
                    c.id === userId ? { ...c, status: 'offline' } : c
                ));
                break;
            }

            case 'NODE_SHUTDOWN': {
                const { onionAddress } = packet.payload;
                state.setPeers(prev => prev.map(p =>
                    p.onionAddress === onionAddress
                        ? { ...p, status: 'offline', lastSeen: Date.now() }
                        : p
                ));
                setDiscoveredPeers(prev => prev.filter(p => p.id !== onionAddress));
                if (packet.hops && packet.hops > 0) {
                    if (!isReplay) daisyChainPacket(packet, senderNodeId);
                }
                break;
            }

            case 'CONNECTION_REQUEST': {
                const req = packet.payload as ConnectionRequest;
                if (req.fromEncryptionPublicKey) {
                    state.setContacts(prev => prev.map(c => {
                        if (c.id === req.fromUserId && (!c.encryptionPublicKey || c.encryptionPublicKey !== req.fromEncryptionPublicKey)) {
                            return { ...c, encryptionPublicKey: req.fromEncryptionPublicKey };
                        }
                        return c;
                    }));
                }

                const existingContact = state.contactsRef.current.find(c => c.id === req.fromUserId);
                if (existingContact) {
                    if (!existingContact.homeNodes.includes(req.fromHomeNode)) {
                        state.setContacts(prev => prev.map(c => c.id === req.fromUserId ? { ...c, homeNodes: [req.fromHomeNode] } : c));
                    }
                    return;
                }

                state.setConnectionRequests(prev => {
                    if (prev.some(r => r.fromUserId === req.fromUserId)) return prev;
                    addNotificationRef.current('New Connection', `${req.fromDisplayName} wants to connect.`, 'success', 'admin', AppRoute.CONTACTS);
                    return [...prev, req];
                });

                if (req.fromHomeNode) networkService.connect(req.fromHomeNode);
                break;
            }

            case 'MESSAGE': {
                const encPayload = packet.payload as EncryptedPayload;
                const currentEncryptionKey = state.userRef.current.keys.encryption.secretKey;

                let senderContact = state.contactsRef.current.find(c => {
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
                        } catch (e) { }

                        const threadId = encPayload.groupId || senderContact.id;
                        const newMsg: Message = {
                            id: encPayload.id || crypto.randomUUID(),
                            threadId: threadId,
                            senderId: senderContact.id,
                            content: content,
                            timestamp: Date.now(),
                            delivered: true,
                            read: activeChatId === threadId && !isReplay,
                            isMine: false,
                            media, attachmentUrl, replyToId, privacy
                        };
                        state.setMessages(prev => {
                            if (prev.some(m => m.id === newMsg.id)) return prev;
                            return [...prev, newMsg];
                        });

                        if (isReplay || activeChatId !== threadId) {
                            const group = state.groupsRef.current.find(g => g.id === encPayload.groupId);
                            if (!group || !group.isMuted) {
                                const title = group ? `Group: ${group.name}` : `From ${senderContact.displayName}`;
                                addNotificationRef.current('New Message', title, 'info', 'chat', AppRoute.CHAT, threadId);
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
                    return { ...m, reactions: currentReactions };
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
                    return { ...m, votes: currentVotes };
                }));
                break;
            }

            case 'GROUP_INVITE': {
                const group = packet.payload as Group;
                state.setGroups(prev => {
                    if (prev.some(g => g.id === group.id)) return prev;
                    addNotificationRef.current('Group Invite', `Added to group "${group.name}"`, 'success', 'chat', AppRoute.CHAT, group.id);
                    return [...prev, group];
                });
                break;
            }

            case 'GROUP_UPDATE': {
                const updatedGroup = packet.payload as Group;
                state.setGroups(prev => {
                    const exists = prev.some(g => g.id === updatedGroup.id);
                    if (exists) {
                        return prev.map(g => g.id === updatedGroup.id ? { ...updatedGroup, isMuted: g.isMuted } : g);
                    } else {
                        if (updatedGroup.members.includes(currentUser.id)) return [...prev, updatedGroup];
                        return prev;
                    }
                });
                break;
            }

            case 'GROUP_QUERY': {
                const requesterUserId = packet.payload.requesterId;
                if (!requesterUserId) return;
                const sharedGroups = state.groupsRef.current.filter(g => g.members.includes(requesterUserId) && g.members.includes(currentUser.id));
                if (sharedGroups.length > 0) {
                    networkService.sendMessage(senderNodeId, {
                        id: crypto.randomUUID(),
                        type: 'GROUP_SYNC',
                        senderId: currentUser.homeNodeOnion,
                        payload: sharedGroups
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
                break;
            }

            case 'DELETE_POST':
                const { postId: delPostId } = packet.payload;
                state.setPosts(prev => prev.filter(p => p.id !== delPostId));
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;

            case 'EDIT_POST':
                const { postId: editPostId, newContent } = packet.payload;
                let editedPost: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id === editPostId) {
                        const updated = { ...p, content: newContent, isEdited: true, contentHash: calculatePostHash({ ...p, content: newContent, isEdited: true }) };
                        editedPost = updated;
                        return updated;
                    }
                    return p;
                }));
                if (editedPost) broadcastPostState(editedPost);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;

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
                    return updatedPost;
                }));

                const postForComment = state.postsRef.current.find(p => p.id === postId);
                if (postForComment) {
                    const { handle } = formatUserIdentity(newComment.authorName || 'Someone');
                    if (postForComment.authorId === currentUser.id && newComment.authorId !== currentUser.id) {
                        addNotificationRef.current('New Comment', `${handle} commented on your broadcast`, 'info', 'social', AppRoute.FEED, postId);
                    }
                    if (parentCommentId) {
                        const parent = findCommentInTree(postForComment.commentsList, parentCommentId);
                        if (parent && parent.authorId === currentUser.id && newComment.authorId !== currentUser.id) {
                            addNotificationRef.current('New Reply', `${handle} replied to your comment`, 'info', 'social', AppRoute.FEED, postId);
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
                        commentsList: updateCommentTree(p.commentsList, cvCommentId, (c) => ({
                            ...c,
                            votes: { ...c.votes, [cvUserId]: cvType }
                        }))
                    };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterCV = updatedPost;
                    return updatedPost;
                }));

                const postForCV = state.postsRef.current.find(p => p.id === cvPostId);
                if (postForCV) {
                    const targetComment = findCommentInTree(postForCV.commentsList, cvCommentId);
                    if (targetComment && targetComment.authorId === currentUser.id && cvUserId !== currentUser.id) {
                        const voter = state.contactsRef.current.find(c => c.id === cvUserId);
                        const { handle } = formatUserIdentity(voter?.displayName || 'Someone');
                        addNotificationRef.current('Comment Vote', `${handle} ${cvType}voted your comment`, 'success', 'social', AppRoute.FEED, cvPostId);
                    }
                }

                if (postAfterCV) broadcastPostState(postAfterCV);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            case 'COMMENT_REACTION': {
                const { postId, commentId, userId, emoji } = packet.payload;
                let postAfterCR: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id !== postId) return p;
                    const updatedPost = {
                        ...p,
                        commentsList: updateCommentTree(p.commentsList, commentId, (c) => {
                            const currentReactions = { ...(c.reactions || {}) };
                            if (!currentReactions[emoji]) currentReactions[emoji] = [];
                            if (!currentReactions[emoji].includes(userId)) currentReactions[emoji] = [...currentReactions[emoji], userId];
                            return { ...c, reactions: currentReactions };
                        })
                    };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterCR = updatedPost;
                    return updatedPost;
                }));

                const postForCR = state.postsRef.current.find(p => p.id === postId);
                if (postForCR) {
                    const targetComment = findCommentInTree(postForCR.commentsList, commentId);
                    if (targetComment && targetComment.authorId === currentUser.id && userId !== currentUser.id) {
                        const reactor = state.contactsRef.current.find(c => c.id === userId);
                        const { handle } = formatUserIdentity(reactor?.displayName || 'Someone');
                        addNotificationRef.current('New Reaction', `${handle} reacted ${emoji} to your comment`, 'success', 'social', AppRoute.FEED, postId);
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
                    return updatedPost;
                }));
                if (postAfterVote) broadcastPostState(postAfterVote);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            case 'REACTION': {
                const { postId, userId, emoji } = packet.payload;
                let postAfterReact: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id !== postId) return p;
                    const currentReactions = { ...(p.reactions || {}) };
                    if (!currentReactions[emoji]) currentReactions[emoji] = [];
                    if (!currentReactions[emoji].includes(userId)) currentReactions[emoji] = [...currentReactions[emoji], userId];
                    const updatedPost = { ...p, reactions: currentReactions };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterReact = updatedPost;
                    return updatedPost;
                }));

                const postForReact = state.postsRef.current.find(p => p.id === postId);
                if (postForReact && postForReact.authorId === currentUser.id && userId !== currentUser.id) {
                    const reactor = state.contactsRef.current.find(c => c.id === userId);
                    const { handle } = formatUserIdentity(reactor?.displayName || 'Someone');
                    addNotificationRef.current('New Reaction', `${handle} reacted ${emoji} to your broadcast`, 'success', 'social', AppRoute.FEED, postId);
                }

                if (postAfterReact) broadcastPostState(postAfterReact);
                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }
        }
    }, [state.setPosts, state.setMessages, state.setGroups, state.setContacts, state.setConnectionRequests, state.setPeers, state.setTypingContactId, state.postsRef, state.contactsRef, state.groupsRef, state.userRef, state.peersRef, broadcastPostState, addNotificationRef, onUpdateUser, user.id, user.homeNodeOnion, daisyChainPacket, state.isLoaded, maxSyncAgeHours]);

    // Update Ref whenever handler changes (due to dependency updates)
    useEffect(() => {
        handlePacketRef.current = handlePacket;
    }, [handlePacket]);

    // Socket Listener Setup
    useEffect(() => {
        // Subscribe to network events
        const unsubscribeStatus = networkService.subscribeToStatus((online) => setIsOnline(online));

        networkService.onMessage = (packet, sender) => {
            handlePacketRef.current(packet, sender);
        };

        // Queue processing (if state loads later)
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

    // Announcement Heartbeat
    useEffect(() => {
        if (isOnline && user.isDiscoverable) {
            const announce = () => {
                const aliasToUse = state.nodeConfig.alias || user.displayName;
                const packet: NetworkPacket = {
                    id: crypto.randomUUID(),
                    hops: MAX_GOSSIP_HOPS,
                    type: 'ANNOUNCE_PEER',
                    senderId: user.homeNodeOnion,
                    payload: { onionAddress: user.homeNodeOnion, alias: aliasToUse, description: state.nodeConfig.description }
                };
                processedPacketIds.current.add(packet.id!);
                networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
            };

            // Announce on connect
            announce();

            // Re-announce periodically
            const interval = setInterval(announce, 1000 * 60 * 60); // Every hour
            return () => clearInterval(interval);
        }
    }, [isOnline, user.isDiscoverable, state.nodeConfig, state.peersRef, user.homeNodeOnion]);

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
