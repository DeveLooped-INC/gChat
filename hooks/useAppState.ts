
import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { UserProfile, Contact, Post, Group, Message, NotificationItem, NodePeer, ConnectionRequest, AppRoute } from '../types';
import { networkService } from '../services/networkService';
import { storageService } from '../services/storage';

const NODE_CONFIG_KEY = 'gchat_node_config';
const PEERS_KEY = 'gchat_node_peers';

export const useAppState = (user: UserProfile) => {
    // --- DATA STATES ---
    
    // CRITICAL FIX: Initialize peers directly from LocalStorage (Lazy Init).
    // This prevents the "Save" effect from running with an empty array on mount and wiping the data.
    const [peers, setPeers] = useState<NodePeer[]>(() => {
        try {
            const saved = localStorage.getItem(PEERS_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error("Failed to load peers from LS", e);
            return [];
        }
    });

    // Config is also synchronous LS
    const [nodeConfig, setNodeConfig] = useState<{alias: string, description: string}>(() => {
        try { return JSON.parse(localStorage.getItem(NODE_CONFIG_KEY) || '{"alias":"", "description":""}'); }
        catch { return { alias: '', description: '' }; }
    });

    // IDB Data (Async)
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [posts, setPosts] = useState<Post[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [connectionRequests, setConnectionRequests] = useState<ConnectionRequest[]>([]);

    const [isLoaded, setIsLoaded] = useState(false);

    // --- INITIAL DATA LOAD (DIRECT DB ACCESS) ---
    useEffect(() => {
        const loadData = async () => {
            try {
                // Parallel load from IndexedDB
                const [dbPosts, dbMsgs, dbContacts, dbGroups, dbNotifs, dbRequests] = await Promise.all([
                    storageService.getItems<Post>('posts', user.id),
                    storageService.getItems<Message>('messages', user.id),
                    storageService.getItems<Contact>('contacts', user.id),
                    storageService.getItems<Group>('groups', user.id),
                    storageService.getItems<NotificationItem>('notifications', user.id),
                    storageService.getItems<ConnectionRequest>('requests', user.id)
                ]);

                setPosts(dbPosts);
                setMessages(dbMsgs);
                setContacts(dbContacts);
                setGroups(dbGroups);
                setNotifications(dbNotifs);
                setConnectionRequests(dbRequests);

                // Note: Peers are already loaded via useState lazy init above.
                
                setIsLoaded(true);
            } catch (e) {
                console.error("CRITICAL: Failed to load app state from DB", e);
                // DO NOT SET isLoaded(true) here!
                // This leaves the app in a loading state loop, but prevents empty arrays from overwriting valid data.
                alert("Database Error: Failed to load profile data. Please refresh.");
            }
        };
        loadData();
    }, [user.id]);

    // Refs for callbacks
    // Use useLayoutEffect to ensure refs are updated BEFORE other effects run (like network replay)
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

    // --- PERSISTENCE (WRITE TO IDB) ---
    // Switched from saveBulk (Upsert only) to syncState (Upsert + Delete Missing)
    useEffect(() => { if(isLoaded) storageService.syncState('contacts', contacts, user.id); }, [contacts, user.id, isLoaded]);
    useEffect(() => { if(isLoaded) storageService.syncState('posts', posts, user.id); }, [posts, user.id, isLoaded]);
    useEffect(() => { if(isLoaded) storageService.syncState('groups', groups, user.id); }, [groups, user.id, isLoaded]);
    useEffect(() => { if(isLoaded) storageService.syncState('messages', messages, user.id); }, [messages, user.id, isLoaded]);
    useEffect(() => { if(isLoaded) storageService.syncState('requests', connectionRequests, user.id); }, [connectionRequests, user.id, isLoaded]);
    useEffect(() => { if(isLoaded) storageService.syncState('notifications', notifications, user.id); }, [notifications, user.id, isLoaded]);
    
    // Config and Peers stay in LocalStorage
    useEffect(() => { localStorage.setItem(NODE_CONFIG_KEY, JSON.stringify(nodeConfig)); }, [nodeConfig]);
    
    useEffect(() => {
        localStorage.setItem(PEERS_KEY, JSON.stringify(peers));
        networkService.updateKnownPeers(peers.map(p => p.onionAddress));
    }, [peers]);

    // --- GARBAGE COLLECTION ---
    const pruneMessages = async () => {
        const deletedCount = await storageService.pruneEphemeralMessages(user.id);
        if (deletedCount > 0) {
            const freshMsgs = await storageService.getItems<Message>('messages', user.id);
            setMessages(freshMsgs);
        }
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

    return {
        contacts, setContacts,
        posts, setPosts,
        groups, setGroups,
        messages, setMessages,
        notifications, setNotifications,
        peers, setPeers,
        nodeConfig, setNodeConfig,
        connectionRequests, setConnectionRequests,
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
        userStats
    };
};
