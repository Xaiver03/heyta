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
 * 🔴 **边界（不包装）**：1–9 步里"设备"由**真实密码学原语 + 原始 HTTP**驱动，
 * 验证的是**服务端协议闭环**（授权、发号、收敛、零明文、移除传播）。
 * 第 10 步补上了以前缺的那一半：**下行经真宿主**（`@heyta/app-host` 的
 * `createShareCommentsHost` + 真 `ShareApiClient`），也就是文件头那句
 * "引擎接线落地后应改走真实客户端 SDK"的落地。
 * 第 12 步补的是**内容类型那一半**：任务族的写意图交经**生产路由**
 * （`createShareRoutingDispatcher`）分流，跨账号搬到对面并物化进合并视图，
 * 并发改同一格时两台上都**看得见**那枚冲突（ADR-0067 裁决一 + 补三 + 裁决三）。
 *
 * ⚠️ 仍然量不到的那一腿，如实说：这一步到**宿主层**为止。
 * "两台真浏览器里 B 看见 A 改的任务"归 `pnpm verify:collab-journey`（界面腿），
 * 因为这里没有 DOM、没有登录面板、也没有那枚共享入口的实验开关。
 *
 * 十二步：
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
 *  10. 🔴 宿主层闭环（M1 下行）：owner 的宿主写出一条评论 → owner 的第二台设备
 *      （新宿主 + 空日志）经 `pullShareOps` 拉回、解密、物化、读路径取到，
 *      再拉一次零新增且游标落在存储里。
 *  11. 🔴 实时信号（M5）：真 `createRealtimeClient` 挂在这份共享上 → 有人写评论 ⇒
 *      服务端经 WS 扇出 `new_share_ops(shareId, latestSeq)` → 宿主拉一次 ⇒
 *      旁观设备报 `["added"]`，而写它的那一台同样拉到内容却**零活动**。
 *  12. 🔴 任务族走**生产路由**（M2）：owner 在共享清单里新建/改名一条任务，意图先交
 *      `createShareRoutingDispatcher` 判 ⇒ 个人 log 零写入、bob 拉回并物化、合并视图把它
 *      挂到 **bob 自己**那条清单行；两台各改同一格且都没读过对方 ⇒ 两台各见**恰好一枚**
 *      具名冲突、两侧内容都在；裁一次 ⇒ 冲突归零且对面读到那一句。第二份 share 仍零明文。
 *
 * 用法：
 *   node scripts/verify-collab-sync.mjs [--port 3211]
 *
 * 失败退出码 1 并打印 `RESULT=FAIL step=N`；通过打印 `RESULT=OK steps=12`。
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
// 第 10 步要驱动**真宿主**（@heyta/app-host），所以它也吃构建产物，不吃源码。
const appHost = await import(join(ROOT, 'packages/app-host/dist/index.js'));
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
// 格式统一后载荷 = record 信封（version 字节 0x01 开头，base64 文本里
// 不会出现 ASCII 魔数）——逐行解码验版本字节与世代，而不是找字符串前缀。
let shapeChecked = 0;
for (const line of dbPayloads.split('\n')) {
  const b64 = line.trim().replace(/^"|"$/g, '');
  if (!b64) continue;
  const raw = Buffer.from(b64, 'base64');
  if (raw[0] !== 1) fail(`载荷版本字节异常：${raw[0]}`);
  const epoch = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getFloat64(1, false);
  if (!Number.isSafeInteger(epoch) || epoch <= 0) fail(`载荷世代异常：${epoch}`);
  shapeChecked += 1;
}
if (shapeChecked === 0) fail('share_operations 里没有可校验的载荷');
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

