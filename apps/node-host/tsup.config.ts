import { defineConfig } from 'tsup';

export default defineConfig({
  /**
   * 两个入口：宿主模块（`index.ts`，供程序化使用）与 CLI（`cli.ts`，供人使用）。
   * 两者共用 `host.ts`，行为只有一份。
   */
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  /**
   * 🔴 必须关掉（默认 true）。宿主经 `@heyta/storage/sqlite/node` 间接依赖
   * `node:sqlite`，而 tsup 会把它改写成 `sqlite` —— 后者不是可解析的内建模块，
   * 产物运行时 `ERR_MODULE_NOT_FOUND`。见 AGENTS.md §7 第 18 条。
   *
   * 依赖包默认为 external，所以这一条在当前配置下是**防御性**的：
   * 一旦哪天为了让 CLI 自包含而打开 noExternal，没有它就会静默炸在产物里。
   */
  removeNodeProtocol: false,
  tsconfig: 'tsconfig.build.json',
  dts: { tsconfig: 'tsconfig.build.json' },
  sourcemap: true,
  clean: true,
});
