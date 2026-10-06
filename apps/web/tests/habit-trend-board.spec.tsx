/**
 * 「月 ⇄ 年」容器的判据（工单 H7，web 渲染）
 * ========================================
 *
 * 这一族量的是**游标与档位**，不是格子怎么画（那是 V 组与 U 组的事）。
 *
 *   Z1 —— 两档恰好两个目的地，档位名来自共享层那一张表
 *   Z2 🔴 点一张年卡 = 换档 + 翻到那一月，**一次做完**
 *   Z3 🔴 游标只有一枚：翻月之后切到年，年读的是同一枚
 *   Z4 换一条习惯 ⇒ 游标与档位都归位（从 V9 搬来，跟着游标一起搬）
 *   Z5 未来那几个月不可点，而"下一年"不许越过当前年
 *   Z6 busy 时两档都不发消息
 *   Z7 🔴 卡上那三个数**来自领域层**（板子里不许有第二个算式）
 *
 * ⚠️ 本测试吃 `@heyta/ui` 的 **`dist/`**：改完共享层源码必须先 build（§7 第 27 条）。
 */

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Habit, HabitDayState, HabitLog, LocalDate } from '@heyta/domain';
import { I18nProvider } from '@heyta/i18n';
import {
  HabitTrendBoard,
  HeytaUiProvider,
  type HabitMonthLabels,
  type HabitTrendLabels,
  type HabitYearLabels,
} from '@heyta/ui';

const TODAY: LocalDate = '2026-10-05';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: '读书',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const logOf = (date: LocalDate): HabitLog => ({
  id: `l-${date}`,
  habitId: 'h1',
  date,
  createdAt: 1,
  updatedAt: 1,
});

/** 桩文案：判据读到的必须是桩的产出（与 V 组同一条约定）。 */
const MONTH: HabitMonthLabels = {
  grid: ({ name, month }) => `桩格:${name}|${month}`,
  weekdays: ['桩一', '桩二', '桩三', '桩四', '桩五', '桩六', '桩日'],
  monthTitle: (date) => `桩月:${date.slice(0, 7)}`,
  prevMonth: '桩上月',
  nextMonth: '桩下月',
  windowHint: (days) => `桩窗:${String(days)}`,
  day: ({ date, state }: { date: LocalDate; state: HabitDayState }) => `桩格:${date}|${state}`,
  outOfMonth: ({ date }) => `桩邻:${date}`,
};

const YEAR: HabitYearLabels = {
  grid: ({ name, year }) => `桩年格:${name}|${year}`,
  yearTitle: (year) => `桩年:${String(year)}`,
  monthName: (monthKey) => `桩名:${monthKey}`,
  achieved: (days) => `桩达:${String(days)}`,
  rate: (percent) => `桩率:${String(percent)}`,
  noDenominator: '桩无',
  future: '桩未到',
  card: ({ monthName, achievedDays, rateText }) => `桩卡:${monthName}|${achievedDays}|${rateText}`,
  prevYear: '桩上年',
  nextYear: '桩下年',
  summary: ({ achievedDays, rateText }) => `桩总:${achievedDays}|${rateText}`,
};

