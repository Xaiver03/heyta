/**
 * 续费面板的界面测试。
 *
 * 🔴 这里钉住的是**收钱路径上界面会说的三句假话**，而不是"渲染出来了没有"：
 *
 * 1. **界面不许声称付款成功。** 到账只有 webhook 知道，客户端读不到 ——
 *    所以下单成功后能出现的只有"这一单的金额 / 有效期 / 支付链接"。
 * 2. **金额只能是从服务端读回来的。** 断言的是**渲染出来的字符串等于响应里的
 *    `amountMinor`**，不是等于某个本地常量。
 * 3. **没配收款通道时不许给一个能点、点了没反应的按钮。** 服务端的 503
 *    必须原样落到一句人话上（`check:payment-entry` 管的是入口存在性，
 *    这一条管的是它失败时说真话）。
 *
 * 全程真实链路：真实 store + 真实 `startCheckout` + 被 stub 的 `fetch`。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, translate, type Locale } from '@heyta/i18n';
import { CHECKOUT_PATH, PRIVACY_CONSENT_KEY } from '@heyta/app-host';

import { RenewPanel } from '../src/features/subscription/RenewPanel.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { privacyConsent, privacyConsentActions } from '../src/features/privacy/consent-gate.js';

const CJK = /[一-鿿]/;

const ORDER_OK = {
  orderId: 11,
  outTradeNo: 'hy1x2x3',
  priceId: 'hosted-monthly',
  currency: 'CNY',
  originalAmountMinor: 500,
  discountMinor: 100,
  amountMinor: 400,
  expiresAt: 1_800_000_000_000,
  rejectedCoupons: [{ couponId: null, rawCode: 'NOPE', reason: 'NOT_FOUND', explanation: '这个码不存在' }],
  qrCode: 'weixin://wxpay/bizpayurl?pr=abc',
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function stubCheckout(responder: () => { status: number; body?: unknown }): void {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      status: responder().status,
      ok: responder().status >= 200 && responder().status < 300,
      json: () => Promise.resolve(responder().body),
    } as unknown as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
}

async function renderPanel(locale: Locale = 'zh-CN'): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale}>
        <RenewPanel />
      </I18nProvider>,
    );
  });
  return container;
}

/** 点「下单续费」并等 promise 落定。 */
async function clickPlace(el: HTMLElement): Promise<void> {
  const button = el.querySelector<HTMLButtonElement>('button[data-testid="renew-place-order"]');
  expect(button).not.toBeNull();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 把闸门清回「还没问过」，与磁盘断开 —— 起点必须确定（同 `inbox.spec.tsx`）。 */
function makeUndecided(): void {
  localStorage.removeItem(PRIVACY_CONSENT_KEY);
  privacyConsent.__resetSessionForTests();
}

beforeEach(() => {
  useSyncStore.setState({
    baseUrl: 'https://sync.example.com',
    token: 'token-123',
    syncSettingsRequested: false,
    signInOpen: false,
  });
  // 🔴 「同意联网」在这里是**前置条件**，不是被测对象（被测的是那一条，
  // 见下面 `describe('出境同意闸门')`）。真浏览器实测过一遍没有这道前置的后果：
  // 请求被 `consentFetch` 挡下，面板却显示"连不上服务端，这一单没有下成"。
  makeUndecided();
  privacyConsentActions.accept();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('下单成功', () => {
  it('显示的是服务端报回来的金额，且界面不假装已经收到钱', async () => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    const el = await renderPanel();
    await clickPlace(el);

    const text = el.textContent ?? '';
    // 🔴 金额来自响应体的 `amountMinor`（400 → 4.00），不是某个本地常量。
    expect(text).toContain('4.00 CNY');
    expect(text).toContain(translate('zh-CN', 'web.subscription.renew.payLinkLabel'));
    const input = el.querySelector<HTMLInputElement>('#renew-pay-url');
    expect(input?.value).toBe('weixin://wxpay/bizpayurl?pr=abc');

    // 界面**没有**任何"付款成功 / 已到账 / 已续费"的声称 —— 那要等 webhook。
    for (const forbidden of ['付款成功', '已到账', '支付成功', '已续费']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('🔴 发出去的请求体里一个金额字段都没有', async () => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    const el = await renderPanel();
    await clickPlace(el);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://sync.example.com${CHECKOUT_PATH}`);
    expect(JSON.parse(String(init.body))).toEqual({ priceId: 'hosted-monthly' });
  });

  describe('档位选择（¥5 / ¥12 两档）', () => {
    const pickTier = async (el: HTMLElement, id: 'hosted' | 'hostedAi'): Promise<void> => {
      const input = el.querySelector<HTMLInputElement>(`[data-testid="renew-tier-${id}"]`);
      expect(input, `档位控件 renew-tier-${id} 没渲染`).toBeTruthy();
      await act(async () => {
        input?.click();
      });
    };

    it('两档都渲染出来、默认选中 ¥5；标价与价格页同源，**成交金额只来自服务端**', async () => {
      stubCheckout(() => ({ status: 200, body: ORDER_OK }));
      const el = await renderPanel();
      const before = el.textContent ?? '';

      expect(el.querySelector('[data-testid="renew-tier-hosted"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="renew-tier-hostedAi"]')).toBeTruthy();
      expect((el.querySelector<HTMLInputElement>('[data-testid="renew-tier-hosted"]'))?.checked).toBe(true);

      /*
       * 🔴 这条判据在 2026-10-24 改过口径（原文是"这一屏不许出现任何价格字符串"）。
       *
       * 那一天产品负责人要"单独的订阅界面"，方案卡上必须能看见价 —— 一屏让人选档
       * 却不给价，等于让人猜。所以现在的规则是**两条**，比原来更细而不是更松：
       *   ① 卡上的**标价**只许来自落地页那几条被 `check:pricing` 钉住的词条
       *      （`landing.pricing.*.priceCny`）—— 不许在这里另写金额字面量；
       *   ② **这一单收多少**仍然只许来自服务端报价（下单前屏上没有任何成交金额）。
       *
       * 原来那条一刀切在改版之后会误报成"界面写死金额"，而真正要拦的是 ②。
       */
      expect(before).toContain(translate('zh-CN', 'landing.pricing.hosted.priceCny'));
      expect(before).toContain(translate('zh-CN', 'landing.pricing.hostedAi.priceCny'));
      // ② 下单**之前**没有任何成交金额（`amountMinor` 是 400，服务端才给）。
      expect(before).not.toContain('4.00');

      await act(async () => {
        await clickPlace(el);
      });
      expect(el.textContent ?? '').toContain('4.00 CNY');
    });

    it('🔴 选 ¥12 之后，发出去的确实是那一档；换档会把上一张单清掉', async () => {
      stubCheckout(() => ({ status: 200, body: ORDER_OK }));
      const el = await renderPanel();
      await clickPlace(el);
      expect(el.textContent ?? '').toContain('4.00 CNY');

      await pickTier(el, 'hostedAi');
      // 换档那一刻：旧单那张卡不能还挂着（它写的是**旧档**冻的金额）。
      expect(el.textContent ?? '').not.toContain('4.00 CNY');

      await act(async () => {
        await clickPlace(el);
      });
      const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({ priceId: 'hosted-ai-monthly' });
    });

    it('服务端按 ④′ 拒降档时，界面说的是"这一档不含你当前档的全部能力"', async () => {
      // 混进 `PRICE_NOT_EFFECTIVE`（"这一刻没有生效价格"）就是一句假话：
      // 用户明明付费有效，只是这一单会把权益判小。
      stubCheckout(() => ({
        status: 409,
        body: { code: 'PRICE_TIER_LOSES_GRANTS', message: 'PRICE_TIER_LOSES_GRANTS' },
      }));
      const el = await renderPanel();
      await clickPlace(el);

      const text = el.textContent ?? '';
      expect(text).toContain(translate('zh-CN', 'web.subscription.renew.fail.downgrade'));
      expect(text).not.toContain(translate('zh-CN', 'web.subscription.renew.fail.unknown'));
    });

    /**
     * 🔴 这一条是产品负责人 2026-10-24 实拍那块屏的回归判据。
     *
     * 现场：选了「官方托管 + 云端 AI」按下单，拿到一句「这一档现在还不能卖，服务端拒绝了
     * 这笔下单」，然后问"现在不应该接了中央支付吗？" —— 支付条款其实是好的，
     * 拒单的是另一道闸：这一档要交付**我们的云端 AI**，而这台实例没配托管上游
     * （服务端 `PRICE_NOT_SELLABLE` + `reason: MANAGED_AI_NOT_CONFIGURED`）。
     *
     * 而且同一台实例上 **¥5 那一档照卖**（服务端有对照判据）。所以界面的责任不止"说清原因"，
     * 还要**给一条真的能走的路**：一键换成不含云端 AI 的那一档。
     */
    it('🔴 云端 AI 那一档被拒 ⇒ 说清成因，并给一个真的能换过去的下单出口', async () => {
      stubCheckout(() => ({
        status: 409,
        body: {
          code: 'PRICE_NOT_SELLABLE',
          message: 'PRICE_NOT_SELLABLE',
          reason: 'MANAGED_AI_NOT_CONFIGURED',
        },
      }));
      const el = await renderPanel();
      await pickTier(el, 'hostedAi');
      await clickPlace(el);

      const text = el.textContent ?? '';
      expect(text, '成因没说出来').toContain(
        translate('zh-CN', 'web.subscription.renew.fail.managedAi'),
      );
      // 🔴 反向：不能退回那句含糊的"这一档现在还不能卖" —— 它盖住了两件事。
      expect(text).not.toContain(translate('zh-CN', 'web.subscription.renew.fail.sellable'));

      const switchButton = el.querySelector<HTMLButtonElement>(
        'button[data-testid="renew-switch-tier"]',
      );
      expect(switchButton, '说了原因却没有任何出路').not.toBeNull();
      await act(async () => {
        switchButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      // 换档之后：¥5 被选中，且旧的那条失败提示不能继续挂着（它讲的是另一档）。
      expect(el.querySelector<HTMLInputElement>('[data-testid="renew-tier-hosted"]')?.checked).toBe(
        true,
      );
      expect(el.querySelector('[data-testid="renew-switch-tier"]')).toBeNull();

      // 真的能下单：请求体是 ¥5 那一档，而不是原样再打一次 ¥12。
      stubCheckout(() => ({ status: 200, body: ORDER_OK }));
      await clickPlace(el);
      const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({ priceId: 'hosted-monthly' });
    });

    it('同一句含糊拒绝（没有原因码）时，界面不说"缺云端 AI" —— 不许替服务端猜', async () => {
      stubCheckout(() => ({
        status: 409,
        body: { code: 'PRICE_NOT_SELLABLE', message: 'PRICE_NOT_SELLABLE' },
      }));
      const el = await renderPanel();
      await pickTier(el, 'hostedAi');
      await clickPlace(el);

      const text = el.textContent ?? '';
      expect(text).toContain(translate('zh-CN', 'web.subscription.renew.fail.sellable'));
      expect(text).not.toContain(translate('zh-CN', 'web.subscription.renew.fail.managedAi'));
      // 没有原因码就没有"换一档"按钮：我们不知道换成哪一档是对的。
      expect(el.querySelector('[data-testid="renew-switch-tier"]')).toBeNull();
    });

    it('英文界面里档位说明不漏中文（词条两侧都有）', async () => {
      stubCheckout(() => ({ status: 200, body: ORDER_OK }));
      const el = await renderPanel('en');
      const text = el.textContent ?? '';
      expect(text).toContain(translate('en', 'landing.pricing.hosted.name'));
      expect(text).not.toMatch(CJK);
    });
  });

  it('🔴 券被拒时只显示"哪个码没生效"，服务端的中文解释一个字都不许漏进界面', async () => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    const el = await renderPanel('zh-CN');
    await clickPlace(el);
    // 用户敲的那个码要还原出来。
    expect(el.textContent ?? '').toContain('NOPE');

    // 服务端那句 `这个码不存在` 只有中文版本（`COUPON_REJECTION_EXPLANATION`）。
    // 把它搬到界面上，英文界面就会漏出一句中文 —— 所以两侧都**不许**出现它。
    for (const locale of ['zh-CN', 'en'] as const) {
      act(() => {
        root?.unmount();
      });
      container?.remove();
      stubCheckout(() => ({ status: 200, body: ORDER_OK }));
      const byLocale = await renderPanel(locale);
      await clickPlace(byLocale);
      expect(byLocale.textContent ?? '').not.toContain('这个码不存在');
    }
  });

  it('复制按钮只在剪贴板真的写成功时才说"已复制"', async () => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    const el = await renderPanel();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await clickPlace(el);
    const copy = el.querySelector<HTMLButtonElement>('button[data-testid="renew-copy"]');
    expect(copy?.textContent).toContain(translate('zh-CN', 'web.subscription.renew.copy'));
    await act(async () => {
      copy!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith('weixin://wxpay/bizpayurl?pr=abc');
    expect(copy?.textContent).toContain(translate('zh-CN', 'web.subscription.renew.copied'));
  });

  it('🔴 剪贴板写失败时**不许**改口说"已复制"（变异臂 C3：catch 里也 setCopied(true) 就打红这条）', async () => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    const el = await renderPanel();
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await clickPlace(el);
    const copy = el.querySelector<HTMLButtonElement>('button[data-testid="renew-copy"]');
    await act(async () => {
      copy!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(copy?.textContent).toContain(translate('zh-CN', 'web.subscription.renew.copy'));
    expect(copy?.textContent).not.toContain(translate('zh-CN', 'web.subscription.renew.copied'));
  });
});

describe('失败态说的是真话', () => {
  it('这台实例没配收款通道（503）→ 明说"现在买不了"', async () => {
    stubCheckout(() => ({ status: 503, body: { error: 'BILLING_PROVIDER_NOT_CONFIGURED' } }));
    const el = await renderPanel();
    await clickPlace(el);
    expect(el.querySelector('[data-testid="renew-failure"]')?.textContent).toBe(
      translate('zh-CN', 'web.subscription.renew.fail.provider'),
    );
    // 失败时不出现任何支付链接控件 —— 半截付款面板是最容易让人以为已经付过的形状。
    expect(el.querySelector('#renew-pay-url')).toBeNull();
  });

  it('🔴 没配服务器地址不发请求；未登录时只显示登录入口', async () => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    useSyncStore.setState({ baseUrl: '', token: 'token-123' });
    const unconfigured = await renderPanel();
    await clickPlace(unconfigured);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(unconfigured.querySelector('[data-testid="renew-failure"]')?.textContent).toBe(
      translate('zh-CN', 'web.subscription.renew.fail.unconfigured'),
    );

    act(() => {
      root?.unmount();
    });
    container?.remove();
    useSyncStore.setState({ baseUrl: 'https://sync.example.com', token: undefined });
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    const signedOut = await renderPanel();
    expect(signedOut.querySelector('[data-testid="renew-place-order"]')).toBeNull();
    expect(signedOut.querySelector('[data-testid="renew-needs-sign-in"]')).not.toBeNull();
    expect(signedOut.querySelector('[data-testid="renew-needs-sign-in-action"]')).not.toBeNull();
    await act(async () => {
      signedOut
        .querySelector<HTMLButtonElement>('[data-testid="renew-needs-sign-in-action"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSyncStore.getState().signInOpen).toBe(true);
  });

  it('断网说"没有下成"，而不是静默', async () => {
    fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    const el = await renderPanel();
    await clickPlace(el);
    expect(el.querySelector('[data-testid="renew-failure"]')?.textContent).toBe(
      translate('zh-CN', 'web.subscription.renew.fail.network'),
    );
  });
});

describe('两种语言', () => {
  it.each(['zh-CN', 'en'] as const)('面板里的每个词条都真的翻过了（%s）', async (locale) => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    const el = await renderPanel(locale);
    await clickPlace(el);
    const text = el.textContent ?? '';
    // 页标题（「托管同步续费」）已经没有了自己的 h2 —— 它现在住在「订阅」这一节里
    // （2026-10-24 独立成节），标题由设置壳的 `SettingsSectionHead` 给。
    // 这里改为断言**这一屏自己的**那些词条：档位名与那句计费说明。
    expect(text).toContain(translate(locale, 'landing.pricing.hosted.name'));
    expect(text).toContain(translate(locale, 'web.subscription.plans.hint'));
    if (locale === 'en') expect(CJK.test(text)).toBe(false);
    else expect(CJK.test(text)).toBe(true);
  });
});

/**
 * 🔴 这一组是**真浏览器**测出来的那个缺陷的钉子（AGENTS §6.2 规定一）：
 * e2e 里 `openApp` 默认选「只用本机」，点「下单续费」后一个请求都没出去，
 * 而屏上写的是「连不上服务端，这一单没有下成。」—— 那是**假话**：
 * 不是连不上，是我们自己按同意闸门拒发。jsdom 那一组当时全绿，因为它
 * 直接 stub 了 `fetch`，从来没走到闸门。
 */
describe('出境同意闸门：拒绝发出去的那一步不许伪装成"连不上"', () => {
  it('还没同意 → 零请求，且说的是"没有发任何请求"那句', async () => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    makeUndecided();
    const el = await renderPanel();
    await clickPlace(el);

    expect(fetchMock).not.toHaveBeenCalled();
    const text = el.textContent ?? '';
    expect(text).toContain(translate('zh-CN', 'common.privacy.consent.whyRequiredForAction'));
    // 🔴 反向判据：这一句必须**不**出现。它是那个缺陷的形状本身。
    expect(text).not.toContain(translate('zh-CN', 'web.subscription.renew.fail.network'));
    expect(el.querySelector('[data-testid="renew-failure"]')).toBeNull();
    expect(el.querySelector('#renew-pay-url')).toBeNull();
  });

  it('选了「只用本机」→ 同样零请求、同样不说"连不上"', async () => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    makeUndecided();
    privacyConsent.decide('local-only');
    const el = await renderPanel();
    await clickPlace(el);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="renew-failure"]')).toBeNull();
    expect(el.querySelector('[data-testid="renew-consent"]')).not.toBeNull();
  });

  it('同意之后，闸门不再拦：同一条路径真的把请求发出去', async () => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    // beforeEach 已经 accept 过 —— 这条是**阳性对照**：没有它，前两条
    // "零请求"可能只是"这条路径根本发不出请求"。
    const el = await renderPanel();
    await clickPlace(el);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="renew-consent"]')).toBeNull();
    expect(el.querySelector('[data-testid="renew-order"]')).not.toBeNull();
  });
});

/**
 * 🔴 这一组是**看过截图之后**补的（AGENTS §6.2 规定一：人必须打开那张图）。
 * `apps/web/evidence/renew-panel-order.png` 里中文界面排出的失效时刻是
 * `10/5/2026, 5:47:10 PM` —— 那是**操作系统**的语言，不是界面的语言。
 *
 * `check:ui-language` 抓不到它：它比的是词条，而这串是运行时生成的。
 * 上面那条「两种语言」的用例也抓不到：zh-CN 那一支只断言"文本里有中文"，
 * 日期是英文它照样绿。
 *
 * 所以判据不能写成"渲染出的字符串等于 `toLocaleString('zh-CN', …)`" ——
 * 那台把系统语言设成中文的机器上，**有 bug 的实现照样满足它**。
 * 要钉的是"界面语言被**传进去**了"这件事本身。
 */
describe('失效时刻跟着界面语言，不跟着操作系统', () => {
  it('🔴 每次 toLocaleString 都必须显式收到界面语言（裸调用 = 跟系统走）', async () => {
    stubCheckout(() => ({ status: 200, body: ORDER_OK }));
    const spy = vi.spyOn(Date.prototype, 'toLocaleString');
    const el = await renderPanel('zh-CN');
    await clickPlace(el);

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const [locales] of spy.mock.calls) {
      expect(locales).toBe('zh-CN');
    }
  });

  it('同一个时刻在两种语言下排出不同的串（两侧都真的走了本地化）', async () => {
    const rendered: Partial<Record<Locale, string>> = {};
    for (const locale of ['zh-CN', 'en'] as const) {
      stubCheckout(() => ({ status: 200, body: ORDER_OK }));
      const el = await renderPanel(locale);
      await clickPlace(el);
      rendered[locale] = el.textContent ?? '';
      act(() => {
        root?.unmount();
      });
      container?.remove();
      root = undefined;
      container = undefined;
    }
    const zh = rendered['zh-CN'] ?? '';
    const en = rendered.en ?? '';
    expect(zh).not.toBe(en);
    // 英文那一侧的上午/下午标记不许漏进中文界面；反向同理（中文侧没有 AM/PM）。
    expect(en).toMatch(/AM|PM/);
    expect(zh).not.toMatch(/AM|PM/);
  });
});
