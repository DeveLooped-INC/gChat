import { UserKeys } from './services/cryptoService';

export interface LogEntry {
  timestamp: number;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  area: 'BACKEND' | 'FRONTEND' | 'TOR' | 'CRYPTO' | 'NETWORK';
  message: string;
  details?: any;
}

export interface NodeIdentity {
  onionAddress: string;
  isReady: boolean;
}

export interface PrivacySettings {
  isPrivateProfile: boolean; // If true, only contacts see details
  showBioPublicly: boolean;
  showFollowersPublicly: boolean;
}

export interface MediaSettings {
  enabled: boolean; // Master switch
  maxFileSizeMB: number; // 0 - 1024
  autoDownloadFriends: boolean; // Friends-only broadcasts
  autoDownloadPrivate: boolean; // Private chats/DMs
  cacheRelayedMedia: boolean; // If true, save media proxied for others. Default: false.
}

export interface ContentSettings {
  showDownvotedPosts: boolean; // Default: false
  downvoteThreshold: number; // Default: -1 (Net Score)
}

export interface UserProfile {
  id: string; // Public Key derived from Seed (Signing)
  username: string;
  displayName: string;
  bio: string;
  avatarUrl?: string;
  keys: UserKeys; // Derived from Seed
  isAdmin: boolean; // Controls access to Node Settings
  homeNodeOnion: string; // The address of the node this user lives on
  createdAt: number;
  isDiscoverable?: boolean;

  // Social Graph
  followersCount: number;
  followingIds: string[];

  // Privacy
  privacySettings: PrivacySettings;
}

// Represents a Node we are connected to via Tor (Mesh)
export interface NodePeer {
  id: string; // Onion Address
  onionAddress: string;
  alias?: string;
  status: 'online' | 'offline';
  latencyMs: number;
  lastSeen: number;
  trustLevel: 'verified' | 'blocked' | 'pending';
}

// Represents a Human User we chat with
export interface Contact {
  id: string; // User Public Key (Signing)
  encryptionPublicKey?: string; // X25519 Public Key for Messages
  username: string;
  displayName: string;
  homeNodes: string[]; // List of onion addresses where this user can be found
  avatarUrl?: string;
  bio?: string;
  status: 'online' | 'offline';
  lastActive?: number;
  connectionType?: string;
  latencyMs?: number;
  handshakeStatus?: 'pending' | 'completed';
}

export interface AvailablePeer {
  id: string;
  displayName: string;
  username: string;
  viaPeerId: string;
  hops: number;
  lastSeen: number;
}

export interface ConnectionRequest {
  id: string;
  fromUserId: string;
  fromUsername: string;
  fromDisplayName: string;
  fromHomeNode: string;
  fromEncryptionPublicKey?: string; // Essential for Chat
  timestamp: number;
  signature?: string; // SIGNED IDENTITY for anti-spoofing
}

export interface GroupSettings {
  allowMemberInvite: boolean;
  allowMemberNameChange: boolean;
}

export interface Group {
  id: string;
  name: string;
  members: string[]; // List of User IDs
  admins: string[];
  ownerId: string;
  bannedIds: string[];
  settings: GroupSettings;
  isMuted?: boolean;
}

export interface MediaMetadata {
  id: string;
  type: 'audio' | 'video' | 'file';
  mimeType: string;
  size: number;
  duration: number;
  chunkCount: number;
  thumbnail?: string;
  isSavable?: boolean;
  accessKey?: string;
  filename?: string;
  originNode?: string; // Hint for where to find the media (Onion Address)
  ownerId?: string; // The User ID (Public Key) of the media owner
}

