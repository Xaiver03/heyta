/**
 * 订阅状态那枚 `?` 的正文**只许印一遍**（2026-11-09，J2 §1.2 第一类靶子）
 * ======================================================================
 *
 * 事故形状：`statusView()` 在 `restricted` 的两支里把 `hint` 设成
 * `web.subscription.status.localData`，而渲染处**无条件**再拼一句同一词条 ——
 * 于是那个气泡里「到期不会删任何数据：任务、清单和设置始终在这台设备上。」印两遍。
 *
 * 为什么值得一条专门的文件：这类重复**不会红了任何东西**。它不报错、不缺字、
 * 读起来甚至像在强调 —— 只有逐字数一遍才看得见。所以判据是**数次数**，不是看有没有。
 *
 * 判据能红：把 `statusView()` 里那两支的 `hint:` 加回 `localData` ⇒ 这条数到 2 ⇒ 红。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

/**
 * 把订阅 store 钉成"已到期"这一支。
 *
 * ⚠️ 只替换**读**的部分（`access` / `reading` / `checking`），`refresh` 给一个空函数：
 * 本文件验的是**文案**，不是探测链路（那条走 `subscription-downgrade.spec.ts` 的真链路）。
 */
vi.mock('../src/features/subscription/store.js', () => {
  const state = {
    access: { kind: 'restricted', expired: true, because: 'period-ended' },
    reading: { kind: 'denied', currentPeriodEnd: new Date(2026, 8, 25).getTime() },
    checking: false,
    refresh: () => undefined,
  };
  return {
    useSubscriptionStore: <T,>(selector: (s: typeof state) => T): T => selector(state),
  };
});

const { SubscriptionPanel } = await import('../src/features/subscription/SubscriptionPanel.js');

const LOCAL_DATA = '到期不会删任何数据';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

function renderPanel(): HTMLDivElement {
  root = createRoot(container!);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <SubscriptionPanel active />
      </I18nProvider>,
    );
  });
  return container!;
}

describe('订阅状态气泡：同一句话不许印两遍', () => {
  it('🔴 「到期不会删任何数据」在气泡正文里**恰好出现一次**', () => {
    const el = renderPanel();
    const tip = el.querySelector('[data-testid="tip-subscription-status"]');
    expect(tip).toBeTruthy();
    const text = tip?.textContent ?? '';
    const occurrences = text.split(LOCAL_DATA).length - 1;
    expect(occurrences).toBe(1);
  });

  it('🔴 这句仍然在（去重不许以删掉承诺为手段）', () => {
    const el = renderPanel();
    const text = el.querySelector('[data-testid="tip-subscription-status"]')?.textContent ?? '';
    expect(text).toContain(LOCAL_DATA);
  });
});