// ── 10. 🔴 宿主真的拉得下来（M1 下行：走 @heyta/app-host，不再手搓 HTTP）────
//
// 文件头那句"引擎接线落地后，本脚本应改走真实客户端 SDK，判据不变"就是这一格。
// 前面 1–9 步证明的是**服务端协议闭环**（原始 HTTP + 真原语）；这一步证明的是
// **消费端真的消费得到**：一条评论经 `createShareCommentsHost` 写出去，
// 另一台设备经同一个宿主的 `pullShareOps` 拉回来、解得开、物化得出来、游标推得动。
//
// ⚠️ 两处如实的边界（不包装）：
//   · 这一步的**内容类型是评论**，且它的路由数据（任务 → 清单 → shareId）由本脚本摆出来 ——
//     它量的是"下行链路 + 宿主读路径"，不是"这条写进哪本 log"。后者从第 12 步起交**真路由件**判。
//     "两台设备在界面上互相看到同一条评论"这一腿仍然不在这里量：这里没有 DOM，那是
//     `verify:collab-journey` 的界面腿。
//   · bob 在第 8 步已被移除、第 9 步 rekey，所以这一腿用 owner 的**第二台设备**
//     （新宿主 + 空日志 + 自己的游标），跨账号收敛由第 6 步与第 12 步负责。
step = 10;
const HOST_TASK = `task-host-${runId}`;
const HOST_COMMENT_BODY = `宿主写下的评论 ${runId}`;
/**
 * 作者 id 从**真 JWT** 的 `sub` 里取（只解 payload，不验签 —— 这是取自己的账号 id，
 * 不是信任边界）。取不到就退到合成 id：这一步判的是"写出去的作者字段能不能原样
 * 被另一台设备读回来"，两个 id 形状都能证这句话，但真 id 更近。
 */
const jwtSub = (token) => {
  try {
    const claim = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return typeof claim.sub === 'string' && claim.sub.trim() !== '' ? claim.sub : undefined;
  } catch {
    return undefined;
  }
};
const ownerUserId = jwtSub(tokenOwner) ?? `owner-${runId}`;
if (ownerUserId.trim() === '') fail('第 10 步拿不到非空账号 id（评论动作会当场拒绝构造）');

/** 只摆路由要看的那两跳；判断本体仍在 `@heyta/app-host`。 */
const hostCtx = {
  dispatch: async () => undefined,
  getState: () => {
    const s = opLog.emptyState();
    s.tasks[HOST_TASK] = { id: HOST_TASK, projectId: 'p-host', title: '共享清单里的任务' };
    s.projects['p-host'] = { id: 'p-host', name: '共享清单', shareId };
    return s;
  },
};

const makeLogStore = () => {
  const logs = new Map();
  const cursors = new Map();
  return {
    load: (id) => logs.get(id),
    save: (id, state) => logs.set(id, state),
    list: () => [...logs.keys()],
    cursor: (id) => cursors.get(id) ?? 0,
    setCursor: (id, seq) => cursors.set(id, seq),
  };
};

/** 真装配：真 `ShareApiClient`（真 HTTP）+ 真清单密钥（rekey 后 epoch2，带 epoch1 历史钥）。 */
const buildHost = (logStore, clientId) => appHost.createShareCommentsHost({
  ctx: hostCtx,
  api: new client.ShareApiClient({ baseUrl: BASE, getToken: () => tokenOwner }),
  cipherFor: async () => client.createSharePayloadCipher({
    current: { shareId, keyEpoch: rekey.toEpoch, listKey: rekey.newListKey },
    previous: [{ shareId, keyEpoch: 1, listKey: listKeyV1 }],
  }),
  storage: logStore,
  currentUserId: () => ownerUserId,
  clientId,
  schemaVersion: 1,
  isSignedIn: () => true,
});

const writerStore = makeLogStore();
const writer = buildHost(writerStore, 'device-A-host');
const hostCommentId = await writer.actions.addComment(HOST_TASK, HOST_COMMENT_BODY);

const readerStore = makeLogStore();
const reader = buildHost(readerStore, 'device-B-host');
const first = await reader.pullShareOps(shareId);
if (first.added < 1) fail(`宿主拉取零新增（fetched=${first.fetched}）—— 下行链路没通`);
const seen = Object.values(reader.stateFor(shareId).comments ?? {}).find((c) => c.id === hostCommentId);
if (seen === undefined) fail(`拉回来的物化状态里没有那条评论（拉到 ${first.fetched} 条）`);
if (seen.body !== HOST_COMMENT_BODY) fail(`评论正文不对：${String(seen.body)}`);
if (seen.authorUserId !== ownerUserId) fail(`评论作者不对：${String(seen.authorUserId)}`);
if (reader.commentsForTask(HOST_TASK).length !== 1) fail('读路径（按任务取线程）没吃到这条评论');

