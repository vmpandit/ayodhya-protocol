import { defineConfig } from 'vite';
import path from 'path';

// GITHUB_PAGES_BASE is set by the Actions workflow to '/<repo-name>/'
// Leave it unset (or set to '/') for local dev or a custom domain.
const base = process.env.GITHUB_PAGES_BASE ?? '/';

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    // Inline small assets so the game works from any sub-path
    assetsInlineLimit: 4096,
  },
  optimizeDeps: {
    exclude: ['@babylonjs/core'],
  },
});
