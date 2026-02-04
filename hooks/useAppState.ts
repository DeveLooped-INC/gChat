
import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { UserProfile, Contact, Post, Group, Message, NotificationItem, NodePeer, ConnectionRequest, AppRoute, NotificationCategory, MediaSettings } from '../types';
import { networkService } from '../services/networkService';
import { storageService } from '../services/storage';
import { kvService } from '../services/kv';

const NODE_CONFIG_KEY = 'gchat_node_config';
const PEERS_KEY = 'gchat_node_peers';

export const useAppState = (user: UserProfile) => {
    // --- DATA STATES ---

    const [peers, setPeers] = useState<NodePeer[]>([]);
    const [nodeConfig, setNodeConfig] = useState<{ alias: string, description: string }>({ alias: '', description: '' });

    // IDB Data (Async)
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [posts, setPosts] = useState<Post[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [connectionRequests, setConnectionRequests] = useState<ConnectionRequest[]>([]);

    // Ephemeral State
    const [typingContactId, setTypingContactId] = useState<string | null>(null);

    const [isLoaded, setIsLoaded] = useState(false);

    // --- INITIAL DATA LOAD (Backend Access) ---
    useEffect(() => {
        const loadData = async () => {
            try {
                // 1. Load Settings (KV Store)
                // We load these first or in parallel? Parallel is fine.
                const [
                    fetchedPeers,
                    fetchedConfig,
                    fetchedNotifSettings,
                    fetchedMediaSettings,
                    fetchedContentSettings
                ] = await Promise.all([
                    kvService.get<NodePeer[]>(PEERS_KEY),
                    kvService.get<{ alias: string, description: string }>(NODE_CONFIG_KEY),
                    kvService.get<any>('gchat_notification_settings_v2'),
                    kvService.get<MediaSettings>('gchat_media_settings'),
                    kvService.get<any>('gchat_content_settings')
                ]);

                if (fetchedPeers) setPeers(fetchedPeers);
                if (fetchedConfig) setNodeConfig(fetchedConfig);
                if (fetchedNotifSettings) setNotificationSettings({ mutedCategories: fetchedNotifSettings.mutedCategories || [] });
                if (fetchedMediaSettings) setMediaSettings(fetchedMediaSettings);
                if (fetchedContentSettings) setContentSettings(fetchedContentSettings);

                // 2. Load Object Store Data
                // ownerId is user.id
                const oid = user.id;
                const [dbPosts, dbMsgs, dbContacts, dbGroups, dbNotifs, dbRequests] = await Promise.all([
                    storageService.getItems<Post>('posts', oid),
                    storageService.getItems<Message>('messages', oid),
                    storageService.getItems<Contact>('contacts', oid),
                    storageService.getItems<Group>('groups', oid),
                    storageService.getItems<NotificationItem>('notifications', oid),
                    storageService.getItems<ConnectionRequest>('requests', oid)
                ]);

                setPosts(dbPosts || []);
                setMessages(dbMsgs || []);
                setContacts(dbContacts || []);
                setGroups(dbGroups || []);
                setNotifications(dbNotifs || []);
                setConnectionRequests(dbRequests || []);

                setIsLoaded(true);
            } catch (e) {
                console.error("CRITICAL: Failed to load app state from DB", e);
                // Alert might be annoying on generic error, but safe for now.
            }
        };
        if (user && user.id) loadData();
    }, [user.id]);

    // Refs for callbacks
    const userRef = useRef(user);
    const contactsRef = useRef(contacts);
    const peersRef = useRef(peers);
    const nodeConfigRef = useRef(nodeConfig);
    const postsRef = useRef(posts);
    const groupsRef = useRef(groups);
    const messagesRef = useRef(messages);

    useLayoutEffect(() => { userRef.current = user; }, [user]);
    useLayoutEffect(() => { contactsRef.current = contacts; }, [contacts]);
    useLayoutEffect(() => { peersRef.current = peers; }, [peers]);
    useLayoutEffect(() => { nodeConfigRef.current = nodeConfig; }, [nodeConfig]);
    useLayoutEffect(() => { postsRef.current = posts; }, [posts]);
    useLayoutEffect(() => { groupsRef.current = groups; }, [groups]);
    useLayoutEffect(() => { messagesRef.current = messages; }, [messages]);

    // --- PERSISTENCE (WRITE TO BACKEND) ---
    // Note: 'storageService' now sends to backend.

    useEffect(() => { if (isLoaded) storageService.syncState('contacts', contacts, user.id); }, [contacts, user.id, isLoaded]);
    useEffect(() => { if (isLoaded) storageService.syncState('posts', posts, user.id); }, [posts, user.id, isLoaded]);
    useEffect(() => { if (isLoaded) storageService.syncState('groups', groups, user.id); }, [groups, user.id, isLoaded]);
    useEffect(() => { if (isLoaded) storageService.syncState('messages', messages, user.id); }, [messages, user.id, isLoaded]);
    useEffect(() => { if (isLoaded) storageService.syncState('requests', connectionRequests, user.id); }, [connectionRequests, user.id, isLoaded]);
    useEffect(() => { if (isLoaded) storageService.syncState('notifications', notifications, user.id); }, [notifications, user.id, isLoaded]);

    // Config and Peers (Write to KV)
    useEffect(() => { if (isLoaded) kvService.set(NODE_CONFIG_KEY, nodeConfig); }, [nodeConfig, isLoaded]);

    useEffect(() => {
        if (isLoaded) {
            kvService.set(PEERS_KEY, peers);
            networkService.updateKnownPeers(peers.map(p => p.onionAddress));
        }
    }, [peers, isLoaded]);

    // --- GARBAGE COLLECTION ---
    const pruneMessages = async () => {
        // Assume backend handles pruning or we implement a delete call here?
        // Fixed: Message type doesn't have expiresAt currently.
        // const allMsgs = await storageService.getItems<Message>('messages');
        // const now = Date.now();
        // const toDelete = allMsgs.filter(m => m.expiresAt && m.expiresAt < now);

        // for (const m of toDelete) {
        //    await storageService.deleteItem('messages', m.id);
        // }

        // if (toDelete.length > 0) {
        //    const freshMsgs = await storageService.getItems<Message>('messages');
        //    setMessages(freshMsgs);
        // }
        // return toDelete.length;
        return 0;
    };

    // --- DERIVED BADGE COUNTS ---
    const chatUnread = useMemo(() => {
        const msgs = messages.filter(m => !m.read && !m.isMine).length;
        const invites = notifications.filter(n => !n.read && n.linkRoute === AppRoute.CHAT).length;
        return msgs + invites;
    }, [messages, notifications]);

    const contactsUnread = useMemo(() => {
        return connectionRequests.length + notifications.filter(n => !n.read && n.linkRoute === AppRoute.CONTACTS).length;
    }, [connectionRequests, notifications]);

    const feedUnread = useMemo(() => {
        return notifications.filter(n => !n.read && n.linkRoute === AppRoute.FEED).length;
    }, [notifications]);

    const settingsUnread = useMemo(() => {
        return notifications.filter(n => !n.read && n.linkRoute === AppRoute.NODE_SETTINGS).length;
    }, [notifications]);

    // Derived User Stats
    const userStats = useMemo(() => {
        const myPosts = posts.filter(p => p.authorId === user.id);
        let likes = 0;
        let dislikes = 0;

        myPosts.forEach(p => {
            Object.values(p.votes).forEach(v => {
                if (v === 'up') likes++;
                else dislikes++;
            });
        });

        return {
            totalPosts: myPosts.length,
            likes,
            dislikes,
            connections: contacts.length,
            followers: user.followersCount || 0
        };
    }, [posts, user.id, user.followersCount, contacts.length]);

    // Notification Settings
    const [notificationSettings, setNotificationSettings] = useState<{ mutedCategories: NotificationCategory[] }>({ mutedCategories: [] });

    useEffect(() => {
        if (isLoaded) kvService.set('gchat_notification_settings_v2', notificationSettings);
    }, [notificationSettings, isLoaded]);

    const toggleMuteCategory = (category: NotificationCategory) => {
        setNotificationSettings(prev => {
            const isMuted = prev.mutedCategories.includes(category);
            return {
                mutedCategories: isMuted
                    ? prev.mutedCategories.filter(c => c !== category)
                    : [...prev.mutedCategories, category]
            };
        });
    };

    // Media Settings
    const [mediaSettings, setMediaSettings] = useState<MediaSettings>({
        enabled: false, maxFileSizeMB: 10, autoDownloadFriends: false, autoDownloadPrivate: false
    });

    useEffect(() => {
        if (isLoaded) kvService.set('gchat_media_settings', mediaSettings);
    }, [mediaSettings, isLoaded]);

    // Content Settings
    const [contentSettings, setContentSettings] = useState<{ showDownvotedPosts: boolean; downvoteThreshold: number }>({
        showDownvotedPosts: false, downvoteThreshold: -1
    });

    useEffect(() => {
        if (isLoaded) kvService.set('gchat_content_settings', contentSettings);
    }, [contentSettings, isLoaded]);

    return {
        contacts, setContacts,
        posts, setPosts,
        groups, setGroups,
        messages, setMessages,
        notifications, setNotifications,
        peers, setPeers,
        nodeConfig, setNodeConfig,
        mediaSettings, setMediaSettings,
        contentSettings, setContentSettings,
        connectionRequests, setConnectionRequests,
        typingContactId, setTypingContactId,
        isLoaded,
        pruneMessages,
        userRef,
        contactsRef,
        peersRef,
        nodeConfigRef,
        postsRef,
        groupsRef,
        messagesRef,
        chatUnread,
        contactsUnread,
        feedUnread,
        settingsUnread,
        userStats,
        notificationSettings,
        toggleMuteCategory
    };
};
