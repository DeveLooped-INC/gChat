/**
 * Safe clipboard copy that works in non-secure contexts (HTTP over LAN).
 * Falls back to textarea + execCommand when navigator.clipboard is unavailable.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
    // Preferred: Clipboard API (secure contexts only)
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to fallback
        }
    }

    // Fallback: textarea + execCommand (works in non-secure contexts)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        return true;
    } catch {
        return false;
    } finally {
        document.body.removeChild(ta);
    }
};