const second = await reader.pullShareOps(shareId);
if (second.fetched !== 0 || second.added !== 0) {
  fail(`第二次拉取应零新增（游标没推进就是这个形状）：fetched=${second.fetched} added=${second.added}`);
}
if (readerStore.cursor(shareId) !== second.cursor) {
  fail(`游标没落在存储里：${String(readerStore.cursor(shareId))} vs ${String(second.cursor)}`);
}
stepOk(
  `宿主层闭环：写出一条评论 → 另一台设备拉回并物化（拉到 ${String(first.fetched)} 条 / 新增 ${String(first.added)} 条），` +
    `再拉一次零新增，游标落在 ${String(second.cursor)}`,
);

// ── 11. 🔴 实时信号（M5）：服务端扇出 ⇒ 在线设备收到 ⇒ 宿主拉一次 ⇒ 该响的响、不该响的不响
//
// 第 10 步证的是"想去拉就拉得回来"；这一步证的是"**不用人去拉**"—— 也就是撤掉
// 评论区那枚 5 秒轮询之后，链路仍然成立。三段全是生产件：
// `createRealtimeClient`（真 WS）、服务端 `notifyShareOps`（按成员账号扇、跳过写入方的
// clientId）、`createShareOpsSignalHandler`（本机差集 + 活动判定）。零 mock。
//
// ⚠️ 两处如实的形状：
//   · 宿主没有 `onOpen` 回调，连接是异步建立的，所以这里**写一条等一轮**地重试（最多 6 轮）。
//     每轮都真写一条评论、服务端每次都扇出 ⇒ 最坏情况只是多写几条，而不是把判据放宽。
//     `rounds` 与 `signals.length` 一起打出来，让下一位看得见花了多少轮。
//   · 这一腿量不到"浏览器里弹出一条通知"：Notification 属于界面（归 `verify:collab-journey`）。
//     而"完成"那一档**即使**M2 之后共享任务的 op 已经进了这份日志，也不会在这里响 ——
//     活动映射今天只认 COMMENT（理由写在 `packages/app-host/src/share-signals.ts` 那个联合类型上），
//     给任务族加档位要连同通知偏好的两句措辞一起另判，不在本步的范围里。
step = 11;
const signals = [];
const signalDevice = client.createRealtimeClient({
  baseUrl: BASE,
  getToken: () => tokenOwner,
  clientId: 'device-C-signal',
  onNewOps: () => undefined,
  onNewShareOps: (sid, latestSeq) => signals.push({ shareId: sid, latestSeq }),
});
signalDevice.connect();

// （`sleep` 用脚本前面为服务端就绪探针声明的那一枚，不再重复声明）
let rounds = 0;
let got;
while (rounds < 6 && got === undefined) {
  rounds += 1;
  const before = signals.length;
  await writer.actions.addComment(HOST_TASK, `实时信号取证 ${runId} 第 ${rounds} 轮`);
  for (let tick = 0; tick < 25 && signals.length === before; tick += 1) await sleep(100);
  if (signals.length > before) got = signals[signals.length - 1];
}
if (got === undefined) {
  signalDevice.dispose();
  fail(`写了 ${rounds} 条评论，在线设备的一条 WS 里 ${String(signals.length)} 个 new_share_ops 都没收到（服务端扇出或客户端解析断了）`);
}
if (got.shareId !== shareId) fail(`信号里的 shareId 不是这一份：${String(got.shareId)}`);
if (!Number.isInteger(got.latestSeq) || got.latestSeq <= 0) {
  fail(`信号里的 latestSeq 不是正整数：${String(got.latestSeq)}`);
}

// 拉之前的日志与游标先留一份，好让"作者那一台"从**同一个起点**起跑
// （否则它拉到的是零条，"不响"就成了没数据的假绿）。
const preLog = readerStore.load(shareId);
const preCursor = readerStore.cursor(shareId);

const watcher = appHost.createShareOpsSignalHandler({
  storage: readerStore,
  // 这台设备认得这份 share：本机清单行绑着它（宿主层没有 UI 状态，直接给名单）。
  knownShareIds: () => [shareId],
  pull: (sid) => reader.pullShareOps(sid),
  myClientId: 'device-C-signal',
});
const seenByWatcher = await watcher.onShareOpsSignal(got.shareId);
if (!seenByWatcher.pulled || seenByWatcher.added < 1) {
  fail(`收到信号却没拉到新东西（pulled=${String(seenByWatcher.pulled)} added=${String(seenByWatcher.added)}）`);
}
if (JSON.stringify(seenByWatcher.activities) !== '["added"]') {
  fail(`别人写的评论应报一条 added，实际 ${JSON.stringify(seenByWatcher.activities)}`);
}

