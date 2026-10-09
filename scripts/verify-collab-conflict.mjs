#!/usr/bin/env node
/**
 * verify:collab-conflict —— 共享清单并发冲突的 LWW 收敛与恢复验收
 * （ADR-0062 / 计划 §4 第四行；决策 5：静默 LWW + 可追溯 + 可恢复）。
 * =====================================================================
 *
 * 自带真实服务端（引导照 `verify-collab-sync.mjs`）。与其它 collab 验收
 * 的分工：这里打的是**同一条任务被两台设备并发编辑**的场景——
 *
 *   1. 两个账号（owner / bob）+ 共享建立 + 双方持 epoch1 清单密钥。
 *   2. 🔴 并发写同一条任务：owner 写「A 版本」（T），bob 写「B 版本」（T+2s）。
 *      share op-log 是追加式的——**两条都被接受**，服务端不裁决内容。
 *   3. 🔴 收敛：双方各自下载全量历史、解密、用**真实 op-log reducer**
 *      （`replayOperations`，字段级版本账 + (timestamp, clientId) LWW）
 *      独立重放——**两种到达顺序（A→B 与 B→A）都必须物化出同一个胜者**
 *      「B 版本」。到达顺序不影响结果，这才叫收敛。
 *   4. 历史保留：服务端历史里两条 op 都在——被覆盖的版本没有消失
 *      （这是"可恢复"的前提，也是相对竞品的结构性优势）。
 *   5. 🔴 恢复被覆盖版本：owner 以**更晚的时间戳**把「A 版本」写回去
 *      ⇒ 双方重放后一致收敛到恢复后的「A 版本」，且恢复后的状态照常同步。
 *
 * 🔴 边界（不包装）：replay 在脚本进程内用 op-log 的真实纯函数完成；
 * 客户端引擎（engine 分区接线）落地后，本脚本应改走真实引擎实例，
 * 判据不变。
 *
 * 用法：
 *   node scripts/verify-collab-conflict.mjs [--port 3213]
 *
 * 失败退出码 1 并打印 `RESULT=FAIL step=N`；通过打印 `RESULT=OK steps=6`。
 * 变异臂：把 op-log 的 LWW 选择改成"最早者胜" ⇒ 第 3 步必红（2026-10-08 实测）。
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = (() => {
  const idx = process.argv.indexOf('--port');
  return idx >= 0 ? process.argv[idx + 1] : '3213';
})();
const BASE = `http://127.0.0.1:${PORT}`;

const DB_NAME = process.env.HEYTA_VERIFY_DB_NAME ?? 'heyta_sync_smoke';
const DB_URL =
  process.env.HEYTA_VERIFY_DATABASE_URL ??
  `postgresql://${process.env.PGUSER ?? process.env.USER ?? os.userInfo().username}@127.0.0.1:5432/${DB_NAME}?schema=public&connection_limit=5&pool_timeout=10`;
const PSQL_URL = DB_URL.split('?')[0];

const core = await import(join(ROOT, 'packages/sync-core/dist/index.js'));
const client = await import(join(ROOT, 'packages/sync-client/dist/index.js'));
const opLog = await import(join(ROOT, 'packages/op-log/dist/index.js'));

let server;
const cleanup = () => {
  if (server && server.exitCode === null) server.kill('SIGTERM');
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

let step = 0;
const fail = (reason) => {
  console.error(`[debug] serverLog tail:\n${serverLog.split('\n').slice(-20).join('\n')}`);
  console.error(`RESULT=FAIL step=${step} reason=${reason}`);
  cleanup();
  process.exit(1);
};
const stepOk = (message) => console.log(`STEP ${step} OK ${message}`);

console.log('\n=== verify:collab-conflict —— 并发冲突 LWW 收敛与恢复 ===\n');

const dbExists = run('psql', ['-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`, PSQL_URL]);
if (!dbExists.out.includes('1')) {
  const created = run('createdb', [DB_NAME]);
  if (!created.ok) fail(`createdb 失败：${created.out.slice(-200)}`);
}
const migrationRun = run('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: join(ROOT, 'server'),
  env: { ...process.env, DATABASE_URL: DB_URL },
});
if (!migrationRun.ok) {
  console.error(`RESULT=FAIL step=0 reason=迁移失败：${migrationRun.out.trim().slice(-500)}`);
  process.exit(1);
}
console.log('· 迁移完成');

server = spawn(process.execPath, ['dist/src/index.js'], {
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
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d.toString()));
server.stderr.on('data', (d) => (serverLog += d.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ready = false;
for (let i = 0; i < 40; i += 1) {
  await sleep(500);
  try {
    const res = await fetch(`${BASE}/api/test/create-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `ready-${Date.now()}@example.com`, password: 'ready-probe-password' }),
    });
    if (res.ok) { ready = true; break; }
  } catch { /* 还没起来 */ }
  if (server.exitCode !== null) break;
}
if (!ready) {
  console.error(`RESULT=FAIL step=0 reason=服务端未就绪。日志尾部：\n${serverLog.split('\n').slice(-20).join('\n')}`);
  process.exit(1);
}
console.log('✅ 服务端就绪\n');

