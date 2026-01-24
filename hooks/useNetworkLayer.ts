
import { useState, useRef, useEffect, useCallback } from 'react';
import { UserProfile, NetworkPacket, AvailablePeer, Post, ToastMessage, AppRoute, MediaMetadata, EncryptedPayload, Message, Group, ConnectionRequest } from '../types';
import { networkService } from '../services/networkService';
import { calculatePostHash, formatUserIdentity } from '../utils';
import { verifySignature, decryptMessage } from '../services/cryptoService';
import { createPostPayload, mergePosts, appendReply, updateCommentTree, findCommentInTree } from '../utils/dataHelpers';
import { useAppState } from './useAppState';

const MAX_GOSSIP_HOPS = 6;

interface UseNetworkLayerProps {
    user: UserProfile;
    state: ReturnType<typeof useAppState>;
    addNotification: (title: string, message: string, type: ToastMessage['type'], linkRoute?: AppRoute, linkId?: string) => void;
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

    // --- HELPER: Broadcast Post State (Ensures propagation of edits/comments) ---
    const broadcastPostState = useCallback((post: Post) => {
        if (post.privacy !== 'public') return;
        
        // Calculate fresh hash representing current state (content + comments + votes)
        const hash = calculatePostHash(post);
        
        const packet: NetworkPacket = {
            id: crypto.randomUUID(),
            type: 'INVENTORY_ANNOUNCE',
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

        // OPTIMIZATION: Shuffle and take subset (GossipSub Lite)
        // If we have many peers, don't spam everyone. Take 3 random ones to gossip to.
        // This dramatically reduces bandwidth while maintaining high probability of propagation.
        const recipients = possibleRecipients.sort(() => 0.5 - Math.random()).slice(0, 3);

        recipients.forEach(async (recipient) => {
            await new Promise(r => setTimeout(r, Math.random() * 200));
            networkService.sendMessage(recipient, nextPacket);
        });
    }, [state.peersRef, state.userRef]);

    // --- PACKET HANDLING LOGIC ---
    // We use a REF to hold the latest version of this function to avoid stale closures in the socket listener
    const handlePacketRef = useRef<(packet: NetworkPacket, senderNodeId: string) => void>(() => {});

    const handlePacket = useCallback((packet: NetworkPacket, senderNodeId: string) => {
        const currentUser = state.userRef.current;
        
        if (packet.id && processedPacketIds.current.has(packet.id)) {
            return; 
        }
        if (packet.id) processedPacketIds.current.add(packet.id);

        if (senderNodeId) {
            state.setPeers(prev => prev.map(p => {
                if (p.onionAddress === senderNodeId && p.status !== 'online') {
                    return { ...p, status: 'online', lastSeen: Date.now() };
                }
                return p;
            }));
        }

        if (senderNodeId && 
            !state.peersRef.current.some(p => p.onionAddress === senderNodeId) && 
            packet.type !== 'NODE_SHUTDOWN' && 
            packet.type !== 'USER_EXIT' && 
            packet.type !== 'ANNOUNCE_PEER' &&
            packet.type !== 'INVENTORY_ANNOUNCE' &&
            packet.type !== 'INVENTORY_SYNC_REQUEST'
        ) {
            setPendingNodeRequests(prev => {
                if (prev.includes(senderNodeId)) return prev;
                addNotification('New Node Signal', `Unknown peer ${senderNodeId.substring(0,8)}... pinged you.`, 'info', AppRoute.NODE_SETTINGS);
                return [...prev, senderNodeId];
            });
        }

        switch(packet.type) {
            // --- FOLLOW / UNFOLLOW ---
            case 'FOLLOW': {
                if (packet.targetUserId === currentUser.id) {
                    const updatedUser = { ...currentUser, followersCount: (currentUser.followersCount || 0) + 1 };
                    onUpdateUser(updatedUser);
                    addNotification('New Follower', 'Someone started following you!', 'success', AppRoute.NODE_SETTINGS);
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

            // --- INVENTORY PROTOCOL HANDLERS ---
            case 'INVENTORY_ANNOUNCE': {
                const { postId, contentHash } = packet.payload;
                const existingPost = state.postsRef.current.find(p => p.id === postId);
                const localHash = existingPost ? calculatePostHash(existingPost) : null;
                
                if (!existingPost || localHash !== contentHash) {
                    const reqPacket: NetworkPacket = {
                        id: crypto.randomUUID(),
                        type: 'FETCH_POST',
                        senderId: currentUser.homeNodeOnion,
                        payload: { postId }
                    };
                    networkService.sendMessage(senderNodeId, reqPacket);
                }
                break;
            }

            case 'FETCH_POST': {
                const { postId } = packet.payload;
                const post = state.postsRef.current.find(p => p.id === postId);
                if (post && post.privacy === 'public') {
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
                
                if (verifySignature(payload, post.truthHash, post.authorPublicKey)) {
                    const calculatedHash = calculatePostHash(post);
                    const postWithHash = { ...post, contentHash: calculatedHash };

                    let isNewOrUpdated = false;

                    state.setPosts(prev => {
                        const idx = prev.findIndex(p => p.id === post.id);
                        if (idx === -1) {
                            isNewOrUpdated = true;
                            return [postWithHash, ...prev];
                        } else {
                            const existing = prev[idx];
                            const existingHash = calculatePostHash(existing);
                            if (existingHash !== calculatedHash) {
                                isNewOrUpdated = true;
                                const merged = mergePosts(existing, postWithHash);
                                merged.contentHash = calculatePostHash(merged); // Recalc hash of merged result
                                
                                const next = [...prev];
                                next[idx] = merged;
                                return next;
                            }
                        }
                        return prev;
                    });

                    if (isNewOrUpdated) {
                        const isRecent = (Date.now() - post.timestamp) < (maxSyncAgeHours * 60 * 60 * 1000);
                        if (isRecent && post.authorId !== currentUser.id) {
                            const { handle } = formatUserIdentity(post.authorName);
                            addNotification('New Broadcast', `${handle} posted: ${post.content.substring(0, 30)}...`, 'info', AppRoute.FEED, post.authorId);
                        }
                        broadcastPostState(postWithHash);
                    }
                }
                break;
            }

            case 'INVENTORY_SYNC_REQUEST': {
                const { inventory, since } = packet.payload;
                const theirInv = inventory as { id: string, hash: string }[];
                const myPosts = state.postsRef.current.filter(p => p.timestamp > since && p.privacy === 'public');
                
                const missingOrUpdatedOnTheirSide = myPosts.filter(myP => {
                    const theirEntry = theirInv.find(i => i.id === myP.id);
                    if (!theirEntry) return true; 
                    const myCurrentHash = calculatePostHash(myP);
                    return theirEntry.hash !== myCurrentHash;
                });

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
                        return next.sort((a,b) => b.timestamp - a.timestamp);
                    });
                    if (addedCount > 0) addNotification('Sync', `Updated ${addedCount} posts via Inventory Sync.`, 'success');
                }
                break;
            }

            // --- LEGACY / OTHER HANDLERS ---

            case 'ANNOUNCE_PEER': {
                const info = packet.payload;
                if (info && info.onionAddress) {
                    const isAlreadyPeer = state.peersRef.current.some(p => p.onionAddress === info.onionAddress);

                    if (isAlreadyPeer) {
                        state.setPeers(prev => prev.map(p => 
                            p.onionAddress === info.onionAddress 
                                ? { ...p, alias: info.alias, status: 'online', lastSeen: Date.now() } 
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
                    daisyChainPacket(packet, senderNodeId);
                }
                break;
            }

            case 'POST':
                const post = packet.payload as Post;
                if (verifySignature(createPostPayload(post), post.truthHash, post.authorPublicKey)) {
                    state.setPosts(prev => {
                        if (prev.some(p => p.id === post.id)) return prev;
                        const { handle } = formatUserIdentity(post.authorName);
                        addNotification('Friend Post', `${handle} shared a secure broadcast.`, 'info', AppRoute.FEED, post.authorId);
                        return [post, ...prev];
                    });
                }
                break;

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
                    daisyChainPacket(packet, senderNodeId);
                }
                break;
            }

            case 'CONNECTION_REQUEST':
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
                if (existingContact) return;
                state.setConnectionRequests(prev => {
                    if (prev.some(r => r.fromUserId === req.fromUserId)) return prev;
                    addNotification('New Connection', `${req.fromDisplayName} wants to connect.`, 'success', AppRoute.CONTACTS);
                    return [...prev, req];
                });
                if (req.fromHomeNode) networkService.connect(req.fromHomeNode);
                break;

            case 'MESSAGE': 
                const encPayload = packet.payload as EncryptedPayload;
                let senderContact = state.contactsRef.current.find(c => {
                    if (!c.encryptionPublicKey) return false;
                    return decryptMessage(encPayload.ciphertext, encPayload.nonce, c.encryptionPublicKey, currentUser.keys.encryption.secretKey) !== null;
                });

                if(senderContact && senderContact.encryptionPublicKey) {
                    const decrypted = decryptMessage(encPayload.ciphertext, encPayload.nonce, senderContact.encryptionPublicKey, currentUser.keys.encryption.secretKey);
                    if(decrypted) {
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
                        } catch(e){}
                        
                        const threadId = encPayload.groupId || senderContact.id;
                        const newMsg: Message = {
                            id: encPayload.id || crypto.randomUUID(),
                            threadId: threadId,
                            senderId: senderContact.id,
                            content: content,
                            timestamp: Date.now(),
                            delivered: true,
                            read: activeChatId === threadId, 
                            isMine: false,
                            media, attachmentUrl, replyToId, privacy
                        };
                        state.setMessages(prev => {
                            if (prev.some(m => m.id === newMsg.id)) return prev;
                            return [...prev, newMsg];
                        });
                        if (activeChatId !== threadId) {
                            const group = state.groupsRef.current.find(g => g.id === encPayload.groupId);
                            if (!group || !group.isMuted) {
                                const title = group ? `Group: ${group.name}` : `From ${senderContact.displayName}`;
                                addNotification('New Message', title, 'info', AppRoute.CHAT, threadId);
                            }
                        }
                    }
                }
                break;
            
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
                    addNotification('Group Invite', `Added to group "${group.name}"`, 'success', AppRoute.CHAT, group.id);
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
                daisyChainPacket(packet, senderNodeId);
                break;

            case 'EDIT_POST':
                const { postId: editPostId, newContent } = packet.payload;
                let editedPost: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id === editPostId) {
                        const updated = { ...p, content: newContent, isEdited: true, contentHash: calculatePostHash({...p, content: newContent, isEdited: true}) };
                        editedPost = updated;
                        return updated;
                    }
                    return p;
                }));
                if(editedPost) broadcastPostState(editedPost);
                daisyChainPacket(packet, senderNodeId);
                break;

