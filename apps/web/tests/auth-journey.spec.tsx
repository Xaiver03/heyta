/**
 * 注册旅程的形状（2026-10-01 重构；2026-10-02 随共享表单改写断言方式）
 * ===================================================================
 *
 * 产品负责人的原话是：**「绝对不允许什么用自己正在用的域名才能够注册，不可能是这样子的。」**
 *
 * 那之前这个面板上有两道墙，而且它们是**同一道墙的两面**：
 *
 *   1. `baseUrl === ''` 时先渲染一个**空的必填地址框** —— 于是"你知道自己的同步域名吗"
 *      成了注册的前置条件；
 *   2. 六个动作（发登录链接 / 注册 / 通行密钥注册 / 通行密钥登录 / 找回 / 粘贴完成）
 *      **并排同样重**，一个刚来的人看不出哪条是主路。
 *
 * ## 🔴 这一组的断言为什么在 2026-10-02 换了写法
 *
 * 表单本体从"web 手写"变成四端共用的 `@heyta/ui` 的 `AuthForm`（见
 * `AuthPanel.tsx` 文件头）。**换的是写法，不是判据**：
 *
 * | 原来钉的 | 现在钉的 | 为什么这样才对 |
 * |---|---|---|
 * | `ht-btn--primary` 类名里只有一个注册 | identify 阶段**只有「继续」一个主按钮**，且此时**没有口令栏** | 主路现在是一次问一件事；视觉权重是共享层的实现，类名不该由 web 判据钉住 |
 * | 「发送登录链接」是文字链（`className` 不含 `ht-btn`） | 它**仍在 DOM 里**且排在口令之后 | "降级"的实质是**次序与发现成本**，不是某个 CSS 类 |
 * | 通行密钥**三条**都在 | 一个 passkey 入口（随档位说"注册/登录"）+ 找回 + 邮件链接都在 | FIDO 的结论就是一个 affordance 管两档，见 §5 第 1 条 |
 * | 「高级」是原生 `<details>`、默认折叠 | 地址/粘贴**在展开之后完整存在**，地址是**最后一栏** | 见下面那条 🔴：2026-10-02 这一行**又换了一次写法** |
 *
 * 🔴 **上面那一行的第二次改动（2026-10-02 晚，产品负责人）**：
 * 「为什么还是默认就是要什么粘贴服务器地址和令牌之类的东西？……一定是默认是
 * 我们提供公共服务的，如果他自建的话再说。」
 * 于是地址与粘贴兜底从"始终在 DOM"改成**默认收起 + 一个展开入口**。
 * 这一行不是把上一轮的裁决推翻着玩：上一轮拆的是**"地址是注册的前置条件"**，
 * 拆完之后它仍然常驻在表单末尾 —— 而"在末尾"和"是第一个看到的"是两件事，
 * 第一屏里出现"服务端地址""粘贴令牌"两栏，对普通用户仍然是"这不是给我用的"。
 * ⇒ 不许退让的东西**没变**，变的是它的实现：
 *   · 「不是前置条件」→ 仍然由"地址是最后一栏 + 预填好 + 未配置也发得出请求"钉着；
 *   · 「降级不是删掉」→ 现在钉的是"**展开之后那条路完整可用**"（能敲地址、
 *     能点完成登录），而不是"节点必须一直挂在 DOM 上"。
 *     后者被前者取代，是因为 `aria-expanded` 的展开入口本身就是一条**可达**的路 ——
 *     键盘与读屏用户点的是那个按钮，与 `<details>` 的行为一致。
 *
 * ⚠️ 两条**没有**随写法消失的取向，仍然逐条钉着：**未配置也发得出请求**（把
 * `lib/auth-endpoint.ts` 的默认值拿掉，第 1 条立刻红 —— 空地址在 app-host 里
 * 是一个请求都不发 + `unconfigured`）；**降级不等于删掉**（把次要动作删掉也能让
 * "只有一个主按钮"变绿，所以每条降级都单独有一条"它必须还在"的断言）。
 *
 * 全程零联网：`fetch` 一律 stub。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, translate, type Locale, type MessageKey } from '@heyta/i18n';

import { AuthPanel } from '../src/features/auth/AuthPanel.js';
import { __resetAuthForTests, useAuthStore } from '../src/features/auth/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

const BASE_URL = 'https://sync.example.com';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let calls: { url: string; method: string }[];

function stubFetch(): void {
  calls = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: String(init?.method ?? 'GET') });
    return Promise.resolve({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ message: 'ok' }),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function renderPanelAtBaseUrl(
  baseUrl: string,
  locale: Locale = 'zh-CN',
): Promise<HTMLDivElement> {
  // 一条用例里会连开两三个面板（已配置 / 未配置 / 英文各一轮），先收掉上一个：
  // 光靠 afterEach 只能收最后一个，剩下的会挂在 document.body 上互相看不见，
  // 但 React 会为"同一棵树里多个 root"记警告，而警告会淹没真问题。
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale}>
        <AuthPanel baseUrl={baseUrl} onClose={() => undefined} />
      </I18nProvider>,
    );
    await Promise.resolve();
  });
  return container;
}

function byTestId(el: HTMLElement, testId: string): HTMLElement {
  const found = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  if (found === null) throw new Error(`没有找到元素：${testId}`);
  return found;
}

/** 共享表单的控件在 RNW 上落成 `data-testid`；寻址只走这一条路，不复制选择器。 */
async function tap(el: HTMLElement, testId: string): Promise<void> {
  await act(async () => {
    byTestId(el, testId).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function typeById(el: HTMLElement, testId: string, value: string): Promise<void> {
  const input = byTestId(el, testId) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('HTMLInputElement.value setter 不存在');
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

/**
 * 走到"注册档 + 已填好一切"的状态。
 *
 * ⚠️ 每一步都是**用户真要做的那一下**：邮箱 → 「继续」→ 切到创建账号 → 勾同意项 →
 * 填口令 → 提交。这里不许有"直接改 store 跳过表单"的捷径 —— 那等于用测试替界面
 * 撒谎，而这一组判据要钉的恰恰是"这条路真的走得通"。
 */
async function toRegisterAndSubmit(el: HTMLElement, email: string, password: string): Promise<void> {
  await typeById(el, 'auth-form-email', email);
  await tap(el, 'auth-form-continue');
  await tap(el, 'auth-form-switch-mode');
  await tap(el, 'auth-form-terms');
  await typeById(el, 'auth-form-password', password);
  await tap(el, 'auth-form-submit');
}

beforeEach(() => {
  stubFetch();
  __resetAuthForTests();
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
    password: undefined,
    status: { kind: 'idle' },
    syncSettingsRequested: false,
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe('墙一：注册不许依赖"你知道自己的同步域名吗"', () => {
  it('🔴 什么都没配置时走完注册，请求**真的发出去**，目标就是本机来源', async () => {
    const el = await renderPanelAtBaseUrl('');
    await toRegisterAndSubmit(el, 'me@example.com', 'correct horse battery');

    // 主路是邮箱 + 口令，不是"先发一封魔法链接"（那已经降级成二级链）。
    expect(calls.map((c) => c.url)).toContain(`${window.location.origin}/api/register/email-password`);
    // 而且**不是**以 `unconfigured` 收场 —— 那正是旧代码的形态。
    expect(useAuthStore.getState().status.kind).toBe('registered');
  });

  it('🔴 地址是**最后一栏**，不是第一栏（那句原话最直接的钉法）', async () => {
    const el = await renderPanelAtBaseUrl('');
    // 默认收起（2026-10-02 晚）：先展开，再判它在哪一栏 —— 顺序判据与折叠无关，
    // 但"它得先在场"才能量出顺序。收起本身由 `auth-entry-default.spec.tsx` 钉。
    await tap(el, 'auth-form-self-host-toggle');
    const inputs = [...el.querySelectorAll('input')] as HTMLInputElement[];
    const indexes = new Map(inputs.map((i, n) => [i.getAttribute('data-testid'), n]));

    const emailIndex = indexes.get('auth-form-email');
    const addressIndex = indexes.get('auth-form-server-url');
    expect(addressIndex, '未配置时要有自建部署的入口').toBeDefined();
    expect(emailIndex, '邮箱一栏必须存在').toBeDefined();
    // 只要有人把地址挪回邮箱上面，这一条就红 —— 与它长什么样、折叠与否都无关。
    expect(addressIndex!).toBeGreaterThan(emailIndex!);

    const address = byTestId(el, 'auth-form-server-url') as HTMLInputElement;
    // 预填与空框是两种产品：少了值，这一栏就重新变成"你先写出域名"。
    expect(address.value).toBe(window.location.origin);
    // 那句"不用你写"必须在：少了它，一个预填好的框读起来仍然是"这里要我核对域名"。
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.server.prefilled'));
  });

  it('已配置时**不给第二个地址来源**，但"这次会连到哪"仍然看得见', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);

    expect(el.querySelector('[data-testid="auth-form-server-url"]')).toBeNull();
    expect(el.textContent ?? '').toContain(
      translate('zh-CN', 'web.auth.server.at', { baseUrl: BASE_URL }),
    );
  });

  it('改过地址之后，注册就发往改后的那台（自建部署是一条真的走得通的路）', async () => {
    const el = await renderPanelAtBaseUrl('');
    // 自建这条路现在藏在展开之后 —— 但走通它的成本仍然只有"点开 + 敲字"。
    await tap(el, 'auth-form-self-host-toggle');
    await typeById(el, 'auth-form-server-url', `${BASE_URL}/`);
    await toRegisterAndSubmit(el, 'me@example.com', 'correct horse battery');

    // 尾斜杠被归一掉了：`https://x//api/...` 与 `https://x/api/...` 在网关与缓存那里是两个地址。
    expect(calls.map((c) => c.url)).toContain(`${BASE_URL}/api/register/email-password`);
  });
});

describe('墙二：六个并列按钮 → 一条主路', () => {
  it('第一步**只问一件事**：一个主按钮（「继续」），而这一屏没有口令栏', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);

    expect(el.querySelector('[data-testid="auth-form-continue"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="auth-form-password"]')).toBeNull();
    // 「一次只问一件事」的另一半：这一屏**没有提交入口** —— 口令那一档的按钮要过了「继续」才出现。
    // ⚠️ 这里刻意不数 `auth-form-verify`：那是"粘贴兜底"的按钮，它一直住在 DOM 里
    // （由另一条"降级不是藏起来"钉着），把它算进主路等于用判据假装它不存在。
    expect(el.querySelector('[data-testid="auth-form-submit"]')).toBeNull();
  });

  it('🔴 一个 affordance 同时管注册与登录：切档之后同意项才出现', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);
    await typeById(el, 'auth-form-email', 'me@example.com');
    await tap(el, 'auth-form-continue');

    // 默认档是登录（口令一填就能进）；注册是**同一张表**的另一档，不是第二个表单。
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'common.auth.form.signIn'));
    expect(el.querySelector('[data-testid="auth-form-terms"]')).toBeNull();

    await tap(el, 'auth-form-switch-mode');
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.register'));
    expect(el.querySelector('[data-testid="auth-form-terms"]')).not.toBeNull();
    // 登录档专属的「忘记密码」在注册档必须收回（否则同一屏挂两个找回入口）。
    expect(el.querySelector('[data-testid="auth-form-forgot"]')).toBeNull();
  });

  it('邮件登录链接、通行密钥、找回**降级但一条都不许掉**', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);
    await typeById(el, 'auth-form-email', 'me@example.com');
    await tap(el, 'auth-form-continue');

    // 三条都在，而且都在口令**之后**（autofill 成功率最高，专用 passkey 按钮反而没人发现）。
    const order = [...el.querySelectorAll('[data-testid]')].map((n) =>
      n.getAttribute('data-testid'),
    );
    for (const testId of ['auth-form-passkey', 'auth-form-magic-link', 'auth-form-recovery']) {
      expect(order, `${testId} 必须仍在 DOM 里`).toContain(testId);
    }
    expect(order.indexOf('auth-form-magic-link')).toBeGreaterThan(
      order.indexOf('auth-form-password'),
    );
    // 那一组的标题句在：没有它，三个文字链读起来像散落的链接。
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'common.auth.form.otherWays'));
  });

  it('粘贴兜底**展开之后完整可用**（降级不是删掉 —— 2026-10-02 晚改的判断标准）', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);

    // 原来这条钉的是"节点一直挂在 DOM 上"。产品负责人把两栏收进展开入口之后，
    // 那个写法已经不再是"没藏起来"的定义 —— 现在钉的是**能力还在**：
    // 输入框与「完成登录」在展开后都在，而且用的是界面上那一个入口，不是 store。
    expect(
      el.querySelector('[data-testid="auth-form-have-token-toggle"]'),
      '没有展开入口 = 这条路真的没了',
    ).not.toBeNull();
    await tap(el, 'auth-form-have-token-toggle');
    expect(el.querySelector('[data-testid="auth-form-paste"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="auth-form-verify"]')).not.toBeNull();
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.paste.label'));
  });

  it('没勾同意项时注册**不发出去**（同意是用户的动作，界面不许替他做）', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);
    await typeById(el, 'auth-form-email', 'me@example.com');
    await tap(el, 'auth-form-continue');
    await tap(el, 'auth-form-switch-mode');
    await typeById(el, 'auth-form-password', 'correct horse battery');
    await tap(el, 'auth-form-submit');

    expect(calls).toHaveLength(0);
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'common.auth.error.termsRequired'));
  });
});

