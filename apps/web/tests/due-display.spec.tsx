/**
 * 截止时间的**说法**：分档、双语，以及"调用点真的用上了"
 * ========================================================
 *
 * 🔴 这个文件修的是一个**真 bug**，不是补测试。
 *
 * `packages/domain` 是纯函数层，依赖不了词条表（`packages/i18n` 是另一个包），
 * 所以它的 `formatRemaining()` / `formatRemainingUntil()` 返回的是**写死的中文
 * 句子**。中文界面看不出问题；切到英文，界面里直接冒出汉字：
 *
 *   - `DueBadge`        —— 任务行的截止徽标："还剩 3 天" / "明天"
 *   - `CaptureComposer` —— 捕获预览的日期芯片："2026-09-26（明天）"
 *
 * 这两处此前在注释里被登记成"已知、本轮不迁"。**登记不是修复** ——
 * 英文用户看到的一直是中文。现在措辞收进壳里（`lib/due-display.ts`），
 * 天数仍由领域层算。
 *
 * 本文件钉三件事，缺一不可：
 *   1. **分档与领域层逐日一致** —— 否则同一个任务在两个端上会说两句话，
 *      而用户会以为那是两个不同的状态（移动端真踩过）。
 *   2. **英文里没有汉字，且单复数分对了** —— `1 days overdue` 这种形状
 *      读起来仍然"通顺"，所以只有显式断住才有用。
 *   3. **调用点真的换了** —— 光有一个正确的 `remainingText()`、而组件还在
 *      调领域层的中文版，等于什么都没修。这一条靠真实渲染断言。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DAY_MS, formatRemaining, type Task } from '@heyta/domain';
import { I18nProvider, translate } from '@heyta/i18n';

/** 记录 addTask 收到的参数（与 `capture-composer.spec.tsx` 同一手法）。 */
const addTask = vi.fn(() => Promise.resolve());

// 只替换写入动作，UI 其余部分跑真实实现（含真实的 parseCapture 与 i18n）。
vi.mock('../src/features/tasks/store.js', () => ({
  useTaskStore: (selector: (s: { addTask: typeof addTask }) => unknown) =>
    selector({ addTask }),
}));

const { remainingText } = await import('../src/lib/due-display.js');
const { DueBadge } = await import('../src/features/tasks/DueBadge.js');
const { CaptureComposer } = await import('../src/features/capture/CaptureComposer.js');

const zh = translate.bind(null, 'zh-CN');
const en = translate.bind(null, 'en');

/** "界面里出现了汉字"。**这就是这个 bug 的判据**，不是某一句具体措辞。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** 固定一个正午的"现在"：跨零点与夏令时都不会把它挪到别的日子。 */
const NOON = new Date(2026, 8, 25, 12, 0, 0).getTime();

/** 只用到 4 个字段，其余走 `as Task`（与既有 web 测试同一约定）。 */
function taskWithDue(dueDate: number): Task {
  return { id: 't1', title: '写周报', createdAt: 0, updatedAt: 0, dueDate } as Task;
}

// ── 1. 分档：与领域层逐日对账 ─────────────────────────────────

describe('remainingText 的分档与 @heyta/domain 一致', () => {
  it('🔴 逐日比对 -5..8：中文说法必须与领域层逐字相同', () => {
    // 这是**反漂移**的核心断言。领域层改了自己的分档而这里没跟，
    // 或者这里自己发明了"几天算后天"，这一条立刻红。
    for (let d = -5; d <= 8; d += 1) {
      expect(remainingText(d, zh), `第 ${String(d)} 天`).toBe(formatRemaining(d));
    }
  });

  it('null 表示"没有截止时间"，给空串（UI 据此不渲染）', () => {
    expect(remainingText(null, zh)).toBe('');
    expect(remainingText(null, en)).toBe('');
  });

  it('覆盖到每一个档位（防止某条分支被删掉还全绿）', () => {
    expect(remainingText(-3, zh)).toBe('已逾期 3 天');
    expect(remainingText(-1, zh)).toBe('已逾期 1 天');
    expect(remainingText(0, zh)).toBe('今天');
    expect(remainingText(1, zh)).toBe('明天');
    expect(remainingText(2, zh)).toBe('后天');
    expect(remainingText(3, zh)).toBe('还剩 3 天');
  });
});

