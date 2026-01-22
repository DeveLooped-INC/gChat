
import { useState, useEffect, useRef, useMemo } from 'react';
import { UserProfile, Contact, Post, Group, Message, NotificationItem, NodePeer, ConnectionRequest, AppRoute } from '../types';
import { networkService } from '../services/networkService';

const NODE_CONFIG_KEY = 'gchat_node_config';

export const useAppState = (user: UserProfile) => {
    // --- DATA STATES ---
    const [contacts, setContacts] = useState<Contact[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_contacts`) || '[]'); } 
        catch { return []; }
    });

    const [posts, setPosts] = useState<Post[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_posts`) || '[]'); } 
        catch { return []; }
    });

    const [groups, setGroups] = useState<Group[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_groups`) || '[]'); } 
        catch { return []; }
    });

    const [messages, setMessages] = useState<Message[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_messages`) || '[]'); } 
        catch { return []; }
    });

    const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_notifications`) || '[]'); } 
        catch { return []; }
    });

    const [peers, setPeers] = useState<NodePeer[]>(() => {
        try { return JSON.parse(localStorage.getItem('gchat_node_peers') || '[]'); } 
        catch { return []; }
    });

    const [nodeConfig, setNodeConfig] = useState<{alias: string, description: string}>(() => {
        try { return JSON.parse(localStorage.getItem(NODE_CONFIG_KEY) || '{"alias":"", "description":""}'); }
        catch { return { alias: '', description: '' }; }
    });

    const [connectionRequests, setConnectionRequests] = useState<ConnectionRequest[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_requests`) || '[]'); } 
        catch { return []; }
    });

    // Refs for callbacks to avoid stale closures in event listeners
    const userRef = useRef(user);
    const contactsRef = useRef(contacts);
    const peersRef = useRef(peers);
    const nodeConfigRef = useRef(nodeConfig);
    const postsRef = useRef(posts);
    const groupsRef = useRef(groups);
    
    useEffect(() => { userRef.current = user; }, [user]);
    useEffect(() => { contactsRef.current = contacts; }, [contacts]);
    useEffect(() => { peersRef.current = peers; }, [peers]);
    useEffect(() => { nodeConfigRef.current = nodeConfig; }, [nodeConfig]);
    useEffect(() => { postsRef.current = posts; }, [posts]);
    useEffect(() => { groupsRef.current = groups; }, [groups]);

    // --- PERSISTENCE ---
    useEffect(() => { localStorage.setItem(`user_${user.id}_contacts`, JSON.stringify(contacts)); }, [contacts, user.id]);
    useEffect(() => { localStorage.setItem(`user_${user.id}_posts`, JSON.stringify(posts)); }, [posts, user.id]);
    useEffect(() => { localStorage.setItem(`user_${user.id}_groups`, JSON.stringify(groups)); }, [groups, user.id]);
    useEffect(() => { localStorage.setItem(`user_${user.id}_messages`, JSON.stringify(messages)); }, [messages, user.id]);
    useEffect(() => { localStorage.setItem(`user_${user.id}_requests`, JSON.stringify(connectionRequests)); }, [connectionRequests, user.id]);
    useEffect(() => { localStorage.setItem(`user_${user.id}_notifications`, JSON.stringify(notifications)); }, [notifications, user.id]);
    useEffect(() => { localStorage.setItem(NODE_CONFIG_KEY, JSON.stringify(nodeConfig)); }, [nodeConfig]);
    
    useEffect(() => {
        localStorage.setItem('gchat_node_peers', JSON.stringify(peers));
        networkService.updateKnownPeers(peers.map(p => p.onionAddress));
    }, [peers]);

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
        // State
        contacts, setContacts,
        posts, setPosts,
        groups, setGroups,
        messages, setMessages,
        notifications, setNotifications,
        peers, setPeers,
        nodeConfig, setNodeConfig,
        connectionRequests, setConnectionRequests,
        
        // Refs
        userRef,
        contactsRef,
        peersRef,
        nodeConfigRef,
        postsRef,
        groupsRef,

        // Derived
        chatUnread,
        contactsUnread,
        feedUnread,
        settingsUnread,
        userStats
    };
};

