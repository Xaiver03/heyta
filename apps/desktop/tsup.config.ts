import { defineConfig } from 'tsup';

export default defineConfig({
  /**
   * 两个入口：
   * - `main.ts` 主进程
   * - `preload.ts` 预加载脚本
   *
   * 🔴 输出 **CJS（`.cjs`）而不是 ESM**，这是被 preload 逼的：
   * sandbox: true 的 preload **必须是 CommonJS**，Electron 不会以 ESM 加载它。
   * 让两个入口用同一种格式，可以避免"主进程是 ESM、preload 是 CJS"
   * 这种只在运行时才炸的错配。
   *
   * `package.json` 里是 `"type": "module"`，所以扩展名必须是 `.cjs` ——
   * 否则 `.js` 会被当成 ESM，而内容却是 CJS。
   */
  entry: { main: 'src/main.ts', preload: 'src/preload.ts', smoke: 'src/smoke.ts' },
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  target: 'node22',
  /**
   * 🔴 必须关掉（默认 true）。本包经 `@heyta/node-host` →
   * `@heyta/storage/sqlite/node` 间接依赖 `node:sqlite`，
   * 而 tsup 会把它改写成 `sqlite` —— 后者是不可解析的内建模块，
   * 产物运行时会 `ERR_MODULE_NOT_FOUND`。见 AGENTS.md §7 第 18 条。
   */
  removeNodeProtocol: false,
  /** `electron` 由运行时提供，绝不打包进去。 */
  external: ['electron'],
  /**
   * 🔴 **把工作区依赖打进产物**（`@heyta/*`），这是为了让桌面端能打包分发。
   *
   * tsup 默认会把 `package.json` 的 `dependencies` 全部**外置**（只留 require），
   * 于是 `main.cjs` 里出现了 `require("@heyta/node-host")`。在开发机上没问题，
   * 但**打包时这是个死结**：pnpm 用符号链接 + 嵌套 `node_modules` 布局，
   * Electron 打包器复制过去的是一堆断链的 symlink，运行时 `MODULE_NOT_FOUND`。
   * （`electron-builder` / `@electron/packager` 都有这个问题，
   * 通行解法要么装 `node-linker=hoisted`，要么就是把依赖打进去。）
   *
   * 打进去之后产物**自包含**：除了 `electron` 与 Node 内建模块，
   * 不再 require 任何东西 —— 打包就退化成"复制 dist + renderer-dist + package.json"。
   *
   * ⚠️ `@heyta/node-host` 一路依赖到 `node:sqlite`（Node 内建），
   * 所以它在任何情况下都不会被外部化 —— 这也是上面 `removeNodeProtocol: false`
   * 必须存在的原因（见 AGENTS.md §7）。
   */
  noExternal: [/^@heyta\//],
  /**
   * **不生成 .d.ts**：这是应用壳，没有人 import 它的构建产物
   * （`index.ts` 是给测试直接读源码用的）。
   * `node-host` 需要 dts 是因为它是被消费的工作区依赖，此处不同。
   */
  dts: false,
  sourcemap: true,
  clean: true,
});
