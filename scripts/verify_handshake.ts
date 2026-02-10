import { generateKeys, signData, verifySignature } from '../services/cryptoService';
import { ConnectionRequest } from '../types';
import * as crypto from 'crypto';

// Polyfill for randomUUID if not available in this node env (unlikely but safe)
if (!globalThis.crypto) {
    // @ts-ignore
    globalThis.crypto = { randomUUID: () => crypto.randomUUID() };
}

console.log("=== STARTING HANDSHAKE VERIFICATION ===");

// 1. SETUP
console.log("\n[1] Generating Identities...");
const alice = generateKeys();
const bob = generateKeys();
console.log(`Alice ID: ${alice.signing.publicKey.substring(0, 10)}...`);
console.log(`Bob ID:   ${bob.signing.publicKey.substring(0, 10)}...`);

// 2. CREATE REQUEST
console.log("\n[2] Creating Connection Request (Alice -> Bob)...");
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
console.log("\n[3] Alice Signs Request...");
reqPayload.signature = signData(reqPayload, alice.signing.secretKey);
console.log(`Signature: ${reqPayload.signature.substring(0, 20)}...`);

// 4. VERIFY (GOOD CASE)
console.log("\n[4] Bob Verifies Alice's Request (Expect: PASS)...");
const { signature, ...dataToVerify } = reqPayload;
const isValid = verifySignature(dataToVerify, signature!, reqPayload.fromUserId);

if (isValid) {
    console.log("✅ SUCCESS: Signature Validified Correctly.");
} else {
    console.error("❌ FAILURE: Valid signature rejected.");
    process.exit(1);
}

// 5. TAMPERING (BAD CASE 1: Modified Payload)
console.log("\n[5] Attacker modifies Payload (Man-in-the-Middle)...");
const tamperedPayload = { ...reqPayload, fromEncryptionPublicKey: 'attacker_key' };
// Signature is still Alice's original signature

const { signature: sig2, ...dataTampered } = tamperedPayload;
const isTamperedValid = verifySignature(dataTampered, sig2!, tamperedPayload.fromUserId);

if (!isTamperedValid) {
    console.log("✅ SUCCESS: Tampered payload rejected.");
} else {
    console.error("❌ FAILURE: Tampered payload was accepted!");
    process.exit(1);
}

// 6. SPOOFING (BAD CASE 2: Wrong Key)
console.log("\n[6] Attacker signs as Alice (Spoofing)...");
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

if (!isSpoofValid) {
    console.log("✅ SUCCESS: Spoofed signature rejected.");
} else {
    console.error("❌ FAILURE: Spoofed signature accepted!");
    process.exit(1);
}

console.log("\n=== VERIFICATION COMPLETE: ALL TESTS PASSED ===");
