#!/usr/bin/env node
/**
 * **证明 web 端真的在用 Worker 里的 SQLite** —— 而不是"看起来没坏"。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么这个脚本必须存在
 * ─────────────────────────────────────────────────────────────
 * M4-3b 把 `apps/web` 的存储从 IndexedDB 换成了 Worker 里的 SQLite。
 * 换完之后 e2e 全绿 —— 但**那不是证据**：
 *
 *   🔴 两条路径都能让 e2e 全绿。
 *
 * 也就是说，如果切换代码静默回退了（`import.meta.env` 读不到、
 * Worker 起不来被 catch 吞掉、VITE_HEYTA_STORAGE 拼错），
 * **所有测试照样通过，一切看起来都正常**。
 *
 * 这正是本会话反复撞上的那一类缺口：**失败什么都不说**。
 * 所以真正需要的不是"再跑一遍 e2e"，而是：
 *
 *   1. 应用**自己报出**它选了哪条路（`window.__heytaStorage`）；
 *   2. 从**外部**验证这条路留下的痕迹（OPFS 里确实有那个库文件）；
 *   3. 交叉验证**另一条路没有被写**（新建任务后 IndexedDB 里没有新 op）。
 *
 * 三条合起来，"真的切过去了"才是被证明的，而不是被推断的。
 *
 * 用法：`node scripts/verify-web-storage-backend.mjs`
 */

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4321;
const SHOT = join(ROOT, 'e2e', 'test-results', 'web-storage-backend.png');

/** 与 `apps/web/src/worker/storage.worker.ts` 里的 `DB_VFS_NAME` 必须一致。 */
const EXPECTED_VFS = 'heyta-web';
/** 与 `apps/web/src/lib/oplog.ts` 里 IndexedDB 路径的库名一致。 */
const LEGACY_DB_NAME = 'heyta';

const viteBin = join(ROOT, 'apps', 'web', 'node_modules', '.bin', 'vite');

/** Playwright 住在 `e2e/`（独立工作区，故意不在根 lockfile 里）。 */
const requireFromE2e = createRequire(join(ROOT, 'e2e', 'package.json'));
const { chromium } = requireFromE2e('@playwright/test');

function startVite() {
  const child = spawn(
    viteBin,
    [join(ROOT, 'apps', 'web'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  /** vite 的输出要**攒下来并转发**：只报"它退出了"会吞掉真正的原因。 */
  const output = [];
  const onData = (buf) => {
    const text = buf.toString();
    output.push(text);
    process.stdout.write(text.replace(/^/gm, '   [vite] '));
  };

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite 启动超时（60s）')), 60_000);
    child.stdout.on('data', (buf) => {
      onData(buf);
      if (buf.toString().includes('ready in') || buf.toString().includes('Local:')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`vite 提前退出，code=${code}\n──── vite 输出 ────\n${output.join('')}`));
    });
  });
  return { child, ready };
}