import { useState, useEffect, useRef, useMemo } from 'react';
import { UserProfile, Contact, Post, Group, Message, NotificationItem, NodePeer, ConnectionRequest, AppRoute } from '../types';
import { networkService } from '../services/networkService';

const NODE_CONFIG_KEY = 'gchat_node_config';

export const useAppState = (user: UserProfile) => {
    // --- DATA STATES ---
    const [contacts, setContacts] = useState<Contact[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_contacts`) || '[]'); } 
        catch { return []; }
    });

    const [posts, setPosts] = useState<Post[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_posts`) || '[]'); } 
        catch { return []; }
    });

    const [groups, setGroups] = useState<Group[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_groups`) || '[]'); } 
        catch { return []; }
    });

    const [messages, setMessages] = useState<Message[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_messages`) || '[]'); } 
        catch { return []; }
    });

    const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_notifications`) || '[]'); } 
        catch { return []; }
    });

    const [peers, setPeers] = useState<NodePeer[]>(() => {
        try { return JSON.parse(localStorage.getItem('gchat_node_peers') || '[]'); } 
        catch { return []; }
    });

    const [nodeConfig, setNodeConfig] = useState<{alias: string, description: string}>(() => {
        try { return JSON.parse(localStorage.getItem(NODE_CONFIG_KEY) || '{"alias":"", "description":""}'); }
        catch { return { alias: '', description: '' }; }
    });

    const [connectionRequests, setConnectionRequests] = useState<ConnectionRequest[]>(() => {
        try { return JSON.parse(localStorage.getItem(`user_${user.id}_requests`) || '[]'); } 
        catch { return []; }
    });

    // Refs for callbacks to avoid stale closures in event listeners
    const userRef = useRef(user);
    const contactsRef = useRef(contacts);
    const peersRef = useRef(peers);
    const nodeConfigRef = useRef(nodeConfig);
    const postsRef = useRef(posts);
    const groupsRef = useRef(groups);
    
    useEffect(() => { userRef.current = user; }, [user]);
    useEffect(() => { contactsRef.current = contacts; }, [contacts]);
    useEffect(() => { peersRef.current = peers; }, [peers]);
    useEffect(() => { nodeConfigRef.current = nodeConfig; }, [nodeConfig]);
    useEffect(() => { postsRef.current = posts; }, [posts]);
    useEffect(() => { groupsRef.current = groups; }, [groups]);

    // --- PERSISTENCE ---
    useEffect(() => { localStorage.setItem(`user_${user.id}_contacts`, JSON.stringify(contacts)); }, [contacts, user.id]);
    useEffect(() => { localStorage.setItem(`user_${user.id}_posts`, JSON.stringify(posts)); }, [posts, user.id]);
    useEffect(() => { localStorage.setItem(`user_${user.id}_groups`, JSON.stringify(groups)); }, [groups, user.id]);
    useEffect(() => { localStorage.setItem(`user_${user.id}_messages`, JSON.stringify(messages)); }, [messages, user.id]);
    useEffect(() => { localStorage.setItem(`user_${user.id}_requests`, JSON.stringify(connectionRequests)); }, [connectionRequests, user.id]);
    useEffect(() => { localStorage.setItem(`user_${user.id}_notifications`, JSON.stringify(notifications)); }, [notifications, user.id]);
    useEffect(() => { localStorage.setItem(NODE_CONFIG_KEY, JSON.stringify(nodeConfig)); }, [nodeConfig]);
    
    useEffect(() => {
        localStorage.setItem('gchat_node_peers', JSON.stringify(peers));
        networkService.updateKnownPeers(peers.map(p => p.onionAddress));
    }, [peers]);

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
        // State
        contacts, setContacts,
        posts, setPosts,
        groups, setGroups,
        messages, setMessages,
        notifications, setNotifications,
        peers, setPeers,
        nodeConfig, setNodeConfig,
        connectionRequests, setConnectionRequests,
        
        // Refs
        userRef,
        contactsRef,
        peersRef,
        nodeConfigRef,
        postsRef,
        groupsRef,

        // Derived
        chatUnread,
        contactsUnread,
        feedUnread,
        settingsUnread,
        userStats
    };
};
