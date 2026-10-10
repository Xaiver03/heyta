/**
 * 换绑登录邮箱 + 登录会话撤销 + 真退出登录（Web 壳）
 * ==============================================
 *
 * 服务端契约（路径 / 方法 / code）由 `packages/app-host/tests/*` 与
 * `server/tests/*` 钉住。这里钉的是**界面有没有把那些结构化结果说成人话**，
 * 以及**退出登录这一次点击到底做了什么**。四条承重判据都来自工单：
 *
 *   1. 🔴 "还等哪一边"必须来自 `getEmailChangeStatus`，**不是**组件本地态。
 *      做法：面板一次按钮都不点，只换 status 的两种取值，必须渲染出两句不同的话。
 *      本地记一份的话，这一条会在"刷新之后"说谎，而刷新测试写不出来 ——
 *      所以判据写成"没有任何点击，文案却跟着服务端变"。
 *   2. 🔴 `current` 那一行不许被撤销（撤销手上这一枚的出口是「退出登录」）。
 *   3. 🔴 冷却期里"发起更换"这个动作**不存在**（服务端此时一个字节都不发）。
 *   4. 🔴 服务端撤销**失败**时，本机凭据仍然要被清掉，而且界面上必须出现那句实话。
 *      只测"清掉了"不够（那是 §7 第 50 条"状态对在但没生效"的家族）——
 *      所以两条一起断言：token 没了 **且** `common.signOut.pending` 在 DOM 里。
 *
 * 与 `passkey-panel.spec.tsx` 同一套做法：`fetch` 注入（`vi.stubGlobal`），零联网。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, type Locale } from '@heyta/i18n';

import { EmailChangePanel } from '../src/features/settings/EmailChangePanel.js';
import { SessionsPanel } from '../src/features/settings/SessionsPanel.js';
import { SignOutNotice } from '../src/features/settings/SignOutNotice.js';
import { ProfilePanel } from '../src/features/settings/ProfilePanel.js';
import { __resetEmailChangeForTests, useEmailChangeStore } from '../src/features/settings/emailChangeStore.js';
import { __resetSessionsForTests, useSessionsStore } from '../src/features/settings/sessionsStore.js';
import { __resetSignOutForTests, useSignOutStore } from '../src/features/settings/signOutStore.js';
import { useSyncStore } from '../src/features/sync/store.js';

const BASE_URL = 'https://sync.example.com';
const TOKEN = 'jwt-token';
/** 换绑与会话这几条路的完整路径 = `/api` + 契约里的相对路径（拼接只发生在 app-host）。 */
const P = {
  changeRequest: '/api/account/email/change/request',
  changeStatus: '/api/account/email/change/status',
  changeCancel: '/api/account/email/change/cancel',
  sessions: '/api/auth/sessions',
  revokeAll: '/api/auth/sessions/revoke-all',
  logout: '/api/auth/logout',
  session: (id: string): string => `/api/auth/sessions/${id}`,
};

interface FetchCall {
  method: string;
  path: string;
  /** `authorization` 头。用于证明"清完凭据之后重试用的还是当初那一枚"。 */
  auth?: string;
  body?: unknown;
}

interface Route {
  method: string;
  path: string;
  status?: number;
  body?: unknown;
  /** `retry-after` 响应头（冷却那句的秒数来源）。 */
  retryAfter?: string;
  /** 网络层失败（`fetch` 直接 reject）。 */
  offline?: boolean;
  /** 这一发**先不回话**（解析器进 `held`，由用例决定它什么时候、以什么结果落地）。 */
  hold?: boolean;
}

let calls: FetchCall[];

/**
 * `hold: true` 那几发的解析器。参数 = 让它落地成什么（不传就是 200 `{}`）。
 *
 * 这一件装置只为一条判据存在：**迟到的一次不许覆盖当前世界**。
 * 没有它，"服务器挂着不回话"那个真实形状在测试里根本造不出来。
 */
let held: Array<(status?: number, body?: unknown, offline?: boolean) => void>;

function makeResponse(status: number, body: unknown, ok: boolean, retryAfter?: string): Response {
  return {
    status,
    ok,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
    },
    json: () => Promise.resolve(body ?? {}),
  } as unknown as Response;
}

/**
 * 按 **method + path** 路由（不按调用顺序），同一 `(method, path)` 出现多条时
 * **按给出的顺序逐条消费，用尽之后重复最后一条**。
 *
 * 🔴 刻意不用"按全局调用顺序回第 N 个响应"那种桩：本面板一次动作会打两个请求
 * （POST 之后重读 GET），顺序桩会把"有没有重读"这件事**测成假绿** ——
 * 少了那次 GET 时，第二个响应会顶到别的位置上，用照样能过。
 * 🔴 也不能只用"一条路由一个响应"：那会让"POST 之后重拉列表"读回**同一个**
 * 世界（撤销前那份），于是"那一行真的消失了"这条断言永远测不到。
 */
