import { useCallback, MutableRefObject } from 'react';
import { UserProfile, Post, Message, Contact, NetworkPacket, EncryptedPayload, Group, MediaMetadata, NodePeer, ConnectionRequest, NotificationCategory, AppRoute, AvailablePeer } from '../types';
import { networkService } from '../services/networkService';
import { encryptMessage, signData } from '../services/cryptoService';
import { calculatePostHash } from '../utils';
import { appendReply, updateCommentTree } from '../utils/dataHelpers';
import { storageService } from '../services/storage';

const MAX_GOSSIP_HOPS = 6;

interface UseActionsParams {
    user: UserProfile;
    state: {
        userRef: MutableRefObject<UserProfile>;
        contactsRef: MutableRefObject<Contact[]>;
        peersRef: MutableRefObject<NodePeer[]>;
        postsRef: MutableRefObject<Post[]>;
        groupsRef: MutableRefObject<Group[]>;
        messagesRef: MutableRefObject<Message[]>;
        setPeers: React.Dispatch<React.SetStateAction<NodePeer[]>>;
        setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
        setPosts: React.Dispatch<React.SetStateAction<Post[]>>;
        setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
        setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
        setConnectionRequests: React.Dispatch<React.SetStateAction<ConnectionRequest[]>>;
        setNodeConfig: React.Dispatch<React.SetStateAction<{ alias: string; description: string }>>;
    };
    addNotification: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error', category?: NotificationCategory, linkRoute?: AppRoute, linkId?: string) => void;
    onUpdateUser: (u: UserProfile) => void;
    isOnline: boolean;
    maxSyncAgeHours: number;
    processedPacketIds: MutableRefObject<Set<string>>;
    broadcastPostState: (post: Post) => void;
    setDiscoveredPeers: React.Dispatch<React.SetStateAction<AvailablePeer[]>>;
    setPendingNodeRequests: React.Dispatch<React.SetStateAction<string[]>>;
    handleNavigate: (route: AppRoute) => void;
}

