import { describe, it, expect } from 'vitest';
import { Post } from '../types';
import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    toBase32,
    formatUserIdentity,
    formatBytes,
    formatDuration,
    getTransferConfig,
    calculateObjectSize,
    calculatePostHash,
} from '../utils';

// ---------- arrayBufferToBase64 / base64ToArrayBuffer ----------

describe('arrayBufferToBase64 & base64ToArrayBuffer', () => {
    it('round-trips a simple buffer', () => {
        const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        const b64 = arrayBufferToBase64(original.buffer);
        expect(typeof b64).toBe('string');

        const decoded = new Uint8Array(base64ToArrayBuffer(b64));
        expect(decoded).toEqual(original);
    });

    it('round-trips an empty buffer', () => {
        const original = new Uint8Array([]);
        const b64 = arrayBufferToBase64(original.buffer);
        const decoded = new Uint8Array(base64ToArrayBuffer(b64));
        expect(decoded).toEqual(original);
    });

    it('handles binary data correctly', () => {
        const original = new Uint8Array([0, 127, 128, 255]);
        const b64 = arrayBufferToBase64(original.buffer);
        const decoded = new Uint8Array(base64ToArrayBuffer(b64));
        expect(decoded).toEqual(original);
    });
});

// ---------- toBase32 ----------

describe('toBase32', () => {
    it('encodes known value correctly', () => {
        // "f" → "my" in RFC 4648 lowercase base32
        const input = new Uint8Array([102]);
        expect(toBase32(input)).toBe('my');
    });

    it('handles empty input', () => {
        expect(toBase32(new Uint8Array([]))).toBe('');
    });

    it('produces only valid base32 characters', () => {
        const input = new Uint8Array([0, 255, 128, 64, 32]);
        const result = toBase32(input);
        expect(result).toMatch(/^[a-z2-7]*$/);
    });
});

// ---------- formatUserIdentity ----------

describe('formatUserIdentity', () => {
    it('splits handle and suffix when dot-separated', () => {
        const result = formatUserIdentity('alice.abc123');
        expect(result.handle).toBe('alice');
        expect(result.suffix).toBe('.abc123');
    });

    it('handles multiple dots by splitting on the last one', () => {
        const result = formatUserIdentity('alice.bob.xyz');
        expect(result.handle).toBe('alice.bob');
        expect(result.suffix).toBe('.xyz');
    });

    it('returns null suffix when there is no dot', () => {
        const result = formatUserIdentity('alice');
        expect(result.handle).toBe('alice');
        expect(result.suffix).toBeNull();
    });
});

// ---------- formatBytes ----------

describe('formatBytes', () => {
    it('returns "0 Bytes" for zero', () => {
        expect(formatBytes(0)).toBe('0 Bytes');
    });

    it('formats bytes correctly', () => {
        expect(formatBytes(500)).toBe('500 Bytes');
    });

    it('formats KB', () => {
        expect(formatBytes(1024)).toBe('1 KB');
    });

    it('formats MB', () => {
        expect(formatBytes(1048576)).toBe('1 MB');
    });

    it('formats with custom decimals', () => {
        expect(formatBytes(1536, 1)).toBe('1.5 KB');
    });
});

// ---------- formatDuration ----------

describe('formatDuration', () => {
    it('formats zero seconds', () => {
        expect(formatDuration(0)).toBe('0:00');
    });

    it('formats seconds with leading zero', () => {
        expect(formatDuration(5)).toBe('0:05');
    });

    it('formats minutes and seconds', () => {
        expect(formatDuration(125)).toBe('2:05');
    });

    it('handles exact minute boundaries', () => {
        expect(formatDuration(60)).toBe('1:00');
    });
});

// ---------- getTransferConfig ----------

describe('getTransferConfig', () => {
    it('returns a config object with chunkSize and concurrency', () => {
        const config = getTransferConfig(1000000);
        expect(config).toHaveProperty('chunkSize');
        expect(config).toHaveProperty('concurrency');
        expect(config.chunkSize).toBeGreaterThan(0);
        expect(config.concurrency).toBeGreaterThan(0);
    });
});

// ---------- calculateObjectSize ----------

describe('calculateObjectSize', () => {
    it('returns byte size of a JSON-serialized object', () => {
        const size = calculateObjectSize({ a: 1 });
        expect(size).toBe(new TextEncoder().encode(JSON.stringify({ a: 1 })).length);
    });

    it('handles empty object', () => {
        expect(calculateObjectSize({})).toBe(2); // "{}"
    });

    it('handles arrays', () => {
        const size = calculateObjectSize([1, 2, 3]);
        expect(size).toBe(new TextEncoder().encode('[1,2,3]').length);
    });
});

// ---------- calculatePostHash ----------

describe('calculatePostHash', () => {
    const basePost = {
        id: 'post-1',
        content: 'Hello world',
        authorId: 'author-1',
        timestamp: 1700000000000,
        votes: {},
        reactions: {},
        commentsList: [],
    } as unknown as Post;

    it('produces a deterministic hash', () => {
        const hash1 = calculatePostHash(basePost);
        const hash2 = calculatePostHash(basePost);
        expect(hash1).toBe(hash2);
    });

    it('produces a hex string', () => {
        const hash = calculatePostHash(basePost);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('changes when content changes', () => {
        const modified = { ...basePost, content: 'Different content' } as Post;
        expect(calculatePostHash(basePost)).not.toBe(calculatePostHash(modified));
    });

    it('changes when votes change', () => {
        const withVote = { ...basePost, votes: { user1: 1 } } as unknown as Post;
        expect(calculatePostHash(basePost)).not.toBe(calculatePostHash(withVote));
    });

    it('changes when comments change', () => {
        const withComment = {
            ...basePost,
            commentsList: [{ id: 'c1', timestamp: 1, content: 'hi', authorId: 'a1', replies: [] }]
        } as unknown as Post;
        expect(calculatePostHash(basePost)).not.toBe(calculatePostHash(withComment));
    });

    it('is consistent regardless of vote key insertion order', () => {
        const postA = { ...basePost, votes: { a: 1, b: -1 } } as unknown as Post;
        const postB = { ...basePost, votes: { b: -1, a: 1 } } as unknown as Post;
        expect(calculatePostHash(postA)).toBe(calculatePostHash(postB));
    });
});