const api = async (method, path, token, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204 等 */ }
  return { status: res.status, json };
};

const runId = Date.now();

// ── 1. 两个账号 ────────────────────────────────────────────────────────────
step = 1;
const ownerRes = await api('POST', '/api/test/create-user', null, {
  email: `conflict-owner-${runId}@example.test`, password: 'conflict-verify-password',
});
const bobRes = await api('POST', '/api/test/create-user', null, {
  email: `conflict-bob-${runId}@example.test`, password: 'conflict-verify-password',
});
if (ownerRes.status !== 201 || !ownerRes.json?.token) fail(`owner 建号失败：${JSON.stringify(ownerRes.json)?.slice(0, 200)}`);
if (bobRes.status !== 201 || !bobRes.json?.token) fail(`bob 建号失败：${JSON.stringify(bobRes.json)?.slice(0, 200)}`);
const tokenOwner = ownerRes.json.token;
const tokenBob = bobRes.json.token;
stepOk('两个账号就绪');

// ── 2. 共享建立 + 双方持钥 ─────────────────────────────────────────────────
step = 2;
const created = await api('POST', '/api/shares', tokenOwner, {});
if (created.status !== 201 || !created.json?.shareId) fail(`建共享失败：${JSON.stringify(created.json)?.slice(0, 200)}`);
const shareId = created.json.shareId;
const ownerIdentity = core.deriveShareIdentityKeyPair(core.generateShareIdentitySeed());
const listKeyV1 = core.generateShareListKey();
const invitation = await api('POST', `/api/shares/${shareId}/invitations`, tokenOwner, {});
if (invitation.status !== 201 || !invitation.json?.token) fail(`发邀请失败：${JSON.stringify(invitation.json)?.slice(0, 200)}`);
const bobIdentity = core.deriveShareIdentityKeyPair(core.generateShareIdentitySeed());
const accepted = await api('POST', '/api/shares/invitations/accept', tokenBob, {
  token: invitation.json.token,
  identityPublicKey: Buffer.from(bobIdentity.x25519PublicKey).toString('base64'),
});
if (accepted.status !== 200) fail(`接受邀请失败：${JSON.stringify(accepted.json)?.slice(0, 200)}`);
const bobMemberId = accepted.json.memberId;
const envelope = await core.sealListKeyForRecipient({
  listKey: listKeyV1, shareId, keyEpoch: 1,
  recipientX25519PublicKey: bobIdentity.x25519PublicKey,
});
const putEnv = await api('PUT', `/api/shares/${shareId}/members/${bobMemberId}/envelope`, tokenOwner, {
  keyEpoch: 1, keyEnvelope: envelope,
});
if (putEnv.status !== 200) fail(`信封下发失败：${JSON.stringify(putEnv.json)?.slice(0, 200)}`);
const membersView = await api('GET', `/api/shares/${shareId}/members`, tokenBob);
const ownRow = (membersView.json?.members ?? []).find((m) => m.memberId === bobMemberId);
const bobListKey = await core.openListKeyEnvelope({
  envelope: ownRow.keyEnvelope, recipientX25519SecretKey: bobIdentity.x25519SecretKey,
});
if (hex(bobListKey) !== hex(listKeyV1)) fail('bob 解出的清单密钥与 owner 不一致');
stepOk('共享建立，双方持同一把清单密钥');

