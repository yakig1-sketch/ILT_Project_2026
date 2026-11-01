import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The gateway runs on :8080 during development; the apps call it through /api.
// `--mode lan` serves over HTTPS (self-signed) so a tablet on the LAN gets a secure context
// (crypto.subtle, crypto.randomUUID and pointerrawupdate need one off localhost).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'lan' ? [basicSsl()] : [])],
  server: { host: true, proxy: { '/api': 'http://localhost:8080', '/ws': { target: 'ws://localhost:8080', ws: true } } },
}));
