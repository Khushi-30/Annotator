import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Annotator',
        short_name: 'Annotator',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [],
      },
      workbox: {
        // Cache image variants hard once viewed -> instant revisits + offline
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/files/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true, // expose on LAN for phone testing
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/files': 'http://localhost:8787',
    },
  },
});
