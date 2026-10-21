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
 * 这里证明"移除之后密钥世界也换了"——**移除 → 换钥 → 在册成员收新钥 → 三面证据**。
 *
 * 八步：
 *   1. 三个账号（owner / bob / carol，真实 JWT）。
 *   2. 建共享 → 邀请 bob 与 carol → 两人各持 epoch1 清单密钥。
 *   3. 基线：bob 上传 op-1、owner 上传 op-2，bob 下载并读回两条（移除前一切正常）。
 *   4. 🔴 owner 移除 bob —— **走生产函数** `@heyta/app-host` 的 `removeMemberAndRekey`
 *      （真 `ShareApiClient` + 真 owner 身份 + 内存密钥环）⇒ 库里 `shares.key_epoch` 推进、
 *      owner 环里那把**换了**、他自己的新信封能解回同一把（换设备也找回得来）。
 *   5. 🔴 bob 的门关了：上传/下载一律 404，且**他那行的信封当场作废**（库里读）。
 *   6. 🔴 在册的 carol **收得到新钥**（生产函数 `adoptRotatedShareKey`）并读得到
 *      换钥之后 owner 写的那条 —— 这一格是"移除不是把所有人都锁外面"的正证。
 *   7. 🔴 历史对 bob 不可读的三面证据：
 *      ① 密码学面：epoch2 那条，bob 的旧钥解不开（他手里有密文也没用）；
 *      ② 存储面：psql 直查 ⇒ 旧密文**仍在**库里（追加模型，不假装消失）；
 *      ③ 访问面：第 5 步已证他连"再下一次试试"都做不到。
 *   8. 🔴 被移除端如实显示：bob 的 GET /shares 出现 removedMemberships。
 *
 * 🔴 本脚本**不做**历史重加密（把旧 op 逐条迁到新世代）。M3 定的承诺是"旧成员解不开
 * **新写**的内容"，那条不依赖历史重写；而"迁移副本怎么在追加模型上回放"是 op-log 语义 +
 * 线协议的事，按计划 §9.6 与 M2/M4 合进同一份 ADR。旧脚本第 5 步那段手搓迁移只是原语演示，
 * 已随本批移除——它证的不是界面上按下去的那条路。
 *
 * 🔴 边界（不包装）：「WS 已断」这一格**未覆盖**——W2 的移除路由置位
 * `removedAt`，但 WS 连接摘除挂客户端 realtime 接线（那是 M5）；本脚本没有 WS 客户端可断。
 * 接线落地后本脚本补这一格。
 *
 * 用法：
 *   node scripts/verify-collab-revoke.mjs [--port 3212]
 *
 * 失败退出码 1 并打印 `RESULT=FAIL step=N`；通过打印 `RESULT=OK steps=8`。
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
// 🔴 生产路径住在 app-host：换钥那一步必须**由这个包来做**才算"界面上按下去的那条路"。
const appHost = await import(join(ROOT, 'packages/app-host/dist/index.js'));

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

// ── 1. 三个账号 ────────────────────────────────────────────────────────────
step = 1;
const ownerRes = await api('POST', '/api/test/create-user', null, {
  email: `revoke-owner-${runId}@example.test`, password: 'revoke-verify-password',
});
const bobRes = await api('POST', '/api/test/create-user', null, {
  email: `revoke-bob-${runId}@example.test`, password: 'revoke-verify-password',
});
// 🔴 第三个成员不是凑数的：第 6 步要证"移除一个人**不是**把所有人都锁外面"，
// 只有一名在册成员时"重封给在册成员"这一半根本没东西可验。
const carolRes = await api('POST', '/api/test/create-user', null, {
  email: `revoke-carol-${runId}@example.test`, password: 'revoke-verify-password',
});
if (ownerRes.status !== 201 || !ownerRes.json?.token) fail(`owner 建号失败：${JSON.stringify(ownerRes.json)?.slice(0, 200)}`);
if (bobRes.status !== 201 || !bobRes.json?.token) fail(`bob 建号失败：${JSON.stringify(bobRes.json)?.slice(0, 200)}`);
if (carolRes.status !== 201 || !carolRes.json?.token) fail(`carol 建号失败：${JSON.stringify(carolRes.json)?.slice(0, 200)}`);
const tokenOwner = ownerRes.json.token;
const tokenBob = bobRes.json.token;
const tokenCarol = carolRes.json.token;
stepOk('三个账号就绪');

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

