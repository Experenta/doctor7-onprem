import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the client talks to `/api` and `/ws` on the Vite origin. Vite
// forwards both to the local API. In production Apache does the same.
// The Host header is kept (no changeOrigin) so the API origin check for the
// chat handshake sees the same host in Origin and Host.
const API_TARGET = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: API_TARGET,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    css: false,
  },
});
