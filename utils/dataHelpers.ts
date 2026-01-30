
import { Post, Comment, MediaMetadata } from '../types';

// Standardize payload creation for both signing and verification
// This ensures fields like 'media' and 'imageUrl' are treated consistently (null vs undefined)
export const createPostPayload = (post: { 
    authorId: string; 
    content: string; 
    imageUrl?: string | null; 
    media?: MediaMetadata; 
    timestamp: number;
    location?: string;
    hashtags?: string[];
}) => ({
    authorId: post.authorId,
    content: post.content,
    // Strict null check: Ensure we output null if it's falsy, to match how it might be deserialized
    imageUrl: post.imageUrl || null, 
    // Media is undefined if not present. JSON.stringify removes undefined keys.
    media: post.media || undefined,
    timestamp: post.timestamp,
    location: post.location || "",
    hashtags: post.hashtags || []
});

// Helper to recursively update comments
export const updateCommentTree = (comments: Comment[], targetId: string, updater: (c: Comment) => Comment): Comment[] => {
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
export const findCommentInTree = (comments: Comment[], targetId: string): Comment | undefined => {
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
export const appendReply = (comments: Comment[], parentId: string, newComment: Comment): Comment[] => {
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
export const mergePosts = (local: Post, incoming: Post): Post => {
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
    return {
        ...local, // Keep local ephemeral props if any
        ...incoming, // Apply content updates
        comments: uniqueComments.length,
        commentsList: uniqueComments,
        votes: mergedVotes,
        reactions: mergedReactions
    };
};
