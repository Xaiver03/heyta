/**
 * P0-11：一次上传的密钥派生次数必须 = 1
 * ======================================
 *
 * 🔴 **要钉的东西**：上传循环里每条 op 都会调 `encrypt(payload, password)`，而它走
 * 的是会话密钥缓存 —— 缓存的实现是「**同步查一次 → miss 才 await Argon2id**」，
 * **没有在途 Promise 复用**（`packages/sync-core/src/encryption/session-cache.ts`
 * 的 `getOrDeriveEncryptKey`）。Argon2id 单线程、**每次派生占 64 MiB**
 * （`encryption/argon2.ts`：`memorySize: 65536`）。
 * ⇒ 一旦并发发起，会话**第一批**的 N 条 op 全都在第一个 await 之前查了缓存、
 *   全都 miss ⇒ **N × 64 MiB** 同时申请，而且并不会更快（只是微任务交错）。
 *   之后缓存命中不再付，所以症状是"装好后第一次同步特别吃力"。
 *
 * 同一个包的**解密侧**早就因为同一条理由改成了串行并写了理由
 * （`encryption.ts` 的 Phase 2 注释）。加密侧是漏掉的另一半。
 *
 * ## 为什么这个文件必须存在，而不是"改完就完了"
 *
 * 判据不写的话，谁都可以把它改回 `Promise.all` 而**没有任何一层会失败** ——
 * 而这件事在这个仓库发生过：那条禁令只活在注释里（§7 的元规则：只在注释里的
 * 纪律，保质期等于下一个没读那段注释的人）。
 *
 * ## 探针怎么搭（以及为什么不是自欺）
 *
 * 用包里**官方支持的注入缝** `setArgon2Provider()` 换掉 KDF 后端，
 * 于是计数观测的是真代码路径（真的走缓存、真的走 `deriveKeyFromPassword`），
 * 只是把 64 MiB 的那一步换成一次可计数的调用。
 * ⚠️ 这不是"桩出来一个 1"：下面第一条用例是**阳性对照** —— 它用同一个探针直接
 * `Promise.all` 并发 `encrypt()`，数出 **N 次派生 + 并发度 N**。
 * 它证明这个探针**能看见并发**。没有它，`toBe(1)` 有可能是探针根本不会数。
 *
 * ## 变异（已实测，见审计文档 §8 第 3 步）
 *
 * 把 `client.ts` 的串行 `for` 换回 `Promise.all` ⇒ 本文件的两条主断言
 * （派生数 = 1、并发度 = 1）当场转红，而阳性对照那条不受影响。
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  OpType,
  clearSessionKeyCache,
  encrypt,
  setArgon2Provider,
  type Argon2Input,
  type Operation,
} from '@heyta/sync-core';

import { SyncClient } from '../src/client.js';

const PASSWORD = 'correct horse battery staple';
const BASE = 'http://127.0.0.1:3000';
const OP_COUNT = 5;

interface Probe {
  /** KDF 被调用的次数（= 真的付了一次 Argon2id 派生）。 */
  calls: number;
  /** 同时在飞的派生数峰值。并发派生 = 64 MiB 的倍数就体现在这里。 */
  maxConcurrent: number;
  active: number;
}

