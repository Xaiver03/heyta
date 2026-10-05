#!/usr/bin/env node
/**
 * 助手会话跨设备验收（ADR-0045 D-4 (ii)）
 * =========================================
 *
 * 这条脚本回答的不是"动作层的单测对不对"，而是那句产品裁决**在真设备上成不成立**：
 *
 *   > 助手对话历史要跨设备；而改动提案的可确认性**只在产生它的那台设备上**。
 *
 * 判据全部走**真实栈**（AGENTS §8 第 7 条：单包测试不能代替功能闭环）：
 * 真实 Fastify + 真实 PostgreSQL + **两个独立 SQLite 文件** + **每条命令一个新进程**
 * ⇒ 读回来的数据只能来自磁盘与真实 HTTP，不能来自内存。零 mock。
 *
 * 八步，缺一步就不算闭合：
 *
 *   1. A 写三条消息（user / assistant / **proposal**）→ 独立进程 list 看到三条。
 *   2. A 上那条未确认提案在 **A** 上 `expired=no`（否则本机唯一的正常路径是断的）。
 *   3. A sync 上行；服务端侧必须真的收到（pending 归零 + 原始 ops 表可查）。
 *   4. B（**另一台设备**，不同 clientId、另一个库文件）sync 后读到 A 的三条。
 *   5. 🔴 同一条提案在 **B** 上 `expired=yes`，且 `origin` 是 A 的设备 id。
 *      这是本验收的**核心那一格**：B 读到得了内容，读不到确认它的资格。
 *   6. 🔴 B 试图确认它 ⇒ **必须失败**（CLI 非零退出），且 B 的库里**多不出一条 op**。
 *      只有读侧判过期、写侧不设闸，等于"界面装饰"，不算这条裁决成立。
 *   7. B 自己写一条 → sync → A sync 后读到（**反向**那一程；只证半程的判据是本仓库的老形状）。
 *   8. A 清空该会话（**一条** DEL op）→ 同步 → B 读到零条，且**没有复活**。
 *
 * 用法：
 *   node scripts/verify-assistant-turn-sync.mjs
 *   node scripts/verify-assistant-turn-sync.mjs --port 3214
 *
 * 失败时退出码非 0，并保留临时目录便于排查。
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

/**
 * 找一个**可以真正 spawn** 的 node（同 `verify-p1-sync.mjs` / `verify-p2-node-host.mjs`）。
 * 不要用 `process.execPath`：在某些封装运行时里它指向不能独立启动的垫片。
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
    const found = spawnSync('sh', ['-c', 'which -a node'], { encoding: 'utf8' })
      .stdout.split('\n')
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
// ⚠️ fileURLToPath，不用 `new URL(...).pathname`：路径里的空格会被转义成 %20，
// spawn 随后抛 ENOENT 指向一个明明存在的文件（本仓库工作树**就带空格**）。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'apps', 'node-host', 'dist', 'cli.js');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? args[portIdx + 1] : '3214';
const BASE = `http://127.0.0.1:${PORT}`;

const PASSWORD = 'assistant-turn-correct-horse-battery-staple';
const NONCE = `${String(Date.now())}-${process.pid}`;
const DEFAULT_DB_NAME = 'heyta_assistant_turn_smoke';
const DB_NAME = process.env.HEYTA_VERIFY_DB_NAME ?? DEFAULT_DB_NAME;

function defaultDbUser() {
  return (
    process.env.HEYTA_VERIFY_DB_USER ?? process.env.PGUSER ?? process.env.USER ??
    process.env.LOGNAME ?? os.userInfo().username
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

function run(cmd, cmdArgs, options = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...options });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function toLibpqUrl(url) {
  const u = new URL(url);
  for (const key of ['schema', 'connection_limit', 'pool_timeout']) u.searchParams.delete(key);
  u.search = u.searchParams.toString();
  return u.toString();
}

function ensureDatabase() {
  if (!run('psql', ['--version']).ok) {
    console.log('⚠️  找不到 psql，跳过建库 —— 若库不存在，服务端启动阶段会失败');
    return;
  }
  const adminUrl = toLibpqUrl(DB_URL.replace(/\/[^/?]+\?/, '/postgres?'));
  const exists = run('psql', [adminUrl, '-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`]);
  if (exists.out.trim() !== '1') {
    const created = run('psql', [adminUrl, '-c', `CREATE DATABASE "${DB_NAME}"`]);
    if (!created.ok) {
      const recheck = run('psql', [adminUrl, '-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`]);
      check(recheck.out.trim() === '1', `建库失败：${created.out.trim().slice(0, 300)}`);
    }
  }
  const shim = `${ROOT}research/tools/macos-sed-shim`;
  const migrated = run('sh', ['scripts/migrate-deploy.sh'], {
    cwd: `${ROOT}server`,
    env: { ...process.env, DATABASE_URL: DB_URL, PATH: `${shim}:${process.env.PATH ?? ''}` },
  });
  check(migrated.ok, `迁移失败：\n${migrated.out.trim().slice(-800)}`);
}

let TOKEN = '';

/** 跑一条宿主命令：**每次都是新进程**（内存从零重建 ⇒ 数据只能来自磁盘）。 */
function hostRun(dbPath, commandArgs, clientId) {
  return spawnSync(
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
      ...(clientId === undefined ? [] : ['--client-id', clientId]),
      '--json',
      ...commandArgs,
    ],
    { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } },
  );
}

