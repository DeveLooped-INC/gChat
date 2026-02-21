/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on all network interfaces for LAN accessibility
    port: 3000,
    strictPort: true, // Critical: Fail if port 3000 is taken. Do not auto-increment to 3001+. 
    // Auto-incrementing creates a new LocalStorage origin, causing "Data Loss" illusion.
    open: true // Automatically opens default browser
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['**/*.test.{ts,tsx}'],
    setupFiles: [],
  }
});
