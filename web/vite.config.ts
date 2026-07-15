import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'https://localhost:4000', secure: false, changeOrigin: true },
      '/ws': { target: 'wss://localhost:4000', ws: true, secure: false, changeOrigin: true },
    },
  },
});
