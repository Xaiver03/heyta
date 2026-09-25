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
export * from './stores';
export * from './op-log-store';
export * from './indexeddb/index';