// carol 同样入群、同样拿到 epoch1 那把（她是在册的那一位，第 6 步要收新钥）。
const carolIdentity = core.deriveShareIdentityKeyPair(core.generateShareIdentitySeed());
const carolInvitation = await api('POST', `/api/shares/${shareId}/invitations`, tokenOwner, {});
if (carolInvitation.status !== 201 || !carolInvitation.json?.token) fail(`给 carol 发邀请失败：${JSON.stringify(carolInvitation.json)?.slice(0, 200)}`);
const carolAccepted = await api('POST', '/api/shares/invitations/accept', tokenCarol, {
  token: carolInvitation.json.token,
  identityPublicKey: Buffer.from(carolIdentity.x25519PublicKey).toString('base64'),
});
if (carolAccepted.status !== 200) fail(`carol 接受邀请失败：${JSON.stringify(carolAccepted.json)?.slice(0, 200)}`);
const carolMemberId = carolAccepted.json.memberId;
const carolEnvelope = await core.sealListKeyForRecipient({
  listKey: listKeyV1, shareId, keyEpoch: 1,
  recipientX25519PublicKey: carolIdentity.x25519PublicKey,
});
const putCarolEnv = await api('PUT', `/api/shares/${shareId}/members/${carolMemberId}/envelope`, tokenOwner, {
  keyEpoch: 1, keyEnvelope: carolEnvelope,
});
if (putCarolEnv.status !== 200) fail(`carol 信封下发失败：${JSON.stringify(putCarolEnv.json)?.slice(0, 200)}`);
const carolMembersView = await api('GET', `/api/shares/${shareId}/members`, tokenCarol);
const carolOwnRow = (carolMembersView.json?.members ?? []).find((m) => m.memberId === carolMemberId);
const carolListKey = await core.openListKeyEnvelope({
  envelope: carolOwnRow.keyEnvelope, recipientX25519SecretKey: carolIdentity.x25519SecretKey,
});
if (hex(carolListKey) !== hex(listKeyV1)) fail('carol 解出的清单密钥与 owner 不一致');
stepOk('共享建立，bob / carol / owner 三方持 epoch1 清单密钥');

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

// ── 4. 🔴 owner 移除 bob —— 走**生产函数**（界面上按下去的那条路）─────────────
//
// 这一步以前是手搓的（脚本自己调 `planShareRekey` + 自己 PUT 信封），于是它证的只是
// "原语能用"。M3 的承诺是关于**那条代码路径**的，所以这里装一个真宿主：
// 真 `ShareApiClient`（真 HTTP）+ 真 owner 身份 + 一个内存密钥环，
// 换钥由 `@heyta/app-host` 的 `removeMemberAndRekey` 做——与 web 面板调的是同一个函数。
step = 4;
const ownerMemberId = created.json.memberId;
/** 密钥环替身：web 上它是 vault 包裹的 localStorage，这里只要"当前那一把 + 存回去"这个形状。 */
const makeRing = (memberId, identity, startEpoch, startKey) => {
  let current = { keyEpoch: startEpoch, listKey: startKey.slice() };
  return {
    current: () => current,
    port: {
      load: async () => current,
      save: async (_shareId, next) => { current = { keyEpoch: next.keyEpoch, listKey: next.listKey.slice() }; },
      ownIdentity: async () => ({
        memberId,
        x25519PublicKey: identity.x25519PublicKey,
        x25519SecretKey: identity.x25519SecretKey,
      }),
    },
  };
};
const buildRotation = (token, ring) => appHost.createShareKeyRotation({
  api: new client.ShareApiClient({ baseUrl: BASE, getToken: () => token }),
  keys: ring.port,
  decodeMemberPublicKey: (value) => new Uint8Array(Buffer.from(value, 'base64')),
  isSignedIn: () => true,
});
const ownerRing = makeRing(ownerMemberId, ownerIdentity, 1, listKeyV1);
const removal = await buildRotation(tokenOwner, ownerRing).removeMemberAndRekey(shareId, bobMemberId);
if (removal.removed !== true) fail('生产函数没把人移除');
if (removal.rekeyError !== undefined) fail(`换钥失败：${removal.rekeyError}`);
const rekeyReading = removal.rekey;
if (rekeyReading.fromEpoch !== 1 || rekeyReading.toEpoch !== 2) {
  fail(`世代读数不对：${String(rekeyReading.fromEpoch)} → ${String(rekeyReading.toEpoch)}`);
}
// 🔴 收件人 = 移除**之后**仍在册的那两位，且 owner 自己那枚排在最前
// （那是他换设备后唯一能找回这把钥的通道）。
if (JSON.stringify(rekeyReading.sealedMemberIds) !== JSON.stringify([ownerMemberId, carolMemberId])) {
  fail(`新信封收件人不对：${JSON.stringify(rekeyReading.sealedMemberIds)}（应为 owner 在前、carol 在后）`);
}
if (JSON.stringify(rekeyReading.failedMemberIds) !== '[]' || JSON.stringify(rekeyReading.skippedMemberIds) !== '[]') {
  fail(`这一轮不该有失败或跳过：failed=${JSON.stringify(rekeyReading.failedMemberIds)} skipped=${JSON.stringify(rekeyReading.skippedMemberIds)}`);
}
if (hex(ownerRing.current().listKey) === hex(listKeyV1)) {
  fail('换钥之后 owner 环里还是同一把 —— 那"移除"只是改了个数字（§9.1 登记的坏法）');
}
if (ownerRing.current().keyEpoch !== 2) fail(`owner 环里的世代没跟上：${String(ownerRing.current().keyEpoch)}`);
// 真库证据：`shares.key_epoch` 被服务端推进了（不是脚本自己记的数）。
const epochRow = run('psql', ['-tA', PSQL_URL, '-c', `SELECT key_epoch FROM shares WHERE id = '${shareId}'`]);
if (!epochRow.ok || epochRow.out.trim() !== '2') fail(`库里 shares.key_epoch 应为 2，实际：${epochRow.out.trim().slice(0, 80)}`);
// 🔴 owner 自己的新信封确实落在他的行里、且用**他本机没有的那条路**（重新解信封）能取回同一把。
const ownerMembersView = await api('GET', `/api/shares/${shareId}/members`, tokenOwner);
const ownerRow = (ownerMembersView.json?.members ?? []).find((m) => m.memberId === ownerMemberId);
if (ownerRow?.keyEnvelope == null) fail('owner 那一行没有新信封（换设备就找不回这把钥）');
const reopenedSelf = await core.openListKeyEnvelope({
  envelope: ownerRow.keyEnvelope, recipientX25519SecretKey: ownerIdentity.x25519SecretKey,
});
if (hex(reopenedSelf) !== hex(ownerRing.current().listKey)) fail('owner 自己那枚信封解不出刚换的这把钥');
stepOk(`生产路径换钥：epoch ${String(rekeyReading.fromEpoch)} → ${String(rekeyReading.toEpoch)}，库里有据，收件人 ${rekeyReading.sealedMemberIds.length} 位`);

