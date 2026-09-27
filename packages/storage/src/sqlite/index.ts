/**
 * SQLite 存储实现。
 *
 * ⚠️ 这里**故意不导出** `NodeSqliteDriver` —— 它 `import 'node:sqlite'`，
 * 只属于 Node 平台；原生端（iOS / HarmonyOS）应注入自己的绑定。
 * 把它放进主入口会让 Web 打包器也去解析 `node:sqlite`。
 *
 * Node 侧请从子路径导入：
 * ```ts
 * import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
 * ```
 */

export * from './sqlite-driver.js';
export * from './sqlite-adapter.js';

/**
 * Web 的 SQLite 驱动（`sqlite-wasm` + OPFS）。
 *
 * ⚠️ 与 `NodeSqliteDriver` **不同**，这个可以进主入口：
 * 它对 `@sqlite.org/sqlite-wasm` 用的是**动态** import
 * （见 `sqlite-wasm-driver.ts` 文件头第二段），
 * 所以不会让不使用 web 存储的打包目标背上那 852 KB 的 wasm。
 *
 * 而 `SqliteWasmDriver` 本身只接受一个已打开的 `oo1.DB`、**自己不碰 OPFS** ——
 * 因此在 Node 里也能用内存库跑同一套契约测试（见 `tests/contract.spec.ts`）。
 */
export * from './sqlite-wasm-driver.js';