describe('这一组句子两种语言都真的翻了', () => {
  const KEYS = [
    'common.auth.form.continue',
    'common.auth.form.switchToRegister',
    'common.auth.form.otherWays',
    'common.auth.signInPassword.label',
    'web.auth.server.prefilled',
    'web.auth.server.at',
  ] as const satisfies readonly MessageKey[];

  it('英文界面下不出现汉字，中文界面下不是英文漏过来', async () => {
    // 两半分开判："翻译存在"与"这一屏出现"是两件事。
    // `server.prefilled` 按设计只在未配置时出现，`otherWays` 与口令栏要过了「继续」才有。
    for (const key of KEYS) {
      expect(translate('en', key).length, `${key} 缺英文`).toBeGreaterThan(0);
      expect(translate('zh-CN', key).length, `${key} 缺中文`).toBeGreaterThan(0);
    }

    const en = await renderPanelAtBaseUrl(BASE_URL, 'en');
    const enText = en.textContent ?? '';
    expect(/[\u3400-\u4DBF\u4E00-\u9FFF]/.test(enText), `英文界面里有汉字：${enText}`).toBe(false);

    const zh = await renderPanelAtBaseUrl(BASE_URL, 'zh-CN');
    // 带参数的词条要**渲染后**再比：拿裸模板比等于永远不相等（`{baseUrl}` 不会自己消失）。
    expect(zh.textContent ?? '').toContain(translate('zh-CN', 'common.auth.form.continue'));
    expect(zh.textContent ?? '').toContain(
      translate('zh-CN', 'web.auth.server.at', { baseUrl: BASE_URL }),
    );

    const zhUnconfigured = await renderPanelAtBaseUrl('', 'zh-CN');
    expect(zhUnconfigured.textContent ?? '').toContain(
      translate('zh-CN', 'web.auth.server.prefilled'),
    );
  });
});
