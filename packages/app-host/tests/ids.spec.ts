/**
 * 标识符生成的测试
 * ==================
 *
 * 核心是那条**回退路径** —— 它只在 `crypto.randomUUID` 缺失时才走到，
 * 而移动端（Hermes）很可能正是这种情况。一条"平时永远走不到"的分支
 * 必须有测试，否则它在 iOS 上第一次被走到时就是崩溃。
 *
 * ⚠️ 关键：`ids.ts` 在**调用时**读 `globalThis.crypto`（不是模块加载时缓存），
 * 所以这里可以临时把它替换掉。如果哪天有人"优化"成模块级缓存，
 * 下面的测试会直接失败 —— 那正是我希望的。
 */

import { afterEach, describe, expect, it } from 'vitest';

import { newTaskId, randomId, usingRandomIdFallback } from '../src/ids.js';

const realCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: realCrypto,
    configurable: true,
    writable: true,
  });
});

function withoutRandomUUID(): void {
  // 保留 crypto 对象但摘掉 randomUUID —— 这正是老 Hermes 的形状：
  // crypto 可能存在（有 getRandomValues），但 randomUUID 不在。
  Object.defineProperty(globalThis, 'crypto', {
    value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
    configurable: true,
    writable: true,
  });
}

describe('randomId', () => {
  it('有 crypto.randomUUID 时用 UUID 形状', () => {
    expect(usingRandomIdFallback()).toBe(false);
    expect(randomId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('🔴 crypto 完全没有时**不抛异常**，回退到时间戳方案', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(usingRandomIdFallback()).toBe(true);
    expect(() => randomId()).not.toThrow();
    expect(randomId().length).toBeGreaterThan(0);
  });

  it('🔴 crypto 在但没有 randomUUID 时也不抛（老 Hermes 的形状）', () => {
    withoutRandomUUID();
    expect(usingRandomIdFallback()).toBe(true);
    expect(() => randomId()).not.toThrow();
  });

  it('回退路径下连续生成也不重复（同毫秒靠单调计数区分）', () => {
    withoutRandomUUID();
    const ids = new Set(Array.from({ length: 500 }, () => randomId()));
    expect(ids.size, '回退路径产生了重复 id').toBe(500);
  });

  it('正常路径下连续生成也不重复', () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomId()));
    expect(ids.size).toBe(500);
  });
});

describe('newTaskId', () => {
  it('带 task- 前缀，且在回退路径下同样可用', () => {
    expect(newTaskId().startsWith('task-')).toBe(true);
    withoutRandomUUID();
    expect(newTaskId().startsWith('task-')).toBe(true);
  });

  it('回退路径下批量生成不重复', () => {
    withoutRandomUUID();
    const ids = new Set(Array.from({ length: 500 }, () => newTaskId()));
    expect(ids.size).toBe(500);
  });
});
