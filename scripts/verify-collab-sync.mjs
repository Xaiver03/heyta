#!/usr/bin/env node
/**
 * verify:collab-sync —— 共享清单双账号 × 双设备闭环验收（ADR-0062 / 计划 §4 第二行）。
 * ================================================================================
 *
 * 自带**真实服务端**（形状照 `verify-p1-sync.mjs`：本地 PostgreSQL + 迁移 +
 * `server/dist` 以 TEST_MODE 启动 + `/api/test/create-user` 造号）。
 * 密码学侧走真实构建产物：`@heyta/sync-core`（清单密钥/信封/rekey）与
 * `@heyta/sync-client`（share 载荷信封）。
 *
 * 🔴 **边界（不包装）**：客户端同步引擎（op-log 的 share 分区、上传队列）尚未接线
 * （W3 主体等撞车面解封）。本脚本里"设备"由**真实密码学原语 + 原始 HTTP**驱动，
 * 站位待接线的客户端引擎——它验证的是**服务端协议闭环**（授权、发号、收敛、
 * 零明文、移除传播），不是最终客户端体验。引擎接线落地后，本脚本应改走
 * 真实客户端 SDK，判据不变。
 *
 * 九步：
 *   1. 两个账号（owner / bob，TEST_MODE 真实 JWT）。
 *   2. owner 建共享 + 发邀请（裸 token 只出现一次）。
 *   3. bob 凭 token 接受（带封装公钥）→ editor。
 *   4. owner 封信封下发 → bob 从成员表取**自己的**信封解开 ⇒ 双方持有同一把清单密钥。
 *   5. 双方各自上传一条 op（真实 share 信封载荷）→ 服务端独立发号。
 *   6. 🔴 收敛：owner 的**第二台设备**与 bob 各自下载 ⇒ 双方都读到两条 op 且
 *      解密回原文（跨账号、跨设备）。
 *   7. 🔴 服务端零明文：直查 `share_operations.payload` ⇒ 搜不到任务标题明文，
 *      只搜得到 share 信封前缀。
 *   8. 🔴 移除传播：owner 移除 bob ⇒ bob 的 GET /shares 出现 `removedMemberships`，
 *      上传/下载一律 404。
 *   9. owner rekey（epoch2 自封信封）⇒ share.keyEpoch 推进 ⇒ 新 op 正常上传，
 *      bob 仍被拒在门外。
 *
 * 用法：
 *   node scripts/verify-collab-sync.mjs [--port 3211]
 *
 * 失败退出码 1 并打印 `RESULT=FAIL step=N`；通过打印 `RESULT=OK steps=9`。
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = (() => {
  const idx = process.argv.indexOf('--port');
  return idx >= 0 ? process.argv[idx + 1] : '3211';
})();
const BASE = `http://127.0.0.1:${PORT}`;

// 与 verify-p1-sync.mjs 共用同一验收库；DATABASE_URL 覆盖优先（不写死本机用户名）。
const DB_NAME = process.env.HEYTA_VERIFY_DB_NAME ?? 'heyta_sync_smoke';
const DB_URL =
  process.env.HEYTA_VERIFY_DATABASE_URL ??
  `postgresql://${process.env.PGUSER ?? process.env.USER ?? os.userInfo().username}@127.0.0.1:5432/${DB_NAME}?schema=public&connection_limit=5&pool_timeout=10`;
const PSQL_URL = DB_URL.split('?')[0];

const core = await import(join(ROOT, 'packages/sync-core/dist/index.js'));
const client = await import(join(ROOT, 'packages/sync-client/dist/index.js'));

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
  console.error(`RESULT=FAIL step=${step} reason=${reason}`);
  cleanup();
  process.exit(1);
};
const stepOk = (message) => console.log(`STEP ${step} OK ${message}`);

console.log('\n=== verify:collab-sync —— 共享清单双账号 × 双设备闭环 ===\n');
console.log(`· 数据库: ${DB_NAME}`);

// ── 数据库就绪 + 迁移（p1 同款：验收脚本自己准备环境） ──────────────────────
const dbExists = run('psql', ['-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`, PSQL_URL]);
if (!dbExists.out.includes('1')) {
  const created = run('createdb', [DB_NAME]);
  if (!created.ok) fail(`createdb 失败：${created.out.slice(-200)}`);
}
const migrated = run('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: join(ROOT, 'server'),
  env: { ...process.env, DATABASE_URL: DB_URL },
});
if (!migrated.ok) {
  console.error(`RESULT=FAIL step=0 reason=迁移失败：${migrated.out.trim().slice(-500)}`);
  process.exit(1);
}
console.log('· 迁移完成');

// ── 服务端（TEST_MODE） ────────────────────────────────────────────────────
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
      // 无 body 的 DELETE 不带 json content-type——Fastify 会拒"空 JSON body"。
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204 等 */ }
  return { status: res.status, json };
};

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const runId = Date.now();

