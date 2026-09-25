#!/usr/bin/env node
/**
 * P2 验收：非 Web 宿主真的在跑整条栈
 * =====================================
 *
 * 这条脚本回答的**不是**「Node 宿主能不能编译」，而是 ADR-0003 §2.1 那句
 * 「所有业务逻辑必须在 packages/ 里，apps/* 只允许放平台外壳」到底是不是真的。
 *
 * 判据：把同样的 packages 零件接到一个**完全不同的宿主**上 ——
 * 真实 SQLite 文件、真实子进程、真实 HTTP、真实 Fastify、真实 PostgreSQL ——
 * 它能不能完成和 Web 端一样的读写与双向同步。没有一处 mock。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这里的宿主是**逐条命令一个新进程**，而不是一个常驻进程：
 *
 * 那正是「本地优先」与「缓存」的分界线。
 *   - 常驻进程里读回数据 → 可能只是内存里还在，证明不了落盘；
 *   - 每次 `add` / `list` / `sync` 都是新进程 → 内存必然从零重建，
 *     数据只能来自 SQLite 文件。任务还在，就是真的持久化。
 *
 * 另外脚本还会**绕过适配器**，直接用 `node:sqlite` 打开同一个文件读原始行 ——
 * 如果数据只在适配器的内部状态里、没真的写进表，这一关会露馅。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 用法：
 *   node scripts/verify-p2-node-host.mjs
 *   node scripts/verify-p2-node-host.mjs --port 3211
 *
 * 失败时退出码非 0，并保留临时目录便于排查。
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

/**
 * 找一个**可以真正 spawn** 的 node（同 verify-p1-sync.mjs）。
 *
 * 不要用 `process.execPath`：在某些封装运行时里它指向不能独立启动的垫片，
 * spawn 会以 ENOENT 失败且报错毫无指向性。也不要写死 'node' —— PATH 里未必有。
 */
