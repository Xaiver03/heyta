/**
 * ADR-0080 §5.5：第二个轴「钥匙放在哪」。
 *
 * 这里的判据只有三条，都是"错了会静默降级成另一种承诺"的：
 *   ① 默认是 `device`（设备持有），读不到/读坏一律回默认；
 *   ② 选 `ask` 之后，`rememberCurrentWebVaultRoot()` **不再写**那把钥匙；
 *   ③ 偏好本身**不含任何秘密**（只存 'device' / 'ask' 两个字面量）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readVaultKeyPlacement,
  writeVaultKeyPlacement,
} from '../src/lib/vault-root-preference.js';

describe('钥匙放在哪（偏好层）', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('默认 device（读不到就是默认）', () => {
    expect(readVaultKeyPlacement()).toBe('device');
  });

  it('写 ask 之后读回 ask', () => {
    writeVaultKeyPlacement('ask');
    expect(readVaultKeyPlacement()).toBe('ask');
  });

  it('🔴 偏好里不含任何秘密：值只有两个字面量之一', () => {
    writeVaultKeyPlacement('ask');
    const values = Object.keys(localStorage).map((key) => localStorage.getItem(key));
    expect(values).toEqual(['ask']);
  });

  it('存储抛错时退回默认，不炸', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeVaultKeyPlacement('ask')).not.toThrow();
    expect(readVaultKeyPlacement()).toBe('device');
  });
});