// ── 1. 两个账号 ────────────────────────────────────────────────────────────
step = 1;
const ownerRes = await api('POST', '/api/test/create-user', null, {
  email: `share-owner-${runId}@example.test`, password: 'share-verify-password',
});
const bobRes = await api('POST', '/api/test/create-user', null, {
  email: `share-bob-${runId}@example.test`, password: 'share-verify-password',
});
if (ownerRes.status !== 201 || !ownerRes.json?.token) fail(`owner 建号失败：${JSON.stringify(ownerRes.json)?.slice(0, 200)}`);
if (bobRes.status !== 201 || !bobRes.json?.token) fail(`bob 建号失败：${JSON.stringify(bobRes.json)?.slice(0, 200)}`);
const tokenOwner = ownerRes.json.token;
const tokenBob = bobRes.json.token;
stepOk('两个账号就绪（真实 JWT）');

// ── 2. owner 建共享 + 发邀请 ───────────────────────────────────────────────
step = 2;
const created = await api('POST', '/api/shares', tokenOwner, {});
if (created.status !== 201 || !created.json?.shareId) fail(`建共享失败：${JSON.stringify(created.json)?.slice(0, 200)}`);
const shareId = created.json.shareId;
const ownerIdentity = core.deriveShareIdentityKeyPair(core.generateShareIdentitySeed());
const listKeyV1 = core.generateShareListKey();
const invitation = await api('POST', `/api/shares/${shareId}/invitations`, tokenOwner, {
  invitedEmail: `share-bob-${runId}@example.test`,
});
if (invitation.status !== 201 || !invitation.json?.token) fail(`发邀请失败：${JSON.stringify(invitation.json)?.slice(0, 200)}`);
stepOk(`share=${shareId}；裸 token 已签发（只在这一次响应里）`);

// ── 3. bob 接受邀请（带封装公钥） ──────────────────────────────────────────
step = 3;
const bobIdentity = core.deriveShareIdentityKeyPair(core.generateShareIdentitySeed());
const bobPubB64 = Buffer.from(bobIdentity.x25519PublicKey).toString('base64');
const accepted = await api('POST', '/api/shares/invitations/accept', tokenBob, {
  token: invitation.json.token,
  identityPublicKey: bobPubB64,
});
if (accepted.status !== 200 || accepted.json?.role !== 'editor') {
  fail(`接受邀请失败：${JSON.stringify(accepted.json)?.slice(0, 200)}`);
}
const bobMemberId = accepted.json.memberId;
stepOk(`bob 入群（member=${bobMemberId}，role=editor）`);

// ── 4. owner 封信封下发；bob 解出同一把清单密钥 ─────────────────────────────
step = 4;
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
if (!ownRow?.keyEnvelope) fail('bob 在成员表里拿不到自己的信封');
const bobListKey = await core.openListKeyEnvelope({
  envelope: ownRow.keyEnvelope, recipientX25519SecretKey: bobIdentity.x25519SecretKey,
});
if (hex(bobListKey) !== hex(listKeyV1)) fail('bob 解出的清单密钥与 owner 不一致');
stepOk('信封下发 + bob 解出清单密钥（与 owner 一致）');

