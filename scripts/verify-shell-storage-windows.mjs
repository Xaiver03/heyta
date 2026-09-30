#!/usr/bin/env node
/**
 * B（桌面端真应用存储 → 壳的 SQLite）：**Windows 端到端判据**
 * ==========================================================
 *
 * 它验的是一条**从界面上看不出来**的事：壳里那个真应用，到底把数据放在
 * **壳自己的 `heyta.sqlite`** 里，还是放在 WebView 自己的存储（OPFS）里。
 * 两条路都能让所有界面断言绿 —— 所以判据必须落在**进程外**。
 *
 * 用法（前置：壳已带 `-ShellStorage` 启动，且 CDP 隧道已开）：
 *
 *   ssh -N -L 127.0.0.1:9287:127.0.0.1:9287 windows-pc &
 *
 *   # ① 写：断言 backend=shell，并经界面建一条任务（标题带时间戳）
 *   HEYTA_WIN_CDP=http://127.0.0.1:9287 node scripts/verify-shell-storage-windows.mjs
 *
 *   # ② 读（**关掉应用再重开**之后跑）：断言那条任务仍在
 *   HEYTA_WIN_CDP=http://127.0.0.1:9287 node scripts/verify-shell-storage-windows.mjs --expect <①打印的标题>
 *
 *   # ⓪ 「OPFS → 壳」导入的**前置**：在**存储宿主关掉**的那一轮写一条（数据落 OPFS）
 *   HEYTA_WIN_CDP=http://127.0.0.1:9287 node scripts/verify-shell-storage-windows.mjs --legacy
 *   #   然后带 -ShellStorage 重开，再跑 ② —— 那条必须被导入壳的库里。
 *   #   判据链：⓪ 写进 OPFS ⇒（开关打开）⇒ ② 在壳后端下仍看得到 ⇒ 只可能来自导入。
 *
 * 🔴 ② 才是**持久性**判据：①写进去的 op 只存在于壳的 SQLite 里
 *    （那一轮的 WebView OPFS 从没见过它），所以重开还能看到它，
 *    只可能来自壳的库。只跑①会漏掉"进程一关就没了"。
 *
 * 前置：`@playwright/test` 在仓库根要能解析（本机实测可解析；若不能，
 * 先在 `e2e/` 下 `pnpm install` —— 那个 workspace 才是 playwright 的属主）。
 *
 * 它做两件事：
 *   1. 经 CDP 附着到壳里的真应用，断言 `__heytaStorage.backend === 'shell'`，
 *      并**经界面**建一条任务（标题带时间戳，供外面去库里找）；
 *   2. 打印 `RESULT {json}`（含标题）—— 第二步的"从壳外读 `.sqlite`"由调用方做：
 *
 *      ssh windows-pc "powershell -NoProfile -Command \"<读 %LOCALAPPDATA%\heyta\heyta.sqlite 的 ops 表>\""
 *
 * ⚠️ **为什么"从外面读文件"这一步不能省**：界面说"已保存"不是证据；
 *    `STORAGE=` 只证明页侧**选了**壳后端，不证明那一行真的落进了壳的库。
 *
 * 🔴 这张脚本 2026-09-30 只跑到一半：身份门与后端读取都工作，但当时
 *    Windows 上的 `apps/web/dist` 是**旧产物**（不含 `'shell'` 后端），
 *    所以它报的是 `BACKEND=sqlite`。**先重打 web 产物再跑它** —— 详见
 *    `docs/plans/desktop-storage-host-handoff.md`。
 */

import { chromium } from '@playwright/test';

const CDP = process.env['HEYTA_WIN_CDP'] ?? 'http://127.0.0.1:9287';
const ORIGIN = 'https://heyta.local';

/** 身份门：先证明连的是**我们的壳**，再连接（照 `e2e/windows-shell/helpers.ts`）。 */
const version = await (await fetch(`${CDP}/json/version`)).json();
if (!/^Edg\//.test(version.Browser ?? '') || !/Windows NT/.test(version['User-Agent'] ?? '')) {
  console.error(
    `❌ 身份门未通过：Browser=${String(version.Browser)} / UA=${String(version['User-Agent'])}`,
  );
  console.error('   ⇒ 拒绝继续：本机 Chrome 也常监听同一个端口，那不是被测对象。');
  process.exit(1);
}
const targets = await (await fetch(`${CDP}/json/list`)).json();
if (!targets.some((t) => t.type === 'page' && t.url.startsWith(`${ORIGIN}/`))) {
  console.error('❌ CDP 里没有 heyta.local 的页面目标 —— 壳加载的不是真应用');
  process.exit(1);
}