const failures = [];
function check(label, condition, detail) {
  console.log(`  ${condition ? '✅' : '🔴'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!condition) failures.push(label);
}

async function main() {
  const { child, ready } = startVite();
  let browser;
  try {
    await ready;

    browser = await chromium.launch();
    const page = await browser.newPage();

    const console_ = [];
    page.on('console', (m) => console_.push(`[console.${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => console_.push(`[pageerror] ${e.message}`));

    await page.goto(`http://127.0.0.1:${PORT}/`);

    /**
     * 🔴 等应用**自己报出**后端。
     *
     * 设超时是因为"永远不出现"必须变成失败，而不是无限等 ——
     * 那正是"应用卡在启动、什么都不说"的形态。
     */
    await page.waitForFunction(() => globalThis.__heytaStorage !== undefined, undefined, {
      timeout: 60_000,
    });
    const reported = await page.evaluate(() => globalThis.__heytaStorage);
    console.log(`② 应用自报的存储后端：${JSON.stringify(reported)}`);

    check('应用选择的是 sqlite（不是静默回退到 indexeddb）', reported.backend === 'sqlite', `backend=${reported.backend}`);
    check(
      'clientId 来自 Worker 里的库',
      typeof reported.clientId === 'string' && reported.clientId.length > 0,
      `len=${reported.clientId?.length}`,
    );

    /** ③ OPFS 里必须真的有这个 VFS 目录 —— 这是**外部**证据，不是应用自己的话。 */
    const opfs = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names = [];
      for await (const [name] of root.entries()) names.push(name);
      return names;
    });
    console.log(`③ OPFS 根目录：${JSON.stringify(opfs)}`);
    check(
      `OPFS 里有 SQLite 的 VFS 目录（.${EXPECTED_VFS}）`,
      opfs.includes(`.${EXPECTED_VFS}`),
      `期望 .${EXPECTED_VFS}`,
    );

    /**
     * ④ 交叉验证：**造一点真实数据**，然后确认它落在 SQLite 而不是 IndexedDB。
     *
     * 只看"SQLite 有数据"还不够 —— 得同时确认**旧路径没有被写**，
     * 否则"两条路同时在写"也能让上面全绿（那是一个更糟的状态：
     * 数据分叉，而且没人知道）。
     */
    const cross = await page.evaluate(async ({ legacyName, clientId }) => {
      /** SQLite 侧：走**应用自己的 store 对象**（也就是那个 Worker 代理）。 */
      const storeMod = await import('/src/lib/oplog.ts');
      const store = storeMod.requireStore();
      const before = (await store.getAllOps()).length;

      /**
       * 真写一条。⚠️ 字段名必须照 `OP_FIELDS`（`id`、不是 `opId`）——
       * 用错字段会让唯一索引列变成 NULL，而 **SQLite 的 UNIQUE 允许多个 NULL**，
       * 于是去重静默失效（`packages/storage/probe/probe.js` 里有完整复盘）。
       */
      const appended = await store.appendLocal([
        {
          id: `verify-backend-${Date.now()}`,
          entityType: 'TASK',
          entityId: 'verify-backend',
          opType: 'CRT',
          payload: { title: '存储后端验证' },
          clientId,
          timestamp: Date.now(),
          vectorClock: { [clientId]: 1 },
          schemaVersion: 1,
        },
      ]);
      const after = (await store.getAllOps()).length;

      /**
       * IndexedDB 侧：绕开应用，自己开库数 —— 这样才不是"听应用说"。
       *
       * 🔴 **必须区分"库不存在"和"我没查成"。**
       *
       * 第一版把两者都压成 `<= 0` 然后断言"旧库里没有 op" —— 于是
       * `onerror`（压根没查成）也让它通过了。那是**把"不知道"当成"通过"**，
       * 比查出错更危险：它会在真正发生数据分叉时给出绿灯。
       * 现在 `onerror` 单独编码，并且**断言为失败**。
       */
      const idb = await new Promise((resolve) => {
        /**
         * ⚠️ **不要传版本号。** 传 `1` 会在库已经是版本 2 时报
         * `The requested version (1) is less than the existing version (2)` ——
         * 而这个错**看起来像"库有问题"，实际是探测方式错了**。
         * 不传版本时按现有版本打开；库不存在则新建（触发 onupgradeneeded）。
         */
        const req = indexedDB.open(legacyName);
        /** 库不存在 → onupgradeneeded 触发，此时必然是"没有 op"。 */
        req.onupgradeneeded = () => resolve({ state: 'absent', count: 0 });
        req.onerror = () =>
          resolve({ state: 'error', count: -1, message: String(req.error?.message ?? req.error) });
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('ops')) {
            resolve({ state: 'absent', count: 0 });
            return;
          }
          const tx = db.transaction('ops', 'readonly');
          const count = tx.objectStore('ops').count();
          count.onsuccess = () => resolve({ state: 'counted', count: count.result });
          count.onerror = () =>
            resolve({ state: 'error', count: -1, message: String(count.error?.message) });
        };
      });

      return { before, after, appended: appended.length, idb };
    }, { legacyName: LEGACY_DB_NAME, clientId: reported.clientId });

    console.log(`④ 交叉验证：${JSON.stringify(cross)}`);
    check(
      '经 Worker 代理写入成功，且条数增加',
      cross.appended === 1 && cross.after === cross.before + 1,
      `${cross.before} → ${cross.after}（写入 ${cross.appended}）`,
    );
    check(
      '旧 IndexedDB 这一侧**查得清楚**（不是"查不成"）',
      cross.idb.state !== 'error',
      cross.idb.state === 'error' ? `开库失败：${cross.idb.message}` : `state=${cross.idb.state}`,
    );
    check(
      '旧 IndexedDB 里没有 op（说明数据没有分叉到两条路）',
      cross.idb.state !== 'error' && cross.idb.count <= 0,
      `state=${cross.idb.state} count=${cross.idb.count}`,
    );

    /**
     * ⑤ 刷新后仍在 —— 证明写的是**真的落盘的库**，而不是内存。
     * 这一步把"后端选择正确"和"数据真的持久"接在一起。
     */
    await page.reload();
    await page.waitForFunction(() => globalThis.__heytaStorage !== undefined, undefined, {
      timeout: 60_000,
    });
    const afterReload = await page.evaluate(async () => {
      const storeMod = await import('/src/lib/oplog.ts');
      return (await storeMod.requireStore().getAllOps()).length;
    });
    console.log(`⑤ 刷新后 op 数：${afterReload}`);
    check('刷新后写入的 op 仍在（SQLite 真的落盘中）', afterReload >= cross.after, `${cross.after} → ${afterReload}`);


    await page.screenshot({ path: SHOT, fullPage: true });
    console.log(`📷 截图：${SHOT}`);

    if (failures.length > 0) {
      console.error(`\n──── 页面控制台 ────\n${console_.join('\n') || '（无输出）'}`);
      console.error(`🔴 失败 ${failures.length} 项：${failures.join('、')}`);
      process.exitCode = 1;
    } else {
      console.log('\n✅ 真的在用 Worker 里的 SQLite —— 应用自报 + OPFS 外部证据 + 旧路径未写，三者一致。');
    }
  } catch (error) {
    console.error(`🔴 验证脚本自身失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    child.kill('SIGTERM');
  }
}

await main();
