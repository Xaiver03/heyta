/**
 * 习惯月历板（共享组件在 web 侧的渲染与接线，工单 H4）
 * ====================================================
 *
 * 这一族测的是**渲染出来的那一格**，不是格子怎么算（算法在
 * `packages/ui/tests/habit-month-model.spec.ts`，补打卡窗口的裁决在
 * `packages/domain/tests/habit-backfill.spec.ts`）。三层各钉一件事，
 * 少任何一层都会出现"某一层的坏没人看得见"。
 *
 * 🔴 本文件最值钱的三条：
 *   V2/V3 —— 按下去**带的是那一天**（不带日期的话，补打卡会记到今天，
 *            而界面上看起来完全成功：格子亮了、日志也写了，只是写错日子）。
 *   V4    —— 不可点的那几档**一条 op 都不发**（发了就是界面在说谎）。
 *   V10   —— 宿主那份 `labels` 六档都说得出话（少接一档会让读屏读到 `undefined`）。
 *
 * ⚠️ RNW 的 `Pressable` 渲染成 `<div role="button">`，所以一律用 `testID`
 *    （RNW → `data-testid`）寻址，不用标签名。
 * ⚠️ 本测试吃 `@heyta/ui` 的 **`dist/`**：改完共享层源码必须先 build，
 *    否则看到的是上一次构建的结果（§7 第 27 条）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Habit, HabitDayState, HabitLog, LocalDate } from '@heyta/domain';
import { I18nProvider, translate, type MessageKey, type MessageVars } from '@heyta/i18n';
import { HabitMonthBoard, HeytaUiProvider, type HabitMonthLabels } from '@heyta/ui';

import { habitMonthLabels } from '../src/features/habits/board-labels.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = resolve(HERE, '../src');

/** 剥掉注释：判据读的是**代码**。宿主文件里写着"不要做成 `renderMonthBoard` 插槽"
 *  这样的说明，不剥的话那条反向判据会因为解释本身而红。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 稳定的"今天"：2026-10-05（周一）。**不读 `Date.now()`**。 */
const TODAY: LocalDate = '2026-10-05';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: '读书',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const logOf = (date: LocalDate, over: Partial<HabitLog> = {}): HabitLog => ({
  id: `l-${date}`,
  habitId: 'h1',
  date,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

/**
 * 桩文案：**故意与词条表长得不一样**。
 * 判据读到的必须是桩的产出，否则"宿主没接上真 labels"会被桩掩盖。
 */
const LABELS: HabitMonthLabels = {
  grid: ({ name, month }) => `桩格:${name}|${month}`,
  weekdays: ['桩一', '桩二', '桩三', '桩四', '桩五', '桩六', '桩日'],
  monthTitle: (date) => `桩月:${date.slice(0, 7)}`,
  prevMonth: '桩上月',
  nextMonth: '桩下月',
  windowHint: (days) => `桩窗:${String(days)}`,
  day: ({ date, state }) => `桩格:${date}|${state}`,
  outOfMonth: ({ date }) => `桩邻:${date}`,
  cellTitle: ({ text }) => `桩题:${text}`,
};

class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
});

function render(node: ReactElement): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <HeytaUiProvider>{node}</HeytaUiProvider>
      </I18nProvider>,
    );
  });
  return container;
}

