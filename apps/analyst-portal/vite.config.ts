import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The gateway runs on :8080 during development; the apps call it through /api.
// The user guides (packages/help/public/help) are served and built at <base>help/.
// `--mode lan` serves over HTTPS (self-signed) so the portal works from another PC on the LAN.
export default defineConfig(({ mode }) => ({
  publicDir: '../../packages/help/public',
  plugins: [react(), ...(mode === 'lan' ? [basicSsl()] : [])],
  server: { host: true, proxy: { '/api': 'http://localhost:8080', '/ws': { target: 'ws://localhost:8080', ws: true } } },
}));
