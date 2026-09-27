/**
 * **存储 Worker 的探针版**：真实 `SqliteAdapter` + 真实 schema + 真实桥接。
 *
 * 它与 `apps/web/src/worker/storage.worker.ts` 是同一套接线，
 * 差别只有两处，都是探针环境所迫：
 *   1. 用**源码相对路径**导入 `@heyta/storage`（探针的 vite root 就是 `packages/storage`，
 *      这样验的是当前源码而不是已构建产物）；
 *   2. 库文件名不同，免得和 `worker.js` 那个裸驱动探针互相踩。
 *
 * 🔴 为什么值得单独有一个：`packages/storage/tests/contract.spec.ts` 里的
 * "Worker 桥接"用的是**进程内假端口** —— 它验的是**协议**（方法名、参数、异常形状），
 * 而这里验的是**真 postMessage + 真 OPFS + 真 schema** 一起上时还成不成立。
 * 两者缺一不可：假的抓不到跨真线程的问题，真的跑不动契约的规模。
 */

import { resolveClientId } from '@heyta/app-host';

import { DbOpLogStore } from '../src/db-op-log-store.js';
import { INDEXEDDB_SCHEMA } from '../src/indexeddb/indexeddb-adapter.js';
import { serveOpLogWorker } from '../src/sqlite/oplog-worker-bridge.js';
import { SqliteAdapter } from '../src/sqlite/sqlite-adapter.js';
import { createOpfsSahPoolDriverFactory } from '../src/sqlite/sqlite-wasm-driver.js';

const FILENAME = 'heyta-oplog-probe.sqlite';

/**
 * 🔴 **VFS 名必须与 `worker.js` 那个探针不同** —— 这是真浏览器里踩出来的。
 *
 * 两个 Worker 都用默认名 `heyta-opfs` 时，报的是：
 *
 *     NoModificationAllowedError: Failed to execute 'createSyncAccessHandle'
 *     on 'FileSystemFileHandle': Access Handles cannot be created if there is
 *     another open Access Handle or Writable stream associated with the same file.
 *
 * 原因是 **VFS 名决定 OPFS 目录名**（`directory: '.' + vfsName`）：
 * 同名 ⇒ 两块池指向**同一批文件** ⇒ 第二个拿不到句柄。
 *
 * ─────────────────────────────────────────────────────────────
 * 这不只是探针的问题，是一条**生产约束**
 * ─────────────────────────────────────────────────────────────
 * SAH 池是**每个 Worker 各自一份**，不是跨 origin 共享的注册表
 * （`close()` 里**不**调 `removeVfs()` 也是这个原因）。
 * 由此得出两条必须守住的规则：
 *
 *   1. **一个页面只应有一个存储 Worker。** 起第二个 = 它自己去开同一批文件，
 *      拿到的就是这个错误。Web 侧因此**不能**"每个 feature 一个 worker"。
 *   2. **每个独立数据库家族要有自己的 `vfsName`**（连带自己的目录）。
 *      多个库**可以**共用一个 VFS（同池不同文件名，这正是池的用法），
 *      但一旦分成两块池，名字就必须分开。
 *
 * 这两条**在 Node 侧永远验不出来**：Node 没有 OPFS，契约测试里的桥接用的是内存库。
 * 又一次印证了那条硬性规定 —— 不真跑浏览器，这类约束发现不了。
 */
const VFS_NAME = 'heyta-oplog-probe';

/**
 * 开库。失败也要有结果 —— 主线程在等 `ready`，永远不决议就是"卡住、什么都不说"。
 */
const opened = (async () => {
  // 🔴 先 await 装池，再交出**同步**工厂（driverFactory 的签名是同步的）。
  const driverFactory = await createOpfsSahPoolDriverFactory({
    filename: FILENAME,
    vfsName: VFS_NAME,
  });
  const adapter = new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory });
  await adapter.init();
  const clientId = await resolveClientId(adapter);
  return { store: new DbOpLogStore(adapter), clientId, adapter };
})();

/** 给页面壳一个"库开好了没"的探针（很薄，只读）。 */
globalThis.__heytaOpLogWorkerOpened = opened
  .then((o) => ({ ok: true, clientId: o.clientId }))
  .catch((error) => ({
    ok: false,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  }));

serveOpLogWorker(self, opened);
