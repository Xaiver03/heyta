import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MAX_EPOCH_MS,
  WIDGET_ALG,
  WIDGET_CONTRACT_VERSION,
  emptyPayload,
  parseEnvelope,
  readSnapshotOrNull,
  sealSnapshot,
  type WidgetEnvelope,
  type WidgetPayload,
} from '@heyta/widget-core';

import {
  WIDGET_KEY_BYTES,
  WIDGET_NONCE_BYTES,
  createWidgetDecryptor,
  createWidgetSealer,
} from '../src/widgets/snapshot-sealer.js';

/**
 * JS 侧快照加解密的测试。
 *
 * ## 🔴 最重要的一条是"和夹具对得上"
 *
 * 这里不满足于"自己封的包自己能解"—— 那种测试**两边同时错**也会通过
 * （比如 AAD 漏了、tag 长度不同、base64 用 URL-safe 变体），
 * 而四端手写原生解析器时，唯一真实的锁是 `v1.golden.json`。
 *
 * 所以下面有一条：**用我们的解密器去解真夹具**。它能过，
 * 才说明我们的 AES-GCM + AAD 拼法 + base64 变体与夹具的生产者一致。
 */

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/widget-core/fixtures',
);

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

/**
 * 与 `packages/widget-core/tests/fixture-source.ts` 的 `TEST_KEY` **同源**。
 *
 * ⚠️ 这里**故意再算一遍**，而不是从 `fixture-source.ts` import ——
 * 那条纪律写在 `golden.spec.ts` 的文件头：如果测试从生成器 import 密钥，
 * 那么"换掉密钥并重新生成夹具"会让两边**一起**变，测试照样绿，
 * 而已经是旧密钥的真机端会全部解不开。重复一行常量换的是这个。
 */
const testKey = new Uint8Array(
  createHash('sha256').update('heyta-widget-golden-key-v1').digest(),
);

const seal = createWidgetSealer(testKey);
const decrypt = createWidgetDecryptor(testKey);

const samplePayload: WidgetPayload = {
  today: [
    { id: 't1', title: '写周报', isDone: false },
    { id: 't2', title: '交房租', isDone: true, projectId: 'p_life' },
  ],
};

const options = { dayStr: '2026-09-27', validUntil: 1_790_000_000_000 };

// ─────────────────────────────────────────────────────────────
// 🔴 与 golden fixture 的互操作
// ─────────────────────────────────────────────────────────────

