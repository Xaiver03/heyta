import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  build: {
    // three 是唯一的体积大头，单独成 chunk 让首屏 HTML/CSS 先到，
    // 3D 场景延后 —— 与 `Hero3D` 的懒加载配合（Core Web Vitals 要求）。
    rollupOptions: {
      /**
       * 双入口：中文版在 `/`，英文版在 `/en/`。
       *
       * 两个入口**共用同一个 bundle**，只有 HTML 头部的 lang/标题/描述/hreflang 不同。
       * 语言由路径决定（`src/lib/locale.ts`），所以不需要为英文版单独打包 ——
       * 那只会让两份 JS 各自缓存、各自失效。
       *
       * 路径是**相对 root** 的，不是相对本文件：Vite 自己会按 root 解析。
       */
      input: {
        main: 'index.html',
        en: 'en/index.html',
      },
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
