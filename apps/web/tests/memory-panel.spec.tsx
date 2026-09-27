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

import {
  computeFocusGaps,
  preferenceEvidenceText,
  type FeedbackPreferenceSet,
  type FocusGap,
  type MemoryFocusSession,
  type MemoryOp,
  type MemoryTask,
  type Preference,
  type PreferenceEvidence,
  type PreferenceSet,
} from '@heyta/domain';
import { I18nProvider, type Locale } from '@heyta/i18n';

const { MemoryPanel } = await import('../src/features/settings/MemoryPanel.js');

/**
 * 造一条偏好。
 *
 * ⚠️ 第 14 轮起 `Preference` 多了一个**必需**的 `evidenceFacts`（结构化事实）——
 * 壳按它取自己的词条，不再渲染 `evidence`（那是领域层拼好的中文）。
 * 这里刻意**由事实投影出 `evidence`**，而不是手写一句：fixture 也就跟着
 * 变成真的了（手写的那句"依据"其实和真实句子的形状不一样）。
 */
const pref = <T,>(id: Preference<T>['id'], value: T, facts: PreferenceEvidence): Preference<T> => ({
  id,
  value,
  sampleSize: 20,
  confidence: 0.9,
  evidenceFacts: facts,
  evidence: preferenceEvidenceText(facts),
});

