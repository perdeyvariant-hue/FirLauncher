import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri expects a fixed port and must not have its output cleared.
const host = process.env['TAURI_DEV_HOST'];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Bind IPv4 explicitly. Vite's default `localhost` binds only to ::1 on
    // Windows, and the Tauri CLI polls 127.0.0.1 — it would wait forever.
    host: host ?? '127.0.0.1',
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      // src-tauri is watched by cargo, not vite.
      ignored: ['**/src-tauri/**'],
    },
  },
  // Tauri ships a modern webview on every platform we target.
  build: {
    target: process.env['TAURI_ENV_PLATFORM'] === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env['TAURI_ENV_DEBUG'] ? false : 'esbuild',
    sourcemap: Boolean(process.env['TAURI_ENV_DEBUG']),
    chunkSizeWarningLimit: 1200,
  },
});
