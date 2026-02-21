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
    // --- PERIODIC INVENTORY SYNC ---
    const performSync = useCallback(() => {
        if (!state.isLoaded) return;
        // Sync with all peers (trusted contacts + direct peers)
        const contactNodes = state.contactsRef.current.flatMap((c: any) => c.homeNodes || []).filter((addr: string) => addr.endsWith('.onion'));
        const peerAddrs = state.peersRef.current.map((p: any) => p.onionAddress);
        const allRecipients = Array.from(new Set([...contactNodes, ...peerAddrs])).filter(addr => addr !== user.homeNodeOnion);

        if (allRecipients.length === 0) return;

        // maxSyncAgeHours is not defined in the provided context, assuming it's available or a placeholder
        const maxSyncAgeHours = 24; // Placeholder, replace with actual value if available
        // Post and calculatePostHash are not defined in the provided context, assuming they are available or placeholders
        type Post = any; // Placeholder
        const calculatePostHash = (p: Post) => 'hash'; // Placeholder

        const since = Date.now() - (maxSyncAgeHours * 60 * 60 * 1000);
        networkService.log('INFO', 'NETWORK', `Performing Inventory Sync with ${allRecipients.length} peers`);

        const packet: NetworkPacket = {
            id: crypto.randomUUID(), type: 'INVENTORY_SYNC_REQUEST', senderId: user.homeNodeOnion,
            payload: {
                since,
                inventory: state.postsRef.current.filter((p: Post) => p.timestamp > since && p.privacy === 'public').map((p: Post) => ({ id: p.id, hash: calculatePostHash(p) })),
                requestDiscoveredPeers: true,
                senderIdentity: { username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, bio: user.bio }
            }
        };
        networkService.broadcast(packet, allRecipients as string[]).catch(console.error);

        // Group sync query
        const groupPacket: NetworkPacket = { id: crypto.randomUUID(), type: 'GROUP_QUERY', senderId: user.homeNodeOnion, payload: { requesterId: user.id } };
        networkService.broadcast(groupPacket, allRecipients as string[]).catch(console.error);

    }, [state.isLoaded, state.contactsRef, state.peersRef, state.postsRef, user]); // Added maxSyncAgeHours as a dependency if it were a prop/state

    useEffect(() => {
        if (state.isLoaded) {
            performSync(); // Run immediately on load!
        }
        const interval = setInterval(performSync, 3600000); // And then every hour
        return () => clearInterval(interval);
    }, [state.isLoaded, performSync]);

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
