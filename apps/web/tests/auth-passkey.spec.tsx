/**
 * 通行密钥：store 接线
 * ====================
 *
 * `passkey-browser.spec.ts` 钉的是**转换层**（字节对不对）。
 * 这里钉的是**接线**：options 真的来自服务端、凭据真的交回服务端、
 * 令牌真的落进同步配置 —— 以及**失败不会被当成成功**。
 *
 * ## 为什么要注入 browser 而不是走面板
 *
 * 面板调的是 `registerPasskey(baseUrl, email, termsAccepted)`，不传 browser，
 * 于是自动探测 `navigator.credentials` —— jsdom 里没有，必然判"不支持"。
 * 所以"能真的跑完一条通行密钥"这件事只能在 **store 这一层**验证（注入假 browser），
 * 而面板那一层验证的是"不支持时说了什么"。两层职责不同，**缺一层就会有一半没测**。
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { translate, type MessageKey } from '@heyta/i18n';

import { __resetAuthForTests, useAuthStore } from '../src/features/auth/store.js';
import type { PasskeyBrowser } from '../src/features/auth/passkey-browser.js';
import { useSyncStore } from '../src/features/sync/store.js';

const BASE_URL = 'https://sync.example.com';
const EMAIL = 'me@example.com';
const SESSION = { token: 'jwt-from-passkey', user: { id: 7, email: EMAIL } };

/** 服务端下发的注册 options（`challenge` / `user.id` 是 base64url 字符串）。 */
const REGISTER_OPTIONS = {
  challenge: 'aGk',
  rp: { id: 'sync.example.com', name: 'heyta' },
  user: { id: 'dXNlcg', name: EMAIL, displayName: EMAIL },
  pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
};

const LOGIN_OPTIONS = { challenge: 'aGk', rpId: 'sync.example.com' };

interface FetchCall {
  url: string;
  body: unknown;
}

let calls: FetchCall[];