const selfStore = makeLogStore();
selfStore.save(shareId, preLog);
selfStore.setCursor(shareId, preCursor);
const selfHost = buildHost(selfStore, 'device-B-host');
const authorView = await appHost
  .createShareOpsSignalHandler({
    storage: selfStore,
    knownShareIds: () => [shareId],
    pull: (sid) => selfHost.pullShareOps(sid),
    // 这批 op 是 device-A-host 写的：写它的那一台不需要被通知自己。
    myClientId: 'device-A-host',
  })
  .onShareOpsSignal(got.shareId);
if (!authorView.pulled || authorView.added < 1) {
  fail(`作者那一台同样该真的拉到东西（pulled=${String(authorView.pulled)} added=${String(authorView.added)}）—— 否则"不响"只是没数据`);
}
if (authorView.activities.length !== 0) {
  fail(`自己动手的事不该报活动，实际 ${JSON.stringify(authorView.activities)}`);
}

signalDevice.dispose();
stepOk(
  `WS 扇出：${rounds} 条评论换来 ${String(signals.length)} 个信号（latestSeq=${String(got.latestSeq)}）；` +
    `旁观设备拉到 ${String(seenByWatcher.added)} 条并报 ["added"]，` +
    `作者设备同样拉到 ${String(authorView.added)} 条却零活动`,
);

// ── 12. 🔴 任务族走**生产路由**（ADR-0067 裁决一 + 补三 + 裁决三）
//
// 第 10/11 步那两腿走的是**评论**那一族 —— 那曾是唯一进得了 share log 的内容类型。
// M2 之后任务族也进得来，而"搬运"必须在**路由判定本身**上验：意图要先交给
// `createShareRoutingDispatcher`（生产件，它判"进哪本 log"），通道用 web 同一种装配
// （`createShareCommentDispatch` 交出来的 dispatch/stateFor/conflicts/resolveConflict），
// 读侧用 `createShareViewMerger`（ADR-0068 裁决二那一份）。三件都是生产件，零 mock。
//
// 个人那本 log 用一只**计数替身**：这一步判的就是"共享的一条都不许悄悄落本机"，
// 替身数的正是那一件事；把真引擎搬进来只会多一层与本步判据无关的依赖。
step = 12;

// 第 8 步把 bob 移出、第 9 步换了钥 ⇒ 第一份共享不能再用来看跨账号，这里另起一份，
// 并把信封下发/解钥那一条**真路径**再走一遍（不复制钥匙）。
const share2Res = await api('POST', '/api/shares', tokenOwner, {});
if (share2Res.status !== 201 || !share2Res.json?.shareId) {
  fail(`第二份共享建不出来：${JSON.stringify(share2Res.json)?.slice(0, 200)}`);
}
const share2 = share2Res.json.shareId;
const listKey2 = core.generateShareListKey();
const invite2 = await api('POST', `/api/shares/${share2}/invitations`, tokenOwner, {
  invitedEmail: `share-bob-${runId}@example.test`,
});
if (invite2.status !== 201 || !invite2.json?.token) fail(`第二份发邀请失败：${JSON.stringify(invite2.json)?.slice(0, 200)}`);
const accept2 = await api('POST', '/api/shares/invitations/accept', tokenBob, {
  token: invite2.json.token, identityPublicKey: bobPubB64,
});
if (accept2.status !== 200) fail(`bob 加入第二份失败：${JSON.stringify(accept2.json)?.slice(0, 200)}`);
const env2 = await core.sealListKeyForRecipient({
  listKey: listKey2, shareId: share2, keyEpoch: 1,
  recipientX25519PublicKey: bobIdentity.x25519PublicKey,
});
const putEnv2 = await api('PUT', `/api/shares/${share2}/members/${accept2.json.memberId}/envelope`, tokenOwner, {
  keyEpoch: 1, keyEnvelope: env2,
});
if (putEnv2.status !== 200) fail(`第二份信封下发失败：${JSON.stringify(putEnv2.json)?.slice(0, 200)}`);
const members2 = await api('GET', `/api/shares/${share2}/members`, tokenBob);
const ownRow2 = (members2.json?.members ?? []).find((m) => m.memberId === accept2.json.memberId);
if (!ownRow2?.keyEnvelope) fail('bob 在第二份的成员表里拿不到自己的信封');
const bobListKey2 = await core.openListKeyEnvelope({
  envelope: ownRow2.keyEnvelope, recipientX25519SecretKey: bobIdentity.x25519SecretKey,
});
if (hex(bobListKey2) !== hex(listKey2)) fail('bob 解出的第二份清单密钥与 owner 不一致');

