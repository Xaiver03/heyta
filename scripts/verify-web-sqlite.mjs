/**
 * 真浏览器验证 web 端的 SQLite（OPFS）
 * =====================================
 *
 * 用法：`node scripts/verify-web-sqlite.mjs`
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么必须单独有这么一个脚本
 * ─────────────────────────────────────────────────────────────
 * `SqliteWasmDriver` 里其实有**两件不同的事**：
 *
 *   1. 把 `oo1.DB` 映射成 `SqliteDriver`（绑定、行形状、幂等关闭、唯一冲突）
 *   2. 用 **OPFS** 真的打开一个库
 *
 * 第 1 件由 `packages/storage/tests/contract.spec.ts` 在 Node 里用内存库覆盖 ——
 * 快、且失败时指向清楚。第 2 件**只能在浏览器里做**，因为 OPFS 只存在于浏览器。
 *
 * 把两件事混在一起测的代价是：连"绑定参数对不对"都要靠真浏览器去兜。
 * 分开之后这个脚本只负责第 2 件，而且它验的东西是 Node 里**根本验不了**的：
 *
 *   · SAH Pool VFS 能不能在这个浏览器里装上
 *   · 写进去的东西**刷新页面后还在不在**（这是 OPFS 与内存的分界线）
 *   · 唯一约束在真浏览器的运行时里判不判得出来
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 截图是硬性要求（AGENTS.md §6.2）
 * ─────────────────────────────────────────────────────────────
 * 这个脚本**一定会截一张图**并打印路径。界面类结论只有图能当证据 ——
 * 而且"探针跑了但页面是白的"这种事故，只有图能看出来。
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROBE_DIR = join(ROOT, 'packages', 'storage', 'probe');
const SHOT_DIR = join(ROOT, 'e2e', 'test-results');
const SHOT = join(SHOT_DIR, 'web-sqlite-opfs.png');
const PORT = 4321;

/**
 * 🔴 从 `apps/web` 取 `vite` —— 它不在根 `node_modules` 里。
 *
 * 与 `package-desktop.mjs` 从 `apps/desktop` 解析 `@electron/packager` 同一个理由：
 * pnpm 不做幽灵依赖提升，脚本住在根 `scripts/`，按常理解析会落到根
 * `node_modules`（那里没有它），报 `Cannot find package 'vite'` ——
 * 那个报错看起来像"没装"，实际是"解析起点不对"。
 *
 * ⚠️ 直接走 **`.bin/vite` 这个可执行 shim**，不走 `require.resolve('vite/bin/vite.js')`：
 * vite 的 `exports` 只暴露了 `.` / `./client` / `./module-runner` 等几个子路径，
 * `./bin/vite.js` **不在**其中，解析会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。
 * 那个报错看起来像"包装坏了"，实际是"这个子路径本来就不许解析"。
 */
const viteBin = join(ROOT, 'apps', 'web', 'node_modules', '.bin', 'vite');

/** Playwright 住在 `e2e/`（它是**独立的工作区**，故意不在根 lockfile 里）。 */
const requireFromE2e = createRequire(join(ROOT, 'e2e', 'package.json'));
const { chromium } = requireFromE2e('@playwright/test');

