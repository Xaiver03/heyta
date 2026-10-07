/**
 * 🔴 首启隐私面板：界面上的每一条都要能失败（G-11 的那一面）
 * =========================================================
 *
 * ## 这个文件钉的是"问了"这件事，而不是"能出门"那件事
 *
 * `consent-gate.spec.ts` 数的是底层次数（闸门本身），`startup-network.spec.ts` 数的
 * 是那三步的顺序（启动序列）。都不覆盖**用户看到什么** —— 而 G-11 要求的是
 * "首启确实向这个人征求过同意"。那只能靠渲染出来再读界面来判断。
 *
 * ## 🔴 三条最容易被"顺手改掉"的纪律，各有一条会红的断言
 *
 *   1. **关掉 ≠ 同意**：按 Esc 或点 X 之后，决定必须仍然是"没问过"，
 *      磁盘上不许多出记录。把 `closeSheet()` 改成"顺手记一个 local-only"会让整件事失效
 *      —— 那正是《认定方法》里"以默认同意代替用户选择"的形状。
 *   2. **「只用本机」不是一个失败状态**：闸门关闭，但 `undecided()` 必须是 `false`
 *      （不能再每次刷新问一遍）。收成布尔值就答不出这两件事的区别。
 *   3. **两个决定同等可达**：都是 `<button>`、同一个父节点。
 *      "同意是按钮、不同意是一行小字"是 Apple 4.2 与 PIPL 第 16 条明确的反例。
 *
 * ## 为什么 `globalThis.fetch` 要在 import 之前换掉
 *
 * `consent-gate.ts` 在**模块求值期**绑定 pristine fetch。测试文件里静态 import 的模块
 * 会先于任何语句执行，所以计数器必须在 `await import()` **之前**装上 ——
 * 否则数到的永远是 0，"零请求"这条就成了永远通过的判据（§7 第 50 条）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OFFICIAL_SITE_ORIGIN, PRIVACY_CONSENT_KEY } from '@heyta/app-host';

import { initOpLog, __resetOpLogForTests } from '../src/lib/oplog.js';
import { LocaleHost } from '../src/lib/locale-host.js';

/** 底层 HTTP 出口计数器（早于下面的 dynamic import 装上）。 */
const fetchSpy = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    new Response('{}', { status: 200 }),
);
globalThis.fetch = fetchSpy as unknown as typeof fetch;

/** 实时通道计数器：面板开着的时候这里也必须一条都不许建。 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {}
}
globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

const { App } = await import('../src/App.js');
const { PrivacyConsentSheet } = await import('../src/features/privacy/PrivacyConsentSheet.js');
const { privacyConsent, consentFetch, installConsentGatedFetch } = await import(
  '../src/features/privacy/consent-gate.js'
);
const { usePrivacyStore } = await import('../src/features/privacy/store.js');
const { useSyncStore } = await import('../src/features/sync/store.js');

/**
 * 🔴 装上进程级出口闸 —— 这是 `main.tsx` 里的**第一条语句**，测试必须照做，
 * 否则挂出来的是一棵"线上不存在"的树。
 *
 * 第一次跑这条判据时抓到的正是这个差别：收件箱轮询（`GET /api/notifications`）
 * 与同步状态探测（`GET /api/sync/status`）**没有**拿注入的 `consentFetch`，
 * 它们直接调全局 `fetch`。线上被这道闸拦住，而没装闸的测试里它们当场漏了出去。
 * 也就是说：拦住它们的是**这一层**，不是"每个调用点都记得传 `fetchImpl`"。
 * 那句话此前只是文件头上的断言，现在有一条用例钉住它。
 */
installConsentGatedFetch();

const DIALOG = '[data-testid="privacy-consent-dialog"]';
const ACCEPT = '[data-testid="privacy-consent-accept"]';
const LOCAL_ONLY = '[data-testid="privacy-consent-local-only"]';
const CLOSE = '[data-testid="privacy-consent-close"]';
const ACKNOWLEDGE = '[data-testid="privacy-consent-acknowledge"]';
const TERMS = '[data-testid="privacy-consent-terms"]';
const PRIVACY = '[data-testid="privacy-consent-privacy"]';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mount(node: React.JSX.Element): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<LocaleHost>{node}</LocaleHost>);
  });
  return container;
}