describe('与 golden fixture 的互操作（真正的锁）', () => {
  it('🔴 我们的解密器能解开真夹具', async () => {
    const envelope = readFixture('v1.golden.json') as WidgetEnvelope;
    const expected = readFixture('v1.golden.plaintext.json') as WidgetPayload;

    const payload = await readSnapshotOrNull(envelope, decrypt);

    // 逐项比，而不是比条数 —— 比条数有"抵消式假阴性"（两处都错、但总数一样）。
    expect(payload).not.toBeNull();
    expect(payload?.today.map((t) => t.id)).toEqual(expected.today.map((t) => t.id));
    expect(payload?.today.map((t) => t.title)).toEqual(expected.today.map((t) => t.title));
    expect(payload?.today.map((t) => t.isDone)).toEqual(expected.today.map((t) => t.isDone));
    // 其它 section 也要在，否则"只对了 today"会漏掉解析器的真问题。
    expect(payload?.quadrant).toEqual(expected.quadrant);
    expect(payload?.habits).toEqual(expected.habits);
    expect(payload?.focus).toEqual(expected.focus);
    expect(payload?.projectColors).toEqual(expected.projectColors);
  });

  it('夹具的信封本身能过 parseEnvelope（证明夹具没被改坏）', () => {
    const parsed = parseEnvelope(readFixture('v1.golden.json'));
    expect(parsed.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 自己封、自己解
// ─────────────────────────────────────────────────────────────

describe('sealSnapshot → readSnapshotOrNull 往返', () => {
  it('往返后载荷逐字段一致', async () => {
    const envelope = await sealSnapshot(samplePayload, options, seal);
    const payload = await readSnapshotOrNull(envelope, decrypt);
    expect(payload).toEqual(samplePayload);
  });

  it('封出来的信封能过 parseEnvelope（形状就是契约）', async () => {
    const envelope = await sealSnapshot(samplePayload, options, seal);
    expect(envelope.alg).toBe(WIDGET_ALG);
    expect(envelope.v).toBe(WIDGET_CONTRACT_VERSION);
    expect(envelope.dayStr).toBe(options.dayStr);
    expect(envelope.validUntil).toBe(options.validUntil);
    expect(parseEnvelope(envelope).ok).toBe(true);
  });

  it('空载荷也能往返（"今天没有任务"是一条合法数据）', async () => {
    const envelope = await sealSnapshot(emptyPayload(), options, seal);
    expect(await readSnapshotOrNull(envelope, decrypt)).toEqual(emptyPayload());
  });

  it('nonce 是 12 字节的标准 base64', async () => {
    const envelope = await sealSnapshot(samplePayload, options, seal);
    const nonce = Buffer.from(envelope.nonce, 'base64');
    expect(nonce).toHaveLength(WIDGET_NONCE_BYTES);
    // 标准 base64（含 + /）而不是 URL-safe 变体 —— 四端解出来必须一样。
    expect(envelope.nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('🔴 每次封包的 nonce 都不同（GCM 重用 nonce 是灾难性的）', async () => {
    const a = await sealSnapshot(samplePayload, options, seal);
    const b = await sealSnapshot(samplePayload, options, seal);
    expect(a.nonce).not.toBe(b.nonce);
    // 密文因此也必须不同（否则就是 nonce 没换）。
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

// ─────────────────────────────────────────────────────────────
// AAD 绑定
// ─────────────────────────────────────────────────────────────

describe('AAD 把明文信封绑进密文', () => {
  it('🔴 改动 validUntil 后解不开', async () => {
    const envelope = await sealSnapshot(samplePayload, options, seal);
    // 攻击者的动机很具体：把 validUntil 往后推，一份过期快照就"看起来是新鲜的"。
    const tampered = { ...envelope, validUntil: envelope.validUntil + 86_400_000 };
    expect(await readSnapshotOrNull(tampered, decrypt)).toBeNull();
  });

  it('🔴 改动 dayStr 后解不开', async () => {
    const envelope = await sealSnapshot(samplePayload, options, seal);
    const tampered = { ...envelope, dayStr: '2026-09-28' };
    expect(await readSnapshotOrNull(tampered, decrypt)).toBeNull();
  });

  it('改动 ciphertext 后解不开（认证标签生效）', async () => {
    const envelope = await sealSnapshot(samplePayload, options, seal);
    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    const tampered = { ...envelope, ciphertext: bytes.toString('base64') };
    expect(await readSnapshotOrNull(tampered, decrypt)).toBeNull();
  });

  it('换一把密钥解不开', async () => {
    const envelope = await sealSnapshot(samplePayload, options, seal);
    const otherKey = new Uint8Array(WIDGET_KEY_BYTES).fill(7);
    expect(await readSnapshotOrNull(envelope, createWidgetDecryptor(otherKey))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 入参校验
// ─────────────────────────────────────────────────────────────

describe('密钥与入参的校验', () => {
  it('密钥长度不对时**立刻**抛（而不是等到解密失败）', () => {
    expect(() => createWidgetSealer(new Uint8Array(16))).toThrow(/32 字节/);
    expect(() => createWidgetDecryptor(new Uint8Array(33))).toThrow(/32 字节/);
  });

  it('validUntil 超出 JS 安全范围时拒绝封包', async () => {
    // 上界的理由见契约文件头：JS 对 >= 1e21 用科学计数法，三端格式化规则不同，
    // 于是 AAD 对不上、四端**同时**解不开。
    await expect(
      sealSnapshot(samplePayload, { ...options, validUntil: MAX_EPOCH_MS + 1 }, seal),
    ).rejects.toThrow(/validUntil/);
  });

  it('validUntil 非整数时拒绝封包', async () => {
    await expect(
      sealSnapshot(samplePayload, { ...options, validUntil: 1.5 }, seal),
    ).rejects.toThrow(/validUntil/);
  });

  it('dayStr 为空时拒绝封包', async () => {
    await expect(
      sealSnapshot(samplePayload, { ...options, dayStr: '' }, seal),
    ).rejects.toThrow(/dayStr/);
  });

  it('边界值 MAX_EPOCH_MS 本身是允许的', async () => {
    const envelope = await sealSnapshot(samplePayload, { ...options, validUntil: MAX_EPOCH_MS }, seal);
    expect(envelope.validUntil).toBe(MAX_EPOCH_MS);
  });

  it('validUntil 为 0 也允许（已过期，但要能封出来给测试用）', async () => {
    const envelope = await sealSnapshot(samplePayload, { ...options, validUntil: 0 }, seal);
    expect(envelope.validUntil).toBe(0);
  });
});