// ── 5. 🔴 bob 的门关了：传输面 404 + 他那行的信封当场作废 ─────────────────────
step = 5;
const bobRetryWireOp = wireOp(`revoke-bob-op2-${runId}`);
const bobUpAfter = await api('POST', `/api/shares/${shareId}/ops`, tokenBob, {
  ops: [mkOp(bobRetryWireOp, (await encryptRecord(bobRetryWireOp, '移除后的重试')).ciphertext)],
});
if (bobUpAfter.status !== 404) fail(`被移除者上传应 404，实际 ${bobUpAfter.status}`);
const bobDownloadAfter = await api('GET', `/api/shares/${shareId}/ops/causal?after=0`, tokenBob);
if (bobDownloadAfter.status !== 404) fail(`被移除者下载应 404，实际 ${bobDownloadAfter.status}`);
// 🔴 信封作废这一格是 M3 的另一半：库里还替被踢的人保管着他那把钥，就还不叫收回。
// 也是"重新邀请会复用同一行"那个坑的堵法——旧信封还在、世代被抬到当前 ⇒
// 面板以为他密钥已下发，而补封逻辑永远跳过他。
const bobRowDb = run('psql', ['-tA', PSQL_URL, '-c',
  `SELECT (key_envelope IS NULL) FROM share_members WHERE id = '${bobMemberId}'`]);
if (!bobRowDb.ok || bobRowDb.out.trim() !== 't') {
  fail(`被移除者那行的信封应已作废，库里的读数：${bobRowDb.out.trim().slice(0, 80)}`);
}
stepOk('bob：上传/下载一律 404，且他那行成员的信封在库里已作废');

// ── 6. 🔴 在册的 carol 收得到新钥，并读得到换钥之后写的内容 ───────────────────
//
// 这一格是"移除不是把所有人都锁外面"的正证，也是以前那个手搓版本**没有**的方向：
// 它只证了旧成员读不到，没证在册成员还读得到。收钥同样走生产函数 `adoptRotatedShareKey`。
step = 6;
const carolRing = makeRing(carolMemberId, carolIdentity, 1, listKeyV1);
const adopted = await buildRotation(tokenCarol, carolRing).adoptRotatedShareKey(shareId);
if (adopted.adopted !== true || adopted.keyEpoch !== 2) fail(`carol 没收到新钥：${JSON.stringify(adopted)}`);
if (hex(carolRing.current().listKey) !== hex(ownerRing.current().listKey)) {
  fail('carol 收到的那把与 owner 刚铸的那把不是同一把');
}