            case 'COMMENT':
                const { postId, comment: newComment, parentCommentId } = packet.payload;
                let postAfterComment: Post | undefined;
                
                state.setPosts(prev => prev.map(p => {
                    if (p.id !== postId) return p;
                    
                    // Idempotency: Check if comment already exists
                    if (findCommentInTree(p.commentsList, newComment.id)) return p;

                    let updatedPost = p;
                    if (!parentCommentId) {
                        updatedPost = { ...p, comments: p.comments + 1, commentsList: [...p.commentsList, newComment] };
                    } else {
                        updatedPost = { ...p, comments: p.comments + 1, commentsList: appendReply(p.commentsList, parentCommentId, newComment) };
                    }
                    // Recalculate hash because state changed
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterComment = updatedPost;
                    return updatedPost;
                }));
                
                // --- NOTIFICATION LOGIC ---
                const postForComment = state.postsRef.current.find(p => p.id === postId);
                if (postForComment) {
                    const { handle } = formatUserIdentity(newComment.authorName || 'Someone');
                    // 1. Notify Post Owner
                    if (postForComment.authorId === currentUser.id && newComment.authorId !== currentUser.id) {
                        addNotification('New Comment', `${handle} commented on your broadcast`, 'info', AppRoute.FEED, postId);
                    }
                    // 2. Notify Parent Comment Owner (Reply)
                    if (parentCommentId) {
                        const parent = findCommentInTree(postForComment.commentsList, parentCommentId);
                        if (parent && parent.authorId === currentUser.id && newComment.authorId !== currentUser.id) {
                            addNotification('New Reply', `${handle} replied to your comment`, 'info', AppRoute.FEED, postId);
                        }
                    }
                }
                // --------------------------