function resolveNode() {
  if (process.env.HEYTA_NODE) return process.env.HEYTA_NODE;

  const home = process.env.HOME ?? '';
  const candidates = [
    `${home}/.nvm/versions/node/v22.22.3/bin/node`,
    `${home}/.nvm/versions/node/v22.22.0/bin/node`,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ];
  for (const c of candidates) if (existsSync(c)) return c;

  try {
    const found = execFileSync('sh', ['-c', 'which -a node'], { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((p) => !/DSH Desktop|runtime-commands/.test(p));
    for (const f of found) if (existsSync(f)) return f;
  } catch {
    // 没找到
  }

  return process.execPath;
}

const NODE = resolveNode();

// ⚠️ 必须用 fileURLToPath，不能用 `new URL(...).pathname` ——
// 后者会把路径里的空格转义成 %20，spawn 随后抛 ENOENT 指向一个明明存在的二进制。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'apps', 'node-host', 'dist', 'cli.js');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? args[portIdx + 1] : '3211';
const BASE = `http://127.0.0.1:${PORT}`;

const PASSWORD = 'p2-node-host-correct-horse-battery-staple';
const TASK_TITLE = `P2 Node 宿主验证任务 ${String(Date.now())}`;
const B_TITLE = `${TASK_TITLE}（B 改的）`;

// 验收库与 P1 分开：两边可以独立重跑，互不干扰。
const DEFAULT_DB_NAME = 'heyta_p2_node_host_smoke';
const DB_NAME = process.env.HEYTA_VERIFY_DB_NAME ?? DEFAULT_DB_NAME;

function defaultDbUser() {
  return (
    process.env.HEYTA_VERIFY_DB_USER ??
    process.env.PGUSER ??
    process.env.USER ??
    process.env.LOGNAME ??
    os.userInfo().username
  );
}

const DB_URL =
  process.env.HEYTA_VERIFY_DATABASE_URL ??
  `postgresql://${defaultDbUser()}@127.0.0.1:5432/${DB_NAME}?schema=public&connection_limit=5&pool_timeout=10`;

let server;

const cleanup = () => {
  if (server && server.exitCode === null) server.kill('SIGTERM');
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

class VerificationError extends Error {}

function check(condition, message) {
  if (!condition) throw new VerificationError(message);
}

// ─────────────────────────────────────────────────────────────
// 环境准备（复用 verify-p1-sync.mjs 的做法）
// ─────────────────────────────────────────────────────────────

function run(cmd, cmdArgs, options = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...options });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function psqlAvailable() {
  return run('psql', ['--version']).ok;
}

/**
 * 把 Prisma 的 URL 转成 libpq 能懂的 URL。
 * psql 不认 `?schema=public` / `connection_limit` / `pool_timeout`。
 */
function toLibpqUrl(url) {
  const u = new URL(url);
  for (const key of ['schema', 'connection_limit', 'pool_timeout']) {
    u.searchParams.delete(key);
  }
  u.search = u.searchParams.toString();
  return u.toString();
}

function ensureDatabase() {
  if (!psqlAvailable()) {
    console.log('⚠️  找不到 psql，跳过建库 —— 若库不存在，验收会在服务端启动阶段失败');
    return;
  }

  const adminUrl = toLibpqUrl(DB_URL.replace(/\/[^/?]+\?/, '/postgres?'));
  const exists = run('psql', [adminUrl, '-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`]);
  if (exists.out.trim() === '1') {
    console.log('· 验收库已存在');
  } else {
    console.log('· 验收库不存在，创建中…');
    const created = run('psql', [adminUrl, '-c', `CREATE DATABASE "${DB_NAME}"`]);
    if (!created.ok) {
      const recheck = run('psql', [adminUrl, '-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`]);
      if (recheck.out.trim() !== '1') {
        console.error(`❌ 建库失败：${created.out.trim().slice(0, 300)}`);
        process.exit(1);
      }
    }
  }

  console.log('· 应用迁移…');
  const shim = `${ROOT}research/tools/macos-sed-shim`;
  const migrated = run('sh', ['scripts/migrate-deploy.sh'], {
    cwd: `${ROOT}server`,
    env: {
      ...process.env,
      DATABASE_URL: DB_URL,
      PATH: `${shim}:${process.env.PATH ?? ''}`,
    },
  });
  if (!migrated.ok) {
    console.error(`❌ 迁移失败：\n${migrated.out.trim().slice(-800)}`);
    process.exit(1);
  }
  console.log('· 迁移完成');
}

// ─────────────────────────────────────────────────────────────
// 宿主子进程
// ─────────────────────────────────────────────────────────────

let TOKEN = '';

/**
 * 跑一条宿主命令。**每次调用都是一个新的 node 进程** ——
 * 这正是「数据来自磁盘而不是内存」的证明方式。
 */
function hostRun(dbPath, commandArgs) {
  const r = spawnSync(
    NODE,
    [
      CLI,
      '--db',
      dbPath,
      '--server',
      BASE,
      '--token',
      TOKEN,
      '--password',
      PASSWORD,
      '--json',
      ...commandArgs,
    ],
    {
      encoding: 'utf8',
      // node:sqlite 的实验警告是**预期内**的；每命令一个进程会把输出淹掉。
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    },
  );
  return r;
}

/** 跑一条宿主命令并要求成功，返回解析后的 JSON。 */
function hostJson(label, dbPath, commandArgs) {
  const r = hostRun(dbPath, commandArgs);
  if (r.status !== 0) {
    throw new VerificationError(
      `宿主命令失败（${label}：${commandArgs.join(' ')}），exit=${String(r.status)}\n` +
        `stdout: ${(r.stdout ?? '').trim()}\n` +
        `stderr: ${(r.stderr ?? '').trim().slice(0, 800)}`,
    );
  }
  try {
    return JSON.parse((r.stdout ?? '').trim());
  } catch {
    throw new VerificationError(
      `宿主输出不是 JSON（${label}）：${(r.stdout ?? '').trim().slice(0, 400)}`,
    );
  }
}

/** 直接用 node:sqlite 读原始行 —— 绕过宿主与适配器，证明数据真的在表里。 */
function readRawOps(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare('SELECT data FROM ops ORDER BY pk0')
      .all()
      .map((row) => JSON.parse(String(row.data)));
  } finally {
    db.close();
  }
}

function readRawMeta(dbPath, key) {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare('SELECT data FROM meta WHERE pk0 = ?').get(key);
    return row === undefined ? undefined : JSON.parse(String(row.data));
  } finally {
    db.close();
  }
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

console.log('\n=== P2 验收：非 Web 宿主（真实 SQLite + 真实服务端，零 mock）===\n');

if (process.env.DATABASE_URL) {
  console.log('⚠️  检测到环境变量 DATABASE_URL，已用验收库覆盖（避免污染）');
}

console.log(`· node: ${NODE}`);
console.log(`· 数据库: ${DB_NAME}`);
console.log(`· 宿主 CLI: ${CLI}`);

if (!existsSync(CLI)) {
  console.error(`❌ 找不到宿主 CLI：${CLI}\n   先跑 \`pnpm -r build\`（或 \`pnpm --filter @heyta/node-host build\`）。`);
  process.exit(1);
}

ensureDatabase();

console.log(`· 启动服务端（端口 ${PORT}，TEST_MODE）…`);
server = spawn(NODE, ['dist/src/index.js'], {
  cwd: `${ROOT}server`,
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

let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d.toString()));
server.stderr.on('data', (d) => (serverLog += d.toString()));

let ready = false;
for (let i = 0; i < 40; i += 1) {
  await sleep(500);
  try {
    const res = await fetch(`${BASE}/api/test/create-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `p2-ready-${String(Date.now())}@example.com`,
        password: 'p2-ready-probe-password',
      }),
    });
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {
    // 还没起来
  }
  if (server.exitCode !== null) break;
}

if (!ready) {
  console.error('❌ 服务端未能就绪。日志尾部：\n');
  console.error(serverLog.split('\n').slice(-20).join('\n'));
  cleanup();
  process.exit(1);
}
console.log('✅ 服务端就绪');

const tmp = mkdtempSync(join(os.tmpdir(), 'heyta-p2-'));
const dbA = join(tmp, 'host-a.sqlite');
const dbB = join(tmp, 'host-b.sqlite');
let passed = false;

try {
  // ── 真实注册一个账号（TEST_MODE 路由）──
  console.log('\n· 注册测试账号…');
  const email = `heyta-p2-${String(Date.now())}@example.com`;
  const reg = await fetch(`${BASE}/api/test/create-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'heyta-p2-password' }),
  });
  check(reg.ok, `注册测试账号失败：HTTP ${String(reg.status)}`);
  const regBody = await reg.json();
  TOKEN = regBody.token ?? regBody.accessToken ?? regBody.data?.token;
  check(typeof TOKEN === 'string' && TOKEN !== '', '注册响应里没有 token');

  // ── 1. Host A：写 ────────────────────────────────────────
  console.log('· [1/8] Host A 创建任务（独立进程）…');
  const added = hostJson('A add', dbA, ['add', TASK_TITLE]);
  check(added.ok === true && typeof added.id === 'string', `add 没有返回任务 id：${JSON.stringify(added)}`);
  const taskId = added.id;

  // ── 2. Host A：**新进程**读回（持久化）──────────────────────
  console.log('· [2/8] Host A 用**新进程** list（重启后仍在 = 真落盘）…');
  check(statSync(dbA).size > 0, `Host A 的 SQLite 文件是空的：${dbA}`);
  const listA = hostJson('A list', dbA, ['list']);
  const seenA = listA.tasks.find((t) => t.id === taskId);
  check(
    seenA !== undefined && seenA.title === TASK_TITLE,
    `A 重启后 list 看不到刚写的任务：${JSON.stringify(listA.tasks)}`,
  );

  // ── 3. 绕过适配器，直接读 SQLite 文件 ─────────────────────
  console.log('· [3/8] 绕过适配器，直接用 node:sqlite 读原始行…');
  const rawOps = readRawOps(dbA);
  const rawCreated = rawOps.find((r) => r.op?.entityId === taskId);
  check(rawCreated !== undefined, `原始 ops 表里没有该任务的行（数据可能只在内存里）`);
  check(
    rawCreated.op.payload?.title === TASK_TITLE,
    `原始行的 payload.title 不是标题：${JSON.stringify(rawCreated.op.payload)}`,
  );
  check(rawCreated.uploadStatus === 'pending', `同步前 uploadStatus 应为 pending，实际 ${rawCreated.uploadStatus}`);

  // ── 4. Host A：同步 ──────────────────────────────────────
  console.log('· [4/8] Host A 同步（真实 HTTP）…');
  const syncA = hostJson('A sync', dbA, ['sync']);
  check(
    syncA.ok === true && syncA.status?.kind === 'synced',
    `A 同步未成功：${JSON.stringify(syncA)}`,
  );
  const pendingA = hostJson('A pending', dbA, ['pending']);
  check(pendingA.pending === 0, `A 同步后仍有 ${String(pendingA.pending)} 条待上传（上传完成没落盘）`);

  // ── 5. Host B：独立文件、独立设备，下载 ───────────────────
  console.log('· [5/8] Host B（另一个 SQLite 文件）同步并读取 A 的任务…');
  const syncB1 = hostJson('B sync', dbB, ['sync']);
  check(
    syncB1.ok === true && syncB1.status?.kind === 'synced',
    `B 同步未成功：${JSON.stringify(syncB1)}`,
  );
  const listB = hostJson('B list', dbB, ['list']);
  const seenB = listB.tasks.find((t) => t.id === taskId);
  check(
    seenB !== undefined && seenB.title === TASK_TITLE,
    `B 没有从服务端看到 A 的任务：${JSON.stringify(listB.tasks)}`,
  );

  // 两台宿主必须是**不同的设备**，否则 LWW / 向量时钟的验证没有意义
  const clientIdA = readRawMeta(dbA, 'clientId')?.value;
  const clientIdB = readRawMeta(dbB, 'clientId')?.value;
  check(
    typeof clientIdA === 'string' && typeof clientIdB === 'string' && clientIdA !== clientIdB,
    `两台宿主的 clientId 应不同：A=${String(clientIdA)} B=${String(clientIdB)}`,
  );

  // ── 6. Host B：改 → 同步 ─────────────────────────────────
  console.log('· [6/8] Host B 修改标题并同步…');
  const renamed = hostJson('B rename', dbB, ['rename', taskId, B_TITLE]);
  check(renamed.ok === true, `B rename 失败：${JSON.stringify(renamed)}`);
  const listB2 = hostJson('B list after rename', dbB, ['list']);
  check(
    listB2.tasks.find((t) => t.id === taskId)?.title === B_TITLE,
    'B 本地改名没有生效',
  );
  const syncB2 = hostJson('B sync after rename', dbB, ['sync']);
  check(syncB2.ok === true && syncB2.status?.kind === 'synced', `B 改名后同步失败：${JSON.stringify(syncB2)}`);

  // ── 7. Host A：拉回 B 的编辑 ─────────────────────────────
  console.log('· [7/8] Host A 同步，断言看到了 B 的编辑…');
  const syncA2 = hostJson('A sync after B edit', dbA, ['sync']);
  check(syncA2.ok === true && syncA2.status?.kind === 'synced', `A 第二次同步失败：${JSON.stringify(syncA2)}`);
  const listA2 = hostJson('A list after B edit', dbA, ['list']);
  const seenA2 = listA2.tasks.find((t) => t.id === taskId);
  check(
    seenA2 !== undefined && seenA2.title === B_TITLE,
    `B 的编辑没有同步回 A：A 看到的是 ${JSON.stringify(seenA2?.title)}`,
  );

  // ── 8. 服务端存的必须是密文 ──────────────────────────────
  console.log('· [8/8] 检查服务端只存密文（E2EE 不是摆设）…');
  const dl = await fetch(`${BASE}/api/sync/ops?sinceSeq=0&limit=200`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  check(dl.ok, `下载 op 失败：HTTP ${String(dl.status)}`);
  const dlBody = await dl.json();
  check(Array.isArray(dlBody.ops) && dlBody.ops.length > 0, '服务端一条 op 都没有');
  const wire = JSON.stringify(dlBody);
  check(!wire.includes(TASK_TITLE), '服务端出现了任务明文标题 —— E2EE 失效');
  for (const envelope of dlBody.ops) {
    check(
      envelope.op?.isPayloadEncrypted === true,
      `op 没有显式 isPayloadEncrypted=true：${JSON.stringify(envelope.op?.id)}`,
    );
    check(typeof envelope.op?.payload === 'string', `op payload 不是密文字符串：${JSON.stringify(envelope.op?.id)}`);
  }

  passed = true;
  console.log('\n✅ P2 验收通过：');
  console.log('   · Node 宿主用真实 SQLite 文件完成读 / 写（逐条命令新进程，重启不丢）');
  console.log('   · 两个独立宿主经真实服务端双向同步（A → B → A）');
  console.log('   · 同步后待上传队列清空，服务端只存密文');
  console.log('   · 全程零 mock：无一处替身，无一处 :memory:\n');
} catch (error) {
  if (error instanceof VerificationError) {
    console.error(`\n❌ P2 验收失败：${error.message}\n`);
  } else {
    console.error('\n❌ P2 验收异常：');
    console.error(error);
  }
  console.error(`（保留现场：${tmp}）\n`);
  process.exitCode = 1;
} finally {
  cleanup();
  if (passed) rmSync(tmp, { recursive: true, force: true });
}

process.exit(process.exitCode ?? 0);
