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
        if (post.privacy === 'public') {
            // Use POST packet (Push Model) for immediate propagation
            const packet: NetworkPacket = {
                id: crypto.randomUUID(),
                type: 'POST',
                hops: MAX_GOSSIP_HOPS,
                senderId: state.userRef.current.homeNodeOnion,
                payload: post
            };
            networkService.broadcast(packet, state.peersRef.current.map((p: any) => p.onionAddress));
        } else if (post.privacy === 'friends') {
            // Send to confirmed friends only
            const friends = state.contactsRef.current
                .filter((c: any) => c.isFriend && c.homeNodes && c.homeNodes.length > 0)
                .map((c: any) => c.homeNodes[0]);

            if (friends.length > 0) {
                const packet: NetworkPacket = {
                    id: crypto.randomUUID(),
                    type: 'POST',
                    hops: 0, // Direct send only, do not gossip
                    senderId: state.userRef.current.homeNodeOnion,
                    payload: post
                };
                networkService.log('INFO', 'NETWORK', `Broadcasting Friends-Only Post to ${friends.length} friends.`);
                networkService.broadcast(packet, friends);
            }
        }
    }, [state.userRef, state.peersRef, state.contactsRef]);

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

            // Debug POST Routing
            if (packet.type === 'POST') {
                // networkService.log('DEBUG', 'NETWORK', `[DaisyChain] Check ${addr}: Source=${isSource}, Origin=${isOrigin}, Self=${isSelf}`);
            }

            return !isSource && !isOrigin && !isSelf;
        });

        if (possibleRecipients.length > 0) {
            networkService.log('DEBUG', 'NETWORK', `DaisyChaining ${packet.type} to ${possibleRecipients.length} peers`, possibleRecipients);
            networkService.broadcast(nextPacket, possibleRecipients);
        } else {
            if (packet.type === 'POST') {
                networkService.log('DEBUG', 'NETWORK', `DaisyChain End: No valid recipients for ${packet.type} (Hops: ${currentHops}). Source: ${sourceNodeId}, Sender: ${packet.senderId}`);
            }
        }
    }, [state.peersRef, state.contactsRef, state.userRef]);

    return {
        broadcastPostState,
        daisyChainPacket
    };
};
