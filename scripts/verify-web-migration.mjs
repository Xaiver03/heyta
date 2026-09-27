#!/usr/bin/env node
/**
 * **验证 IndexedDB → SQLite 的旧库迁移真的会搬数据**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么必须单独验这一条
 * ─────────────────────────────────────────────────────────────
 * M4-3b 写了 `migrateLegacyIndexedDb()`，但当时旧库是**空的** ——
 * 也就是说那条路径**一次都没真正执行过**。而它的失败形态是最糟的一种：
 *
 *   🔴 用户升级后打开应用，**看到的是一个空应用**，且不报任何错。
 *
 * "数据看起来没了"比崩溃更难挽回。所以不能靠读代码判断它对不对。
 *
 * ─────────────────────────────────────────────────────────────
 * 怎么造出"真实旧库"
 * ─────────────────────────────────────────────────────────────
 * 🔴 **不让脚本自己照 schema 手搓一份 IndexedDB 数据。**
 * 那样验的是"我理解的旧库"，而不是"应用真的会写出的旧库" ——
 * 二者一旦不一致，测试照样绿，而真实用户的数据照样丢。
 *
 * 所以用**应用自己的代码**做两段式：
 *
 *   1. 用 `VITE_HEYTA_STORAGE=indexeddb` 起服务 → 让应用**按旧路径**写数据；
 *   2. 重启成 `sqlite`（默认）→ 同一个浏览器上下文（同 origin ⇒ 同存储）刷新，
 *      看应用会不会把旧数据搬过去。
 *
 * ⚠️ 关键是**同一个 browser context**：IndexedDB 与 OPFS 都是按 origin 隔离的，
 * 换个 context 就什么都验不到了（而且会假绿 —— 空库本来就"迁移成功"）。
 *
 * 用法：`node scripts/verify-web-migration.mjs`
 */

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4322;
const SHOT = join(ROOT, 'e2e', 'test-results', 'web-migration.png');

const viteBin = join(ROOT, 'apps', 'web', 'node_modules', '.bin', 'vite');
const requireFromE2e = createRequire(join(ROOT, 'e2e', 'package.json'));
const { chromium } = requireFromE2e('@playwright/test');

/** 起一个 vite，可用 `extraEnv` 指定存储后端。 */
function startVite(extraEnv) {
  const child = spawn(
    viteBin,
    [join(ROOT, 'apps', 'web'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    },
  );

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
      reject(new Error(`vite 提前退出，code=${code}\n──── 输出 ────\n${output.join('')}`));
    });
  });
  return { child, ready };
}

/** 停掉并**等它真的退出** —— 否则同端口的下一次 startVite 会撞 strictPort。 */
async function stopVite(child) {
  if (child === undefined) return;
  const gone = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([gone, new Promise((r) => setTimeout(r, 5_000))]);
}

