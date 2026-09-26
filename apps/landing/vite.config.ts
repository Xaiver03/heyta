import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  build: {
    // three 是唯一的体积大头，单独成 chunk 让首屏 HTML/CSS 先到，
    // 3D 场景延后 —— 与 `Hero3D` 的懒加载配合（Core Web Vitals 要求）。
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.spec.{ts,tsx}'],
  },
});
