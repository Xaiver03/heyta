import { defineConfig } from 'tsup';

export default defineConfig({
  /**
   * 三个入口：
   * - `index.ts` 程序化使用
   * - `cli.ts` 供人使用
   * - `cli-mcp.ts` 供 **MCP 客户端**作为子进程拉起（stdio）
   * - `cli-ai.ts` 管理 AI 端点密钥（只进系统钥匙串）
   * - `cli-local-api.ts` 生成本机 API / MCP 的配置文件
   *
   * ⚠️ `cli-mcp.ts` 必须是独立入口，不能被 `cli.ts` 顺带带上：
   * MCP 客户端的 stdout 是**协议专用**的，任何别的东西混进去都会毁掉连接。
   * 独立入口让"这个进程只跑 MCP"这件事在构建产物上就是成立的。
   *
   * 三者共用 `host.ts`，行为只有一份。
   */
  entry: ['src/index.ts', 'src/cli.ts', 'src/cli-mcp.ts', 'src/cli-ai.ts', 'src/cli-local-api.ts'],
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