/** 按顺序回不同的响应 —— 通行密钥一次流程要打**两个**端点，单一响应 mock 不够。 */
function stubSequencedFetch(responses: Array<{ status: number; body?: unknown }>): void {
  calls = [];
  let index = 0;
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses[Math.min(index, responses.length - 1)] ?? { status: 500 };
    index += 1;
    return Promise.resolve({
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      json: () => Promise.resolve(next.body),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', mock);
}

function bufferOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** 浏览器产出的注册凭据（`navigator.credentials.create()` 的结果形状）。 */
function registrationCredential(): unknown {
  return {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    getClientExtensionResults: () => ({}),
    response: {
      clientDataJSON: bufferOf('cd'),
      attestationObject: bufferOf('ao'),
      getTransports: () => ['internal'],
    },
  };
}

/** 浏览器产出的登录断言（`.get()` 的结果形状）。 */
function assertionCredential(): unknown {
  return {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    type: 'public-key',
    getClientExtensionResults: () => ({}),
    response: {
      clientDataJSON: bufferOf('cd'),
      authenticatorData: bufferOf('ad'),
      signature: bufferOf('sig'),
      userHandle: bufferOf('handle'),
    },
  };
}

function browserResolving(credential: unknown): PasskeyBrowser {
  return {
    supported: true,
    create: vi.fn().mockResolvedValue(credential),
    get: vi.fn().mockResolvedValue(credential),
  };
}

beforeEach(() => {
  __resetAuthForTests();
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
    password: undefined,
    status: { kind: 'idle' },
    settingsOpen: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('用通行密钥注册', () => {
  it('打两次端点，且第二次带的是**转换后**的凭据（base64url，不是原始 ArrayBuffer）', async () => {
    stubSequencedFetch([
      { status: 200, body: REGISTER_OPTIONS },
      { status: 200, body: { message: 'ok' } },
    ]);
    const browser = browserResolving(registrationCredential());

    await act(async () => {
      await useAuthStore.getState().registerPasskey(BASE_URL, EMAIL, true, { browser });
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/register/passkey/options`);
    expect(calls[1]?.url).toBe(`${BASE_URL}/api/register/passkey/verify`);

    // 🔴 关键断言：交给服务端的必须是 base64url 字符串。
    // 直接塞原始 ArrayBuffer 的话 JSON.stringify 会得到 `{}` —— 服务端永远验不过。
    const credential = (calls[1]?.body as { credential: Record<string, unknown> }).credential;
    const response = credential['response'] as Record<string, unknown>;
    expect(response['attestationObject']).toBe('YW8'); // 'ao'
    expect(response['clientDataJSON']).toBe('Y2Q'); // 'cd'
    expect(credential['id']).toBe('AQID'); // [1,2,3]
    expect(response['transports']).toEqual(['internal']);
  });

  it('浏览器真的被调用了，而且拿到的是 ArrayBuffer 形式的 challenge', async () => {
    stubSequencedFetch([
      { status: 200, body: REGISTER_OPTIONS },
      { status: 200, body: { message: 'ok' } },
    ]);
    const browser = browserResolving(registrationCredential());

    await act(async () => {
      await useAuthStore.getState().registerPasskey(BASE_URL, EMAIL, true, { browser });
    });

    expect(browser.create).toHaveBeenCalledTimes(1);
    const passed = (browser.create as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as PublicKeyCredentialCreationOptions;
    expect(passed.challenge).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(passed.challenge as ArrayBuffer)]).toEqual([0x68, 0x69]);
  });

  it('🔴 成功只是"申请已提交"，**不是**已登录 —— 令牌不能写、状态不能是 signed-in', async () => {
    stubSequencedFetch([
      { status: 200, body: REGISTER_OPTIONS },
      { status: 200, body: { message: 'ok' } },
    ]);

    await act(async () => {
      await useAuthStore
        .getState()
        .registerPasskey(BASE_URL, EMAIL, true, { browser: browserResolving(registrationCredential()) });
    });

    expect(useAuthStore.getState().status.kind).toBe('registered');
    expect(useSyncStore.getState().token).toBeUndefined();
  });

  it('用户取消 → 状态 failed 且**不再打第二个端点**（取消不能被当成注册成功）', async () => {
    stubSequencedFetch([{ status: 200, body: REGISTER_OPTIONS }]);
    const browser: PasskeyBrowser = {
      supported: true,
      create: vi.fn().mockRejectedValue({ name: 'NotAllowedError' }),
      get: vi.fn(),
    };

    await act(async () => {
      await useAuthStore.getState().registerPasskey(BASE_URL, EMAIL, true, { browser });
    });

    expect(calls).toHaveLength(1);
    const status = useAuthStore.getState().status;
    expect(status.kind === 'failed' && status.reason).toBe('passkey-cancelled');
  });

  it('设备不支持 → 一个请求都不发', async () => {
    stubSequencedFetch([]);
    const browser: PasskeyBrowser = { supported: false, create: vi.fn(), get: vi.fn() };

    await act(async () => {
      await useAuthStore.getState().registerPasskey(BASE_URL, EMAIL, true, { browser });
    });

    expect(calls).toHaveLength(0);
    const status = useAuthStore.getState().status;
    expect(status.kind === 'failed' && status.reason).toBe('passkey-unsupported');
  });

  it('取 options 就被服务端拒绝时，浏览器不会被调用', async () => {
    stubSequencedFetch([{ status: 403, body: { error: 'nope' } }]);
    const browser = browserResolving(registrationCredential());

    await act(async () => {
      await useAuthStore.getState().registerPasskey(BASE_URL, EMAIL, true, { browser });
    });

    expect(browser.create).not.toHaveBeenCalled();
    const status = useAuthStore.getState().status;
    expect(status.kind === 'failed' && status.reason).toBe('not-allowed');
  });
});

describe('用通行密钥登录', () => {
  it('🔴 令牌必须真的落进同步配置（否则界面说成功、同步却是空的）', async () => {
    stubSequencedFetch([
      { status: 200, body: LOGIN_OPTIONS },
      { status: 200, body: SESSION },
    ]);

    let session: unknown;
    await act(async () => {
      session = await useAuthStore
        .getState()
        .loginWithPasskey(BASE_URL, EMAIL, browserResolving(assertionCredential()));
    });

    expect(calls[0]?.url).toBe(`${BASE_URL}/api/login/passkey/options`);
    expect(calls[1]?.url).toBe(`${BASE_URL}/api/login/passkey/verify`);
    expect(useSyncStore.getState().token).toBe('jwt-from-passkey');
    expect(useSyncStore.getState().baseUrl).toBe(BASE_URL);
    expect(useAuthStore.getState().status).toEqual({ kind: 'signed-in', email: EMAIL });
    expect(session).toEqual(SESSION);
  });

  it('断言里的 userHandle / signature 都序列化成 base64url', async () => {
    stubSequencedFetch([
      { status: 200, body: LOGIN_OPTIONS },
      { status: 200, body: SESSION },
    ]);

    await act(async () => {
      await useAuthStore
        .getState()
        .loginWithPasskey(BASE_URL, EMAIL, browserResolving(assertionCredential()));
    });

    const credential = (calls[1]?.body as { credential: Record<string, unknown> }).credential;
    const response = credential['response'] as Record<string, unknown>;
    expect(response['userHandle']).toBe('aGFuZGxl'); // 'handle'
    expect(response['authenticatorData']).toBe('YWQ'); // 'ad'（无 padding）
    expect(typeof response['signature']).toBe('string');
  });

  it('写回令牌**不会**抹掉已填的加密口令', async () => {
    useSyncStore.setState({ password: 'secret-phrase' });
    stubSequencedFetch([
      { status: 200, body: LOGIN_OPTIONS },
      { status: 200, body: SESSION },
    ]);

    await act(async () => {
      await useAuthStore
        .getState()
        .loginWithPasskey(BASE_URL, EMAIL, browserResolving(assertionCredential()));
    });

    expect(useSyncStore.getState().password).toBe('secret-phrase');
  });

  it('verify 返回 401 → 令牌不写、状态 failed', async () => {
    stubSequencedFetch([
      { status: 200, body: LOGIN_OPTIONS },
      { status: 401, body: { error: 'bad' } },
    ]);

    await act(async () => {
      await useAuthStore
        .getState()
        .loginWithPasskey(BASE_URL, EMAIL, browserResolving(assertionCredential()));
    });

    expect(useSyncStore.getState().token).toBeUndefined();
    const status = useAuthStore.getState().status;
    expect(status.kind === 'failed' && status.reason).toBe('unauthorized');
  });

  it('本机已注册过（InvalidStateError）→ 有**专门**的一句话，不是"你取消了"', async () => {
    stubSequencedFetch([{ status: 200, body: LOGIN_OPTIONS }]);
    const browser: PasskeyBrowser = {
      supported: true,
      create: vi.fn(),
      get: vi.fn().mockRejectedValue({ name: 'InvalidStateError' }),
    };

    await act(async () => {
      await useAuthStore.getState().loginWithPasskey(BASE_URL, EMAIL, browser);
    });

    const status = useAuthStore.getState().status;
    expect(status.kind === 'failed' && status.reason).toBe('passkey-already-registered');
    // 三句不同的话必须真的不同 —— 否则分类等于没做。
    expect(translate('zh-CN', 'common.auth.error.passkeyAlreadyRegistered')).not.toBe(
      translate('zh-CN', 'common.auth.error.passkeyCancelled'),
    );
  });
});

describe('词条：新增的通行密钥文案两种语言都真的翻了', () => {
  const keys = [
    'web.auth.passkey.register',
    'web.auth.passkey.login',
    'web.auth.passkey.unavailable',
    'web.auth.passkey.waiting',
    'common.auth.error.passkeyUnsupported',
    'common.auth.error.passkeyCancelled',
    'common.auth.error.passkeyAlreadyRegistered',
  ] as const satisfies readonly MessageKey[];

  it('zh 里含汉字、en 里不含汉字，且两边都不为空', () => {
    for (const key of keys) {
      const zh = translate('zh-CN', key);
      const en = translate('en', key);
      expect(zh, `${key} 的 zh 是空的`).not.toBe('');
      expect(en, `${key} 的 en 是空的`).not.toBe('');
      expect(zh, `${key} 的 zh 里没有汉字`).toMatch(/[\u4e00-\u9fff]/);
      expect(en, `${key} 的 en 里混进了汉字`).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });
});