// ── 3. 🔴 并发写同一条任务 + 两种顺序的独立重放收敛 ──────────────────────────
step = 3;
const cipherOwner = client.createSharePayloadCipher({ current: { shareId, keyEpoch: 1, listKey: listKeyV1 } });
const cipherBob = client.createSharePayloadCipher({ current: { shareId, keyEpoch: 1, listKey: bobListKey } });
const TASK_ID = 'task-conflict-1';
const T_BASE = Date.now();
const identityA = {
  id: `conflict-a-${runId}`, clientId: 'device-A1', actionType: 'edit task', opType: 'UPD',
  entityType: 'TASK', entityId: TASK_ID, timestamp: T_BASE, schemaVersion: 1,
};
const identityB = {
  id: `conflict-b-${runId}`, clientId: 'device-B1', actionType: 'edit task', opType: 'UPD',
  entityType: 'TASK', entityId: TASK_ID, timestamp: T_BASE + 2_000, schemaVersion: 1,
};
const envelopeA = await cipherOwner.encrypt(JSON.stringify({ title: 'A 版本' }), identityA);
const envelopeB = await cipherBob.encrypt(JSON.stringify({ title: 'B 版本' }), identityB);
// 同一条任务、两个身份，先后上行——share op-log 追加式，两条都接受。
const upA = await api('POST', `/api/shares/${shareId}/ops`, tokenOwner, {
  ops: [{ ...identityA, payload: envelopeA, vectorClock: { 'device-A1': 1 }, isPayloadEncrypted: true }],
});
const upB = await api('POST', `/api/shares/${shareId}/ops`, tokenBob, {
  ops: [{ ...identityB, payload: envelopeB, vectorClock: { 'device-B1': 1 }, isPayloadEncrypted: true }],
});
if (upA.status !== 200 || upA.json?.accepted?.length !== 1) fail(`owner 并发上行失败：${JSON.stringify(upA.json)?.slice(0, 200)}`);
if (upB.status !== 200 || upB.json?.accepted?.length !== 1) fail(`bob 并发上行失败：${JSON.stringify(upB.json)?.slice(0, 200)}`);

const download = async (token) => {
  const res = await api('GET', `/api/shares/${shareId}/ops/causal?after=0&limit=100`, token);
  if (res.status !== 200) fail(`下载失败：${res.status}`);
  return res.json.ops;
};
const history = await download(tokenOwner);
if (history.length !== 2) fail(`历史应保留 2 条 op，实际 ${history.length}`);
// 两台设备各自独立重放：同一份历史、两种到达顺序，结果必须一致。
const replayTitle = (ops) => {
  const state = opLog.replayOperations(opLog.emptyState(), ops);
  return (state.tasks ?? {})[TASK_ID]?.title;
};
const toReplayOp = (op, payload) => ({
  id: op.id, clientId: op.clientId, actionType: op.actionType, opType: op.opType,
  entityType: op.entityType, entityId: op.entityId, payload,
  vectorClock: op.vectorClock, timestamp: op.clientTimestamp, schemaVersion: op.schemaVersion,
});
const decryptOp = (cipher) => async (op) => {
  const plain = await cipher.decrypt(op.payload, {
    id: op.id, clientId: op.clientId, actionType: op.actionType, opType: op.opType,
    entityType: op.entityType, entityId: op.entityId ?? undefined,
    timestamp: op.clientTimestamp, schemaVersion: op.schemaVersion,
  });
  return toReplayOp(op, JSON.parse(plain));
};
const opA = history.find((o) => o.id === identityA.id);
const opB = history.find((o) => o.id === identityB.id);
if (!opA || !opB) fail('历史里缺并发双方之一');
// 设备 A 的视图（用自己的 cipher 解自己的与对方的——同一把清单密钥）：
const replayOpsA = [await decryptOp(cipherOwner)(opA), await decryptOp(cipherOwner)(opB)];
// 两种到达顺序都要收敛到同一个 LWW 胜者。
const titleOrderAB = replayTitle(replayOpsA);
const titleOrderBA = replayTitle([...replayOpsA].reverse());
if (titleOrderAB !== 'B 版本' || titleOrderBA !== 'B 版本') {
  fail(`LWW 收敛失败：A→B 物化「${titleOrderAB}」，B→A 物化「${titleOrderBA}」，期望都是「B 版本」`);
}
// bob 侧独立重放（对方的 op 用同一把钥解）：
const replayOpsB = [await decryptOp(cipherBob)(opA), await decryptOp(cipherBob)(opB)];
const titleBob = replayTitle(replayOpsB);
if (titleBob !== 'B 版本') fail(`bob 侧重放发散：「${titleBob}」`);
stepOk('两种到达顺序 + 双方独立重放，全部收敛到「B 版本」（LWW，后写者胜）');

