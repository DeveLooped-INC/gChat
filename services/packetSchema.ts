import { z } from 'zod';

// --- PRIMITIVES ---
const Hash = z.string().min(1);
const OnionAddress = z.string().regex(/^[a-z2-7]{56}\.onion$/, "Invalid Onion v3 Address").or(z.string().regex(/^[a-z2-7]{16}\.onion$/, "Invalid Onion v2 Address")).or(z.literal('offline')).or(z.literal('localhost')); // Allow 'offline' for initial state
const UUID = z.string().uuid().or(z.string().min(10)); // Allow non-UUID IDs if legacy
const Timestamp = z.number();

// --- SHARED TYPES ---
export const MediaMetadataSchema = z.object({
    id: z.string(),
    type: z.enum(['audio', 'video', 'file', 'image']),
    mimeType: z.string(),
    size: z.number(),
    duration: z.number().optional(),
    chunkCount: z.number().optional(),
    thumbnail: z.string().optional(),
    isSavable: z.boolean().optional(),
    accessKey: z.string().optional(),
    filename: z.string().optional(),
    originNode: z.string().optional(),
    ownerId: z.string().optional()
});

const EncryptedPayloadSchema = z.object({
    id: z.string(),
    nonce: z.string(),
    ciphertext: z.string(),
    groupId: z.string().optional()
});

const UserProfilePayloadSchema = z.object({
    userId: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().optional(),
    bio: z.string().optional()
});

const ConnectionRequestPayloadSchema = z.object({
    id: z.string(),
    fromUserId: z.string(),
    fromUsername: z.string(),
    fromDisplayName: z.string(),
    fromHomeNode: z.string(),
    fromEncryptionPublicKey: z.string().optional(),
    timestamp: z.number(),
    signature: z.string().optional()
});

const CommentSchema = z.object({
    id: z.string(),
    authorId: z.string(),
    authorName: z.string(),
    authorAvatar: z.string().optional(),
    content: z.string(),
    timestamp: z.number(),
    votes: z.record(z.string(), z.enum(['up', 'down'])).optional(),
    reactions: z.record(z.string(), z.array(z.string())).optional()
    // Recurisve replies not fully validated deep to prevent recursion limits, treated as any[] or simplified
}).passthrough();

const PostSchema = z.object({
    id: z.string(),
    authorId: z.string(),
    authorName: z.string(),
    authorAvatar: z.string().optional(),
    authorPublicKey: z.string(),
    originNode: z.string().optional(),
    content: z.string(),
    contentHash: z.string().optional(),
    imageUrl: z.string().optional(),
    media: MediaMetadataSchema.optional(),
    timestamp: z.number(),
    votes: z.record(z.string(), z.enum(['up', 'down'])).optional(),
    shares: z.number().optional(),
    comments: z.number().optional(),
    commentsList: z.array(z.any()).optional(), // Loose validation for comments to avoid recursion issues
    truthHash: z.string().optional(),
    privacy: z.enum(['public', 'friends', 'private']),
    isEdited: z.boolean().optional(),
    location: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    reactions: z.record(z.string(), z.array(z.string())).optional(),
    isOrphaned: z.boolean().optional(),
    orphanedAt: z.number().optional(),
    isSaved: z.boolean().optional(),
    sharedPostId: z.string().optional(),
    sharedPostSnapshot: z.object({
        authorName: z.string(),
        content: z.string(),
        imageUrl: z.string().optional(),
        media: MediaMetadataSchema.optional(),
        timestamp: z.number(),
        originNode: z.string().optional()
    }).optional()
});

const GroupSchema = z.object({
    id: z.string(),
    name: z.string(),
    members: z.array(z.string()),
    admins: z.array(z.string()),
    ownerId: z.string(),
    bannedIds: z.array(z.string()).optional(),
    settings: z.object({
        allowMemberInvite: z.boolean(),
        allowMemberNameChange: z.boolean()
    }).optional(),
    isMuted: z.boolean().optional()
});

// --- PACKETS ---

