/**
 * 订阅提示的界面测试
 * ====================
 *
 * 这里钉住的是**产品边界里最容易被写成恐吓文案的地方**：
 *
 *   - 到期后提示**必须**说清楚"限制的只有托管同步这一件事"；
 *   - 提示里**不许**出现"数据将丢失 / 会被删除"这类**假的**催收措辞；
 *   - 未配置 / 自托管 / 断网时**什么都不许出现**（fail-open 的界面一侧）。
 *
 * 全程走真实链路：真实 store + 真实探测 + 被 stub 的 `fetch`。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, LOCALES, translate, type Locale, type MessageKey } from '@heyta/i18n';

import { SubscriptionNotice } from '../src/features/subscription/SubscriptionNotice.js';
import { siteLink } from '../src/lib/site-url.js';
/**
 * 这 7 条第 16 轮已收编进 `packages/i18n`（原来在 `subscription/copy.ts` 里）。
 * 这里保留一份 key 清单，是为了下面那条"每种语言都真的翻了"的断言 ——
 * 全局词条表整体由 `pnpm check:ui-language` 的规则 2/3/4 兜底，
 * 这条则钉住**用户真会看到的那 7 条**。
 */
const SUBSCRIPTION_MESSAGE_KEYS = [
  'web.subscription.notice.expired.title',
  'web.subscription.notice.expired.body',
  'web.subscription.notice.refused.title',
  'web.subscription.notice.refused.body',
  'web.subscription.notice.localData',
  'web.subscription.notice.selfHost',
  'web.subscription.notice.a11y',
] as const satisfies readonly MessageKey[];
import { __resetSubscriptionForTests } from '../src/features/subscription/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

/** 有没有汉字。用于"翻译真的翻了"这一类断言。 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

/** 让探测端点回一个指定响应。 */
function stubProbe(status: number, body?: unknown): void {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    } as unknown as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
}

/** 渲染并**等探测的 promise 落定**，否则断言会看到初始状态。 */
async function renderNotice(locale: Locale = 'zh-CN'): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale}>
        <SubscriptionNotice />
      </I18nProvider>,
    );
    await Promise.resolve();
  });
  return container;
}