// owner 用新钥写一条，carol 用收到的那把从**真下载**里读回来。
const EPOCH2_TITLE = `换钥之后写的任务 ${String(runId)}`;
const epoch2Identity = {
  id: `revoke-epoch2-${String(runId)}`, clientId: 'device-shared', actionType: 'add task', opType: 'CRT',
  entityType: 'TASK', entityId: `revoke-epoch2-${String(runId)}`, timestamp: Date.now(), schemaVersion: 1,
};
const epoch2Record = await encryptRecord(epoch2Identity, EPOCH2_TITLE, 2, ownerRing.current().listKey);
const epoch2Up = await api('POST', `/api/shares/${shareId}/ops`, tokenOwner, {
  ops: [mkOp(epoch2Identity, epoch2Record.ciphertext)],
});
if (epoch2Up.status !== 200 || epoch2Up.json?.accepted?.length !== 1) {
  fail(`新世代上行失败：${JSON.stringify(epoch2Up.json)?.slice(0, 200)}`);
}
const carolApi = new client.ShareApiClient({ baseUrl: BASE, getToken: () => tokenCarol });
const carolPage = await carolApi.downloadOps(shareId, 0);
const wireOf = (row) => ({
  id: row.id, clientId: row.clientId, actionType: row.actionType, opType: row.opType,
  entityType: row.entityType, entityId: row.entityId,
  timestamp: Number(row.clientTimestamp), schemaVersion: row.schemaVersion,
});
const carolCipher = client.createSharePayloadCipher({
  current: { shareId, keyEpoch: carolRing.current().keyEpoch, listKey: carolRing.current().listKey },
  previous: [{ shareId, keyEpoch: 1, listKey: listKeyV1 }],
});
const epoch2Row = carolPage.ops.find((op) => op.id === epoch2Identity.id);
if (epoch2Row === undefined) fail('carol 的下载页里没有那条新世代的 op');
const epoch2Back = await carolCipher.decrypt(String(epoch2Row.payload), wireOf(epoch2Row));
if (!epoch2Back.includes(EPOCH2_TITLE)) fail(`carol 读回的正文不对：${epoch2Back.slice(0, 80)}`);
// 🔴 旧世代也还读得到（环里留着 epoch1 那把）。日志是追加模型，旧密文没消失——
// 少了这一格就会漏掉"换钥时只留新钥"那种坏法：症状不是少一条，是整个评论区卡死。
const oldRow = carolPage.ops.find((op) => op.id === bobWireOp.id);
if (oldRow === undefined) fail('carol 的下载页里没有换钥之前那条');
const oldBack = await carolCipher.decrypt(String(oldRow.payload), wireOf(oldRow));
if (!oldBack.includes(BOB_TITLE)) fail(`换钥之后旧世代反而读不到了：${oldBack.slice(0, 80)}`);
stepOk('carol 走生产函数收到新钥：换钥后写的读得到，换钥前那一代的也读得到');

// ── 7. 🔴 对 bob 不可读的两面证据（密码学面 + 存储面）────────────────────────
step = 7;
// ① 密码学面：他手里那份旧钥（epoch1）解不开 epoch2 的载荷——拿到密文也没用。
let bobStillReads = false;
try {
  await core.decryptShareRecord({
    record: { id: epoch2Record.id, keyEpoch: 2, ciphertext: epoch2Record.ciphertext },
    shareId, listKey: listKeyV1, identity: epoch2Identity,
  });
  bobStillReads = true;
} catch { /* 应当失败 */ }
if (bobStillReads) fail('bob 的旧钥竟解得开换钥之后写的内容 —— rekey 无效');
// ② 存储面：旧密文**仍在**库里。写下来是防止把"移除"演成"历史消失了"——
//    旧世代只有拿旧钥的人解得开，而那个人已经没有下载通道（第 5 步）。
const dump = run('psql', ['-tA', PSQL_URL, '-c',
  `SELECT payload::text FROM share_operations WHERE share_id = '${shareId}'`]);
if (!dump.ok) fail(`搜库失败：${dump.out.slice(-200)}`);
if (!dump.out.includes(bobRecord.ciphertext.slice(0, 64))) fail('旧密文不在库里——追加模型被破坏');
if (!dump.out.includes(epoch2Record.ciphertext.slice(0, 64))) fail('新世代那条不在库里');
// ③ 访问面：第 5 步已证他下载 404——他连"再下一次试试"都做不到。
stepOk('两面证据：旧钥解不开新内容、库里旧密文仍在（不假装历史消失）；访问面见第 5 步');

// ── 8. 🔴 被移除端如实显示 ──────────────────────────────────────────────────
step = 8;
const bobShareList = await api('GET', '/api/shares', tokenBob);
const removed = (bobShareList.json?.removedMemberships ?? []).find((m) => m.shareId === shareId);
if (!removed) fail('removedMemberships 没有出现该 share');
stepOk('bob 端如实显示已被移出');

cleanup();
console.log('\nRESULT=OK steps=8');