// ── 4. 历史保留：被覆盖版本没有消失 ─────────────────────────────────────────
step = 4;
const stillBoth = await api('GET', `/api/shares/${shareId}/ops/causal?after=0&limit=100`, tokenOwner);
if (stillBoth.json.ops.length !== 2) fail(`历史应仍保留 2 条，实际 ${stillBoth.json.ops.length}`);
if (!history.find((o) => o.id === identityA.id)) fail('被覆盖的 A 版本 op 从历史中消失——不可恢复');
stepOk('被覆盖的 A 版本仍在历史中（可恢复的前提）');

// ── 5. 🔴 恢复被覆盖版本：更晚时间戳写回 ⇒ 双方收敛到恢复版 ───────────────────
step = 5;
const identityRestore = {
  id: `conflict-restore-${runId}`, clientId: 'device-A1', actionType: 'edit task', opType: 'UPD',
  entityType: 'TASK', entityId: TASK_ID, timestamp: T_BASE + 5_000, schemaVersion: 1,
};
const restoreEnvelope = await cipherOwner.encrypt(JSON.stringify({ title: 'A 版本（已恢复）' }), identityRestore);
const upRestore = await api('POST', `/api/shares/${shareId}/ops`, tokenOwner, {
  ops: [{ ...identityRestore, payload: restoreEnvelope, vectorClock: { 'device-A1': 2 }, isPayloadEncrypted: true }],
});
if (upRestore.status !== 200 || upRestore.json?.accepted?.length !== 1) fail(`恢复上行失败：${JSON.stringify(upRestore.json)?.slice(0, 200)}`);
const historyAfter = await download(tokenOwner);
if (historyAfter.length !== 3) fail(`恢复后历史应 3 条，实际 ${historyAfter.length}`);
const replayAfter = (ops) => {
  const state = opLog.replayOperations(opLog.emptyState(), ops);
  return (state.tasks ?? {})[TASK_ID]?.title;
};
const decryptedAfter = [];
for (const op of historyAfter) {
  decryptedAfter.push(await decryptOp(cipherOwner)(op));
}
const restoredOrder = replayAfter(decryptedAfter);
const restoredReversed = replayAfter([...decryptedAfter].reverse());
if (restoredOrder !== 'A 版本（已恢复）' || restoredReversed !== 'A 版本（已恢复）') {
  fail(`恢复后收敛失败：「${restoredOrder}」/「${restoredReversed}」`);
}
stepOk('恢复版本以更晚时间戳胜出；两种顺序重放一致；历史 3 条全保留');

// ── 6. 服务端零明文（冲突场景下也不破） ─────────────────────────────────────
step = 6;
const dump = run('psql', ['-tA', PSQL_URL, '-c',
  `SELECT payload::text FROM share_operations WHERE share_id = '${shareId}'`]);
if (!dump.ok) fail(`搜库失败：${dump.out.slice(-200)}`);
if (dump.out.includes('A 版本') || dump.out.includes('B 版本')) {
  fail('并发冲突场景下库里出现了标题明文');
}
let shapeChecked = 0;
for (const line of dump.out.split('\n')) {
  const b64 = line.trim().replace(/^"|"$/g, '');
  if (!b64) continue;
  const raw = Buffer.from(b64, 'base64');
  if (raw[0] !== 1) fail(`载荷版本字节异常：${raw[0]}`);
  shapeChecked += 1;
}
if (shapeChecked === 0) fail('share_operations 里没有可校验的载荷');
stepOk('三条并发/恢复 op 在库里全部只有信封密文');

cleanup();
console.log('\nRESULT=OK steps=6');

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
