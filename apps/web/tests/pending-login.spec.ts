/**
 * 邮件登录链接的**回跳消费**测试（W1）
 * =====================================
 *
 * 这一组钉住的是「用户点了邮件里的链接之后，**令牌真的接上了同步配置**」。
 *
 * 🔴 它防的是本仓最危险的那类失效：服务端确认页把 JWT 写进
 * `sessionStorage['loginToken']` 后跳回应用，而**此前没有任何应用代码读它** ——
 * 用户在邮件里"登录成功了"，回到应用仍显示未登录，**且界面上不报任何错**。
 * 那种失效用肉眼看不出来，只有断言能拦。
 *
 * 全程零联网（`fetch` 一律 stub），零真实 sessionStorage（用注入的假存储）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetAuthForTests } from '../src/features/auth/store.js';
import {
  consumePendingLogin,
  PENDING_BASE_URL_KEY,
  PENDING_TOKEN_KEY,
  takePendingLogin,
  type PendingLoginStorage,
} from '../src/features/auth/pending-login.js';
import { useSyncStore } from '../src/features/sync/store.js';

/** 内存版存储。记录 removeItem 的调用 —— "读到就删"是本模块的核心行为之一。 */
function makeStorage(seed: Record<string, string> = {}): PendingLoginStorage & {
  readonly data: Map<string, string>;
  readonly removed: string[];
} {
  const data = new Map(Object.entries(seed));
  const removed: string[] = [];
  return {
    data,
    removed,
    getItem: (key) => data.get(key) ?? null,
    removeItem: (key) => {
      removed.push(key);
      data.delete(key);
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

/** 让 `/api/login/magic-link/verify` 回一个成功的 `{token, user}`。 */
function stubVerifySuccess(token = 'JWT-OK'): void {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ token, user: { id: 1, email: 'a@b.c' } }),
    } as unknown as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  __resetAuthForTests();
  useSyncStore.setState({ baseUrl: '', token: undefined, password: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('takePendingLogin —— 读出并立即清除', () => {
  it('令牌与地址都在时返回两者，并把两个键都删掉', () => {
    const storage = makeStorage({
      [PENDING_TOKEN_KEY]: 'JWT-1',
      [PENDING_BASE_URL_KEY]: 'https://sync.example',
    });

    expect(takePendingLogin(storage)).toEqual({
      baseUrl: 'https://sync.example',
      token: 'JWT-1',
    });
    // 🔴 必须删掉：留着的令牌会在下一次启动被再消费一遍，
    // 把"登录失败"变成"每次启动都失败一次"。
    expect(storage.removed).toEqual([PENDING_TOKEN_KEY, PENDING_BASE_URL_KEY]);
    expect(storage.data.size).toBe(0);
  });

  it('缺少服务端地址时返回 null，**但仍然清除**', () => {
    const storage = makeStorage({ [PENDING_TOKEN_KEY]: 'JWT-1' });

    expect(takePendingLogin(storage)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('地址是空串时返回 null —— 空 baseUrl 在 app-host 里是"纯本地模式"，拿它登录必然失败', () => {
    const storage = makeStorage({
      [PENDING_TOKEN_KEY]: 'JWT-1',
      [PENDING_BASE_URL_KEY]: '',
    });

    expect(takePendingLogin(storage)).toBeNull();
  });

  it('没有待登录时返回 null（这条同时保证上面几条不是"永远为真"）', () => {
    expect(takePendingLogin(makeStorage())).toBeNull();
  });

  it('存储不可用（隐私模式）时不抛，按"没有待登录"处理', () => {
    expect(takePendingLogin(null)).toBeNull();
  });

  it('存储访问抛异常时也不抛 —— 不能因为它把启动路径带崩', () => {
    const throwing: PendingLoginStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => undefined,
    };

    expect(() => takePendingLogin(throwing)).not.toThrow();
    expect(takePendingLogin(throwing)).toBeNull();
  });
});

describe('consumePendingLogin —— 真的接上同步配置', () => {
  it('成功时返回 true，且令牌真的写进了同步配置（不只是"界面说成功"）', async () => {
    stubVerifySuccess('JWT-OK');
    const storage = makeStorage({
      [PENDING_TOKEN_KEY]: 'JWT-1',
      [PENDING_BASE_URL_KEY]: 'https://sync.example',
    });

    await expect(consumePendingLogin(storage)).resolves.toBe(true);

    // 🔴 这条是关键：把 `applyAuthSession` 那一行删掉，它会红。
    expect(useSyncStore.getState().token).toBe('JWT-OK');
    expect(useSyncStore.getState().baseUrl).toBe('https://sync.example');
  });

  it('是一次性的：第二次调用返回 false，且不再发请求', async () => {
    stubVerifySuccess();
    const storage = makeStorage({
      [PENDING_TOKEN_KEY]: 'JWT-1',
      [PENDING_BASE_URL_KEY]: 'https://sync.example',
    });

    await expect(consumePendingLogin(storage)).resolves.toBe(true);
    const callsAfterFirst = fetchMock.mock.calls.length;

    await expect(consumePendingLogin(storage)).resolves.toBe(false);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('没有待登录时不发任何请求，返回 false（反假通过：它不可能"永远成功"）', async () => {
    stubVerifySuccess();

    await expect(consumePendingLogin(makeStorage())).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('服务端拒绝时返回 false 且**不留下令牌**，也不抛', async () => {
    fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'invalid token' }),
      } as unknown as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const storage = makeStorage({
      [PENDING_TOKEN_KEY]: 'JWT-bad',
      [PENDING_BASE_URL_KEY]: 'https://sync.example',
    });

    await expect(consumePendingLogin(storage)).resolves.toBe(false);
    expect(useSyncStore.getState().token).toBeUndefined();
    expect(storage.data.size).toBe(0);
  });

  it('网络不可达时返回 false 且不抛（本地优先下"未登录"是合法状态，不是故障）', async () => {
    fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    const storage = makeStorage({
      [PENDING_TOKEN_KEY]: 'JWT-1',
      [PENDING_BASE_URL_KEY]: 'https://sync.example',
    });

    await expect(consumePendingLogin(storage)).resolves.toBe(false);
    expect(useSyncStore.getState().token).toBeUndefined();
  });
});