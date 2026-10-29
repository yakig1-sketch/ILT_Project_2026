import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The gateway runs on :8080 during development; the apps call it through /api.
export default defineConfig({
  plugins: [react()],
  server: { host: true, proxy: { '/api': 'http://localhost:8080' } },
});
