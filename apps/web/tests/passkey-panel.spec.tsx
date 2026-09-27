/**
 * 通行密钥自助管理面板（Web 壳）
 * ==============================
 *
 * 服务端契约（路径 / 方法 / code）由 `packages/app-host/tests/hosted-passkeys.spec.ts`
 * 钉住。这里钉的是**界面真的把它用人话说了出来**，尤其是负向路径：
 *
 *   1. 🔴 **加载失败不许画成空列表** —— 一次 500 看起来像"我的凭据全没了"；
 *   2. 🔴 **删除是两段式** —— 第一下只进确认，绝不发 DELETE；
 *   3. 🔴 **删最后一条被拒后，那一行必须还在**（不能界面说删了、服务端没删）；
 *   4. 404（已经不在了）之后列表真的被刷新，行消失，并给一句解释。
 *
 * 与 `auth-passkey.spec.tsx` 同一套做法：`fetch` 注入（`vi.stubGlobal`），
 * 零联网。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, type Locale } from '@heyta/i18n';

import { PasskeyPanel } from '../src/features/settings/PasskeyPanel.js';
import { __resetPasskeysForTests } from '../src/features/settings/passkeysStore.js';
import { useSyncStore } from '../src/features/sync/store.js';

const BASE_URL = 'https://sync.example.com';
const TOKEN = 'jwt-token';

interface FetchCall {
  method: string;
  url: string;
}

let calls: FetchCall[];

/** 按调用顺序回响应 —— 一次"删完再刷新"要打两个请求，单一响应不够。 */
function stubFetch(script: Array<{ status: number; body?: unknown }>): void {
  calls = [];
  let index = 0;
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(input) });
    const next = script[Math.min(index, script.length - 1)] ?? { status: 500 };
    index += 1;
    return Promise.resolve({
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      json: () => Promise.resolve(next.body),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', mock);
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function renderPanel(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale={'en' as Locale}>
        <PasskeyPanel />
      </I18nProvider>,
    );
  });
  // 让 `useEffect` 里那次异步 load 的微任务落定。
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function byId(id: string): HTMLElement | null {
  return container?.querySelector(`[data-testid="${id}"]`) ?? null;
}