const LABELS: HabitTrendLabels = {
  tabs: {
    group: '桩组',
    name: (kind) => `桩档:${kind}`,
  },
  month: MONTH,
  year: YEAR,
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

/** 一次挂载的全部入参 —— 抽出来是为了能**同一棵树**只换 `habit`（见 Z4 那条注释）。 */
interface MountProps {
  habit?: Habit;
  logs?: readonly HabitLog[];
  today?: LocalDate;
  busy?: boolean;
  onCheckIn?: (habitId: string, date: LocalDate) => void;
  onUndoCheckIn?: (habitId: string, date: LocalDate) => void;
}

function tree(props: MountProps): ReactElement {
  return (
    <I18nProvider locale="zh-CN">
      <HeytaUiProvider>
        <HabitTrendBoard
          habit={props.habit ?? habit()}
          logs={props.logs ?? []}
          today={props.today ?? TODAY}
          labels={LABELS}
          onCheckIn={props.onCheckIn ?? (() => {})}
          onUndoCheckIn={props.onUndoCheckIn ?? (() => {})}
          busy={props.busy ?? false}
          testID="habit-trend"
        />
      </HeytaUiProvider>
    </I18nProvider>
  );
}

function mount(props: MountProps = {}): HTMLElement {
  const el = document.createElement('div');
  container = el;
  document.body.append(el);
  root = createRoot(el);
  act(() => {
    root?.render(tree(props));
  });
  return el;
}

/**
 * 在**同一棵树**上换一条习惯。
 *
 * 🔴 必须有这个：Z4 要验的是"游标与档位跟着归位"那条分支，而重新挂一棵新树
 * 天然就是初始态 —— 用新树去验归位，判据会因为"根本没走那条分支"而**永远绿**。
 */
function rerender(props: MountProps): void {
  act(() => {
    root?.render(tree(props));
  });
}

const click = (node: Element | null | undefined): void => {
  expect(node, '要点的那颗不在').not.toBeNull();
  act(() => {
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const tab = (el: HTMLElement, kind: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-testid="habit-trend-tabs-${kind}"]`);
const yearCard = (el: HTMLElement, monthKey: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-testid="habit-trend-year-month-${monthKey}"]`);

describe('习惯「月 ⇄ 年」容器', () => {
  it('Z1 两档恰好两个目的地，且默认落在月那一档', () => {
    const el = mount();
    expect(el.querySelector('[data-testid="habit-trend-tabs-month"]'), '少了月档').not.toBeNull();
    expect(el.querySelector('[data-testid="habit-trend-tabs-year"]'), '少了年档').not.toBeNull();
    // 🔴 第三档不许凭空出现（它切的东西得先存在）。
    expect(el.querySelector('[data-testid="habit-trend-tabs-week"]'), '多了一档没实现的目的地')
      .toBeNull();
    expect(el.querySelector('[data-testid="habit-trend-tabs-day"]')).toBeNull();
    expect(el.textContent).toContain('桩月:2026-10');
    expect(el.textContent).not.toContain('桩年:');
  });

  it('Z2 🔴 点一张年卡 = 换档 + 翻到那一月，一次做完', () => {
    const el = mount();
    click(tab(el, 'year'));
    expect(el.textContent, '切到年档而月那一档还在画').toContain('桩年:2026');
    click(yearCard(el, '2026-03'));
    // 两件事必须同时成立：档位回到月，而游标是三月。
    expect(el.textContent).toContain('桩月:2026-03');
    expect(el.textContent, '换档没生效 ⇒ 点年卡只翻了游标').not.toContain('桩年:');
    // 阳性对照：这一月真的画了 42 格，而不是"标题换了格子没换"。
    expect(el.querySelectorAll('[data-testid^="habit-trend-month-cell-"]')).toHaveLength(42);
  });

  it('Z3 🔴 游标只有一枚：翻月之后切到年，年读的是同一枚', () => {
    const el = mount();
    click(el.querySelector('[data-testid="habit-trend-month-prev"]'));
    expect(el.textContent).toContain('桩月:2026-09');
    click(tab(el, 'year'));
    // 2026-09 与 2026-10 同一年，所以这里换一档**不该**看到年份跳走；
    // 真正的牙在下一段：翻到 2025 年再看，标题必须是 2025。
    expect(el.textContent).toContain('桩年:2026');
    click(el.querySelector('[data-testid="habit-trend-year-prev"]'));
    expect(el.textContent).toContain('桩年:2025');
    click(tab(el, 'month'));
    expect(el.textContent, '两档各持一枚游标 ⇒ 年停在 2025 而月还在 2026').toContain(
      '桩月:2025',
    );
  });

  it('Z4 换一条习惯时游标与档位都归位（新习惯的"今天"必须一进来就在屏上）', () => {
    const el = mount();
    click(tab(el, 'year'));
    click(el.querySelector('[data-testid="habit-trend-year-prev"]'));
    expect(el.textContent).toContain('桩年:2025');
    // 同一棵树换一个 habit id：走的是"归位"那条分支（重新挂一棵树会天然落在初始态，
    // 那样这条判据就没走到被测代码）。
    rerender({ habit: habit({ id: 'h2' }) });
    expect(el.textContent, '换习惯后还停在年档').not.toContain('桩年:');
    expect(el.textContent, '换习惯后游标没回到当月').toContain('桩月:2026-10');
  });

  it('Z5 未来那几个月不可点，而"下一年"不许越过当前年', () => {
    const el = mount();
    click(tab(el, 'year'));
    const next = el.querySelector<HTMLElement>('[data-testid="habit-trend-year-next"]');
    expect(next?.getAttribute('aria-disabled'), '当前年之后还能翻 ⇒ 一张空历等人预支').toBe('true');
    for (const key of ['2026-11', '2026-12']) {
      const card = yearCard(el, key);
      expect(card, `少了 ${key} 那张卡`).not.toBeNull();
      expect(card?.getAttribute('aria-disabled'), `${key} 在未来却可点`).toBe('true');
      expect(card?.getAttribute('aria-label') ?? '', `${key} 没说"还没到"`).toContain('桩未到');
    }
    // 过去的月份可点（Z2 已经点过一张），这里钉的是"不是整排都禁用"。
    expect(yearCard(el, '2026-03')?.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('Z6 busy 时两档都不发消息（连点不发第二条 op）', () => {
    const onCheckIn = vi.fn();
    const el = mount({ busy: true, onCheckIn });
    click(el.querySelector('[data-testid="habit-trend-month-cell-2026-10-04"]'));
    click(tab(el, 'year'));
    click(yearCard(el, '2026-03'));
    expect(onCheckIn).not.toHaveBeenCalled();
  });

  it('Z7 年的数来自领域层：有记录的那个月在卡上读得出来', () => {
    const el = mount({ logs: [logOf('2026-03-02'), logOf('2026-03-09')] });
    click(tab(el, 'year'));
    const card = yearCard(el, '2026-03');
    /* 三月整月 31 天都在 `today=10-05` 之前 ⇒ 分母 31、达成 2 ⇒ 2/31 = 6.45%，
       界面上念整数百分比 6%。这个数**只能**来自 `computeHabitPeriodStats`：
       板子若自己写"达成 2 天 / 有记录的那个月 = 100%"，红的就是这一行。 */
    expect(card?.getAttribute('aria-label'), '卡上那三个数不是从行里来的').toBe(
      '桩卡:桩名:2026-03|2|桩率:6',
    );
    // 三个数不是只喂读屏：可见那两行同样读得到。
    expect(card?.textContent).toContain('桩达:2');
    expect(card?.textContent).toContain('桩率:6');
    // 汇总：分子是**月度分子的加权和**（2 天），分母是全年到期的计划日（278 天）⇒ 1%。
    expect(el.textContent).toContain('桩总:2|桩率:1');
    // 🔴 两条阳性对照各挡一种"整排同一个数"的坏法：没记录的月份读 0%，未来那个月读"还没到"。
    expect(yearCard(el, '2026-05')?.textContent).toContain('桩率:0');
    expect(yearCard(el, '2026-12')?.textContent).toContain('桩未到');
  });

  it('Z8 🔴 翻年换的是**那一年的十二张卡**，不只是标题', () => {
    /* 这一条是被臂台逼出来的（`mutate-habit-year.mjs` 的 YA6：年那一档忽略传进来的
       `year`、自己按 `today` 取年）。那种坏的形状是"标题写着 2025 而卡还是 2026"，
       而 Z3/Z5 只查标题与禁用态 —— 它们都会绿。
       判据按**存在性**写（十二张卡一张一张点名），不是"我以为会变的那几张"。 */
    const el = mount({ logs: [logOf('2025-07-01'), logOf('2025-07-08')] });
    click(tab(el, 'year'));
    expect(el.textContent).toContain('桩年:2026');
    click(el.querySelector('[data-testid="habit-trend-year-prev"]'));
    expect(el.textContent, '翻年标题没动').toContain('桩年:2025');
    for (let m = 1; m <= 12; m += 1) {
      const key = `2025-${String(m).padStart(2, '0')}`;
      const card = yearCard(el, key);
      expect(card, `翻到 2025 而 ${key} 那张卡不见了`).not.toBeNull();
      expect(card?.getAttribute('aria-label') ?? '', `${key} 那张卡还停在 2026`).toContain(
        `桩名:${key}`,
      );
    }
    // 上一年那十二张整排换掉，而不是叠加（留着就是两个年份同屏）。
    expect(
      el.querySelector('[data-testid="habit-trend-year-month-2026-07"]'),
      '2026 的卡还在',
    ).toBeNull();
    // 数也跟着换：那两条 2025-07 的记录要读在 2025 那张卡上。
    expect(yearCard(el, '2025-07')?.textContent).toContain('桩达:2');
  });
});
