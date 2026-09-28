/**
 * W0-2 spike 的打包入口。
 *
 * 只做一件事：把**真正在用的** TS 存储适配器与其 schema 汇成一个自包含 bundle，
 * 好让 C# 侧的 JS 引擎能把**同一份源码**跑起来。
 *
 * 🔴 这里**不重新实现任何东西** —— 它就是 `packages/storage` 的出口。
 *    如果这个 spike 需要复制适配器逻辑才能跑，那它证明的就不是"同一套契约"了。
 */

export { SqliteAdapter } from '../../../packages/storage/src/sqlite/sqlite-adapter.js';
export { INDEXEDDB_SCHEMA } from '../../../packages/storage/src/indexeddb/indexeddb-adapter.js';
export { STORES, OP_FIELDS, OP_INDEXES } from '../../../packages/storage/src/stores.js';
