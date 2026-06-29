import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,   // bind to 0.0.0.0 so the phone can reach it on the LAN / hotspot
    port: 5173,
    strictPort: true,
  },
});