function makeHarness(ops: Operation<string>[]) {
  const uploads: Array<{ url: string; body: Record<string, unknown> }> = [];
  const marked: Array<ReadonlyMap<string, number>> = [];

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      uploads.push({ url, body });
      const sent = (body['ops'] ?? []) as Array<{ id: string }>;
      return new Response(
        JSON.stringify({
          results: sent.map((op, index) => ({
            opId: op.id,
            accepted: true,
            serverSeq: index + 1,
          })),
          latestSeq: sent.length,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ ops: [], hasMore: false, latestSeq: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const client = new SyncClient({
    baseUrl: BASE,
    clientId: 'device-a',
    getToken: async () => 'test-token',
    getPassword: async () => PASSWORD,
    encryptionMode: 'password' as const,
    getLastServerSeq: async () => 0,
    setLastServerSeq: async () => undefined,
    getLocalOps: async () => ops,
    markUploaded: async (m) => { marked.push(m); },
    applyRemote: async () => undefined,
    mergeRemoteClock: async () => undefined,
    markHistoryIncomplete: async () => undefined,
    redispatch: async () => undefined,
    discardLocal: async () => undefined,
    markRejected: async () => undefined,
    getOpsForEntity: async () => [],
    getOpById: async () => undefined,
    redispatchPayload: async () => undefined,
    fetchImpl,
  });

  return { client, uploads, marked };
}

function makeOp(id: string): Operation<string> {
  return {
    id,
    clientId: 'device-a',
    actionType: 'CREATE_TASK',
    opType: OpType.Create,
    entityType: 'TASK',
    entityId: `t-${id}`,
    // 每条正文不同 ⇒ 密文也必须不同（挡住"只加密一次、N 条复用同一份密文"这种假修）
    payload: { title: `任务 ${id}` },
    vectorClock: { 'device-a': 1 },
    timestamp: 1000,
    schemaVersion: 1,
  } as Operation<string>;
}

/** 计数探针：先记录并发，再让出事件循环（真 Argon2id 是 await 到底的重活）。 */
async function countingKdf(input: Argon2Input): Promise<Uint8Array> {
  const probe = activeProbe;
  if (probe !== undefined) {
    probe.calls += 1;
    probe.active += 1;
    probe.maxConcurrent = Math.max(probe.maxConcurrent, probe.active);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (probe !== undefined) probe.active -= 1;
  // 密钥字节由输入决定 ⇒ 同一口令同一 salt 必须得到同一串（否则解密侧对不上）。
  return keyBytesFor(input);
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 32 字节、可重算的"伪 KDF"：只用于计数，不冒充 Argon2 的安全性。 */
function keyBytesFor(input: Argon2Input): Uint8Array {
  const salt = Array.from(input.salt).join(',');
  const seed = fnv1a(`${input.password}|${salt}|${String(input.memorySize)}`);
  const out = new Uint8Array(input.hashLength);
  for (let i = 0; i < out.length; i++) out[i] = fnv1a(`${String(seed)}:${String(i)}`) & 0xff;
  return out;
}

let activeProbe: Probe | undefined;

afterEach(() => {
  setArgon2Provider(undefined);
  clearSessionKeyCache();
  activeProbe = undefined;
});

describe('P0-11 上传的密钥派生次数', () => {
  it('🔴 阳性对照：同一个口令**并发** encrypt() 真的会派生 N 次（探针能看见并发）', async () => {
    const probe: Probe = { calls: 0, maxConcurrent: 0, active: 0 };
    activeProbe = probe;
    setArgon2Provider(countingKdf);
    clearSessionKeyCache();

    await Promise.all(
      Array.from({ length: OP_COUNT }, (_unused, index) =>
        encrypt(JSON.stringify({ i: index }), PASSWORD),
      ),
    );

    // 这一条**不是**被测行为，它是这台探针的说明书：
    // 并发 ⇒ 每条各付一次派生，峰值并发度 = N。它今天必须为真。
    expect(probe.calls, '并发 encrypt 应当各自派生（缓存没有在途复用）').toBe(OP_COUNT);
    expect(probe.maxConcurrent).toBe(OP_COUNT);

    // 串行发起则只付一次 —— 这正是上传循环该有的形状。
    setArgon2Provider(countingKdf);
    clearSessionKeyCache();
    const serial: Probe = { calls: 0, maxConcurrent: 0, active: 0 };
    activeProbe = serial;
    for (let i = 0; i < OP_COUNT; i++) await encrypt(JSON.stringify({ i }), PASSWORD);
    expect(serial.calls, '串行时第一条派生完，后面全部命中会话缓存').toBe(1);
    expect(serial.maxConcurrent).toBe(1);
  });

  it('🔴 一次 upload 期间 Argon2id 派生数 = 1 且并发度 = 1（N 条 op 同一口令）', async () => {
    const probe: Probe = { calls: 0, maxConcurrent: 0, active: 0 };
    activeProbe = probe;
    setArgon2Provider(countingKdf);
    clearSessionKeyCache();

    const ops = Array.from({ length: OP_COUNT }, (_unused, index) => makeOp(`op-${String(index)}`));
    const h = makeHarness(ops);
    const status = await h.client.sync();

    expect(status.kind, JSON.stringify(status)).toBe('synced');
    expect(probe.calls, '一次同步的上传只该付一次 Argon2id 派生').toBe(1);
    expect(
      probe.maxConcurrent,
      '并发度 > 1 意味着 N × 64 MiB 同时申请（P0-11 的病灶）',
    ).toBe(1);
  });

  it('🔴 上面那个「1」不是因为只传了一条：N 条都真出去了，且密文各不相同', async () => {
    const probe: Probe = { calls: 0, maxConcurrent: 0, active: 0 };
    activeProbe = probe;
    setArgon2Provider(countingKdf);
    clearSessionKeyCache();

    const ops = Array.from({ length: OP_COUNT }, (_unused, index) => makeOp(`op-${String(index)}`));
    const h = makeHarness(ops);
    await h.client.sync();

    expect(h.uploads).toHaveLength(1);
    const sent = h.uploads[0]!['body']['ops'] as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(OP_COUNT);
    // 每条都带上了密文，而且不重复 ⇒ 派生 1 次 ≠ 只加密 1 次。
    const payloads = sent.map((op) => op['payload']);
    expect(new Set(payloads).size, 'N 条 op 复用同一份密文就是数据损坏').toBe(OP_COUNT);
    for (const op of sent) {
      expect(typeof op['payload']).toBe('string');
      expect(op['isPayloadEncrypted']).toBe(true);
    }
    expect(JSON.stringify(sent)).not.toContain('任务 op-0');
    // 而且真被服务端接受并落盘（不是"加密了但没上传"）
    expect([...(h.marked[0] ?? new Map()).keys()]).toHaveLength(OP_COUNT);
  });
});
