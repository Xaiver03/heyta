import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { viteInputEntries } from './src/site/pages.ts';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  build: {
    // three 是唯一的体积大头，单独成 chunk 让首屏 HTML/CSS 先到，
    // 3D 场景延后 —— 与 `Hero3D` 的懒加载配合（Core Web Vitals 要求）。
    rollupOptions: {
      /**
       * 入口**从站点注册表派生**（`src/site/pages.ts`），不在这里手写。
       *
       * 🔴 手写的失败方式很隐蔽：加了页面、写了组件、生成了 HTML，
       * 却忘了在这里加一条 —— 于是构建产物里**根本没有那个页面**，
       * 而表现是线上 404（或者更糟：SPA 兜底返回首页，看起来"能打开"）。
       *
       * 现在入口数 = 页数 × 语言数，由 `entryDir()` 算出来：
       *   `main` → `index.html`，`features` → `features/index.html`，
       *   `en/features` → `en/features/index.html`。
       * 两个语言版本**共用同一个 bundle**，只有 HTML 头部的
       * lang / 标题 / 描述 / hreflang 不同 —— 语言由路径决定
       * （`src/site/paths.ts`），所以不需要为英文版单独打包，
       * 那只会让两份 JS 各自缓存、各自失效。
       *
       * 路径是**相对 root** 的，不是相对本文件：Vite 自己会按 root 解析。
       * 这些 HTML 由 `scripts/gen-entries.mjs` 生成（`gen:entries`），
       * 且签进仓库；`gen-entries.mjs --check` 会拦住"改了注册表没重新生成"。
       */
      input: viteInputEntries(),
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
    /**
     * 🔴 **这里没有 `react-native` → `react-native-web` 的别名，这是刻意的。**
     *
     * 展厅曾经一度改成渲染 `@heyta/ui` 的真组件（2026-09-28 实测）：
     * 静态 import 让首屏 `main-*.js` 从 199,000 B gzip 变成 260,897 B（+31%）；
     * 改成懒加载孤岛后主包不变，但 `Hero.tsx` 的 `<AppWindow view="tasks" />`
     * 就在首屏（实测 top=529px），chunk 在 `load` 之后约 90ms 就被取回，
     * 总字节反而更多（+83,578 B gzip 的独立块 vs +62 kB 内联）。
     *
     * 结论：**真组件不进落地页**。理由是落地页存在的意义之一就是首屏快
     *（同一理由已经让 131 kB gzip 的 `three` 拆成了按需 chunk）。
     * 漂移改用"形状契约"解决 —— 见 `packages/design-system/src/task-row-shape.ts`
     * 与 `tests/mockup-task-row.spec.tsx`。
     *
     * ⚠️ 顺带记一笔（免得下次有人再花时间）：**测试里也不要 import `@heyta/ui`。**
     * 那个包是 RN 组件，而 RN 源码是 Flow，Node / jsdom 的加载器解析不了它；
     * Vitest 把它当外部依赖交给 Node 解析、绕过 Vite 的 alias，报出来的是
     * `SyntaxError: Unexpected token 'typeof'`。实测 `server.deps.inline`、
     * `ssr.noExternal`、`deps.optimizer` **三条都拦不住**。
     */
  },
});
