/**
 * W4：凭据持久化的测试
 * ======================
 *
 * 它钉住三件事，**三件都必须能失败**：
 *
 *   1. **登录后重开还在** —— 令牌与服务端地址真的落盘了。
 *      少了它，"完整旅程"在每次刷新时断在登录上（改动前就是这个状态）。
 *   2. 🔴 **口令绝不落盘** —— 口令是**解密密钥**，落盘等于取消端到端加密。
 *      这一条是本文件最要紧的断言：它防的是一个**不会报错、只会静默泄露**的改动。
 *   3. **登出把落盘那份也清掉** —— 只清内存的话，刷新一次令牌就"活"回来了。
 *
 * 全程用**注入的假存储**，不碰真实 `localStorage`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearStoredCredentials,
  loadCredentials,
  saveCredentials,
  type CredentialStorage,
} from '../src/features/sync/credential-storage.js';
import { useSyncStore } from '../src/features/sync/store.js';

function makeStorage(seed: Record<string, string> = {}): CredentialStorage & {
  readonly data: Map<string, string>;
} {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

const KEY = 'heyta.sync.credentials';

let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  storage = makeStorage();
  vi.stubGlobal('localStorage', storage);
  useSyncStore.setState({ baseUrl: '', token: undefined, password: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('credential-storage —— 存取与防御', () => {
  it('存进去能读回来（baseUrl + token）', () => {
    expect(saveCredentials({ baseUrl: 'https://sync.example', token: 'JWT-1' }, storage)).toBe(
      true,
    );
    expect(loadCredentials(storage)).toEqual({
      baseUrl: 'https://sync.example',
      token: 'JWT-1',
    });
  });

  it('🔴 落盘的内容里**没有口令字段** —— 这是本文件最要紧的一条', () => {
    saveCredentials({ baseUrl: 'https://sync.example', token: 'JWT-1' }, storage);

    const raw = storage.data.get(KEY);
    expect(raw).toBeDefined();
    expect(raw).not.toContain('password');
    // 连键名都不该出现 —— 传了个多余字段也不许漏出去
    expect(Object.keys(JSON.parse(raw!) as Record<string, unknown>).sort()).toEqual([
      'baseUrl',
      'token',
    ]);
  });

  it('读不懂的值返回 null 并**顺手清掉**（否则每次启动再失败一次）', () => {
    const bad = makeStorage({ [KEY]: '{ 不是合法 JSON' });
    expect(loadCredentials(bad)).toBeNull();
    expect(bad.data.has(KEY)).toBe(false);
  });

  it('形状不对（缺 token / 空 baseUrl）也当无效并清掉', () => {
    const missing = makeStorage({ [KEY]: JSON.stringify({ baseUrl: 'https://a' }) });
    expect(loadCredentials(missing)).toBeNull();

    const empty = makeStorage({ [KEY]: JSON.stringify({ baseUrl: '', token: 'J' }) });
    expect(loadCredentials(empty)).toBeNull();
  });

  it('存储不可用（隐私模式）时不抛，按"没有存储"处理', () => {
    expect(loadCredentials(null)).toBeNull();
    expect(saveCredentials({ baseUrl: 'https://a', token: 'J' }, null)).toBe(false);
    expect(() => clearStoredCredentials(null)).not.toThrow();
  });

  it('写失败（配额满）返回 false，不假装成功', () => {
    const failing: CredentialStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(saveCredentials({ baseUrl: 'https://a', token: 'J' }, failing)).toBe(false);
  });
});

describe('W4 在 sync store 里的落地', () => {
  it('🔴 认证成功后凭据真的落盘 —— 刷新重开仍能 hydrate 到它', () => {
    useSyncStore.getState().applyAuthToken('https://sync.example', 'JWT-OK');

    // 落盘的内容必须与 store 里的状态一致，否则"重开还在"是假的
    expect(loadCredentials(storage)).toEqual({
      baseUrl: 'https://sync.example',
      token: 'JWT-OK',
    });
    expect(useSyncStore.getState().token).toBe('JWT-OK');
  });

  it('登出把落盘那份也清掉（只清内存的话刷新就"活"回来）', () => {
    useSyncStore.getState().applyAuthToken('https://sync.example', 'JWT-OK');
    expect(loadCredentials(storage)).not.toBeNull();

    useSyncStore.getState().clearCredentials();

    expect(loadCredentials(storage)).toBeNull();
    expect(useSyncStore.getState().token).toBeUndefined();
  });

  it('configure 带口令时：凭据落盘，但**口令不进盘**', () => {
    useSyncStore.getState().configure('https://sync.example', 'JWT-2', '绝密口令');

    const raw = storage.data.get(KEY);
    expect(raw).toContain('JWT-2');
    expect(raw).not.toContain('绝密口令');
    // 口令仍在内存里（同步要用），只是没落盘
    expect(useSyncStore.getState().password).toBe('绝密口令');
  });
});