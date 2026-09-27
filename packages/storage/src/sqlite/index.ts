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

/**
 * op-log 存储的 Worker 桥接（web 端把 SQLite 放进 Worker 的接缝）。
 *
 * 🔴 为什么边界画在 `OpLogStore` 而不是 `DbAdapter`：
 * `DbAdapter.transaction()` **接收回调**，而回调不能跨 Worker 序列化。
 * 画在 `DbAdapter` 就得把一次原子事务拆成一串请求发过去，等于**把原子性拆掉**。
 * 详见 `oplog-worker-bridge.ts` 文件头。
 */
export * from './oplog-worker-bridge.js';