function dialog(el: HTMLElement): Element {
  const found = el.querySelector(DIALOG);
  expect(found, '面板没渲染出对话框').not.toBeNull();
  return found!;
}

function storedRecord(): { decision?: string } | null {
  const raw = localStorage.getItem(PRIVACY_CONSENT_KEY);
  return raw === null ? null : (JSON.parse(raw) as { decision?: string });
}

/**
 * 只用到 `dispatchEvent`，所以参数收在 `Element` 这一层：`querySelector` 返回的
 * 就是 `Element`，写成 `HTMLElement` 会在每个调用点逼一次断言 —— 而断言不检查任何东西。
 */
async function click(el: Element | null | undefined): Promise<void> {
  expect(el, '要点的那个控件不在界面上').not.toBeNull();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  fetchSpy.mockClear();
  FakeWebSocket.reset();
  localStorage.clear();
  // 起点必须真的是"没问过"，否则上一条用例留下的会话值会替这一条作决定。
  privacyConsent.revoke();
  usePrivacyStore.setState({ open: false, reason: 'first-launch', notPersisted: false });
  expect(privacyConsent.undecided()).toBe(true);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

/** 把面板打开（走 store 的真实入口，不是直接渲染成 open 状态）。 */
async function openSheet(reason: 'first-launch' | 'revoked' | 'required-for-action' = 'first-launch') {
  usePrivacyStore.getState().openSheet(reason);
  return mount(<PrivacyConsentSheet />);
}

describe('面板的基本形状：一句话要说清"这个决定只决定能不能联网"', () => {
  it('对话框有可及的名字，两个决定都是真按钮且并排', async () => {
    const el = await openSheet();
    const box = dialog(el);

    expect(box.getAttribute('aria-modal')).toBe('true');
    const labelledBy = box.getAttribute('aria-labelledby');
    expect(labelledBy, '对话框没有 aria-labelledby').not.toBeNull();
    const title = el.querySelector(`#${labelledBy}`);
    expect(title?.textContent?.trim(), '标题是空的').not.toBe('');

    const accept = el.querySelector(ACCEPT);
    const localOnly = el.querySelector(LOCAL_ONLY);
    expect(accept?.tagName).toBe('BUTTON');
    expect(localOnly?.tagName).toBe('BUTTON');
    // 🔴 同一个父节点 = 并排、同等可达。把「只用本机」挪进脚注或小字里，这条就红。
    expect(localOnly?.parentElement, '两个决定不在同一排').toBe(accept?.parentElement);
    expect(accept?.textContent?.trim()).not.toBe('');
    expect(localOnly?.textContent?.trim()).not.toBe('');
  });

  it('🔴 中文界面里没有一句是英文-only，英文界面里一个汉字都不许有', async () => {
    const zhEl = await openSheet();
    const zhText = dialog(zhEl).textContent ?? '';
    expect(zhText).toMatch(/[\u3400-\u9fff]/u);

    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;

    localStorage.setItem('heyta.locale', 'en');
    const enEl = await openSheet();
    const enText = dialog(enEl).textContent ?? '';
    expect(enText.trim(), '英文界面是空的').not.toBe('');
    expect(enText, `这句会露出中文：${enText}`).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it('「为什么现在又弹」只在不是首启的时候出现', async () => {
    const first = await openSheet('first-launch');
    const firstText = dialog(first).textContent ?? '';
    expect(firstText).not.toMatch(/刚才那一步/);

    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;

    const again = await openSheet('required-for-action');
    expect(dialog(again).textContent ?? '').toMatch(/刚才那一步/);
  });
});

describe('🔴 关掉不等于同意（不许把"没选"记成"选了"）', () => {
  it('按 Esc 关掉：闸门仍然关着，而且磁盘上一条记录都没多', async () => {
    const el = await openSheet();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(el.querySelector(DIALOG), '面板没关').toBeNull();
    expect(privacyConsent.networkAllowed()).toBe(false);
    expect(privacyConsent.undecided(), '关掉被记成了一次决定').toBe(true);
    expect(storedRecord(), '关掉被写进了磁盘').toBeNull();
  });

  it('点 X 关掉：同样不是同意', async () => {
    const el = await openSheet();
    await click(el.querySelector(CLOSE));

    expect(privacyConsent.networkAllowed()).toBe(false);
    expect(privacyConsent.undecided()).toBe(true);
    expect(storedRecord()).toBeNull();
  });

  it('🔴 点背景（遮罩）不许等于同意，也不许等于"只用本机"', async () => {
    const el = await openSheet();
    const overlay = dialog(el).parentElement!;
    await click(overlay);

    expect(el.querySelector(DIALOG), '点背景把面板关了 —— 同意不能靠点空白处作出').not.toBeNull();
    expect(storedRecord()).toBeNull();
  });
});

describe('两个决定的语义', () => {
  it('「同意并联网」：闸门打开、记录落盘、面板收起', async () => {
    const el = await openSheet();
    await click(el.querySelector(ACCEPT));

    expect(privacyConsent.networkAllowed()).toBe(true);
    expect(storedRecord()?.decision).toBe('accepted');
    expect(el.querySelector(DIALOG)).toBeNull();
  });

  it('🔴 「只用本机」：闸门关着，但**不再每次启动都问**', async () => {
    const el = await openSheet();
    await click(el.querySelector(LOCAL_ONLY));

    expect(privacyConsent.networkAllowed(), '「只用本机」不该放行联网').toBe(false);
    // 这两句是这条用例的全部意义：拒绝**不是**"还没决定"。
    expect(privacyConsent.undecided(), '明确拒绝过的人不该被反复问').toBe(false);
    expect(storedRecord()?.decision).toBe('local-only');
    expect(el.querySelector(DIALOG)).toBeNull();
  });

  it('🔴 界面上的两个按钮管的确实是那一道闸（不是另一份状态）', async () => {
    const el = await openSheet();
    await click(el.querySelector(LOCAL_ONLY));

    // 选了「只用本机」之后，真的 `consentFetch` 必须仍然拦住、底层次数仍然 0。
    await expect(consentFetch('https://sync.example.com/api/sync/ops')).rejects.toThrow(
      /privacy-consent-not-granted/,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    // 换成同意：同一个闸门实例当场放行 —— 不是"下次启动才生效"。
    await act(async () => {
      privacyConsent.decide('accepted');
    });
    const response = await consentFetch('https://sync.example.com/api/sync/ops');
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('条款链接：必须点开就有内容，且不许顺带触发别的控件', () => {
  it('🔴 两个链接都是独立可点元素 —— 不在按钮或 label 里', async () => {
    const el = await openSheet();
    for (const selector of [TERMS, PRIVACY]) {
      const link = el.querySelector(selector) as HTMLAnchorElement | null;
      expect(link, `${selector} 不在界面上`).not.toBeNull();
      // 链 2 的 M3 变异抓的就是这个：链接嵌在按钮/勾选框里，点链接会顺带作出决定。
      expect(link!.closest('button'), `${selector} 嵌在按钮里`).toBeNull();
      expect(link!.closest('label'), `${selector} 嵌在 label 里`).toBeNull();
      expect(link!.target).toBe('_blank');
      expect(link!.rel).toContain('noopener');
      expect(link!.rel).toContain('noreferrer');
      expect(link!.href).toMatch(/^https?:\/\//);
    }
  });

  it('🔴 用户什么都没配的时候链接也给得出来（不能要求他先知道服务器域名）', async () => {
    useSyncStore.setState({ baseUrl: '' });
    const el = await openSheet();
    const terms = el.querySelector(TERMS) as HTMLAnchorElement | null;
    const privacy = el.querySelector(PRIVACY) as HTMLAnchorElement | null;
    expect(terms?.href, '未配置时条款链接消失了').toBeTruthy();
    expect(privacy?.href).toBeTruthy();
    // 链接指向的是**这次要发给哪台服务端**那一个来源，与 authBaseUrl 同一判据。
    expect(new URL(terms!.href).host).toBe(new URL(OFFICIAL_SITE_ORIGIN).host);
  });

  it('面板开着期间一个请求都不发（拼链接不等于探测链接）', async () => {
    useSyncStore.setState({ baseUrl: 'https://sync.example.com', token: 'tok-abc' });
    await openSheet();
    await act(async () => {
      await flush();
    });

    expect(fetchSpy, '面板为了"看看条款在不在"发了请求').toHaveBeenCalledTimes(0);
    expect(FakeWebSocket.instances, '面板开着就建了实时连接').toHaveLength(0);
  });
});

describe('决定没能落盘（隐私模式 / 配额满）', () => {
  it('🔴 面板不许直接收起 —— 那句警告必须出现在用户正看着的这一块上', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    try {
      // 🔴 先断言桩真的生效（§7 第 50 条：断言前提，否则"警告出现了"可能是别的原因）。
      localStorage.setItem('probe-key', 'probe-value');
      expect(localStorage.getItem('probe-key'), 'setItem 的桩没生效').toBeNull();

      const el = await openSheet();
      await click(el.querySelector(ACCEPT));

      expect(el.querySelector(DIALOG), '落盘失败却把面板收起了 —— 那句警告永远不会被看到').not.toBeNull();
      const status = el.querySelector('[role="status"]');
      expect(status?.textContent?.trim(), '缺少"没能记住"那句话').not.toBe('');

      // 决定本身**已经生效**（本次会话内），界面不能假装它没发生。
      expect(privacyConsent.networkAllowed()).toBe(true);

      // 收起只有一条路：用户确认过那句话。此时不再给两个决定按钮。
      expect(el.querySelector(ACCEPT), '警告状态下还在让人重新一遍决定').toBeNull();
      await click(el.querySelector(ACKNOWLEDGE));
      expect(el.querySelector(DIALOG)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('重新打开面板时不许带着上一次"没记住"的警告', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    try {
      const el = await openSheet();
      await click(el.querySelector(ACCEPT));
      expect(el.querySelector('[role="status"]')).not.toBeNull();
    } finally {
      spy.mockRestore();
    }

    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;

    const again = await openSheet('revoked');
    expect(
      again.querySelector('[role="status"]'),
      '旧的落盘失败警告跟着新面板一起出现',
    ).toBeNull();
    expect(again.querySelector(ACCEPT), '这次能落盘却没了决定按钮').not.toBeNull();
  });
});

describe('🔴 接到 App 上：首启真的会弹（G-11 的判据只能在整棵树上成立）', () => {
  beforeEach(async () => {
    __resetOpLogForTests();
    await initOpLog(`consent-sheet-${Math.random().toString(36).slice(2)}`);
  });

  it('全新设备（什么都没决定过）挂载后，面板就在', async () => {
    const el = await mount(<App />);
    await act(async () => {
      await flush();
    });

    expect(el.querySelector(DIALOG), '首启没有弹隐私面板 —— App 里那条接线是装饰').not.toBeNull();
    expect(el.querySelector(ACCEPT)).not.toBeNull();
    expect(el.querySelector(LOCAL_ONLY)).not.toBeNull();
  });

  it('🔴 首启面板出现的整个过程中：0 个 HTTP 请求、0 条 WebSocket', async () => {
    // 这条是 G-12 在**界面层**的版本：闸门数得出底层次数，但"挂载过程中根本没人去调"
    // 只能在这里证。把 `main.tsx`/`App.tsx` 里任何一步挪回同意之前，这里就会红。
    useSyncStore.setState({ baseUrl: 'https://sync.example.com', token: 'tok-abc' });
    await mount(<App />);
    await act(async () => {
      await flush();
    });
    await act(async () => {
      await flush();
    });

    const urls = fetchSpy.mock.calls.map(([input, init]) => {
      const target =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      return `${init?.method ?? 'GET'} ${target}`;
    });
    // 🔴 失败时把** URL 打进消息**：这一条红了意味着"有人绕过了注入的闸门自己调 fetch"，
    // 没有 URL 的话下一步又得重新查是谁。
    expect(urls, `未同意就有请求出门：${urls.join(' | ')}`).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('已经决定过的人（冷启动）不再被打扰', async () => {
    const el = await openSheet();
    await click(el.querySelector(ACCEPT));
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;
    usePrivacyStore.setState({ open: false, notPersisted: false });

    const app = await mount(<App />);
    await act(async () => {
      await flush();
    });
    expect(app.querySelector(DIALOG), '已经同意过的人还每次被问').toBeNull();
    expect(el.querySelector(DIALOG)).toBeNull();
  });
});