const TASK2 = `task-m2-${runId}`;
const TITLE_CREATE = 'owner 在共享清单里新建的任务';
const TITLE_RENAMED = 'owner 后来改过的标题';
const TITLE_A_FINAL = '甲刷的最后一版';
const TITLE_B_FINAL = '乙刷的最后一版';

/** 一台设备：一份盘 + 一个共享通道 + 一个生产路由派发器 + 一台计数用的个人 log。 */
function makeM2Device(token, userId, clientId, listKey) {
  const store = makeLogStore();
  const dispatch = appHost.createShareCommentDispatch({
    api: new client.ShareApiClient({ baseUrl: BASE, getToken: () => token }),
    cipherFor: async () => client.createSharePayloadCipher({
      current: { shareId: share2, keyEpoch: 1, listKey },
    }),
    storage: store,
    currentUserId: () => userId,
    clientId,
    schemaVersion: 1,
    isSignedIn: () => true,
  });
  /** 与 `apps/web/src/features/share/comment-actions.ts` 同一份装配（四个端口，不多不少）。 */
  const channel = {
    dispatch: dispatch.dispatchShareOp,
    stateFor: dispatch.stateFor,
    conflicts: dispatch.conflicts,
    resolveConflict: dispatch.resolveConflict,
  };
  const personalWrites = [];
  // 这台设备**自己**那条清单行（ADR-0068 裁决一：清单记录本身是个人的，只带 shareId）。
  const rowId = `p2-${clientId}`;
  const personalState = opLog.emptyState();
  personalState.projects[rowId] = { id: rowId, name: '共享清单二', shareId: share2 };
  const mergeView = appHost.createShareViewMerger({ stateFor: (sid) => channel.stateFor(sid) });
  const route = appHost.createShareRoutingDispatcher({
    personalDispatch: async (intent) => { personalWrites.push(intent); },
    channel: async () => channel,
    // 🔴 判据与读视图必须同源（ADR-0068 裁决二）：这里喂的是合并视图，不是个人状态。
    getState: () => mergeView(personalState),
  });
  return { store, dispatch, channel, personalWrites, personalState, rowId, mergeView, route };
}

const bobUserId = jwtSub(tokenBob) ?? `bob-${runId}`;
const devA = makeM2Device(tokenOwner, ownerUserId, 'device-A-m2', listKey2);
const devB = makeM2Device(tokenBob, bobUserId, 'device-B-m2', bobListKey2);

// 12.1 新建那一形（补三）：CRT 进 share，个人那本一条都不许多。
await devA.route({
  entityType: 'TASK', entityId: TASK2, opType: 'CRT',
  payload: { title: TITLE_CREATE, projectId: devA.rowId },
});
if (devA.personalWrites.length !== 0) {
  fail(`共享清单里新建一条任务写进了个人 log（${devA.personalWrites.length} 条）—— 补三那一格又开了`);
}
const b1 = await devB.dispatch.pullShareOps(share2);
if (b1.added < 1) fail(`bob 没拉到那条新建的任务（fetched=${b1.fetched} added=${b1.added}）`);
if (devB.channel.stateFor(share2).tasks[TASK2]?.title !== TITLE_CREATE) {
  fail(`bob 物化出来的标题不对：${String(devB.channel.stateFor(share2).tasks[TASK2]?.title)}`);
}
// 读侧合并：这条任务挂到 **bob 本机**那条清单行上，不是作者本机那个 id。
const mergedB1 = devB.mergeView(devB.personalState);
if (mergedB1.tasks[TASK2]?.projectId !== devB.rowId) {
  fail(`合并视图没把它挂到 bob 本机那行：${String(mergedB1.tasks[TASK2]?.projectId)}`);
}