export const useActions = ({
    user, state, addNotification, onUpdateUser, isOnline, maxSyncAgeHours,
    processedPacketIds, broadcastPostState, setDiscoveredPeers, setPendingNodeRequests, handleNavigate
}: UseActionsParams) => {

    // --- PEER ACTIONS ---

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
    }, [addNotification, state.setPeers, setPendingNodeRequests, setDiscoveredPeers]);

    const handleRemovePeer = useCallback((onion: string) => {
        state.setPeers(prev => prev.filter(p => p.onionAddress !== onion));
        networkService.removeTrustedPeer(onion);
        addNotification('Peer Removed', 'Node forgotten.', 'info', 'admin');
    }, [addNotification, state.setPeers]);

    const handleBlockPeer = useCallback((onion: string) => {
        state.setPeers(prev => prev.filter(p => p.onionAddress !== onion));
        setPendingNodeRequests(prev => prev.filter(p => p !== onion));
        setDiscoveredPeers(prev => prev.filter(p => p.id !== onion));
        networkService.removeTrustedPeer(onion);
        addNotification('Node Blocked', 'Requests from this node will be ignored.', 'warning', 'admin');
    }, [addNotification, state.setPeers, setPendingNodeRequests, setDiscoveredPeers]);

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
        const u = state.userRef.current;
        if (isOnline && u.isDiscoverable) {
            const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'ANNOUNCE_PEER', senderId: u.homeNodeOnion, payload: { onionAddress: u.homeNodeOnion, alias, description } };
            processedPacketIds.current.add(packet.id!);
            networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        }
    }, [isOnline, addNotification, state.setNodeConfig, state.userRef, state.peersRef, processedPacketIds]);

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

    // --- CONTACT ACTIONS ---

    const handleAddUserContact = useCallback(async (pubKey: string, homeNode: string, name: string, encryptionKey?: string, initialHandshakeStatus: 'pending' | 'completed' = 'pending') => {
        const cleanNode = homeNode.trim().toLowerCase();
        const u = state.userRef.current;
        if (state.contactsRef.current.some(c => c.id === pubKey)) {
            if (encryptionKey) state.setContacts(prev => prev.map(c => c.id === pubKey ? { ...c, encryptionPublicKey: encryptionKey } : c));
            return;
        }
        const newContact: Contact = { id: pubKey, encryptionPublicKey: encryptionKey, username: name.toLowerCase().replace(/\s/g, '_'), displayName: name, homeNodes: [cleanNode], status: 'offline', connectionType: 'Onion', handshakeStatus: initialHandshakeStatus };
        state.setContacts(prev => { if (prev.some(c => c.id === pubKey)) return prev; return [...prev, newContact]; });
        if (!state.peersRef.current.some(p => p.onionAddress === cleanNode)) handleAddPeer(cleanNode);
        else networkService.connect(cleanNode);

        const reqPayload: ConnectionRequest = { id: crypto.randomUUID(), fromUserId: u.id, fromUsername: u.username, fromDisplayName: u.displayName, fromHomeNode: u.homeNodeOnion, fromEncryptionPublicKey: u.keys.encryption.publicKey, timestamp: Date.now() };
        reqPayload.signature = signData(reqPayload, u.keys.signing.secretKey);

        const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CONNECTION_REQUEST', senderId: u.homeNodeOnion, targetUserId: pubKey, payload: reqPayload };
        networkService.connect(cleanNode).then(() => networkService.sendMessage(cleanNode, packet));
        addNotification('Request Sent', `Handshake sent to ${name}`, 'success', 'admin');
    }, [handleAddPeer, addNotification, state.contactsRef, state.userRef, state.setContacts, state.peersRef]);

    const handleAcceptRequest = useCallback((req: ConnectionRequest) => {
        const u = state.userRef.current;
        state.setConnectionRequests(prev => prev.filter(r => r.id !== req.id));
        handleAddUserContact(req.fromUserId, req.fromHomeNode, req.fromDisplayName, req.fromEncryptionPublicKey, 'completed');
        const reqPayload: ConnectionRequest = { id: crypto.randomUUID(), fromUserId: u.id, fromUsername: u.username, fromDisplayName: u.displayName, fromHomeNode: u.homeNodeOnion, fromEncryptionPublicKey: u.keys.encryption.publicKey, timestamp: Date.now() };
        reqPayload.signature = signData(reqPayload, u.keys.signing.secretKey);
        const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CONNECTION_REQUEST', senderId: u.homeNodeOnion, targetUserId: req.fromUserId, payload: reqPayload };
        networkService.sendMessage(req.fromHomeNode, packet);
    }, [handleAddUserContact, state.userRef, state.setConnectionRequests]);

    const handleDeclineRequest = useCallback((reqId: string) => {
        state.setConnectionRequests(prev => prev.filter(r => r.id !== reqId));
    }, [state.setConnectionRequests]);

    const handleDeleteContact = useCallback((contactId: string) => {
        const u = state.userRef.current;
        const contactToRemove = state.contactsRef.current.find(c => c.id === contactId);
        state.setContacts(prev => prev.filter(c => c.id !== contactId));
        state.setPosts(prev => prev.filter(p => !(p.authorId === contactId && p.privacy === 'friends')));
        state.setGroups(prevGroups => {
            return prevGroups.map(group => {
                if (group.ownerId === u.id && group.members.includes(contactId)) {
                    const updatedMembers = group.members.filter(m => m !== contactId);
                    const updatedGroup = { ...group, members: updatedMembers };
                    if (contactToRemove && contactToRemove.homeNodes[0]) {
                        networkService.sendMessage(contactToRemove.homeNodes[0], { id: crypto.randomUUID(), type: 'GROUP_UPDATE', senderId: u.homeNodeOnion, targetUserId: contactId, payload: updatedGroup });
                    }
                    updatedMembers.forEach(mid => {
                        if (mid === u.id) return;
                        const member = state.contactsRef.current.find(c => c.id === mid);
                        if (member && member.homeNodes[0]) {
                            networkService.sendMessage(member.homeNodes[0], { id: crypto.randomUUID(), type: 'GROUP_UPDATE', senderId: u.homeNodeOnion, targetUserId: mid, payload: updatedGroup });
                        }
                    });
                    return updatedGroup;
                }
                return group;
            });
        });
        addNotification('Contact Removed', 'Connection severed. Feed and Groups updated.', 'info', 'admin');
    }, [addNotification, state.userRef, state.contactsRef, state.setContacts, state.setPosts, state.setGroups]);

    // --- MESSAGING ---

    const handleSendMessage = useCallback(async (text: string, contactId: string, isEphemeral: boolean, attachment?: string, media?: MediaMetadata, replyToId?: string, privacy: 'public' | 'connections' = 'public') => {
        const u = state.userRef.current;
        const msgId = crypto.randomUUID();
        const payloadObj = { content: text, media, attachment, replyToId, privacy };
        const payloadStr = JSON.stringify(payloadObj);
        const group = state.groupsRef.current.find(g => g.id === contactId);

        if (group) {
            const newMessage: Message = { id: msgId, threadId: group.id, senderId: u.id, content: text, timestamp: Date.now(), delivered: false, read: true, isMine: true, media, attachmentUrl: attachment, isEphemeral, replyToId, privacy };
            state.setMessages(prev => [...prev, newMessage]);

            let membersToMessage = group.members.filter(mid => mid !== u.id);
            if (privacy === 'connections') membersToMessage = membersToMessage.filter(mid => state.contactsRef.current.some(c => c.id === mid));

            let successCount = 0;
            for (const memberId of membersToMessage) {
                const contact = state.contactsRef.current.find(c => c.id === memberId);
                if (contact && contact.encryptionPublicKey && contact.homeNodes[0]) {
                    const { nonce, ciphertext } = encryptMessage(payloadStr, contact.encryptionPublicKey, u.keys.encryption.secretKey);
                    const groupEncPayload: EncryptedPayload = { id: msgId, nonce, ciphertext, groupId: group.id };
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'MESSAGE', senderId: u.homeNodeOnion, targetUserId: contact.id, payload: groupEncPayload };
                    networkService.sendMessage(contact.homeNodes[0], packet);
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
        const { nonce, ciphertext } = encryptMessage(payloadStr, contact.encryptionPublicKey, u.keys.encryption.secretKey);
        const newMsg: Message = { id: msgId, threadId: contact.id, senderId: u.id, content: text, timestamp: Date.now(), delivered: false, read: true, isMine: true, media, attachmentUrl: attachment, isEphemeral, replyToId };
        state.setMessages(prev => [...prev, newMsg]);

        const targetNode = contact.homeNodes[0];
        const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'MESSAGE', senderId: u.homeNodeOnion, targetUserId: contact.id, payload: { id: msgId, nonce, ciphertext } };

        const success = await networkService.sendMessage(targetNode, packet);
        if (success) {
            state.setMessages(prev => prev.map(m => m.id === msgId ? { ...m, delivered: true } : m));
        } else {
            console.log(`Message ${msgId} failed initial send. Queued for retry.`);
        }
    }, [addNotification, state.userRef, state.groupsRef, state.contactsRef, state.setMessages]);

    const handleSendTyping = useCallback((contactId: string) => {
        const u = state.userRef.current;
        const contact = state.contactsRef.current.find(c => c.id === contactId);
        if (contact && contact.homeNodes[0]) {
            const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'TYPING', senderId: u.homeNodeOnion, targetUserId: contactId, payload: { userId: u.id } };
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
        const u = state.userRef.current;
        let action: 'add' | 'remove' = 'add';
        state.setMessages(prev => prev.map(m => {
            if (m.id !== messageId) return m;
            const currentReactions = { ...(m.reactions || {}) };
            if (!currentReactions[emoji]) currentReactions[emoji] = [];
            if (currentReactions[emoji].includes(u.id)) { currentReactions[emoji] = currentReactions[emoji].filter(id => id !== u.id); action = 'remove'; } else { currentReactions[emoji] = [...currentReactions[emoji], u.id]; action = 'add'; }
            return { ...m, reactions: currentReactions };
        }));
        const group = state.groupsRef.current.find(g => g.id === contactId);
        if (group) {
            group.members.filter(mid => mid !== u.id).forEach(mid => {
                const contact = state.contactsRef.current.find(c => c.id === mid);
                if (contact && contact.homeNodes[0]) {
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CHAT_REACTION', senderId: u.homeNodeOnion, targetUserId: mid, payload: { messageId, emoji, userId: u.id, action } };
                    networkService.sendMessage(contact.homeNodes[0], packet);
                }
            });
        } else {
            const contact = state.contactsRef.current.find(c => c.id === contactId);
            if (contact && contact.homeNodes[0]) {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CHAT_REACTION', senderId: u.homeNodeOnion, targetUserId: contactId, payload: { messageId, emoji, userId: u.id, action } };
                networkService.sendMessage(contact.homeNodes[0], packet);
            }
        }
    }, [state.userRef, state.setMessages, state.groupsRef, state.contactsRef]);

    const handleChatVote = useCallback((contactId: string, messageId: string, type: 'up' | 'down') => {
        const u = state.userRef.current;
        let action: 'add' | 'remove' = 'add';
        state.setMessages(prev => prev.map(m => {
            if (m.id !== messageId) return m;
            const currentVotes = { ...(m.votes || {}) };
            if (currentVotes[u.id] === type) { delete currentVotes[u.id]; action = 'remove'; } else { currentVotes[u.id] = type; action = 'add'; }
            return { ...m, votes: currentVotes };
        }));
        const group = state.groupsRef.current.find(g => g.id === contactId);
        if (group) {
            group.members.forEach(mid => {
                if (mid === u.id) return;
                const contact = state.contactsRef.current.find(c => c.id === mid);
                if (contact && contact.homeNodes[0]) {
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CHAT_VOTE', senderId: u.homeNodeOnion, targetUserId: mid, payload: { messageId, type, userId: u.id, action } };
                    networkService.sendMessage(contact.homeNodes[0], packet);
                }
            });
        } else {
            const contact = state.contactsRef.current.find(c => c.id === contactId);
            if (contact && contact.homeNodes[0]) {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'CHAT_VOTE', senderId: u.homeNodeOnion, targetUserId: contactId, payload: { messageId, type, userId: u.id, action } };
                networkService.sendMessage(contact.homeNodes[0], packet);
            }
        }
    }, [state.userRef, state.setMessages, state.groupsRef, state.contactsRef]);

    // --- SOCIAL ---

    const handleFollowUser = useCallback((targetId: string, targetNode?: string) => {
        const u = state.userRef.current;
        if (u.followingIds && u.followingIds.includes(targetId)) return;
        const updatedUser = { ...u, followingIds: [...(u.followingIds || []), targetId] };
        onUpdateUser(updatedUser);
        if (targetNode) {
            const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'FOLLOW', senderId: u.homeNodeOnion, targetUserId: targetId, payload: { userId: u.id } };
            networkService.sendMessage(targetNode, packet);
        }
        addNotification('Following', 'You are now following this user.', 'success', 'admin');
    }, [onUpdateUser, addNotification, state.userRef]);

    const handleUnfollowUser = useCallback((targetId: string, targetNode?: string) => {
        const u = state.userRef.current;
        const updatedUser = { ...u, followingIds: (u.followingIds || []).filter(id => id !== targetId) };
        onUpdateUser(updatedUser);
        if (targetNode) {
            const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'UNFOLLOW', senderId: u.homeNodeOnion, targetUserId: targetId, payload: { userId: u.id } };
            networkService.sendMessage(targetNode, packet);
        }
        addNotification('Unfollowed', 'User removed from following list.', 'info', 'admin');
    }, [onUpdateUser, addNotification, state.userRef]);

    // --- GROUPS ---

    const handleCreateGroup = useCallback(async (name: string, memberIds: string[]) => {
        const u = state.userRef.current;
        const newGroup: Group = { id: crypto.randomUUID(), name, members: [...memberIds, u.id], admins: [u.id], ownerId: u.id, bannedIds: [], settings: { allowMemberInvite: false, allowMemberNameChange: false }, isMuted: false };
        state.setGroups(prev => [...prev, newGroup]);

        addNotification('Group Created', `"${name}" is ready. Inviting members...`, 'info', 'chat', AppRoute.CHAT, newGroup.id);
        for (const mid of memberIds) {
            const contact = state.contactsRef.current.find(c => c.id === mid);
            if (contact && contact.homeNodes[0]) {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_INVITE', senderId: u.homeNodeOnion, targetUserId: mid, payload: newGroup };
                await networkService.sendMessage(contact.homeNodes[0], packet);
                await new Promise(r => setTimeout(r, 200));
            }
        }
        addNotification('Group Ready', 'Invites sent.', 'success', 'chat');
    }, [addNotification, state.userRef, state.setGroups, state.contactsRef]);

    const handleDeleteGroup = useCallback((groupId: string) => {
        const group = state.groupsRef.current.find(g => g.id === groupId);
        state.setGroups(prev => prev.filter(g => g.id !== groupId));
        const u = state.userRef.current;
        if (group) {
            group.members.forEach(mid => {
                if (mid === u.id) return;
                const contact = state.contactsRef.current.find(c => c.id === mid);
                if (contact && contact.homeNodes[0]) {
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_DELETE', senderId: u.homeNodeOnion, targetUserId: mid, payload: { groupId } };
                    networkService.sendMessage(contact.homeNodes[0], packet);
                }
            });
        }
        addNotification('Group Deleted', 'Group has been removed.', 'info', 'chat');
    }, [addNotification, state.groupsRef, state.setGroups, state.userRef, state.contactsRef]);

    const handleLeaveGroup = useCallback((groupId: string) => {
        const u = state.userRef.current;
        const group = state.groupsRef.current.find(g => g.id === groupId);
        if (!group) return;
        if (group.ownerId === u.id) { addNotification('Action Denied', 'Owners cannot leave. Delete the group instead.', 'error', 'admin'); return; }
        state.setGroups(prev => prev.filter(g => g.id !== groupId));
        if (group) {
            const updatedMembers = group.members.filter(m => m !== u.id);
            const updatedGroup = { ...group, members: updatedMembers };
            updatedMembers.forEach(mid => {
                const contact = state.contactsRef.current.find(c => c.id === mid);
                if (contact && contact.homeNodes[0]) {
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_UPDATE', senderId: u.homeNodeOnion, targetUserId: mid, payload: updatedGroup };
                    networkService.sendMessage(contact.homeNodes[0], packet);
                }
            });
        }
        addNotification('Group Left', 'You have left the group.', 'info', 'chat');
    }, [addNotification, state.userRef, state.groupsRef, state.setGroups, state.contactsRef]);

    const handleUpdateGroup = useCallback((updatedGroup: Group) => {
        state.setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
        const u = state.userRef.current;
        updatedGroup.members.forEach(mid => {
            if (mid === u.id) return;
            const contact = state.contactsRef.current.find(c => c.id === mid);
            if (contact && contact.homeNodes[0]) {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_UPDATE', senderId: u.homeNodeOnion, targetUserId: mid, payload: updatedGroup };
                networkService.sendMessage(contact.homeNodes[0], packet);
            }
        });
        addNotification('Group Updated', `Group "${updatedGroup.name}" settings changed.`, 'info', 'chat');
    }, [addNotification, state.setGroups, state.userRef, state.contactsRef]);

    const handleAddMemberToGroup = useCallback((groupId: string, contactId: string) => {
        const group = state.groupsRef.current.find(g => g.id === groupId);
        const u = state.userRef.current;
        if (group && !group.members.includes(contactId)) {
            const updatedGroup = { ...group, members: [...group.members, contactId] };
            state.setGroups(prev => prev.map(g => g.id === groupId ? updatedGroup : g));

            const newMember = state.contactsRef.current.find(c => c.id === contactId);
            if (newMember && newMember.homeNodes[0]) {
                const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_INVITE', senderId: u.homeNodeOnion, targetUserId: contactId, payload: updatedGroup };
                networkService.sendMessage(newMember.homeNodes[0], packet);
            }
            group.members.forEach(mid => {
                if (mid === u.id) return;
                const contact = state.contactsRef.current.find(c => c.id === mid);
                if (contact && contact.homeNodes[0]) {
                    const packet: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_UPDATE', senderId: u.homeNodeOnion, targetUserId: mid, payload: updatedGroup };
                    networkService.sendMessage(contact.homeNodes[0], packet);
                }
            });
            addNotification('Member Added', 'New member invited to group.', 'success', 'chat');
        }
    }, [addNotification, state.groupsRef, state.userRef, state.setGroups, state.contactsRef]);

    const handleToggleGroupMute = useCallback((groupId: string) => {
        state.setGroups(prev => prev.map(g => {
            if (g.id === groupId) {
                return { ...g, isMuted: !g.isMuted };
            }
            return g;
        }));
        addNotification('Group Mute Toggled', 'Group notification settings updated.', 'info', 'chat');
    }, [addNotification, state.setGroups]);

    // --- FEED ACTIONS ---

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
        const u = state.userRef.current;
        const newComment = {
            id: crypto.randomUUID(),
            authorId: u.id,
            authorName: u.displayName,
            authorAvatar: u.avatarUrl,
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
        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'COMMENT', senderId: u.homeNodeOnion, payload: { postId, comment: newComment, parentCommentId } };
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
        const u = state.userRef.current;
        let updatedPostForBroadcast: Post | null = null;
        state.setPosts(prev => prev.map(post => {
            if (post.id !== postId) return post;
            const updatedPost = { ...post, votes: { ...post.votes, [u.id]: type } };
            updatedPost.contentHash = calculatePostHash(updatedPost);
            updatedPostForBroadcast = updatedPost;
            return updatedPost;
        }));
        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'VOTE', senderId: u.homeNodeOnion, payload: { postId, userId: u.id, type } };
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
        const u = state.userRef.current;
        let updatedPostForBroadcast: Post | null = null;
        let action: 'add' | 'remove' = 'add';

        state.setPosts(prev => prev.map(p => {
            if (p.id !== postId) return p;
            const currentReactions = { ...(p.reactions || {}) };
            if (!currentReactions[emoji]) currentReactions[emoji] = [];

            if (currentReactions[emoji].includes(u.id)) {
                action = 'remove';
                currentReactions[emoji] = currentReactions[emoji].filter(id => id !== u.id);
            } else {
                action = 'add';
                currentReactions[emoji] = [...currentReactions[emoji], u.id];
            }

            if (currentReactions[emoji].length === 0) delete currentReactions[emoji];

            const updatedPost = { ...p, reactions: currentReactions };
            updatedPost.contentHash = calculatePostHash(updatedPost);
            updatedPostForBroadcast = updatedPost;
            return updatedPost;
        }));

        if (updatedPostForBroadcast) {
            storageService.saveItem('posts', updatedPostForBroadcast, state.userRef.current.id);
        }

        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'REACTION', senderId: u.homeNodeOnion, payload: { postId, userId: u.id, emoji, action } };
        processedPacketIds.current.add(packet.id!);
        networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        if (updatedPostForBroadcast) broadcastPostState(updatedPostForBroadcast);
        if (action === 'add') {
            addNotification('Post Reacted', `You reacted with ${emoji}.`, 'info', 'social');
        }
    }, [addNotification, broadcastPostState, state.userRef, state.setPosts, processedPacketIds, state.peersRef]);

    const handleCommentVote = useCallback((postId: string, commentId: string, type: 'up' | 'down') => {
        const u = state.userRef.current;
        let updatedPostForBroadcast: Post | null = null;
        state.setPosts(prev => prev.map(p => {
            if (p.id !== postId) return p;
            const updatedPost = { ...p, commentsList: updateCommentTree(p.commentsList, commentId, (c) => ({ ...c, votes: { ...c.votes, [u.id]: type } })) };
            updatedPost.contentHash = calculatePostHash(updatedPost);
            updatedPostForBroadcast = updatedPost;
            storageService.saveItem('posts', updatedPost, state.userRef.current.id);
            return updatedPost;
        }));
        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'COMMENT_VOTE', senderId: u.homeNodeOnion, payload: { postId, commentId, userId: u.id, type } };
        processedPacketIds.current.add(packet.id!);
        networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        if (updatedPostForBroadcast) {
            broadcastPostState(updatedPostForBroadcast);
            storageService.saveItem('posts', updatedPostForBroadcast, state.userRef.current.id);
        }
        addNotification('Comment Voted', 'Your comment vote has been recorded.', 'info', 'social');
    }, [addNotification, broadcastPostState, state.userRef, state.setPosts, processedPacketIds, state.peersRef]);

    const handleCommentReaction = useCallback((postId: string, commentId: string, emoji: string) => {
        const u = state.userRef.current;
        let updatedPostForBroadcast: Post | null = null;
        let action: 'add' | 'remove' = 'add';

        state.setPosts(prev => prev.map(p => {
            if (p.id !== postId) return p;
            const updatedPost = {
                ...p, commentsList: updateCommentTree(p.commentsList, commentId, (c) => {
                    const currentReactions = { ...(c.reactions || {}) };
                    if (!currentReactions[emoji]) currentReactions[emoji] = [];

                    if (currentReactions[emoji].includes(u.id)) {
                        action = 'remove';
                        currentReactions[emoji] = currentReactions[emoji].filter(id => id !== u.id);
                    } else {
                        action = 'add';
                        currentReactions[emoji] = [...currentReactions[emoji], u.id];
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
        const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'COMMENT_REACTION', senderId: u.homeNodeOnion, payload: { postId, commentId, userId: u.id, emoji, action } };
        processedPacketIds.current.add(packet.id!);
        networkService.broadcast(packet, state.peersRef.current.map(p => p.onionAddress));
        if (updatedPostForBroadcast) broadcastPostState(updatedPostForBroadcast);
        if (action === 'add') {
            addNotification('Comment Reacted', `You reacted with ${emoji} on a comment.`, 'info', 'social');
        }
    }, [addNotification, broadcastPostState, state.userRef, state.setPosts, processedPacketIds, state.peersRef]);

    // --- UTILITY ---

    const handleExportKeys = useCallback(() => {
        const u = state.userRef.current;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(u.keys));
        const dlAnchor = document.createElement('a');
        dlAnchor.setAttribute("href", dataStr);
        dlAnchor.setAttribute("download", `gchat_keys_${u.username}.json`);
        document.body.appendChild(dlAnchor);
        dlAnchor.click();
        dlAnchor.remove();
        addNotification('Keys Exported', 'Keep this file safe!', 'success', 'admin');
    }, [addNotification, state.userRef]);

    const handleViewUserPosts = useCallback((userId: string) => {
        handleNavigate(AppRoute.FEED);
        addNotification('Navigation', 'Switched to Public Feed for user.', 'info', 'admin');
        return userId; // Return for feedInitialState setup in caller
    }, [addNotification, handleNavigate]);

    return {
        // Peer
        handleAddPeer, handleRemovePeer, handleBlockPeer, handleSyncPeer, handleUpdateNodeConfig, handleGlobalSync,
        // Contact
        handleAddUserContact, handleAcceptRequest, handleDeclineRequest, handleDeleteContact,
        // Messages
        handleSendMessage, handleSendTyping, handleReadMessage, handleChatReaction, handleChatVote,
        // Social
        handleFollowUser, handleUnfollowUser,
        // Groups
        handleCreateGroup, handleDeleteGroup, handleLeaveGroup, handleUpdateGroup, handleAddMemberToGroup, handleToggleGroupMute,
        // Feed
        handlePost, handleEditPost, handleDeletePost, handleComment, handleVote, handlePostReaction, handleCommentVote, handleCommentReaction,
        // Utility
        handleExportKeys, handleViewUserPosts
    };
};
