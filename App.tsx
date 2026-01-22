import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Layout from './components/Layout';
import Onboarding from './components/Onboarding';
import Feed from './components/Feed';
import Chat from './components/Chat';
import Contacts from './components/Contacts';
import NodeSettings from './components/NodeSettings';
import Notifications from './components/Notifications';
import ToastContainer from './components/Toast';
import HelpModal from './components/HelpModal';
import { AppRoute, UserProfile, Post, Message, Contact, ToastMessage, NetworkPacket, EncryptedPayload, Group, MediaMetadata, NodePeer, ConnectionRequest, Comment, AvailablePeer, NotificationItem } from './types';
import { networkService } from './services/networkService';
import { decryptMessage, verifySignature, encryptMessage, generateTripcode, signData } from './services/cryptoService';
import { calculatePostHash, formatUserIdentity } from './utils';
import { Loader2 } from 'lucide-react';
import UserInfoModal, { UserInfoTarget } from './components/UserInfoModal';

const USER_STORAGE_KEY = 'gchat_user_profile';
const NODE_CONFIG_KEY = 'gchat_node_config';
const MAX_GOSSIP_HOPS = 6;

// --- HELPERS ---

// Helper to reconstruct post payload for verification
const createPostPayload = (post: Post) => ({
    authorId: post.authorId,
    content: post.content,
    imageUrl: post.imageUrl || null, 
    media: post.media || undefined,
    timestamp: post.timestamp,
    location: post.location || "",
    hashtags: post.hashtags || []
});

// Helper to recursively update comments
const updateCommentTree = (comments: Comment[], targetId: string, updater: (c: Comment) => Comment): Comment[] => {
    return comments.map(c => {
        if (c.id === targetId) {
            return updater(c);
        }
        if (c.replies && c.replies.length > 0) {
            return { ...c, replies: updateCommentTree(c.replies, targetId, updater) };
        }
        return c;
    });
};

// Helper to recursively find a comment
const findCommentInTree = (comments: Comment[], targetId: string): Comment | undefined => {
    for (const c of comments) {
        if (c.id === targetId) return c;
        if (c.replies && c.replies.length > 0) {
            const found = findCommentInTree(c.replies, targetId);
            if (found) return found;
        }
    }
    return undefined;
};

// Helper to recursively find and append reply
const appendReply = (comments: Comment[], parentId: string, newComment: Comment): Comment[] => {
    return comments.map(c => {
        if (c.id === parentId) {
            // Idempotency check for replies
            if (c.replies && c.replies.some(r => r.id === newComment.id)) return c;
            return { ...c, replies: [...(c.replies || []), newComment] };
        }
        if (c.replies && c.replies.length > 0) {
            return { ...c, replies: appendReply(c.replies, parentId, newComment) };
        }
        return c;
    });
};

// Helper to merge posts (Union of comments, votes, reactions)
const mergePosts = (local: Post, incoming: Post): Post => {
    // 1. Merge Comments (Union by ID)
    const allComments = [...local.commentsList, ...incoming.commentsList];
    const uniqueCommentsMap = new Map();
    allComments.forEach(c => uniqueCommentsMap.set(c.id, c));
    const uniqueComments = Array.from(uniqueCommentsMap.values()) as Comment[];
    uniqueComments.sort((a, b) => a.timestamp - b.timestamp);

    // 2. Merge Votes (Incoming overwrites local if conflict, but preserving unique keys)
    const mergedVotes = { ...local.votes, ...incoming.votes };

    // 3. Merge Reactions (Union of user IDs per emoji)
    const mergedReactions: Record<string, string[]> = { ...local.reactions };
    Object.entries(incoming.reactions || {}).forEach(([emoji, users]) => {
        const existing = mergedReactions[emoji] || [];
        // Unique user IDs
        const combined = Array.from(new Set([...existing, ...users]));
        mergedReactions[emoji] = combined;
    });

    // 4. Determine Content (Prefer the one with newer 'isEdited' or just incoming)
    // For simplicity in this version, we trust the incoming sync response as "authoritative" for content
    // but we MUST ensure signature validity (checked before calling this).
    
    return {
        ...local, // Keep local ephemeral props if any
        ...incoming, // Apply content updates
        comments: uniqueComments.length,
        commentsList: uniqueComments,
        votes: mergedVotes,
        reactions: mergedReactions
    };
};

