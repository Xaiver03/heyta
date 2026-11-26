/**
 * #61 · 本地应用锁的 PIN 逻辑（校验 / 解锁 / 错误）
 * =================================================
 *
 * 三件必须能红的事：
 *   1. 校验：长度越界 / 非数字被拒（不是"都能过"）；
 *   2. 解锁：正确 PIN 通过、错误 PIN 不通过（不是"存了就永远 true"）；
 *   3. 错误：没设 / 存了坏数据 / 派生失败一律当作"没上锁 + 校验不通过"（不崩、不放行）。
 *
 * 另外钉两件安全事实：
 *   - **磁盘上不存明文 PIN**（存的是盐 + 派生值）；
 *   - **同一个 PIN 每次设置产生不同的盐 / 派生值**（盐是随机的）。
 */
import { webcrypto } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APP_LOCK_STORAGE_KEY,
  clearPin,
  isAppLockEnabled,
  setPin,
  validatePin,
  verifyPin,
} from '../src/lib/app-lock.js';

beforeAll(() => {
  // jsdom 不实现 SubtleCrypto；用 Node 的 WebCrypto 顶上（模块只用标准 API）。
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

describe('#61 应用锁 PIN', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('validatePin：4-8 位数字通过，越界 / 非数字被拒', () => {
    expect(validatePin('1234')).toEqual({ ok: true });
    expect(validatePin('12345678')).toEqual({ ok: true });
    expect(validatePin('123')).toEqual({ ok: false, reason: 'length' });
    expect(validatePin('123456789')).toEqual({ ok: false, reason: 'length' });
    expect(validatePin('12a4')).toEqual({ ok: false, reason: 'nondigit' });
    expect(validatePin('12 34')).toEqual({ ok: false, reason: 'nondigit' });
    expect(validatePin('').ok).toBe(false);
  });

  it('磁盘上只存盐 + 派生值，不存明文 PIN', async () => {
    await setPin('246810');
    const raw = localStorage.getItem(APP_LOCK_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('246810');
    const record = JSON.parse(raw as string) as Record<string, unknown>;
    expect(record['v']).toBe(1);
    expect(typeof record['salt']).toBe('string');
    expect((record['salt'] as string).length).toBeGreaterThan(0);
    expect(record['hash']).not.toBe('246810');
    expect(record['iter']).toBeGreaterThan(0);
    expect(isAppLockEnabled()).toBe(true);
  });

  it('解锁：正确 PIN 为 true，错误 / 位数不符为 false', async () => {
    await setPin('135790');
    expect(await verifyPin('135790')).toBe(true);
    expect(await verifyPin('000000')).toBe(false);
    expect(await verifyPin('13579')).toBe(false);
    expect(await verifyPin('1357900')).toBe(false);
  });

  it('加盐：两次设置同一个 PIN 产生不同盐与派生值', async () => {
    await setPin('1111');
    const first = JSON.parse(localStorage.getItem(APP_LOCK_STORAGE_KEY) as string) as {
      salt: string;
      hash: string;
    };
    await setPin('1111');
    const second = JSON.parse(localStorage.getItem(APP_LOCK_STORAGE_KEY) as string) as {
      salt: string;
      hash: string;
    };
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it('错误：未设置 / 坏 JSON / 残缺记录都当作"没上锁 + 校验不通过"', async () => {
    expect(isAppLockEnabled()).toBe(false);
    expect(await verifyPin('1234')).toBe(false);

    localStorage.setItem(APP_LOCK_STORAGE_KEY, 'not-json');
    expect(isAppLockEnabled()).toBe(false);
    expect(await verifyPin('1234')).toBe(false);

    localStorage.setItem(
      APP_LOCK_STORAGE_KEY,
      JSON.stringify({ v: 1, salt: '', iter: 0, hash: '' }),
    );
    expect(isAppLockEnabled()).toBe(false);
    expect(await verifyPin('1234')).toBe(false);
  });

  it('clearPin：关闭后不再上锁、旧 PIN 也验不过', async () => {
    await setPin('4444');
    expect(isAppLockEnabled()).toBe(true);
    clearPin();
    expect(isAppLockEnabled()).toBe(false);
    expect(await verifyPin('4444')).toBe(false);
  });

  it('setPin 拒绝非法 PIN 且不写盘', async () => {
    await expect(setPin('12')).rejects.toThrow();
    expect(localStorage.getItem(APP_LOCK_STORAGE_KEY)).toBeNull();
  });
});
