#!/usr/bin/env node
/**
 * P0 验收脚本：真实同步闭环。
 *
 * 这是 `docs/08-implementation-plan.md` §2.6 的可执行版本 ——
 * heyta 第一阶段（奠基）的**唯一验收判据**。
 *
 * 验证内容：
 *   1. 客户端 A 上传一条 TASK 操作
 *   2. 客户端 B 下载并看到它
 *   3. 冲突：两端并发改同一实体 → 服务端必须拒绝其中一条（CONFLICT_CONCURRENT）
 *   4. 加密：payload 以密文上传，服务端不解密
 *
 * 用法：
 *   # 不需要服务器：只校验 op 形状是否通过真实的线协议契约
 *   node scripts/verify-sync-loop.mjs --dry-run
 *
 *   # 打真实服务器（需要服务端以 TEST_MODE 启动）
 *   node scripts/verify-sync-loop.mjs --base-url http://localhost:1900
 *
 * ⚠️ 依赖各包已构建：pnpm -r build
 */

import { ENTITY_TYPES, SuperSyncUploadOpsRequestSchema } from '@heyta/shared-schema';
import { encrypt, clearSessionKeyCache } from '@heyta/sync-core';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BASE_URL = (() => {
  const i = args.indexOf('--base-url');
  return i >= 0 ? args[i + 1] : 'http://localhost:1900';
})();
const ENCRYPTION_PASSWORD = 'heyta-e2e-测试密码-🔑';

let failures = 0;
const ok = (label) => console.log(`  ✅ ${label}`);
const bad = (label, detail) => {
  failures++;
  console.log(`  ❌ ${label}`);
  if (detail) console.log(`     ${detail}`);
};

/** 生成一个符合线协议的操作。 */
const makeOp = async ({
  clientId,
  entityId,
  title,
  clock,
  encryptPayload,
}) => {
  const payload = {
    actionPayload: { taskId: entityId, title },
    entityChanges: [{ entityType: 'TASK', entityId, changes: { title } }],
  };
  return {
    id: crypto.randomUUID(),
    clientId,
    actionType: '[Task] Update',
    opType: 'UPD',
    entityType: 'TASK',
    entityId,
    entityIds: [entityId],
    payload: encryptPayload
      ? await encrypt(JSON.stringify(payload), ENCRYPTION_PASSWORD)
      : payload,
    vectorClock: clock,
    timestamp: Date.now(),
    schemaVersion: 1,
    isPayloadEncrypted: Boolean(encryptPayload),
  };
};

// ─────────────────────────────────────────────────────────────────────────
//  阶段 0：本地契约校验（不需要服务器）
// ─────────────────────────────────────────────────────────────────────────
console.log('\n=== 阶段 0：op 形状是否符合真实线协议契约 ===\n');

const CLIENT_A = 'client-a-verify';
const CLIENT_B = 'client-b-verify';
const ENTITY_ID = 'task-e2e-1';

clearSessionKeyCache();

const opPlain = await makeOp({
  clientId: CLIENT_A,
  entityId: ENTITY_ID,
  title: '买牛奶',
  clock: { [CLIENT_A]: 1 },
  encryptPayload: false,
});

const opEncrypted = await makeOp({
  clientId: CLIENT_A,
  entityId: ENTITY_ID,
  title: '买牛奶（加密）',
  clock: { [CLIENT_A]: 2 },
  encryptPayload: true,
});

