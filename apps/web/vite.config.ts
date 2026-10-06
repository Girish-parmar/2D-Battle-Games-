import { defineConfig } from 'vite';

const target = process.env.SERVER_URL ?? 'http://localhost:8080';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/ws': { target: target.replace('http', 'ws'), ws: true }
    }
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { pixi: ['pixi.js'] } } }
  }
});
