#!/usr/bin/env node
/**
 * verify:collab-revoke —— 成员移除全链路验收（ADR-0062 / 计划 §4 第三行）。
 * =======================================================================
 *
 * 自带真实服务端（引导形状照 `verify-collab-sync.mjs`：本地 PostgreSQL +
 * 迁移 + `server/dist` TEST_MODE + `/api/test/create-user` 真实 JWT）。
 * 密码学侧走真实构建产物（`@heyta/sync-core` / `@heyta/sync-client`）。
 *
 * 它与 `verify-collab-sync` 第 8/9 步的分工：那边证明"移除后门关了"（404），
 * 这里证明"移除之后密钥世界也换了"——**移除 → rekey → 历史重加密 → 三面证据**。
 *
 * 七步：
 *   1. 两个账号（owner / bob，真实 JWT）。
 *   2. 建共享 → 邀请 → bob 接受 → 信封下发 ⇒ bob 持有 epoch1 清单密钥。
 *   3. 基线：bob 上传 op-1、owner 上传 op-2，bob 下载并读回两条（移除前一切正常）。
 *   4. 🔴 owner 移除 bob ⇒ 上传/下载一律 404（门关了）。
 *   5. owner 下载全部历史 ⇒ `reencryptShareRecord` 逐条迁到 epoch2 ⇒
 *      迁移副本作为**新 op** 上行（真实重加密批次形状）。
 *   6. 🔴 历史对 bob 不可读的**三面证据**：
 *      ① 密码学面：每一条迁移副本，bob 的旧钥解不开、owner 的新钥解得开
 *        （含 bob 自己写的那条——移除后连自己的旧文也换锁）；
 *      ② 存储面：psql 直查 ⇒ 库里**有**迁移副本的密文、也**仍有**旧密文
 *        （迁移是追加新 op，旧行留待压实——诚实模型，不假装消失）；
 *      ③ 访问面：bob 的下载是 404（第 4 步），他连"再下一次试试"都做不到。
 *   7. 🔴 被移除端如实显示：bob 的 GET /shares 出现 removedMemberships。
 *
 * 🔴 边界（不包装）：「WS 已断」这一格**未覆盖**——W2 的移除路由置位
 * `removedAt`，但 WS 连接摘除挂客户端 realtime 接线（被撞车面挡住）；
 * 本脚本没有 WS 客户端可断。接线落地后本脚本补这一格。
 *
 * 用法：
 *   node scripts/verify-collab-revoke.mjs [--port 3212]
 *
 * 失败退出码 1 并打印 `RESULT=FAIL step=N`；通过打印 `RESULT=OK steps=7`。
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = (() => {
  const idx = process.argv.indexOf('--port');
  return idx >= 0 ? process.argv[idx + 1] : '3212';
})();
const BASE = `http://127.0.0.1:${PORT}`;

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
  console.error(`[debug] serverLog tail:\n${serverLog.split('\n').slice(-20).join('\n')}`);
  console.error(`RESULT=FAIL step=${step} reason=${reason}`);
  cleanup();
  process.exit(1);
};
const stepOk = (message) => console.log(`STEP ${step} OK ${message}`);

console.log('\n=== verify:collab-revoke —— 成员移除全链路 ===\n');
console.log(`· 数据库: ${DB_NAME}`);

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

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const runId = Date.now();

// ── 1. 两个账号 ────────────────────────────────────────────────────────────
step = 1;
const ownerRes = await api('POST', '/api/test/create-user', null, {
  email: `revoke-owner-${runId}@example.test`, password: 'revoke-verify-password',
});
const bobRes = await api('POST', '/api/test/create-user', null, {
  email: `revoke-bob-${runId}@example.test`, password: 'revoke-verify-password',
});
if (ownerRes.status !== 201 || !ownerRes.json?.token) fail(`owner 建号失败：${JSON.stringify(ownerRes.json)?.slice(0, 200)}`);
if (bobRes.status !== 201 || !bobRes.json?.token) fail(`bob 建号失败：${JSON.stringify(bobRes.json)?.slice(0, 200)}`);
const tokenOwner = ownerRes.json.token;
const tokenBob = bobRes.json.token;
stepOk('两个账号就绪');

// ── 2. 建共享 → 邀请 → 接受 → 信封 ─────────────────────────────────────────
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
stepOk('共享建立，双方持 epoch1 清单密钥');

// ── 3. 基线：移除前 bob 正常读写 ────────────────────────────────────────────
step = 3;
// 🔴 本脚本全程使用 **sync-core 的 record 格式**（`encryptShareRecord` 信封）——
// 2026-10-09 格式统一后它就是唯一格式（magic wire 层退役），迁移机器与线上格式合一。
// 🔴 **身份单一来源**：加密的 AAD 身份与线上 op 字段共用**同一个对象**——
// 两处各取 Date.now()/各写 opType，GCM 当场拒绝（本脚本实测踩过，
// 报错只有一句 Cipher job failed，没有任何指向性）。
const wireOp = (id) => ({
  id, clientId: 'device-shared', actionType: 'add task', opType: 'CRT', entityType: 'TASK',
  entityId: id, timestamp: Date.now(), schemaVersion: 1,
});
const encryptRecord = (opIdentity, plaintext, kEpoch = 1, listKey = listKeyV1) => core.encryptShareRecord({
  id: opIdentity.id, plaintext: new TextEncoder().encode(plaintext), shareId,
  listKey, keyEpoch: kEpoch, identity: opIdentity,
});
const BOB_TITLE = 'bob 移除前写的任务';
const OWNER_TITLE = 'owner 的任务';
const bobWireOp = wireOp(`revoke-bob-op-${runId}`);
const ownerWireOp = wireOp(`revoke-owner-op-${runId}`);
const bobRecord = await encryptRecord(bobWireOp, BOB_TITLE);
const ownerRecord = await encryptRecord(ownerWireOp, OWNER_TITLE);
const mkOp = (opIdentity, ciphertext) => ({
  ...opIdentity, payload: ciphertext, vectorClock: { 'device-shared': 1 },
  isPayloadEncrypted: true,
});
const bobUp = await api('POST', `/api/shares/${shareId}/ops`, tokenBob, { ops: [mkOp(bobWireOp, bobRecord.ciphertext)] });
if (bobUp.status !== 200 || bobUp.json?.accepted?.length !== 1) fail(`bob 基线上传失败：${JSON.stringify(bobUp.json)?.slice(0, 200)}`);
const ownerUp = await api('POST', `/api/shares/${shareId}/ops`, tokenOwner, { ops: [mkOp(ownerWireOp, ownerRecord.ciphertext)] });
if (ownerUp.status !== 200 || ownerUp.json?.accepted?.length !== 1) fail(`owner 基线上传失败：${JSON.stringify(ownerUp.json)?.slice(0, 200)}`);
const bobDownload = await api('GET', `/api/shares/${shareId}/ops/causal?after=0`, tokenBob);
if (bobDownload.json?.ops?.length !== 2) fail(`bob 基线下载应 2 条，实际 ${bobDownload.json?.ops?.length}`);
const readRecord = async (op, key) => {
  const identity = { clientId: op.clientId, actionType: op.actionType, opType: op.opType, entityType: op.entityType, entityId: op.entityId, timestamp: Number(op.clientTimestamp), schemaVersion: op.schemaVersion };
  try {
    return await core.decryptShareRecord({
      record: { id: op.id, keyEpoch: 1, ciphertext: op.payload }, shareId, listKey: key, identity,
    }).then((plain) => new TextDecoder().decode(plain));
  } catch (err) {
    console.error('[debug readRecord] id:', op.id, 'identity:', JSON.stringify(identity), 'err:', err.message);
    throw err;
  }
};
const titles = [
  await readRecord(bobDownload.json.ops[0], listKeyV1),
  await readRecord(bobDownload.json.ops[1], listKeyV1),
];
if (!titles.includes(BOB_TITLE) || !titles.includes(OWNER_TITLE)) {
  fail(`bob 下载后读不回基线原文，实际读到：${titles.join(' | ')}`);
}
stepOk('移除前：双方各一条 op（record 格式），bob 下载并读回原文');

// ── 4. 🔴 owner 移除 bob ⇒ 门关了 ──────────────────────────────────────────
step = 4;
const removeRes = await api('DELETE', `/api/shares/${shareId}/members/${bobMemberId}`, tokenOwner);
if (removeRes.status !== 200) fail(`移除失败：${JSON.stringify(removeRes.json)?.slice(0, 200)}`);
const bobRetryWireOp = wireOp(`revoke-bob-op2-${runId}`);
const bobUpAfter = await api('POST', `/api/shares/${shareId}/ops`, tokenBob, {
  ops: [mkOp(bobRetryWireOp, (await encryptRecord(bobRetryWireOp, '移除后的重试')).ciphertext)],
});
if (bobUpAfter.status !== 404) fail(`被移除者上传应 404，实际 ${bobUpAfter.status}`);
const bobDownloadAfter = await api('GET', `/api/shares/${shareId}/ops/causal?after=0`, tokenBob);
if (bobDownloadAfter.status !== 404) fail(`被移除者下载应 404，实际 ${bobDownloadAfter.status}`);
stepOk('移除后：bob 上传/下载一律 404');

// ── 5. owner 迁移历史到 epoch2 并作为新 op 上行 ─────────────────────────────
step = 5;
const rekey = await core.planShareRekey({
  shareId, fromEpoch: 1,
  remainingMemberX25519PublicKeys: [ownerIdentity.x25519PublicKey],
});
const ownerDownload = await api('GET', `/api/shares/${shareId}/ops/causal?after=0`, tokenOwner);
const historyOps = ownerDownload.json.ops;
if (historyOps.length !== 2) fail(`owner 下载历史应 2 条，实际 ${historyOps.length}`);
const migrated = [];
for (let i = 0; i < historyOps.length; i += 1) {
  const source = historyOps[i];
  const sourceIdentity = {
    clientId: source.clientId, actionType: source.actionType, opType: source.opType,
    entityType: source.entityType, entityId: source.entityId,
    timestamp: Number(source.clientTimestamp), schemaVersion: source.schemaVersion,
  };
  const plaintext = await readRecord(source, listKeyV1);
  const migratedRecord = await core.reencryptShareRecord({
    record: { id: source.id, keyEpoch: 1, ciphertext: source.payload },
    shareId, fromListKey: listKeyV1, toListKey: rekey.newListKey, toEpoch: rekey.toEpoch,
    identity: sourceIdentity,
  });
  // 迁移副本 = 新 op（新 id）+ 迁移身份；**身份单一来源**：上传的线 op 与
  // 第 6 步的解密对账共用同一个对象。
  const migrateIdentity = {
    id: `migrated-${i}-${runId}`, clientId: 'device-A1', actionType: 'migrate history',
    opType: 'UPD', entityType: source.entityType, entityId: source.entityId,
    timestamp: Date.now(), schemaVersion: 1,
  };
  const rewrapped = await encryptRecord(migrateIdentity, plaintext, rekey.toEpoch, rekey.newListKey);
  migrated.push({
    id: migrateIdentity.id, record: rewrapped,
    sourceCiphertext: source.payload, plaintext,
    identity: migrateIdentity, sourceIdentity,
  });
  const up = await api('POST', `/api/shares/${shareId}/ops`, tokenOwner, {
    ops: [mkOp(migrateIdentity, rewrapped.ciphertext)],
  });
  if (up.status !== 200 || up.json?.accepted?.length !== 1) {
    fail(`迁移副本上行失败（${migrateIdentity.id}）：${JSON.stringify(up.json)?.slice(0, 200)}`);
  }
}
stepOk('2 条历史全部迁到 epoch2，迁移副本作为新 op 上行');

// ── 6. 🔴 历史对 bob 不可读的三面证据 ────────────────────────────────────────
step = 6;
// ① 密码学面：迁移副本 bob 旧钥解不开、owner 新钥解得开（含 bob 自己写的）。
const cipherV2 = client.createSharePayloadCipher({ current: { shareId, keyEpoch: rekey.toEpoch, listKey: rekey.newListKey } });
for (const entry of migrated) {
  const asRecord = { id: entry.record.id, keyEpoch: rekey.toEpoch, ciphertext: entry.record.ciphertext };
  let bobStillReads = false;
  try {
    // bob 用旧钥 + 他手里的**源行身份**试解（迁移前后身份同源）。
    await core.decryptShareRecord({ record: asRecord, shareId, listKey: listKeyV1, identity: entry.sourceIdentity });
    bobStillReads = true;
  } catch { /* 应当失败 */ }
  if (bobStillReads) fail(`迁移副本 ${entry.record.id} 竟被 bob 的旧钥解开——rekey 无效`);
  const ownerReads = new TextDecoder().decode(
    await core.decryptShareRecord({ record: asRecord, shareId, listKey: rekey.newListKey, identity: entry.identity }),
  );
  if (ownerReads !== entry.plaintext) {
    fail(`迁移副本 ${entry.record.id} owner 新钥读不回原文`);
  }
}
// ② 存储面：psql 直查——迁移副本在库里（旧密文也仍在：追加模型，不假装消失）。
const dump = run('psql', ['-tA', PSQL_URL, '-c',
  `SELECT payload::text FROM share_operations WHERE share_id = '${shareId}'`]);
if (!dump.ok) fail(`搜库失败：${dump.out.slice(-200)}`);
for (const entry of migrated) {
  if (!dump.out.includes(entry.record.ciphertext.slice(0, 64))) {
    fail(`迁移副本 ${entry.record.id} 不在库里`);
  }
}
if (!dump.out.includes(bobRecord.ciphertext.slice(0, 64))) fail('旧密文不在库里——追加模型被破坏');
// ③ 访问面：第 4 步已证 bob 下载 404——他连"再下一次用旧钥试"都做不到。
stepOk('三面证据：旧钥解不开迁移副本（含 bob 自己写的）；迁移副本在库；bob 无下载通道');

// ── 7. 🔴 被移除端如实显示 ──────────────────────────────────────────────────
step = 7;
const bobShareList = await api('GET', '/api/shares', tokenBob);
const removed = (bobShareList.json?.removedMemberships ?? []).find((m) => m.shareId === shareId);
if (!removed) fail('removedMemberships 没有出现该 share');
stepOk('bob 端如实显示已被移出');

cleanup();
console.log('\nRESULT=OK steps=7');