const BasePacket = z.object({
    id: z.string().optional(),
    hops: z.number().optional(),
    senderId: z.string(), // We don't enforce Onion regex strictness here to allow 'localhost' or IPs in dev
    targetUserId: z.string().optional(),
    signature: z.string().optional()
});

// We define specific schemas for each type
const PacketTypes = {
    // 1. MESSAGING
    MESSAGE: BasePacket.extend({
        type: z.literal('MESSAGE'),
        payload: EncryptedPayloadSchema
    }),

    // 2. SOCIAL STREAM
    POST: BasePacket.extend({
        type: z.literal('POST'),
        payload: PostSchema
    }),
    EDIT_POST: BasePacket.extend({
        type: z.literal('EDIT_POST'),
        payload: z.object({ postId: z.string(), newContent: z.string() })
    }),
    DELETE_POST: BasePacket.extend({
        type: z.literal('DELETE_POST'),
        payload: z.object({ postId: z.string() })
    }),

    // 3. INTERACTIONS
    VOTE: BasePacket.extend({
        type: z.literal('VOTE'),
        payload: z.object({ postId: z.string(), userId: z.string(), type: z.enum(['up', 'down']) })
    }),
    COMMENT: BasePacket.extend({
        type: z.literal('COMMENT'),
        payload: z.object({ postId: z.string(), comment: CommentSchema, parentCommentId: z.string().optional() })
    }),
    COMMENT_VOTE: BasePacket.extend({
        type: z.literal('COMMENT_VOTE'),
        payload: z.object({ postId: z.string(), commentId: z.string(), userId: z.string(), type: z.enum(['up', 'down']) })
    }),
    COMMENT_REACTION: BasePacket.extend({
        type: z.literal('COMMENT_REACTION'),
        payload: z.object({ postId: z.string(), commentId: z.string(), userId: z.string(), emoji: z.string(), action: z.enum(['add', 'remove']) })
    }),
    REACTION: BasePacket.extend({
        type: z.literal('REACTION'),
        payload: z.object({ postId: z.string(), userId: z.string(), emoji: z.string(), action: z.enum(['add', 'remove']) })
    }),
    CHAT_REACTION: BasePacket.extend({
        type: z.literal('CHAT_REACTION'),
        payload: z.object({ messageId: z.string(), userId: z.string(), emoji: z.string(), action: z.enum(['add', 'remove']) })
    }),
    CHAT_VOTE: BasePacket.extend({
        type: z.literal('CHAT_VOTE'),
        payload: z.object({ messageId: z.string(), userId: z.string(), type: z.enum(['up', 'down']), action: z.enum(['add', 'remove']) })
    }),

    // 4. IDENTITY & CONNECTION
    CONNECTION_REQUEST: BasePacket.extend({
        type: z.literal('CONNECTION_REQUEST'),
        payload: ConnectionRequestPayloadSchema
    }),
    IDENTITY_UPDATE: BasePacket.extend({
        type: z.literal('IDENTITY_UPDATE'),
        payload: UserProfilePayloadSchema
    }),
    ANNOUNCE_PEER: BasePacket.extend({
        type: z.literal('ANNOUNCE_PEER'),
        payload: z.object({ onionAddress: z.string(), alias: z.string().optional(), description: z.string().optional() })
    }),
    FOLLOW: BasePacket.extend({
        type: z.literal('FOLLOW'),
        payload: z.object({ userId: z.string() })
    }),
    UNFOLLOW: BasePacket.extend({
        type: z.literal('UNFOLLOW'),
        payload: z.object({ userId: z.string() })
    }),

    // 5. GROUPS
    GROUP_INVITE: BasePacket.extend({
        type: z.literal('GROUP_INVITE'),
        payload: GroupSchema
    }),
    GROUP_UPDATE: BasePacket.extend({
        type: z.literal('GROUP_UPDATE'),
        payload: GroupSchema
    }),
    GROUP_DELETE: BasePacket.extend({
        type: z.literal('GROUP_DELETE'),
        payload: z.object({ groupId: z.string() })
    }),
    GROUP_QUERY: BasePacket.extend({
        type: z.literal('GROUP_QUERY'),
        payload: z.object({ requesterId: z.string() })
    }),
    GROUP_SYNC: BasePacket.extend({
        type: z.literal('GROUP_SYNC'),
        payload: z.object({ groups: z.array(GroupSchema) })
    }),

    // 6. SYNC / ACKS
    TYPING: BasePacket.extend({
        type: z.literal('TYPING'),
        payload: z.object({ userId: z.string() })
    }),
    READ_RECEIPT: BasePacket.extend({
        type: z.literal('READ_RECEIPT'),
        payload: z.object({ messageId: z.string(), userId: z.string() })
    }),
    INVENTORY_SYNC_REQUEST: BasePacket.extend({
        type: z.literal('INVENTORY_SYNC_REQUEST'),
        payload: z.object({
            inventory: z.array(z.object({ id: z.string(), hash: z.string() })),
            since: z.number()
        })
    }),
    INVENTORY_SYNC_RESPONSE: BasePacket.extend({
        type: z.literal('INVENTORY_SYNC_RESPONSE'),
        payload: z.object({
            posts: z.array(PostSchema)
        })
    }),

    // 7. MEDIA RELAY (The Complex Ones)
    MEDIA_RELAY_REQUEST: BasePacket.extend({
        type: z.literal('MEDIA_RELAY_REQUEST'),
        payload: z.object({
            mediaId: z.string(),
            originNode: z.string(),
            targetNode: z.string(), // The FINAL destination (Alice)
            requesterId: z.string(), // Example: Alice's ID
            signature: z.string(),
            accessKey: z.string().optional()
        })
    }),
    MEDIA_REQUEST: BasePacket.extend({
        type: z.literal('MEDIA_REQUEST'),
        payload: z.object({ mediaId: z.string(), chunkIndex: z.number(), chunkSize: z.number(), accessKey: z.string().optional() })
    }),
    MEDIA_CHUNK: BasePacket.extend({
        type: z.literal('MEDIA_CHUNK'),
        payload: z.object({ mediaId: z.string(), chunkIndex: z.number(), totalChunks: z.number(), data: z.string() }) // Base64 data
    }),

    // 8. SHUTDOWN / EXIT
    USER_EXIT: BasePacket.extend({
        type: z.literal('USER_EXIT'),
        payload: z.object({ userId: z.string() })
    }),
    NODE_SHUTDOWN: BasePacket.extend({
        type: z.literal('NODE_SHUTDOWN'),
        payload: z.object({ reason: z.string().optional() })
    }),

    // CATCH-ALL (Allowed but strict on structure)
    // We use a discriminated union for the main export
};

