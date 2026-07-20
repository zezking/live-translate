import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Self-signed cert shared with the v2 server (repo-root /cert) so the dev
// server can serve HTTPS on the LAN — required for getUserMedia on mobile.
const certDir = path.resolve(__dirname, '..', 'cert');
const hasCert = (() => {
  try {
    readFileSync(path.join(certDir, 'key.pem'));
    readFileSync(path.join(certDir, 'cert.pem'));
    return true;
  } catch {
    return false;
  }
})();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // Bind all interfaces so phones on the same LAN can reach the dev server.
    host: true,
    port: 5173,
    // HTTPS is required for microphone access (getUserMedia) on non-localhost
    // origins. Reuse the repo's self-signed cert when present.
    ...(hasCert
      ? {
          https: {
            key: readFileSync(path.join(certDir, 'key.pem')),
            cert: readFileSync(path.join(certDir, 'cert.pem')),
          },
        }
      : {}),
    proxy: {
      '/api': { target: 'https://localhost:4000', secure: false, changeOrigin: true },
      '/ws': { target: 'wss://localhost:4000', ws: true, secure: false, changeOrigin: true },
    },
  },
});
