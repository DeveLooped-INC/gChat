// System Constants
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // Bumped to 10MB limit for local handling
export const MAX_ATTACHMENT_SIZE_MB = 10;

// Dynamic Chunk Sizing is now handled via getDynamicChunkSize in utils.ts
export const MAX_CHAT_MEDIA_DURATION = 180; // 3 minutes
export const MAX_POST_MEDIA_DURATION = 600; // 10 minutes

export const SYSTEM_NODE_ID = 'system-000';
export const SYSTEM_USER_NAME = 'gchat_system';
export const SYSTEM_DISPLAY_NAME = 'gChat System';

// --- Timeouts & Intervals ---
export const MESSAGE_RETRY_INTERVAL_MS = 15000;
export const HANDSHAKE_RETRY_INTERVAL_MS = 30000;
export const GC_INTERVAL_MS = 10000;
export const TYPING_TIMEOUT_MS = 3000;
export const LOGS_REFRESH_INTERVAL_MS = 1000;
export const SCROLL_TIMEOUT_MS = 30000;
export const COPY_FEEDBACK_MS = 2000;
export const RECONNECT_INTERVAL_MS = 5000;
export const TOAST_DURATION_MS = 5000;
export const INITIAL_LOAD_DELAY_MS = 3000;
