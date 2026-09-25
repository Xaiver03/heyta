/**
 * @heyta/op-log
 *
 * op-log 编排引擎。**本地状态的唯一写入口是 `OpLogEngine.dispatch()`。**
 *
 * 本包不重新实现向量时钟或冲突判定 —— 那些来自 `@heyta/sync-core`（vendored, MIT）。
 * 这里只负责：把意图变成 op、落盘、幂等应用、崩溃恢复、墓碑。
 */

export * from './state.js';
export * from './engine.js';