function stubRoutes(routes: Route[]): void {
  calls = [];
  held = [];
  const used: number[] = routes.map(() => 0);
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({
      method,
      path: url.pathname,
      auth: (init?.headers as Record<string, string> | undefined)?.['authorization'],
      ...(rawBody === undefined ? {} : { body: JSON.parse(rawBody) as unknown }),
    });

    const matching = routes
      .map((route, index) => ({ route, index }))
      .filter(({ route }) => route.method === method && route.path === url.pathname);
    if (matching.length === 0) {
      return Promise.resolve(makeResponse(404, { error: 'not stubbed' }, false));
    }
    // 第一条还没用过的；都用过就重复最后一条（"再刷一次还是同一个世界"）。
    const picked =
      matching.find(({ index }) => used[index] === 0) ?? matching[matching.length - 1]!;
    used[picked.index] = (used[picked.index] ?? 0) + 1;
    const hit = picked.route;

    if (hit.offline === true) return Promise.reject(new Error('offline'));
    if (hit.hold === true) {
      // 用例自己决定这一发什么时候落地、落地成什么 —— "挂着不回话"是真实形状。
      return new Promise<Response>((resolve, reject) => {
        held.push((status, body, offline) => {
          if (offline === true) {
            reject(new Error('offline'));
            return;
          }
          const code = status ?? hit.status ?? 200;
          resolve(makeResponse(code, body ?? hit.body, code >= 200 && code < 300, hit.retryAfter));
        });
      });
    }
    const status = hit.status ?? 200;
    return Promise.resolve(makeResponse(status, hit.body, status >= 200 && status < 300, hit.retryAfter));
  });
  vi.stubGlobal('fetch', mock);
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function render(ui: React.ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<I18nProvider locale={'en' as Locale}>{ui}</I18nProvider>);
  });
  await settle();
}

function byId(id: string): HTMLElement | null {
  return container?.querySelector(`[data-testid="${id}"]`) ?? null;
}

function text(id: string): string | null {
  return byId(id)?.textContent ?? null;
}

