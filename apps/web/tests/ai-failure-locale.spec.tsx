/**
 * 失败态的英文界面里没有中文字 —— 但**诊断原文**是数据，不是文案
 * ==================================================================
 *
 * ## 一、先量到的事实（不是推断）
 *
 * 这条通道此前**完全没有测试**：`ai-duration-basis-locale.spec.tsx` 钉的是
 * 四个面板的**披露态**，`ai-failure-settings-navigation.spec.tsx` 钉的是
 * 失败态的**按钮落点**，两个都不看英文失败态的文字。
 *
 * 实测（本文件第一版就是那个探针）英文 + `http-error` 时，面板渲染的是：
 *
 * ```
 * Could not break it down                      ← 词条，英文
 * The endpoint returned an error status. ...   ← 词条，英文
 *   Technical details                          ← 词条，英文
 *   端点「Cloud vendor」返回 500。              ← packages/ai 的原文，中文
 * ```
 *
 * 也就是说：**主文案是干净的，`<details>` 里那一句是中文**。
 *
 * ## 二、这是不是缺陷？（判据写在这里，免得下一个人再判一次）
 *
 * **不是。** 原始错误文本是**数据，不是文案**，本仓库已经有先例且写明了理由：
 * `features/shell/ErrorScreen.tsx` 把 `error.message`（`packages/storage` 抛的中文）
 * 降级进 `<details data-testid="error-details">`，并在文件头写着
 * 「**原始错误文本 —— 数据，不翻译。**」；`error-hint.ts` 更直接：
 * 那条「IndexedDB 升级被其它标签页阻塞」**无条件抛中文**，
 * "用英文界面的用户会在应用启动失败时读到一句中文"——
 * 处置是**按结构化原因给词条 + 把原文降级成技术详情**，不是把它藏掉。
 *
 * AI 这四条走的是同一形状：`outcome.cause`（结构化原因码）→ 词条，
 * `outcome.message`（原文）→ `<details>`。而且原文里**确实有词条给不了的信息**：
 * `http-error` 的**状态码与端点名**、`egress-not-authorized` 的**动态披露**
 * （要发哪些字段、保留多久）。把它删掉或只在中文下显示，是**信息倒退**。
 *
 * ## 三、所以这里钉的是**边界**，两侧都钉
 *
 *   - **文案侧**：把 `<details>` 整棵子树摘掉之后，英文面板**一个汉字都没有**；
 *   - **数据侧**：原文**只允许**出现在那个 `<details>` 里 ——
 *     一旦有人把它提回主文案，`ai-failure-message` 就会含汉字，本文件立刻红；
 *   - **对照**：同一场故障的**中文**面板，主文案必须有汉字 ——
 *     否则上面那条断言可能只是因为"根本没渲染出东西"而空过。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, type Locale } from '@heyta/i18n';
import type { AiRoutingConfig, EgressConsent, SecretStore } from '@heyta/ai';
import type { Task } from '@heyta/domain';

const { AiBreakdown } = await import('../src/features/ai/AiBreakdown.js');

/** 有没有汉字。**只查汉字**：标点符号在两种语言下都可能出现，不算"露中文"。 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

const EMPTY_SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

/** 已经授权过的远端出境 —— 用来让"已经在设置里配好、但端点自己出事"的 case 走得通。 */
const CONSENT: EgressConsent = {
  feature: 'breakdown',
  destination: 'user-endpoint',
  grantedAt: 1,
};

const REMOTE_ENDPOINT = {
  id: 'remote',
  label: 'Cloud vendor',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  capabilities: ['structured_output', 'long_context'] as const,
};

const ROUTING: AiRoutingConfig = {
  enabled: true,
  allowRemote: true,
  endpoints: [REMOTE_ENDPOINT],
  routes: { breakdown: [{ endpointId: 'remote' }] },
};

const TASK: Task = {
  id: 't1',
  title: 'Write the weekly report',
  note: 'Attach the numbers.',
  createdAt: 0,
  updatedAt: 0,
} as Task;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(
  locale: Locale,
  routing: AiRoutingConfig,
  fetchImpl: typeof fetch,
  consents: readonly EgressConsent[] = [],
): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale={locale}>
        <AiBreakdown
          task={TASK}
          routing={routing}
          consents={consents}
          secrets={EMPTY_SECRETS}
          onApplyNote={() => Promise.resolve()}
          fetchImpl={fetchImpl}
        />
      </I18nProvider>,
    );
  });
  return container;
}

/** 点进披露态，再按"发送"并等失败态落定。 */
async function sendAndFail(el: HTMLDivElement): Promise<void> {
  act(() => {
    el.querySelector<HTMLButtonElement>('[data-testid="ai-breakdown-t1"]')?.click();
  });
  await act(async () => {
    el.querySelector<HTMLButtonElement>('[data-testid="ai-send"]')?.click();
    await Promise.resolve();
  });
}

/** 未授权时请求根本不该发出去。 */
const unreachableFetch = (() => Promise.reject(new Error('不该被调用'))) as unknown as typeof fetch;
/** 端点报错：`packages/ai` 的原文里带着**状态码与端点名**（词条给不了）。 */
const serverErrorFetch = (() =>
  Promise.resolve(new Response('boom', { status: 500 }))) as unknown as typeof fetch;
/** 传输层失败：原文里带着底层错误。 */
const networkFetch = (() =>
  Promise.reject(new Error('connect ECONNREFUSED'))) as unknown as typeof fetch;

