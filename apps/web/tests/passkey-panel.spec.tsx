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