function click(id: string): void {
  const el = byId(id);
  if (el === null) throw new Error(`missing testid ${id}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 改受控 input 的值（必须走原生 setter，否则 React 认为"没变过"）。 */
function typeInto(id: string, value: string): void {
  const el = byId(id) as HTMLInputElement | null;
  if (el === null) throw new Error(`missing testid ${id}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

const pathOf = (method: string, path: string): FetchCall | undefined =>
  calls.find((c) => c.method === method && c.path === path);

const countOf = (method: string, path: string): number =>
  calls.filter((c) => c.method === method && c.path === path).length;

/** 一次成功的换绑请求会打两发：POST 之后必须重读 status。 */
const CHANGE_OK: Route[] = [
  { method: 'GET', path: P.changeStatus, body: { pending: false, awaitingOld: false, awaitingNew: false } },
  { method: 'POST', path: P.changeRequest, body: { message: 'ok', expiresAt: 0, resendAvailableAt: 0 } },
];

const SESSION_A = {
  sessionId: 'a'.repeat(64),
  createdAt: 1_700_000_000_000,
  lastSeenAt: 1_700_000_100_000,
  deviceName: 'MacBook',
  userAgent: null,
  current: false,
};
const SESSION_CURRENT = {
  sessionId: 'b'.repeat(64),
  createdAt: 1_800_000_000_000,
  lastSeenAt: 1_800_000_100_000,
  deviceName: null,
  userAgent: 'Mozilla/5.0 (iPhone)',
  current: true,
};

beforeEach(() => {
  __resetEmailChangeForTests();
  __resetSessionsForTests();
  __resetSignOutForTests();
  useSyncStore.setState({ baseUrl: BASE_URL, token: TOKEN, email: 'me@example.com' });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  __resetEmailChangeForTests();
  __resetSessionsForTests();
  __resetSignOutForTests();
  useSyncStore.setState({ baseUrl: '', token: undefined, email: undefined });
  vi.unstubAllGlobals();
});

describe('EmailChangePanel — 🔴 "还等哪一边"只来自服务端的 status', () => {
  it('一次按钮都没点：status 说还等**旧**邮箱 ⇒ 界面说的是等旧邮箱', async () => {
    stubRoutes([
      {
        method: 'GET',
        path: P.changeStatus,
        body: {
          pending: true,
          awaitingOld: true,
          awaitingNew: false,
          pendingEmail: 'new@example.com',
          expiresAt: Date.now() + 3_600_000,
          resendAvailableAt: 0,
        },
      },
    ]);

    await render(<EmailChangePanel />);

    expect(text('email-change-stage')).toContain('current mailbox still needs one click');
    expect(text('email-change-pending-email')).toBe('new@example.com');
    // 这一条是"本地态"的反证：**没有任何一次点击**，界面却答出了只有服务端知道的事。
    expect(countOf('POST', P.changeRequest)).toBe(0);
  });

  it('同一份代码、换一个 status ⇒ 换成另一句话（证明它不在组件里记"我点了哪边"）', async () => {
    stubRoutes([
      {
        method: 'GET',
        path: P.changeStatus,
        body: {
          pending: true,
          awaitingOld: false,
          awaitingNew: true,
          pendingEmail: 'new@example.com',
          expiresAt: Date.now() + 3_600_000,
          resendAvailableAt: 0,
        },
      },
    ]);

    await render(<EmailChangePanel />);

    const stage = text('email-change-stage');
    expect(stage).toContain('new mailbox still needs one click');
    expect(stage).not.toContain('current mailbox still needs one click');
  });

  it('两边都等 ⇒ awaitingBoth', async () => {
    stubRoutes([
      {
        method: 'GET',
        path: P.changeStatus,
        body: {
          pending: true,
          awaitingOld: true,
          awaitingNew: true,
          expiresAt: Date.now() + 3_600_000,
          resendAvailableAt: 0,
        },
      },
    ]);

    await render(<EmailChangePanel />);

    expect(text('email-change-stage')).toContain('Both mailboxes still need one click each');
  });

  it('🔴 pending 为真而两边都不等 ⇒ 不说"等另一边"，也不说"已生效"', async () => {
    stubRoutes([
      { method: 'GET', path: P.changeStatus, body: { pending: true, awaitingOld: false, awaitingNew: false } },
    ]);

    await render(<EmailChangePanel />);

    const stage = text('email-change-stage');
    expect(stage).not.toContain('still needs one click');
    expect(stage).not.toContain('Both mailboxes');
    // 落在那句老实的"没成功，请重试"。
    expect(stage).toContain('did not go through');
    // 这种状态下撤销那张请求的出口必须还在（否则用户被卡住）。
    expect(byId('email-change-cancel')).not.toBeNull();
  });

  it('🔴 读侧失败**不是**"没有进行中的换绑"（不编一个 pending 块，也不假装 idle）', async () => {
    stubRoutes([{ method: 'GET', path: P.changeStatus, status: 500, body: { error: 'boom' } }]);

    await render(<EmailChangePanel />);

    expect(byId('email-change-load-failed')).not.toBeNull();
    expect(byId('email-change-pending')).toBeNull();

    // 🔴 那一句必须是"**读**不出来"，不许是"更换没有成功"：这一条路上没有人发起过任何东西。
    // 这一条不是设想 —— 真浏览器截图（计划 §6.4）里印的正是 `The change did not go through.`，
    // 一句关于一次**不存在的尝试**的话，而当时没有任何一层会红。
    const line = text('email-change-load-failed') ?? '';
    expect(line).toContain('could not be read');
    expect(line).not.toContain('did not go through');
    // 地址没有改动这件事也要在同一句里说出来（用户此刻最想知道的就是这个）。
    expect(line).toContain('has not changed');
  });

  it('🔴 新地址那一格在**没输入**时也得看得出是个输入框', async () => {
    // 这台应用的输入框按现行控件风格没有边框（`controls.css` 的 `.ht-input { border: 0 }`），
    // 而 `.ht-settings__actions` 是 flex + `.ht-input { flex: 1 }` ⇒ 空着的那一片就是纯白。
    // 截图实测：只剩标签与按钮，认不出中间能打字。占位文字是那一格里唯一的线索。
    stubRoutes(CHANGE_OK);

    await render(<EmailChangePanel />);

    const field = byId('email-change-new');
    expect(field).not.toBeNull();
    expect((field as HTMLInputElement).placeholder.trim().length, '占位文字不能是空的').toBeGreaterThan(
      0,
    );
  });

  it('未登录 ⇒ 明说先登录，且一个请求都不发', async () => {
    useSyncStore.setState({ baseUrl: BASE_URL, token: undefined });
    stubRoutes(CHANGE_OK);

    await render(<EmailChangePanel />);

    expect(byId('email-change-needs-sign-in')).not.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('EmailChangePanel — 发起与取消', () => {
  it('发起 ⇒ POST 带上新地址，然后**重读服务端**并说出"两封信已发出"', async () => {
    stubRoutes([
      { method: 'GET', path: P.changeStatus, body: { pending: false, awaitingOld: false, awaitingNew: false } },
      {
        method: 'POST',
        path: P.changeRequest,
        body: {
          message: 'ok',
          expiresAt: Date.now() + 86_400_000,
          resendAvailableAt: Date.now() + 60_000,
        },
      },
    ]);

    await render(<EmailChangePanel />);
    typeInto('email-change-new', 'new@example.com');
    click('email-change-submit');
    await settle();

    const post = pathOf('POST', P.changeRequest);
    expect(post).toBeDefined();
    expect(post!.body).toMatchObject({ newEmail: 'new@example.com' });
    // 邮件是**为收件人**渲染的，所以界面语言要跟着走（app-host 把它放进 body）。
    expect(post!.body).toMatchObject({ locale: 'en' });
    // 🔴 POST 之后必须**再读一次** status —— 那句"还等谁点"只有服务端能答。
    expect(countOf('GET', P.changeStatus)).toBe(2);
    expect(text('email-change-sent')).toContain('Two emails are on their way');
    // 成功绝不能同时挂着一句失败。
    expect(byId('email-change-failed')).toBeNull();
  });

  it('重读之后 status 说两边都在等 ⇒ 界面立刻换成那句实话（不是"发起成功"就完事）', async () => {
    stubRoutes([
      ...CHANGE_OK,
      {
        method: 'GET',
        path: P.changeStatus,
        body: {
          pending: true,
          awaitingOld: true,
          awaitingNew: true,
          pendingEmail: 'new@example.com',
          expiresAt: Date.now() + 86_400_000,
          resendAvailableAt: Date.now() + 60_000,
        },
      },
    ]);

    await render(<EmailChangePanel />);
    typeInto('email-change-new', 'new@example.com');
    click('email-change-submit');
    await settle();

    expect(text('email-change-stage')).toContain('Both mailboxes still need one click each');
  });

  it('🔴 冷却期里"发起更换"这个动作**不存在**，并给出剩余秒数', async () => {
    stubRoutes([
      {
        method: 'GET',
        path: P.changeStatus,
        body: {
          pending: true,
          awaitingOld: true,
          awaitingNew: true,
          expiresAt: Date.now() + 86_400_000,
          // 45 秒之后才允许重发。
          resendAvailableAt: Date.now() + 45_000,
        },
      },
    ]);

    await render(<EmailChangePanel />);

    expect(byId('email-change-submit')).toBeNull();
    expect(byId('email-change-form')).toBeNull();
    const seconds = text('email-change-cooldown');
    expect(seconds).toContain('45');
    expect(seconds).toContain('start a new one after');
    // 撤销那张请求的出口还在。
    expect(byId('email-change-cancel')).not.toBeNull();
  });

  it('冷却已过 ⇒ 发起动作回来了（此时服务端才允许再发两封信）', async () => {
    stubRoutes([
      {
        method: 'GET',
        path: P.changeStatus,
        body: {
          pending: true,
          awaitingOld: true,
          awaitingNew: true,
          expiresAt: Date.now() + 86_400_000,
          resendAvailableAt: Date.now() - 1,
        },
      },
    ]);

    await render(<EmailChangePanel />);

    expect(byId('email-change-cooldown')).toBeNull();
    expect(byId('email-change-submit')).not.toBeNull();
  });

  it('取消 ⇒ POST 撤销、重读 status、表单回来，并说一句"邮箱没有改动"', async () => {
    stubRoutes([
      {
        method: 'GET',
        path: P.changeStatus,
        body: {
          pending: true,
          awaitingOld: true,
          awaitingNew: true,
          expiresAt: Date.now() + 86_400_000,
          resendAvailableAt: Date.now() + 30_000,
        },
      },
      { method: 'POST', path: P.changeCancel, body: { message: 'cancelled' } },
      // 撤销之后重读：已经没有活请求了 ⇒ 表单必须回来。
      { method: 'GET', path: P.changeStatus, body: { pending: false, awaitingOld: false, awaitingNew: false } },
    ]);

    await render(<EmailChangePanel />);
    expect(byId('email-change-submit')).toBeNull();

    click('email-change-cancel');
    await settle();

    expect(pathOf('POST', P.changeCancel)).toBeDefined();
    expect(countOf('GET', P.changeStatus)).toBe(2);
    expect(text('email-change-cancelled')).toContain('was not modified');
    expect(byId('email-change-submit')).not.toBeNull();
    // 撤销成功之后不许继续挂着那句"还在等谁点"。
    expect(byId('email-change-pending')).toBeNull();
  });

  it('每条失败原因各说各的话（taken / unchanged / notVerified / invalidLink / network）', async () => {
    const cases: Array<{ status: number; code: string; expect: string }> = [
      { status: 409, code: 'email_taken', expect: 'Another account is already using' },
      { status: 400, code: 'email_unchanged', expect: 'already the email address' },
      { status: 403, code: 'email_not_verified', expect: 'Verify your current email' },
      { status: 400, code: 'invalid_change_link', expect: 'link is not valid' },
    ];

    for (const item of cases) {
      stubRoutes([
        { method: 'GET', path: P.changeStatus, body: { pending: false, awaitingOld: false, awaitingNew: false } },
        { method: 'POST', path: P.changeRequest, status: item.status, body: { error: 'x', code: item.code } },
      ]);
      await render(<EmailChangePanel />);
      typeInto('email-change-new', 'new@example.com');
      click('email-change-submit');
      await settle();

      const failed = text('email-change-failed');
      expect(failed, item.code).toContain(item.expect);
      // 失败绝不画成成功。
      expect(byId('email-change-sent')).toBeNull();
      act(() => {
        root?.unmount();
      });
      container?.remove();
      root = undefined;
      container = undefined;
      __resetEmailChangeForTests();
    }

    // 网络层失败：一句"没发起成功，而且邮箱没改动"。
    stubRoutes([
      { method: 'GET', path: P.changeStatus, body: { pending: false, awaitingOld: false, awaitingNew: false } },
      { method: 'POST', path: P.changeRequest, offline: true },
    ]);
    await render(<EmailChangePanel />);
    typeInto('email-change-new', 'new@example.com');
    click('email-change-submit');
    await settle();

    expect(text('email-change-failed')).toContain('The network is unavailable');
    expect(byId('email-change-sent')).toBeNull();
  });

  it('🔴 429 冷却**没有** retry-after 头时，宁可不说秒数，也不编一个 0', async () => {
    stubRoutes([
      // status 也读不到活请求（这一次故意让两边都空）⇒ 没有任何秒数来源。
      { method: 'GET', path: P.changeStatus, body: { pending: false, awaitingOld: false, awaitingNew: false } },
      { method: 'POST', path: P.changeRequest, status: 429, body: { error: 'x', code: 'email_change_cooldown' } },
    ]);

    await render(<EmailChangePanel />);
    typeInto('email-change-new', 'new@example.com');
    click('email-change-submit');
    await settle();

    expect(byId('email-change-failed')).toBeNull();
    expect(byId('email-change-cooldown')).toBeNull();
    // 冷却意味着那张请求还在 ⇒ 面板重读了一次 status（秒数的唯一真源）。
    expect(countOf('GET', P.changeStatus)).toBe(2);
  });

  it('429 冷却**带** retry-after 头时，那句秒数说的是服务端给的数', async () => {
    stubRoutes([
      { method: 'GET', path: P.changeStatus, body: { pending: false, awaitingOld: false, awaitingNew: false } },
      {
        method: 'POST',
        path: P.changeRequest,
        status: 429,
        retryAfter: '30',
        body: { error: 'x', code: 'email_change_cooldown' },
      },
    ]);

    await render(<EmailChangePanel />);
    typeInto('email-change-new', 'new@example.com');
    click('email-change-submit');
    await settle();

    expect(text('email-change-failed')).toContain('30');
  });

  it('没填地址 ⇒ 一句"要先填邮箱地址"，且一个请求都不发', async () => {
    stubRoutes(CHANGE_OK);

    await render(<EmailChangePanel />);
    click('email-change-submit');
    await settle();

    expect(text('email-change-local-error')).toContain('email address');
    expect(countOf('POST', P.changeRequest)).toBe(0);
  });
});

describe('SessionsPanel', () => {
  const LIST_OK: Route = {
    method: 'GET',
    path: P.sessions,
    body: { sessions: [SESSION_A, SESSION_CURRENT] },
  };

  it('列出每一行：设备名与 UA 都念出来，最近登录的排在最前', async () => {
    stubRoutes([LIST_OK]);

    await render(<SessionsPanel />);

    expect(text('session-label-' + SESSION_A.sessionId)).toBe('MacBook');
    expect(text('session-label-' + SESSION_CURRENT.sessionId)).toBe('Mozilla/5.0 (iPhone)');
    const rows = [...container!.querySelectorAll('[data-testid^="session-row-"]')];
    expect(rows[0]?.getAttribute('data-testid')).toBe(`session-row-${SESSION_CURRENT.sessionId}`);
    expect(text(`session-row-${SESSION_A.sessionId}`)).toContain('Last used');
  });

  /**
   * 🔴 **设备名与 UA 都没有 ⇒ 那一行什么都不写，不许编一个名字。**
   * 这一格不是设想：`access_sessions.device_name` **今天没有任何一条登录路由接收它**
   * （计划 §5 第 9 条），所以"两个都空"是当前线上每一枚会话的真实形状 ——
   * 负责人 10-10 拍的是不给登录请求加一个客户端自报的 `deviceName`（收益零，代价是一条不可逆的线协议），
   * 于是这个形状会长期存在，必须由判据钉住而不是靠注释（裁决记录在计划 §6.77）。
   * 界面上宁可那一行只有时间，也不许出现一句"未命名设备"——那是替服务端说谎。
   */
  it('🔴 设备名与 UA 都缺（含只有空格的）⇒ 那一行不画标签，也不编一个名字', async () => {
    const bothNull = {
      sessionId: 'c'.repeat(64),
      createdAt: 1_600_000_000_000,
      lastSeenAt: 1_600_000_100_000,
      deviceName: null,
      userAgent: null,
      current: false,
    };
    const bothBlank = {
      sessionId: 'd'.repeat(64),
      createdAt: 1_600_000_000_100,
      lastSeenAt: 1_600_000_100_100,
      deviceName: '   ',
      userAgent: '   ',
      current: false,
    };
    stubRoutes([{ method: 'GET', path: P.sessions, body: { sessions: [bothNull, bothBlank] } }]);

    await render(<SessionsPanel />);

    // 前提：两行**都画出来了** —— 否则"标签是 null"可以是"整片没渲染"的另一种读法。
    expect(byId(`session-row-${bothNull.sessionId}`)).not.toBeNull();
    expect(byId(`session-row-${bothBlank.sessionId}`)).not.toBeNull();
    expect(byId(`session-label-${bothNull.sessionId}`)).toBeNull();
    expect(byId(`session-label-${bothBlank.sessionId}`)).toBeNull();

    // 整张表里不许出现任何一句编出来的名字，也不许出现"这台设备"（两行都不是 current）。
    const rendered = container!.textContent ?? '';
    for (const invented of ['Unknown device', 'Unnamed device', '未命名', 'This device']) {
      expect(rendered, `界面上出现了编出来的名字：${invented}`).not.toContain(invented);
    }
  });

  it('🔴 current 那一行标成"这台设备"，撤销它的按钮是禁用的，并且旁边有一句为什么', async () => {
    stubRoutes([LIST_OK]);

    await render(<SessionsPanel />);

    expect(text('session-current-' + SESSION_CURRENT.sessionId)).toBe('This device');
    expect(text(`session-hint-${SESSION_CURRENT.sessionId}`)).toContain('use "Sign out"');
    const currentButton = byId(`session-revoke-${SESSION_CURRENT.sessionId}`) as HTMLButtonElement | null;
    expect(currentButton).not.toBeNull();
    expect(currentButton!.disabled).toBe(true);
    // 别的行不受影响 —— 禁的是那一行，不是整张表。
    const otherButton = byId(`session-revoke-${SESSION_A.sessionId}`) as HTMLButtonElement | null;
    expect(otherButton!.disabled).toBe(false);
  });

  it('🔴 真的去点那一行 ⇒ 一个 DELETE 都不发（禁用不是摆设）', async () => {
    stubRoutes([LIST_OK]);

    await render(<SessionsPanel />);
    const button = byId(`session-revoke-${SESSION_CURRENT.sessionId}`) as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('撤销别的那台 ⇒ DELETE 到那一枚的 id，然后以服务端为准重拉列表', async () => {
    stubRoutes([
      LIST_OK,
      { method: 'DELETE', path: P.session(SESSION_A.sessionId), body: { success: true } },
      { method: 'GET', path: P.sessions, body: { sessions: [SESSION_CURRENT] } },
    ]);

    await render(<SessionsPanel />);
    click(`session-revoke-${SESSION_A.sessionId}`);
    await settle();

    expect(pathOf('DELETE', P.session(SESSION_A.sessionId))).toBeDefined();
    expect(countOf('GET', P.sessions)).toBe(2);
    // 那一行真的没了（重拉来的，不是本地 filter 掉的）。
    expect(byId(`session-row-${SESSION_A.sessionId}`)).toBeNull();
    expect(text('sessions-revoked')).toContain('has been signed out');
    expect(byId('sessions-revoke-failed')).toBeNull();
  });

  it('🔴 读侧失败**不是**空列表（"没有别的设备登录着"需要证据）', async () => {
    stubRoutes([{ method: 'GET', path: P.sessions, status: 500, body: { error: 'boom' } }]);

    await render(<SessionsPanel />);

    expect(byId('sessions-load-failed')).not.toBeNull();
    // 空态走共享 `EmptyState`（没有 testid 可找），所以断言的是**这句话没有出现过**。
    expect(container?.textContent).not.toContain('No other device is signed in');
  });

  it('真的为空 ⇒ 共享空态 + 那句"更早的令牌只能靠退出所有设备"', async () => {
    stubRoutes([{ method: 'GET', path: P.sessions, body: { sessions: [] } }]);

    await render(<SessionsPanel />);

    expect(container?.textContent).toContain('No other device is signed in');
    expect(text('sessions-legacy-hint')).toContain('before this feature existed');
  });

  it('未登录 ⇒ 明说先登录，且一个请求都不发', async () => {
    useSyncStore.setState({ baseUrl: BASE_URL, token: undefined });
    stubRoutes([LIST_OK]);

    await render(<SessionsPanel />);

    expect(byId('sessions-needs-sign-in')).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('撤完那一枚**本来就不在了**（unknown_session）⇒ 刷新列表，不说"已退出"也不报失败', async () => {
    stubRoutes([
      LIST_OK,
      { method: 'DELETE', path: P.session(SESSION_A.sessionId), status: 400, body: { error: 'x', code: 'unknown_session' } },
      { method: 'GET', path: P.sessions, body: { sessions: [SESSION_CURRENT] } },
    ]);

    await render(<SessionsPanel />);
    click(`session-revoke-${SESSION_A.sessionId}`);
    await settle();

    // 那三件事（不存在 / 不是你的 / 已经撤过）在服务端故意同一个码同一句话，
    // 所以界面对它们的处置只有"把列表拉回真相"。
    expect(countOf('GET', P.sessions)).toBe(2);
    expect(byId(`session-row-${SESSION_A.sessionId}`)).toBeNull();
    expect(byId('sessions-revoked')).toBeNull();
    expect(byId('sessions-revoke-failed')).toBeNull();
  });

  it('撤销真的失败（网络断了）⇒ 那一行必须**还在**，并说一句没做成', async () => {
    stubRoutes([
      LIST_OK,
      { method: 'DELETE', path: P.session(SESSION_A.sessionId), offline: true },
    ]);

    await render(<SessionsPanel />);
    click(`session-revoke-${SESSION_A.sessionId}`);
    await settle();

    expect(byId(`session-row-${SESSION_A.sessionId}`)).not.toBeNull();
    expect(text('sessions-revoke-failed')).toContain('did not go through');
    expect(byId('sessions-revoked')).toBeNull();
  });
});

describe('🔴 退出登录：本机一定要清，撤销没做成要老实说', () => {
  const signedOut = (): boolean => {
    const s = useSyncStore.getState();
    return s.token === undefined && s.email === undefined && s.password === undefined;
  };

  it('服务端撤销成功 ⇒ 打了 /api/auth/logout、清了本机凭据、不多不少一句话', async () => {
    stubRoutes([
      { method: 'GET', path: P.changeStatus, body: { pending: false, awaitingOld: false, awaitingNew: false } },
      { method: 'POST', path: P.logout, body: { message: 'Signed out.' } },
    ]);
    await render(<SignOutNotice />);

    await act(async () => {
      await useSignOutStore.getState().signOutCurrentDevice();
    });

    const post = pathOf('POST', P.logout);
    expect(post).toBeDefined();
    expect(post!.auth).toBe(`Bearer ${TOKEN}`);
    expect(signedOut()).toBe(true);
    expect(byId('sign-out-pending')).toBeNull();
    expect(byId('sign-out-all-done')).toBeNull();
  });

  it('🔴 服务端撤销失败 ⇒ 本机凭据**仍然**清掉，而且界面上出现那句实话 + 一个重试出口', async () => {
    stubRoutes([{ method: 'POST', path: P.logout, status: 500, body: { error: 'boom' } }]);
    await render(<SignOutNotice />);

    await act(async () => {
      await useSignOutStore.getState().signOutCurrentDevice();
    });

    // 两半都要成立：只测"清了"会漏掉那句谎，只测"话说了"会漏掉那枚还活着的令牌。
    expect(signedOut()).toBe(true);
    expect(text('sign-out-pending')).toContain('could not be revoked yet');
    const retry = byId('sign-out-retry') as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
    expect(retry!.textContent).toContain('Try revoking it again');
  });

  it('🔴 断网（fetch 直接 reject）也一样：先登出，再承认服务端那一枚还没撤', async () => {
    stubRoutes([{ method: 'POST', path: P.logout, offline: true }]);
    await render(<SignOutNotice />);

    await act(async () => {
      await useSignOutStore.getState().signOutCurrentDevice();
    });

    expect(signedOut()).toBe(true);
    expect(byId('sign-out-pending')).not.toBeNull();
  });

  it('重试成功 ⇒ 那句话消失；🔴 而且**不动**用户在这期间新建的会话', async () => {
    stubRoutes([
      { method: 'POST', path: P.logout, status: 500, body: { error: 'boom' } },
      { method: 'POST', path: P.logout, body: { message: 'Signed out.' } },
    ]);
    await render(<SignOutNotice />);

    await act(async () => {
      await useSignOutStore.getState().signOutCurrentDevice();
    });
    expect(byId('sign-out-pending')).not.toBeNull();

    // 用户重新登录了一次（这是一枚**新的**会话，与那次失败的撤销无关）。
    act(() => {
      useSyncStore.setState({ token: 'brand-new-token', email: 'me@example.com' });
    });
    calls = [];

    await act(async () => {
      await useSignOutStore.getState().retryPendingRevocation();
    });

    // 重试用的还是**当初捕获**的那枚（服务端只认它），不是新会话的那枚。
    expect(pathOf('POST', P.logout)!.auth).toBe(`Bearer ${TOKEN}`);
    expect(byId('sign-out-pending')).toBeNull();
    // 🔴 新会话还在 —— 上一次失败的撤销结果不许连带清掉现在的登录。
    expect(useSyncStore.getState().token).toBe('brand-new-token');
  });

  it('🔴 上一次撤销还挂在那里 ⇒ 第二次点「退出登录」**仍然**把本机登出（不能"点了没反应"）', async () => {
    stubRoutes([
      { method: 'POST', path: P.logout, hold: true },
      { method: 'POST', path: P.logout, body: { message: 'Signed out.' } },
    ]);
    await render(<SignOutNotice />);

    // 第一次：服务端不回话（共享电脑 / 断网 / 网关黑洞都是这个形状）。
    await act(async () => {
      void useSignOutStore.getState().signOutCurrentDevice();
    });
    await settle();
    expect(useSyncStore.getState().token).toBeUndefined();

    // 用户重新登录，然后再点一次退出 —— 这一次绝不能被"上一次还没回来"挡住。
    act(() => {
      useSyncStore.setState({ baseUrl: BASE_URL, token: 'second-token', email: 'me@example.com' });
    });
    await act(async () => {
      await useSignOutStore.getState().signOutCurrentDevice();
    });

    expect(useSyncStore.getState().token).toBeUndefined();
    expect(countOf('POST', P.logout)).toBe(2);
    // 第二次用的是**它自己**那一枚令牌，不是第一次那枚。
    expect(calls[1]!.auth).toBe('Bearer second-token');
    expect(byId('sign-out-pending')).toBeNull();
  });

  it('🔴 迟到的那一次失败不许覆盖新的那次（代际作废，不是 in-flight 锁）', async () => {
    stubRoutes([
      { method: 'POST', path: P.logout, hold: true },
      { method: 'POST', path: P.logout, body: { message: 'Signed out.' } },
    ]);
    await render(<SignOutNotice />);

    await act(async () => {
      void useSignOutStore.getState().signOutCurrentDevice();
    });
    act(() => {
      useSyncStore.setState({ baseUrl: BASE_URL, token: 'second-token', email: 'me@example.com' });
    });
    await act(async () => {
      await useSignOutStore.getState().signOutCurrentDevice();
    });
    expect(byId('sign-out-pending')).toBeNull();

    // 现在才让**第一次**那发落地成失败：它属于已经不在这个世界的那一次点击。
    await act(async () => {
      held[0]!(500, { error: 'boom' });
      await Promise.resolve();
      await Promise.resolve();
    });

    // 不许因此冒出一句"那一枚还没撤掉"，也不许把旧令牌塞回 pending 里。
    expect(byId('sign-out-pending')).toBeNull();
    expect(useSignOutStore.getState().pending).toBeUndefined();
  });

  it('🔴 迟到的那一次**重试**失败，同样不许覆盖其后那一次成功的登出', async () => {
    stubRoutes([
      // 第 1 发：原始登出 ⇒ 服务端拒绝 ⇒ 界面上出现那句实话（并留下待重试的那枚）。
      { method: 'POST', path: P.logout, status: 500, body: { error: 'boom' } },
      // 第 2 发：重试 ⇒ 挂着不回话。
      { method: 'POST', path: P.logout, hold: true },
      // 第 3 发：其间用户重新登录后又点了一次「退出登录」⇒ 这一次成功。
      { method: 'POST', path: P.logout, body: { message: 'Signed out.' } },
    ]);
    await render(<SignOutNotice />);

    await act(async () => {
      await useSignOutStore.getState().signOutCurrentDevice();
    });
    expect(byId('sign-out-pending')).not.toBeNull();

    act(() => {
      useSyncStore.setState({ baseUrl: BASE_URL, token: 'second-token', email: 'me@example.com' });
    });
    await act(async () => {
      void useSignOutStore.getState().retryPendingRevocation();
    });
    await settle();

    await act(async () => {
      await useSignOutStore.getState().signOutCurrentDevice();
    });
    expect(byId('sign-out-pending')).toBeNull();

    // 现在才让那次**迟到的重试**落地成失败：它已经不属于当前世界了。
    await act(async () => {
      held[0]!(500, { error: 'boom' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(byId('sign-out-pending')).toBeNull();
  });

  it('重试仍然失败 ⇒ 那句话**留着**（不许把两次失败读成一次成功）', async () => {
    stubRoutes([{ method: 'POST', path: P.logout, status: 500, body: { error: 'boom' } }]);
    await render(<SignOutNotice />);

    await act(async () => {
      await useSignOutStore.getState().signOutCurrentDevice();
    });
    await act(async () => {
      await useSignOutStore.getState().retryPendingRevocation();
    });

    expect(byId('sign-out-pending')).not.toBeNull();
    expect(useSignOutStore.getState().pending).toBeDefined();
    expect(countOf('POST', P.logout)).toBe(2);
  });

  it('手上没有令牌（没配置 / 没登录）⇒ 一个请求都不发，也不说"那一枚还没撤掉"', async () => {
    useSyncStore.setState({ baseUrl: BASE_URL, token: undefined });
    stubRoutes([{ method: 'POST', path: P.logout, body: { message: 'ok' } }]);
    await render(<SignOutNotice />);

    await act(async () => {
      await useSignOutStore.getState().signOutCurrentDevice();
    });

    // 那一枚根本不存在 —— 说"服务器上那一枚没能撤销"是一句假话。
    expect(calls).toHaveLength(0);
    expect(byId('sign-out-pending')).toBeNull();
  });

  it('退出所有设备 ⇒ POST revoke-all，本机一起清掉，并给那句"包括这台"', async () => {
    stubRoutes([
      { method: 'GET', path: P.sessions, body: { sessions: [SESSION_CURRENT] } },
      { method: 'POST', path: P.revokeAll, body: { count: 3 } },
    ]);
    await render(
      <>
        <SessionsPanel />
        <SignOutNotice />
      </>,
    );

    click('sessions-logout-all');
    await settle();

    expect(pathOf('POST', P.revokeAll)).toBeDefined();
    expect(signedOut()).toBe(true);
    expect(text('sign-out-all-done')).toContain('including this one');
    // 面板已经落到未登录态：它不许继续显示**上一个人**的会话行。
    expect(byId(`session-row-${SESSION_CURRENT.sessionId}`)).toBeNull();
    expect(byId('sessions-needs-sign-in')).not.toBeNull();
  });

  it('用户重新登录之后，"请重新登录"那句自己消失（过期的指令是第二种谎）', async () => {
    stubRoutes([{ method: 'POST', path: P.revokeAll, body: { count: 1 } }]);
    await render(<SignOutNotice />);

    await act(async () => {
      await useSignOutStore.getState().signOutEverywhere();
    });
    expect(byId('sign-out-all-done')).not.toBeNull();

    act(() => {
      useSyncStore.setState({ token: 'brand-new-token', email: 'me@example.com' });
    });
    await settle();

    expect(byId('sign-out-all-done')).toBeNull();
  });
});

describe('接线（挂载点真的存在 —— "做好了但没接上"不算做完）', () => {
  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const profileSource = readFileSync(
    resolve(process.cwd(), 'src/features/settings/ProfilePanel.tsx'),
    'utf8',
  );

  it('换绑面板挂在个人信息面板里，只读邮箱那一行的下面', () => {
    expect(profileSource).toContain('<EmailChangePanel');
  });

  it('EmailChangePanel 在 ProfilePanel 里**真的渲染出来**（不是只 import 了没接）', async () => {
    stubRoutes([
      { method: 'GET', path: P.changeStatus, body: { pending: false, awaitingOld: false, awaitingNew: false } },
      { method: 'GET', path: '/api/account/profile', body: { displayName: null, avatarHash: null } },
    ]);
    await render(<ProfilePanel />);
    expect(byId('email-change-panel')).not.toBeNull();
  });

  it('SessionsPanel 与 SignOutNotice 都挂在 App 上，且退出登录走的是 signOutStore', () => {
    expect(appSource).toContain('<SessionsPanel');
    expect(appSource).toContain('<SignOutNotice');
    expect(appSource).toContain('signOutCurrentDevice()');
  });

  it('🔴 头像菜单那个「退出登录」不许退回成裸的 clearCredentials（那句谎的源头）', () => {
    const onSignOut = appSource.slice(appSource.indexOf('onSignOut={'), appSource.indexOf('onSignOut={') + 900);
    expect(onSignOut).toContain('signOutCurrentDevice');
    expect(onSignOut).not.toContain('clearCredentials()');
  });

  it('🔴 settings 目录里**只有一处**登出实现（第二份 = 两套"到底退出了没有"）', () => {
    const files = [
      'src/features/settings/signOutStore.ts',
      'src/features/settings/SessionsPanel.tsx',
      'src/features/settings/SignOutNotice.tsx',
      'src/features/settings/EmailChangePanel.tsx',
    ];
    const callers = files.filter((f) =>
      readFileSync(resolve(process.cwd(), f), 'utf8').includes('clearCredentials()'),
    );
    expect(callers).toEqual(['src/features/settings/signOutStore.ts']);
  });
});