// 12.2 改名（UPD 同样在搬运范围内）：对面拉一次就换字，个人那本仍然零写入。
await devA.route({ entityType: 'TASK', entityId: TASK2, opType: 'UPD', payload: { title: TITLE_RENAMED } });
const b2 = await devB.dispatch.pullShareOps(share2);
if (b2.added < 1) fail(`bob 没拉到那次改名（added=${b2.added}）`);
if (devB.mergeView(devB.personalState).tasks[TASK2]?.title !== TITLE_RENAMED) {
  fail('bob 那台的合并视图还是旧标题');
}

// 12.3 🔴 并发同字段必须可见（裁决三）：两台各改同一格一次，**且都没读过对方**。
await devA.route({ entityType: 'TASK', entityId: TASK2, opType: 'UPD', payload: { title: TITLE_A_FINAL } });
await devB.route({ entityType: 'TASK', entityId: TASK2, opType: 'UPD', payload: { title: TITLE_B_FINAL } });
await devA.dispatch.pullShareOps(share2);
await devB.dispatch.pullShareOps(share2);
const conflictsA = devA.channel.conflicts();
const conflictsB = devB.channel.conflicts();
if (conflictsA.length !== 1 || conflictsB.length !== 1) {
  fail(`并发改同一格后两台应各见恰好一枚冲突，实际 A=${conflictsA.length} B=${conflictsB.length}`);
}
if (conflictsA[0].id !== conflictsB[0].id) {
  fail(`两台报的不是同一处：${conflictsA[0].id} vs ${conflictsB[0].id}`);
}
if (conflictsA[0].errorCode !== 'CONFLICT_CONCURRENT') fail(`冲突编码不对：${conflictsA[0].errorCode}`);
if (!conflictsA[0].fields.includes('title')) fail(`冲突没点到那一格：${JSON.stringify(conflictsA[0].fields)}`);
// 两侧内容都得在（"不静默丢任一侧"就是这一句）：冲突件交回的是**那两条真上过线的 op**。
const bothSides = [conflictsA[0].local.payload.title, conflictsA[0].remote.payload.title].sort().join('|');
if (bothSides !== [TITLE_A_FINAL, TITLE_B_FINAL].sort().join('|')) fail(`两侧内容没都在：${bothSides}`);

// 12.4 裁一次 = 发**一条** op，冲突自己就消失（不写第二份状态、服务端不记账）。
const keptTitle = conflictsA[0].local.payload.title;
await devA.channel.resolveConflict(conflictsA[0], 'keep-local');
await devB.dispatch.pullShareOps(share2);
await devA.dispatch.pullShareOps(share2);
if (devA.channel.conflicts().length !== 0 || devB.channel.conflicts().length !== 0) {
  fail(`裁完还在报冲突：A=${devA.channel.conflicts().length} B=${devB.channel.conflicts().length}`);
}
const mergedAfterResolve = devB.mergeView(devB.personalState);
if (mergedAfterResolve.tasks[TASK2]?.title !== keptTitle) {
  fail(`裁决没落到对面那台：期望「${keptTitle}」，实际「${String(mergedAfterResolve.tasks[TASK2]?.title)}」`);
}
if (devA.personalWrites.length + devB.personalWrites.length !== 0) {
  fail(`共享任务的改动漏进了个人 log：A=${devA.personalWrites.length} B=${devB.personalWrites.length}`);
}

// 12.5 任务族同样零明文（第 7 步那一条判据换个内容类型再量一次）。
const dump2 = run('psql', ['-tA', PSQL_URL, '-c',
  `SELECT payload::text FROM share_operations WHERE share_id = '${share2}'`]);
if (!dump2.ok) fail(`搜第二份的库失败：${dump2.out.slice(-200)}`);
for (const plain of [TITLE_CREATE, TITLE_RENAMED, TITLE_A_FINAL, TITLE_B_FINAL]) {
  if (dump2.out.includes(plain)) fail(`服务端库里出现了任务标题明文：${plain}`);
}

stepOk(
  `任务族走生产路由：新建 + 改名跨账号搬运（bob 两次各拉到 ${b1.added}/${b2.added} 条，` +
    `两台个人 log 零写入）；并发改同一格 ⇒ 两台各见 1 枚具名冲突、两侧内容都在；` +
    `裁一次（保留「${keptTitle}」）⇒ 冲突归零且对面读到该版本；第二份 share 全表仍是信封`,
);

cleanup();
console.log('\nRESULT=OK steps=12');