// ── 5. 双方并发上传（真实 share 信封载荷） ──────────────────────────────────
step = 5;
const cipherOwner = client.createSharePayloadCipher({
  current: { shareId, keyEpoch: 1, listKey: listKeyV1 },
});
const cipherBob = client.createSharePayloadCipher({
  current: { shareId, keyEpoch: 1, listKey: bobListKey },
});
const OWNER_TITLE = 'owner 的并发任务 秘密标题';
const BOB_TITLE = 'bob 的并发任务';
// 🔴 identity 只构造一次，加密与线 op **共用同一份**：AAD 绑的是 op 身份，
// 线上 op 的 timestamp 若与加密时不同（两次 Date.now()），解密方按线上值重建
// AAD 必被 GCM 拒——第一版各取一次 Date.now() 就是这样红的。
const mkIdentity = (id, clientId, entityId) => ({
  id, clientId, actionType: 'add task', opType: 'CRT', entityType: 'TASK',
  entityId, timestamp: Date.now(), schemaVersion: 1,
});
const mkOp = (identity, envelope) => ({
  ...identity,
  payload: envelope, vectorClock: { [identity.clientId]: 1 }, isPayloadEncrypted: true,
});
const ownerIdentityOp = mkIdentity(`op-owner-${runId}`, 'device-A1', 'task-owner-1');
const bobIdentityOp = mkIdentity(`op-bob-${runId}`, 'device-B1', 'task-bob-1');
const ownerEnvelope = await cipherOwner.encrypt(JSON.stringify({ title: OWNER_TITLE }), ownerIdentityOp);
const bobEnvelopeOp = await cipherBob.encrypt(JSON.stringify({ title: BOB_TITLE }), bobIdentityOp);
const upOwner = await api('POST', `/api/shares/${shareId}/ops`, tokenOwner, {
  ops: [mkOp(ownerIdentityOp, ownerEnvelope)],
});
const upBob = await api('POST', `/api/shares/${shareId}/ops`, tokenBob, {
  ops: [mkOp(bobIdentityOp, bobEnvelopeOp)],
});
if (upOwner.status !== 200 || upOwner.json?.accepted?.length !== 1) {
  console.error(`[debug] upOwner HTTP ${upOwner.status} body=${JSON.stringify(upOwner.json)?.slice(0, 300)}`);
  console.error('[debug] serverLog tail:\n' + serverLog.split('\n').slice(-25).join('\n'));
  fail(`owner 上传失败：${JSON.stringify(upOwner.json)?.slice(0, 200)}`);
}
if (upBob.status !== 200 || upBob.json?.accepted?.length !== 1) fail(`bob 上传失败：${JSON.stringify(upBob.json)?.slice(0, 200)}`);
stepOk(`双方各一条 op 上行（serverSeq ${upOwner.json.accepted[0].serverSeq} / ${upBob.json.accepted[0].serverSeq}）`);

// ── 6. 🔴 收敛：owner 第二台设备 + bob 各自下载并解密 ────────────────────────
step = 6;
const download = async (token, after = 0) => {
  const res = await api('GET', `/api/shares/${shareId}/ops/causal?after=${after}&limit=100`, token);
  if (res.status !== 200) fail(`下载失败：${res.status}`);
  return res.json;
};
const ownerDevice2 = await download(tokenOwner);
const bobView = await download(tokenBob);
if (ownerDevice2.ops.length !== 2 || bobView.ops.length !== 2) {
  fail(`收敛不完整：owner2 见 ${ownerDevice2.ops.length} 条，bob 见 ${bobView.ops.length} 条`);
}
const decryptOp = async (op) => {
  const plain = await cipherOwner.decrypt(op.payload, {
    id: op.id, clientId: op.clientId, actionType: op.actionType, opType: op.opType,
    entityType: op.entityType, entityId: op.entityId ?? undefined,
    timestamp: op.clientTimestamp, schemaVersion: op.schemaVersion,
  });
  return JSON.parse(plain);
};
const seenByOwner2 = await decryptOp(ownerDevice2.ops.find((o) => o.id === `op-owner-${runId}`));
const seenByOwner2Bob = await decryptOp(ownerDevice2.ops.find((o) => o.id === `op-bob-${runId}`));
const seenByBob = await decryptOp(bobView.ops.find((o) => o.id === `op-owner-${runId}`));
if (seenByOwner2.title !== OWNER_TITLE) fail('owner 第二台设备读不回自己的原文');
if (seenByOwner2Bob.title !== BOB_TITLE) fail('owner 第二台设备读不回 bob 的原文（跨账号收敛失败）');
if (seenByBob.title !== OWNER_TITLE) fail('bob 读不回 owner 的原文（跨账号收敛失败）');
stepOk('双账号 × 三台设备视图收敛，双方互读原文（经清单密钥）');

// ── 7. 🔴 服务端零明文 ─────────────────────────────────────────────────────
step = 7;
const dump = run('psql', ['-tA', PSQL_URL, '-c',
  `SELECT payload::text FROM share_operations WHERE share_id = '${shareId}'`]);
