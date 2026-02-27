import { describe, it, expect } from 'vitest';
import {
    createPostPayload,
    updateCommentTree,
    findCommentInTree,
    appendReply,
    mergePosts,
} from '../utils/dataHelpers';
import { Comment, Post } from '../types';

// ---------- Helper Factories ----------

const makeComment = (overrides: Partial<Comment> = {}): Comment => ({
    id: 'c1',
    authorId: 'author1',
    authorName: 'Test Author',
    content: 'Test comment',
    timestamp: 1700000000000,
    votes: {},
    reactions: {},
    replies: [],
    ...overrides,
} as Comment);

const makePost = (overrides: Partial<Post> = {}): Post => ({
    id: 'p1',
    authorId: 'author1',
    content: 'Test post',
    timestamp: 1700000000000,
    votes: {},
    reactions: {},
    comments: 0,
    commentsList: [],
    hashtags: [],
    location: '',
    ...overrides,
} as Post);

// ---------- createPostPayload ----------

describe('createPostPayload', () => {
    it('normalizes imageUrl to null when undefined', () => {
        const payload = createPostPayload({
            authorId: 'a1',
            content: 'hello',
            timestamp: 1000,
        });
        expect(payload.imageUrl).toBeNull();
    });

    it('preserves imageUrl when provided', () => {
        const payload = createPostPayload({
            authorId: 'a1',
            content: 'hello',
            timestamp: 1000,
            imageUrl: 'data:image/png;base64,abc',
        });
        expect(payload.imageUrl).toBe('data:image/png;base64,abc');
    });

    it('normalizes empty strings to empty values', () => {
        const payload = createPostPayload({
            authorId: 'a1',
            content: 'hello',
            timestamp: 1000,
            location: '',
            hashtags: [],
        });
        expect(payload.location).toBe('');
        expect(payload.hashtags).toEqual([]);
    });
});

// ---------- updateCommentTree ----------

describe('updateCommentTree', () => {
    it('updates a top-level comment', () => {
        const comments = [makeComment({ id: 'c1', content: 'old' })];
        const result = updateCommentTree(comments, 'c1', c => ({ ...c, content: 'new' }));
        expect(result[0].content).toBe('new');
    });

    it('updates a nested reply', () => {
        const comments = [
            makeComment({
                id: 'c1',
                replies: [makeComment({ id: 'c2', content: 'old reply' })],
            }),
        ];
        const result = updateCommentTree(comments, 'c2', c => ({ ...c, content: 'new reply' }));
        expect(result[0].replies![0].content).toBe('new reply');
    });

    it('leaves unmatched comments unchanged', () => {
        const comments = [makeComment({ id: 'c1', content: 'keep' })];
        const result = updateCommentTree(comments, 'c999', c => ({ ...c, content: 'changed' }));
        expect(result[0].content).toBe('keep');
    });
});

// ---------- findCommentInTree ----------

describe('findCommentInTree', () => {
    it('finds a top-level comment', () => {
        const comments = [makeComment({ id: 'c1' })];
        expect(findCommentInTree(comments, 'c1')).toBeDefined();
    });

    it('finds a deeply nested reply', () => {
        const comments = [
            makeComment({
                id: 'c1',
                replies: [
                    makeComment({
                        id: 'c2',
                        replies: [makeComment({ id: 'c3' })],
                    }),
                ],
            }),
        ];
        expect(findCommentInTree(comments, 'c3')).toBeDefined();
        expect(findCommentInTree(comments, 'c3')!.id).toBe('c3');
    });

    it('returns undefined for missing comment', () => {
        const comments = [makeComment({ id: 'c1' })];
        expect(findCommentInTree(comments, 'c999')).toBeUndefined();
    });
});

// ---------- appendReply ----------

describe('appendReply', () => {
    it('appends a reply to the correct parent', () => {
        const parent = makeComment({ id: 'c1', replies: [] });
        const reply = makeComment({ id: 'r1', content: 'reply' });
        const result = appendReply([parent], 'c1', reply);
        expect(result[0].replies).toHaveLength(1);
        expect(result[0].replies![0].id).toBe('r1');
    });

    it('is idempotent — does not duplicate replies', () => {
        const reply = makeComment({ id: 'r1' });
        const parent = makeComment({ id: 'c1', replies: [reply] });
        const result = appendReply([parent], 'c1', reply);
        expect(result[0].replies).toHaveLength(1);
    });

    it('appends to nested parent', () => {
        const nested = makeComment({ id: 'c2', replies: [] });
        const top = makeComment({ id: 'c1', replies: [nested] });
        const reply = makeComment({ id: 'r1' });
        const result = appendReply([top], 'c2', reply);
        expect(result[0].replies![0].replies).toHaveLength(1);
    });
});

// ---------- mergePosts ----------

describe('mergePosts', () => {
    it('merges votes from both posts', () => {
        const local = makePost({ votes: { alice: 'up' } });
        const incoming = makePost({ votes: { bob: 'down' } });
        const result = mergePosts(local, incoming);
        expect(result.votes).toEqual({ alice: 'up', bob: 'down' });
    });

    it('incoming votes override local on conflict', () => {
        const local = makePost({ votes: { alice: 'up' } });
        const incoming = makePost({ votes: { alice: 'down' } });
        const result = mergePosts(local, incoming);
        expect(result.votes.alice).toBe('down');
    });

    it('merges reactions with unique user IDs', () => {
        const local = makePost({ reactions: { '❤️': ['alice'] } });
        const incoming = makePost({ reactions: { '❤️': ['bob', 'alice'] } });
        const result = mergePosts(local, incoming);
        expect(result.reactions['❤️']).toHaveLength(2);
        expect(result.reactions['❤️']).toContain('alice');
        expect(result.reactions['❤️']).toContain('bob');
    });

    it('merges comments by union', () => {
        const localComment = makeComment({ id: 'c1' });
        const incomingComment = makeComment({ id: 'c2' });
        const local = makePost({ commentsList: [localComment] });
        const incoming = makePost({ commentsList: [incomingComment] });
        const result = mergePosts(local, incoming);
        expect(result.commentsList).toHaveLength(2);
    });

    it('updates comment count after merge', () => {
        const local = makePost({ commentsList: [makeComment({ id: 'c1' })] });
        const incoming = makePost({ commentsList: [makeComment({ id: 'c2' })] });
        const result = mergePosts(local, incoming);
        expect(result.comments).toBe(2);
    });
});