/**
 * 面板里**界面文案**那部分 —— 把 `<details>`（诊断原文）整棵子树摘掉。
 *
 * 用"整棵子树"而不是"那一行"：将来原文换成多行、或加了复制按钮，
 * 摘除仍然完整，断言不会因为排版变化而假绿。
 */
function copyOnly(el: HTMLDivElement): string {
  const panel = el.querySelector('[role="dialog"]');
  const details = el.querySelector('[data-testid="ai-failure-message-detail"]');
  const full = panel?.textContent ?? '';
  const raw = details?.textContent ?? '';
  return raw === '' ? full : full.split(raw).join('');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

/**
 * 四种"发出去会失败"的形态，各来自 `packages/ai` 的一条不同原文。
 *
 * `expectDetail` 是**这条原因该不该有诊断块**：
 *   - 动态披露 / 状态码 / 传输错误 → **该有**（词条给不了）；
 *   - `not-configured` → **不该有**（包给的原文就是一句界面话，词条说得更清楚）。
 */
const CASES: readonly {
  readonly name: string;
  readonly routing: AiRoutingConfig;
  readonly fetchImpl: typeof fetch;
  readonly consents: readonly EgressConsent[];
  readonly expectDetail: boolean;
}[] = [
  {
    name: 'egress-not-authorized（原文含动态披露）',
    routing: ROUTING,
    fetchImpl: unreachableFetch,
    consents: [],
    expectDetail: true,
  },
  {
    name: 'http-error（原文含状态码与端点名）',
    routing: ROUTING,
    fetchImpl: serverErrorFetch,
    consents: [CONSENT],
    expectDetail: true,
  },
  {
    name: 'network（原文含底层传输错误）',
    routing: ROUTING,
    fetchImpl: networkFetch,
    consents: [CONSENT],
    expectDetail: true,
  },
  {
    // 🔴 总开关关着 —— 最容易遇到的那个"AI 不能用"。
    //
    // ⚠️ 它**会**走到失败态：`resolveRoute()` 不看 `enabled`（只有
    // `invokeRouted()` 在第 1 道闸看），所以候选仍在 → 披露仍然显示 →
    // 按"发送"才拿到 `not-configured`。这与"没配路由"不同：
    // 后者候选为空，在披露之前就被 `RouteUnavailable` 拦下了。
    name: 'not-configured（总开关关着）',
    routing: { ...ROUTING, enabled: false },
    fetchImpl: unreachableFetch,
    consents: [],
    expectDetail: false,
  },
];

describe('🔴 英文失败态：界面文案里没有中文字', () => {
  for (const c of CASES) {
    it(`${c.name} → 摘掉 <details> 后一个汉字都没有`, async () => {
      const el = render('en', c.routing, c.fetchImpl, c.consents);
      await sendAndFail(el);

      expect(el.querySelector('[data-testid="ai-failed"]'), '应当进入失败态').toBeTruthy();
      const copy = copyOnly(el);
      expect(copy.length, '文案不该是空的（否则下面的断言会空过）').toBeGreaterThan(0);
      expect(CJK.test(copy), `英文文案里出现汉字：${copy}`).toBe(false);

      const detail = el.querySelector('[data-testid="ai-failure-message-detail"]');
      if (c.expectDetail) {
        expect(detail, `${c.name} 的原文里有词条给不了的信息，诊断块应当存在`).toBeTruthy();
      } else {
        // 🔴 包给的原文就是一句界面话（'AI 未启用。在设置里打开总开关…'），
        // 词条已经把它说完了 —— 再显示一遍在中文里是重复，
        // 在英文界面里**就是一句中文**。
        expect(detail, `${c.name} 的原文是纯重复，不该渲染诊断块`).toBeNull();
      }
    });
  }

  it('🔴 中文对照：同一场故障的主文案**必须有**汉字（证明上一条不是空过）', async () => {
    const el = render('zh-CN', ROUTING, serverErrorFetch, [CONSENT]);
    await sendAndFail(el);

    expect(el.querySelector('[data-testid="ai-failed"]')).toBeTruthy();
    expect(CJK.test(copyOnly(el))).toBe(true);
  });
});

describe('🔴 原文只允许出现在折叠的诊断块里（一旦提回主文案就红）', () => {
  it('主文案取自词条，且**不等于**原文', async () => {
    const el = render('en', ROUTING, serverErrorFetch, [CONSENT]);
    await sendAndFail(el);

    const primary = el.querySelector('[data-testid="ai-failure-message"]')?.textContent ?? '';
    const detail =
      el.querySelector('[data-testid="ai-failure-message-detail"]')?.textContent ?? '';

    expect(primary).not.toBe('');
    expect(detail).not.toBe('');
    // 原文里那半句（含状态码）**不许**出现在主文案里
    expect(primary).not.toBe(detail);
    expect(primary).not.toContain('500');
    expect(CJK.test(primary)).toBe(false);
  });

  it('诊断块是收起的 `<details>`（原文可以留，但不主动占视野）', async () => {
    const el = render('en', ROUTING, serverErrorFetch, [CONSENT]);
    await sendAndFail(el);

    const details = el.querySelector('[data-testid="ai-failure-message-detail"]');
    expect(details?.tagName.toLowerCase()).toBe('details');
    // 没有 `open` 属性 = 默认收起
    expect(details?.hasAttribute('open')).toBe(false);
  });
});
