/**
 * W0-2 / 跨语言契约重放 spike 的打包入口。
 *
 * 做两件事：
 *   ① 把**真正在用的** TS 存储栈与 schema 汇成一个自包含 bundle，
 *      好让 C# 侧的 JS 引擎能把**同一份源码**跑起来；
 *   ② 把**真正在用的**两个契约测试**原样**带进来（`tests/contract/*.contract.ts`），
 *      配合 `vitest-shim.ts` 在引擎里跑。
 *
 * 🔴 这里**不重新实现任何东西**，也**不复制任何断言** —— 它就是
 *    `packages/storage` 的出口 + 它的契约。
 *    如果这个 spike 需要另写一套断言才能跑，那它证明的就不是"同一套契约"了，
 *    而 `packages/storage/tests/contract.spec.ts` 的文件头**明确禁止**那种做法。
 */

// ── 被测的真源码 ────────────────────────────────────────────────
export { SqliteAdapter } from '../../../packages/storage/src/sqlite/sqlite-adapter.js';
export { DbOpLogStore } from '../../../packages/storage/src/db-op-log-store.js';
export { INDEXEDDB_SCHEMA } from '../../../packages/storage/src/indexeddb/indexeddb-adapter.js';
export { STORES, OP_FIELDS, OP_INDEXES } from '../../../packages/storage/src/stores.js';

// ── 契约本身（原样，未改一行）────────────────────────────────────
export { runDbAdapterContract } from '../../../packages/storage/tests/contract/adapter.contract.js';
export { runOpLogStoreContract } from '../../../packages/storage/tests/contract/op-log-store.contract.js';

// ── 微测试框架替身（提供 describe / it / expect）─────────────────
export { resetResults, settle, report } from './vitest-shim.js';
