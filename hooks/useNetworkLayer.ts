import { useState, useRef, useEffect, useCallback } from 'react';
import { UserProfile, NetworkPacket, AvailablePeer, Post, ToastMessage, AppRoute, MediaMetadata, EncryptedPayload, Message, Group, ConnectionRequest, NotificationItem, NotificationCategory } from '../types';
import { networkService } from '../services/networkService';
import { calculatePostHash, formatUserIdentity } from '../utils';
import { verifySignature, decryptMessage } from '../services/cryptoService';
import { createPostPayload, mergePosts, appendReply, updateCommentTree, findCommentInTree } from '../utils/dataHelpers';
import { useAppState } from './useAppState';
import { storageService } from '../services/storage';
import { saveMedia, hasMedia } from '../services/mediaStorage';
import { kvService } from '../services/kv';

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

    // Ref for Discovered Peers to avoid stale closures in packet handlers
    const discoveredPeersRef = useRef<AvailablePeer[]>([]);
    useEffect(() => { discoveredPeersRef.current = discoveredPeers; }, [discoveredPeers]);

    const processedPacketIds = useRef<Set<string>>(new Set());
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Ensure we always use the latest addNotification to avoid stale state in async loops
    const addNotificationRef = useRef(addNotification);
    useEffect(() => { addNotificationRef.current = addNotification; }, [addNotification]);

    // Packet Queue for pre-load handling
    const packetQueue = useRef<{ packet: NetworkPacket, senderNodeId: string }[]>([]);

    // --- HELPER: Auto-Download Media ---
    const checkAndAutoDownload = useCallback(async (url: string | undefined, media: MediaMetadata | undefined, context: 'friends' | 'private', authorId: string, peerId: string) => {
        if (!state.mediaSettings.enabled) return;
        if (!url && !media) return;
        if (url && url.startsWith('data:')) return;

        const { autoDownloadFriends, autoDownloadPrivate, maxFileSizeMB } = state.mediaSettings;
        console.log(`[AutoDownload] Triggered. Context: ${context}. Author: ${authorId}. Peer: ${peerId}`);

        // Check Logic Switches
        if (context === 'friends') {
            if (!autoDownloadFriends) {
                console.log(`[AutoDownload] Skipped: Friends toggle disabled.`);
                return;
            }
            // Verify Relationship (Connection or Followed)
            const isFollowed = state.userRef.current.followingIds?.includes(authorId);
            const isConnection = state.contactsRef.current.some(c => c.id === authorId);
            console.log(`[AutoDownload] Author Check: ${authorId} -> Followed: ${isFollowed}, Connection: ${isConnection}`);
            if (!isFollowed && !isConnection) {
                console.log(`[AutoDownload] Skipped: Sender ${authorId.substring(0, 8)}... is not a friend/connection.`);
                return;
            }
        }
        if (context === 'private' && !autoDownloadPrivate) {
            console.log(`[AutoDownload] Skipped: Private toggle disabled.`);
            return;
        }

        const maxBytes = maxFileSizeMB * 1024 * 1024;

        try {
            // Priority: Media Metadata (Mesh Download)
            if (media) {
                // Check size
                if (media.size > maxBytes) {
                    console.log(`[AutoDownload] Skipped: Media size ${media.size} > Limit ${maxBytes}`);
                    return;
                }
                // Check existence
                if (await hasMedia(media.id)) return;

                console.log(`[AutoDownload] Starting Mesh Download for ${media.id} (${(media.size / 1024 / 1024).toFixed(2)}MB) from ${peerId}...`);
                // Fire and forget (it handles saving)
                networkService.downloadMedia(peerId, media, (p) => {
                    // specific progress logging could go here if needed
                }).then(() => {
                    console.log(`[AutoDownload] Completed for ${media.id}`);
                }).catch(e => {
                    console.error(`[AutoDownload] Mesh Download Failed:`, e);
                });
                return;
            }

            // Fallback: URL Fetch (Legacy/External)
            if (url) {
                const mediaId = url.split('/').pop();
                if (mediaId && await hasMedia(mediaId)) return;

                console.log(`[AutoDownload] fetching HEAD for ${url}...`);
                const headRes = await fetch(url, { method: 'HEAD' });
                if (!headRes.ok) {
                    console.warn(`[AutoDownload] HEAD failed for ${url}`);
                    return;
                }
                const size = parseInt(headRes.headers.get('content-length') || '0');

                if (size > 0 && size <= maxBytes) {
                    console.log(`[AutoDownload] Fetching URL ${url} (${(size / 1024 / 1024).toFixed(2)}MB)...`);
                    const res = await fetch(url);
                    const blob = await res.blob();
                    if (mediaId) await saveMedia(mediaId, blob);
                } else {
                    console.log(`[AutoDownload] Skipped URL: Size ${size} > Limit ${maxBytes}`);
                }
            }
        } catch (e) {
            console.error("[AutoDownload] Failed", e);
        }
    }, [state.mediaSettings]);

    // Sync contacts to NetworkService Trusted Peers
    useEffect(() => {
        if (!state.isLoaded) return;
        // FIX: Contact ID is a PubKey. We need the Home Node Onion Addresses.
        const trustedIds = state.contacts.flatMap(c => c.homeNodes || []).filter(addr => addr.endsWith('.onion'));
        console.log(`[UseNetworkLayer] Syncing Trusted Peers. Contacts: ${state.contacts.length}, Trusted Nodes: ${trustedIds.length}`, trustedIds);
        networkService.syncTrustedPeers(trustedIds);
    }, [state.contacts, state.isLoaded]);


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

        // Sanitize Payload: Remove 'originNode' to force Daisy-Chaining
        // The recipient must see US as the source, not the original author.
        const safePayload = { ...packet.payload };
        if (safePayload.originNode) delete safePayload.originNode;
        if (safePayload.media && safePayload.media.originNode) delete safePayload.media.originNode;

        const nextPacket = { ...packet, payload: safePayload, hops: currentHops - 1 };

        // STRICT PRIVACY: Only gossip to Trusted Contacts.
        const trustedOnionAddresses = state.contactsRef.current
            .flatMap(c => c.homeNodes || [])
            .filter(addr => addr.endsWith('.onion'));

        const possibleRecipients = trustedOnionAddresses.filter(addr => {
            const isSource = addr === sourceNodeId;
            const isOrigin = addr === packet.senderId; // packet.senderId is the Link Sender (Friend), so this prevents back-propagation
            const isSelf = addr === state.userRef.current.homeNodeOnion;
            return !isSource && !isOrigin && !isSelf;
        });

        if (possibleRecipients.length === 0) return;

        // Prioritize Online Peers
        const onlinePeers = state.peersRef.current
            .filter(p => p.status === 'online')
            .map(p => p.onionAddress);

        const onlineRecipients = possibleRecipients.filter(r => onlinePeers.includes(r));
        const offlineRecipients = possibleRecipients.filter(r => !onlinePeers.includes(r));

        // Pick up to 3 recipients, prefer online
        const targets: string[] = [];
        const pickRandom = (arr: string[], count: number) => arr.sort(() => 0.5 - Math.random()).slice(0, count);

        targets.push(...pickRandom(onlineRecipients, 3));

        // If we don't have enough online, fill with offline (maybe they just woke up)
        if (targets.length < 3) {
            targets.push(...pickRandom(offlineRecipients, 3 - targets.length));
        }

        targets.forEach(async (recipient) => {
            try {
                // Stagger to avoid congestion
                await new Promise(r => setTimeout(r, Math.random() * 500 + 100));
                await networkService.sendMessage(recipient, nextPacket);
            } catch (err) {
                console.warn(`[Gossip] Failed to relay to ${recipient}`, err);
            }
        });
    }, [state.peersRef, state.userRef, state.contactsRef]); // Added contactsRef dependency

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
        // Check Registry (Async)
        const registry = await kvService.get<any>('gchat_profile_registry') || {};

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
        // Skip auto-online for exit/shutdown packets — their handlers set offline explicitly
        if (senderNodeId && packet.type !== 'USER_EXIT' && packet.type !== 'NODE_SHUTDOWN') {
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
                    networkService.log('INFO', 'NETWORK', `Detected out-of-sync post ${postId}. Fetching from ${senderNodeId}...`);
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

                                storageService.saveItem('posts', merged, currentUser.id).catch(e => console.error("Failed to save merged post", e));

                                const next = [...prev];
                                next[idx] = merged;
                                return next;
                            }
                        });

                        // Also persist new items
                        if (existingIdx === -1) {
                            storageService.saveItem('posts', postWithHash, currentUser.id).catch(e => console.error("Failed to save new post", e));
                        }

                        // Notification Logic: Only notify if it's a BRAND NEW post we haven't seen before
                        const isRecent = (Date.now() - post.timestamp) < (maxSyncAgeHours * 60 * 60 * 1000);
                        if (isRecent && post.authorId !== currentUser.id && existingIdx === -1) {
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
                networkService.log('INFO', 'NETWORK', `Handling Sync Request from ${senderNodeId}`);
                const { inventory, since, requestDiscoveredPeers } = packet.payload;
                const theirInv = inventory as { id: string, hash: string }[];
                const myPosts = state.postsRef.current.filter(p => p.timestamp > since && p.privacy === 'public');

                const missingOrUpdatedOnTheirSide = myPosts.filter(myP => {
                    const theirEntry = theirInv.find(i => i.id === myP.id);
                    if (!theirEntry) return true;
                    const myCurrentHash = calculatePostHash(myP);
                    return theirEntry.hash !== myCurrentHash;
                });

                networkService.log('INFO', 'NETWORK', `Found ${missingOrUpdatedOnTheirSide.length} updates for ${senderNodeId}`);

                // Peer Exchange Logic
                let discoveredPeersPayload: AvailablePeer[] | undefined;
                if (requestDiscoveredPeers) {
                    // Share our discovered peers (excluding the requester and unknown nodes)
                    // We filter for nodes we have actually SEEN recently
                    discoveredPeersPayload = discoveredPeersRef.current.filter(p =>
                        p.id !== senderNodeId
                        // Request: Forward ANY discovered nodes, no time limit
                    );
                    networkService.log('INFO', 'NETWORK', `Including ${discoveredPeersPayload.length} discovered peers in Sync Response`);
                }

                if (missingOrUpdatedOnTheirSide.length > 0 || (discoveredPeersPayload && discoveredPeersPayload.length > 0)) {
                    const respPacket: NetworkPacket = {
                        id: crypto.randomUUID(),
                        type: 'INVENTORY_SYNC_RESPONSE',
                        senderId: currentUser.homeNodeOnion,
                        payload: {
                            posts: missingOrUpdatedOnTheirSide,
                            discoveredPeers: discoveredPeersPayload,
                            senderIdentity: { // SYNC IDENTITY
                                username: currentUser.username,
                                displayName: currentUser.displayName,
                                avatarUrl: currentUser.avatarUrl,
                                bio: currentUser.bio
                            }
                        }
                    };
                    networkService.sendMessage(senderNodeId, respPacket);
                }

                // Process Sender Identity (if provided in Request)
                const { senderIdentity } = packet.payload;
                if (senderIdentity && senderIdentity.username) {
                    state.setContacts(prev => prev.map(c => {
                        if (c.homeNodes && c.homeNodes.includes(senderNodeId)) {
                            // Found the contact living on this node
                            return {
                                ...c,
                                displayName: senderIdentity.displayName || c.displayName,
                                avatarUrl: senderIdentity.avatarUrl || c.avatarUrl,
                                bio: senderIdentity.bio || c.bio
                            };
                        }
                        return c;
                    }));
                }
                break;
            }

            case 'INVENTORY_SYNC_RESPONSE': {
                const { posts, discoveredPeers, senderIdentity } = packet.payload as any;
                const incomingPosts = Array.isArray(packet.payload) ? packet.payload : (posts || []);

                // Process Sender Identity (Response)
                if (senderIdentity && senderIdentity.username) {
                    state.setContacts(prev => prev.map(c => {
                        if (c.homeNodes && c.homeNodes.includes(senderNodeId)) {
                            return {
                                ...c,
                                displayName: senderIdentity.displayName || c.displayName,
                                avatarUrl: senderIdentity.avatarUrl || c.avatarUrl,
                                bio: senderIdentity.bio || c.bio
                            };
                        }
                        return c;
                    }));
                }

                // Process Discovered Peers
                if (discoveredPeers && Array.isArray(discoveredPeers) && discoveredPeers.length > 0) {
                    networkService.log('INFO', 'NETWORK', `Received ${discoveredPeers.length} discovered peers via Sync`);
                    setDiscoveredPeers(prev => {
                        const next = [...prev];
                        discoveredPeers.forEach(peer => {
                            if (peer.id === currentUser.homeNodeOnion) return; // Don't add self
                            const existingIdx = next.findIndex(p => p.id === peer.id);
                            if (existingIdx === -1) {
                                next.push({ ...peer, viaPeerId: senderNodeId, hops: peer.hops ? peer.hops + 1 : 1 });
                            } else {
                                // Optional: Update last seen if newer?
                                if (peer.lastSeen > next[existingIdx].lastSeen) {
                                    next[existingIdx] = { ...next[existingIdx], lastSeen: peer.lastSeen };
                                }
                            }
                        });
                        return next;
                    });
                }

                if (Array.isArray(incomingPosts) && incomingPosts.length > 0) {
                    networkService.log('INFO', 'NETWORK', `Received Sync Response with ${incomingPosts.length} posts`);
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
                                    // FIX: Persist and Propagate New Historical Entires
                                    storageService.saveItem('posts', incWithHash, currentUser.id).catch(e => console.error("Failed to save new sync post", e));
                                    // Announce this new find to our peers (Gossip)
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

                                        // FIX: Persist and Propagate Updates (Comments/Reactions)
                                        storageService.saveItem('posts', merged, currentUser.id).catch(e => console.error("Failed to save merged sync post", e));
                                        // Announce the update to our peers
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
                // Capture Origin for P2P routing
                if (senderNodeId && !postData.originNode) postData.originNode = senderNodeId;

                if (verifySignature(createPostPayload(postData), postData.truthHash, postData.authorPublicKey)) {
                    state.setPosts(prev => {
                        if (prev.some(p => p.id === postData.id)) return prev;
                        const { handle } = formatUserIdentity(postData.authorName);
                        // Corrected linkId to postData.id so navigation works
                        addNotificationRef.current('Friend Post', `${handle} shared a secure broadcast.`, 'info', 'social', AppRoute.FEED, postData.id);

                        // Auto-Download Media
                        if (postData.imageUrl || postData.media) checkAndAutoDownload(postData.imageUrl, postData.media, 'friends', postData.authorId, senderNodeId);

                        storageService.saveItem('posts', postData, currentUser.id).catch(e => console.error("Failed to save friend post", e));

                        return [postData, ...prev];
                    });
                }
                break;
            }

            case 'USER_EXIT': {
                const { userId } = packet.payload;
                // Update Contact Status
                state.setContacts(prev => prev.map(c =>
                    c.id === userId ? { ...c, status: 'offline' } : c
                ));

                // Update Node Peer Status (if senderId is known)
                if (senderNodeId) {
                    state.setPeers(prev => prev.map(p =>
                        p.onionAddress === senderNodeId
                            ? { ...p, status: 'offline', lastSeen: Date.now() }
                            : p
                    ));
                    // Remove from discovered peers
                    setDiscoveredPeers(prev => prev.filter(p => p.id !== senderNodeId));

                    // ACK Header - Respond to let them know we processed it
                    try {
                        const ackPacket: NetworkPacket = {
                            id: crypto.randomUUID(),
                            type: 'USER_EXIT_ACK',
                            senderId: currentUser.homeNodeOnion,
                            payload: { originalPacketId: packet.id }
                        };
                        networkService.sendMessage(senderNodeId, ackPacket);
                    } catch (e) { /* Ignore send errors during exit */ }
                }
                break;
            }

            case 'IDENTITY_UPDATE': {
                const { userId, displayName, avatarUrl, bio } = packet.payload;
                state.setContacts(prev => prev.map(c => {
                    if (c.id === userId) {
                        const updated = {
                            ...c,
                            displayName: displayName || c.displayName,
                            avatarUrl: avatarUrl || c.avatarUrl,
                            bio: bio || c.bio
                        };
                        storageService.saveItem('contacts', updated, currentUser.id);
                        return updated;
                    }
                    return c;
                }));
                // Also update discovered peers if applicable?
                // For now, focusing on contacts.
                break;
            }

            case 'NODE_SHUTDOWN': {
                // Use payload address OR senderId (link layer)
                const targetAddress = packet.payload?.onionAddress || senderNodeId;
                if (!targetAddress) break;

                networkService.log('WARN', 'NETWORK', `Peer Shutdown Signal from ${targetAddress}`);
                addNotificationRef.current('Node Shutdown', `Peer ${targetAddress.substring(0, 8)}... has shut down.`, 'warning', 'admin', AppRoute.NODE_SETTINGS);

                state.setPeers(prev => prev.map(p =>
                    p.onionAddress === targetAddress
                        ? { ...p, status: 'offline', lastSeen: Date.now() }
                        : p
                ));
                // Also update Contact status
                state.setContacts(prev => prev.map(c =>
                    c.homeNodes.includes(targetAddress) ? { ...c, status: 'offline' } : c
                ));

                setDiscoveredPeers(prev => prev.filter(p => p.id !== targetAddress));

                // ACK: Confirm receipt of shutdown signal
                if (senderNodeId) {
                    try {
                        const ackPacket: NetworkPacket = {
                            id: crypto.randomUUID(),
                            type: 'NODE_SHUTDOWN_ACK',
                            senderId: currentUser.homeNodeOnion,
                            payload: { originalPacketId: packet.id }
                        };
                        networkService.sendMessage(senderNodeId, ackPacket);
                    } catch (e) { /* Ignore send errors during peer shutdown */ }
                }

                if (!isReplay) daisyChainPacket(packet, senderNodeId);
                break;
            }

            case 'CONNECTION_REQUEST': {
                const req = packet.payload as ConnectionRequest;

                // SECURITY CHECK: Verify Signature
                if (req.signature) {
                    const { signature, ...dataToVerify } = req;
                    // RECONSTRUCT payload exactly as it was signed
                    const isValid = verifySignature(dataToVerify, signature, req.fromUserId);

                    if (!isValid) {
                        console.warn(`[Security] Invalid Signature on Connection Request from ${req.fromUserId}`);
                        addNotificationRef.current('Security Alert', `Blocked spoofed connection attempt from ${req.fromDisplayName}`, 'error', 'admin');
                        break;
                    }
                } else {
                    // STRICT MODE: Reject unsigned requests
                    console.warn(`[Security] Unsigned Connection Request from ${req.fromUserId}. Allowing for migration compatibility but flagging.`);
                    // In a real strict rollout we would 'break;' here.
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

                const existingContact = state.contactsRef.current.find(c => c.id === req.fromUserId);
                if (existingContact) {
                    if (!existingContact.homeNodes.includes(req.fromHomeNode)) {
                        state.setContacts(prev => prev.map(c => {
                            if (c.id === req.fromUserId) {
                                const updated = { ...c, homeNodes: [req.fromHomeNode] };
                                storageService.saveItem('contacts', updated, currentUser.id);
                                return updated;
                            }
                            return c;
                        }));
                    }
                    if (existingContact.handshakeStatus === 'pending') {
                        console.log(`[Handshake] Contact ${req.fromDisplayName} confirmed active. Status -> completed.`);
                        state.setContacts(prev => prev.map(c => {
                            if (c.id === req.fromUserId) {
                                const updated = { ...c, handshakeStatus: 'completed' as const }; // Explicit cast for TS
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
                            storageService.saveItem('messages', newMsg, currentUser.id);
                            return [...prev, newMsg];
                        });

                        if (isReplay || activeChatId !== threadId) {
                            const group = state.groupsRef.current.find(g => g.id === encPayload.groupId);
                            if (!group || !group.isMuted) {
                                const title = group ? `Group: ${group.name}` : `From ${senderContact.displayName}`;
                                addNotificationRef.current('New Message', title, 'info', 'chat', AppRoute.CHAT, threadId);

                                // Auto-Download Attachment
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
                    storageService.saveItem('posts', updatedPost, currentUser.id);
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

                            // Clean up
                            if (currentReactions[emoji].length === 0) delete currentReactions[emoji];

                            return { ...c, reactions: currentReactions };
                        })
                    };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterCR = updatedPost;
                    storageService.saveItem('posts', updatedPost, currentUser.id);
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
                    storageService.saveItem('posts', updatedPost, currentUser.id);
                    return updatedPost;
                }));

                const postForVote = state.postsRef.current.find(p => p.id === postId);
                if (postForVote && postForVote.authorId === currentUser.id && userId !== currentUser.id) {
                    const voter = state.contactsRef.current.find(c => c.id === userId);
                    const { handle } = formatUserIdentity(voter?.displayName || 'Someone');
                    addNotificationRef.current('New Vote', `${handle} ${type}voted your broadcast`, 'success', 'social', AppRoute.FEED, postId);
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

                    // Clean up
                    if (currentReactions[emoji].length === 0) delete currentReactions[emoji];

                    const updatedPost = { ...p, reactions: currentReactions };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterReact = updatedPost;
                    storageService.saveItem('posts', updatedPost, currentUser.id);
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
    }, [state.setPosts, state.setMessages, state.setGroups, state.setContacts, state.setConnectionRequests, state.setPeers, state.setTypingContactId, state.postsRef, state.contactsRef, state.groupsRef, state.userRef, state.peersRef, broadcastPostState, addNotificationRef, onUpdateUser, user.id, user.homeNodeOnion, daisyChainPacket, state.isLoaded, maxSyncAgeHours, checkAndAutoDownload]);

    // Update Ref whenever handler changes (due to dependency updates)
    useEffect(() => {
        handlePacketRef.current = handlePacket;
    }, [handlePacket]);

    // Socket Listener Setup
    useEffect(() => {
        // Subscribe to network events
        const unsubscribeStatus = networkService.subscribeToStatus((online) => setIsOnline(online));

        networkService.onMessage = (packet, sender) => {
            // --- PEER ACTIVITY MONITOR (Integrated) ---
            // Skip auto-online for exit/shutdown packets — their handlers set offline explicitly
            if (packet.type !== 'USER_EXIT' && packet.type !== 'NODE_SHUTDOWN') {
                state.setPeers(prev => {
                    const existing = prev.find(p => p.onionAddress === sender);
                    if (existing) {
                        // Only update if status changed or it's been a while (throttle updates)
                        if (existing.status !== 'online' || (Date.now() - existing.lastSeen) > 10000) {
                            return prev.map(p => p.onionAddress === sender ? { ...p, status: 'online', lastSeen: Date.now() } : p);
                        }
                        return prev;
                    }
                    // Do NOT auto-add unknown peers here.
                    return prev;
                });
            }

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

    // --- STALENESS TIMEOUT ---
    // If a peer hasn't sent ANY packet in 15 minutes, assume they're offline.
    // Must be > heartbeat interval (10 min) to account for Tor latency.
    // The Contact Status Sync effect will cascade this to contacts automatically.
    const PEER_STALE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
    useEffect(() => {
        const stalenessInterval = setInterval(() => {
            const now = Date.now();
            state.setPeers(prev => {
                const hasStale = prev.some(p => p.status === 'online' && (now - p.lastSeen) > PEER_STALE_TIMEOUT_MS);
                if (!hasStale) return prev;

                return prev.map(p => {
                    if (p.status === 'online' && (now - p.lastSeen) > PEER_STALE_TIMEOUT_MS) {
                        networkService.log('INFO', 'NETWORK', `Peer ${p.onionAddress.substring(0, 8)}... marked offline (no activity for ${Math.round((now - p.lastSeen) / 60000)}m)`);
                        return { ...p, status: 'offline' as const };
                    }
                    return p;
                });
            });
        }, 120000); // Check every 2 minutes

        return () => clearInterval(stalenessInterval);
    }, [state.setPeers]);

    // --- STARTUP RECONNECT + STEADY HEARTBEAT ---
    // Phase 1: Aggressive startup reconnect — ping ONLY offline peers frequently until they respond.
    // Phase 2: Steady-state heartbeat — ping all peers every 10 min for keep-alive.
    useEffect(() => {
        if (!isOnline) return;

        const buildAnnouncePacket = () => {
            const aliasToUse = state.nodeConfig.alias || user.displayName;
            const packet: NetworkPacket = {
                id: crypto.randomUUID(),
                hops: MAX_GOSSIP_HOPS,
                type: 'ANNOUNCE_PEER',
                senderId: user.homeNodeOnion,
                payload: { onionAddress: user.homeNodeOnion, alias: aliasToUse, description: state.nodeConfig.description }
            };
            processedPacketIds.current.add(packet.id!);
            return packet;
        };

        const getAllRecipients = () => {
            const activePeers = state.peersRef.current.map(p => p.onionAddress);
            const contactNodes = state.contactsRef.current.flatMap(c => c.homeNodes || []);
            return Array.from(new Set([...activePeers, ...contactNodes])).filter(addr => addr !== user.homeNodeOnion);
        };

        const getOfflineRecipients = () => {
            const onlinePeerAddrs = new Set(state.peersRef.current.filter(p => p.status === 'online').map(p => p.onionAddress));
            return getAllRecipients().filter(addr => !onlinePeerAddrs.has(addr));
        };

        // --- Phase 1: Startup Reconnect Loop ---
        // Ping offline peers with increasing intervals: 30s → 60s → 120s
        let reconnectAttempt = 0;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        const reconnectLoop = () => {
            const offlinePeers = getOfflineRecipients();

            if (offlinePeers.length === 0) {
                networkService.log('INFO', 'NETWORK', 'All known peers are online. Startup reconnect complete.');
                return; // All peers online — stop reconnecting
            }

            reconnectAttempt++;
            // Backoff: 30s for first 10 attempts (~5min), then 60s for next 10 (~10min), then 120s ongoing
            const interval = reconnectAttempt <= 10 ? 30000 : reconnectAttempt <= 20 ? 60000 : 120000;

            networkService.log('INFO', 'NETWORK', `Reconnect attempt ${reconnectAttempt}: Pinging ${offlinePeers.length} offline peers (next in ${interval / 1000}s)`);
            const packet = buildAnnouncePacket();
            networkService.broadcast(packet, offlinePeers);

            reconnectTimer = setTimeout(reconnectLoop, interval);
        };

        // Start first reconnect ping immediately
        const initialDelay = setTimeout(() => reconnectLoop(), 5000); // 5s after startup to let Tor settle

        // --- Phase 2: Steady-State Heartbeat (all peers, every 10 min) ---
        const heartbeatInterval = setInterval(() => {
            const recipients = getAllRecipients();
            if (recipients.length > 0) {
                networkService.log('INFO', 'NETWORK', `Heartbeat: Announcing presence to ${recipients.length} peers/contacts`);
                const packet = buildAnnouncePacket();
                networkService.broadcast(packet, recipients);
            }
        }, 1000 * 60 * 10); // Every 10 minutes

        return () => {
            clearTimeout(initialDelay);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            clearInterval(heartbeatInterval);
        };
    }, [isOnline, user.isDiscoverable, state.nodeConfig, state.peersRef, user.homeNodeOnion, state.contactsRef, networkService]);

    // --- SYNC SETTINGS ---
    useEffect(() => {
        networkService.updateMediaSettings(state.mediaSettings);
    }, [state.mediaSettings, networkService]);

    // --- PERIODIC INVENTORY SYNC ---
    useEffect(() => {
        const interval = setInterval(() => {
            if (!state.isLoaded) return;

            // STRICT PRIVACY: Only Sync with Trusted Contacts
            const trustedOnionAddresses = state.contactsRef.current
                .flatMap(c => c.homeNodes || [])
                .filter(addr => addr.endsWith('.onion'));

            // We might want to filter by 'Online' status, but for now, let's try all trusted contacts 
            // to re-establish connections if they are lost.

            if (trustedOnionAddresses.length === 0) return;

            console.log(`[Network] Initiating Inventory Sync with ${trustedOnionAddresses.length} trusted peers`);

            const packet: NetworkPacket = {
                id: crypto.randomUUID(),
                type: 'INVENTORY_SYNC_REQUEST',
                senderId: state.userRef.current.homeNodeOnion,
                payload: {
                    since: Date.now() - (24 * 60 * 60 * 1000), // Sync last 24h
                    inventory: state.postsRef.current.map(p => ({ id: p.id, hash: calculatePostHash(p) })),
                    requestDiscoveredPeers: true
                }
            };

            networkService.broadcast(packet, trustedOnionAddresses).catch(err => {
                console.error("[Network] Sync Broadcast Failed", err);
            });

        }, 3600000); // Every 1 Hour (User requested reduction)

        return () => clearInterval(interval);
    }, [state.isLoaded, state.contactsRef, state.userRef, state.postsRef, networkService]);

    // --- SMART SYNC TRIGGERS ---
    const prevOnlinePeerIds = useRef<Set<string>>(new Set());

    // --- CONTACT STATUS SYNC ---
    // Maps online peers to contacts to ensure the "Green Dot" shows up
    useEffect(() => {
        if (!state.isLoaded) return;

        // Use state.peers directly (not peersRef) to ensure we have the committed value
        const currentPeers = state.peers;

        state.setContacts(prev => prev.map(c => {
            const homeNodes = c.homeNodes || [];
            // Check if ANY of the contact's home nodes are currently online
            const isOnline = homeNodes.some(nodeAddr => {
                const peer = currentPeers.find(p => p.onionAddress === nodeAddr);
                return peer?.status === 'online';
            });

            // Update logic: Only update if status or latency needs refreshing
            if (isOnline && c.status !== 'online') {
                return { ...c, status: 'online', lastActive: Date.now() };
            }
            if (!isOnline && c.status === 'online') {
                return { ...c, status: 'offline' };
            }
            return c;
        }));
    }, [state.peers, state.isLoaded]);


    // Trigger Sync when a peer comes online (or new connection formed)
    useEffect(() => {
        if (!state.isLoaded) return;

        const currentOnlinePeers = state.peers.filter(p => p.status === 'online');
        const currentOnlineIds = new Set(currentOnlinePeers.map(p => p.onionAddress));

        // Find peers that JUST came online (present in current, missing in prev)
        const newlyOnlinePeers = currentOnlinePeers.filter(p => !prevOnlinePeerIds.current.has(p.onionAddress));

        // Update Ref
        prevOnlinePeerIds.current = currentOnlineIds;

        // Filter for Trusted Contacts Only
        const trustedNewlyOnline = newlyOnlinePeers.filter(p =>
            state.contacts.flatMap(c => c.homeNodes || []).some(addr => addr === p.onionAddress)
        );

        if (trustedNewlyOnline.length > 0) {
            // Delay sync to avoid stacking with the announcement/packet that just made them online
            const syncTimeout = setTimeout(() => {
                console.log(`[Network] Smart Sync: ${trustedNewlyOnline.length} Trusted Peers came online. Requesting sync.`);

                const packet: NetworkPacket = {
                    id: crypto.randomUUID(),
                    type: 'INVENTORY_SYNC_REQUEST',
                    senderId: state.userRef.current.homeNodeOnion,
                    payload: {
                        since: Date.now() - (24 * 60 * 60 * 1000), // Sync last 24h
                        inventory: state.postsRef.current.map(p => ({ id: p.id, hash: calculatePostHash(p) })),
                        requestDiscoveredPeers: true
                    }
                };

                networkService.broadcast(packet, trustedNewlyOnline.map(p => p.onionAddress));
            }, 10000); // 10-second delay to let Tor settle

            return () => clearTimeout(syncTimeout);
        }
    }, [state.peers, state.isLoaded]); // Triggers when peers array changes (status updates)

    // --- SMART RELAY LISTENER ---
    useEffect(() => {
        // We need to listen to the socket for the internal event we just added
        const socket = networkService['socket']; // Access private socket via bracket notation or add public getter
        // Ideally networkService should expose onRelayRequest.
        // For now, let's assume networkService emits it on the SAME socket instance it uses.

        const handleRelayRequest = async (data: { senderId: string, mediaId: string }) => {
            const { senderId, mediaId } = data;
            const myOnion = state.userRef.current.homeNodeOnion;

            // 1. LOOP PREVENTION: Do not process requests from ourselves
            if (senderId === myOnion) {
                console.warn(`[UseNetworkLayer] Loop Detected: Ignoring Relay Request from myself for ${mediaId}`);
                return;
            }

            console.log(`[UseNetworkLayer] Received Relay Request for ${mediaId} from ${senderId}`);

            // 2. CHECK LOCAL STORAGE: Do we already have it?
            if (await hasMedia(mediaId)) {
                console.log(`[UseNetworkLayer] Media ${mediaId} found in local storage. Offering direct serving to ${senderId}`);
                networkService.sendMessage(senderId, {
                    id: crypto.randomUUID(),
                    type: 'MEDIA_RECOVERY_FOUND',
                    senderId: myOnion,
                    payload: { mediaId }
                });
                return;
            }

            // 3. PROXY LOGIC: Find the Post/Media in our State
            let foundPost = state.postsRef.current.find(p => p.media?.id === mediaId);

            if (foundPost && foundPost.media && foundPost.originNode) {
                const trueOrigin = foundPost.originNode;
                // LOOP PREVENTION 2: Is the Origin actually the requester? (They are asking for their own file? Weird but possible if they lost it)
                // If the requester IS the origin, we can't help them unless we have a copy (checked above).
                // If we don't have a copy, we would just ask them for it, which is a loop.
                if (senderId === trueOrigin) {
                    console.warn(`[UseNetworkLayer] Requester ${senderId} IS the origin. We don't have a specific copy. Aborting.`);
                    return;
                }

                console.log(`[UseNetworkLayer] Found Origin for Relay: ${trueOrigin}. Starting Proxy Download...`);

                try {
                    // Trigger Proxy Download
                    // We need to wait for the download to at least BE REGISTERED as 'active' or 'completed_serving'
                    // networkService.downloadMedia returns a Promise that resolves when the download session is ESTABLISHED (not finished).
                    // Actually, looking at networkService, it returns the mediaId immediately or after basic validation.
                    // We must ensure 'allowUntrusted' is true.
                    await networkService.downloadMedia(trueOrigin, foundPost.media, (p) => { }, true);

                    // 4. Notify the Requester that we have it (or are getting it)
                    // Verification: We should ideally check if it's actually legally active in networkService

                    console.log(`[UseNetworkLayer] Proxy Download Active. Notifying ${senderId}`);
                    networkService.sendMessage(senderId, {
                        id: crypto.randomUUID(),
                        type: 'MEDIA_RECOVERY_FOUND',
                        senderId: myOnion,
                        payload: { mediaId }
                    });

                } catch (e) {
                    console.error(`[UseNetworkLayer] Proxy Download Failed:`, e);
                }
            } else {
                console.warn(`[UseNetworkLayer] Relay Request: Media ${mediaId} not found in local feed state.`);
            }
        };

        socket.on('media-relay-request-internal', handleRelayRequest);
        return () => {
            socket.off('media-relay-request-internal', handleRelayRequest);
        };
    }, [state.postsRef, state.userRef]); // Re-bind if refs change (though refs are stable-ish)

    // Startup Sync: Ask peers for inventory when we come online
    useEffect(() => {
        if (isOnline) {
            const peers = state.peersRef.current.map(p => p.onionAddress);
            if (peers.length === 0) return;

            networkService.log('INFO', 'NETWORK', `Initiating Inventory Sync with ${peers.length} peers`);

            const packet: NetworkPacket = {
                id: crypto.randomUUID(),
                type: 'INVENTORY_SYNC_REQUEST',
                senderId: user.homeNodeOnion,
                payload: {
                    since: Date.now() - (24 * 60 * 60 * 1000), // Sync last 24h
                    inventory: state.postsRef.current.map(p => ({ id: p.id, hash: calculatePostHash(p) })),
                    requestDiscoveredPeers: true,
                    senderIdentity: { // SYNC IDENTITY
                        username: user.username,
                        displayName: user.displayName,
                        avatarUrl: user.avatarUrl,
                        bio: user.bio
                    }
                }
            };

            // Stagger requests slightly if needed, but broadcast helper handles basic loop
            // We shouldn't necessarily BROADCAST a sync request to everyone as a single packet if we want individual responses?
            // Actually, broadcast sends individual messages.
            // But let's be polite and send it to known peers.
            networkService.broadcast(packet, peers);
        }
    }, [isOnline, user.homeNodeOnion, state.peersRef, state.postsRef, networkService]); // Run when online status flips to true

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