// ── 2. 双语：英文里不许有汉字，单复数要对 ──────────────────────

describe('英文说法', () => {
  it('🔴 -30..30 天里一个汉字都不许出现', () => {
    for (let d = -30; d <= 30; d += 1) {
      expect(remainingText(d, en), `第 ${String(d)} 天`).not.toMatch(CJK);
    }
  });

  it('档位措辞', () => {
    expect(remainingText(0, en)).toBe('Today');
    expect(remainingText(1, en)).toBe('Tomorrow');
    expect(remainingText(2, en)).toBe('Day after tomorrow');
    expect(remainingText(5, en)).toBe('5 days left');
    expect(remainingText(-3, en)).toBe('3 days overdue');
  });

  it('🔴 昨天到期说 `1 day overdue`，不是 `1 days overdue`', () => {
    // `remainingDays === -1` 是**可达的**（昨天到期）。没有单数兄弟词条，
    // 英文就会渲染成 `1 days overdue` —— 读起来仍然通顺，所以必须显式断住。
    expect(remainingText(-1, en)).toBe('1 day overdue');
    expect(remainingText(-1, en)).not.toContain('1 days');
  });

  it('中文的单数兄弟与复数版**刻意逐字相同**（不同才是漏翻）', () => {
    expect(zh('web.due.overdueOne', { days: 1 })).toBe(zh('web.due.overdue', { days: 1 }));
  });
});

// ── 3. 调用点真的换了（渲染级断言）────────────────────────────

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(node: React.ReactNode): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<I18nProvider locale="en">{node}</I18nProvider>);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  addTask.mockClear();
});

describe('DueBadge：英文界面里渲染的是英文', () => {
  it('🔴 明天到期显示 `Tomorrow`，不是 `明天`', () => {
    // 把 DueBadge 改回 `formatRemaining()` ⇒ 这里会拿到 '明天' ⇒ 汉字断言红。
    const el = render(<DueBadge task={taskWithDue(NOON + DAY_MS)} mode="countdown" now={NOON} />);
    expect(el.textContent).toBe('Tomorrow');
    expect(el.textContent).not.toMatch(CJK);
  });

  it('🔴 逾期 3 天显示 `3 days overdue`，不是 `已逾期 3 天`', () => {
    const el = render(
      <DueBadge task={taskWithDue(NOON - 3 * DAY_MS)} mode="countdown" now={NOON} />,
    );
    expect(el.textContent).toBe('3 days overdue');
    expect(el.textContent).not.toMatch(CJK);
  });

  it('`date` 呈现仍是绝对日期（语言中立，本来就没坏）', () => {
    const el = render(<DueBadge task={taskWithDue(NOON + DAY_MS)} mode="date" now={NOON} />);
    expect(el.textContent).toBe('09-26');
    expect(el.textContent).not.toMatch(CJK);
  });
});

describe('CaptureComposer：日期芯片里的剩余时间是当前语言', () => {
  it('🔴 输入中文「明天」，英文界面显示 `(Tomorrow)` 而不是 `（明天）`', () => {
    const el = render(<CaptureComposer />);
    const input = el.querySelector('input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '明天');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // ⚠️ M3 第八刀（capture）把芯片换成了共享 `@heyta/ui` 的 `CaptureComposer`，
    //    所以这里按 `testID` 寻址（RNW → `data-testid`），不再用旧的
    //    `.ht-capture__value` 类名 —— 类名随 DOM 实现一起删掉了。
    const value = el.querySelector('[data-testid="capture-chip-value"]');
    // 芯片里的"原样输入"是中文（那是用户自己打的字，本来就该原样显示）；
    // 但**解析结果**那半边必须是英文 —— 这里两者分得开，正是本测试要的。
    expect(value?.textContent).toMatch(/Tomorrow/);
    expect(value?.textContent).not.toMatch(CJK);
  });
});
