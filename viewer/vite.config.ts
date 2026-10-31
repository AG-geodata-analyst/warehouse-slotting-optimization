import { defineConfig } from 'vite';
export default defineConfig({
  // Relative paths so the app works on GitHub Pages at /warehouse-slotting-optimization/
  base: './',
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
