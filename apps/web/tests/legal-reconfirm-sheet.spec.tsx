/**
 * 🔴 补签面板与第二道闸的接线（G-27 的界面侧 + 出口侧）
 * ===================================================
 *
 * `packages/app-host/tests/legal-recheck.spec.ts` 钉的是**判定**（19 条）。
 * 本文件钉的是另外两件只有在这一层才成立的事：
 *
 *   1. **界面上到底有没有这一问**：面板出现/收起的时机、只有一个肯定动作、
 *      "稍后再说"**不许**被写成"当没这回事"（第 4 条断言是这一整份文件最值钱的判据 ——
 *      一个"面板没了"的直觉实现很容易顺手把闸门也放开，而那正是那句承诺失效的形状）。
 *   2. **同步这条出站路真的被拦住**：`syncNow()` 在待补签时返回
 *      `legal-reconfirm-required`，并且**底层一次请求都没发**。
 *      这条与"状态对不对"是两件事：状态写对了但请求照发，才是那句承诺没兑现。
 *
 * ## 为什么 `globalThis.fetch` 要在 import 之前换掉
 *
 * `consent-gate.ts` 在**模块求值期**绑定 pristine fetch（同 `privacy-consent-sheet.spec.tsx`
 * 文件头那条），计数器装晚了数到的永远是 0，"零请求"就变成永远通过的判据（§7 第 50 条）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initOpLog, __resetOpLogForTests } from '../src/lib/oplog.js';
import { LocaleHost } from '../src/lib/locale-host.js';

const CURRENT = 'terms@1.2;privacy@1.0';
const RECORDED = 'terms@1.1;privacy@1.0';

type Script = { status: number; body: unknown } | { throw: true };

/** 按顺序答的脚本；队尾自动重复最后一个，免得每条用例都要预填一堆应答。 */
const queue: Script[] = [];
const requests: { method: string; url: string; body: unknown }[] = [];

const fetchSpy = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const script = queue.shift() ?? queue[queue.length - 1] ?? { status: 200, body: {} };
    requests.push({
      method: init?.method ?? 'GET',
      url: typeof input === 'string' ? input : String(input),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    if ('throw' in script) throw new Error('网络层抛错');
    return new Response(JSON.stringify(script.body), {
      status: script.status,
      headers: { 'content-type': 'application/json' },
    });
  },
);
globalThis.fetch = fetchSpy as unknown as typeof fetch;

const { legalRecheck, askLegalRecheck, syncLegalRecheckCredentials, clearLegalRecheckCredentials } =
  await import('../src/features/legal-recheck/gate.js');
const { useLegalReconfirmStore } = await import('../src/features/legal-recheck/store.js');
const { LegalReconfirmSheet } = await import('../src/features/legal-recheck/LegalReconfirmSheet.js');
const { privacyConsent } = await import('../src/features/privacy/consent-gate.js');
const { useSyncStore } = await import('../src/features/sync/store.js');
const { authBaseUrl } = await import('../src/lib/auth-endpoint.js');
const { translate } = await import('@heyta/i18n');

const DIALOG = '[data-testid="legal-reconfirm-dialog"]';
const ACTION = '[data-testid="legal-reconfirm-action"]';
const DEFER = '[data-testid="legal-reconfirm-defer"]';
const FAILURE = '[data-testid="legal-reconfirm-failure"]';

const statusBody = (needsReconfirm: boolean): unknown => ({
  needsReconfirm,
  reason: needsReconfirm ? 'version-changed' : 'current',
  currentVersion: CURRENT,
  recordedVersion: needsReconfirm ? RECORDED : CURRENT,
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mountSheet(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleHost>
        <LegalReconfirmSheet />
      </LocaleHost>,
    );
  });
  return container;
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el, '要点的那个控件不在界面上').not.toBeNull();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    await flush();
  });
}

async function ask(needsReconfirm: boolean): Promise<void> {
  queue.push({ status: 200, body: statusBody(needsReconfirm) });
  syncLegalRecheckCredentials({ token: 'TK-1', baseUrl: 'https://heyta.test' });
  await act(async () => {
    await flush();
  });
}

