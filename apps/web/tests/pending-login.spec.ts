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
  PENDING_EMAIL_KEY,
  PENDING_SESSION_KEY,
  PENDING_TOKEN_KEY,
  takePendingLogin,
  takePendingSessionFromFragment,
  type PendingLoginFragment,
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

/**
 * 内存版 fragment 通道。记录 `clear()` 的调用 —— "读到就抹掉"是这条通道的核心行为：
 * 令牌留在地址栏/历史里，等于把一次性凭据留在用户能按"后退"看到的地方。
 */
function makeFragment(raw: string): PendingLoginFragment & {
  readonly cleared: () => boolean;
  readonly raw: () => string;
} {
  let value = raw;
  return {
    read: () => value,
    clear: () => {
      value = '';
    },
    cleared: () => value === '',
    raw: () => value,
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

/**
 * fragment 投递（ADR-0039 §2.3 的第四条，2026-09-30 实测出来的那条）
 * ==========================================================================
 *
 * 🔴 这一组钉的是一个**投递机制**，不是"有没有登录"：
 * 确认页由同步服务端渲染（带 `Cross-Origin-Opener-Policy: same-origin`
 * + `Origin-Agent-Cluster: ?1`），应用是静态产物（两个头都没有）⇒
 * 从确认页跳到 `/app/` 会**切换 browsing instance**，
 * 那边写进 `sessionStorage` 的会话**不会跟过来**（实测：确认页 `pagehide` 时还在、
 * 应用启动时已空，且没有任何 `removeItem` 删过它）。
 *
 * ⇒ 会话改走 URL `fragment`：一定跨得过去，且**读完就必须抹掉**。
 * 没有这一组，就只剩端到端那条判据在守 —— 而它跑到红要几十秒、还需要真发一封信。
 */
describe('takePendingSessionFromFragment —— 从地址栏取，并立即抹掉', () => {
  it('三个键都在时返回会话，并**真的把 fragment 抹掉了**', () => {
    const fragment = makeFragment(
      `${PENDING_SESSION_KEY}=JWT-1&${PENDING_BASE_URL_KEY}=https%3A%2F%2Fsync.example&${PENDING_EMAIL_KEY}=a%40b.c`,
    );

    const session = takePendingSessionFromFragment(fragment);

    expect(session).toEqual({
      baseUrl: 'https://sync.example',
      token: 'JWT-1',
      email: 'a@b.c',
    });
    expect(fragment.cleared()).toBe(true);
  });

  it('缺 `loginBaseUrl` 时返回 null，**但仍然抹掉**（不完整的值也不许留在地址栏）', () => {
    const fragment = makeFragment(`${PENDING_SESSION_KEY}=JWT-1`);

    expect(takePendingSessionFromFragment(fragment)).toBeNull();
    expect(fragment.cleared()).toBe(true);
  });

  it('没有 fragment 时返回 null 且**不去动它**（反假通过：它不可能"永远为真"）', () => {
    const fragment = makeFragment('');

    expect(takePendingSessionFromFragment(fragment)).toBeNull();
    expect(fragment.cleared()).toBe(true);
  });

  it('**别人的 fragment 不许碰** —— 不认得就原样留着（将来 hash 可能存别的状态）', () => {
    const fragment = makeFragment('tab=settings&scroll=420');

    expect(takePendingSessionFromFragment(fragment)).toBeNull();
    expect(fragment.raw()).toBe('tab=settings&scroll=420');
  });

  it('通道不可用（无 location / 被策略禁用）时不抛，按"没有待消费会话"处理', () => {
    expect(takePendingSessionFromFragment(null)).toBeNull();
  });

  it('读取本身抛异常时也不抛 —— 不能因为它把启动路径带崩', () => {
    const hostile: PendingLoginFragment = {
      read: () => {
        throw new Error('blocked');
      },
      clear: () => undefined,
    };

    expect(takePendingSessionFromFragment(hostile)).toBeNull();
  });
});

describe('consumePendingLogin —— fragment 这条路真的接上同步配置', () => {
  it('fragment 里的会话被**直接采用**（不发任何请求，不去换一次）', async () => {
    fetchMock = vi.fn(() => Promise.reject(new Error('不该发请求')));
    vi.stubGlobal('fetch', fetchMock);
    const fragment = makeFragment(
      `${PENDING_SESSION_KEY}=JWT-FRAG&${PENDING_BASE_URL_KEY}=https%3A%2F%2Fsync.example&${PENDING_EMAIL_KEY}=a%40b.c`,
    );

    await expect(consumePendingLogin(makeStorage(), fragment)).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSyncStore.getState().token).toBe('JWT-FRAG');
    expect(fragment.cleared()).toBe(true);
  });

  it('fragment 优先于存储里那条会话 —— 投递最新鲜的那份说了算', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('不该发请求'))));
    const fragment = makeFragment(
      `${PENDING_SESSION_KEY}=JWT-FRAG&${PENDING_BASE_URL_KEY}=https%3A%2F%2Fsync.example`,
    );
    const storage = makeStorage({
      [PENDING_SESSION_KEY]: 'JWT-STORED',
      [PENDING_BASE_URL_KEY]: 'https://stored.example',
    });

    await expect(consumePendingLogin(storage, fragment)).resolves.toBe(true);
    expect(useSyncStore.getState().token).toBe('JWT-FRAG');
    // 存储那份**没被消费**，也就不该被删 —— 它还是完好的（留给下一次启动）。
    expect(storage.data.get(PENDING_SESSION_KEY)).toBe('JWT-STORED');
  });
});
