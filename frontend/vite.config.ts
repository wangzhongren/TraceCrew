import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: path.resolve(__dirname, '..', 'electron', 'main.ts'),
        // onstart disabled — no auto restart on file change
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              external: ['electron', 'better-sqlite3', 'express', 'cors', 'openai', 'dotenv'],
            },
          },
        },
      },
      {
        entry: path.resolve(__dirname, '..', 'electron', 'preload.ts'),
        // onstart disabled — no auto reload on file change
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              output: { entryFileNames: 'preload.mjs' },
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  server: {
    port: 5173,
    hmr: true,
    proxy: {
      '/api': {
        target: 'http://localhost:19850',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Disable buffering for SSE streaming endpoints
            if (req.url?.includes('/stream') || req.url?.includes('/sse')) {
              proxyReq.setHeader('Connection', 'keep-alive');
            }
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            // Force flush headers for SSE — prevents proxy buffering
            if (req.url?.includes('/stream') || req.url?.includes('/sse')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
              proxyRes.headers['connection'] = 'keep-alive';
            }
          });
        },
      },
    },
  },
});
