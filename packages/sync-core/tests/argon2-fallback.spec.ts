/**
 * Argon2 后端选择的验证 —— **这个文件测的是"移动端能不能同步"本身。**
 *
 * 背景：`packages/sync-core` 的 Argon2id 原先只有 `hash-wasm`（WASM）一条实现，
 * 而 Hermes 不支持 WebAssembly。真机实测点「立即同步」会得到
 *
 *     WebAssembly is not supported in this environment!
 *
 * 也就是说移动端**一条数据都同步不出去**（`AGENTS.md` §7 第 26 条）。
 * 修复是给 KDF 补上纯 JS 兜底（与 `web-crypto.ts` 里 AES-GCM 的写法对齐）。
 *
 * ## 为什么这条测试不能只测"注入了 provider"
 *
 * 只验证接缝能注入，等于只验证"我留了个口子"，而没有验证
 * **真机上真的能算出正确的密钥**。所以下面第一条用例是
 * **把 `WebAssembly` 整个删掉**，让 `getArgon2Backend()` 真的走进纯 JS 分支，
 * 再拿它去跑那条已知答案向量。
 *
 * ⚠️ 删掉 `WebAssembly` 之后**必须断言它真的没了**。
 * 否则删除一旦失效，用例会悄悄跑在 WASM 分支上 —— 一路全绿，
 * 而它声称验证的那条路径一次都没被执行。**一条永远为真的断言比没有断言更坏。**
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  deriveKeyFromPassword,
  getArgon2Backend,
  getArgon2Params,
  getArgon2Provider,
  isArgon2SlowBackend,
  setArgon2ParamsForTesting,
  setArgon2Provider,
  type Argon2Input,
} from '../src';

const KAT_PASSWORD = 'correct horse battery staple';
const KAT_SALT = new Uint8Array(16).fill(0x07);
const KAT_EXPECTED_HEX = '6ad10af97f1744119bd7135c85121dc589794f9c5d646200b8ad4d6becf15084';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** 删掉 WebAssembly 之前保存的原值。`node:vm` **并不导出** `WebAssembly`
 *  —— 我第一版就是拿它去还原的，结果 `getArgon2Backend()` 依然是 `'js'`。
 *  那种"还原失败"不会报错，只会让后面的用例跑在错误的前提下，
 *  所以这里必须**自己存一份原值**。 */
let savedWebAssembly: unknown;

/**
 * 临时让运行时看起来像 Hermes（没有 WebAssembly）。
 *
 * 返回一个"是否真的删掉了"的布尔值 —— 调用方**必须**断言它为 true。
 * 不这样做的话，删除失效会让用例静默地测错分支。
 */
const hideWebAssembly = (): boolean => {
  savedWebAssembly = (globalThis as { WebAssembly?: unknown }).WebAssembly;
  try {
    delete (globalThis as { WebAssembly?: unknown }).WebAssembly;
  } catch {
    return false;
  }
  return typeof (globalThis as { WebAssembly?: unknown }).WebAssembly === 'undefined';
};

const restoreWebAssembly = (): void => {
  if (
    savedWebAssembly !== undefined &&
    typeof (globalThis as { WebAssembly?: unknown }).WebAssembly === 'undefined'
  ) {
    Object.defineProperty(globalThis, 'WebAssembly', {
      value: savedWebAssembly,
      writable: true,
      configurable: true,
    });
  }
};

afterEach(() => {
  setArgon2Provider(undefined);
  setArgon2ParamsForTesting();
  restoreWebAssembly();
});

describe('Argon2 后端选择', () => {
  it('有 WebAssembly 时选 WASM 后端（默认路径不能被改坏）', () => {
    restoreWebAssembly();
    expect(typeof WebAssembly).toBe('object');
    expect(getArgon2Backend()).toBe('wasm');
    expect(isArgon2SlowBackend()).toBe(false);
  });

  it('🔴 没有 WebAssembly 时（Hermes）退到纯 JS，且断言删除真的生效', () => {
    expect(hideWebAssembly()).toBe(true);

    // 这两条断言是整条用例可信的前提：
    // 它们保证下面跑的确实是**纯 JS 分支**，而不是又回到 WASM 上去。
    expect(typeof (globalThis as { WebAssembly?: unknown }).WebAssembly).toBe('undefined');
    expect(getArgon2Backend()).toBe('js');
    expect(isArgon2SlowBackend()).toBe(true);
  });

  it('🔴 纯 JS 分支派生出与 WASM 逐字节相同的密钥（跨设备可读性的根据）', async () => {
    expect(hideWebAssembly()).toBe(true);
    setArgon2ParamsForTesting();

    const { keyBytes } = await deriveKeyFromPassword(KAT_PASSWORD, KAT_SALT);

    // 若这里红了，说明纯 JS 兜底算出的密钥和 Web 端不一样 ——
    // 用户在手机上加密的任务，Web 端将**永远解不开**，而且不会报"算法不对"。
    expect(toHex(keyBytes)).toBe(KAT_EXPECTED_HEX);
  }, 120_000);

  it('纯 JS 分支会报告进度，并且能走到 1（界面不会毫无反馈地干等）', async () => {
    expect(hideWebAssembly()).toBe(true);
    setArgon2ParamsForTesting();

    const seen: number[] = [];
    await deriveKeyFromPassword(KAT_PASSWORD, KAT_SALT, {
      onProgress: (p) => seen.push(p),
    });

    // 慢后端必须能被观测到，否则用户面对的是几十秒的静默。
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeCloseTo(1, 5);
    for (const p of seen) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  }, 120_000);

  it('注入的 provider 会覆盖后端选择，并拿到完整参数', async () => {
    expect(hideWebAssembly()).toBe(true);
    setArgon2ParamsForTesting();

    const received: Argon2Input[] = [];
    const sentinel = new Uint8Array(32).fill(0xab);
    setArgon2Provider(async (input) => {
      received.push(input);
      return sentinel;
    });

    const { keyBytes } = await deriveKeyFromPassword(KAT_PASSWORD, KAT_SALT);

    expect(keyBytes).toEqual(sentinel);
    expect(received).toHaveLength(1);
    // 参数必须原样传下去：注入的实现要能和默认实现算出同一个密钥，
    // 靠的就是这几个值一个都不少、一个都不改。
    expect(received[0]).toMatchObject({
      password: KAT_PASSWORD,
      hashLength: 32,
      parallelism: getArgon2Params().parallelism,
      iterations: getArgon2Params().iterations,
      memorySize: getArgon2Params().memorySize,
    });
    expect(received[0].salt).toEqual(KAT_SALT);
  });

  it('传 undefined 能撤掉注入，回到默认后端', async () => {
    setArgon2Provider(async () => new Uint8Array(32));
    expect(getArgon2Provider()).toBeDefined();

    setArgon2Provider(undefined);

    expect(getArgon2Provider()).toBeUndefined();
    // 撤掉之后必须真的走回默认路径 —— 而不是留着一个空壳 provider。
    expect(getArgon2Backend()).toBe('wasm');
  });
});