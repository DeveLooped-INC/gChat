
// System Constants
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // Bumped to 10MB limit for local handling
export const MAX_ATTACHMENT_SIZE_MB = 10;

// Dynamic Chunk Sizing is now handled via getDynamicChunkSize in utils.ts
export const MAX_CHAT_MEDIA_DURATION = 180; // 3 minutes
export const MAX_POST_MEDIA_DURATION = 600; // 10 minutes

export const SYSTEM_NODE_ID = 'system-000';
export const SYSTEM_USER_NAME = 'gchat_system';
export const SYSTEM_DISPLAY_NAME = 'gChat System';