// Construct the Union
export const NetworkPacketSchema = z.discriminatedUnion('type', [
    PacketTypes.MESSAGE,
    PacketTypes.POST,
    PacketTypes.EDIT_POST,
    PacketTypes.DELETE_POST,
    PacketTypes.VOTE,
    PacketTypes.COMMENT,
    PacketTypes.COMMENT_VOTE,
    PacketTypes.COMMENT_REACTION,
    PacketTypes.REACTION,
    PacketTypes.CHAT_REACTION,
    PacketTypes.CHAT_VOTE,
    PacketTypes.CONNECTION_REQUEST,
    PacketTypes.IDENTITY_UPDATE,
    PacketTypes.ANNOUNCE_PEER,
    PacketTypes.FOLLOW,
    PacketTypes.UNFOLLOW,
    PacketTypes.GROUP_INVITE,
    PacketTypes.GROUP_UPDATE,
    PacketTypes.GROUP_DELETE,
    PacketTypes.GROUP_QUERY,
    PacketTypes.GROUP_SYNC,
    PacketTypes.TYPING,
    PacketTypes.READ_RECEIPT,
    PacketTypes.INVENTORY_SYNC_REQUEST,
    PacketTypes.INVENTORY_SYNC_RESPONSE,
    PacketTypes.MEDIA_RELAY_REQUEST,
    PacketTypes.MEDIA_REQUEST,
    PacketTypes.MEDIA_CHUNK,
    PacketTypes.USER_EXIT,
    PacketTypes.NODE_SHUTDOWN
]);

export type ValidNetworkPacket = z.infer<typeof NetworkPacketSchema>;
