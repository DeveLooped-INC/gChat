import { describe, it, expect } from 'vitest';
import { generateKeys, signData, verifySignature } from '../services/cryptoService';
import { ConnectionRequest } from '../types';
import * as crypto from 'crypto';

// Polyfill for randomUUID if not available in this node env (unlikely but safe)
if (!globalThis.crypto) {
    (globalThis as any).crypto = { randomUUID: () => crypto.randomUUID() };
}

describe('Handshake Verification', () => {
    it('should correctly sign, verify, and reject tampered/spoofed requests', () => {
        // 1. SETUP
        const alice = generateKeys();
        const bob = generateKeys();

        // 2. CREATE REQUEST
        const reqPayload: ConnectionRequest = {
            id: crypto.randomUUID(),
            fromUserId: alice.signing.publicKey, // This is the ID
            fromUsername: 'alice',
            fromDisplayName: 'Alice Wonderland',
            fromHomeNode: 'alice.onion',
            fromEncryptionPublicKey: alice.encryption.publicKey,
            timestamp: Date.now()
        };

        // 3. SIGN REQUEST
        reqPayload.signature = signData(reqPayload, alice.signing.secretKey);

        // 4. VERIFY (GOOD CASE)
        const { signature, ...dataToVerify } = reqPayload;
        const isValid = verifySignature(dataToVerify, signature!, reqPayload.fromUserId);
        expect(isValid).toBe(true);

        // 5. TAMPERING (BAD CASE 1: Modified Payload)
        const tamperedPayload = { ...reqPayload, fromEncryptionPublicKey: 'attacker_key' };
        // Signature is still Alice's original signature

        const { signature: sig2, ...dataTampered } = tamperedPayload;
        const isTamperedValid = verifySignature(dataTampered, sig2!, tamperedPayload.fromUserId);
        expect(isTamperedValid).toBe(false);

        // 6. SPOOFING (BAD CASE 2: Wrong Key)
        const attacker = generateKeys();
        const spoofPayload: ConnectionRequest = {
            id: crypto.randomUUID(),
            fromUserId: alice.signing.publicKey, // Claiming to be Alice
            fromUsername: 'alice',
            fromDisplayName: 'Alice Wonderland',
            fromHomeNode: 'attacker.onion',
            fromEncryptionPublicKey: attacker.encryption.publicKey,
            timestamp: Date.now()
        };

        // Attacker signs with THEIR key, but claims to be Alice
        spoofPayload.signature = signData(spoofPayload, attacker.signing.secretKey);

        const { signature: sig3, ...dataSpoof } = spoofPayload;
        // Bob verifies against Alice's ID (Public Key)
        const isSpoofValid = verifySignature(dataSpoof, sig3!, spoofPayload.fromUserId);
        expect(isSpoofValid).toBe(false);
    });
});
