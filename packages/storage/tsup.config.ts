import { defineConfig } from 'tsup';

export default defineConfig({
  /**
   * `index.ts` 是**平台无关**入口（原生端也能用）。
   * Node 专属的 `node:sqlite` 驱动走独立的子路径入口，避免 Web 打包器
   * 因为主入口而被迫解析 `node:sqlite`。
   */
  entry: ['src/index.ts', 'src/sqlite/node-sqlite-driver.ts'],
  /**
   * 🔴 必须显式 external：esbuild 会把 `node:sqlite` 规范化成 `sqlite`，
   * 而 `sqlite` **不是**可无前缀解析的 Node 内建模块 —— 产物会变成
   * `import ... from "sqlite"` 并在运行时 `ERR_MODULE_NOT_FOUND`。
   * 显式 external 会原样保留 `node:` 前缀。
   */
  external: ['node:sqlite'],
  /**
   * 🔴 必须关掉 tsup 的 `removeNodeProtocol`（默认 true）。
   *
   * tsup 会无条件把 `node:xxx` 改写成 `xxx` 并标为 external —— 对多数内建模块
   * 无害，但 `node:sqlite` 是**只能带前缀**解析的内建模块：产物会变成
   * `import ... from "sqlite"`，运行时 `ERR_MODULE_NOT_FOUND`。
   * 实测确认（`require('sqlite')` / `import 'sqlite'` 都 MODULE_NOT_FOUND）。
   */
  removeNodeProtocol: false,
  target: 'node22',
  format: ['esm', 'cjs'],
  tsconfig: 'tsconfig.build.json',
  dts: { tsconfig: 'tsconfig.build.json' },
  sourcemap: true,
  clean: true,
});