if (!dump.ok) fail(`搜库失败：${dump.out.slice(-200)}`);
const dbPayloads = dump.out;
if (dbPayloads.includes(OWNER_TITLE) || dbPayloads.includes(BOB_TITLE)) {
  fail('服务端库里出现了任务标题明文——零明文承诺被打破');
}
// 信封前缀 'heyta-share-op/' 在 base64 文本里是**编码后的常量前缀**——
// ASCII 魔数本身不会出现在 base64 里（第一版断言写成了 ASCII，被真库抓了个正着）。
if (!dbPayloads.includes('aGV5dGEtc2hhcmUtb3Av')) {
  fail('库里没有 share 信封的 base64 前缀——载荷形状与预期不符');
}
stepOk('share_operations 全表只有信封密文，无标题明文');

// ── 8. 🔴 移除传播 ─────────────────────────────────────────────────────────
step = 8;
const removeRes = await api('DELETE', `/api/shares/${shareId}/members/${bobMemberId}`, tokenOwner);
if (removeRes.status !== 200) fail(`移除失败：${JSON.stringify(removeRes.json)?.slice(0, 200)}`);
const bobShareList = await api('GET', '/api/shares', tokenBob);
const removed = (bobShareList.json?.removedMemberships ?? []).find((m) => m.shareId === shareId);
if (!removed) fail('被移除者的 removedMemberships 没有出现该 share');
const bobUploadAfterRemoval = await api('POST', `/api/shares/${shareId}/ops`, tokenBob, {
  ops: [mkOp(`op-bob-2-${runId}`, 'device-B1', 'task-bob-2', bobEnvelopeOp)],
});
if (bobUploadAfterRemoval.status !== 404) {
  fail(`被移除者上传应 404，实际 ${bobUploadAfterRemoval.status}`);
}
const bobDownloadAfterRemoval = await api('GET', `/api/shares/${shareId}/ops/causal?after=0`, tokenBob);
if (bobDownloadAfterRemoval.status !== 404) {
  fail(`被移除者下载应 404，实际 ${bobDownloadAfterRemoval.status}`);
}
stepOk('removedMemberships 传播；被移除者上传/下载一律 404');

// ── 9. owner rekey（epoch2）⇒ 新 op 正常、bob 仍被拒 ───────────────────────
step = 9;
// owner 的 rekey 走真实原语：唯一剩余成员是自己。
const rekey = await core.planShareRekey({
  shareId, fromEpoch: 1,
  remainingMemberX25519PublicKeys: [ownerIdentity.x25519PublicKey],
});
const selfEnvelope = await core.sealListKeyForRecipient({
  listKey: rekey.newListKey, shareId, keyEpoch: rekey.toEpoch,
  recipientX25519PublicKey: ownerIdentity.x25519PublicKey,
});
const putSelf = await api('PUT', `/api/shares/${shareId}/members/${created.json.memberId}/envelope`, tokenOwner, {
  keyEpoch: rekey.toEpoch, keyEnvelope: selfEnvelope,
});
if (putSelf.status !== 200) fail(`owner 自封信封失败：${JSON.stringify(putSelf.json)?.slice(0, 200)}`);
const detail = await api('GET', `/api/shares/${shareId}`, tokenOwner);
if (detail.json?.keyEpoch !== rekey.toEpoch) fail(`share.keyEpoch 未推进，实际 ${detail.json?.keyEpoch}`);
const cipherEpoch2 = client.createSharePayloadCipher({
  current: { shareId, keyEpoch: rekey.toEpoch, listKey: rekey.newListKey },
});
const epoch2Identity = {
  id: `op-owner-2-${runId}`, clientId: 'device-A1', actionType: 'add task', opType: 'CRT',
  entityType: 'TASK', entityId: 'task-owner-2', timestamp: Date.now(), schemaVersion: 1,
};
const newOpEnvelope = await cipherEpoch2.encrypt(JSON.stringify({ title: 'rekey 后的新任务' }), epoch2Identity);
const upEpoch2 = await api('POST', `/api/shares/${shareId}/ops`, tokenOwner, {
  ops: [mkOp(epoch2Identity, newOpEnvelope)],
});
if (upEpoch2.status !== 200 || upEpoch2.json?.accepted?.length !== 1) fail('rekey 后 owner 上传失败');
stepOk('rekey 世代推进；新 op 正常上行；bob 仍在门外');

cleanup();
console.log('\nRESULT=OK steps=9');
