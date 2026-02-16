import { useCallback } from 'react';
import { NetworkPacket, Post, AppRoute } from '../types';
import { networkService } from '../services/networkService';
import { calculatePostHash } from '../utils';
import { verifySignature } from '../services/cryptoService';
import { createPostPayload, mergePosts } from '../utils/dataHelpers';
import { storageService } from '../services/storage';

const MAX_GOSSIP_HOPS = 6;

export const useGossipProtocol = (state: any, currentUser: any, addNotification: any) => {

    const broadcastPostState = useCallback((post: Post) => {
        if (post.privacy !== 'public') return;
        const hash = calculatePostHash(post);
        const packet: NetworkPacket = {
            id: crypto.randomUUID(),
            type: 'INVENTORY_ANNOUNCE',
            hops: MAX_GOSSIP_HOPS,
            senderId: state.userRef.current.homeNodeOnion,
            payload: { postId: post.id, contentHash: hash, authorId: post.authorId, timestamp: post.timestamp }
        };
        networkService.broadcast(packet, state.peersRef.current.map((p: any) => p.onionAddress));
    }, [state.userRef, state.peersRef]);

    const daisyChainPacket = useCallback(async (packet: NetworkPacket, sourceNodeId?: string) => {
        const currentHops = packet.hops || 0;
        if (currentHops <= 0) return;

        const safePayload = { ...packet.payload };
        if (safePayload.originNode) delete safePayload.originNode;
        if (safePayload.media && safePayload.media.originNode) delete safePayload.media.originNode;

        const nextPacket = { ...packet, payload: safePayload, hops: currentHops - 1 };

        const allConnectedPeers = state.peersRef.current.map((p: any) => p.onionAddress);
        const contactNodes = state.contactsRef.current.flatMap((c: any) => c.homeNodes || []).filter((addr: string) => addr.endsWith('.onion'));
        const allPotentialNodes = new Set([...allConnectedPeers, ...contactNodes]);
        const trustedOnionAddresses = Array.from(allPotentialNodes);

        const possibleRecipients = trustedOnionAddresses.filter(addr => {
            const isSource = addr === sourceNodeId;
            const isOrigin = addr === packet.senderId;
            const isSelf = addr === state.userRef.current.homeNodeOnion;
            return !isSource && !isOrigin && !isSelf;
        });

        if (possibleRecipients.length > 0) {
            networkService.broadcast(nextPacket, possibleRecipients);
        }
    }, [state.peersRef, state.contactsRef, state.userRef]);

    return {
        broadcastPostState,
        daisyChainPacket
    };
};