const cell = (el: HTMLElement, date: LocalDate): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-testid="habit-month-cell-${date}"]`);

function tap(el: HTMLElement, date: LocalDate): void {
  const node = cell(el, date);
  expect(node, `格子上找不到 ${date}`).not.toBeNull();
  act(() => {
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function mountBoard(props: {
  habit?: Habit;
  logs?: readonly HabitLog[];
  today?: LocalDate;
  busy?: boolean;
  onCheckIn?: (habitId: string, date: LocalDate) => void;
  onUndoCheckIn?: (habitId: string, date: LocalDate) => void;
  labels?: HabitMonthLabels;
}): HTMLElement {
  return render(
    <HabitMonthBoard
      habit={props.habit ?? habit()}
      logs={props.logs ?? []}
      today={props.today ?? TODAY}
      labels={props.labels ?? LABELS}
      onCheckIn={props.onCheckIn ?? (() => {})}
      onUndoCheckIn={props.onUndoCheckIn ?? (() => {})}
      busy={props.busy ?? false}
      testID="habit-month"
    />,
  );
}

describe('习惯月历板（web 渲染）', () => {
  it('V1 42 格都在 DOM 里，本月 31 格带日期、列头 7 个', () => {
    const el = mountBoard({});
    expect(el.querySelectorAll('[data-testid^="habit-month-cell-"]')).toHaveLength(42);
    const octDays = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    for (const d of octDays) expect(cell(el, d as LocalDate), `少了 ${d}`).not.toBeNull();
    // 列头来自桩：证明"宿主注入的那份"真的进了渲染，而不是组件里写死了一套。
    expect(el.textContent).toContain('桩一');
    expect(el.textContent).toContain('桩日');
  });

  it('V2 🔴 按可补的那天，`onCheckIn` 带的就是**那一天**', () => {
    const onCheckIn = vi.fn();
    const el = mountBoard({ onCheckIn });
    tap(el, '2026-10-04');
    expect(onCheckIn).toHaveBeenCalledTimes(1);
    expect(onCheckIn.mock.calls[0]).toEqual(['h1', '2026-10-04']);
  });

  it('V3 🔴 已打过的那格按下去是撤销，同样带那一天', () => {
    const onUndo = vi.fn();
    const onCheckIn = vi.fn();
    const el = mountBoard({
      logs: [logOf('2026-10-02')],
      onCheckIn,
      onUndoCheckIn: onUndo,
    });
    tap(el, '2026-10-02');
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo.mock.calls[0]).toEqual(['h1', '2026-10-02']);
    expect(onCheckIn).not.toHaveBeenCalled();
  });

  it('V4 🔴 不可点的四档一条 op 都不发（发了就是界面在说谎）', () => {
    const onCheckIn = vi.fn();
    const onUndo = vi.fn();
    const el = mountBoard({ habit: habit({ backfillDays: 2 }), onCheckIn, onUndoCheckIn: onUndo });
    tap(el, '2026-10-01'); // too-old
    tap(el, '2026-10-20'); // future
    tap(el, '2026-10-31'); // 本月但还没到
    const pads = el.querySelectorAll('[data-testid^="habit-month-cell-2026-09"]');
    expect(pads.length).toBeGreaterThan(0); // 阳性对照：这张历**确实**有补白格
    for (const pad of Array.from(pads)) {
      // 🔴 补白格说的是"邻月的日子"，**不是**状态词表那句。
      //    上一月视图里"今天"是一格尾随补白：按状态念它会说"今天还没打卡"，
      //    而它点不动 —— 那正是本仓库反复栽过的"点了没反应"那一族。
      expect(pad.getAttribute('aria-label') ?? '', '补白格没说出它为什么不在这个月').toContain(
        '桩邻',
      );
      expect(pad.getAttribute('aria-disabled')).toBe('true');
      act(() => {
        pad.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }
    expect(onCheckIn).not.toHaveBeenCalled();
    expect(onUndo).not.toHaveBeenCalled();

    /* 🔴 上面那半**没有**钉住"补白格"那一层：默认窗口只有 1~2 天，而九月底那几格
       本来就因为"超过窗口"点不动 —— 把 `inMonth` 那一层判据整个摘掉，上面的断言
       一条都不会红（臂台 `mutate-habit-month.mjs` 的 MA1 第一次就是这么活的，
       原话："这批判据对这份坏没有牙"）。
       所以这半把窗口开到 7 天，并拿**同一批日期**做两条对照腿：
         · 十月视图里它们是补白格 ⇒ 点不动；
         · 翻到上一月，它们就是**这个月的日子** ⇒ 同样这些格点得动。
       两腿一夹，"十月视图里点不动"的原因就只剩 `inMonth` 那一层，
       而不是任何日期算术（本文件不重算窗口，那是 `@heyta/domain` 的裁决）。 */
    const onCheckInB = vi.fn();
    const onUndoB = vi.fn();
    const wide = mountBoard({
      habit: habit({ backfillDays: 7 }),
      onCheckIn: onCheckInB,
      onUndoCheckIn: onUndoB,
    });
    const septPads = Array.from(
      wide.querySelectorAll<HTMLElement>('[data-testid^="habit-month-cell-2026-09"]'),
    );
    expect(septPads.length, '十月视图里没有九月的补白格').toBeGreaterThan(0);
    for (const pad of septPads) {
      const date = (pad.getAttribute('data-testid') ?? '').replace('habit-month-cell-', '');
      expect(pad.getAttribute('aria-label') ?? '', `${date} 没说自己是邻月`).toContain('桩邻');
      expect(pad.getAttribute('aria-disabled'), `${date} 在十月视图里可点`).toBe('true');
      act(() => {
        pad.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }
    expect(onCheckInB, '点了一格邻月的日子，等于往邻月写记录').not.toHaveBeenCalled();
    expect(onUndoB).not.toHaveBeenCalled();

    // 对照腿：翻到上一月，**同一批日期**变成这个月的日子。
    const prev = wide.querySelector<HTMLElement>('[data-testid="habit-month-prev"]');
    expect(prev, '上一月那颗不在').not.toBeNull();
    act(() => {
      prev?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const inTheirOwnMonth = septPads
      .map((pad) => (pad.getAttribute('data-testid') ?? '').replace('habit-month-cell-', '') as LocalDate)
      .filter((date) => cell(wide, date) !== null);
    expect(inTheirOwnMonth.length, '翻到上一月之后读不到那几天').toBeGreaterThan(0);
    let tapped = false;
    for (const date of inTheirOwnMonth) {
      const node = cell(wide, date);
      expect(node?.getAttribute('aria-label') ?? '', `${date} 在自己的月里还说自己是邻月`).toContain(
        '桩格:',
      );
      if ((node?.getAttribute('aria-disabled') ?? '') === 'true') continue; // 超窗的九月月初
      tap(wide, date);
      tapped = true;
      break;
    }
    expect(tapped, '九月视图里没有一个格子是可点的 ⇒ 这块板是死的').toBe(true);
    expect(onCheckInB, '同一批日期在自己的月里点不动 ⇒ 上面那条"点不动"不算证明').toHaveBeenCalled();
  });

  it('V5 不可点的格子读数说得出**为什么**（只画灰不说原因 = 用户以为应用坏了）', () => {
    const el = mountBoard({ habit: habit({ backfillDays: 2 }) });
    expect(cell(el, '2026-10-01')?.getAttribute('aria-label')).toContain('too-old');
    expect(cell(el, '2026-10-20')?.getAttribute('aria-label')).toContain('future');
    // 🔴 可点那一格**没有** `aria-disabled` 属性（RNW 只在 `disabled` 为真时落属性），
    //    所以判据写"不是 true"，不写"等于 false" —— 后者会因为属性缺席而红。
    expect(cell(el, '2026-10-01')?.getAttribute('aria-disabled')).toBe('true');
    expect(cell(el, '2026-10-04')?.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('V6 窗口提示那个数字来自领域层（默认 1，设了就是设的）', () => {
    expect(mountBoard({}).textContent).toContain('桩窗:1');
    const el2 = mountBoard({ habit: habit({ backfillDays: 7 }) });
    expect(el2.textContent).toContain('桩窗:7');
  });

  it('V7 busy 时整块板不发消息（连点不发第二条 op）', () => {
    const onCheckIn = vi.fn();
    const el = mountBoard({ busy: true, onCheckIn });
    tap(el, '2026-10-04');
    expect(onCheckIn).not.toHaveBeenCalled();
  });

  it('V8 不能翻到当前月之后；往前翻真的换了一整月', () => {
    const el = mountBoard({});
    const next = el.querySelector<HTMLElement>('[data-testid="habit-month-next"]');
    expect(next, '下个月那颗不在').not.toBeNull();
    expect(next!.getAttribute('aria-disabled')).toBe('true');
    act(() => {
      next?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el.textContent).toContain('桩月:2026-10'); // 没动

    const prev = el.querySelector<HTMLElement>('[data-testid="habit-month-prev"]');
    act(() => {
      prev?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el.textContent).toContain('桩月:2026-09');
    expect(el.querySelectorAll('[data-testid^="habit-month-cell-"]')).toHaveLength(42);
    // 九月的日子在十月是补白格 ⇒ 到了九月它们才是本月的格（这一格的存在挡住"翻月只换标题"）。
    expect(cell(el, '2026-09-28')).not.toBeNull();
  });

  it('V9 换一条习惯时游标回到当月（新习惯的"今天"必须一进来就在屏上）', () => {
    const el = mountBoard({});
    const prev = el.querySelector<HTMLElement>('[data-testid="habit-month-prev"]');
    act(() => {
      prev?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el.textContent).toContain('桩月:2026-09');

    // 同一棵组件树、换一个 habit id —— 走的是"游标跟着归位"那条分支。
    act(() => {
      root?.render(
        <I18nProvider locale="zh-CN">
          <HeytaUiProvider>
            <HabitMonthBoard
              habit={habit({ id: 'h2' })}
              logs={[]}
              today={TODAY}
              labels={LABELS}
              onCheckIn={() => {}}
              onUndoCheckIn={() => {}}
              testID="habit-month"
            />
          </HeytaUiProvider>
        </I18nProvider>,
      );
    });
    expect(el.textContent).toContain('桩月:2026-10');
  });

  it('V10 🔴 宿主那份 labels 六档都说得出话（少接一档读屏会读到 undefined）', () => {
    const t = (key: MessageKey, vars?: MessageVars): string => translate('zh-CN', key, vars);
    const labels = habitMonthLabels(t);
    const states: readonly HabitDayState[] = [
      'logged',
      'today',
      'backfillable',
      'not-scheduled',
      'future',
      'too-old',
    ];
    for (const state of states) {
      const text = labels.day({ date: TODAY, state });
      expect(text, `${state} 那一档说不出话`).toContain('10月5日');
      // 档位句子必须**含汉字**且不是 key 本身（词条缺失时某些实现会回吐 key）。
      expect(/[\u4e00-\u9fa5]/.test(text), `${state} 的句子是空的`).toBe(true);
      expect(text).not.toContain('web.habits.month');
    }
    // 列头 7 个、周一起头（`WEEKDAY_MESSAGE_KEYS` 的顺序就是月历的顺序）。
    expect(labels.weekdays).toHaveLength(7);
    expect(labels.windowHint(3)).toContain('3');
    // 补白格那一句也必须说得出话（它不是六档之一，界面上的第七种读数）。
    const edge = labels.outOfMonth({ date: '2026-09-28' });
    expect(edge).toContain('9月28日');
    expect(edge).toContain('邻月');
  });

  it('V11 🔴 接线的源码级腿：宿主把**那一天**透传给 store（不传就记到今天）', () => {
    /* 这一条钉的是 V2/V3 挡不住的那种坏：如果 `HabitDetailCard` 写成
       `store.checkIn(habitId)`（少一个参数），渲染层的桩回调仍然拿到日期、
       照样绿 —— 因为桩测的是组件，不是宿主。 */
    const src = stripComments(readFileSync(resolve(WEB_SRC, 'features/habits/HabitDetailCard.tsx'), 'utf8'));
    expect(src, '宿主没挂月历').toMatch(/<HabitMonthBoard\b/);
    expect(src, '打卡没带那一天').toMatch(/store\.checkIn\(habitId,\s*date\)/);
    expect(src, '撤销没带那一天').toMatch(/store\.undoCheckIn\(habitId,\s*date\)/);
    expect(src, '月历没接宿主的 labels').toMatch(/labels=\{monthLabels\}/);
    // 反向：不许有人把它做成 `HabitBoard` 的一条**可选插槽**（§7 第 195 条的形状）。
    expect(src).not.toMatch(/renderMonthBoard/);
  });
});
