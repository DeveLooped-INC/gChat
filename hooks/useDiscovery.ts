import { useState, useRef, useCallback, useEffect } from 'react';
import { NetworkPacket, UserProfile, NodePeer, AppRoute } from '../types';
import { networkService } from '../services/networkService';

interface UseDiscoveryProps {
    user: UserProfile;
    state: any; // Typed as ReturnType<typeof useAppState> in real usage, using any to avoid circular dep issues in extraction
    addNotification: (title: string, message: string, type: any, category?: any, linkRoute?: any, linkId?: string) => void;
    onUpdateUser: (u: UserProfile) => void;
}

export const useDiscovery = ({ user, state, addNotification, onUpdateUser }: UseDiscoveryProps) => {
    const [discoveredPeers, setDiscoveredPeers] = useState<any[]>([]); // Typed properly in implementation
    const [pendingNodeRequests, setPendingNodeRequests] = useState<string[]>([]);

    // Sync Trusted Peers
    const lastSyncedIdsRef = useRef<string>('');

    // Sync Trusted Peers (Deduplicated)
    useEffect(() => {
        if (!state.isLoaded) return;
        const trustedIds = state.contacts.flatMap((c: any) => c.homeNodes || []).filter((addr: string) => addr.endsWith('.onion')).sort();
        const idsString = JSON.stringify(trustedIds);

        if (lastSyncedIdsRef.current !== idsString) {
            networkService.syncTrustedPeers(trustedIds);
            lastSyncedIdsRef.current = idsString;
        }
    }, [state.contacts, state.isLoaded]);

    const handleDiscoveryPacket = useCallback((packet: NetworkPacket, senderNodeId: string, isReplay: boolean, daisyChain: (p: NetworkPacket, s?: string) => void) => {
        if (packet.type === 'ANNOUNCE_PEER') {
            const info = packet.payload;
            if (info && info.onionAddress) {
                const existingPeer = state.peersRef.current.find((p: any) => p.onionAddress === info.onionAddress);
                const isKnownContact = state.contactsRef.current.some((c: any) => c.homeNodes?.includes(info.onionAddress));

                if (existingPeer || isKnownContact) {
                    if (existingPeer) {
                        state.setPeers((prev: any[]) => prev.map(p =>
                            p.onionAddress === info.onionAddress
                                ? { ...p, alias: info.alias || p.alias, status: 'online', lastSeen: Date.now() }
                                : p
                        ));
                    }
                    setDiscoveredPeers(prev => prev.filter(p => p.id !== info.onionAddress));
                } else {
                    setDiscoveredPeers(prev => {
                        const existing = prev.find(p => p.id === info.onionAddress);
                        if (existing) {
                            return prev.map(p => p.id === info.onionAddress ? { ...p, lastSeen: Date.now(), hops: 6 - (packet.hops || 0) } : p);
                        }
                        return [...prev, {
                            id: info.onionAddress,
                            displayName: info.alias || 'Unknown Node',
                            username: info.description || 'Discovered via Mesh',
                            viaPeerId: senderNodeId,
                            hops: 6 - (packet.hops || 0),
                            lastSeen: Date.now()
                        }];
                    });
                }
                if (!isReplay) daisyChain(packet, senderNodeId);
            }
        }
    }, [state.peersRef, state.contactsRef]);

    return {
        discoveredPeers,
        setDiscoveredPeers,
        pendingNodeRequests,
        setPendingNodeRequests,
        handleDiscoveryPacket
    };
};
