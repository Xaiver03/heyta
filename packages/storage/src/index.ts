/**
 * @heyta/storage
 *
 * 存储抽象层。
 *
 * 只导出**接口 + 各平台实现**，不导出任何"当前用哪个"的默认值 ——
 * 那由应用层决定（Web 用 IndexedDB，原生端用 SQLite）。
 * 见 ADR-0003：多端策略。
 */

export * from './db.types';
export * from './errors';
export * from './stores';
export * from './op-log-store';
export * from './indexeddb/index';
export * from './sqlite/index';

export { MemoryDbAdapter } from './memory/memory-adapter.js';

// 只导出类：`db-op-log-store.ts` 会再导出 `op-log-store.ts` 的类型，
// 用 `export *` 会与上面第 13 行产生重复导出冲突。
export { DbOpLogStore } from './db-op-log-store.js';
// 旧名（兼容别名）：见 db-op-log-store.ts 里为什么用 `export {}` 而非 `const`
export { IndexedDbOpLogStore } from './db-op-log-store.js';