function startVite() {
  const child = spawn(
    viteBin,
    /**
     * ⚠️ 根目录是**位置参数**，不是 `--root`。
     * vite 7 里写 `--root` 会直接 `CACError: Unknown option '--root'` ——
     * 而那个报错来自 CAC 的参数解析，看起来像"命令用错了"，
     * 实际只是"这个版本不收这个选项"。位置形式在 5/6/7 上都成立。
     */
    [PROBE_DIR, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  /**
   * 🔴 把 vite 的输出**攒下来并转发**，不要只用来判断就绪。
   *
   * 第一版只拿它做"看到 ready in 就算起来了"，于是 vite 以 code=1 退出时
   * 我只拿到一句 `vite 提前退出，code=1` —— **真正的原因被这个管道吞掉了**。
   * 一个只说"它退出了"的错误，比没有错误更浪费时间。
   */
  const output = [];
  const onData = (buf) => {
    const text = buf.toString();
    output.push(text);
    process.stdout.write(text.replace(/^/gm, '   [vite] '));
  };

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite 启动超时（30s）')), 30_000);
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

/** 读页面里的探针结果。故意不设超时兜底 —— 让"永远不出现"直接变成失败。 */
async function readProbe(page) {
  await page.waitForFunction(() => window.__heytaSqliteProbe !== undefined, undefined, {
    timeout: 60_000,
  });
  return page.evaluate(() => window.__heytaSqliteProbe);
}

/**
 * 读**桥接探针**（`__heytaOpLogProbe`）的结果。
 *
 * ⚠️ 它与裸驱动探针是**两个独立的 async 流程**，谁先完成不确定 ——
 * 所以各自等各自的，不要把两者的完成顺序写进假设。
 */
async function readOpLogProbe(page) {
  await page.waitForFunction(() => window.__heytaOpLogProbe !== undefined, undefined, {
    timeout: 60_000,
  });
  return page.evaluate(() => window.__heytaOpLogProbe);
}

const failures = [];
function check(label, condition, detail) {
  const mark = condition ? '✅' : '🔴';
  console.log(`  ${mark} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!condition) failures.push(label);
}

async function main() {
  if (!existsSync(PROBE_DIR)) {
    console.error(`🔴 找不到探针目录：${PROBE_DIR}`);
    process.exit(1);
  }
  mkdirSync(SHOT_DIR, { recursive: true });

  const { child, ready } = startVite();
  let browser;
  try {
    await ready;
    console.log(`① vite 已就绪：http://127.0.0.1:${PORT}/`);

    browser = await chromium.launch();
    const page = await browser.newPage();

    const console_ = [];
    page.on('console', (m) => console_.push(`[console.${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => console_.push(`[pageerror] ${e.message}`));

    await page.goto(`http://127.0.0.1:${PORT}/`);
    const first = await readProbe(page);
    console.log('② 首轮探针结果：');
    for (const s of first.steps ?? []) console.log(`     ${s.name}${s.detail === undefined ? '' : ` → ${JSON.stringify(s.detail)}`}`);

    check('探针没有报错', first.status === 'ok', first.error);
    check('OPFS 里写进了一行', first.rowCount >= 1, `rowCount=${first.rowCount}`);

    // 🔴 关键：**刷新页面**后再读。跨刷新仍在，才是 OPFS 而不是内存。
    await page.reload();
    const second = await readProbe(page);
    console.log('③ 刷新后探针结果：');
    for (const s of second.steps ?? []) console.log(`     ${s.name}${s.detail === undefined ? '' : ` → ${JSON.stringify(s.detail)}`}`);

    check('刷新后数据仍在（OPFS 真的落盘）', (second.rowCount ?? 0) >= 1, `rowCount=${second.rowCount}`);
    check('刷新后没有重复插入（说明读到的是既有数据）', (second.rowCount ?? 0) === (first.rowCount ?? -1));
    check('唯一冲突在真浏览器里被判定', second.uniqueDetected === true);
    check('close() 幂等（连关两次不抛）', second.status === 'ok');

    /** 记录事实但**不断言**：FTS5 是能力协商项，不是所有运行时的前提（ADR-0027 §5）。 */
    console.log(`  ℹ️  本浏览器 FTS5：${second.fts5 === true ? '支持' : '不支持'}`);

    /**
     * 🔴 **M4-3 的端到端判据**：主线程经真 `postMessage` 操作 Worker 里的 SQLite。
     *
     * 与上面裸驱动探针的分工：那边验的是"OPFS 在真浏览器可用"，
     * 这边验的是"**web 最终要用的那套接线**（真实 schema + 桥接 + 主线程代理）成立"。
     * 之前所有验证都跑在 Worker 内部，而真正要迁过去的是**主线程的调用方式** ——
     * 这一块从来没被验过。
     */
    console.log('④ 桥接探针（主线程 → Worker 里的真实 schema）首轮：');
    const oplogFirst = await readOpLogProbe(page);
    for (const s of oplogFirst.steps ?? []) {
      console.log(`     ${s.name}${s.detail === undefined ? '' : ` → ${JSON.stringify(s.detail)}`}`);
    }
    check('桥接探针没有报错', oplogFirst.status === 'ok', oplogFirst.error);
    check(
      'clientId 由 Worker 里的库给出（不是主线程自己算的）',
      typeof oplogFirst.clientId === 'string' && oplogFirst.clientId.length > 0,
      `len=${oplogFirst.clientId?.length}`,
    );
    check('经桥接写入的 op 被读回', (oplogFirst.opCount ?? 0) >= 1, `opCount=${oplogFirst.opCount}`);
    check(
      'payload 跨线程往返逐字节未变（能被结构化克隆）',
      (oplogFirst.steps ?? []).some((s) => s.detail?.payloadRoundTripped === true),
    );
    check(
      '重复 opId 被唯一索引吸收（不报错、不多一条）',
      (oplogFirst.steps ?? []).some(
        (s) => s.detail?.appendedByDuplicate === 0 && s.detail?.totalAfterDuplicate === oplogFirst.opCount,
      ),
    );
    check(
      '同步游标经桥接往返（最容易漏转发的方法）',
      oplogFirst.serverSeq === 7,
      `serverSeq=${oplogFirst.serverSeq}`,
    );

    /** 桥接这条路也必须跨刷新持久 —— 它用的是**另一个库文件**。 */
    await page.reload();
    const oplogSecond = await readOpLogProbe(page);
    console.log('⑤ 桥接探针刷新后：');
    for (const s of oplogSecond.steps ?? []) {
      console.log(`     ${s.name}${s.detail === undefined ? '' : ` → ${JSON.stringify(s.detail)}`}`);
    }
    check('刷新后 op 仍在（桥接这条路也真的落盘）', (oplogSecond.opCount ?? 0) >= 1, `opCount=${oplogSecond.opCount}`);
    check(
      '刷新后 op 数没有翻倍（说明读到的是既有数据，不是又写了一遍）',
      (oplogSecond.opCount ?? -1) === (oplogFirst.opCount ?? -2),
    );

    /**
     * 🔴 截图放在**两个探针都报完之后**。
     *
     * 早一点拍会拍到"⏳ 进行中…"，那张图**证明不了任何事** ——
     * 而这条规定存在的原因正是"图要能说明问题"（AGENTS.md §6.2）。
     */
    await page.screenshot({ path: SHOT, fullPage: true });
    console.log(`📷 截图（两个探针都完成后）：${SHOT}`);

    if (failures.length > 0) {
      console.error(`\n──── 页面控制台 ────\n${console_.join('\n') || '（无输出）'}`);
      console.error(`🔴 失败 ${failures.length} 项：${failures.join('、')}`);
      process.exitCode = 1;
    } else {
      console.log('\n✅ 全部通过 —— OPFS 路径在真浏览器里可用，且跨刷新持久。');
    }
  } finally {
    await browser?.close();
    child.kill('SIGTERM');
  }
}

await main();