// --- AUTHENTICATED APP ---
const AuthenticatedApp = ({ user, onLogout, onUpdateUser }: { user: UserProfile, onLogout: () => void, onUpdateUser: (u: UserProfile) => void }) => {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(AppRoute.FEED);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  
  // Shutdown State
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [shutdownStep, setShutdownStep] = useState('');

  // Sync Settings
  const [maxSyncAgeHours, setMaxSyncAgeHours] = useState(24);

  // New: Feed Filter State for Navigation
  const [feedInitialState, setFeedInitialState] = useState<{ filter: 'public' | 'friends'; authorId?: string; postId?: string } | null>(null);

  // New: User Modal State (Global)
  const [showUserModal, setShowUserModal] = useState(false);

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

  // Discovered Nodes via Gossip (Not yet connected)
  const [discoveredPeers, setDiscoveredPeers] = useState<AvailablePeer[]>([]);

  // Node Configuration (Alias/Desc)
  const [nodeConfig, setNodeConfig] = useState<{alias: string, description: string}>(() => {
      try { return JSON.parse(localStorage.getItem(NODE_CONFIG_KEY) || '{"alias":"", "description":""}'); }
      catch { return { alias: '', description: '' }; }
  });

  // Pending Connection Requests (User Contacts)
  const [connectionRequests, setConnectionRequests] = useState<ConnectionRequest[]>(() => {
      try { return JSON.parse(localStorage.getItem(`user_${user.id}_requests`) || '[]'); } 
      catch { return []; }
  });

  // Pending Peer Requests (Nodes)
  const [pendingNodeRequests, setPendingNodeRequests] = useState<string[]>([]);

  // Deduplication Set for Gossip Protocol
  const processedPacketIds = useRef<Set<string>>(new Set());

  // --- DERIVED BADGE COUNTS ---
  const chatUnread = useMemo(() => {
      // Unread actual messages
      const msgs = messages.filter(m => !m.read && !m.isMine).length;
      // Plus notification invites linked to Chat
      const invites = notifications.filter(n => !n.read && n.linkRoute === AppRoute.CHAT).length;
      return msgs + invites;
  }, [messages, notifications]);

  const contactsUnread = useMemo(() => {
      return connectionRequests.length + notifications.filter(n => !n.read && n.linkRoute === AppRoute.CONTACTS).length;
  }, [connectionRequests, notifications]);

  const feedUnread = useMemo(() => {
      // Notifications linked to FEED (Broadcasts, Friend Posts)
      return notifications.filter(n => !n.read && n.linkRoute === AppRoute.FEED).length;
  }, [notifications]);

  const settingsUnread = useMemo(() => {
      // Notifications linked to SETTINGS (New Node Signals)
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

  // --- NAVIGATION & NOTIFICATION HANDLERS ---

  const handleNavigate = useCallback((route: AppRoute) => {
      setActiveRoute(route);
      
      // Auto-clear notifications related to this route when visited
      // This clears the badges from the sidebar automatically
      setNotifications(prev => prev.map(n => {
          if (!n.read && n.linkRoute === route) {
              return { ...n, read: true };
          }
          return n;
      }));
  }, []);

  const handleNotificationNavigation = useCallback((route?: AppRoute, id?: string) => {
      if (!route) return;

      if (route === AppRoute.CHAT && id) {
          setActiveChatId(id);
          handleNavigate(AppRoute.CHAT);
      } else if (route === AppRoute.FEED && id) {
          setFeedInitialState({ filter: 'public', authorId: id });
          handleNavigate(AppRoute.FEED);
      } else if (route === AppRoute.CONTACTS) {
          handleNavigate(AppRoute.CONTACTS);
      } else {
          handleNavigate(route);
      }
  }, [handleNavigate]);

  const addNotification = useCallback((title: string, message: string, type: ToastMessage['type'] = 'info', linkRoute?: AppRoute, linkId?: string) => {
    const id = crypto.randomUUID();
    
    // Persistent Notification Log (Saved to Storage)
    const newNotification: NotificationItem = {
        id,
        title,
        message,
        type,
        timestamp: Date.now(),
        read: false, // Starts unread, shows up in badges
        linkRoute,
        linkId
    };
    
    setNotifications(prev => [newNotification, ...prev].slice(0, 100)); // Limit to last 100

    // Transient Toast (Popup)
    const action = (linkRoute) ? () => handleNotificationNavigation(linkRoute, linkId) : undefined;
    
    setToasts(prev => [...prev, { id, title, message, type, action }]);
  }, [handleNotificationNavigation]);

  const handleClearNotifications = () => {
      setNotifications([]);
  };

  const handleMarkNotificationsRead = () => {
      setNotifications(prev => prev.map(n => ({...n, read: true})));
  };

  const handleNotificationClick = (item: NotificationItem) => {
      // Mark as read when clicked
      setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, read: true } : n));
      
      // Navigate
      if (item.linkRoute) {
          handleNotificationNavigation(item.linkRoute, item.linkId);
      }
  };

  // --- HELPER: Broadcast Post State (Ensures propagation of edits/comments) ---
  const broadcastPostState = useCallback((post: Post) => {
      if (post.privacy !== 'public') return;
      
      // Calculate fresh hash representing current state (content + comments + votes)
      const hash = calculatePostHash(post);
      
      const packet: NetworkPacket = {
          id: crypto.randomUUID(),
          type: 'INVENTORY_ANNOUNCE',
          senderId: userRef.current.homeNodeOnion,
          payload: {
              postId: post.id,
              contentHash: hash,
              authorId: post.authorId,
              timestamp: post.timestamp
          }
      };
      // Broadcast to all connected peers so they know the state has changed
      networkService.broadcast(packet, peersRef.current.map(p => p.onionAddress));
  }, []);

  // --- DAISY CHAIN GOSSIP (LEGACY) ---
  const daisyChainPacket = useCallback(async (packet: NetworkPacket, sourceNodeId?: string) => {
      const currentHops = packet.hops || 0;
      if (currentHops <= 0) {
          // Log end of life for packet
          // networkService.log('DEBUG', 'NETWORK', `Packet ${packet.type} TTL expired (0 hops).`);
          return;
      }

      const nextPacket = { ...packet, hops: currentHops - 1 };
      
      const allPeers = peersRef.current.map(p => p.onionAddress);
      
      const recipients = allPeers.filter(addr => {
          const isSource = addr === sourceNodeId;
          const isOrigin = addr === packet.senderId;
          const isSelf = addr === userRef.current.homeNodeOnion;
          return !isSource && !isOrigin && !isSelf;
      });

      if (recipients.length === 0) {
          return;
      }

      recipients.forEach(async (recipient) => {
          await new Promise(r => setTimeout(r, Math.random() * 200));
          networkService.sendMessage(recipient, nextPacket);
      });
  }, []);

  // --- PACKET HANDLING ---
  // We use a REF to hold the latest version of this function to avoid stale closures in the socket listener
  const handlePacketRef = useRef<(packet: NetworkPacket, senderNodeId: string) => void>(() => {});

  const handlePacket = useCallback((packet: NetworkPacket, senderNodeId: string) => {
      const currentUser = userRef.current;
      
      if (packet.id && processedPacketIds.current.has(packet.id)) {
          return; 
      }
      if (packet.id) processedPacketIds.current.add(packet.id);

      if (senderNodeId) {
          setPeers(prev => prev.map(p => {
              if (p.onionAddress === senderNodeId && p.status !== 'online') {
                  return { ...p, status: 'online', lastSeen: Date.now() };
              }
              return p;
          }));
      }

      if (senderNodeId && 
          !peersRef.current.some(p => p.onionAddress === senderNodeId) && 
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
              const { userId } = packet.payload;
              if (packet.targetUserId === currentUser.id) {
                  const updatedUser = { 
                      ...currentUser, 
                      followersCount: (currentUser.followersCount || 0) + 1 
                  };
                  onUpdateUser(updatedUser);
                  // UPDATED: Navigate to Settings
                  addNotification('New Follower', 'Someone started following you!', 'success', AppRoute.NODE_SETTINGS);
              }
              break;
          }

          case 'UNFOLLOW': {
              const { userId } = packet.payload;
              if (packet.targetUserId === currentUser.id) {
                  const current = currentUser.followersCount || 0;
                  const updatedUser = { 
                      ...currentUser, 
                      followersCount: Math.max(0, current - 1) 
                  };
                  onUpdateUser(updatedUser);
              }
              break;
          }

          // --- INVENTORY PROTOCOL HANDLERS ---
          case 'INVENTORY_ANNOUNCE': {
              const { postId, contentHash, authorId, timestamp } = packet.payload;
              const existingPost = postsRef.current.find(p => p.id === postId);
              // CRITICAL FIX: Calculate local hash fresh to ensure we catch updates (comments/votes)
              const localHash = existingPost ? calculatePostHash(existingPost) : null;
              
              if (!existingPost || localHash !== contentHash) {
                  networkService.log('DEBUG', 'NETWORK', `[SYNC] Detected stale/missing post ${postId.substring(0,8)}. Requesting update...`);
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
              const post = postsRef.current.find(p => p.id === postId);
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
                  // NOTE: Incoming post might have new comments, so its calculated hash depends on its current state
                  // We accept it if signature is valid.
                  const calculatedHash = calculatePostHash(post);
                  const postWithHash = { ...post, contentHash: calculatedHash };

                  let isNewOrUpdated = false;

                  setPosts(prev => {
                      const idx = prev.findIndex(p => p.id === post.id);
                      if (idx === -1) {
                          isNewOrUpdated = true;
                          return [postWithHash, ...prev];
                      } else {
                          const existing = prev[idx];
                          const existingHash = calculatePostHash(existing);
                          if (existingHash !== calculatedHash) {
                              isNewOrUpdated = true;
                              // MERGE LOGIC instead of replace
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
                      // NOTIFICATION FOR PUBLIC BROADCAST
                      // Notify if post is within sync window (24h)
                      // This ensures that even if I sync from yesterday, I get a badge.
                      const isRecent = (Date.now() - post.timestamp) < (maxSyncAgeHours * 60 * 60 * 1000);
                      
                      if (isRecent && post.authorId !== currentUser.id) {
                          const { handle } = formatUserIdentity(post.authorName);
                          // This notification adds a badge to FEED via linkRoute
                          addNotification('New Broadcast', `${handle} posted: ${post.content.substring(0, 30)}...`, 'info', AppRoute.FEED, post.authorId);
                      }

                      // CRITICAL: If we updated our state, we MUST announce it to our peers
                      // This ensures that if Node A updates Node B, Node B then updates Node C.
                      broadcastPostState(postWithHash);
                  }
              }
              break;
          }

          case 'INVENTORY_SYNC_REQUEST': {
              const { inventory, since } = packet.payload;
              const theirInv = inventory as { id: string, hash: string }[];
              // 1. Get my public posts from the requested timeframe
              const myPosts = postsRef.current.filter(p => p.timestamp > since && p.privacy === 'public');
              
              // 2. Identify which of MY posts the OTHER node is missing or has an outdated version of
              const missingOrUpdatedOnTheirSide = myPosts.filter(myP => {
                  const theirEntry = theirInv.find(i => i.id === myP.id);
                  if (!theirEntry) return true; // They don't have it -> Send
                  
                  // CRITICAL FIX: Calculate my hash freshly to ensure we include recent comments
                  const myCurrentHash = calculatePostHash(myP);
                  const different = theirEntry.hash !== myCurrentHash;
                  if (different) {
                      // networkService.log('DEBUG', 'NETWORK', `[SYNC] Peer has old version of ${myP.id.substring(0,8)}. Theirs: ${theirEntry.hash.substring(0,6)}, Mine: ${myCurrentHash.substring(0,6)}`);
                  }
                  return different;
              });

              if (missingOrUpdatedOnTheirSide.length > 0) {
                  networkService.log('INFO', 'NETWORK', `[SYNC] Sending ${missingOrUpdatedOnTheirSide.length} updates to ${senderNodeId}`);
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
                  setPosts(prev => {
                      const next = [...prev];
                      incomingPosts.forEach(inc => {
                          const idx = next.findIndex(p => p.id === inc.id);
                          const calculatedHash = calculatePostHash(inc);
                          const incWithHash = { ...inc, contentHash: calculatedHash };

                          if (idx === -1) {
                              if (verifySignature(createPostPayload(inc), inc.truthHash, inc.authorPublicKey)) {
                                  next.push(incWithHash);
                                  addedCount++;
                                  // Notify for sync received posts too if recent
                                  const isRecent = (Date.now() - inc.timestamp) < (maxSyncAgeHours * 60 * 60 * 1000);
                                  if (isRecent && inc.authorId !== currentUser.id) {
                                      const { handle } = formatUserIdentity(inc.authorName);
                                      addNotification('New Broadcast', `${handle} posted: ${inc.content.substring(0, 30)}...`, 'info', AppRoute.FEED, inc.authorId);
                                  }
                              }
                          } else {
                              const existing = next[idx];
                              const existingHash = calculatePostHash(existing);
                              if (existingHash !== calculatedHash) {
                                  if (verifySignature(createPostPayload(inc), inc.truthHash, inc.authorPublicKey)) {
                                      // MERGE LOGIC
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
                  // Strict check against REF to prevent duplicate entries
                  const isAlreadyPeer = peersRef.current.some(p => p.onionAddress === info.onionAddress);

                  if (isAlreadyPeer) {
                      setPeers(prev => prev.map(p => 
                          p.onionAddress === info.onionAddress 
                              ? { ...p, alias: info.alias, status: 'online', lastSeen: Date.now() } 
                              : p
                      ));
                      // Ensure it's not in discovered list if it's a known peer
                      setDiscoveredPeers(prev => prev.filter(p => p.id !== info.onionAddress));
                  } else {
                      setDiscoveredPeers(prev => {
                          const existing = prev.find(p => p.id === info.onionAddress);
                          if (existing) {
                              // Update freshness
                              return prev.map(p => p.id === info.onionAddress ? { ...p, lastSeen: Date.now(), hops: MAX_GOSSIP_HOPS - (packet.hops || 0) } : p);
                          }
                          // Add new
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
                  // CRITICAL: Always attempt to forward, even if we know the peer.
                  daisyChainPacket(packet, senderNodeId);
              }
              break;
          }

          case 'POST':
              const post = packet.payload as Post;
              if (verifySignature(createPostPayload(post), post.truthHash, post.authorPublicKey)) {
                  setPosts(prev => {
                      if (prev.some(p => p.id === post.id)) return prev;
                      
                      // Notification for Friend Post (Encrypted Feed)
                      const { handle } = formatUserIdentity(post.authorName);
                      // This ensures it shows up as a badge on FEED
                      addNotification('Friend Post', `${handle} shared a secure broadcast.`, 'info', AppRoute.FEED, post.authorId);
                      
                      return [post, ...prev];
                  });
              }
              break;

          case 'USER_EXIT': {
              const { userId } = packet.payload;
              setContacts(prev => prev.map(c => 
                  c.id === userId ? { ...c, status: 'offline' } : c
              ));
              break;
          }

          case 'NODE_SHUTDOWN': {
              const { onionAddress } = packet.payload;
              console.log(`[NETWORK] Peer ${onionAddress} is shutting down.`);
              setPeers(prev => prev.map(p => 
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
                  setContacts(prev => prev.map(c => {
                      if (c.id === req.fromUserId && (!c.encryptionPublicKey || c.encryptionPublicKey !== req.fromEncryptionPublicKey)) {
                          return { ...c, encryptionPublicKey: req.fromEncryptionPublicKey };
                      }
                      return c;
                  }));
              }
              const existingContact = contactsRef.current.find(c => c.id === req.fromUserId);
              if (existingContact) return;
              setConnectionRequests(prev => {
                  if (prev.some(r => r.fromUserId === req.fromUserId)) return prev;
                  addNotification('New Connection', `${req.fromDisplayName} wants to connect.`, 'success', AppRoute.CONTACTS);
                  return [...prev, req];
              });
              if (req.fromHomeNode) networkService.connect(req.fromHomeNode);
              break;

          case 'MESSAGE': 
              const encPayload = packet.payload as EncryptedPayload;
              let senderContact = contactsRef.current.find(c => {
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
                      setMessages(prev => {
                          if (prev.some(m => m.id === newMsg.id)) return prev;
                          return [...prev, newMsg];
                      });
                      if (activeChatId !== threadId) {
                          const group = groupsRef.current.find(g => g.id === encPayload.groupId);
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
              setMessages(prev => prev.map(m => {
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
              setMessages(prev => prev.map(m => {
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
              setGroups(prev => {
                  if (prev.some(g => g.id === group.id)) return prev;
                  addNotification('Group Invite', `Added to group "${group.name}"`, 'success', AppRoute.CHAT, group.id);
                  return [...prev, group];
              });
              break;
          }

          case 'GROUP_UPDATE': {
              const updatedGroup = packet.payload as Group;
              setGroups(prev => {
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
              const sharedGroups = groupsRef.current.filter(g => g.members.includes(requesterUserId) && g.members.includes(currentUser.id));
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
                  setGroups(prev => {
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
              setGroups(prev => prev.filter(g => g.id !== groupId));
              break;
          }

          case 'DELETE_POST':
              const { postId: delPostId } = packet.payload;
              setPosts(prev => prev.filter(p => p.id !== delPostId));
              daisyChainPacket(packet, senderNodeId);
              break;

          // --- PUBLIC INTERACTION HANDLERS (ENHANCED) ---
          case 'EDIT_POST':
              const { postId: editPostId, newContent } = packet.payload;
              let editedPost: Post | undefined;
              setPosts(prev => prev.map(p => {
                  if (p.id === editPostId) {
                      const updated = { ...p, content: newContent, isEdited: true, contentHash: calculatePostHash({...p, content: newContent, isEdited: true}) };
                      editedPost = updated;
                      return updated;
                  }
                  return p;
              }));
              // Propagate the change via new sync logic
              if(editedPost) broadcastPostState(editedPost);
              daisyChainPacket(packet, senderNodeId);
              break;

          case 'COMMENT':
              const { postId, comment: newComment, parentCommentId } = packet.payload;
              let postAfterComment: Post | undefined;
              
              setPosts(prev => prev.map(p => {
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
              const postForComment = postsRef.current.find(p => p.id === postId);
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

              // Broadcast new state to ensure neighbors sync up even if they missed the packet
              if (postAfterComment) broadcastPostState(postAfterComment);
              daisyChainPacket(packet, senderNodeId);
              break;

          case 'COMMENT_VOTE':
              const { postId: cvPostId, commentId: cvCommentId, userId: cvUserId, type: cvType } = packet.payload;
              let postAfterCV: Post | undefined;
              setPosts(prev => prev.map(p => {
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
              const postForCV = postsRef.current.find(p => p.id === cvPostId);
              if (postForCV) {
                  const targetComment = findCommentInTree(postForCV.commentsList, cvCommentId);
                  if (targetComment && targetComment.authorId === currentUser.id && cvUserId !== currentUser.id) {
                      const voter = contactsRef.current.find(c => c.id === cvUserId);
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
              setPosts(prev => prev.map(p => {
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
              const postForCR = postsRef.current.find(p => p.id === crPostId);
              if (postForCR) {
                  const targetComment = findCommentInTree(postForCR.commentsList, crCommentId);
                  if (targetComment && targetComment.authorId === currentUser.id && crUserId !== currentUser.id) {
                      const reactor = contactsRef.current.find(c => c.id === crUserId);
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
              setPosts(prev => prev.map(p => {
                  if (p.id !== vPostId) return p;
                  const updatedPost = { ...p, votes: { ...p.votes, [vUserId]: vType } };
                  updatedPost.contentHash = calculatePostHash(updatedPost);
                  postAfterVote = updatedPost;
                  return updatedPost;
              }));

              // --- NOTIFICATION LOGIC ---
              const postForVote = postsRef.current.find(p => p.id === vPostId);
              if (postForVote && postForVote.authorId === currentUser.id && vUserId !== currentUser.id) {
                  const voter = contactsRef.current.find(c => c.id === vUserId);
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
              setPosts(prev => prev.map(p => {
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
              const postForReaction = postsRef.current.find(p => p.id === rPostId);
              if (postForReaction && postForReaction.authorId === currentUser.id && rUserId !== currentUser.id) {
                  const reactor = contactsRef.current.find(c => c.id === rUserId);
                  const { handle } = formatUserIdentity(reactor?.displayName || 'Someone');
                  addNotification('New Reaction', `${handle} reacted ${emoji} to your broadcast`, 'success', AppRoute.FEED, rPostId);
              }
              // --------------------------

              if(postAfterReaction) broadcastPostState(postAfterReaction);
              daisyChainPacket(packet, senderNodeId);
              break;
          }
      }
  }, [addNotification, daisyChainPacket, maxSyncAgeHours, onUpdateUser, activeChatId, broadcastPostState]);

  // Update the ref whenever handlePacket changes (which is often, due to dependency arrays)
  useEffect(() => {
      handlePacketRef.current = handlePacket;
  }, [handlePacket]);

  // --- GRACEFUL SHUTDOWN ---
  const performGracefulShutdown = useCallback(async () => {
      if(isShuttingDown) return;
      setIsShuttingDown(true);
      setShutdownStep('Notifying peers...');
      
      try {
          await networkService.announceExit(
              peersRef.current.map(p => p.onionAddress),
              contactsRef.current.map(c => ({ homeNodes: c.homeNodes, id: c.id })),
              userRef.current.homeNodeOnion,
              userRef.current.id
          );
          setShutdownStep('Closing connections...');
          networkService.confirmShutdown();
      } catch(e) {
          console.error("Shutdown error", e);
          networkService.confirmShutdown();
      }
  }, [isShuttingDown]);

  // --- MANUAL GLOBAL SYNC ---
  const handleGlobalSync = useCallback(() => {
      const activePeers = peersRef.current.filter(p => p.status === 'online').map(p => p.onionAddress);
      if (activePeers.length === 0) {
          addNotification('Sync Failed', 'No active peers to sync with.', 'warning');
          return;
      }
      
      addNotification('Global Sync', `Requesting updates from ${activePeers.length} peers...`, 'info');
      
      const since = Date.now() - (maxSyncAgeHours * 60 * 60 * 1000);
      const myInventory = postsRef.current
          .filter(p => p.timestamp > since && p.privacy === 'public')
          // CRITICAL FIX: Calculate local hash fresh here too!
          .map(p => ({ id: p.id, hash: calculatePostHash(p) }));

      const packet: NetworkPacket = {
          id: crypto.randomUUID(),
          type: 'INVENTORY_SYNC_REQUEST',
          senderId: userRef.current.homeNodeOnion,
          payload: { inventory: myInventory, since }
      };
      networkService.broadcast(packet, activePeers);
  }, [addNotification, maxSyncAgeHours]);

  // --- DISCOVERY BROADCAST (HEARTBEAT) ---
  useEffect(() => {
      if (!isOnline || !user.isDiscoverable || isShuttingDown) return;

      const broadcastPresence = () => {
          if (isShuttingDown) return; 

          const config = nodeConfigRef.current;
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
          const peerAddrs = peersRef.current.map(p => p.onionAddress);
          if (peerAddrs.length > 0) {
              // networkService.log('DEBUG', 'NETWORK', `Broadcasting ANNOUNCE_PEER to: ${peerAddrs.join(', ')}`);
              networkService.broadcast(packet, peerAddrs);
          }
      };

      // Broadcast immediately on startup/online
      broadcastPresence();
      
      // Repeat every 2 minutes
      const interval = setInterval(broadcastPresence, 120000);
      return () => clearInterval(interval);
  }, [isOnline, user.isDiscoverable, user.homeNodeOnion, isShuttingDown]); 

  // --- PERIODIC PEER HEALTH POLLING ---
  useEffect(() => {
      const pingPeers = () => {
          if (isShuttingDown) return;
          peersRef.current.forEach(p => {
              networkService.connect(p.onionAddress); 
          });
      };
      
      if (isOnline) {
          pingPeers(); // Initial ping on startup/online
          const interval = setInterval(pingPeers, 60000); // Poll every 1 minute
          return () => clearInterval(interval);
      }
  }, [isOnline, isShuttingDown]);

  // --- NETWORK INIT ---
  useEffect(() => {
      networkService.init(user.id);
      
      peers.forEach(p => networkService.connect(p.onionAddress));

      const unsubscribe = networkService.subscribeToStatus((status, onionAddress) => {
          setIsOnline(status);
          // ON RECONNECT: Trigger Inventory Sync with all active peers
          if (status) {
              const activePeers = peersRef.current.map(p => p.onionAddress);
              if (activePeers.length > 0) {
                  const since = Date.now() - (maxSyncAgeHours * 60 * 60 * 1000);
                  const myInventory = postsRef.current
                      .filter(p => p.timestamp > since && p.privacy === 'public')
                      // CRITICAL FIX: Calculate local hash fresh
                      .map(p => ({ id: p.id, hash: calculatePostHash(p) }));

                  const packet: NetworkPacket = {
                      id: crypto.randomUUID(),
                      type: 'INVENTORY_SYNC_REQUEST',
                      senderId: userRef.current.homeNodeOnion,
                      payload: { inventory: myInventory, since }
                  };
                  networkService.broadcast(packet, activePeers);
              }
          }
      });
      
      networkService.onPeerStatus = (peerOnion, status, latency) => {
          setPeers(prev => prev.map(p => {
              if (p.onionAddress === peerOnion) {
                  setContacts(currContacts => currContacts.map(c => {
                      if (c.homeNodes.includes(peerOnion)) {
                          return { ...c, status, latencyMs: latency || c.latencyMs, lastActive: Date.now() };
                      }
                      return c;
                  }));
                  
                  if (status === 'online' && p.status !== 'online') {
                      // 1. Trigger Inventory Sync on individual peer reconnect
                      const since = Date.now() - (maxSyncAgeHours * 60 * 60 * 1000);
                      const myInventory = postsRef.current
                          .filter(pt => pt.timestamp > since && pt.privacy === 'public')
                          .map(pt => ({ id: pt.id, hash: calculatePostHash(pt) })); // FRESH HASH

                      const packet: NetworkPacket = {
                          id: crypto.randomUUID(),
                          type: 'INVENTORY_SYNC_REQUEST',
                          senderId: userRef.current.homeNodeOnion,
                          payload: { inventory: myInventory, since }
                      };
                      networkService.sendMessage(peerOnion, packet);

                      // 2. Trigger Peer Announcement to the new peer if discoverable
                      if (userRef.current.isDiscoverable) {
                          const config = nodeConfigRef.current;
                          const announcePacket: NetworkPacket = {
                              id: crypto.randomUUID(),
                              hops: MAX_GOSSIP_HOPS,
                              type: 'ANNOUNCE_PEER',
                              senderId: userRef.current.homeNodeOnion,
                              payload: {
                                  onionAddress: userRef.current.homeNodeOnion,
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
  }, [maxSyncAgeHours, performGracefulShutdown]); 

  // --- ACTIONS ---

  const handleAddPeer = useCallback((onion: string) => {
      const cleanOnion = onion.trim().toLowerCase();
      if (!cleanOnion.endsWith('.onion')) {
          addNotification('Error', 'Invalid Onion Address', 'error');
          return;
      }
      setPeers(prev => {
          if (prev.some(p => p.onionAddress === cleanOnion)) return prev;
          const newPeer: NodePeer = {
              id: cleanOnion,
              onionAddress: cleanOnion,
              status: 'offline',
              latencyMs: 0,
              lastSeen: Date.now(),
              trustLevel: 'verified'
          };
          networkService.connect(cleanOnion);
          return [...prev, newPeer];
      });
      setPendingNodeRequests(prev => prev.filter(p => p !== cleanOnion));
      setDiscoveredPeers(prev => prev.filter(p => p.id !== cleanOnion));
      addNotification('Peer Added', 'Connection initiated', 'success');
  }, [addNotification]);

  const handleRemovePeer = useCallback((onion: string) => {
      setPeers(prev => prev.filter(p => p.onionAddress !== onion));
      addNotification('Peer Removed', 'Node forgotten.', 'info');
  }, [addNotification]);

  const handleBlockPeer = useCallback((onion: string) => {
      setPeers(prev => prev.filter(p => p.onionAddress !== onion));
      setPendingNodeRequests(prev => prev.filter(p => p !== onion));
      setDiscoveredPeers(prev => prev.filter(p => p.id !== onion));
      addNotification('Node Blocked', 'Requests from this node will be ignored.', 'warning');
  }, [addNotification]);

  const handleSyncPeer = useCallback((onion: string) => {
      addNotification("Syncing", `Requesting Inventory from ${onion}...`, 'info');
      // Trigger Inventory Sync for Public Posts
      const since = Date.now() - (maxSyncAgeHours * 60 * 60 * 1000);
      const myInventory = postsRef.current
          .filter(p => p.timestamp > since && p.privacy === 'public')
          .map(p => ({ id: p.id, hash: calculatePostHash(p) })); // FRESH HASH

      const packet: NetworkPacket = {
          id: crypto.randomUUID(),
          type: 'INVENTORY_SYNC_REQUEST',
          senderId: userRef.current.homeNodeOnion,
          payload: { inventory: myInventory, since }
      };
      networkService.sendMessage(onion, packet);

      // Trigger Group Sync
      networkService.sendMessage(onion, {
          id: crypto.randomUUID(),
          type: 'GROUP_QUERY',
          senderId: userRef.current.homeNodeOnion,
          payload: { requesterId: userRef.current.id }
      });
  }, [addNotification, maxSyncAgeHours]);

  const handleUpdateNodeConfig = useCallback((alias: string, description: string) => {
      setNodeConfig({ alias, description });
      addNotification('Saved', 'Node settings updated. Broadcasting...', 'success');
      const user = userRef.current;
      if (isOnline && user.isDiscoverable) {
          const packet: NetworkPacket = {
              id: crypto.randomUUID(),
              hops: MAX_GOSSIP_HOPS,
              type: 'ANNOUNCE_PEER',
              senderId: user.homeNodeOnion,
              payload: { onionAddress: user.homeNodeOnion, alias, description }
          };
          processedPacketIds.current.add(packet.id!);
          networkService.broadcast(packet, peersRef.current.map(p => p.onionAddress));
      }
  }, [isOnline, addNotification]);

  const handleAddUserContact = useCallback(async (pubKey: string, homeNode: string, name: string, encryptionKey?: string) => {
      const cleanNode = homeNode.trim().toLowerCase();
      const user = userRef.current;
      if(contactsRef.current.some(c => c.id === pubKey)) {
          if (encryptionKey) setContacts(prev => prev.map(c => c.id === pubKey ? { ...c, encryptionPublicKey: encryptionKey } : c));
          return;
      }
      const newContact: Contact = {
          id: pubKey,
          encryptionPublicKey: encryptionKey, 
          username: name.toLowerCase().replace(/\s/g, '_'),
          displayName: name,
          homeNodes: [cleanNode],
          status: 'offline',
          connectionType: 'Onion'
      };
      setContacts(prev => {
          if (prev.some(c => c.id === pubKey)) return prev;
          return [...prev, newContact];
      });
      if(!peersRef.current.some(p => p.onionAddress === cleanNode)) handleAddPeer(cleanNode);
      else networkService.connect(cleanNode);

      const reqPayload: ConnectionRequest = {
          id: crypto.randomUUID(),
          fromUserId: user.id,
          fromUsername: user.username,
          fromDisplayName: user.displayName,
          fromHomeNode: user.homeNodeOnion,
          fromEncryptionPublicKey: user.keys.encryption.publicKey,
          timestamp: Date.now()
      };
      const packet: NetworkPacket = {
          id: crypto.randomUUID(),
          type: 'CONNECTION_REQUEST',
          senderId: user.homeNodeOnion,
          targetUserId: pubKey,
          payload: reqPayload
      };
      networkService.connect(cleanNode).then(() => networkService.sendMessage(cleanNode, packet));
      addNotification('Request Sent', `Handshake sent to ${name}`, 'success');
  }, [handleAddPeer, addNotification]);

  const handleAcceptRequest = useCallback((req: ConnectionRequest) => {
      const user = userRef.current;
      setConnectionRequests(prev => prev.filter(r => r.id !== req.id));
      handleAddUserContact(req.fromUserId, req.fromHomeNode, req.fromDisplayName, req.fromEncryptionPublicKey);
      const reqPayload: ConnectionRequest = {
          id: crypto.randomUUID(),
          fromUserId: user.id,
          fromUsername: user.username,
          fromDisplayName: user.displayName,
          fromHomeNode: user.homeNodeOnion,
          fromEncryptionPublicKey: user.keys.encryption.publicKey, 
          timestamp: Date.now()
      };
      const packet: NetworkPacket = {
          id: crypto.randomUUID(),
          type: 'CONNECTION_REQUEST',
          senderId: user.homeNodeOnion,
          targetUserId: req.fromUserId,
          payload: reqPayload
      };
      networkService.sendMessage(req.fromHomeNode, packet);
  }, [handleAddUserContact]);

  const handleDeclineRequest = useCallback((reqId: string) => {
      setConnectionRequests(prev => prev.filter(r => r.id !== reqId));
  }, []);

  const handleDeleteContact = useCallback((contactId: string) => {
      const user = userRef.current;
      const contactToRemove = contactsRef.current.find(c => c.id === contactId);
      setContacts(prev => prev.filter(c => c.id !== contactId));
      setPosts(prev => prev.filter(p => !(p.authorId === contactId && p.privacy === 'friends')));
      setGroups(prevGroups => {
          return prevGroups.map(group => {
              if (group.ownerId === user.id && group.members.includes(contactId)) {
                  const updatedMembers = group.members.filter(m => m !== contactId);
                  const updatedGroup = { ...group, members: updatedMembers };
                  if (contactToRemove && contactToRemove.homeNodes[0]) {
                      networkService.sendMessage(contactToRemove.homeNodes[0], {
                          id: crypto.randomUUID(),
                          type: 'GROUP_UPDATE',
                          senderId: user.homeNodeOnion,
                          targetUserId: contactId,
                          payload: updatedGroup
                      });
                  }
                  updatedMembers.forEach(mid => {
                      if (mid === user.id) return;
                      const member = contactsRef.current.find(c => c.id === mid);
                      if (member && member.homeNodes[0]) {
                          networkService.sendMessage(member.homeNodes[0], {
                              id: crypto.randomUUID(),
                              type: 'GROUP_UPDATE',
                              senderId: user.homeNodeOnion,
                              targetUserId: mid,
                              payload: updatedGroup
                          });
                      }
                  });
                  return updatedGroup;
              }
              return group;
          });
      });
      addNotification('Contact Removed', 'Connection severed. Feed and Groups updated.', 'info');
  }, [addNotification]);

  const handleSendMessage = useCallback(async (text: string, contactId: string, isEphemeral: boolean, attachment?: string, media?: MediaMetadata, replyToId?: string, privacy: 'public' | 'connections' = 'public') => {
      const user = userRef.current;
      const msgId = crypto.randomUUID();
      const payloadObj = { content: text, media, attachment, replyToId, privacy };
      const payloadStr = JSON.stringify(payloadObj);
      const group = groupsRef.current.find(g => g.id === contactId);
      
      if (group) {
          const newMessage: Message = {
              id: msgId,
              threadId: group.id,
              senderId: user.id,
              content: text,
              timestamp: Date.now(),
              delivered: false,
              read: true,
              isMine: true,
              media, attachmentUrl: attachment, isEphemeral, replyToId, privacy
          };
          setMessages(prev => [...prev, newMessage]);
          let membersToMessage = group.members.filter(mid => mid !== user.id);
          if (privacy === 'connections') membersToMessage = membersToMessage.filter(mid => contactsRef.current.some(c => c.id === mid));
          let successCount = 0;
          for (const memberId of membersToMessage) {
              const contact = contactsRef.current.find(c => c.id === memberId);
              if (contact && contact.encryptionPublicKey && contact.homeNodes[0]) {
                  const { nonce, ciphertext } = encryptMessage(payloadStr, contact.encryptionPublicKey, user.keys.encryption.secretKey);
                  const groupEncPayload: EncryptedPayload = { id: msgId, nonce, ciphertext, groupId: group.id };
                  const packet: NetworkPacket = {
                      id: crypto.randomUUID(),
                      type: 'MESSAGE',
                      senderId: user.homeNodeOnion,
                      targetUserId: contact.id,
                      payload: groupEncPayload
                  };
                  networkService.sendMessage(contact.homeNodes[0], packet);
                  successCount++;
                  await new Promise(r => setTimeout(r, 50)); 
              }
          }
          if (successCount > 0) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, delivered: true } : m));
          else addNotification('Delivery Failed', 'No eligible members reachable.', 'warning');
          return;
      }

      const contact = contactsRef.current.find(c => c.id === contactId);
      if(!contact || !contact.encryptionPublicKey) return;
      const { nonce, ciphertext } = encryptMessage(payloadStr, contact.encryptionPublicKey, user.keys.encryption.secretKey);
      const newMsg: Message = {
          id: msgId,
          threadId: contact.id,
          senderId: user.id,
          content: text,
          timestamp: Date.now(),
          delivered: false,
          read: true,
          isMine: true,
          media, attachmentUrl: attachment, isEphemeral, replyToId
      };
      setMessages(prev => [...prev, newMsg]);
      const targetNode = contact.homeNodes[0];
      const packet: NetworkPacket = {
          id: crypto.randomUUID(),
          type: 'MESSAGE',
          senderId: user.homeNodeOnion,
          targetUserId: contact.id,
          payload: { id: msgId, nonce, ciphertext }
      };
      const success = await networkService.sendMessage(targetNode, packet);
      if(success) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, delivered: true } : m));
      else addNotification('Send Failed', 'Could not reach user home node', 'error');
  }, [addNotification]);

  const handleSendTyping = useCallback((contactId: string) => {
      const user = userRef.current;
      const contact = contactsRef.current.find(c => c.id === contactId);
      if (contact && contact.homeNodes[0]) {
            const packet: NetworkPacket = {
              id: crypto.randomUUID(),
              type: 'TYPING',
              senderId: user.homeNodeOnion,
              targetUserId: contactId,
              payload: { userId: user.id }
          };
          networkService.sendMessage(contact.homeNodes[0], packet);
      }
  }, []);

  const handleReadMessage = useCallback((contactId: string) => {
      setMessages(prev => {
          if (!prev.some(m => m.threadId === contactId && !m.isMine && !m.read)) return prev;
          return prev.map(m => (m.threadId === contactId && !m.isMine && !m.read) ? { ...m, read: true } : m);
      });
  }, []);

  const handleChatReaction = useCallback((contactId: string, messageId: string, emoji: string) => {
      const user = userRef.current;
      let action: 'add' | 'remove' = 'add';

      setMessages(prev => prev.map(m => {
          if (m.id !== messageId) return m;
          const currentReactions = { ...(m.reactions || {}) };
          if (!currentReactions[emoji]) currentReactions[emoji] = [];
          
          if (currentReactions[emoji].includes(user.id)) {
              // User already reacted, so toggle OFF
              currentReactions[emoji] = currentReactions[emoji].filter(id => id !== user.id);
              action = 'remove';
          } else {
              // User has not reacted, add
              currentReactions[emoji] = [...currentReactions[emoji], user.id];
              action = 'add';
          }
          return { ...m, reactions: currentReactions };
      }));

      // Network Logic
      const group = groupsRef.current.find(g => g.id === contactId);
      if (group) {
          group.members.filter(mid => mid !== user.id).forEach(mid => {
              const contact = contactsRef.current.find(c => c.id === mid);
              if (contact && contact.homeNodes[0]) {
                  const packet: NetworkPacket = {
                      id: crypto.randomUUID(),
                      type: 'CHAT_REACTION',
                      senderId: user.homeNodeOnion,
                      targetUserId: mid,
                      payload: { messageId, emoji, userId: user.id, action }
                  };
                  networkService.sendMessage(contact.homeNodes[0], packet);
              }
          });
      } else {
          const contact = contactsRef.current.find(c => c.id === contactId);
          if (contact && contact.homeNodes[0]) {
              const packet: NetworkPacket = {
                  id: crypto.randomUUID(),
                  type: 'CHAT_REACTION',
                  senderId: user.homeNodeOnion,
                  targetUserId: contactId,
                  payload: { messageId, emoji, userId: user.id, action }
              };
              networkService.sendMessage(contact.homeNodes[0], packet);
          }
      }
  }, []);

  const handleChatVote = useCallback((contactId: string, messageId: string, type: 'up' | 'down') => {
      const user = userRef.current;
      let action: 'add' | 'remove' = 'add';

      setMessages(prev => prev.map(m => {
          if (m.id !== messageId) return m;
          const currentVotes = { ...(m.votes || {}) };
          
          if (currentVotes[user.id] === type) {
              delete currentVotes[user.id];
              action = 'remove';
          } else {
              currentVotes[user.id] = type;
              action = 'add';
          }
          return { ...m, votes: currentVotes };
      }));

      const group = groupsRef.current.find(g => g.id === contactId);
      if (group) {
          group.members.forEach(mid => {
              if (mid === user.id) return;
              const contact = contactsRef.current.find(c => c.id === mid);
              if (contact && contact.homeNodes[0]) {
                  const packet: NetworkPacket = {
                      id: crypto.randomUUID(),
                      type: 'CHAT_VOTE',
                      senderId: user.homeNodeOnion,
                      targetUserId: mid,
                      payload: { messageId, type, userId: user.id, action }
                  };
                  networkService.sendMessage(contact.homeNodes[0], packet);
              }
          });
      } else {
          const contact = contactsRef.current.find(c => c.id === contactId);
          if (contact && contact.homeNodes[0]) {
              const packet: NetworkPacket = {
                  id: crypto.randomUUID(),
                  type: 'CHAT_VOTE',
                  senderId: user.homeNodeOnion,
                  targetUserId: contactId,
                  payload: { messageId, type, userId: user.id, action }
              };
              networkService.sendMessage(contact.homeNodes[0], packet);
          }
      }
  }, []);

  // --- SOCIAL ACTIONS (Follow/Unfollow) ---
  const handleFollowUser = useCallback((targetId: string, targetNode?: string) => {
      const user = userRef.current;
      if (user.followingIds && user.followingIds.includes(targetId)) return; // Already following

      // Update Local Profile
      const updatedUser = { 
          ...user, 
          followingIds: [...(user.followingIds || []), targetId] 
      };
      onUpdateUser(updatedUser);

      // Send Network Packet
      if (targetNode) {
          const packet: NetworkPacket = {
              id: crypto.randomUUID(),
              type: 'FOLLOW',
              senderId: user.homeNodeOnion,
              targetUserId: targetId,
              payload: { userId: user.id }
          };
          networkService.sendMessage(targetNode, packet);
      }
      
      addNotification('Following', 'You are now following this user.', 'success');
  }, [onUpdateUser, addNotification]);

  const handleUnfollowUser = useCallback((targetId: string, targetNode?: string) => {
      const user = userRef.current;
      // Update Local Profile
      const updatedUser = { 
          ...user, 
          followingIds: (user.followingIds || []).filter(id => id !== targetId) 
      };
      onUpdateUser(updatedUser);

      // Send Network Packet
      if (targetNode) {
          const packet: NetworkPacket = {
              id: crypto.randomUUID(),
              type: 'UNFOLLOW',
              senderId: user.homeNodeOnion,
              targetUserId: targetId,
              payload: { userId: user.id }
          };
          networkService.sendMessage(targetNode, packet);
      }
      addNotification('Unfollowed', 'User removed from following list.', 'info');
  }, [onUpdateUser, addNotification]);

  const handleCreateGroup = useCallback(async (name: string, memberIds: string[]) => {
      const user = userRef.current;
      const newGroup: Group = {
          id: crypto.randomUUID(),
          name,
          members: [...memberIds, user.id],
          admins: [user.id],
          ownerId: user.id,
          bannedIds: [],
          settings: { allowMemberInvite: false, allowMemberNameChange: false }, // CHANGED: Default false
          isMuted: false
      };
      setGroups(prev => [...prev, newGroup]);
      addNotification('Group Created', `"${name}" is ready. Inviting members...`, 'info', AppRoute.CHAT, newGroup.id);
      for (const mid of memberIds) {
          const contact = contactsRef.current.find(c => c.id === mid);
          if (contact && contact.homeNodes[0]) {
              const packet: NetworkPacket = {
                  id: crypto.randomUUID(),
                  type: 'GROUP_INVITE',
                  senderId: user.homeNodeOnion,
                  targetUserId: mid,
                  payload: newGroup
              };
              await networkService.sendMessage(contact.homeNodes[0], packet);
              await new Promise(r => setTimeout(r, 200));
          }
      }
      addNotification('Group Ready', 'Invites sent.', 'success');
  }, [addNotification]);

  const handleDeleteGroup = useCallback((groupId: string) => {
      const group = groupsRef.current.find(g => g.id === groupId);
      setGroups(prev => prev.filter(g => g.id !== groupId));
      const user = userRef.current;
      if (group) {
          group.members.forEach(mid => {
              if (mid === user.id) return;
              const contact = contactsRef.current.find(c => c.id === mid);
              if (contact && contact.homeNodes[0]) {
                  const packet: NetworkPacket = {
                      id: crypto.randomUUID(),
                      type: 'GROUP_DELETE',
                      senderId: user.homeNodeOnion,
                      targetUserId: mid,
                      payload: { groupId }
                  };
                  networkService.sendMessage(contact.homeNodes[0], packet);
              }
          });
      }
  }, []);

  const handleLeaveGroup = useCallback((groupId: string) => {
      const user = userRef.current;
      const group = groupsRef.current.find(g => g.id === groupId);
      if (!group) return;
      if (group.ownerId === user.id) {
          addNotification('Action Denied', 'Owners cannot leave. Delete the group instead.', 'error');
          return;
      }
      setGroups(prev => prev.filter(g => g.id !== groupId));
      if (group) {
          const updatedMembers = group.members.filter(m => m !== user.id);
          const updatedGroup = { ...group, members: updatedMembers };
          updatedMembers.forEach(mid => {
              const contact = contactsRef.current.find(c => c.id === mid);
              if (contact && contact.homeNodes[0]) {
                  const packet: NetworkPacket = {
                      id: crypto.randomUUID(),
                      type: 'GROUP_UPDATE',
                      senderId: user.homeNodeOnion,
                      targetUserId: mid,
                      payload: updatedGroup
                  };
                  networkService.sendMessage(contact.homeNodes[0], packet);
              }
          });
      }
  }, [addNotification]);

  const handleUpdateGroup = useCallback((updatedGroup: Group) => {
      setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
      const user = userRef.current;
      updatedGroup.members.forEach(mid => {
          if (mid === user.id) return;
          const contact = contactsRef.current.find(c => c.id === mid);
          if (contact && contact.homeNodes[0]) {
              const packet: NetworkPacket = {
                  id: crypto.randomUUID(),
                  type: 'GROUP_UPDATE',
                  senderId: user.homeNodeOnion,
                  targetUserId: mid,
                  payload: updatedGroup
                  };
                  networkService.sendMessage(contact.homeNodes[0], packet);
              }
          });
  }, []);

  const handleAddMemberToGroup = useCallback((groupId: string, contactId: string) => {
      const group = groupsRef.current.find(g => g.id === groupId);
      const user = userRef.current;
      if (group && !group.members.includes(contactId)) {
          const updatedGroup = { ...group, members: [...group.members, contactId] };
          setGroups(prev => prev.map(g => g.id === groupId ? updatedGroup : g));
          const newMember = contactsRef.current.find(c => c.id === contactId);
          if (newMember && newMember.homeNodes[0]) {
              const packet: NetworkPacket = {
                  id: crypto.randomUUID(),
                  type: 'GROUP_INVITE',
                  senderId: user.homeNodeOnion,
                  targetUserId: contactId,
                  payload: updatedGroup
              };
              networkService.sendMessage(newMember.homeNodes[0], packet);
          }
          group.members.forEach(mid => {
              if (mid === user.id) return;
              const contact = contactsRef.current.find(c => c.id === mid);
              if (contact && contact.homeNodes[0]) {
                  const packet: NetworkPacket = {
                      id: crypto.randomUUID(),
                      type: 'GROUP_UPDATE',
                      senderId: user.homeNodeOnion,
                      targetUserId: mid,
                      payload: updatedGroup
                  };
                  networkService.sendMessage(contact.homeNodes[0], packet);
              }
          });
      }
  }, []);

  const handleToggleGroupMute = useCallback((groupId: string) => {
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, isMuted: !g.isMuted } : g));
  }, []);

  const handlePost = useCallback((post: Post) => {
      const contentHash = calculatePostHash(post);
      const postWithHash = { ...post, contentHash };
      setPosts(prev => [postWithHash, ...prev]);
      if (post.privacy === 'public') {
          // New: Also trigger announce to ensure immediate propagation
          broadcastPostState(postWithHash);
      } else if (post.privacy === 'friends') {
          const targetNodes = new Set<string>();
          contactsRef.current.forEach(c => { if (c.homeNodes[0]) targetNodes.add(c.homeNodes[0]); });
          targetNodes.forEach(onion => {
              const packet: NetworkPacket = {
                  id: crypto.randomUUID(),
                  type: 'POST',
                  senderId: userRef.current.homeNodeOnion,
                  payload: post
              };
              networkService.sendMessage(onion, packet);
          });
      }
  }, [broadcastPostState]);

  const handleEditPost = useCallback((postId: string, newContent: string) => {
      let updatedPost: Post | null = null;
      setPosts(prev => prev.map(p => {
          if (p.id === postId) {
              updatedPost = { ...p, content: newContent, isEdited: true, contentHash: calculatePostHash({...p, content: newContent, isEdited: true}) };
              return updatedPost;
          }
          return p;
      }));
      
      if (updatedPost) {
          if ((updatedPost as Post).privacy === 'public') {
              broadcastPostState(updatedPost);
          } else {
              const packet: NetworkPacket = {
                  id: crypto.randomUUID(),
                  hops: MAX_GOSSIP_HOPS,
                  type: 'EDIT_POST',
                  senderId: userRef.current.homeNodeOnion,
                  payload: { postId, newContent }
              };
              processedPacketIds.current.add(packet.id!);
              networkService.broadcast(packet, peersRef.current.map(p => p.onionAddress));
          }
      }
  }, [broadcastPostState]);

  const handleDeletePost = useCallback((postId: string) => {
      setPosts(prev => prev.filter(p => p.id !== postId));
      const packet: NetworkPacket = {
          id: crypto.randomUUID(),
          hops: MAX_GOSSIP_HOPS,
          type: 'DELETE_POST',
          senderId: userRef.current.homeNodeOnion,
          payload: { postId }
      };
      processedPacketIds.current.add(packet.id!);
      networkService.broadcast(packet, peersRef.current.map(p => p.onionAddress));
  }, []);

  const handleComment = useCallback((postId: string, content: string, parentCommentId?: string) => {
      const user = userRef.current;
      const newComment = { id: crypto.randomUUID(), authorId: user.id, authorName: user.displayName, content, timestamp: Date.now(), votes: {}, reactions: {}, replies: [] };
      let updatedPostForBroadcast: Post | null = null;

      setPosts(prev => prev.map(post => {
          if (post.id !== postId) return post;
          let updatedPost = post;
          if (!parentCommentId) {
              updatedPost = { ...post, comments: post.comments + 1, commentsList: [...post.commentsList, newComment] };
          } else {
              updatedPost = { ...post, comments: post.comments + 1, commentsList: appendReply(post.commentsList, parentCommentId, newComment) };
          }
          // Recalculate hash because state changed
          updatedPost.contentHash = calculatePostHash(updatedPost);
          updatedPostForBroadcast = updatedPost;
          return updatedPost;
      }));
      
      // 1. Send the specific comment packet
      const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'COMMENT', senderId: user.homeNodeOnion, payload: { postId, comment: newComment, parentCommentId } };
      processedPacketIds.current.add(packet.id!);
      networkService.broadcast(packet, peersRef.current.map(p => p.onionAddress));

      // 2. Broadcast the NEW STATE (Sync Reinforcement)
      if (updatedPostForBroadcast) broadcastPostState(updatedPostForBroadcast);
  }, [broadcastPostState]);

  const handleVote = useCallback((postId: string, type: 'up' | 'down') => {
      const user = userRef.current;
      let updatedPostForBroadcast: Post | null = null;
      setPosts(prev => prev.map(post => {
          if (post.id !== postId) return post;
          const updatedPost = { ...post, votes: { ...post.votes, [user.id]: type } };
          updatedPost.contentHash = calculatePostHash(updatedPost);
          updatedPostForBroadcast = updatedPost;
          return updatedPost;
      }));
      const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'VOTE', senderId: user.homeNodeOnion, payload: { postId, userId: user.id, type } };
      processedPacketIds.current.add(packet.id!);
      networkService.broadcast(packet, peersRef.current.map(p => p.onionAddress));
      if (updatedPostForBroadcast) broadcastPostState(updatedPostForBroadcast);
  }, [broadcastPostState]);

  const handlePostReaction = useCallback((postId: string, emoji: string) => {
      const user = userRef.current;
      let updatedPostForBroadcast: Post | null = null;
      setPosts(prev => prev.map(p => {
          if (p.id !== postId) return p;
          const currentReactions = { ...(p.reactions || {}) };
          if (!currentReactions[emoji]) currentReactions[emoji] = [];
          if (!currentReactions[emoji].includes(user.id)) currentReactions[emoji] = [...currentReactions[emoji], user.id];
          const updatedPost = { ...p, reactions: currentReactions };
          updatedPost.contentHash = calculatePostHash(updatedPost);
          updatedPostForBroadcast = updatedPost;
          return updatedPost;
      }));
      const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'REACTION', senderId: user.homeNodeOnion, payload: { postId, userId: user.id, emoji } };
      processedPacketIds.current.add(packet.id!);
      networkService.broadcast(packet, peersRef.current.map(p => p.onionAddress));
      if (updatedPostForBroadcast) broadcastPostState(updatedPostForBroadcast);
  }, [broadcastPostState]);

  const handleCommentVote = useCallback((postId: string, commentId: string, type: 'up' | 'down') => {
      const user = userRef.current;
      let updatedPostForBroadcast: Post | null = null;
      setPosts(prev => prev.map(p => {
          if (p.id !== postId) return p;
          const updatedPost = { ...p, commentsList: updateCommentTree(p.commentsList, commentId, (c) => ({ ...c, votes: { ...c.votes, [user.id]: type } })) };
          updatedPost.contentHash = calculatePostHash(updatedPost);
          updatedPostForBroadcast = updatedPost;
          return updatedPost;
      }));
      const packet: NetworkPacket = { id: crypto.randomUUID(), hops: MAX_GOSSIP_HOPS, type: 'COMMENT_VOTE', senderId: user.homeNodeOnion, payload: { postId, commentId, userId: user.id, type } };
      processedPacketIds.current.add(packet.id!);
      networkService.broadcast(packet, peersRef.current.map(p => p.onionAddress));
      if (updatedPostForBroadcast) broadcastPostState(updatedPostForBroadcast);
  }, [broadcastPostState]);

  const handleCommentReaction = useCallback((postId: string, commentId: string, emoji: string) => {
      const user = userRef.current;
      let updatedPostForBroadcast: Post | null = null;
      setPosts(prev => prev.map(p => {
          if (p.id !== postId) return p;
          const updatedPost = { ...p, commentsList: updateCommentTree(p.commentsList, commentId, (c) => {
                  const currentReactions = { ...(c.reactions || {}) };
                  if (!currentReactions[emoji]) currentReactions[emoji] = [];
                  if (!currentReactions[emoji].includes(user.id)) currentReactions[emoji] = [...currentReactions[emoji], user.id];
                  return { ...c, reactions: currentReactions };
              })
          };
          updatedPost.contentHash = calculatePostHash(updatedPost);
          updatedPostForBroadcast = updatedPost;
          return updatedPost;
      }));
      const packet: NetworkPacket = { 
          id: crypto.randomUUID(), 
          hops: MAX_GOSSIP_HOPS, 
          type: 'COMMENT_REACTION', 
          senderId: user.homeNodeOnion, 
          payload: { postId, commentId, userId: user.id, emoji }
      };
      processedPacketIds.current.add(packet.id!);
      networkService.broadcast(packet, peersRef.current.map(p => p.onionAddress));
      if (updatedPostForBroadcast) broadcastPostState(updatedPostForBroadcast);
  }, [broadcastPostState]);

  const handleExportKeys = useCallback(() => {
      const user = userRef.current;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(user.keys));
      const dlAnchor = document.createElement('a');
      dlAnchor.setAttribute("href", dataStr);
      dlAnchor.setAttribute("download", `gchat_keys_${user.username}.json`);
      document.body.appendChild(dlAnchor);
      dlAnchor.click();
      dlAnchor.remove();
      addNotification('Keys Exported', 'Keep this file safe!', 'success');
  }, [addNotification]);

  // --- NEW: VIEW USER POSTS NAVIGATION ---
  const handleViewUserPosts = useCallback((userId: string) => {
      setFeedInitialState({ filter: 'public', authorId: userId });
      handleNavigate(AppRoute.FEED);
      addNotification('Navigation', 'Switched to Public Feed for user.', 'info');
  }, [addNotification, handleNavigate]);

  return (
      <Layout 
          activeRoute={activeRoute} 
          onNavigate={handleNavigate} 
          onToggleHelp={() => setIsHelpOpen(!isHelpOpen)}
          onLogout={onLogout}
          onOpenProfile={() => setShowUserModal(true)}
          user={user}
          isOnline={isOnline}
          chatUnreadCount={chatUnread}
          contactsUnreadCount={contactsUnread}
          feedUnreadCount={feedUnread}
          settingsUnreadCount={settingsUnread}
      >
          {activeRoute === AppRoute.FEED && (
              <Feed 
                  posts={posts}
                  contacts={contacts}
                  user={user}
                  onPost={handlePost}
                  onLike={(id) => handleVote(id, 'up')}
                  onDislike={(id) => handleVote(id, 'down')}
                  onComment={handleComment}
                  onCommentVote={handleCommentVote}
                  onCommentReaction={handleCommentReaction}
                  onPostReaction={handlePostReaction}
                  onShare={() => {}}
                  onNavigateToChat={(id) => { setActiveChatId(id); handleNavigate(AppRoute.CHAT); }}
                  onDeletePost={handleDeletePost}
                  onEditPost={handleEditPost}
                  onGlobalSync={handleGlobalSync}
                  onFollowUser={handleFollowUser}
                  onUnfollowUser={handleUnfollowUser}
                  onConnectUser={(t) => handleAddUserContact(t.id, t.homeNode || '', t.displayName)}
                  onViewUserPosts={handleViewUserPosts}
                  addToast={addNotification}
                  isOnline={isOnline}
                  initialState={feedInitialState}
                  onConsumeInitialState={() => setFeedInitialState(null)}
              />
          )}

          {activeRoute === AppRoute.CHAT && (
              <Chat 
                  contacts={contacts}
                  groups={groups}
                  messages={messages}
                  activeChatId={activeChatId}
                  user={user}
                  isOnline={isOnline}
                  addToast={addNotification}
                  onSendMessage={handleSendMessage}
                  onSendTyping={handleSendTyping}
                  onReadMessage={handleReadMessage}
                  onClearHistory={(id) => { setMessages(prev => prev.filter(m => m.threadId !== id)); }}
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
                  posts={posts}
              />
          )}

          {activeRoute === AppRoute.CONTACTS && (
              <Contacts 
                  currentUser={user}
                  contacts={contacts}
                  requests={connectionRequests}
                  onAcceptRequest={handleAcceptRequest}
                  onDeclineRequest={handleDeclineRequest}
                  onAddContact={(pub, node, name) => handleAddUserContact(pub, node, name)}
                  onDeleteContact={handleDeleteContact}
                  addToast={addNotification}
                  onNavigateToChat={(id) => { setActiveChatId(id); handleNavigate(AppRoute.CHAT); }}
                  onFollowUser={handleFollowUser}
                  onUnfollowUser={handleUnfollowUser}
                  onViewUserPosts={handleViewUserPosts}
                  posts={posts}
              />
          )}

          {activeRoute === AppRoute.NODE_SETTINGS && (
              <NodeSettings 
                  user={user}
                  peers={peers}
                  pendingPeers={pendingNodeRequests}
                  discoveredPeers={discoveredPeers}
                  nodeConfig={nodeConfig}
                  isOnline={isOnline}
                  userStats={userStats}
                  onAddPeer={handleAddPeer}
                  onRemovePeer={handleRemovePeer}
                  onBlockPeer={handleBlockPeer}
                  onSyncPeer={handleSyncPeer}
                  onUpdateNodeConfig={handleUpdateNodeConfig}
                  onToggleNetwork={() => { if(isOnline) networkService.disconnect(); else networkService.init(user.id); }}
                  onUpdateProfile={onUpdateUser}
                  onExportKeys={handleExportKeys}
                  addToast={addNotification}
                  onSetSyncAge={setMaxSyncAgeHours}
                  currentSyncAge={maxSyncAgeHours}
                  data={{ posts, messages, contacts }}
              />
          )}

          {activeRoute === AppRoute.NOTIFICATIONS && (
              <Notifications
                  notifications={notifications}
                  onClear={handleClearNotifications}
                  onMarkRead={handleMarkNotificationsRead}
                  onNotificationClick={handleNotificationClick}
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
                      followersCount: user.followersCount
                  }}
                  currentUser={user}
                  isContact={false}
                  isFollowing={false}
                  onClose={() => setShowUserModal(false)}
                  onConnect={() => {}}
                  onFollow={() => {}}
                  onUnfollow={() => {}}
                  onMessage={() => {}}
                  onViewPosts={handleViewUserPosts}
                  onLogout={onLogout}
                  onShutdown={performGracefulShutdown}
                  posts={posts}
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

const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(() => {
    const stored = localStorage.getItem(USER_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  });

  const handleLogout = () => {
    if(confirm("Log out? This will clear local session keys from memory.")) {
        setUser(null);
    }
  };

  const handleUpdateUser = (updated: UserProfile) => {
      setUser(updated);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updated));
  };

  if (!user) {
    return <Onboarding onComplete={(u) => {
        setUser(u);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(u));
    }} />;
  }

  return <AuthenticatedApp user={user} onLogout={handleLogout} onUpdateUser={handleUpdateUser} />;
};

export default App;
