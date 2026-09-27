/**
 * web 端的 **存储 Worker**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么存储必须在这里，而不是主线程
 * ─────────────────────────────────────────────────────────────
 * [ADR-0028](../../../../docs/adr/0028-web-sqlite-must-run-in-worker.md)：
 * `FileSystemFileHandle.prototype.createSyncAccessHandle` 规范上是
 * `[Exposed=DedicatedWorker]` —— **主线程拿不到它**，所以 OPFS 的 SAH Pool VFS
 * 只能在 Worker 里装。这不是可以绕过的实现细节，是平台约束。
 *
 * ─────────────────────────────────────────────────────────────
 * 这个文件**故意很薄**
 * ─────────────────────────────────────────────────────────────
 * 它只做三件事：开库、解析 `clientId`、把 store 接到端口上。
 * 所有存储语义都在 `@heyta/storage` 里 ——
 * 那是**契约测试跑过的那一份**（见 `packages/storage/tests/contract.spec.ts`
 * 里"Worker 桥接"那条）。apps 是壳，ADR-0003 §2.2。
 */

import {
  DbOpLogStore,
  INDEXEDDB_SCHEMA,
  serveOpLogWorker,
  SqliteAdapter,
  type OpLogWorkerStore,
} from '@heyta/storage';
/**
 * 🔴 **必须走 `@heyta/storage/sqlite/wasm` 子路径，不能从主入口拿。**
 *
 * 主入口若导出它，Metro（不做代码分割）就会把 `@sqlite.org/sqlite-wasm` 的
 * Emscripten 胶水层内联进 **Android release 包**，而它用 `import.meta.url`，
 * Hermes 直接报 `'import.meta' is currently unsupported`，
 * release 打包整个失败。完整推导见 `packages/storage/src/sqlite/index.ts` 文件头。
 *
 * ⚠️ 这个错误**只在 release 现形** —— debug 不跑 Hermes 字节码编译。
 */
import { createOpfsSahPoolDriverFactory } from '@heyta/storage/sqlite/wasm';
import { resolveClientId } from '@heyta/app-host';
import type { Operation } from '@heyta/sync-core';

/**
 * 库文件名。放在 OPFS 里，由驱动自己决定绝对路径 ——
 * ⚠️ 必须是**不带目录**的名字：SAH Pool 要求绝对路径，
 * 带相对路径时它会在池的目录下再解析一层，行为不是调用方想要的。
 */
const DB_FILENAME = 'heyta.sqlite';

/**
 * OPFS 里的 VFS 名。**决定磁盘目录名**（SAH Pool 用 `'.' + vfsName`）。
 *
 * 🔴 两条规则（`packages/storage/probe/oplog-worker.js` 里有完整推导）：
 *   1. **一个页面只能有一个存储 Worker** —— 同名 VFS 的第二块池拿不到句柄，
 *      报 `NoModificationAllowedError`。
 *   2. **每个独立数据库家族用自己的 `vfsName`** —— 否则两块池指向同一批文件。
 *
 * 显式写出来还有一个好处：**它是可断言的**。
 * 验证脚本靠这个名字去 OPFS 里找库文件，从而证明"真的走了 SQLite"，
 * 而不是只看到"应用没报错"。
 */
const DB_VFS_NAME = 'heyta-web';

/**
 * 开库。**失败也要有结果**，不能让它变成一个悬着的 Promise ——
 * 主线程会等 `ready`，永远不决议就是"应用卡在启动、什么都不说"。
 */
const opened: Promise<{ store: OpLogWorkerStore; clientId: string }> = (async () => {
  /**
   * 🔴 先 await 装池，再交一个**同步**工厂给适配器。
   * 直接传 `openSqliteWasmDriver` 会把 Promise 当驱动塞进适配器
   * （`driverFactory` 的签名是同步的）—— 详见 `createOpfsSahPoolDriverFactory` 的注释。
   */
  const driverFactory = await createOpfsSahPoolDriverFactory({
    filename: DB_FILENAME,
    vfsName: DB_VFS_NAME,
  });

  const adapter = new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory });
  await adapter.init();

  /**
   * 🔴 `clientId` 由**这个库**给出权威值。
   *
   * 它原本在主线程用 `resolveClientId(db)` 解析，而现在主线程没有再开一个库 ——
   * 这正是想要的：`clientId` 是 LWW 冲突的**决胜依据**，
   * 两份实现会漂移（`apps/web/src/lib/oplog.ts` 的文件头记过这笔账）。
   */
  const clientId = await resolveClientId(adapter);

  return { store: new DbOpLogStore<Operation>(adapter), clientId };
})();

/**
 * ⚠️ 这里必须**立刻**调用：`serveOpLogWorker` 会先把 `onmessage` 挂上、
 * 把开库期间到达的请求缓冲起来，等 `opened` 决议后再排空。
 * 如果改成 `opened.then(...)` 里再挂监听，开库期间的消息会**直接丢失**。
 */
serveOpLogWorker(
  self as unknown as {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage(message: unknown): void;
  },
  opened,
);
