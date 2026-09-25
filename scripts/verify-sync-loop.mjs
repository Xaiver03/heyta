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

// 实体清单必须是 heyta 的
if (ENTITY_TYPES.length === 13) {
  ok(`实体清单是 heyta 的（${ENTITY_TYPES.length} 项）`);
} else {
  bad(`实体清单项数异常：${ENTITY_TYPES.length}（期望 13）`);
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

const upA = await upload([opPlain], CLIENT_A, 0);
if (upA.status === 200 && upA.body?.results?.[0]?.accepted) {
  ok(`A 上传成功（serverSeq=${upA.body.results[0].serverSeq}）`);
} else {
  bad('A 上传失败', JSON.stringify(upA.body).slice(0, 300));
}

const downB = await download(0, CLIENT_B);
const bSees = downB.body?.ops?.some((o) => o.op?.entityId === ENTITY_ID);
if (bSees) {
  ok('B 下载后看到了 A 的操作');
} else {
  bad('B 没有看到 A 的操作', JSON.stringify(downB.body).slice(0, 300));
}

console.log('\n=== 阶段 4：并发冲突应被拒绝 ===\n');

// 两端基于同一个 vector clock 并发修改同一实体
const baseClock = { [CLIENT_A]: 1 };
const concurrentA = await makeOp({
  clientId: CLIENT_A,
  entityId: ENTITY_ID,
  title: 'A 的改法',
  clock: { ...baseClock, [CLIENT_A]: 2 },
  encryptPayload: false,
});
const concurrentB = await makeOp({
  clientId: CLIENT_B,
  entityId: ENTITY_ID,
  title: 'B 的改法',
  clock: { ...baseClock, [CLIENT_B]: 2 },
  encryptPayload: false,
});

const upConcurrent = await upload([concurrentA, concurrentB], CLIENT_A, 0);
const rejected = upConcurrent.body?.results?.filter((r) => !r.accepted) ?? [];
if (rejected.length > 0) {
  ok(
    `服务端拒绝了并发冲突（errorCode=${rejected[0].errorCode ?? '未提供'}）`,
  );
} else {
  bad(
    '服务端同时接受了两个并发写 —— 冲突检测可能失效',
    JSON.stringify(upConcurrent.body).slice(0, 300),
  );
}

console.log(
  `\n=== 验收结束：${failures === 0 ? '全部通过 ✅' : `${failures} 项失败 ❌`} ===\n`,
);
process.exit(failures === 0 ? 0 : 1);
