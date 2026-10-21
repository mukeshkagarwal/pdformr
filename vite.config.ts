import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Service worker that precaches every built file (incl. the pdf.js worker),
    // so after the first visit the app opens and works with no server or network.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'PDFormr',
        short_name: 'PDFormr',
        description: 'PDFormr — fill and edit PDF forms entirely in your browser. Works offline.',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f4f5f7',
        theme_color: '#2563eb',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  base: './',
  // Fixed port: OAuth redirects only return to URLs allowed in Supabase (http://localhost:5173).
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
