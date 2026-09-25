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
