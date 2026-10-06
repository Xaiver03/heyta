import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/node.ts'],
  /**
   * 🔴 **同时产出 ESM 与 CJS**，不是随手加的。
   *
   * 消费方有三类，它们的解析规则**互不相同**：
   *   - `apps/web`（Vite）走 `import`；
   *   - `apps/mobile`（Metro）在 pnpm 布局下走 `require` —— 它靠
   *     `react-native` 的 `main` 字段解析，而 RN 0.84 的生态里仍有大量
   *     CJS-only 的包，只给 ESM 会在打包期报错，且报错指向本包而不是根因；
   *   - 未来的鸿蒙 RN 宿主同样是 Metro。
   *
   * `packages/design-system` 的 `./native` 子路径也是这么做的（`import` + `require`
   * 各一份），本包沿用同一套约定，免得两个共享包在解析行为上不一致。
   */
  format: ['esm', 'cjs'],
  /**
   * ⚠️ `react` / `react-native` 必须**留在外部**。
   *
   * 打进来会各带一份 React —— 而重复 React 的症状是 hooks 报
   * "Invalid hook call" 或状态读不到，**报错位置离根因很远**。
   * `apps/mobile` 为此专门吃过一次亏（APK 里两个 React 实例），
   * 仓库里还有一条 `check:mobile-bundle` 门禁盯着这件事。
   * tsup 默认就把 peerDependencies 外部化，这里显式写出来是**当文档用**。
   */
  external: ['react', 'react-native'],
  tsconfig: 'tsconfig.build.json',
  dts: { tsconfig: 'tsconfig.build.json' },
  sourcemap: true,
  clean: true,
});