beforeEach(async () => {
  queue.length = 0;
  requests.length = 0;
  fetchSpy.mockClear();
  localStorage.clear();
  // 设备级闸门开着的起点：本文件测的是**第二道**闸，第一道必须不构成噪声。
  privacyConsent.decide('accepted');
  clearLegalRecheckCredentials();
  useLegalReconfirmStore.setState({ open: false, reason: 'asked', submitting: false });
  await initOpLog();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  __resetOpLogForTests();
});

describe('界面上有没有这一问', () => {
  it('🔴 服务端说要补签 ⇒ 对话框出现，且**只有一个**肯定动作（没有「只用本机」）', async () => {
    await ask(true);
    const el = await mountSheet();
    const box = el.querySelector(DIALOG);
    expect(box, '要补签时面板没出现').not.toBeNull();
    const buttons = Array.from(box!.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      translate('zh-CN', 'common.legal.reconfirm.action'),
      translate('zh-CN', 'common.legal.reconfirm.later'),
    ]);
    // 「只用本机」是**设备级**面板的选项，摆在这里等于给用户一个并不存在的出路。
    expect(box!.textContent).not.toContain(translate('zh-CN', 'common.privacy.consent.localOnly'));
    // 没有 X 关闭按钮：这一问不是"以后再说"能打发掉的偏好设置。
    expect(box!.querySelector('[data-testid="privacy-consent-close"]')).toBeNull();
    // 🔴 这一块上的字就是**用户正在确认的内容**，所以词条里不许留任何标记语法。
    // 它是被真浏览器截图抓出来的（§6.2 规定一）：中文 intro 写着 `**现在这一版**`，
    // 界面原样渲染出两个星号，而英文那版没有 —— 只看不数没人会报，只在 jsdom 里断言也照样漏。
    expect(box!.textContent, `界面露出了标记语法：${box!.textContent}`).not.toMatch(/\*\*|__/);
  });

  it('🔴 已同意当前版本 ⇒ 面板不出现、闸门不拦（防"每次都拦"的误伤）', async () => {
    await ask(false);
    expect(legalRecheck.shouldShowSheet()).toBe(false);
    expect(legalRecheck.dataEgressAllowed()).toBe(true);
    expect(useLegalReconfirmStore.getState().open).toBe(false);
  });

  it('两条链接可点、排在按钮**外面**，且指向面板所对着的那台服务端', async () => {
    // 组件里的地址来自同步 store（面板不许自己猜一个服务端）。
    useSyncStore.setState({ baseUrl: 'https://heyta.test' });
    await ask(true);
    const el = await mountSheet();
    const box = el.querySelector(DIALOG)!;
    const links = Array.from(box.querySelectorAll('a'));
    expect(links).toHaveLength(2);
    for (const a of links) {
      // 🔴 链接指向**这一问所对着的那台服务端**（`authBaseUrl` 才是那个答案，
      // 测试环境里它是 jsdom 的 origin，硬写域名会让这条判据永远测的是别人）。
      expect(a.getAttribute('href')!.startsWith(authBaseUrl('https://heyta.test'))).toBe(true);
      // 链接套在按钮里时，点链接会顺带触发那个按钮（链 2 的 M3 变异抓的就是这个）。
      expect(a.closest('button')).toBeNull();
    }
    expect(box.querySelector(ACTION)!.contains(links[0]!)).toBe(false);
  });
});

