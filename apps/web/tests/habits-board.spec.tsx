/**
 * 判据：**习惯卡片（打卡 + 连续 + 热力图）只有 `packages/ui` 那一份实现**
 * ======================================================================
 *
 * 出处：`docs/plans/multi-platform-adaptation.md` 的 M3「每轮的固定流程」
 * 第 1–2 步，以及 §判据 A「该特性在 `apps/web` 与 `apps/mobile` 下
 * **不再各有一份实现**」。
 *
 * 为什么这条值得单独一个测试：迁移前 web 有一份 374 行的 DOM 实现，
 * mobile **一行都没有**。两端"各自回答什么算打过、冻结保住了几天、
 * 热力图几档"的差异**不会让任何测试变红** —— 差异本身没有断言。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判据怎么定的（A–D 四道行为判据，加 E 源码级、F 数量行两组）
 *
 * **A. 热力图是自绘的，且每一格带得住确切数字。**
 *    `react-activity-calendar` 是 DOM 库，共享层换成 RN 原语自绘；
 *    它内置的悬停提示因此消失，补回来的路是 `cellTooltip` → `data-cell-title`
 *    （宿主 CSS 的 `::after` 负责显示，见 `app.css`）。
 *    ⇒ 断言：90 格都带 `data-cell-title`；**不给** `cellTooltip` 时一格都不带
 *    （mobile 没有鼠标 —— 产出属性就是承诺一个不存在的交互）。
 *
 * **B. 打卡按钮的状态与语义。**
 *    `aria-pressed` 反映 `doneToday`，点击调 `onCheckIn`，已打卡时调
 *    `onUndoCheckIn`。
 *
 * **C. 补打卡 / 重新开始只在领域层给出机会时出现。**
 *    `resilience.repair` / `freshStart` 由 `@heyta/domain` 判定
 *    （`streakIfRepaired ≥ 2` 等），共享层**不许**自己再判一次。
 *
 * **D. 空态只有共享层那一句。**
 *
 * **F. 数量行（工单 W6）**：`HabitLog.value` 可读、可改，且默认习惯一个节点都不多。
 *    见文件末尾那一组 —— 它对应该单验收的三条，另加两条"形状在、线没接"的源码级腿。
 *
 * ⚠️ RNW 的 `Pressable` 渲染成 `<div role="button">`（不是 `<button>`），
 * 所以下面一律用 `testID`（RNW → `data-testid`）寻址，不用标签名。
 *
 * ⚠️ 本测试用 `@heyta/ui` 的 **`dist/`**（package exports）。
 * 改完 `packages/ui` 源码必须先 `pnpm --filter @heyta/ui build`，
 * 否则看到的是**上一次构建**的结果（假红或假绿都可能，本 Goal 因此误判过两次）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Habit, HabitLog, HabitPeriodStats } from '@heyta/domain';
import { I18nProvider, zhCN } from '@heyta/i18n';
import {
  HabitBoard,
  HeytaUiProvider,
  type HabitBoardLabels,
  type HabitGrowthFn,
} from '@heyta/ui';

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * 判据要读的源码根。
 *
 * ⚠️ 两个环境变量是**只读接缝**，只给故障注入用（把目录复制到 `/tmp`、改一处、
 * 指过去，证明"真实现漂了 → 红"），与 `mockup-quadrant-shape.spec.tsx` 的
 * `HEYTA_MOCKUP_*` 同一约定。不设它们时就是真实路径。
 */
const WEB_SRC = process.env.HEYTA_HABITS_WEB_SRC ?? resolve(HERE, '../src');
const UI_SRC = process.env.HEYTA_HABITS_UI_SRC ?? resolve(HERE, '../../../packages/ui/src');

/** 稳定的"现在"：2026-09-28 12:00（周一）。**不读 `Date.now()`**。 */
const NOW = new Date(2026, 8, 28, 12, 0, 0).getTime();

function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '喝水', createdAt: 1, updatedAt: 1, ...over };
}

function log(date: string, over: Partial<HabitLog> = {}): HabitLog {
  return { id: `h1:${date}`, habitId: 'h1', date, createdAt: 1, updatedAt: 1, ...over };
}