const browser = await chromium.connectOverCDP(CDP);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().startsWith(`${ORIGIN}/`));
if (page === undefined) {
  console.error('❌ 连接后找不到 heyta.local 页面');
  process.exit(1);
}

await page.locator('input[placeholder^="添加任务"]').waitFor({ state: 'visible', timeout: 60_000 });

const backend = await page.evaluate(
  () => (globalThis.__heytaStorage ?? {}).backend ?? null,
);
console.log(`BACKEND=${String(backend)}`);

/**
 * ⓪ 旧后端写入模式：**这一轮必须是"没有存储宿主"的**，数据才会落到 OPFS。
 *
 * 它存在的理由：要验"OPFS → 壳"的导入，必须先造出一个**只有 OPFS 有、壳没有**的数据；
 * 而这只能靠在存储宿主关闭的那一轮里写。若这一轮的 backend 已是 `shell`，
 * 那这条判据的前提就不成立（写进去的会直接进壳的库，什么都验不到）。
 */
if (process.argv.includes('--legacy')) {
  if (backend === 'shell') {
    console.error(
      '❌ --legacy 要求这一轮**没有**存储宿主（backend 应为 sqlite/indexeddb）。\n' +
        '   现在报的是 shell ⇒ 数据会直接进壳的库，验不到"导入"。',
    );
    process.exit(1);
  }
  const legacyTitle = `B-legacy-${String(Date.now())}`;
  const legacyComposer = page.locator('input[placeholder^="添加任务"]');
  await legacyComposer.fill(legacyTitle);
  await legacyComposer.press('Enter');
  await page
    .locator('[data-testid^="task-item-"]')
    .filter({ hasText: legacyTitle })
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.screenshot({ path: '/tmp/heyta-b-legacy-opfs.png' });
  console.log(`RESULT ${JSON.stringify({ mode: 'legacy-write', backend, title: legacyTitle })}`);
  process.exit(0);
}

if (backend !== 'shell') {
  console.error(
    `❌ 页侧报告的后端是 ${String(backend)}，不是 shell —— 存储宿主任没有生效。\n` +
      '   先确认：① 壳带 -ShellStorage 启动；② apps/web/dist 是**重打过**的（含 shell 后端）。',
  );
  process.exit(1);
}

const expectIndex = process.argv.indexOf('--expect');
const expected = expectIndex === -1 ? null : (process.argv[expectIndex + 1] ?? null);

/**
 * ② 读模式：**不**新建任务，只断言上一轮那条还在。
 *
 * 这是**持久性**判据。⚠️ 必须跑在"关掉应用再重开"之后 ——
 * 在同一个进程里查只能证明内存里还在，那是另一件事。
 */
if (expected !== null) {
  const rows = page.locator('[data-testid^="task-item-"]').filter({ hasText: expected });
  await rows.first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => undefined);
  const count = await rows.count();
  const visible = await page.locator('[data-testid^="task-item-"]').count();
  await page.screenshot({ path: '/tmp/heyta-b-shell-storage-persist.png' });
  if (count !== 1) {
    console.error(
      `❌ 找不到那条任务（titleCount=${String(count)}，当前共 ${String(visible)} 行）。\n` +
        '   两种用法下的含义不同：\n' +
        '   · 若上一轮是 `--legacy`（写进 OPFS）⇒ 说明 **OPFS→壳 的导入没生效**，\n' +
        '     而"已装用户会看到一个空应用"正是这一步要防的故障；\n' +
        '   · 若上一轮是写进壳的库 ⇒ 说明**数据没真的落在壳的 SQLite 里**。',
    );
    process.exit(1);
  }
  console.log(
    `RESULT ${JSON.stringify({ mode: 'read', backend, title: expected, titleCount: count })}`,
  );
  process.exit(0);
}

const title = `B-shell-storage-${String(Date.now())}`;
const composer = page.locator('input[placeholder^="添加任务"]');
await composer.fill(title);
await composer.press('Enter');
await page
  .locator('[data-testid^="task-item-"]')
  .filter({ hasText: title })
  .first()
  .waitFor({ state: 'visible', timeout: 60_000 });

await page.screenshot({ path: '/tmp/heyta-b-shell-storage.png' });

console.log(`RESULT ${JSON.stringify({ mode: 'write', backend, title })}`);
process.exit(0);