beforeEach(() => {
  __resetSubscriptionForTests();
  useSyncStore.setState({
    baseUrl: 'https://sync.example.com',
    token: 'token-123',
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

describe('托管同步到期', () => {
  it('tells the user what is limited, without threatening the data', async () => {
    stubProbe(402, {
      errorCode: 'SUBSCRIPTION_REQUIRED',
      reason: 'PERIOD_ENDED',
    });
    const el = await renderNotice('zh-CN');
    const text = el.textContent ?? '';

    expect(text).toContain(translate('zh-CN', 'web.subscription.notice.expired.title'));
    // 限制的只有"托管同步"这一件事 —— 所有设备，不只是新设备。
    expect(text).toContain('托管同步');
    // 🔴 「免费额度」已废弃（边界文档 §1：需要同步的人恰恰是有 >=2 台设备的人，
    // 免费给 2 台等于把核心需求白送）。所以文案里**不许**再出现这个词 ——
    // 那会承诺一个服务端不提供、且我们已决定不给的东西。
    expect(text).not.toContain('免费额度');
    // 🔴 不许把范围说小：服务端的闸门拒绝的是整条托管同步，
    // 已接入的设备也会停止同步（边界文档 §2「只减不增」）。
    expect(text).not.toContain('只影响');
    // 明确说本地数据还在、还能用。
    expect(text).toContain(translate('zh-CN', 'web.subscription.notice.localData'));
    expect(text).toContain(translate('zh-CN', 'web.subscription.notice.selfHost'));

    // 🔴 恐吓式文案的机械防线：这些词一个都不许出现。
    for (const forbidden of ['丢失', '删除', '清空', '将被停用', '永久']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('never blocks or hides the rest of the app', async () => {
    stubProbe(402, { errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'PERIOD_ENDED' });
    const el = await renderNotice();
    // 提示是一个**说明**，不是一个挡路的对话框：没有 modal 语义。
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(el.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('routes the actionable step to the sync settings dialog', async () => {
    stubProbe(402, { errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'PERIOD_ENDED' });
    const el = await renderNotice();
    const button = el.querySelector('button');
    expect(button).not.toBeNull();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useSyncStore.getState().syncSettingsRequested).toBe(true);
  });

  /**
   * 🔴 「到期了」之后的下一步里，**必须**有一条能读到"现在能不能续、为什么"。
   *
   * 本组件开头写着"现在不存在可跳转的续费地址"，那句话到今天仍然成立。
   * 所以这里指向站点的价格页 —— 它如实写着"现在买不到、原因是什么"，
   * 而那正是到期用户接下来要问的那个问题。
   * 判据是"链接存在且指向 /pricing"，而不是"有续费按钮"：后者会被
   * `check:payment-entry` 直接判红（渠道未接通时不许有付款入口）。
   */
  it('🔴 到期提示能走到价格页 —— 但那是「说明」，不是续费入口', async () => {
    stubProbe(402, { errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'PERIOD_ENDED' });
    const el = await renderNotice();

    const link = el.querySelector<HTMLAnchorElement>(
      'a[data-testid="subscription-pricing-link"]',
    );
    expect(
      link,
      '到期提示里没有任何指向价格页的链接 —— 用户读完提示仍然不知道该去哪问"还能不能续"',
    ).not.toBeNull();
    // 站点地址来自产品站点事实源（本地 WebView / 开发服务器也不能把用户
    // 送回没有帮助中心的 localhost；自托管部署可用 VITE_SITE_URL 覆盖）。
    expect(link!.getAttribute('href')).toBe(siteLink('/pricing'));
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');

    // 反向判据：不许出现任何"点了没反应"的催收措辞。
    const text = el.textContent ?? '';
    for (const forbidden of ['立即续费', '立即购买', '去支付', '开通会员']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('uses a different, honest wording when the refusal is not an expiry', async () => {
    stubProbe(402, { errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'STATUS_NOT_ENTITLED' });
    const el = await renderNotice();
    const text = el.textContent ?? '';
    expect(text).toContain(translate('zh-CN', 'web.subscription.notice.refused.title'));
    expect(text).not.toContain('已到期');
  });
});

describe('fail-open 的界面一侧：不确定时什么都不显示', () => {
  it('shows nothing when the server is a normal self-hosted one (gate closed)', async () => {
    stubProbe(200, { latestSeq: 1 });
    const el = await renderNotice();
    expect(el.textContent).toBe('');
  });

  it('shows nothing when the network fails', async () => {
    fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    const el = await renderNotice();
    expect(el.textContent).toBe('');
  });

  it('shows nothing and sends no request when nothing is configured', async () => {
    useSyncStore.setState({ baseUrl: '', token: undefined });
    stubProbe(402, { errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'PERIOD_ENDED' });
    const el = await renderNotice();
    expect(el.textContent).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows nothing on an unexpected status', async () => {
    stubProbe(500);
    const el = await renderNotice();
    expect(el.textContent).toBe('');
  });
});

describe('两种语言都真的翻了', () => {
  it('renders English in the English UI, with no Chinese leaking through', async () => {
    stubProbe(402, { errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'PERIOD_ENDED' });
    const el = await renderNotice('en');
    const text = el.textContent ?? '';
    expect(text).toContain(translate('en', 'web.subscription.notice.expired.title'));
    expect(CJK.test(text)).toBe(false);
  });

  it('renders Chinese in the Chinese UI', async () => {
    stubProbe(402, { errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'PERIOD_ENDED' });
    const el = await renderNotice('zh-CN');
    expect(CJK.test(el.textContent ?? '')).toBe(true);
  });

  /**
   * 本地词条表的**逐条**检查。
   *
   * 它补的是「本地词条表不在 `packages/i18n` 里」这个缺口：
   * 全局词条表有 `pnpm check:ui-language` 的规则 2/3/4 兜底，
   * 而这份本地表没有 —— 所以这里自己把同三条规则跑一遍。
   */
  it.each(LOCALES)('every local message is non-empty and in the right language (%s)', (locale) => {
    for (const key of SUBSCRIPTION_MESSAGE_KEYS) {
      const text = translate(locale, key);
      expect(text.length).toBeGreaterThan(0);
      if (locale === 'zh-CN') {
        expect(CJK.test(text)).toBe(true);
      } else {
        expect(CJK.test(text)).toBe(false);
      }
    }
  });
});