                if (postAfterComment) broadcastPostState(postAfterComment);
                daisyChainPacket(packet, senderNodeId);
                break;

            case 'COMMENT_VOTE':
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

                // --- NOTIFICATION LOGIC ---
                const postForCV = state.postsRef.current.find(p => p.id === cvPostId);
                if (postForCV) {
                    const targetComment = findCommentInTree(postForCV.commentsList, cvCommentId);
                    if (targetComment && targetComment.authorId === currentUser.id && cvUserId !== currentUser.id) {
                        const voter = state.contactsRef.current.find(c => c.id === cvUserId);
                        const { handle } = formatUserIdentity(voter?.displayName || 'Someone');
                        addNotification('Comment Vote', `${handle} ${cvType}voted your comment`, 'success', AppRoute.FEED, cvPostId);
                    }
                }
                // --------------------------

                if(postAfterCV) broadcastPostState(postAfterCV);
                daisyChainPacket(packet, senderNodeId);
                break;

            case 'COMMENT_REACTION':
                const { postId: crPostId, commentId: crCommentId, userId: crUserId, emoji: crEmoji } = packet.payload;
                let postAfterCR: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id !== crPostId) return p;
                    const updatedPost = {
                        ...p,
                        commentsList: updateCommentTree(p.commentsList, crCommentId, (c) => {
                            const currentReactions = { ...(c.reactions || {}) };
                            if (!currentReactions[crEmoji]) currentReactions[crEmoji] = [];
                            if (!currentReactions[crEmoji].includes(crUserId)) currentReactions[crEmoji] = [...currentReactions[crEmoji], crUserId];
                            return { ...c, reactions: currentReactions };
                        })
                    };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterCR = updatedPost;
                    return updatedPost;
                }));

                // --- NOTIFICATION LOGIC ---
                const postForCR = state.postsRef.current.find(p => p.id === crPostId);
                if (postForCR) {
                    const targetComment = findCommentInTree(postForCR.commentsList, crCommentId);
                    if (targetComment && targetComment.authorId === currentUser.id && crUserId !== currentUser.id) {
                        const reactor = state.contactsRef.current.find(c => c.id === crUserId);
                        const { handle } = formatUserIdentity(reactor?.displayName || 'Someone');
                        addNotification('New Reaction', `${handle} reacted ${crEmoji} to your comment`, 'success', AppRoute.FEED, crPostId);
                    }
                }
                // --------------------------

                if(postAfterCR) broadcastPostState(postAfterCR);
                daisyChainPacket(packet, senderNodeId);
                break;

            case 'VOTE':
                const { postId: vPostId, userId: vUserId, type: vType } = packet.payload;
                let postAfterVote: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id !== vPostId) return p;
                    const updatedPost = { ...p, votes: { ...p.votes, [vUserId]: vType } };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterVote = updatedPost;
                    return updatedPost;
                }));

                // --- NOTIFICATION LOGIC ---
                const postForVote = state.postsRef.current.find(p => p.id === vPostId);
                if (postForVote && postForVote.authorId === currentUser.id && vUserId !== currentUser.id) {
                    const voter = state.contactsRef.current.find(c => c.id === vUserId);
                    const { handle } = formatUserIdentity(voter?.displayName || 'Someone');
                    addNotification('Broadcast Vote', `${handle} ${vType}voted your post`, 'success', AppRoute.FEED, vPostId);
                }
                // --------------------------

                if(postAfterVote) broadcastPostState(postAfterVote);
                daisyChainPacket(packet, senderNodeId);
                break;

            case 'REACTION': {
                const { postId: rPostId, userId: rUserId, emoji } = packet.payload;
                let postAfterReaction: Post | undefined;
                state.setPosts(prev => prev.map(p => {
                    if (p.id !== rPostId) return p;
                    const currentReactions = { ...(p.reactions || {}) };
                    if (!currentReactions[emoji]) currentReactions[emoji] = [];
                    if (!currentReactions[emoji].includes(rUserId)) {
                        currentReactions[emoji] = [...currentReactions[emoji], rUserId];
                    }
                    const updatedPost = { ...p, reactions: currentReactions };
                    updatedPost.contentHash = calculatePostHash(updatedPost);
                    postAfterReaction = updatedPost;
                    return updatedPost;
                }));

                // --- NOTIFICATION LOGIC ---
                const postForReaction = state.postsRef.current.find(p => p.id === rPostId);
                if (postForReaction && postForReaction.authorId === currentUser.id && rUserId !== currentUser.id) {
                    const reactor = state.contactsRef.current.find(c => c.id === rUserId);
                    const { handle } = formatUserIdentity(reactor?.displayName || 'Someone');
                    addNotification('New Reaction', `${handle} reacted ${emoji} to your broadcast`, 'success', AppRoute.FEED, rPostId);
                }
                // --------------------------

                if(postAfterReaction) broadcastPostState(postAfterReaction);
                daisyChainPacket(packet, senderNodeId);
                break;
            }
        }
    }, [addNotification, daisyChainPacket, maxSyncAgeHours, onUpdateUser, activeChatId, broadcastPostState, state]);

    // Update the ref whenever handlePacket changes (which is often, due to dependency arrays)
    useEffect(() => {
        handlePacketRef.current = handlePacket;
    }, [handlePacket]);

    // --- DISCOVERY BROADCAST (HEARTBEAT) ---
    useEffect(() => {
        if (!isOnline || !user.isDiscoverable) return;

        const broadcastPresence = () => {
            const config = state.nodeConfigRef.current;
            const packet: NetworkPacket = {
                id: crypto.randomUUID(),
                hops: MAX_GOSSIP_HOPS,
                type: 'ANNOUNCE_PEER',
                senderId: user.homeNodeOnion,
                payload: {
                    onionAddress: user.homeNodeOnion,
                    alias: config.alias || 'Unknown Node',
                    description: config.description || 'gChat Relay Node'
                }
            };
            processedPacketIds.current.add(packet.id!);
            // Send to direct peers
            const peerAddrs = state.peersRef.current.map(p => p.onionAddress);
            if (peerAddrs.length > 0) {
                networkService.broadcast(packet, peerAddrs);
            }
        };

        // Broadcast immediately on startup/online
        broadcastPresence();
        
        // Repeat every 2 minutes
        const interval = setInterval(broadcastPresence, 120000);
        return () => clearInterval(interval);
    }, [isOnline, user.isDiscoverable, user.homeNodeOnion, state.nodeConfigRef, state.peersRef]); 

    // --- PERIODIC PEER HEALTH POLLING ---
    useEffect(() => {
        const pingPeers = () => {
            state.peersRef.current.forEach(p => {
                networkService.connect(p.onionAddress); 
            });
        };
        
        if (isOnline) {
            pingPeers(); // Initial ping on startup/online
            const interval = setInterval(pingPeers, 60000); // Poll every 1 minute
            return () => clearInterval(interval);
        }
    }, [isOnline, state.peersRef]);

    // --- NETWORK INIT ---
    useEffect(() => {
        networkService.init(user.id);
        
        // Initial connections
        state.peers.forEach(p => networkService.connect(p.onionAddress));

        const unsubscribe = networkService.subscribeToStatus((status, onionAddress) => {
            setIsOnline(status);
            // ON RECONNECT: Trigger Inventory Sync with all active peers
            if (status) {
                const activePeers = state.peersRef.current.map(p => p.onionAddress);
                if (activePeers.length > 0) {
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
                }
            }
        });
        
        networkService.onPeerStatus = (peerOnion, status, latency) => {
            state.setPeers(prev => prev.map(p => {
                if (p.onionAddress === peerOnion) {
                    state.setContacts(currContacts => currContacts.map(c => {
                        if (c.homeNodes.includes(peerOnion)) {
                            return { ...c, status, latencyMs: latency || c.latencyMs, lastActive: Date.now() };
                        }
                        return c;
                    }));
                    
                    if (status === 'online' && p.status !== 'online') {
                        // 1. Trigger Inventory Sync on individual peer reconnect
                        const since = Date.now() - (maxSyncAgeHours * 60 * 60 * 1000);
                        const myInventory = state.postsRef.current
                            .filter(pt => pt.timestamp > since && pt.privacy === 'public')
                            .map(pt => ({ id: pt.id, hash: calculatePostHash(pt) })); // FRESH HASH

                        const packet: NetworkPacket = {
                            id: crypto.randomUUID(),
                            type: 'INVENTORY_SYNC_REQUEST',
                            senderId: state.userRef.current.homeNodeOnion,
                            payload: { inventory: myInventory, since }
                        };
                        networkService.sendMessage(peerOnion, packet);

                        // 2. Trigger Peer Announcement to the new peer if discoverable
                        if (state.userRef.current.isDiscoverable) {
                            const config = state.nodeConfigRef.current;
                            const announcePacket: NetworkPacket = {
                                id: crypto.randomUUID(),
                                hops: MAX_GOSSIP_HOPS,
                                type: 'ANNOUNCE_PEER',
                                senderId: state.userRef.current.homeNodeOnion,
                                payload: {
                                    onionAddress: state.userRef.current.homeNodeOnion,
                                    alias: config.alias || 'Unknown Node',
                                    description: config.description || 'gChat Relay Node'
                                }
                            };
                            networkService.sendMessage(peerOnion, announcePacket);
                        }
                    }

                    return { 
                        ...p, 
                        status, 
                        lastSeen: Date.now(), 
                        latencyMs: latency || p.latencyMs 
                    };
                }
                return p;
            }));
        };

        // USE THE REF HERE, NOT THE FUNCTION DIRECTLY
        networkService.onMessage = (packet, senderNodeId) => {
            handlePacketRef.current(packet, senderNodeId);
        };

        networkService.onShutdownRequest = () => {
            performGracefulShutdown();
        };

        return () => unsubscribe();
    }, [maxSyncAgeHours, performGracefulShutdown, state.peersRef, state.userRef, state.postsRef, state.nodeConfigRef]);

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
