import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

import { rnwOptimizeDeps, rnwResolve } from '../../scripts/vite-rnw-resolve.mjs';

/**
 * 桌面端**渲染进程**的构建配置（M2）
 * ==================================
 *
 * 这是第二个 Vite 应用（第一个是 `apps/web`）。两者的解析规则**必须逐字相同** ——
 * 因为它们消费的是同一个 `@heyta/ui`，而共享包写的是 `from 'react-native'`。
 * 所以那套规则抽在 `scripts/vite-rnw-resolve.mjs` 里只留一份，这里 import 它。
 *
 * ⚠️ 但**共享目前只覆盖到这一端**：`apps/web/vite.config.ts` 里还留着它自己那份
 * 内联副本（抽取时只迁了桌面端，旧的一份没删）。也就是说"逐字相同"这件事
 * 现在靠人记着，而不是靠代码 —— 见 BLOCKED.md 里登记的收尾项。
 *
 * ⚠️ `root` 指向 `renderer/`，产物出到 **`renderer-dist/`**。
 * 不把产物放进 `renderer/` 内部，是为了让"源码目录"和"构建产物"不混在一起 ——
 * `check:design` 之类的门禁扫源码时不会去读压缩过的 bundle。
 */
export default defineConfig({
  root: 'renderer',
  plugins: [react()],
  /**
   * 🔴 `base: './'` 不能省。
   *
   * 桌面端用 `loadFile()` 以 **`file://`** 协议加载页面，而不是 http。
   * Vite 默认生成绝对路径的 `<script src="/assets/…">`，在 `file://` 下
   * `/` 会被解析到**文件系统根目录**，于是脚本 404 —— 窗口能开，
   * 但里面永远是白的。改成相对路径就与协议无关了。
   */
  base: './',
  resolve: rnwResolve(import.meta.url),
  optimizeDeps: rnwOptimizeDeps(),
  build: {
    outDir: '../renderer-dist',
    emptyOutDir: true,
    /**
     * 两个页面入口：主界面与快速添加面板。
     *
     * 🔴 Vite 默认**只**打包 `root` 下的 `index.html`。少了这一项的话，
     * `quick-add.html` 不会被构建，而症状不是报错 —— 是主进程
     * `loadFile('renderer-dist/quick-add.html')` 打开一个**不存在的文件**，
     * 窗口照样开、里面全白（本仓在 `file://` 路径上吃过两次同一个症状，
     * 见 `src/main.ts` 里 `app.getAppPath()` 那一段）。
     */
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./renderer/index.html', import.meta.url)),
        'quick-add': fileURLToPath(new URL('./renderer/quick-add.html', import.meta.url)),
      },
    },
    /**
     * 关掉 sourcemap：这是要随应用分发出去的产物，
     * 而且渲染进程的调试靠 DevTools 直接看源码映射即可，不必随包带。
     */
    sourcemap: false,
  },
  server: { port: 5174 },
});
