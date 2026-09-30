import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Everything the site serves is its own: no CDN, no third-party script, no inline script (the CSP forbids them).
export default defineConfig({
  plugins: [preact()],
  build: {
    target: ['safari16.4', 'es2022'],
    cssTarget: ['safari16.4'],
    sourcemap: false,
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } },
  },
  server: { host: true },
});