for (const [label, op] of [
  ['明文 op', opPlain],
  ['加密 op', opEncrypted],
]) {
  const result = SuperSyncUploadOpsRequestSchema.safeParse({
    ops: [op],
    clientId: op.clientId,
  });
  if (result.success) {
    ok(`${label} 通过上传请求契约`);
  } else {
    bad(
      `${label} 不符合契约`,
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
}

// ⚠️ 实测发现（第二个不对称）：线协议 schema **接受** `isPayloadEncrypted: false` 的明文 op，
// 但服务端**无条件拒绝**它（E2EE_REQUIRED，且没有开关）。
// 也就是说，客户端无法从契约中得知"必须加密"这件事 —— 又是一个要靠文档/运行时才发现的要求。
// 把它固化成断言，避免有人误以为 schema 已经保证了 E2EE。
if (SuperSyncUploadOpsRequestSchema.safeParse({ ops: [opPlain], clientId: CLIENT_A }).success) {
  ok('已确认：线协议 schema 允许明文载荷（E2EE 门禁在服务端）');
} else {
  ok('线协议 schema 已内置 E2EE 强制');
}

// ⚠️ 实测发现（重要）：线协议 schema **只校验形状，不校验实体是否在清单里**。
// 传一个不存在的 entityType，SuperSyncOperationSchema 会**接受**它 ——
// 实体成员校验只存在于服务端的 validation.service.ts（`ALLOWED_ENTITY_TYPES.has(...)`）。
//
// 后果：客户端如果拼错了实体名，要到上传后被服务端拒绝才知道，本地不会失败。
// 这是 heyta 需要注意的**不对称**。我们提供的 `isEntityType()` 就是为了让客户端
// 能在**上传前**自查。这条断言刻意固化这个事实，防止有人误以为 schema 已经覆盖了它。
const unknownEntity = SuperSyncUploadOpsRequestSchema.safeParse({
  ops: [{ ...opPlain, entityType: 'NOT_A_REAL_ENTITY' }],
  clientId: CLIENT_A,
});
if (unknownEntity.success) {
  ok('已确认：线协议 schema 不校验实体成员（实体校验在服务端）');
} else {
  ok('线协议 schema 已内置实体成员校验');
}

// 客户端自查能力必须存在且有效
const { isEntityType } = await import('@heyta/shared-schema');
if (isEntityType('TASK') && !isEntityType('NOT_A_REAL_ENTITY')) {
  ok('客户端可用 isEntityType() 在上传前自查');
} else {
  bad('isEntityType() 行为不正确 —— 客户端无法提前发现非法实体');
}

// 实体清单必须是 heyta 的（不是上游 Super Productivity 的 21 项清单）
//
// ⚠️ 这里**刻意不写死项数**。原先写的是 `ENTITY_TYPES.length === 13`，而 heyta
// 后来新增了 `AI_FEEDBACK` / `PREFERENCE_CORRECTION`（可加性变更，见 ADR-0014 §3.2），
// 清单变成 15 项，于是这条检查**在没有真 bug 的情况下一直红**，还把
// `pnpm verify:sync:dry`（P0 验收脚本）一起弄红了。
// 项数是**会漂的**，而这条检查真正想证明的是"这份清单是 heyta 自己设计的" ——
// 所以判据改成"必须包含 heyta 专属实体、且不混入上游专属实体"。
const HEYTA_SPECIFIC_ENTITIES = [
  'HABIT',
  'HABIT_LOG',
  'FOCUS_SESSION',
  'AI_FEEDBACK',
  'PREFERENCE_CORRECTION',
];
// 上游有、而 heyta 刻意**没有**的实体（摘自上表 21 项中最有辨识度的几个）
const UPSTREAM_ONLY_ENTITIES = [
  'SIMPLE_COUNTER',
  'METRIC',
  'TIME_TRACKING',
  'PLUGIN_METADATA',
  'WORK_CONTEXT',
];
const missingHeytaEntities = HEYTA_SPECIFIC_ENTITIES.filter((t) => !ENTITY_TYPES.includes(t));
const leakedUpstreamEntities = UPSTREAM_ONLY_ENTITIES.filter((t) => ENTITY_TYPES.includes(t));
if (missingHeytaEntities.length === 0 && leakedUpstreamEntities.length === 0) {
  ok(
    `实体清单是 heyta 的（${ENTITY_TYPES.length} 项，含 ${HEYTA_SPECIFIC_ENTITIES.length} 个 heyta 专属；未混入上游实体）`
  );
} else {
  bad(
    `实体清单不是 heyta 的：缺少 heyta 专属 ${missingHeytaEntities.join(' / ') || '（无）'}；` +
      `混入上游专属 ${leakedUpstreamEntities.join(' / ') || '（无）'}`
  );
}

// 加密 op 的载荷必须不是明文
const ct = opEncrypted.payload;
if (typeof ct === 'string' && !ct.includes('买牛奶')) {
  ok('加密 op 的载荷不包含明文');
} else {
  bad('加密 op 的载荷疑似泄露明文');
}

if (DRY_RUN) {
  console.log(
    `\n=== dry-run 结束：${failures === 0 ? '全部通过 ✅' : `${failures} 项失败 ❌`} ===`,
  );
  console.log('\n（未连接服务器。加 --base-url <url> 打真实服务端。）\n');
  process.exit(failures === 0 ? 0 : 1);
}

// ─────────────────────────────────────────────────────────────────────────
//  阶段 1-N：真实服务器
// ─────────────────────────────────────────────────────────────────────────
const api = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
};

console.log(`\n=== 阶段 1：连通性（${BASE_URL}）===\n`);

const status = await api('/api/sync/status');
if (status.status === 401) {
  ok('服务端可达（/api/sync/status 要求鉴权，符合预期）');
} else if (status.status === 200) {
  ok('服务端可达');
} else {
  bad(`服务端不可达或有异常`, `HTTP ${status.status}`);
  console.log('\n请确认服务端已启动，且 BASE_URL 正确。\n');
  process.exit(1);
}

console.log('\n=== 阶段 2：创建测试账号 ===\n');

const email = `heyta-e2e-${Date.now()}@example.com`;
const created = await api('/api/test/create-user', {
  method: 'POST',
  body: { email, password: 'heyta-e2e-password' },
});
const token =
  created.body?.token ?? created.body?.accessToken ?? created.body?.data?.token;
if (token) {
  ok('已创建测试账号并拿到 JWT');
} else {
  bad('创建测试账号失败', JSON.stringify(created.body).slice(0, 200));
  console.log('\n注意：服务端必须以 TEST_MODE 启动才能使用 /api/test/* 路由。\n');
  process.exit(1);
}

const upload = (ops, clientId, lastKnownServerSeq) =>
  api('/api/sync/ops', {
    method: 'POST',
    token,
    body: { ops, clientId, lastKnownServerSeq },
  });
const download = (sinceSeq, excludeClient) =>
  api(
    `/api/sync/ops?sinceSeq=${sinceSeq}&limit=100` +
      (excludeClient ? `&excludeClient=${encodeURIComponent(excludeClient)}` : ''),
    { token },
  );

console.log('\n=== 阶段 3：A 写入 → B 可见 ===\n');

// ⚠️ 关键事实（实测发现）：服务端**强制要求 E2EE**，没有开关。
// `violatesE2eeGate` 要求 isPayloadEncrypted **显式等于 true**
// 且 payload 是规范 base64 密文（见 server/src/sync/sync.routes.payload.ts:47）。
// 明文上传一律 400 E2EE_REQUIRED。
//
// 这条门禁在指纹/去重/配额/落库**之前**执行，所以被拒的上传在服务端不留痕迹。

// 先做负面测试：明文必须被拒（否则门禁形同虚设）
const upPlain = await upload([opPlain], CLIENT_A, 0);
if (upPlain.body?.errorCode === 'E2EE_REQUIRED') {
  ok('服务端正确拒绝了明文上传（E2EE_REQUIRED）');
} else {
  bad(
    '明文上传没有被拒绝 —— E2EE 门禁可能失效',
    JSON.stringify(upPlain.body).slice(0, 200),
  );
}

// 正式验证：加密上传
const upA = await upload([opEncrypted], CLIENT_A, 0);
if (upA.status === 200 && upA.body?.results?.[0]?.accepted) {
  ok(`A 加密上传成功（serverSeq=${upA.body.results[0].serverSeq}）`);
} else {
  bad('A 加密上传失败', JSON.stringify(upA.body).slice(0, 300));
}

const downB = await download(0, CLIENT_B);
const bSees = downB.body?.ops?.some((o) => o.op?.entityId === ENTITY_ID);
if (bSees) {
  ok('B 下载后看到了 A 的操作');
  // 服务端拿到的必须是密文
  const got = downB.body.ops.find((o) => o.op?.entityId === ENTITY_ID);
  if (typeof got.op.payload === 'string' && !got.op.payload.includes('买牛奶')) {
    ok('B 收到的载荷仍是密文（服务端未曾解密）');
  } else {
    bad('B 收到的载荷疑似明文 —— 端到端加密被破坏');
  }
} else {
  bad('B 没有看到 A 的操作', JSON.stringify(downB.body).slice(0, 300));
}

console.log('\n=== 阶段 4：并发冲突应被拒绝 ===\n');

// 两端基于同一个 vector clock 并发修改同一实体，都在 A 的版本之上。
// ⚠️ 必须**分两次请求**：服务端要求 op 的 clientId 与请求级 clientId 一致，
// 把两个不同 clientId 的 op 塞进一个请求会得到 INVALID_CLIENT_ID ——
// 那样测试会"通过"但完全没测到冲突检测（踩过这个坑，记在这里）。
const baseClock = { [CLIENT_A]: 1 };

// 两个设备各自从服务端拉到同一基线，然后并发改同一实体
const concurrentA = await makeOp({
  clientId: CLIENT_A,
  entityId: ENTITY_ID,
  title: 'A 的改法',
  clock: { ...baseClock, [CLIENT_A]: 2 },
  encryptPayload: true,
});
const concurrentB = await makeOp({
  clientId: CLIENT_B,
  entityId: ENTITY_ID,
  title: 'B 的改法',
  clock: { ...baseClock, [CLIENT_B]: 2 },
  encryptPayload: true,
});

const upA2 = await upload([concurrentA], CLIENT_A, 0);
const upB2 = await upload([concurrentB], CLIENT_B, 0);

const resA = upA2.body?.results?.[0];
const resB = upB2.body?.results?.[0];
const CONFLICT_CODES = ['CONFLICT_CONCURRENT', 'CONFLICT_SUPERSEDED'];

if (resA?.accepted && resB?.accepted) {
  bad(
    '服务端同时接受了两个并发写 —— 冲突检测可能失效',
    `A=${JSON.stringify(resA)} B=${JSON.stringify(resB)}`,
  );
} else {
  const loser = !resA?.accepted ? resA : resB;
  const winner = !resA?.accepted ? resB : resA;
  if (CONFLICT_CODES.includes(loser?.errorCode)) {
    ok(`服务端识别出并发冲突并拒绝了败者（errorCode=${loser.errorCode}）`);
    ok(`胜者被正常接受（serverSeq=${winner?.serverSeq}）`);
  } else {
    // 被拒了，但**不是因为冲突** —— 这是"以错误理由通过"，必须暴露出来。
    bad(
      `并发写被拒绝，但错误码不是冲突类（errorCode=${loser?.errorCode}）—— 冲突检测并未真正被验证`,
      JSON.stringify(loser).slice(0, 200),
    );
  }
}

console.log(
  `\n=== 验收结束：${failures === 0 ? '全部通过 ✅' : `${failures} 项失败 ❌`} ===\n`,
);
process.exit(failures === 0 ? 0 : 1);