export interface NetworkPacket {
  id?: string; // UUID for deduplication
  hops?: number; // TTL for gossip
  type: 'MESSAGE' | 'POST' | 'HANDSHAKE' | 'USER_HANDSHAKE' | 'IDENTITY_UPDATE' | 'SYNC_REQUEST' | 'SYNC_RESPONSE' | 'VOTE' | 'COMMENT' | 'COMMENT_VOTE' | 'COMMENT_REACTION' | 'TYPING' | 'READ_RECEIPT' | 'GROUP_INVITE' | 'DELETE_POST' | 'EDIT_POST' | 'GROUP_UPDATE' | 'GROUP_DELETE' | 'MEDIA_REQUEST' | 'MEDIA_CHUNK' | 'PEER_EXCHANGE' | 'REACTION' | 'CHAT_REACTION' | 'CHAT_VOTE' | 'ANNOUNCE_PEER' | 'RELAY_PACKET' | 'CONNECTION_REQUEST' | 'NODE_DELETED' | 'USER_DELETED' | 'CONTENT_ORPHANED' | 'MEDIA_RECOVERY_REQUEST' | 'MEDIA_RECOVERY_FOUND' | 'ROUTED_USER_PACKET' | 'USER_EXIT' | 'USER_EXIT_ACK' | 'NODE_SHUTDOWN' | 'GROUP_QUERY' | 'GROUP_SYNC' | 'GLOBAL_SYNC_REQUEST' | 'INVENTORY_ANNOUNCE' | 'FETCH_POST' | 'POST_DATA' | 'INVENTORY_SYNC_REQUEST' | 'INVENTORY_SYNC_RESPONSE' | 'FOLLOW' | 'UNFOLLOW' | 'MEDIA_RELAY_REQUEST';
  payload: any;
  signature?: string;
  senderId: string; // Onion Address of the sending NODE
  targetUserId?: string; // If destined for a specific user on this node
}

export interface EncryptedPayload {
  id: string;
  nonce: string;
  ciphertext: string;
  groupId?: string;
}

export interface Message {
  id: string;
  threadId: string; // User ID or Group ID
  senderId: string; // User ID
  content: string;
  timestamp: number;
  delivered: boolean;
  read: boolean;
  isMine: boolean;
  isEphemeral?: boolean;
  privacy?: 'public' | 'connections'; // For Groups: Public (All members) vs Connections (Only friends)
  replyToId?: string;
  attachmentUrl?: string;
  attachmentType?: 'image' | 'file';
  media?: MediaMetadata;
  reactions?: Record<string, string[]>;
  votes?: Record<string, 'up' | 'down'>;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  timestamp: number;
  votes: Record<string, 'up' | 'down'>;
  reactions: Record<string, string[]>;
  replies: Comment[];
}

export interface Post {
  id: string;
  authorId: string; // User ID
  authorName: string;
  authorAvatar?: string;
  authorPublicKey: string; // Signing Key
  originNode?: string; // The onion address of the node that originally hosted this post
  content: string;
  contentHash?: string; // SHA3 Hash of content + media + timestamp to track edits/version
  imageUrl?: string;
  media?: MediaMetadata;
  timestamp: number;
  votes: Record<string, 'up' | 'down'>;
  shares: number;
  comments: number;
  commentsList: Comment[];
  truthHash: string;
  privacy: 'public' | 'friends' | 'private';
  isEdited?: boolean;
  location?: string;
  hashtags?: string[];
  reactions?: Record<string, string[]>;
  isOrphaned?: boolean;
  orphanedAt?: number;
  isSaved?: boolean;
  sharedPostId?: string; // ID of the original post if this is a share
  sharedPostSnapshot?: { // Snapshot of the original post for display if local lookup fails
    authorName: string;
    content: string;
    imageUrl?: string;
    media?: MediaMetadata;
    timestamp: number;
    originNode?: string; // Onion Address of the original author/uploader
  };
}

export interface StorageStats {
  category: string;
  sizeMB: number;
  color: string;
}

export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
  category?: NotificationCategory;
  action?: () => void;
}

export type NotificationCategory = 'admin' | 'social' | 'chat';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
  category: NotificationCategory;
  timestamp: number;
  read: boolean;
  linkRoute?: AppRoute;
  linkId?: string;
}

export enum AppRoute {
  ONBOARDING = 'onboarding',
  FEED = 'feed',
  CHAT = 'chat',
  CONTACTS = 'contacts', // User Contacts
  NODE_SETTINGS = 'node_settings', // Admin Only Settings
  NOTIFICATIONS = 'notifications'
}

export interface TorStats {
  circuits: number;
  guards: number;
  status: string;
  bootstrap?: number;
  readBytes?: number;
  writeBytes?: number;
}
