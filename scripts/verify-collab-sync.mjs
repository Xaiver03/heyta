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
 * 仍然没接的是**上传队列与 op-log 的 share 分区**（共享清单里的 TASK/PROJECT 还没
 * 路由进 share log —— 计划 §9.3 的 M2），所以"两台设备在界面上互相看到同一条任务"
 * 这一腿今天量不到，只能量到宿主层。
 *
 * 十一步：
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
 *
 * 用法：
 *   node scripts/verify-collab-sync.mjs [--port 3211]
 *
 * 失败退出码 1 并打印 `RESULT=FAIL step=N`；通过打印 `RESULT=OK steps=11`。
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
//   · 路由数据（任务 → 清单 → shareId）由本脚本**摆出来**，因为共享清单里的
//     TASK/PROJECT 本身还没进 share log —— 那是 M2（写路径路由）的活，
//     所以"两台设备在界面上互相看到同一条评论"这一腿今天量不到，只能量到宿主层。
//   · bob 在第 8 步已被移除、第 9 步 rekey，所以这一腿用 owner 的**第二台设备**
//     （新宿主 + 空日志 + 自己的游标），跨账号收敛仍由第 6 步负责。
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
//   · 这一腿量不到"浏览器里弹出一条通知"：Notification 属于界面，而共享任务的路由
//     （TASK op 进 share log）还没做（M2），所以"完成"那一档今天没有输入。
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

cleanup();
console.log('\nRESULT=OK steps=11');
