/**
 * SQLite 存储实现。
 *
 * ⚠️ 这里**故意不导出**两个驱动，它们各自 `import` 的东西只有特定平台能用：
 *
 * - `NodeSqliteDriver` —— `import 'node:sqlite'`，只属于 Node。
 * - `SqliteWasmDriver` —— 拉 `@sqlite.org/sqlite-wasm`（852 KB wasm + Emscripten
 *   胶水层），只属于 Web。
 *
 * 放进主入口会让**别的平台的打包器也去解析它们**。各自从子路径导入：
 *
 * ```ts
 * import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
 * import { createOpfsSahPoolDriverFactory } from '@heyta/storage/sqlite/wasm';
 * ```
 *
 * 🔴 **`SqliteWasmDriver` 原来是放在主入口的，理由写的是"它用的是动态 `import()`
 * 所以不会污染别的打包目标" —— 那个判断是错的。**
 *
 * 它只对**会做代码分割**的打包器（Vite / Rollup / webpack）成立。
 * **Metro（React Native 的打包器）不做代码分割**，动态 `import()` 照样被内联进
 * 那一个 bundle。于是 Emscripten 胶水层进了 **Android release 包**，
 * 而它用 `import.meta.url`，**Hermes 不支持**：
 *
 *     error: 'import.meta' is currently unsupported
 *     > Task :app:createBundleReleaseJsAndAssets FAILED
 *
 * 💡 两个教训：
 *
 * 1. **"动态 import" 不是隔离手段，子路径导出才是。** 这与 `NodeSqliteDriver`
 *    那条注释本是同一个道理，只是当时没推广过来。
 * 2. **它只在 release 现形** —— debug 不跑 Hermes 字节码编译，所以 debug 一直是好的。
 *    这正是"构建成功不等于配置生效"，而且证明了 **release 构建必须真的跑**。
 */

export * from './sqlite-driver.js';
export * from './sqlite-adapter.js';

/**
 * op-log 存储的 Worker 桥接（web 端把 SQLite 放进 Worker 的接缝）。
 *
 * 🔴 为什么边界画在 `OpLogStore` 而不是 `DbAdapter`：
 * `DbAdapter.transaction()` **接收回调**，而回调不能跨 Worker 序列化。
 * 画在 `DbAdapter` 就得把一次原子事务拆成一串请求发过去，等于**把原子性拆掉**。
 * 详见 `oplog-worker-bridge.ts` 文件头。
 *
 * ✅ 这个文件**没有** wasm 依赖（只定义了消息协议与代理），所以可以进主入口。
 */
export * from './oplog-worker-bridge.js';