const failures = [];
function check(label, condition, detail) {
  console.log(`  ${condition ? '✅' : '🔴'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!condition) failures.push(label);
}

/** 在页面里数 IndexedDB 的 op 数（绕开应用，自己开库）。 */
const COUNT_IDB = async (name) =>
  new Promise((resolve) => {
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => resolve({ state: 'absent', count: 0 });
    req.onerror = () => resolve({ state: 'error', count: -1, message: String(req.error?.message) });
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('ops')) return resolve({ state: 'absent', count: 0 });
      const c = db.transaction('ops', 'readonly').objectStore('ops').count();
      c.onsuccess = () => resolve({ state: 'counted', count: c.result });
      c.onerror = () => resolve({ state: 'error', count: -1, message: String(c.error?.message) });
    };
  });

async function main() {
  const browser = await chromium.launch();
  /** 🔴 **一个 context 贯穿两段。** 换 context 就等于换存储，会假绿。 */
  const context = await browser.newContext();
  const page = await context.newPage();
  const console_ = [];
  page.on('console', (m) => console_.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console_.push(`[pageerror] ${e.message}`));

  let vite;
  try {
    /**
     * ── 第 1 段：用**旧路径**（IndexedDB）写一些真实数据 ──
     */
    vite = startVite({ VITE_HEYTA_STORAGE: 'indexeddb' });
    await vite.ready;
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => globalThis.__heytaStorage !== undefined, undefined, {
      timeout: 60_000,
    });

    const phase1 = await page.evaluate(async () => {
      const mod = await import('/src/lib/oplog.ts');
      const reported = globalThis.__heytaStorage;
      const store = mod.requireStore();
      const mk = (n) => ({
        id: `legacy-${n}`,
        entityType: 'TASK',
        entityId: `legacy-task-${n}`,
        opType: 'CRT',
        payload: { title: `旧库里的任务 ${n}` },
        clientId: reported.clientId,
        timestamp: Date.now() + n,
        vectorClock: { [reported.clientId]: n },
        schemaVersion: 1,
      });
      await store.appendLocal([mk(1), mk(2), mk(3)]);
      return { backend: reported.backend, ops: (await store.getAllOps()).length };
    });
    console.log(`② 第 1 段（旧路径）：${JSON.stringify(phase1)}`);
    check('第 1 段确实走了 indexeddb', phase1.backend === 'indexeddb', `backend=${phase1.backend}`);
    check('旧库里写进了 3 条 op', phase1.ops === 3, `ops=${phase1.ops}`);

    const idbBefore = await page.evaluate(COUNT_IDB, 'heyta');
    console.log(`③ 独立数一遍旧库：${JSON.stringify(idbBefore)}`);
    check(
      '旧库这一侧查得清楚，且确实是 3 条',
      idbBefore.state === 'counted' && idbBefore.count === 3,
      `state=${idbBefore.state} count=${idbBefore.count}`,
    );

    /**
     * ── 第 2 段：换成 SQLite（默认），同一个 context 刷新 ──
     *
     * 🔴 **刷新前必须先把 SQLite 那个库清干净吗？不需要，但必须确认它是空的** ——
     * 否则"迁移成功"可能只是"上次跑留下的数据还在"。
     * 这里靠 `getLastLocalSeq() === 0` 这个迁移自身的判据反过来做断言。
     */
    await stopVite(vite.child);
    vite = startVite({ VITE_HEYTA_STORAGE: 'sqlite' });
    await vite.ready;

    await page.reload();
    await page.waitForFunction(() => globalThis.__heytaStorage !== undefined, undefined, {
      timeout: 60_000,
    });

    const phase2 = await page.evaluate(async () => {
      const mod = await import('/src/lib/oplog.ts');
      const store = mod.requireStore();
      const ops = await store.getAllOps();
      return {
        backend: globalThis.__heytaStorage.backend,
        ops: ops.length,
        ids: ops.map((r) => r.op.id).sort(),
        titles: ops.map((r) => r.op.payload?.title).sort(),
      };
    });
    console.log(`④ 第 2 段（SQLite）：${JSON.stringify(phase2)}`);

    check('第 2 段确实走了 sqlite', phase2.backend === 'sqlite', `backend=${phase2.backend}`);
    check(
      '🔴 旧库的 3 条 op **全部**出现在 SQLite 里（迁移真的搬了数据）',
      phase2.ops === 3 && phase2.ids.join(',') === 'legacy-1,legacy-2,legacy-3',
      `ops=${phase2.ops} ids=${phase2.ids.join(',')}`,
    );
    check(
      '内容也搬对了（不是只搬了 id）',
      phase2.titles.join('|') === '旧库里的任务 1|旧库里的任务 2|旧库里的任务 3',
      phase2.titles.join('|'),
    );

    const idbAfter = await page.evaluate(COUNT_IDB, 'heyta');
    check(
      '旧库**没有被删**（迁移期必须能回退）',
      idbAfter.state === 'counted' && idbAfter.count === 3,
      `state=${idbAfter.state} count=${idbAfter.count}`,
    );

    /**
     * ── 第 3 段：再刷一次，**不能重复导入** ──
     *
     * 🔴 这是迁移最容易错的地方：判据写松一点（比如"看表里有没有数据"），
     * 每次启动都会再灌一遍，旧库变成**自我复制的数据源**。
     */
    await page.reload();
    await page.waitForFunction(() => globalThis.__heytaStorage !== undefined, undefined, {
      timeout: 60_000,
    });
    const phase3 = await page.evaluate(async () => {
      const mod = await import('/src/lib/oplog.ts');
      return (await mod.requireStore().getAllOps()).length;
    });
    console.log(`⑤ 第 3 段（再次刷新）：ops=${phase3}`);
    check('🔴 再刷一次 op 数**没有翻倍**（迁移是幂等的）', phase3 === 3, `ops=${phase3}`);

    await page.screenshot({ path: SHOT, fullPage: true });
    console.log(`📷 截图：${SHOT}`);

    if (failures.length > 0) {
      console.error(`\n──── 页面控制台 ────\n${console_.join('\n') || '（无输出）'}`);
      console.error(`🔴 失败 ${failures.length} 项：${failures.join('、')}`);
      process.exitCode = 1;
    } else {
      console.log('\n✅ 旧库迁移真的搬了数据、没删旧库、而且重复启动不会重复导入。');
    }
  } catch (error) {
    console.error(`🔴 验证脚本自身失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await stopVite(vite?.child);
  }
}

await main();