/** 桩：连续 / 韧性由"宿主"给 —— 共享层不认识 `@heyta/app-host`。 */
/**
 * 月统计桩（工单 W8）。`HabitGrowthFn` 的返回类型把它写成**必填** ——
 * 桩不给就编译不过，这正是"宿主没接会被逼出来"的形状。
 * 数字取"月中今日 2026-09-28、完成 6 天 / 到期 9 天"这种处处不相等的形状，
 * 免得某两个字段巧合相等时断言指错地方。
 */
const MONTH_STUB: HabitPeriodStats = {
  monthKey: '2026-09',
  achievedDays: 6,
  scheduledDays: 9,
  rate: 6 / 9,
  monthValue: 14,
  totalValue: 77,
  totalAchievedDays: 33,
};

const growth: HabitGrowthFn = () => ({
  streak: { current: 3, longest: 9 },
  month: MONTH_STUB,
  resilience: {
    resilience: {
      current: 3,
      longest: 9,
      total: 12,
      freezesHeld: 1,
      frozenDays: 2,
      frozenInCurrentRun: 0,
    },
  },
});

const LABELS: HabitBoardLabels = {
  checkIn: '打卡',
  checkedIn: '已打卡',
  checkInA11y: ({ name, doneToday }) => (doneToday ? `撤销「${name}」` : `为「${name}」打卡`),
  streakCurrent: (count) => `连续 ${String(count)} 天`,
  streakLongest: (count) => `最长 ${String(count)} 天`,
  streakTotal: (count) => `累计 ${String(count)} 天`,
  // 工单 W8 那五个（`HabitBoardLabels` 里是**必填**，少接一个编译就红）。
  // 与 amount 三兄弟同一个纪律：桩故意用另一种格式，判据读到的是桩的产出。
  monthDays: (count) => `桩月天:${String(count)}`,
  monthRate: (percent) => `桩率:${String(percent)}`,
  monthRatePending: '桩率:无',
  monthValue: ({ value, unit }) => `桩月量:${String(value)}|${unit}`,
  totalValue: ({ value, unit }) => `桩总量:${String(value)}|${unit}`,
  freeze: (count) => `这段连续里有 ${String(count)} 天是冻结保住的`,
  repair: ({ date, count }) => `${date} 那天漏了。现在补上，就是连续 ${String(count)} 天。`,
  repairAction: '补上',
  repairA11y: ({ date, name }) => `把 ${date} 的「${name}」补上`,
  freshStart: ({ days, longest, total }) =>
    `已经 ${String(days)} 天没打卡了。最长 ${String(longest)} 天、累计 ${String(total)} 天都还在。`,
  freshStartAction: '今天重新开始',
  freshStartA11y: (name) => `今天为「${name}」重新打卡`,
  // 工单 W6 那三个（`HabitBoardLabels` 里是**必填**，少接一个编译就红 ——
  // 可选 prop 会把"宿主没接"伪装成"做完了"）。桩故意用另一种格式，
  // 这样下面的判据读到的是**桩的产出**，不是词条表的句子。
  amount: ({ value, target, unit }) => `桩:${String(value)}/${String(target)}|${unit}`,
  amountPlusA11y: ({ name }) => `桩加一:${name}`,
  amountMinusA11y: ({ name }) => `桩减一:${name}`,
  empty: '还没有习惯。添加一个开始打卡。',
  heatmap: {
    month: () => '某月',
    grid: ({ name, total, days }) =>
      `「${name}」最近 ${String(days)} 天共 ${String(total)} 次打卡`,
    cellTooltip: ({ date, count }) => `${date}：${String(count)} 次`,
    less: '少',
    more: '多',
  },
};

/** 不给 `cellTooltip` 的一份 —— 用来证明"不产出属性"那一半真的成立。 */
const LABELS_NO_TOOLTIP: HabitBoardLabels = {
  ...LABELS,
  heatmap: { month: LABELS.heatmap.month, grid: LABELS.heatmap.grid },
};

/** jsdom 里 RNW 偶尔会问 `ResizeObserver` —— 给个空实现，与别的 spec 一致。 */
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

