import { defineConfig } from 'tsup';

export default defineConfig({
  /**
   * 多入口（R7）：根入口 + **单语言子路径**。
   *
   * 🔴 主子路径的差别不是组织方式，是**体积**：根入口的 `translate.ts`
   * 同时 import 中英两份表（合计约 93 KB gz），而落地页是多 HTML 入口的
   * 静态站 —— `/signin/` 永远不需要英文表。所以落地页走
   * `@heyta/i18n/provider`（不含表）+ 按语言动态 import `@heyta/i18n/zh-CN`
   * 或 `@heyta/i18n/en`，另一种语言根本不会被下载。
   *
   * ⚠️ 子路径的产物路径由相对 `src/` 的目录结构决定 ⇒ dist/locales/zh-CN.js，
   * 与 `package.json` 的 `exports` 必须逐字一致（对不上就是"构建成功、导入失败"）。
   */
  entry: ['src/index.ts', 'src/provider.tsx', 'src/locales/zh-CN.ts', 'src/locales/en.ts'],
  format: ['esm'],
  /** `react` 是 peerDependency：三个外壳各自带自己的一份 React，
   *  绝不能把它打进产物，否则会出现两份 React 实例、
   *  context 跨不过去（`useI18n()` 拿到默认 locale 而不是 Provider 的）。 */
  external: ['react', 'react/jsx-runtime'],
  tsconfig: 'tsconfig.build.json',
  dts: { tsconfig: 'tsconfig.build.json' },
  sourcemap: true,
  clean: true,
});