describe('两个动作各自的后果', () => {
  it('🔴 点「我已读完并确认」⇒ POST 带的是**服务端带回的那一版**，随后闸门放开、面板收起', async () => {
    await ask(true);
    const el = await mountSheet();
    queue.push({ status: 200, body: { ok: true, recordedVersion: CURRENT } });
    await click(el.querySelector(ACTION));
    const post = requests.find((r) => r.method === 'POST');
    expect(post, '确认没有发出去').toBeDefined();
    expect(post!.body).toEqual({ documentVersion: CURRENT, acceptedAt: expect.any(Number) });
    expect(legalRecheck.current().phase).toBe('clear');
    expect(legalRecheck.dataEgressAllowed()).toBe(true);
    expect(useLegalReconfirmStore.getState().open).toBe(false);
  });

  it('🔴 点「稍后再说」⇒ 面板收起，但闸门**仍然拦着**（推迟不是同意，也不是拒绝）', async () => {
    await ask(true);
    const el = await mountSheet();
    await click(el.querySelector(DEFER));
    expect(useLegalReconfirmStore.getState().open).toBe(false);
    expect(legalRecheck.dataEgressAllowed()).toBe(false);
    expect(legalRecheck.current().phase).toBe('needs-reconfirm');
    // 而且这一次点击**不该发出任何请求** —— 它不是决定，只是收起。
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('确认失败 ⇒ 面板**不收起**、说清没提交成功、闸门保持拦', async () => {
    await ask(true);
    const el = await mountSheet();
    queue.push({ throw: true });
    await click(el.querySelector(ACTION));
    expect(useLegalReconfirmStore.getState().open).toBe(true);
    expect(legalRecheck.dataEgressAllowed()).toBe(false);
    const line = el.querySelector(FAILURE);
    expect(line, '失败没有出现在用户正看着的这一块上').not.toBeNull();
    expect(line!.textContent).toContain(translate('zh-CN', 'common.legal.reconfirm.failNetwork'));
  });

  it('重复点击不许发出第二个 POST（提交在途时按钮禁用）', async () => {
    await ask(true);
    const el = await mountSheet();
    let release: () => void = () => {};
    queue.push({
      status: 200,
      body: { ok: true, recordedVersion: CURRENT },
    });
    const button = el.querySelector(ACTION) as HTMLButtonElement;
    void release;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });
});

describe('同步这条出站路真的被拦住', () => {
  it('🔴 待补签时 `syncNow()` 回 `legal-reconfirm-required`，且**一个请求都没发**', async () => {
    await ask(true);
    useSyncStore.setState({ baseUrl: 'https://heyta.test', token: 'TK-1' });
    const before = requests.length;
    const status = await useSyncStore.getState().syncNow();
    expect(status).toEqual({ kind: 'error', reason: 'legal-reconfirm-required', retryable: false });
    expect({ sent: requests.length - before }).toEqual({ sent: 0 });
    // 拦下时顺手把面板打开：用户点的是同步，得有一条走出去的路。
    expect(useLegalReconfirmStore.getState().open).toBe(true);
    expect(useLegalReconfirmStore.getState().reason).toBe('required-for-action');
  });

  it('补签完成之后再点同步 ⇒ 请求发得出去（闸门不是单向的）', async () => {
    await ask(true);
    useSyncStore.setState({ baseUrl: 'https://heyta.test', token: 'TK-1' });
    queue.push({ status: 200, body: { ok: true, recordedVersion: CURRENT } });
    await useLegalReconfirmStore.getState().confirm();
    // 口令是**另一道**前置（`no-encryption-password`），与本题无关，给它一个真值
    // 才能让这条判据一直走到"到底发不发出请求"那一步。
    useSyncStore.setState({ baseUrl: 'https://heyta.test', token: 'TK-1', password: 'pw' });
    const before = requests.length;
    const after = await useSyncStore.getState().syncNow();
    expect(JSON.stringify(after)).not.toContain('legal-reconfirm-required');
    expect(requests.slice(before).some((r) => r.url.includes('/api/sync/'))).toBe(true);
  });

  it('🔴 没登录（无凭据）⇒ 不拦同步，也**不许**弹面板', async () => {
    clearLegalRecheckCredentials();
    askLegalRecheck();
    await act(async () => {
      await flush();
    });
    expect(requests).toHaveLength(0);
    expect(legalRecheck.dataEgressAllowed()).toBe(true);
    expect(useLegalReconfirmStore.getState().open).toBe(false);
  });
});
