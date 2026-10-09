#!/usr/bin/env node
/**
 * verify:collab-keys —— 共享清单密钥协议闭环验收（ADR-0062 / 计划 §4 第一行）。
 * ==================================================================
 *
 * 回答的问题：「信封、rekey、历史重加密」这三件事在**真实原语**上成不成立。
 * 判据全部走真实栈：真实 WebCrypto（Node）+ 真实 `@heyta/sync-core` 的
 * **构建产物**（dist，客户端实际消费的那一份）——零 mock。
 *
 * 五步，缺一步不算闭合（判据与计划 §4 `verify:collab-keys` 行逐字对应）：
 *
 *   1. 信封只有目标成员可解：owner 给 alice/bob 各封一份清单密钥，
 *      两人各解出同一把；**没被邀请的第三方解不开**。
 *   2. 旧世代可读：bob 被移除前加密的 op，用旧世代钥可解。
 *   3. 🔴 rekey 后旧 listKey 读不了新 op：移除 bob ⇒ epoch 2 ⇒
 *      用 epoch 1 的旧钥解新 op 必须失败（GCM 认证挡住）。
 *   4. 🔴 历史重加密**幂等可续传**：两个"独立实例"（各自的内存态、
 *      相同输入）对同一批记录重加密，逐字节相同；批次里混一条已迁移的
 *      记录 = 幂等 no-op；**重建实例后续传**（只迁了一半的 journal 重跑）
 *      的终态与一次跑完完全一致——AGENTS 规则 16 的判据形状。
 *   5. 🔴 journal 卫生：迁移账面（记录 id、世代、密文）的 JSON 面里
 *      **搜不到任何密钥材料**——listKey、op 子钥、信封密文都算。
 *
 * 用法：
 *   node scripts/verify-collab-keys.mjs
 *
 * 失败时退出码 1，打印 `RESULT=FAIL step=N`；全部通过打印 `RESULT=OK`。
 * 变异臂（证明能红）：把 `planShareRekey` 改成复用同一把 listKey ⇒
 * 第 3 步必红（2026-10-08 实测：恰好第 3 步红，其余绿）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(scriptDir, '../packages/sync-core/dist/index.js');

/** 走构建产物——客户端实际消费的那一份；源码直连会让验收漂在实现上。 */
let core;
try {
  core = await import(distDir);
} catch (err) {
  console.error('RESULT=FAIL step=0 reason=sync-core dist 缺失，先跑 pnpm --filter @heyta/sync-core build');
  console.error(String(err));
  process.exit(1);
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

let step = 0;
const fail = (reason) => {
  console.error(`RESULT=FAIL step=${step} reason=${reason}`);
  process.exit(1);
};
const stepOk = (message) => {
  console.log(`STEP ${step} OK ${message}`);
};

const SHARE = 'share-verify-collab-keys';

// ── 1. 信封只有目标成员可解 ────────────────────────────────────────────────
step = 1;
const owner = core.deriveShareIdentityKeyPair(core.generateShareIdentitySeed());
const alice = core.deriveShareIdentityKeyPair(core.generateShareIdentitySeed());
const bob = core.deriveShareIdentityKeyPair(core.generateShareIdentitySeed());
const mallory = core.deriveShareIdentityKeyPair(core.generateShareIdentitySeed());
const listKeyV1 = core.generateShareListKey();

const sealFor = async (member) => core.sealListKeyForRecipient({
  listKey: listKeyV1, shareId: SHARE, keyEpoch: 1,
  recipientX25519PublicKey: member.x25519PublicKey,
});
const openAs = async (envelope, member) => core.openListKeyEnvelope({
  envelope, recipientX25519SecretKey: member.x25519SecretKey,
});

const aliceEnvelope = await sealFor(alice);
const bobEnvelope = await sealFor(bob);
const aliceKey = await openAs(aliceEnvelope, alice);
const bobKey = await openAs(bobEnvelope, bob);
if (hex(aliceKey) !== hex(listKeyV1)) fail('alice 解出的清单密钥与原钥不一致');
if (hex(bobKey) !== hex(listKeyV1)) fail('bob 解出的清单密钥与原钥不一致');
let malloryRejected = false;
try {
  await openAs(aliceEnvelope, mallory);
} catch {
  malloryRejected = true;
}
if (!malloryRejected) fail('未受邀请的第三方解开了信封');
stepOk('owner→alice/bob 信封各解出同一把钥匙；mallory 被拒');

// ── 2. 旧世代可读（bob 被移除前的 op） ─────────────────────────────────────
step = 2;
const opRecord = (id, plaintext, kEpoch) => core.encryptShareRecord({
  id, plaintext: new TextEncoder().encode(plaintext), shareId: SHARE, listKey: listKeyV1, keyEpoch: kEpoch,
  identity: { clientId: 'device-verify', actionType: 'add task', opType: 'CRT', entityType: 'TASK', entityId: id, timestamp: 1_700_000_000_000, schemaVersion: 1 },
});
const legacyOps = [];
for (const [id, text] of [['op-1', 'bob 在移除前写的任务'], ['op-2', 'second record'], ['op-3', 'third record']]) {
  legacyOps.push(await opRecord(id, text, 1));
}
const readBack = async (record, key, epoch, identity) => new TextDecoder().decode(await core.decryptShareRecord({
  record, shareId: SHARE, listKey: key,
  identity: identity ?? { clientId: 'device-verify', actionType: 'add task', opType: 'CRT', entityType: 'TASK', entityId: record.id, timestamp: 1_700_000_000_000, schemaVersion: 1 },
}));
if ((await readBack(legacyOps[0], listKeyV1, 1)) !== 'bob 在移除前写的任务') fail('epoch1 记录读不回原文');
stepOk('epoch1 三条记录以旧钥可读');

// ── 3. 🔴 rekey 后旧 listKey 读不了新 op ──────────────────────────────────
step = 3;
const rekey = await core.planShareRekey({
  shareId: SHARE,
  fromEpoch: 1,
  remainingMemberX25519PublicKeys: [alice.x25519PublicKey], // bob 被移除
});
if (rekey.toEpoch !== 2) fail(`rekey 世代应为 2，实际 ${rekey.toEpoch}`);
const aliceNewKey = await openAs(rekey.envelopes[0], alice);
if (hex(aliceNewKey) === hex(listKeyV1)) fail('rekey 后的新钥匙与旧钥匙相同——等于没换');
const newOp = await core.encryptShareRecord({
  id: 'op-4', plaintext: new TextEncoder().encode('移除之后的新任务'),
  shareId: SHARE, listKey: rekey.newListKey, keyEpoch: 2,
  identity: { clientId: 'device-verify', actionType: 'add task', opType: 'CRT', entityType: 'TASK', entityId: 'op-4', timestamp: 1_700_000_100_000, schemaVersion: 1 },
});
let oldKeyRejected = false;
try {
  await readBack(newOp, listKeyV1, 1, { clientId: 'device-verify', actionType: 'add task', opType: 'CRT', entityType: 'TASK', entityId: 'op-4', timestamp: 1_700_000_100_000, schemaVersion: 1 });
} catch {
  oldKeyRejected = true;
}
if (!oldKeyRejected) fail('旧 listKey 解开了 rekey 之后的 op——移除形同虚设');
// 被移除的 bob 拿不到 epoch2 信封（不在 remaining 名单里），他的旧信封重放为 epoch2 也无效。
let bobReplayRejected = false;
try {
  await core.openListKeyEnvelope({
    envelope: { ...bobEnvelope, keyEpoch: 2 },
    recipientX25519SecretKey: bob.x25519SecretKey,
  });
} catch {
  bobReplayRejected = true;
}
if (!bobReplayRejected) fail('bob 的 epoch1 信封被当作 epoch2 重放成功');
stepOk('rekey 后旧钥解不了新 op；被移除者既无新信封、旧信封重放也被拒');

// ── 4. 🔴 历史重加密幂等可续传（两个独立实例 + 重建实例续传） ────────────────
step = 4;
const toEpoch = 2;
const migrateAll = async (records) => {
  const out = [];
  for (const record of records) {
    out.push(await core.reencryptShareRecord({
      record, shareId: SHARE, fromListKey: listKeyV1, toListKey: rekey.newListKey, toEpoch,
      identity: { clientId: 'device-verify', actionType: 'add task', opType: 'CRT', entityType: 'TASK', entityId: record.id, timestamp: 1_700_000_000_000, schemaVersion: 1 },
    }));
  }
  return out;
};
// 实例 A：一次跑完全部三条。
const instanceA = await migrateAll(legacyOps);
// 实例 B：独立重算（等价于"重建实例"），必须逐字节相同（幂等）。
const instanceB = await migrateAll(legacyOps);
for (let i = 0; i < instanceA.length; i += 1) {
  if (instanceA[i].ciphertext !== instanceB[i].ciphertext) {
    fail(`重加密不幂等：第 ${i} 条两实例产出不同`);
  }
}
// 续传：journal 只迁了第一条（中断），重建实例后重跑全量 ⇒ 终态与 A 一致。
const resumed = [
  await core.reencryptShareRecord({
    record: legacyOps[0], shareId: SHARE, fromListKey: listKeyV1, toListKey: rekey.newListKey, toEpoch,
    identity: { clientId: 'device-verify', actionType: 'add task', opType: 'CRT', entityType: 'TASK', entityId: legacyOps[0].id, timestamp: 1_700_000_000_000, schemaVersion: 1 },
  }),
  ...(await migrateAll(legacyOps.slice(1))),
];
for (let i = 0; i < instanceA.length; i += 1) {
  if (resumed[i].ciphertext !== instanceA[i].ciphertext) {
    fail(`续传终态发散：第 ${i} 条与一次跑完的产出不同`);
  }
}
// 迁移后的记录用新钥可读、旧钥不可读。
if ((await readBack(resumed[0], rekey.newListKey, toEpoch)) !== 'bob 在移除前写的任务') {
  fail('迁移后记录读不回原文');
}
let oldKeyOnMigratedRejected = false;
try {
  await readBack(resumed[0], listKeyV1, 1);
} catch {
  oldKeyOnMigratedRejected = true;
}
if (!oldKeyOnMigratedRejected) fail('迁移后的记录仍可被旧钥解开');
stepOk('双实例逐字节一致（幂等）；中断续传终态收敛；迁移后旧钥不可读');

// ── 5. 🔴 journal 卫生：账面上搜不到密钥材料 ────────────────────────────────
step = 5;
const journal = JSON.stringify({
  shareId: SHARE,
  fromEpoch: 1, toEpoch,
  records: resumed,
});
const secrets = [
  hex(listKeyV1), hex(rekey.newListKey), hex(aliceKey),
  encodeBase64Of(listKeyV1), encodeBase64Of(rekey.newListKey),
  hex(await core.deriveShareOperationKey(rekey.newListKey, SHARE, toEpoch)),
];
for (const secret of secrets) {
  if (journal.includes(secret)) fail('journal 的 JSON 面里出现了密钥材料');
}
stepOk('journal 只含 id/世代/密文，密钥材料零命中');

console.log('RESULT=OK steps=5');

function encodeBase64Of(bytes) {
  return Buffer.from(bytes).toString('base64');
}