function prefs(over: Partial<PreferenceSet> = {}): PreferenceSet {
  return {
    memoryEnabled: true,
    estimateBias: pref('estimate-bias', 1.8, { kind: 'estimate-bias', multiplier: 1.8, samples: 30 }),
    deepWorkWindow: null,
    leadTime: null,
    granularity: pref('granularity', 6, { kind: 'granularity', items: 6, samples: 12 }),
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

function render(
  props: Partial<Parameters<typeof MemoryPanel>[0]> = {},
  locale?: Locale,
): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const panel = (
    <MemoryPanel
      memoryEnabled
      preferenceSet={prefs()}
      feedbackSet={feedback()}
      rawPresentIds={[]}
      corrections={[]}
      onSuppress={() => undefined}
      onRestore={() => undefined}
      {...props}
    />
  );
  act(() => {
    // ⚠️ 不传 locale 就**不套 Provider**：既有用例走默认语言（zh-CN），
    // 顺便证明"面板不依赖外面一定有 Provider"这条约定没有退化。
    root?.render(locale === undefined ? panel : <I18nProvider locale={locale}>{panel}</I18nProvider>);
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
      feedbackSet: feedback({
        keepRatio: pref('feedback-keep-ratio', 0.4, {
          kind: 'feedback-keep-ratio',
          ratio: 0.4,
          adopted: 5,
        }),
      }),
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
          { id: 'deep-work-window', reason: 'not-enough-samples', remaining: 5 },
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

/**
 * 🔴 墓碑（撤销过的纠正）不能让偏好继续被抑制。
 *
 * 这一组钉的是真实用户旅程测试抓到的 bug：面板曾经自己
 * `map(c => c.preferenceId)` 建抑制集合，**把墓碑也算进去**，
 * 而 App 里真正置空偏好用的是 `suppressedPreferenceIds()`（跳过墓碑）。
 * 两套规则 ⇒ 点了「恢复」之后，那条偏好会**同时出现在两个区里**，
 * 而且用户再也删不掉。
 */
describe('🔴 记忆面板：墓碑记录不算「已忘记」', () => {
  const tombstoned = [
    { id: 'c1', preferenceId: 'granularity', kind: 'suppress' as const, deletedAt: 1 },
  ];

  it('已撤销的纠正 → 不再出现在「你已忘记」', () => {
    const el = render({
      preferenceSet: prefs({
        granularity: pref('granularity', 6, { kind: 'granularity', items: 6, samples: 12 }),
      }),
      rawPresentIds: ['granularity'],
      corrections: tombstoned,
    });
    expect(
      el.querySelector('[data-testid="memory-forgotten"]'),
      '撤销之后不该还挂在「你已忘记」',
    ).toBeNull();
  });

  it('🔴 已撤销的纠正 → 偏好回到「我了解到的你」（不是两边都在）', () => {
    const el = render({
      preferenceSet: prefs({
        granularity: pref('granularity', 6, { kind: 'granularity', items: 6, samples: 12 }),
      }),
      rawPresentIds: ['granularity'],
      corrections: tombstoned,
    });
    expect(el.querySelector('[data-testid="memory-pref-granularity"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="memory-restore-granularity"]')).toBeNull();
  });

  it('墓碑与生效的纠正混在一起时，只有生效的那个被抑制', () => {
    const el = render({
      preferenceSet: prefs({ granularity: null }),
      rawPresentIds: ['granularity', 'estimate-bias'],
      corrections: [
        ...tombstoned,
        { id: 'c2', preferenceId: 'estimate-bias', kind: 'suppress' as const },
      ],
    });
    const forgotten = el.querySelector('[data-testid="memory-forgotten"]')?.textContent ?? '';
    expect(forgotten).toContain('估时偏差');
    expect(forgotten).not.toContain('任务拆解粒度');
  });
});

describe('🔴 记忆面板：忘掉的必须能恢复', () => {
  it('「你已忘记」列出被抑制的偏好，并给出恢复按钮', () => {
    const el = render({
      preferenceSet: prefs({ granularity: null }),
      rawPresentIds: ['granularity', 'estimate-bias'],
      corrections: [{ id: 'c1', preferenceId: 'granularity', kind: 'suppress' }],
    });
    expect(el.querySelector('[data-testid="memory-forgotten"]')?.textContent).toContain('任务拆解粒度');
    expect(el.querySelector('[data-testid="memory-restore-granularity"]')).not.toBeNull();
  });

  it('🔴 点恢复回传的是**纠正记录的 id**，不是偏好 id', () => {
    const restored: string[] = [];
    const el = render({
      preferenceSet: prefs({ granularity: null }),
      rawPresentIds: ['granularity'],
      corrections: [{ id: 'corr-xyz', preferenceId: 'granularity', kind: 'suppress' }],
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
      corrections: [{ id: 'c1', preferenceId: 'granularity', kind: 'suppress' }],
    });
    expect(el.querySelector('[data-testid="memory-pref-granularity"]')).toBeNull();
    expect(el.querySelector('[data-testid="memory-forgotten"]')).not.toBeNull();
  });
});

/**
 * 🔴 「说的 vs 做的」——把记忆护城河接到界面上
 * ==============================================
 *
 * `computeFocusGaps` 在本轮之前**零生产调用点**：算得准、测过、用户看不见。
 * 这一组钉住"真的接到了界面上"，以及两条不能重蹈的坑：
 *   - **英文界面不许露中文**（领域层 `describeFocusGaps()` 返回的正是中文句子）；
 *   - **记忆关闭时一行推断都不许留**。
 */
const gap = (over: Partial<FocusGap> = {}): FocusGap => ({
  taskId: 'task-1',
  title: 'Ship the quarterly report',
  declared: 4,
  focusMinutes: 0,
  gap: 4,
  overdueDays: 3,
  postponements: 2,
  ...over,
});

describe('说的 vs 做的：有落差就展示，且带结构化依据', () => {
  it('展示任务、声明的重要性、实际投入，以及推迟/逾期这两个"为什么"', () => {
    const el = render({ focusGaps: [gap()] });
    expect(el.querySelector('[data-testid="memory-gap-list"]')).not.toBeNull();
    const text = el.textContent ?? '';
    expect(text).toContain('Ship the quarterly report');
    expect(text).toContain('你声明的重要性：4');
    expect(text).toContain('实际专注：0 分钟');
    expect(el.querySelector('[data-testid="memory-gap-postponed-task-1"]')?.textContent).toContain(
      '推迟过 2 次',
    );
    expect(el.querySelector('[data-testid="memory-gap-overdue-task-1"]')?.textContent).toContain(
      '已逾期 3 天',
    );
  });

  it('推迟 1 次 / 逾期 1 天也渲染（中文单复数同形）', () => {
    const el = render({ focusGaps: [gap({ postponements: 1, overdueDays: 1 })] });
    expect(el.querySelector('[data-testid="memory-gap-postponed-task-1"]')?.textContent).toContain(
      '推迟过 1 次',
    );
    expect(el.querySelector('[data-testid="memory-gap-overdue-task-1"]')?.textContent).toContain(
      '已逾期 1 天',
    );
  });

  it('没有推迟/逾期时那两行不出现（不编一个 0 出来）', () => {
    const el = render({ focusGaps: [gap({ postponements: 0, overdueDays: null })] });
    expect(el.querySelector('[data-testid="memory-gap-postponed-task-1"]')).toBeNull();
    expect(el.querySelector('[data-testid="memory-gap-overdue-task-1"]')).toBeNull();
  });

  it('🔴 没有落差时给诚挚空状态，而不是留一个空白区块', () => {
    const el = render({ focusGaps: [] });
    expect(el.querySelector('[data-testid="memory-gap-empty"]')?.textContent).toContain(
      '没有发现明显的落差',
    );
    expect(el.querySelector('[data-testid="memory-gap-list"]')).toBeNull();
  });

  it('🔴 读不到事件流时如实说"算不出推迟次数"，不假装推迟 0 次', () => {
    const el = render({ focusGaps: null });
    expect(el.querySelector('[data-testid="memory-gap-unavailable"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="memory-gap-list"]')).toBeNull();
    expect(el.textContent ?? '').not.toContain('推迟过 0 次');
  });

  it('调用方没接这条线（undefined）时整个区块不渲染', () => {
    const el = render();
    expect(el.querySelector('[data-testid="memory-gap-list"]')).toBeNull();
    expect(el.querySelector('[data-testid="memory-gap-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="memory-gap-unavailable"]')).toBeNull();
  });
});

describe('🔴 说的 vs 做的：英文界面不出现一个中文字', () => {
  /**
   * 这条是本轮的**灵魂测试**。
   *
   * `memory.ts` 的 `describeFocusGaps()` 会把落差拼成一句中文。壳如果图省事
   * 直接渲染它，中文界面看起来完全正常 —— 只有切到英文才会露出来，
   * 而 `check-ui-language` 扫的是**字面量**，扫不到"渲染了变量的中文"。
   * 所以这条断言必须**真的以英文渲染 + 真的传入落差数据**。
   */
  it('🔴 英文 render 且带落差数据 → 面板文本不含任何 CJK 字符', () => {
    const el = render({ focusGaps: [gap()] }, 'en');
    const text = el.textContent ?? '';
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    // 顺带证明断言不是"没渲染出来"造成的假绿：
    expect(text).toContain('Said vs done');
    expect(text).toContain('Ship the quarterly report');
    expect(text).toContain('Importance you declared: 4');
    expect(text).toContain('Actual focus: 0 min');
  });

  it('英文的数量分支到单数兄弟词条（不说 `1 times` / `1 days`）', () => {
    const el = render({ focusGaps: [gap({ postponements: 1, overdueDays: 1 })] }, 'en');
    const text = el.textContent ?? '';
    expect(text).toContain('Postponed 1 time');
    expect(text).toContain('Overdue by 1 day');
    expect(text).not.toContain('1 times');
    expect(text).not.toContain('1 days');
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
  });
});

describe('🔴 记忆面板：关闭时连落差区也不渲染（隐私红线）', () => {
  it('memoryEnabled=false 且传入了落差数据 → 零条推断、零落差、无任务标题', () => {
    const el = render({ memoryEnabled: false, focusGaps: [gap()] });
    expect(el.querySelector('[data-testid="memory-off-note"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="memory-gap-list"]')).toBeNull();
    expect(el.querySelector('[data-testid="memory-gap-task-1"]')).toBeNull();
    expect(el.querySelector('[data-testid="memory-gap-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="memory-gap-unavailable"]')).toBeNull();
    expect(el.textContent ?? '').not.toContain('Ship the quarterly report');
  });
});

/**
 * ops → computeFocusGaps → 渲染。
 *
 * ⚠️ 覆盖范围要说清：这条覆盖了**后两段**（算法确实把 op 里的推迟数算出来、
 * 界面确实把那个数字渲染出来）。**第一段（真实 IndexedDB 读取
 * `readRecentOps()`）没有被这条覆盖** —— 那需要真 store；
 * 仓库里 `journey-ai-memory.integration.spec.tsx` 有真内存版 IndexedDB 的搭法，
 * 但它整文件跳过，且不在本模块的白名单里，因此没有改它。
 */
describe('🔴 推迟次数真的从事件流一路走到界面上', () => {
  const now = 1_700_000_000_000;
  const day = 86_400_000;

  it('ops → computeFocusGaps → 渲染：推迟次数出现在界面上', () => {
    const tasks: MemoryTask[] = [
      {
        id: 't-postponed',
        title: 'Write the design doc',
        priority: 2,
        important: true,
        dueDate: now + day,
        createdAt: now - 10 * day,
        updatedAt: now - day,
      },
    ];
    const focusSessions: MemoryFocusSession[] = [];
    const operations: MemoryOp[] = [
      {
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 't-postponed',
        payload: { title: 'Write the design doc' },
        timestamp: now - 9 * day,
      },
      // 第一次设截止：那是"排期"，不是"推迟" —— 不该被记成推过一次。
      {
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 't-postponed',
        payload: { dueDate: now - 2 * day },
        timestamp: now - 8 * day,
      },
      // 往后挪 → 这才是"推迟过一次"。
      {
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 't-postponed',
        payload: { dueDate: now + day },
        timestamp: now - day,
      },
    ];

    const gaps = computeFocusGaps({ tasks, focusSessions, operations, now });

    expect(gaps.map((g) => g.taskId)).toEqual(['t-postponed']);
    expect(gaps[0]?.postponements).toBe(1);

    const el = render({ focusGaps: gaps });
    expect(
      el.querySelector('[data-testid="memory-gap-postponed-t-postponed"]')?.textContent,
    ).toContain('推迟过 1 次');
  });
});
