#!/usr/bin/env node
/**
 * verify:collab-journey —— 共享清单真浏览器全旅程验收（ADR-0062 / 计划 §4 第四行）。
 * ================================================================================
 *
 * 与其它 verify:collab-* 的差别：被测对象是**真浏览器里的真应用** ——
 * 真服务端（TEST_MODE + 迁移过的 PostgreSQL）+ 真 vite 应用 + 两个真账号 +
 * 真 vault 建立 + 真共享密码学（身份种子 / ECIES 信封在浏览器里真跑）。
 *
 * 步骤（由 e2e/tests/collab-journey.spec.ts 驱动 UI，本脚本只负责环境与读数）：
 *   1. 环境：验收库 + 迁移 + 服务端（TEST_MODE）+ vite dev。
 *   2. Playwright 双 context（owner / bob）跑旅程：
 *      owner 建清单 → 头部「共享」→ PIPL 同独同意 → 面板 → 邀请（一次性凭证）；
 *      bob vault → 贴 token 入群 → owner 自动封信封 → bob 解钥 → 清单落侧栏；
 *      owner 面板对账出第二个成员。
 *   3. 证据：截图落 `e2e/test-results/collab-journey/`（固定路径，先截图再断言，
 *      console/pageerror 从页面创建起监听）—— **人必须打开看**（AGENTS §6.2 规定一）。
 *
 * 🔴 变异臂（证明判据有牙）：
 *   把 `ShareFeature.tsx` 里 autoSeal 那个 useEffect 注释掉（owner 不再自动
 *   下发信封）⇒ bob 停在「等待所有者分发密钥」⇒ `share-join-done` 超时 ⇒
 *   恰好这一条红。还原后必须复绿。
 *
 * 用法：
 *   node scripts/verify-collab-journey.mjs [--port 3217] [--web-port 4327]
 *
 * 失败退出码 1 并打印 `RESULT=FAIL step=N`；通过打印 `RESULT=OK steps=3`。
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv;
const flag = (name, fallback) => {
  const idx = argv.indexOf(`--${name}`);
  return idx >= 0 ? argv[idx + 1] : fallback;
};
const PORT = flag('port', '3217');
const WEB_PORT = flag('web-port', '4327');
const BASE = `http://127.0.0.1:${PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

const DB_NAME = process.env.HEYTA_VERIFY_DB_NAME ?? 'heyta_sync_smoke';
const DB_URL =
  process.env.HEYTA_VERIFY_DATABASE_URL ??
  `postgresql://${process.env.PGUSER ?? process.env.USER ?? os.userInfo().username}@127.0.0.1:5432/${DB_NAME}?schema=public&connection_limit=5&pool_timeout=10`;
const PSQL_URL = DB_URL.split('?')[0];

let step = 0;
const children = [];
const cleanup = () => { for (const c of children) if (c.exitCode === null) c.kill('SIGTERM'); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const fail = (reason) => {
  console.error(`RESULT=FAIL step=${step} reason=${reason}`);
  cleanup();
  process.exit(1);
};
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

console.log('\n=== verify:collab-journey —— 共享清单真浏览器全旅程 ===\n');

// ── 1. 环境：库 + 迁移 + 服务端 + vite ─────────────────────────────────────
step = 1;
const dbExists = run('psql', ['-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`, PSQL_URL]);
if (!dbExists.out.includes('1')) {
  const created = run('createdb', [DB_NAME]);
  if (!created.ok) fail(`createdb 失败：${created.out.slice(-200)}`);
}
const migrated = run('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: join(ROOT, 'server'),
  env: { ...process.env, DATABASE_URL: DB_URL },
});
if (!migrated.ok) fail(`迁移失败：${migrated.out.trim().slice(-500)}`);

const server = spawn(process.execPath, ['dist/src/index.js'], {
  cwd: join(ROOT, 'server'),
  env: {
    ...process.env,
    DATABASE_URL: DB_URL,
    NODE_ENV: 'test',
    TEST_MODE: 'true',
    TEST_MODE_CONFIRM: 'yes-i-understand-the-risks',
    PORT,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(server);
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d.toString()));
server.stderr.on('data', (d) => (serverLog += d.toString()));

const vite = spawn('pnpm', ['--filter', '@heyta/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', WEB_PORT, '--strictPort'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(vite);
let viteLog = '';
vite.stdout.on('data', (d) => (viteLog += d.toString()));
vite.stderr.on('data', (d) => (viteLog += d.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitHttp = async (url, label, log, proc) => {
  for (let i = 0; i < 80; i += 1) {
    await sleep(500);
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    if (proc.exitCode !== null) break;
  }
  fail(`${label} 未就绪。日志尾部：\n${log.split('\n').slice(-20).join('\n')}`);
};
// 服务端的就绪探针走真造号端点（与 verify-collab-sync 同一个）；vite 探针打根路径。
await (async () => {
  for (let i = 0; i < 80; i += 1) {
    await sleep(500);
    try {
      const res = await fetch(`${BASE}/api/test/create-user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `journey-ready-${Date.now()}@example.com`, password: 'ready-probe-password' }),
      });
      if (res.ok) return;
    } catch { /* 还没起来 */ }
    if (server.exitCode !== null) break;
  }
  fail(`服务端未就绪。日志尾部：\n${serverLog.split('\n').slice(-20).join('\n')}`);
})();
await waitHttp(WEB_URL, 'vite dev', viteLog, vite);
console.log('STEP 1 OK 环境就绪（服务端 + vite + 迁移过的库）');

// ── 2. Playwright 旅程 ─────────────────────────────────────────────────────
step = 2;
const pw = run('pnpm', ['--filter', '@heyta/e2e', 'exec', 'playwright', 'test', '--config', 'playwright.collab.config.ts', 'tests/collab-journey.spec.ts'], {
  cwd: join(ROOT, 'e2e'),
  env: {
    ...process.env,
    HEYTA_COLLAB_BASE: BASE,
    HEYTA_COLLAB_WEB_URL: WEB_URL,
  },
});
if (!pw.ok) {
  console.error(pw.out.slice(-4000));
  fail('Playwright 旅程失败（上方是失败用例与断言；证据图在 e2e/test-results/collab-journey/）');
}
console.log('STEP 2 OK 真浏览器旅程通过（owner 邀请 → bob 入群 → 双方成员对账）');

// ── 3. 证据收口 ────────────────────────────────────────────────────────────
step = 3;
const evidence = run('ls', ['-1', join(ROOT, 'e2e/test-results/collab-journey')]);
const shots = evidence.out.split('\n').filter((l) => l.endsWith('.png'));
const EXPECTED = [
  '01-owner-list-ready.png',
  '02-owner-consent-modal.png',
  '03-owner-panel-created.png',
  '04-owner-invite-ticket.png',
  '05-bob-join-dialog.png',
  '06-bob-joined.png',
  '07-owner-sees-bob.png',
];
const missing = EXPECTED.filter((name) => !shots.includes(name));
if (missing.length > 0) fail(`证据图缺：${missing.join('、')}（拍了才算，路径固定）');
console.log(`STEP 3 OK 证据齐（${shots.length} 张）`);
console.log(`📸 人要看图：${join(ROOT, 'e2e/test-results/collab-journey')}`);

cleanup();
console.log('RESULT=OK steps=3');
