/**
 * OPFS SQLite 探针 —— **跑在 DedicatedWorker 里**。
 *
 * 🔴 为什么必须是 Worker 而不是页面主线程（**这是一手实测结论，不是推测**）
 * ─────────────────────────────────────────────────────────────
 * 在主线程上跑时，探针稳定失败于：
 *
 *     Error: Missing required OPFS APIs.
 *
 * 把能力逐项摊开后，缺的**只有一项**：
 *
 *     createSyncAccessHandle: "undefined"      ← FileSystemFileHandle.prototype 上
 *
 * 而 `SharedArrayBuffer` / `Atomics` / `navigator.storage.getDirectory` 都在。
 *
 * 对照上游源码（`dist/sqlite3-worker1.mjs:16992`，SAH pool 自己的入口检查）：
 *
 *     if (!globalThis.FileSystemHandle || !globalThis.FileSystemDirectoryHandle
 *      || !globalThis.FileSystemFileHandle
 *      || !globalThis.FileSystemFileHandle.prototype.createSyncAccessHandle
 *      || !navigator?.storage?.getDirectory)
 *       return Promise.reject(new Error("Missing required OPFS APIs."));
 *
 * 三项 handled、`navigator.storage` 也在，**唯一为 undefined 的就是
 * `createSyncAccessHandle`** —— 这与规范一致：`FileSystemSyncAccessHandle`
 * 的暴露范围是 `[Exposed=DedicatedWorker]`，**主线程拿不到它**。
 *
 * ⚠️ 顺带一个重要差别：**SAH Pool 这一条检查里没有 `SharedArrayBuffer`**。
 * 也就是说它**不需要 COOP/COEP 跨源隔离**（那条要求属于异步的 `opfs` VFS）。
 * 这让它比另一条路径更好部署 —— 少一类"本地能跑、线上挂掉"的失败模式。
 *
 * ─────────────────────────────────────────────────────────────
 * 所以架构是：SQLite 在 Worker 里，主线程通过消息与它通信
 * ─────────────────────────────────────────────────────────────
 * `SqliteDriver` 的**同步**接口在 Worker 内部**完全成立**
 * （`installOpfsSAHPoolVfs()` 异步一次，之后全是同步调用）。
 * 跨到主线程的那一层**必然是异步的** —— 那是 postMessage 的性质，不是接口设计问题。
 */

import { openSqliteWasmDriver } from '../src/sqlite/sqlite-wasm-driver.js';

const FILENAME = 'heyta-opfs-probe.sqlite';

async function run() {
  const steps = [];
  const step = (name, detail) => steps.push({ name, detail });

  try {
    step('① Worker 启动');

    /**
     * 主线程缺的那一项，在这里必须存在 —— 这本身就是本探针的核心断言。
     * 先把能力摊开记录，让"为什么必须用 Worker"有一手证据可查。
     */
    const caps = {
      isSecureContext: globalThis.isSecureContext,
      SharedArrayBuffer: typeof globalThis.SharedArrayBuffer,
      Atomics: typeof globalThis.Atomics,
      WorkerGlobalScope: typeof globalThis.WorkerGlobalScope,
      FileSystemHandle: typeof globalThis.FileSystemHandle,
      FileSystemDirectoryHandle: typeof globalThis.FileSystemDirectoryHandle,
      createSyncAccessHandle:
        typeof globalThis.FileSystemFileHandle?.prototype?.createSyncAccessHandle,
      storageGetDirectory: typeof navigator?.storage?.getDirectory,
    };
    step('② Worker 里的 OPFS 能力', caps);

    const driver = await openSqliteWasmDriver({ filename: FILENAME, initialCapacity: 4 });
    step('③ SAH Pool VFS 已装上，驱动已打开');

    driver.exec('CREATE TABLE IF NOT EXISTS probe(id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
    const before = driver.all('SELECT id, note FROM probe ORDER BY id');
    step('④ 刷新前已有行数', before.length);

    if (before.length === 0) {
      driver.run('INSERT INTO probe(note) VALUES (?)', ['来自真浏览器 Worker']);
      step('⑤ 写入一行');
    } else {
      step('⑤ 已有数据，跳过写入（说明上一轮真的落盘了）');
    }

    const rows = driver.all('SELECT id, note FROM probe ORDER BY id');
    step('⑥ 读回', rows);

    let uniqueDetected = false;
    try {
      driver.exec('CREATE UNIQUE INDEX IF NOT EXISTS probe_note ON probe(note)');
      driver.run('INSERT INTO probe(note) VALUES (?)', [rows[0].note]);
    } catch (error) {
      uniqueDetected = driver.isUniqueViolation(error);
    }
    step('⑦ 唯一冲突被判定', uniqueDetected);

    /** 记录事实但不当成前提：FTS5 是运行时能力协商项（ADR-0027 §5）。 */
    let fts5 = false;
    try {
      driver.exec('CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(note)');
      fts5 = true;
    } catch {
      fts5 = false;
    }
    step('⑧ 本运行时支持 FTS5', fts5);

    driver.close();
    driver.close();
    step('⑨ 关闭两次都没抛（幂等）');

    postMessage({
      status: 'ok',
      steps,
      caps,
      rowCount: rows.length,
      fts5,
      uniqueDetected,
    });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    step('🔴 失败', message);
    postMessage({ status: 'error', steps, error: message });
  }
}

void run();