/** 用共享 `HabitBoard` 渲染一次（默认桩与标签）。 */
function renderBoard(props: {
  habits: readonly Habit[];
  logs: readonly HabitLog[];
  labels?: HabitBoardLabels;
  onCheckIn?: (id: string, date?: string, value?: number) => void;
  onUndoCheckIn?: (id: string, date?: string) => void;
  busyHabitId?: string | null;
  growthFn?: HabitGrowthFn;
}): HTMLElement {
  return render(
    <HabitBoard
      habits={props.habits}
      logs={props.logs}
      now={NOW}
      growth={props.growthFn ?? growth}
      labels={props.labels ?? LABELS}
      onCheckIn={props.onCheckIn ?? (() => undefined)}
      onUndoCheckIn={props.onUndoCheckIn ?? (() => undefined)}
      busyHabitId={props.busyHabitId ?? null}
    />,
  );
}

function byTestId(view: HTMLElement, testId: string): HTMLElement | null {
  return view.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

describe('A. 热力图自绘 + 悬停的确切数字', () => {
  it('90 天 = 90 格，且每一格都带 `data-cell-title`（web 才传 cellTooltip）', () => {
    const view = renderBoard({ habits: [habit()], logs: [] });
    const cells = view.querySelectorAll('[data-cell-title]');
    expect(cells).toHaveLength(90);
  });

  it('🔴 不给 `cellTooltip` 时**一格都不带**（mobile 没有鼠标，不许承诺悬停）', () => {
    const view = renderBoard({ habits: [habit()], logs: [], labels: LABELS_NO_TOOLTIP });
    // 先用月份标签证明热力图确实画出来了 —— 否则"0 个"可能只是整块没渲染（空转断言）。
    expect(view.textContent ?? '').toContain('某月');
    expect(view.querySelectorAll('[data-cell-title]').length).toBe(0);
  });

  it('打过的日子在 DOM 上留下"1 次"的痕迹（数字来自日志，不是猜的）', () => {
    const view = renderBoard({ habits: [habit()], logs: [log('2026-09-28')] });
    const titles = [...view.querySelectorAll('[data-cell-title]')].map((el) =>
      el.getAttribute('data-cell-title'),
    );
    expect(titles).toContain('2026-09-28：1 次');
    expect(titles).toContain('2026-09-27：0 次');
  });

  it('图例取"少 → 多"（两端共用同一份 heat 色阶）', () => {
    const view = renderBoard({ habits: [habit()], logs: [] });
    const flat = (view.textContent ?? '').replace(/\s+/gu, '');
    expect(flat).toContain('少');
    expect(flat).toContain('多');
  });
});

describe('B. 打卡按钮：状态、语义与动作', () => {
  it('未打卡：`aria-pressed=false`，点击调 onCheckIn（只带 habitId）', () => {
    const onCheckIn = vi.fn();
    const view = renderBoard({ habits: [habit()], logs: [], onCheckIn });
    const button = byTestId(view, 'habit-checkin-h1');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.textContent).toContain('打卡');
    act(() => {
      button?.click();
    });
    expect(onCheckIn).toHaveBeenCalledWith('h1');
  });

  it('已打卡：`aria-pressed=true`，文案是「已打卡」，点击调 onUndoCheckIn', () => {
    const onUndo = vi.fn();
    const view = renderBoard({
      habits: [habit()],
      logs: [log('2026-09-28')],
      onUndoCheckIn: onUndo,
    });
    const button = byTestId(view, 'habit-checkin-h1');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.textContent).toContain('已打卡');
    act(() => {
      button?.click();
    });
    expect(onUndo).toHaveBeenCalledWith('h1');
  });

  it('忙碌中的那一行按钮被置灰（防连点发出两条 op）', () => {
    const view = renderBoard({ habits: [habit()], logs: [], busyHabitId: 'h1' });
    const button = byTestId(view, 'habit-checkin-h1');
    // RNW 的 `Pressable` 渲染成 div，`disabled` 体现在 `aria-disabled`。
    expect(button?.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('C. 补打卡 / 重新开始：只渲染领域层给出的机会', () => {
  const withRepair: HabitGrowthFn = () => ({
    streak: { current: 0, longest: 9 },
    month: MONTH_STUB,
    resilience: {
      resilience: {
        current: 0,
        longest: 9,
        total: 12,
        freezesHeld: 0,
        frozenDays: 2,
        frozenInCurrentRun: 0,
      },
      repair: { date: '2026-09-27', streakIfRepaired: 5 },
    },
  });

  const withFreshStart: HabitGrowthFn = () => ({
    streak: { current: 0, longest: 21 },
    month: MONTH_STUB,
    resilience: {
      resilience: {
        current: 0,
        longest: 21,
        total: 40,
        freezesHeld: 0,
        frozenDays: 2,
        frozenInCurrentRun: 0,
      },
      freshStart: { daysSinceLast: 9, longest: 21, total: 40 },
    },
  });

  it('没有 repair / freshStart 时，两块都不出现', () => {
    const view = renderBoard({ habits: [habit()], logs: [] });
    expect(byTestId(view, 'habit-repair-h1')).toBeNull();
    expect(byTestId(view, 'habit-freshstart-h1')).toBeNull();
  });

  it('给了 repair 才出现，且补打卡按钮把**那一天**传回去（不是今天）', () => {
    const onCheckIn = vi.fn();
    const view = renderBoard({ habits: [habit()], logs: [], onCheckIn, growthFn: withRepair });
    const button = byTestId(view, 'habit-repair-h1');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('补上');
    act(() => {
      button?.click();
    });
    expect(onCheckIn).toHaveBeenCalledWith('h1', '2026-09-27');
  });

  it('给了 freshStart 才出现，且它打的是**今天**（不带日期）', () => {
    const onCheckIn = vi.fn();
    const view = renderBoard({
      habits: [habit()],
      logs: [],
      onCheckIn,
      growthFn: withFreshStart,
    });
    const button = byTestId(view, 'habit-freshstart-h1');
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });
    expect(onCheckIn).toHaveBeenCalledWith('h1');
  });
});

describe('D. 空态由共享层渲染', () => {
  it('一个习惯都没有时，渲染的是共享层的 `labels.empty` 那一句', () => {
    const view = renderBoard({ habits: [], logs: [] });
    expect((view.textContent ?? '').trim()).toBe(LABELS.empty);
    // 空态不是"画一张空热力图"。
    expect(view.querySelectorAll('[data-cell-title]').length).toBe(0);
  });
});

describe('E. web 视图不再有第二份实现（源码级判据）', () => {
  const hostSource = (): string =>
    readFileSync(resolve(WEB_SRC, 'features/habits/HabitsView.tsx'), 'utf8');
  const boardSource = (): string =>
    readFileSync(resolve(UI_SRC, 'habits/HabitBoard.tsx'), 'utf8');

  it('web 宿主从 `@heyta/ui` 取 `HabitBoard`，且不再 import `react-activity-calendar`', () => {
    const host = hostSource();
    expect(host).toContain('HabitBoard');
    expect(host).toContain('@heyta/ui');
    // 🔴 DOM 库不许回潮：它是"热力图在共享层自绘"这件事的反面。
    // ⚠️ 判据必须盯 **import 语句**而不是文件里出现过这个词 ——
    // 文件头的说明文字里就写着 `react-activity-calendar`（实测第一版因此假红）。
    expect(host).not.toMatch(/from\s+['"]react-activity-calendar['"]/);
  });

  it('热力图的骨架在共享层（自绘 `View` 网格），不在 web 的 JSX 里', () => {
    const board = boardSource();
    expect(board).toContain('toHeatmapWeeks');
    expect(board).toContain('heatmapLevelToken');
    expect(hostSource()).not.toContain('heatmapLevelToken');
  });

  it('文案一律由宿主注入：共享层不 import `@heyta/i18n`', () => {
    // 同样盯 import 语句，不盯"文件里出现过这个词"（文件头正是这么写的）。
    expect(boardSource()).not.toMatch(/from\s+['"]@heyta\/i18n/);
  });

  it('用真词条渲染一次：累计数字与中文文案对得上', () => {
    // 🔴 这条原来把句子写成字面量 `'累计12次'`，于是**词条一改它就漂**（W8a 把"次"改成"天"
    // 的当轮就红了 —— 红了是对的，但它当时只能靠人来发现漂移）。
    // 现在两件事分开钉：字面量仍然是**可读的期望**，另外加一条**漂移自检**，
    // 让"改了词条没同步这条"由测试自己报出来，而不是等人。
    const expected = '累计12天';
    const squeeze = (value: string): string => value.replace(/\s+/gu, '');
    expect(
      squeeze(expected),
      '这条字面量与 `web.habits.streak.total` 漂移了 —— 改词条必须同步这条期望',
    ).toBe(squeeze(zhCN['web.habits.streak.total'].replace('{count}', '12')));
    const view = render(
      <HabitBoard
        habits={[habit()]}
        logs={[log('2026-09-28')]}
        now={NOW}
        growth={growth}
        labels={{
          ...LABELS,
          streakTotal: (count) =>
            zhCN['web.habits.streak.total'].replace('{count}', String(count)),
        }}
        onCheckIn={() => undefined}
        onUndoCheckIn={() => undefined}
      />,
    );
    expect((view.textContent ?? '').replace(/\s+/gu, '')).toContain(
      expected.replace(/\s+/gu, ''),
    );
  });
});

/**
 * F. 数量行（工单 W6：`HabitLog.value` 第一次在界面上可读、可写）
 *
 * 工单原话的三条验收在这里各对应一组：
 *   ① 目标 8、今天记 5 ⇒ 界面显示 5（F1/F2；落盘那腿在 app-host）
 *   ② 不传 value 时逐字保持旧行为（F6 行为级 + F7 源码级）
 *   ③ 撤销打卡仍走软删（F4/F5：减到 0 走的是 `onUndoCheckIn`，不是记一条 0）
 *
 * ⚠️ 这里量的是**共享组件的产出**。宿主有没有把第三个参数接住是 F8 那条
 * 源码级判据的事 —— 它在 jsdom 里量不到（测试自己就是宿主）。
 */
describe('F. 数量行：读数与步进', () => {
  const counted = habit({ target: 8, unit: '杯' });

  it('F1 🔴 计数型习惯渲染数量行，文本是 `labels.amount` 的产出（值来自日志）', () => {
    const view = renderBoard({ habits: [counted], logs: [log('2026-09-28', { value: 5 })] });
    const row = byTestId(view, 'habit-amount-h1');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('桩:5/8|杯');
    // 存在性先于取值：两个按钮与那句文本**都得在**，否则"读数正确"可能只是整行没渲染。
    expect(byTestId(view, 'habit-amount-plus-h1')).not.toBeNull();
    expect(byTestId(view, 'habit-amount-minus-h1')).not.toBeNull();
    // 文本自己有一个 testID：浏览器层的判据要能精确指着**那一个字**量颜色，
    // 量整行会读到继承色（暗色下整片都是 foreground，那样恒真）。
    expect(byTestId(view, 'habit-amount-text-h1')?.textContent).toContain('桩:5/8|杯');
  });

  it('F2 🔴 一条"每天做一次"的默认习惯**一个节点都不多**（老界面的 DOM 逐字不变）', () => {
    const view = renderBoard({ habits: [habit()], logs: [log('2026-09-28', { value: 1 })] });
    expect(byTestId(view, 'habit-amount-h1')).toBeNull();
    // 正对照：卡本身渲染了（否则"没有数量行"是空转断言）。
    expect(byTestId(view, 'habit-card-h1')).not.toBeNull();
    expect(byTestId(view, 'habit-checkin-h1')).not.toBeNull();
  });

  it('F3 「+」带的是**明确数值**（已有 5 ⇒ 6），且日期位留空表示今天', () => {
    const onCheckIn = vi.fn();
    const view = renderBoard({
      habits: [counted],
      logs: [log('2026-09-28', { value: 5 })],
      onCheckIn,
    });
    act(() => {
      byTestId(view, 'habit-amount-plus-h1')?.click();
    });
    expect(onCheckIn).toHaveBeenCalledWith('h1', undefined, 6);
  });

  it('F4 「−」在量大于 1 时也是改量（5 ⇒ 4），不发撤销', () => {
    const onCheckIn = vi.fn();
    const onUndo = vi.fn();
    const view = renderBoard({
      habits: [counted],
      logs: [log('2026-09-28', { value: 5 })],
      onCheckIn,
      onUndoCheckIn: onUndo,
    });
    act(() => {
      byTestId(view, 'habit-amount-minus-h1')?.click();
    });
    expect(onCheckIn).toHaveBeenCalledWith('h1', undefined, 4);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('F5 🔴 减到 0 走的是**撤销打卡**（0 不是一条合法的量，界面上不许写出它）', () => {
    const onCheckIn = vi.fn();
    const onUndo = vi.fn();
    const view = renderBoard({
      habits: [counted],
      logs: [log('2026-09-28', { value: 1 })],
      onCheckIn,
      onUndoCheckIn: onUndo,
    });
    act(() => {
      byTestId(view, 'habit-amount-minus-h1')?.click();
    });
    expect(onUndo).toHaveBeenCalledWith('h1');
    expect(onCheckIn).not.toHaveBeenCalled();
  });

  it('F5b 🔴 小数目标（0.5 小时）减下去也不会漏出**负数** —— 同一条腿走撤销', () => {
    const onCheckIn = vi.fn();
    const onUndo = vi.fn();
    const view = renderBoard({
      habits: [habit({ target: 0.5, unit: '小时' })],
      logs: [log('2026-09-28', { value: 0.5 })],
      onCheckIn,
      onUndoCheckIn: onUndo,
    });
    // 前提：小数目标**得先有这一行**（判据第一版 `target > 1` 在这里是空的，
    // 而"按钮不存在 ⇒ 什么都没调"会让下面两条断言双双假绿）。
    expect(byTestId(view, 'habit-amount-h1')).not.toBeNull();
    act(() => {
      byTestId(view, 'habit-amount-minus-h1')?.click();
    });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onCheckIn).not.toHaveBeenCalled();
  });

  it('F6 今天还没打卡 ⇒ 「−」置灰且点下去什么都不发生（正对照：「+」能用）', () => {
    const onCheckIn = vi.fn();
    const onUndo = vi.fn();
    const view = renderBoard({ habits: [counted], logs: [], onCheckIn, onUndoCheckIn: onUndo });
    const minus = byTestId(view, 'habit-amount-minus-h1');
    expect(minus?.getAttribute('aria-disabled')).toBe('true');
    act(() => {
      minus?.click();
    });
    expect(onCheckIn).not.toHaveBeenCalled();
    expect(onUndo).not.toHaveBeenCalled();

    const plus = byTestId(view, 'habit-amount-plus-h1');
    expect(plus?.getAttribute('aria-disabled')).not.toBe('true');
    act(() => {
      plus?.click();
    });
    expect(onCheckIn).toHaveBeenCalledWith('h1', undefined, 1);
  });

  it('F7 落盘中的那条习惯，两个步进按钮都置灰（防连点发出两条 op）', () => {
    const view = renderBoard({
      habits: [counted],
      logs: [log('2026-09-28', { value: 5 })],
      busyHabitId: 'h1',
    });
    expect(byTestId(view, 'habit-amount-plus-h1')?.getAttribute('aria-disabled')).toBe('true');
    expect(byTestId(view, 'habit-amount-minus-h1')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('F8 主打卡按钮**一个额外参数都不带** —— 判据②"逐字旧行为"的源码级腿', () => {
    const board = readFileSync(resolve(UI_SRC, 'habits/HabitBoard.tsx'), 'utf8');
    // 主按钮那一处：`onCheckIn(row.habit.id)`，右边不许跟逗号。
    expect(board).toMatch(/onCheckIn\(row\.habit\.id\)/u);
    // 步进那一处必须带三个实参（`undefined` = 今天）。写成两处同样的形状就是没分清两条路。
    expect(board).toMatch(/onCheckIn\(row\.habit\.id,\s*undefined,\s*row\.todayValue \+ 1\)/u);
    // 而数量那一格读的是共享行上的字段，不是组件里现算的除法。
    expect(board).toContain('row.todayValue');
    expect(board).not.toMatch(/Math\.round\(\s*row\.todayRatio/u);
  });

  it('F9 🔴 两份 labels 构造器都接了那三个字段，两个宿主都透传第三个参数', () => {
    /**
     * 症状分两种，都要能红：
     *  · 宿主**没接文案** ⇒ 共享层的必填字段会让编译红（所以这条只能验"接了且接的是
     *    同一批 key"，防的是两边各建一条同义键）；
     *  · 宿主**没透传 value** ⇒ 步进器画出来了、点下去什么都不记（形状在、线没接，
     *    正是"共享组件默认值=原行为"那类假绿的镜像）。
     */
    for (const [where, rel] of [
      ['web', 'features/habits/HabitsView.tsx'],
      ['mobile', '../../../apps/mobile/src/lib/habits-display.ts'],
    ] as const) {
      const src = readFileSync(resolve(WEB_SRC, rel), 'utf8');
      for (const field of ['amount', 'amountPlusA11y', 'amountMinusA11y']) {
        expect(src, `${where} 的 labels 构造器没接 ${field}`).toContain(`${field}:`);
      }
      // 两边必须用**同一批** key（同义键不会让任何测试变红，只会让两端说两句话）。
      for (const key of [
        'common.habits.amount.today',
        'common.habits.amount.plus',
        'common.habits.amount.minus',
      ]) {
        expect(src, `${where} 没有用 ${key}`).toContain(key);
      }
    }

    let passed = 0;
    for (const rel of [
      'features/habits/HabitsView.tsx',
      '../../../apps/mobile/src/screens/HabitsScreen.tsx',
    ] as const) {
      if (/checkIn\(\s*habitId,\s*date,\s*value\s*\)/u.test(readFileSync(resolve(WEB_SRC, rel), 'utf8'))) {
        passed += 1;
      }
    }
    expect(passed, '透传 value 的宿主不足两个 —— 步进器在某一端是坏的').toBe(2);
  });

  it('F10 单位为空时共享层传的是**空串**（兜底那句「次」归宿主，共享层不猜量纲）', () => {
    const seen: Parameters<HabitBoardLabels['amount']>[0][] = [];
    const view = renderBoard({
      habits: [habit({ target: 8 })],
      logs: [],
      labels: {
        ...LABELS,
        amount: (info) => {
          seen.push(info);
          return '桩';
        },
      },
    });
    expect(byTestId(view, 'habit-amount-h1')).not.toBeNull();
    expect(seen).toEqual([{ value: 0, target: 8, unit: '' }]);
  });

  it('F11 超目标也要能记（`atMost` 的"破戒"是数据，不是被 clamp 掉的 8）', () => {
    const view = renderBoard({
      habits: [habit({ target: 2, unit: '杯', goalType: 'atMost' })],
      logs: [log('2026-09-28', { value: 3 })],
    });
    expect(byTestId(view, 'habit-amount-h1')?.textContent).toContain('桩:3/2|杯');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// G. 工单 W8 的四格（本月打卡 / 本月完成率 / 本月完成量 / 总完成量）
// ─────────────────────────────────────────────────────────────────────────
// 判据按 §7 第 82 条同族的教训写成**存在性**："少了一格"才是这单最怕的失效，
// 逐条给"我以为会有的那几行"写内容判据挡不住它。
// 桩的 `month` 处处取互不相等的数字（见 `MONTH_STUB`），断言读到的是**桩的产出**，
// 不是词条句子 —— 那证明格子真的接在 `row.month` 上，而不是硬编码。
describe('G. W8 四格：存在性、分母为 0 走占位句、求和走 monthValue', () => {
  it('G1 🔴 四格都在场（存在性判据），且各自读的是 month 的对应字段', () => {
    const view = renderBoard({ habits: [habit()], logs: [] });
    // 四枚 testID 都必须存在 —— 摘掉任意一格渲染，这条红。
    expect(byTestId(view, 'habit-month-days-h1')).not.toBeNull();
    expect(byTestId(view, 'habit-month-rate-h1')).not.toBeNull();
    expect(byTestId(view, 'habit-month-value-h1')).not.toBeNull();
    expect(byTestId(view, 'habit-total-value-h1')).not.toBeNull();
    // 桩的 month：achievedDays 6、monthValue 14、totalValue 77（无单位）。
    expect(byTestId(view, 'habit-month-days-h1')?.textContent).toBe('桩月天:6');
    expect(byTestId(view, 'habit-month-value-h1')?.textContent).toBe('桩月量:14|');
    expect(byTestId(view, 'habit-total-value-h1')?.textContent).toBe('桩总量:77|');
    // 桩的 rate = 6/9，分母 9 > 0 ⇒ 走百分比那一支：round(0.666…×100) = 67。
    expect(byTestId(view, 'habit-month-rate-h1')?.textContent).toBe('桩率:67');
  });

  it('G2 🔴 scheduledDays 为 0 时显示占位句，绝不显示 "0%"', () => {
    const zeroDenom: HabitGrowthFn = () => ({
      streak: { current: 0, longest: 0 },
      resilience: {
        resilience: { current: 0, longest: 0, total: 0, freezesHeld: 0, frozenDays: 0, frozenInCurrentRun: 0 },
      },
      // 分母 0、率 0（domain 保证不是 NaN）。
      month: { ...MONTH_STUB, scheduledDays: 0, rate: 0 },
    });
    const view = renderBoard({ habits: [habit()], logs: [], growthFn: zeroDenom });
    const cell = byTestId(view, 'habit-month-rate-h1');
    expect(cell?.textContent).toBe('桩率:无'); // 占位句，不是数字
    expect(cell?.textContent).not.toContain('0%');
  });

  it('G3 四格的单位来自 habit.unit（与数量行同一个约定：无单位为**空串**，不猜「次」）', () => {
    const seen: Array<{ value: number; unit: string }> = [];
    const view = renderBoard({
      habits: [habit({ unit: '页' })],
      logs: [],
      labels: {
        ...LABELS,
        monthValue: (info) => {
          seen.push(info);
          return '桩';
        },
      },
    });
    expect(byTestId(view, 'habit-month-value-h1')).not.toBeNull();
    // monthValue 14（桩），unit '页'。
    expect(seen).toEqual([{ value: 14, unit: '页' }]);
  });

  it('G4 🔴 四格走的是**注入的 month**，不在共享层重算（换桩即换数）', () => {
    const spy: HabitGrowthFn = () => ({
      streak: { current: 1, longest: 2 },
      resilience: {
        resilience: { current: 1, longest: 2, total: 3, freezesHeld: 0, frozenDays: 0, frozenInCurrentRun: 0 },
      },
      month: { ...MONTH_STUB, achievedDays: 5, monthValue: 12 },
    });
    const view = renderBoard({ habits: [habit()], logs: [], growthFn: spy });
    // 桩给什么格子读什么：与 G1 的 6/14 不同 —— 证明数字来自注入对象，不是硬编码。
    expect(byTestId(view, 'habit-month-days-h1')?.textContent).toBe('桩月天:5');
    expect(byTestId(view, 'habit-month-value-h1')?.textContent).toBe('桩月量:12|');
  });

  it('G5 🔴 两份宿主 labels 构造器都接了 W8 那五个字段，且用的是同一批 key（F9 的手法）', () => {
    // 必填字段本身会挡"整端没接"（编译红）；这条挡的是更细的一种：
    // 接了，但两端各建一条同义键 —— 同义键不会让任何单元测试变红，
    // 只会让同一个数在两端长成两句话。
    for (const [where, rel] of [
      ['web', 'features/habits/HabitsView.tsx'],
      ['mobile', '../../../apps/mobile/src/lib/habits-display.ts'],
    ] as const) {
      const src = readFileSync(resolve(WEB_SRC, rel), 'utf8');
      for (const field of ['monthDays', 'monthRate:', 'monthRatePending', 'monthValue', 'totalValue']) {
        expect(src, `${where} 的 labels 构造器没接 ${field}`).toContain(`${field}`);
      }
      for (const key of [
        'web.habits.stats.monthDays',
        'web.habits.stats.monthRate',
        'web.habits.stats.monthRatePending',
        'web.habits.stats.monthValue',
        'web.habits.stats.monthValueUnit',
        'web.habits.stats.totalValue',
        'web.habits.stats.totalValueUnit',
      ]) {
        expect(src, `${where} 没有用 ${key}（同义键苗头）`).toContain(key);
      }
    }
  });
});
