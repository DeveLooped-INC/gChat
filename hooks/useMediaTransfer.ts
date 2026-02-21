import { useCallback } from 'react';
import { MediaMetadata, AppRoute } from '../types';
import { networkService } from '../services/networkService';
import { hasMedia, saveMedia } from '../services/mediaStorage';

export const useMediaTransfer = (state: any) => {

    const checkAndAutoDownload = useCallback(async (url: string | undefined, media: MediaMetadata | undefined, context: 'friends' | 'private', authorId: string, peerId: string) => {
        if (!state.mediaSettings.enabled) return;
        if (!url && !media) return;
        if (url && url.startsWith('data:')) return;

        const { autoDownloadFriends, autoDownloadPrivate, maxFileSizeMB } = state.mediaSettings;

        // Context Check
        if (context === 'friends') {
            if (!autoDownloadFriends) return;
            const isFollowed = state.userRef.current.followingIds?.includes(authorId);
            const isConnection = state.contactsRef.current.some((c: any) => c.id === authorId);
            if (!isFollowed && !isConnection) return;
        }
        if (context === 'private' && !autoDownloadPrivate) return;

        const maxBytes = maxFileSizeMB * 1024 * 1024;

        try {
            if (media) {
                if (media.size > maxBytes || await hasMedia(media.id)) return;
                console.log(`[AutoDownload] Mesh Download for ${media.id}`);
                // Fire and forget
                networkService.downloadMedia(peerId, media, () => { });
                return;
            }

            if (url) {
                const mediaId = url.split('/').pop();
                if (mediaId && await hasMedia(mediaId)) return;

                const headRes = await fetch(url, { method: 'HEAD' });
                if (!headRes.ok) return;
                const size = parseInt(headRes.headers.get('content-length') || '0');

                if (size > 0 && size <= maxBytes) {
                    const res = await fetch(url);
                    const blob = await res.blob();
                    if (mediaId) await saveMedia(mediaId, blob, undefined, true);
                }
            }
        } catch (e) {
            console.error("[AutoDownload] Failed", e);
        }
    }, [state.mediaSettings, state.userRef, state.contactsRef]);

    return {
        checkAndAutoDownload
    };
};
