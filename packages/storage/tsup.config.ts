import { defineConfig } from 'tsup';

export default defineConfig({
  /**
   * `index.ts` 是**平台无关**入口（原生端也能用）。
   * Node 专属的 `node:sqlite` 驱动走独立的子路径入口，避免 Web 打包器
   * 因为主入口而被迫解析 `node:sqlite`。
   */
  entry: [
    'src/index.ts',
    'src/sqlite/node-sqlite-driver.ts',
    // Web 平台的驱动（OPFS SAH Pool VFS）。
    //
    // 🔴 **必须在这里列出来**：它是 `package.json` 里 `./sqlite/wasm`
    // 子路径导出的目标，而 tsup **只产出 `entry` 里列的东西**。
    // 漏了它的症状是 `apps/web` 报
    // `Cannot find module '@heyta/storage/sqlite/wasm'` ——
    // 而那个源文件**确实好好地存在**，所以照着报错去翻源码是找不到问题的。
    // 它只用**动态** `import('@sqlite.org/sqlite-wasm')`（见该文件文件头第二节），
    // 所以打进产物不会让别的端背上 852 KB 的 wasm。
    'src/sqlite/sqlite-wasm-driver.ts',
  ],
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
