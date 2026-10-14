import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5183, strictPort: true },
  preview: { port: 5183, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { pixi: ['pixi.js'] } } },
  },
  // Module workers share sim code with the main bundle (the default 'iife' can't code-split).
  worker: { format: 'es' },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    benchmark: { include: ['src/**/*.bench.ts'] },
  },
} as Parameters<typeof defineConfig>[0]);
