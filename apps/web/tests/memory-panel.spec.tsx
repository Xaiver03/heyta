/**
 * 记忆面板
 * ==========
 *
 * 🔴 这个文件守的是 M6 的验收判据：**用户能在界面上看到并改**。
 *
 * 在此之前，偏好层与事实层一样是"零调用方"——
 * `preferences.ts` 算得再准，用户在界面上也看不到任何东西，
 * 于是"推断会错、但可以纠正"这个前提根本不成立。
 *
 * 三条最该守的：
 *   1. **开关关闭时不展示任何推断**（关闭必须是真的关闭）
 *   2. **依据原文要显示**（只给结论，用户没法判断对不对）
 *   3. **"你已忘记"必须能恢复**（一次误点不能是永久的）
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FeedbackPreferenceSet, Preference, PreferenceSet } from '@heyta/domain';

const { MemoryPanel } = await import('../src/features/settings/MemoryPanel.js');

const pref = <T,>(id: Preference<T>['id'], value: T, evidence: string): Preference<T> => ({
  id,
  value,
  sampleSize: 20,
  confidence: 0.9,
  evidence,
});

function prefs(over: Partial<PreferenceSet> = {}): PreferenceSet {
  return {
    memoryEnabled: true,
    estimateBias: pref('estimate-bias', 1.8, '基于 30 次专注，你倾向低估任务耗时'),
    deepWorkWindow: null,
    leadTime: null,
    granularity: pref('granularity', 6, '你的 12 条带清单任务，中位数是 6 项'),
    titleStyle: null,
    withheld: [],
    ...over,
  };
}

function feedback(over: Partial<FeedbackPreferenceSet> = {}): FeedbackPreferenceSet {
  return {
    memoryEnabled: true,
    feedbackGranularity: null,
    keepRatio: null,
    withheld: [],
    ...over,
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(props: Partial<Parameters<typeof MemoryPanel>[0]> = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryPanel
        memoryEnabled
        preferenceSet={prefs()}
        feedbackSet={feedback()}
        rawPresentIds={[]}
        corrections={[]}
        onSuppress={() => undefined}
        onRestore={() => undefined}
        {...props}
      />,
    );
  });
  return container;
}

function click(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLElement | null)?.click();
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

beforeEach(() => {
  localStorage.clear();
});

describe('记忆面板：能看见', () => {
  it('🔴 显示推断出的偏好，并且**带上依据原文**（不只给结论）', () => {
    const el = render();
    expect(el.querySelector('[data-testid="memory-pref-granularity"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="memory-evidence-granularity"]')?.textContent).toContain(
      '中位数是 6 项',
    );
  });

  it('偏好的名字是中文，不是内部标识', () => {
    const el = render();
    const text = el.textContent ?? '';
    expect(text).toContain('任务拆解粒度');
    expect(text).not.toContain('granularity');
  });

  it('没算出来的偏好不出现', () => {
    const el = render();
    expect(el.querySelector('[data-testid="memory-pref-lead-time"]')).toBeNull();
  });

  it('反馈层的偏好也能显示', () => {
    const el = render({
      feedbackSet: feedback({ keepRatio: pref('feedback-keep-ratio', 0.4, '你通常留下约 40%') }),
      rawPresentIds: ['feedback-keep-ratio'],
    });
    expect(el.querySelector('[data-testid="memory-pref-feedback-keep-ratio"]')).not.toBeNull();
    expect(el.textContent ?? '').toContain('建议保留比例');
  });
});

describe('🔴 记忆面板：开关关闭时什么都不展示', () => {
  it('关闭 → 只说明已关闭，不出现任何偏好条目', () => {
    const el = render({ memoryEnabled: false });
    expect(el.querySelector('[data-testid="memory-off-note"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="memory-known"]')).toBeNull();
    expect(el.querySelector('[data-testid="memory-pref-granularity"]')).toBeNull();
    expect(el.textContent ?? '').not.toContain('中位数是 6 项');
  });

  it('🔴 关闭时即使数据里有偏好，也不展示（不能只靠调用方传空集）', () => {
    const el = render({ memoryEnabled: false, preferenceSet: prefs() });
    expect(el.textContent ?? '').not.toContain('倾向低估');
  });
});

describe('记忆面板：还不了解要如实说', () => {
  it('显示 withheld 的具体原因（不编一个平均值顶上）', () => {
    const el = render({
      preferenceSet: prefs({
        deepWorkWindow: null,
        withheld: [
          { id: 'deep-work-window', reason: 'not-enough-samples', detail: '还需要 5 次专注' },
        ],
      }),
    });
    expect(el.querySelector('[data-testid="memory-withheld"]')?.textContent).toContain('还需要 5 次专注');
  });

  it('一条都没算出来时给出诚实文案，而不是空白', () => {
    const el = render({
      preferenceSet: { ...prefs(), estimateBias: null, granularity: null },
      feedbackSet: feedback(),
    });
    expect(el.querySelector('[data-testid="memory-nothing-known"]')?.textContent).toContain('还不太了解你');
  });
});

describe('🔴 记忆面板：可以改', () => {
  it('点「忘掉」→ 回传正确的偏好 id', () => {
    const seen: string[] = [];
    const el = render({ onSuppress: (id) => seen.push(id) });
    click(el.querySelector('[data-testid="memory-forget-granularity"]'));
    expect(seen).toEqual(['granularity']);
  });

  it('每条偏好都有自己的忘掉按钮', () => {
    const seen: string[] = [];
    const el = render({ onSuppress: (id) => seen.push(id) });
    click(el.querySelector('[data-testid="memory-forget-estimate-bias"]'));
    expect(seen).toEqual(['estimate-bias']);
  });
});

describe('🔴 记忆面板：忘掉的必须能恢复', () => {
  it('「你已忘记」列出被抑制的偏好，并给出恢复按钮', () => {
    const el = render({
      preferenceSet: prefs({ granularity: null }),
      rawPresentIds: ['granularity', 'estimate-bias'],
      corrections: [{ id: 'c1', preferenceId: 'granularity' }],
    });
    expect(el.querySelector('[data-testid="memory-forgotten"]')?.textContent).toContain('任务拆解粒度');
    expect(el.querySelector('[data-testid="memory-restore-granularity"]')).not.toBeNull();
  });

  it('🔴 点恢复回传的是**纠正记录的 id**，不是偏好 id', () => {
    const restored: string[] = [];
    const el = render({
      preferenceSet: prefs({ granularity: null }),
      rawPresentIds: ['granularity'],
      corrections: [{ id: 'corr-xyz', preferenceId: 'granularity' }],
      onRestore: (id) => restored.push(id),
    });
    click(el.querySelector('[data-testid="memory-restore-granularity"]'));
    expect(restored).toEqual(['corr-xyz']);
  });

  it('没有被抑制的偏好时不显示这一区', () => {
    const el = render();
    expect(el.querySelector('[data-testid="memory-forgotten"]')).toBeNull();
  });

  it('🔴 被抑制的偏好不再出现在「我了解到的你」里', () => {
    const el = render({
      preferenceSet: prefs({ granularity: null }),
      rawPresentIds: ['granularity'],
      corrections: [{ id: 'c1', preferenceId: 'granularity' }],
    });
    expect(el.querySelector('[data-testid="memory-pref-granularity"]')).toBeNull();
    expect(el.querySelector('[data-testid="memory-forgotten"]')).not.toBeNull();
  });
});