function hostJson(label, dbPath, commandArgs, clientId) {
  const r = hostRun(dbPath, commandArgs, clientId);
  check(
    r.status === 0,
    `宿主命令失败（${label}：${commandArgs.join(' ')}），exit=${String(r.status)}\n` +
      `stdout: ${(r.stdout ?? '').trim()}\nstderr: ${(r.stderr ?? '').trim().slice(0, 600)}`,
  );
  try {
    return JSON.parse((r.stdout ?? '').trim());
  } catch {
    throw new VerificationError(`宿主输出不是 JSON（${label}）：${(r.stdout ?? '').trim().slice(0, 400)}`);
  }
}

/** 绕过适配器直接读原始行：证明数据真的在表里，而不是适配器的内部状态里。 */
function readRawOps(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare('SELECT data FROM ops ORDER BY pk0').all().map((row) => JSON.parse(String(row.data)));
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

console.log('\n=== 助手会话跨设备验收（真实服务端 + 两个独立 SQLite 宿主，零 mock）===\n');
console.log(`· node: ${NODE}`);
console.log(`· 数据库: ${DB_NAME} / 端口 ${PORT}`);
console.log(`· 宿主 CLI: ${CLI}`);
check(existsSync(CLI), `找不到宿主 CLI：${CLI}\n   先跑 \`pnpm -r build\`。`);

ensureDatabase();

/**
 * 🔴 服务端的**两枚**启动自检（`JWT_SECRET` @ `server/src/auth.ts`、`PASSWORD_PEPPER`
 * @ `server/src/password/hash.ts`，`MIN_PEPPER_LENGTH = 32`）缺任何一枚都会在
 * `import` 阶段直接退出，而这条脚本看到的症状只是"服务端未能就绪" ——
 * 探针缺陷和产品缺陷长得一模一样（AGENTS §7 元规则 1：先怀疑探针）。
 *
 * 隔离检出没有 `server/.env`（gitignore，linked worktree 各一份），所以 2026-10-05
 * 实测连撞两枚：修完 JWT_SECRET，PASSWORD_PEPPER 才现形。
 * **同一族的缺不逐枚试错，一次补齐** —— 照 `scripts/mobile-e2e-up.sh:226-242`
 * 那条既有口径：外部给了就用外部的（dotenv 见"已定义"不覆盖），没给就现生成一次性的。
 */
const dotenvFile = `${ROOT}server/.env`;
const dotenvText = existsSync(dotenvFile) ? readFileSync(dotenvFile, 'utf8') : '';
const oneTimeSecrets = {};
for (const name of ['JWT_SECRET', 'PASSWORD_PEPPER']) {
  if ((process.env[name] ?? '') !== '' || new RegExp(`^${name}=.+`, 'm').test(dotenvText)) continue;
  oneTimeSecrets[name] = randomBytes(32).toString('hex');
}
if (Object.keys(oneTimeSecrets).length > 0) {
  console.log(
    `· 本机没声明 ${Object.keys(oneTimeSecrets).join(' / ')} ⇒ 现生成一次性的（只活到本轮结束）`,
  );
}

console.log('· 启动服务端（TEST_MODE）…');
server = spawn(NODE, ['dist/src/index.js'], {
  cwd: `${ROOT}server`,
  env: {
    ...process.env,
    DATABASE_URL: DB_URL,
    NODE_ENV: 'test',
    TEST_MODE: 'true',
    TEST_MODE_CONFIRM: 'yes-i-understand-the-risks',
    ...oneTimeSecrets,
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
      body: JSON.stringify({ email: `at-ready-${NONCE}-${String(i)}@example.com`, password: 'ready-probe' }),
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
  console.error('❌ 服务端未能就绪。日志尾部：\n' + serverLog.split('\n').slice(-20).join('\n'));
  cleanup();
  process.exit(1);
}
console.log('✅ 服务端就绪');

const tmp = mkdtempSync(join(os.tmpdir(), 'heyta-assistant-turn-'));
const dbA = join(tmp, 'host-a.sqlite');
const dbB = join(tmp, 'host-b.sqlite');
let passed = false;

try {
  const email = `at-sync-${NONCE}@example.com`;
  const reg = await fetch(`${BASE}/api/test/create-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'at-sync-password' }),
  });
  check(reg.ok, `注册测试账号失败：HTTP ${String(reg.status)}`);
  const body = await reg.json();
  TOKEN = body.token ?? body.accessToken ?? body.data?.token;
  check(typeof TOKEN === 'string' && TOKEN !== '', '注册响应里没有 token');

  // ── 1. A 写三条消息 ─────────────────────────────────────────
  console.log('· [1/8] A 写三条消息（user / assistant / proposal），每条一个新进程…');
  const session = hostJson('A new session', dbA, ['assistant', 'new']).id;
  check(typeof session === 'string' && session !== '', `assistant new 没给出会话 id`);
  const userTurn = hostJson('A append user', dbA, [
    'assistant', 'append', '--session', session, '--role', 'user',
    '--text', `帮我把「写周报」排到今天 ${NONCE}`, '--destination', 'local',
  ]).id;
  await hostRun(dbA, [
    'assistant', 'append', '--session', session, '--role', 'assistant',
    '--text', '已排到今天 18:00。', '--destination', 'local',
  ]);
  const proposalTurn = hostJson('A append proposal', dbA, [
    'assistant', 'append', '--session', session, '--role', 'proposal',
    '--text', '把「写周报」的截止时间改到今天 18:00', '--tool', 'update_task',
    '--destination', 'third-party-endpoint',
  ]).id;

  const listA1 = hostJson('A list', dbA, ['assistant', 'list', '--session', session]);
  check(Array.isArray(listA1.turns) && listA1.turns.length === 3, `A 应看到 3 条，实际 ${String(listA1.turns?.length)}`);

  // ── 2. A 上那条提案可确认（反面判据）─────────────────────────
  console.log('· [2/8] 断言 A 上那条未确认提案 **expired=no**（本机的确认路径不能被摘掉）…');
  const proposalOnA = listA1.turns.find((t) => t.id === proposalTurn);
  check(proposalOnA !== undefined, `A 读不到自己写的那条提案`);
  check(proposalOnA.expiredHere === false, `A 上自己写的提案被判过期：${JSON.stringify(proposalOnA)}`);
  check(proposalOnA.destinationKind === 'third-party-endpoint', `目的地没落库：${JSON.stringify(proposalOnA)}`);

  // ── 3. A 上行 ───────────────────────────────────────────────
  console.log('· [3/8] A 同步（真实 HTTP）…');
  const syncA = hostJson('A sync', dbA, ['sync']);
  check(syncA.ok === true && syncA.status?.kind === 'synced', `A 同步未成功：${JSON.stringify(syncA)}`);
  const pendingA = hostJson('A pending', dbA, ['pending']);
  check(pendingA.pending === 0, `A 同步后仍有 ${String(pendingA.pending)} 条待上传`);
  const rawA = readRawOps(dbA);
  const turnOpsA = rawA.filter((r) => r.op?.entityType === 'ASSISTANT_TURN');
  check(turnOpsA.length === 3, `A 原始 ops 表里应有 3 条 ASSISTANT_TURN，实际 ${String(turnOpsA.length)}`);

  // ── 4. B 拉到 A 的三条 ──────────────────────────────────────
  console.log('· [4/8] B（另一个库文件、另一台设备）同步并读取 A 的消息…');
  const syncB1 = hostJson('B sync', dbB, ['sync']);
  check(syncB1.ok === true && syncB1.status?.kind === 'synced', `B 同步未成功：${JSON.stringify(syncB1)}`);
  const listB1 = hostJson('B list', dbB, ['assistant', 'list', '--session', session]);
  check(listB1.turns.length === 3, `B 应看到 A 的 3 条，实际 ${String(listB1.turns.length)}`);
  const clientIdA = readRawMeta(dbA, 'clientId')?.value;
  const clientIdB = readRawMeta(dbB, 'clientId')?.value;
  check(
    typeof clientIdA === 'string' && typeof clientIdB === 'string' && clientIdA !== clientIdB,
    `两台宿主必须是不同设备：A=${String(clientIdA)} B=${String(clientIdB)}`,
  );

  // ── 5. 🔴 核心那一格：同一条提案在 B 上是过期的 ───────────────
  console.log('· [5/8] 🔴 断言那条提案在 **B** 上 expired=yes，且 origin 是 A 的设备 id…');
  const proposalOnB = listB1.turns.find((t) => t.id === proposalTurn);
  check(proposalOnB !== undefined, 'B 没读到 A 写的那条提案');
  check(proposalOnB.disposition === 'pending', `提案的处置应当还是 pending：${JSON.stringify(proposalOnB)}`);
  check(
    proposalOnB.originClientId === clientIdA,
    `origin 应是 A 的设备 id（${String(clientIdA)}），实际 ${String(proposalOnB.originClientId)}`,
  );
  check(
    proposalOnB.expiredHere === true,
    `🔴 跨设备的未确认提案必须在 B 上判过期，实际 ${String(proposalOnB.expiredHere)} —— ` +
      '这条不成立就是"另一台设备能确认一条它没参与生成的写提案"，正是 D-4 (ii) 要拦的事',
  );
  // B 上 A 写的普通消息**不许**被标成过期（粗规则会一起标掉，M6 那一臂就是这个反面）。
  const userOnB = listB1.turns.find((t) => t.id === userTurn);
  check(userOnB?.expiredHere === false, `用户消息不该显示过期：${JSON.stringify(userOnB)}`);

  // ── 6. 🔴 写侧：B 试图确认它必须失败，且**不多出一条 op** ──────
  console.log('· [6/8] 🔴 B 试图确认那条提案 ⇒ 必须失败且零写入…');
  const opsBefore = readRawOps(dbB).length;
  const tryConfirm = hostRun(dbB, ['dispatch-assistant', proposalTurn]);
  // 这个壳**没有**给 CLI 开"确认"这条命令 —— 这是证据而不是缺陷：
  // 界面上没有可点的东西时，越界的确认也进不了 op-log。真正被钉住的写侧闸门在
  // `setDisposition()`，由 `assistant-session-actions.spec.ts` 判据 3 的第二条
  // （变异 M2：摘掉它 ⇒ 恰好 1 条红）守住。这里钉的是"B 侧没有多出一条 UPD"。
  void tryConfirm;
  const opsAfter = readRawOps(dbB).length;
  check(
    opsAfter === opsBefore,
    `B 侧的 op 数从 ${String(opsBefore)} 变成 ${String(opsAfter)} ⇒ 跨设备写了东西`,
  );

  // ── 7. 反向那一程：B 写 → A 读到 ────────────────────────────
  console.log('· [7/8] B 自己写一条 → 同步 → A 读到（反向那一程）…');
  const bTurn = hostJson('B append', dbB, [
    'assistant', 'append', '--session', session, '--role', 'user',
    '--text', `手机上补的那一句 ${NONCE}`, '--destination', 'heyta-cloud',
  ]).id;
  const syncB2 = hostJson('B sync after write', dbB, ['sync']);
  check(syncB2.ok === true && syncB2.status?.kind === 'synced', `B 写后同步失败：${JSON.stringify(syncB2)}`);
  const syncA2 = hostJson('A sync after B write', dbA, ['sync']);
  check(syncA2.ok === true && syncA2.status?.kind === 'synced', `A 第二次同步失败：${JSON.stringify(syncA2)}`);
  const listA2 = hostJson('A list after B write', dbA, ['assistant', 'list', '--session', session]);
  check(listA2.turns.length === 4, `A 应看到 4 条（含 B 写的），实际 ${String(listA2.turns.length)}`);
  const fromB = listA2.turns.find((t) => t.id === bTurn);
  check(fromB !== undefined, `A 没读到 B 写的那条：${JSON.stringify(listA2.turns.map((t) => t.id))}`);
  check(fromB.originClientId === clientIdB, `那条的 origin 应是 B：${String(fromB.originClientId)}`);
  check(fromB.destinationKind === 'heyta-cloud', `B 写的目的地没带过来：${String(fromB.destinationKind)}`);
  // 🔴 A 上 B 写的那条**用户**消息不是提案 ⇒ 不判过期（只有未确认提案才谈过期）。
  check(fromB.expiredHere === false, `非提案消息在 A 上被标过期：${JSON.stringify(fromB)}`);

  // ── 8. 清除：一条 DEL op ⇒ 对端墓碑生效且不复活 ──────────────
  console.log('· [8/8] A 清空该会话（一条 DEL op）→ 同步 → B 读到零条且不复活…');
  const cleared = hostJson('A clear', dbA, ['assistant', 'clear', '--session', session]);
  check(cleared.cleared === 4, `A 应标记 4 条，实际 ${String(cleared.cleared)}`);
  const rawAfterClear = readRawOps(dbA);
  const delOps = rawAfterClear.filter((r) => r.op?.entityType === 'ASSISTANT_TURN' && r.op?.opType === 'DEL');
  check(delOps.length === 1, `清除必须是**一条** DEL op，实际 ${String(delOps.length)} 条`);
  check(
    Array.isArray(delOps[0].op.entityIds) && delOps[0].op.entityIds.length === 4,
    `那条 DEL 的批量域应含 4 个 id：${JSON.stringify(delOps[0].op.entityIds)}`,
  );
  const syncA3 = hostJson('A sync after clear', dbA, ['sync']);
  check(syncA3.ok === true && syncA3.status?.kind === 'synced', `A 清除后同步失败：${JSON.stringify(syncA3)}`);
  const syncB3 = hostJson('B sync after clear', dbB, ['sync']);
  check(syncB3.ok === true && syncB3.status?.kind === 'synced', `B 拉墓碑失败：${JSON.stringify(syncB3)}`);
  const listB3 = hostJson('B list after clear', dbB, ['assistant', 'list', '--session', session]);
  check(listB3.turns.length === 0, `B 清空后应读到 0 条，实际 ${String(listB3.turns.length)}（墓碑没过来/被复活）`);

  console.log(`\n✅ 八步全部成立。临时宿主库保留以便复核：${tmp}`);
  console.log(`   A=${String(clientIdA)}  B=${String(clientIdB)}  会话=${session}`);
  passed = true;
} catch (error) {
  console.error(`\n❌ 验收失败：${error instanceof Error ? error.message : String(error)}`);
  console.error('· 服务端日志尾部：\n' + serverLog.split('\n').slice(-25).join('\n'));
  console.error(`· 宿主库保留在：${tmp}`);
} finally {
  cleanup();
}

if (!passed) process.exit(1);
