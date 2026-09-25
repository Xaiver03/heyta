import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  /**
   * 🔴 必须显式列出 `node:` 协议依赖，且 `removeNodeProtocol` 必须为 false。
   *
   * 本包**自己**不 import `node:sqlite`，但它的消费者（`apps/node-host`）会经
   * `@heyta/storage/sqlite/node` 间接用到。tsup 默认 `removeNodeProtocol: true`
   * 会把 `node:sqlite` 改写成 `sqlite` —— 后者不是可解析的内建模块，
   * 产物运行时 `ERR_MODULE_NOT_FOUND`，而**类型检查与源码运行都不会暴露它**。
   * 见 AGENTS.md §7 第 18 条。
   */
  removeNodeProtocol: false,
  tsconfig: 'tsconfig.build.json',
  dts: { tsconfig: 'tsconfig.build.json' },
  sourcemap: true,
  clean: true,
});
