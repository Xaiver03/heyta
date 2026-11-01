/**
 * ADR-0080 §5.4：Web 上"钥匙放在这台设备里"的那一格。
 *
 * 判据只有三条，都是"写错了会静默降级"的：
 *   ① 存的是 `sessionStorage`（活到标签页关闭），**不是** `localStorage`；
 *   ② 作用域按 serverOrigin + accountId 分开，两个账号互不可见；
 *   ③ 读坏数据/长度不对一律当没有 —— 不猜、不抛。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearSessionVaultRoot,
  readSessionVaultRoot,
  writeSessionVaultRoot,
} from '../src/lib/vault-root-cache.js';

const scope = { accountId: 'acct-1', serverOrigin: 'https://heyta.test' };
const root = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

describe('web vault root 缓存', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('写进去再读出来是同一把 32 字节 root', () => {
    writeSessionVaultRoot(scope, root(7));

    const read = readSessionVaultRoot(scope);

    expect(read).toBeInstanceOf(Uint8Array);
    expect(Array.from(read!)).toEqual(Array.from(root(7)));
  });

  it('🔴 落在 sessionStorage，一个字都不进 localStorage', () => {
    writeSessionVaultRoot(scope, root(3));

    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  it('两个账号/两个服务端互不可见', () => {
    writeSessionVaultRoot(scope, root(1));
    writeSessionVaultRoot({ ...scope, accountId: 'acct-2' }, root(2));
    writeSessionVaultRoot({ ...scope, serverOrigin: 'https://other.test' }, root(3));

    expect(Array.from(readSessionVaultRoot(scope)!)[0]).toBe(1);
    expect(Array.from(readSessionVaultRoot({ ...scope, accountId: 'acct-2' })!)[0]).toBe(2);
    expect(Array.from(readSessionVaultRoot({ ...scope, serverOrigin: 'https://other.test' })!)[0]).toBe(3);
  });

  it('长度不是 32 字节就当没有（坏数据不猜）', () => {
    writeSessionVaultRoot(scope, new Uint8Array(31));

    expect(readSessionVaultRoot(scope)).toBeUndefined();
  });

  it('清掉之后读不到', () => {
    writeSessionVaultRoot(scope, root(9));
    clearSessionVaultRoot(scope);

    expect(readSessionVaultRoot(scope)).toBeUndefined();
  });

  it('存储抛错（隐私模式）不炸：读回 undefined，写与清静默降级', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => writeSessionVaultRoot(scope, root(5))).not.toThrow();
    expect(readSessionVaultRoot(scope)).toBeUndefined();
    expect(() => clearSessionVaultRoot(scope)).not.toThrow();
  });
});
