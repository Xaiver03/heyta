/**
 * 产品介绍演示的**独立打包配置**
 * ================================
 *
 * ⚠️ 为什么单独一份，而不是塞进站点那份 `apps/landing/vite.config.ts`：
 * 站点那份的入口由 `src/site/pages.ts` 派生（`gen:entries` → 导航 / 页脚 /
 * sitemap 全从它来）。演示**不是站点的一页** —— 它不该进导航、不该进 sitemap，
 * 也不该让"加了页忘了登记"的判据为它破例。所以它走自己的入口与输出。
 *
 * 🔴 **root 就是本目录**（不是 `apps/landing`）：入口 `index.html` 在 root 下，
 * 产物才是 `dist/index.html`；root 放到上层时 vite 会保留入口相对 root 的
 * 目录层级，产物会变成 `dist/pitch/index.html`。
 * 模块解析不受影响 —— 裸包按 **importer 所在目录** 向上找 node_modules，
 * `AppWindow.tsx` 在 `apps/landing/src/` 下，照旧解析到 landing 的依赖。
 *
 * `base: './'` 是刻意的：产物要能直接用 `file://` 打开（演讲时不一定有服务器）。
 * `publicDir: false` 同理：站点 `public/` 里的 sitemap / og-card / 搜索验证文件
 * 会被整份拷进演示产物，那是给爬虫的，不该出现在交付目录里。
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: '../../../pitch/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html',
    },
    chunkSizeWarningLimit: 1200,
  },
});