function click(id: string): void {
  const el = byId(id);
  if (el === null) throw new Error(`missing testid ${id}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const PASSKEY_ROW = {
  id: 'pk_row_1',
  createdAt: '2026-01-02T03:04:05.000Z',
  lastUsedAt: '2026-02-03T04:05:06.000Z',
};

const PASSKEY_ROW_2 = {
  id: 'pk_row_2',
  createdAt: '2026-03-04T05:06:07.000Z',
  lastUsedAt: null,
};

/**
 * 服务端下发的注册 options。`challenge` 与 `user.id` 必须是 base64url 字符串
 * ——`passkey-browser.ts` 的 `toCreationOptions` 在缺失时会判 `malformed-response`。
 */
const ENROLLMENT_OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { id: 'localhost', name: 'Test' },
  user: { id: 'dXNlci1pZA', name: 'owner@example.com', displayName: 'owner@example.com' },
  pubKeyCredParams: [],
  excludeCredentials: [],
  authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  attestation: 'none',
};

/** 让系统弹窗那一步返回一个形状正确的假 credential（真实 `PublicKeyCredential` 的替身）。 */
function fakeCreatedCredential(): unknown {
  return {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    type: 'public-key',
    response: {
      clientDataJSON: new Uint8Array([4]).buffer,
      attestationObject: new Uint8Array([5]).buffer,
      getTransports: () => ['internal'],
    },
    getClientExtensionResults: () => ({}),
  };
}

/**
 * 注入"这台设备支持通行密钥"。
 *
 * 🔴 走的是**真实**的 `detectPasskeyBrowser`（它读 `navigator.credentials` 与
 * `PublicKeyCredential`），不是给 store 开后门 —— 所以"不支持"那条用例
 * 只要不调用它即可。
 */
function stubPasskeyDevice(create: (publicKey: unknown) => Promise<unknown>): void {
  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    value: { create, get: vi.fn() },
  });
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
}

function clearPasskeyDevice(): void {
  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    value: undefined,
  });
}

/** 让若干层微任务（fetch → platform → fetch → reload）落定。 */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  __resetPasskeysForTests();
  useSyncStore.setState({ baseUrl: BASE_URL, token: TOKEN });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  __resetPasskeysForTests();
  useSyncStore.setState({ baseUrl: '', token: undefined });
  clearPasskeyDevice();
  vi.unstubAllGlobals();
});

describe('PasskeyPanel — 列出凭据', () => {
  it('渲染服务端返回的凭据，且请求带上了 bearer 令牌', async () => {
    stubFetch([{ status: 200, body: { passkeys: [PASSKEY_ROW] } }]);

    await renderPanel();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe(`${BASE_URL}/api/passkeys`);
    const row = byId('passkey-row-pk_row_1');
    expect(row).not.toBeNull();
    // 创建时间与上次使用都用人看得见的形式出现（YYYY-MM-DD）。
    expect(row!.textContent).toContain('2026-01-02');
    expect(row!.textContent).toContain('2026-02-03');
  });

  it('从未使用过 → 明说"Never used"，不编一个时间', async () => {
    stubFetch([
      { status: 200, body: { passkeys: [{ ...PASSKEY_ROW, lastUsedAt: null }] } },
    ]);

    await renderPanel();

    expect(byId('passkey-row-pk_row_1')!.textContent).toContain('Never used');
  });

  it('真的为空 → 空状态', async () => {
    stubFetch([{ status: 200, body: { passkeys: [] } }]);

    await renderPanel();

    expect(byId('passkeys-empty')).not.toBeNull();
  });

  it('🔴 加载失败 → 说失败，**绝不**画成空列表', async () => {
    stubFetch([{ status: 500, body: { error: 'boom' } }]);

    await renderPanel();

    expect(byId('passkeys-load-failed')).not.toBeNull();
    // 关键：失败不能被呈现成"这个账号没有凭据"。这条断言就是那个区分。
    expect(byId('passkeys-empty')).toBeNull();
  });

  it('未登录 → 明说先登录，且一个请求都不发', async () => {
    useSyncStore.setState({ baseUrl: BASE_URL, token: undefined });
    stubFetch([{ status: 200, body: { passkeys: [PASSKEY_ROW] } }]);

    await renderPanel();

    expect(byId('passkeys-needs-sign-in')).not.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('PasskeyPanel — 删除', () => {
  it('🔴 两段式：第一下只进入确认，绝不发 DELETE', async () => {
    stubFetch([{ status: 200, body: { passkeys: [PASSKEY_ROW] } }]);
    await renderPanel();

    click('passkey-delete-pk_row_1');

    expect(byId('passkey-confirm-pk_row_1')).not.toBeNull();
    // 只发生了最初那次 GET。
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('取消后不删', async () => {
    stubFetch([{ status: 200, body: { passkeys: [PASSKEY_ROW] } }]);
    await renderPanel();

    click('passkey-delete-pk_row_1');
    click('passkey-cancel-pk_row_1');

    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(byId('passkey-delete-pk_row_1')).not.toBeNull();
  });

  it('确认后真的 DELETE 到那条凭据的行 id，并重新拉列表', async () => {
    stubFetch([
      { status: 200, body: { passkeys: [PASSKEY_ROW] } },
      { status: 200, body: { success: true } },
      { status: 200, body: { passkeys: [] } },
    ]);
    await renderPanel();

    click('passkey-delete-pk_row_1');
    click('passkey-confirm-pk_row_1');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const deletes = calls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.url).toBe(`${BASE_URL}/api/passkeys/pk_row_1`);
    // 删完以服务端为准重拉了一次。
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
    expect(byId('passkeys-deleted')).not.toBeNull();
  });

  it('🔴 删最后一条被 409 拒绝 → 那一行必须**还在**，并说清为什么', async () => {
    stubFetch([
      { status: 200, body: { passkeys: [PASSKEY_ROW] } },
      {
        status: 409,
        body: {
          error: 'This is your only passkey, so it cannot be removed.',
          code: 'last_passkey_required',
        },
      },
    ]);
    await renderPanel();

    click('passkey-delete-pk_row_1');
    click('passkey-confirm-pk_row_1');
    await act(async () => {
      await Promise.resolve();
    });

    expect(byId('passkey-row-pk_row_1')).not.toBeNull();
    const failure = byId('passkeys-delete-failed');
    expect(failure).not.toBeNull();
    expect(failure!.textContent).toContain('only passkey');
    // 不许显示成功。
    expect(byId('passkeys-deleted')).toBeNull();
  });

  it('404（已经不在了）→ 列表被刷新，行消失，并解释发生了什么', async () => {
    stubFetch([
      { status: 200, body: { passkeys: [PASSKEY_ROW] } },
      {
        status: 404,
        body: { error: 'Passkey not found', code: 'passkey_not_found_for_user' },
      },
      { status: 200, body: { passkeys: [] } },
    ]);
    await renderPanel();

    click('passkey-delete-pk_row_1');
    click('passkey-confirm-pk_row_1');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(byId('passkey-row-pk_row_1')).toBeNull();
    const failure = byId('passkeys-delete-failed');
    expect(failure).not.toBeNull();
    expect(failure!.textContent).toContain('no longer on the server');
  });

  it('🔴 网络失败绝不说成成功', async () => {
    calls = [];
    let index = 0;
    const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(input) });
      index += 1;
      // 第一次 GET 正常返回；DELETE 那一次断网。
      if (index === 1) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ passkeys: [PASSKEY_ROW] }),
        } as unknown as Response);
      }
      return Promise.reject(new Error('offline'));
    });
    vi.stubGlobal('fetch', mock);

    await renderPanel();
    click('passkey-delete-pk_row_1');
    click('passkey-confirm-pk_row_1');
    await act(async () => {
      await Promise.resolve();
    });

    expect(byId('passkeys-deleted')).toBeNull();
    expect(byId('passkey-row-pk_row_1')).not.toBeNull();
    expect(byId('passkeys-delete-failed')).not.toBeNull();
  });
});

/**
 * "添加一条新的" —— 面板上那个出口。
 *
 * 🔴 这三条正是"删最后一条被拒 → 先添加一条新的"那句话**能不能兑现**的判据：
 *   1. 成功后**列表真的刷新**并出现新行（不是本地乐观新增，是重拉服务端）；
 *   2. 用户在系统弹窗取消 → **绝不说成成功**；
 *   3. 设备不支持 → **一个请求都不发**。
 *
 * `fetch` 注入，零联网；平台那一步由 `stubPasskeyDevice` 注入。
 */
describe('PasskeyPanel — 添加一条', () => {
  it('成功 → 打两步已认证端点，然后刷新列表并出现新行', async () => {
    stubPasskeyDevice(() => Promise.resolve(fakeCreatedCredential()));
    stubFetch([
      { status: 200, body: { passkeys: [PASSKEY_ROW] } }, // 挂载时的列表
      { status: 200, body: ENROLLMENT_OPTIONS }, // ① 取 options
      { status: 200, body: { message: 'Passkey added successfully.' } }, // ③ 交回
      { status: 200, body: { passkeys: [PASSKEY_ROW_2, PASSKEY_ROW] } }, // 刷新
    ]);

    await renderPanel();
    click('passkeys-add');
    await settle();

    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.url).toBe(`${BASE_URL}/api/passkeys/registration/options`);
    expect(posts[1]!.url).toBe(`${BASE_URL}/api/passkeys/registration/complete`);
    // 完成后**以服务端为准**重拉了一次列表（GET 从 1 次变 2 次）。
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
    // 新行真的出现了 —— 这是"凭据确实写进去了"在界面上的呈现。
    expect(byId('passkey-row-pk_row_2')).not.toBeNull();
    expect(byId('passkeys-added')).not.toBeNull();
    expect(byId('passkeys-add-failed')).toBeNull();
  });

  it('🔴 用户在系统弹窗取消 → 绝不说成成功，也不再发第二步请求', async () => {
    stubPasskeyDevice(() =>
      Promise.reject(new DOMException('cancelled', 'NotAllowedError')),
    );
    stubFetch([
      { status: 200, body: { passkeys: [PASSKEY_ROW] } },
      { status: 200, body: ENROLLMENT_OPTIONS },
    ]);

    await renderPanel();
    click('passkeys-add');
    await settle();

    // 只有"取 options"这一步发出去了，凭据没有被交回服务端。
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe(`${BASE_URL}/api/passkeys/registration/options`);
    // 界面说的是"取消"，不是"成功"。
    expect(byId('passkeys-added')).toBeNull();
    const failure = byId('passkeys-add-failed');
    expect(failure).not.toBeNull();
    expect(failure!.textContent).toContain('cancelled');
    // 列表没变。
    expect(byId('passkey-row-pk_row_1')).not.toBeNull();
  });

  it('🔴 这台设备不支持 → 一个请求都不发（挂载那次列表加载除外）', async () => {
    // 刻意**不**调用 stubPasskeyDevice：`detectPasskeyBrowser` 应判不支持。
    stubFetch([{ status: 200, body: { passkeys: [PASSKEY_ROW] } }]);

    await renderPanel();
    const before = calls.length;

    click('passkeys-add');
    await settle();

    // 点击添加之后没有任何新请求 —— 不支持的设备连 options 都不问。
    expect(calls).toHaveLength(before);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(byId('passkeys-added')).toBeNull();
    const failure = byId('passkeys-add-failed');
    expect(failure).not.toBeNull();
    expect(failure!.textContent).toContain('does not support passkeys');
  });
});
