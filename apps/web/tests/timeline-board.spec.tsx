/**
 * 时间线板（TimelineBoard）的**组件判据** —— R4 §5.3 的落地
 * ======================================================
 *
 * 挂在宿主接线层 `TimelinePanel` 上（跨重画存活），喂**真词条**
 * （`useTimelineLabels()`，不在测试里抄中文 —— 抄的那份不会跟着词条表变）。
 *
 * 🔴 判据 4 的「先红」证据在 git 历史里：本文件 2026-10-01 首版只有一个测试
 * （判据 4 探针），在改代码之前跑出过**两个方向的红** ——
 * ① `not.toContain('0:00 → 1:00')` 红（当时界面印的就是假时间）；
 * ② 修掉探针自身缺陷（标题含 15:00 替正向断言作答，#86）后
 *    `toContain('15:00')` 红（界面上没有来自 dueDate 的时间）。
 * 现在它绿，且此后谁再把相对偏移印成钟点，它就再红一次。
 *
 * 各判据对应关系：
 *   判据 1 一根轴        → describe '判据 1'
 *   判据 2 相对位置      → describe '判据 2'（正向对照：不都是 0）
 *   判据 3 无假长度      → describe '判据 3'
 *   判据 4 dueDate 时间  → describe '判据 4'
 *   判据 5 未排期可见    → describe '判据 5'
 *   判据 6 无障碍文字面  → describe '判据 6'
 */

import { parseLocalDate, type LocalDate } from '@heyta/domain';
import { type TimelineTaskLike } from '@heyta/app-host';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { HeytaUiProvider, TimelineBoard } from '@heyta/ui';
import { TimelinePanel } from '../src/features/timeline/TimelinePanel.js';
import { useTimelineLabels } from '../src/features/timeline/labels.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 渲染任意节点到一块新的容器里（与 gantt-chart.spec.tsx 同一形状）。 */
function renderElement(node: React.ReactNode): HTMLDivElement {
  if (root !== undefined) {
    act(() => {
      root?.unmount();
    });
    container?.remove();
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
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
});

// ── 夹具 ─────────────────────────────────────────────────────────────────

/** 2026-10-01 周四。固定日期，测试不读时钟。 */
const DAY: LocalDate = '2026-10-01';
const NOW = parseLocalDate(DAY).getTime() + 12 * 60 * 60 * 1000; // 当天正午

/** 本地日历日 + 钟点 → 本地时间戳（`parseLocalDate` = 本地午夜，不是 UTC）。 */
function ms(hour: number, date: LocalDate = DAY): number {
  return parseLocalDate(date).getTime() + hour * 60 * 60 * 1000;
}

function renderBoard(tasks: TimelineTaskLike[]): HTMLDivElement {
  return renderElement(<TimelinePanel tasks={tasks} today={DAY} now={NOW} />);
}

/** 读一个绝对定位元素的 `left` 百分比（RNW 把 style.left 渲染成 `"23.4%"`）。 */
function leftPercent(el: HTMLDivElement, testId: string): number {
  const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  expect(node, testId).toBeTruthy();
  return Number.parseFloat(node?.style.left ?? 'NaN');
}

// ─────────────────────────────────────────────────────────────────────────

describe('空态与锚点', () => {
  it('没有任务 → 一句人话的空态；锚点 testID `timeline-view` 不丢（e2e 白屏检测挂在它上）', () => {
    const el = renderBoard([]);
    expect(el.querySelector('[data-testid="timeline-view"]')).toBeTruthy();
    const empty = el.querySelector('[data-testid="timeline-view-empty"]');
    expect(empty).toBeTruthy();
    expect((empty?.textContent ?? '').length).toBeGreaterThan(10);
    expect(empty?.textContent).toContain('收集箱');
  });
});

describe('🔴🔴 R4 判据 1：整视图只有一根轴', () => {
  it('三条任务 → `timeline-axis` 数量 == 1（旧实现 == 任务数）；旧 `gantt-chart` 数量 == 0', () => {
    const el = renderBoard([
      { id: 'a', title: '甲', dueDate: ms(15) },
      { id: 'b', title: '乙', dueDate: ms(16) },
      { id: 'c', title: '丙' },
    ]);
    expect(el.querySelectorAll('[data-testid="timeline-axis"]')).toHaveLength(1);
    expect(el.querySelectorAll('[data-testid="gantt-chart"]')).toHaveLength(0);
    // 每条任务在板上是一行（行 = 任务）
    expect(el.querySelectorAll('[data-testid^="timeline-row-"]')).toHaveLength(2);
  });
});

describe('🔴🔴 R4 判据 2：相对位置可判定（含正向对照）', () => {
  it('🔴 截止晚的任务在轴上更靠右：x 差 > 0、与时间差同号、且不都为 0', () => {
    const el = renderBoard([
      { id: 'earlier', title: '早的', dueDate: ms(14) },
      { id: 'later', title: '晚的', dueDate: ms(16) },
    ]);
    const earlier = leftPercent(el, 'timeline-point-earlier');
    const later = leftPercent(el, 'timeline-point-later');
    expect(later - earlier).toBeGreaterThan(0); // 符号与时间差一致
    expect(earlier).toBeGreaterThan(0); // 正向对照："都是 0"不算绿
    expect(later).toBeLessThanOrEqual(100);
  });
});

describe('🔴🔴 R4 判据 3：只有截止、没有估时 ⇒ 点，不是条', () => {
  it('🔴 有 dueDate 无估时 → `timeline-point` 在场、`timeline-bar` 缺席', () => {
    const el = renderBoard([{ id: 'a', title: '只有截止', dueDate: ms(15) }]);
    expect(el.querySelector('[data-testid="timeline-point-a"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="timeline-bar-a"]')).toBeNull();
  });

  it('🔴 任务级不出现「按 1 小时排」这类编出来的长度文案', () => {
    const el = renderBoard([{ id: 'a', title: '只有截止', dueDate: ms(15) }]);
    expect(el.querySelector('[data-testid="timeline-view"]')?.textContent).not.toContain(
      '按 1 小时排',
    );
  });

  it('估时只是行头的文字 badge（AI 估 1 小时 30 分），不产生任何几何长度', () => {
    const el = renderBoard([
      { id: 'a', title: '有估时', dueDate: ms(15), note: '预计耗时：90 分钟' },
    ]);
    const ai = el.querySelector('[data-testid="timeline-ai-a"]');
    expect(ai?.textContent).toContain('AI 估');
    expect(ai?.textContent).toContain('1 小时 30 分');
    // 几何上仍然只有一个点，没有条
    expect(el.querySelector('[data-testid="timeline-bar-a"]')).toBeNull();
  });
});

describe('🔴🔴 R4 判据 4：任务级的日历时间必须来自 dueDate', () => {
  it('🔴 截止 15:00 的任务，界面上必须出现 15:00，且不出现假时间「0:00 → 1:00」', () => {
    // ⚠️ 标题**不含**「15:00」—— 否则正向断言会被标题满足，
    // 判据就退化成只挡假时间、不证明 dueDate 真的进了界面（#86：一条判据藏两个缺陷）。
    const el = renderBoard([{ id: 'due-1500', title: '交评审稿给产品负责人', dueDate: ms(15) }]);

    const text = el.querySelector('[data-testid="timeline-view"]')?.textContent ?? '';

    // 真·截止时刻必须出现在界面上（行头的日期/钟点来自 dueDate）。
    expect(text).toContain('15:00');
    // 🔴 假日历时间（相对偏移印成钟点）是 R4 实测抓到的那条真错，单独钉死。
    expect(text).not.toContain('0:00 → 1:00');
  });

  it('🔴 行头的日期落在截止那一天的刻度格内（不是窗口起点）', () => {
    const el = renderBoard([{ id: 'a', title: '有截止', dueDate: ms(15) }]);
    // 当天 0 点刻度的横坐标 < 点的横坐标 < 次日 0 点刻度的横坐标
    const dayTick = leftPercent(el, `timeline-tick-${String(ms(0))}`);
    const nextTick = leftPercent(el, `timeline-tick-${String(ms(0, '2026-10-02'))}`);
    const point = leftPercent(el, 'timeline-point-a');
    expect(point).toBeGreaterThan(dayTick);
    expect(point).toBeLessThan(nextTick);
  });
});

describe('🔴🔴 R4 判据 5：未排期可见但不落图', () => {
  it('🔴 无 dueDate → 泳道条目在场（有名字的泳道），且**不产生** point/bar', () => {
    const el = renderBoard([{ id: 'no-date', title: '还没排的任务' }]);
    const lane = el.querySelector('[data-testid="timeline-lane"]');
    expect(lane).toBeTruthy();
    expect(el.querySelector('[data-testid="timeline-lane-title"]')?.textContent).toContain('未排期');
    expect(el.querySelector('[data-testid="timeline-lane-item-no-date"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="timeline-point-no-date"]')).toBeNull();
    expect(el.querySelector('[data-testid="timeline-bar-no-date"]')).toBeNull();
    expect(el.querySelector('[data-testid^="timeline-row-"]')).toBeNull();
  });

  it('🔴 混合：有日期的进行区，没日期的进泳道——两边都**可见**（不静默消失）', () => {
    const el = renderBoard([
      { id: 'scheduled', title: '有截止', dueDate: ms(15) },
      { id: 'floating', title: '没截止' },
    ]);
    expect(el.querySelector('[data-testid="timeline-row-scheduled"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="timeline-point-scheduled"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="timeline-lane-item-floating"]')).toBeTruthy();
    // 泳道条目同样有文字标题（无障碍表面不丢）
    expect(el.querySelector('[data-testid="timeline-lane-title-floating"]')?.textContent).toBe(
      '没截止',
    );
  });

  it('全部未排期：泳道在场，轴与今天线照常（诚实的一周空图，不是空白）', () => {
    const el = renderBoard([{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]);
    expect(el.querySelectorAll('[data-testid^="timeline-lane-item-"]')).toHaveLength(2);
    expect(el.querySelector('[data-testid="timeline-axis"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="timeline-today-line"]')).toBeTruthy();
  });
});

describe('🔴🔴 R4 判据 6：无障碍表面不丢', () => {
  it('每行的文字里都能读到标题与日期（不依赖颜色/几何）', () => {
    const el = renderBoard([{ id: 'a', title: '写周报', dueDate: ms(15) }]);
    const row = el.querySelector('[data-testid="timeline-row-a"]');
    const rowText = row?.textContent ?? '';
    expect(rowText).toContain('写周报');
    expect(rowText).toContain('10-01');
    expect(rowText).toContain('15:00');
  });

  it('轴 / 今天线 / 菱形是装饰（aria-hidden）；根有可读的 aria-label', () => {
    const el = renderBoard([{ id: 'a', title: '甲', dueDate: ms(15) }]);
    expect(el.querySelector('[data-testid="timeline-axis"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(el.querySelector('[data-testid="timeline-today-line"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(
      el.querySelector('[data-testid="timeline-point-a"]')?.parentElement?.getAttribute('aria-hidden'),
    ).toBe('true');
    const label = el.querySelector('[data-testid="timeline-view"]')?.getAttribute('aria-label');
    expect(label ?? '').toContain('时间线');
    expect(label ?? '').toContain('1 条');
  });
});

describe('今天线与逾期', () => {
  it('今天在窗口内 → 轴上有 today 刻度、行区有贯穿今天线', () => {
    const el = renderBoard([{ id: 'a', title: '甲', dueDate: ms(15) }]);
    expect(el.querySelector('[data-testid="timeline-today-tick"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="timeline-today-line"]')).toBeTruthy();
  });

  it('🔴 逾期任务画在**真实**（过去）位置：仍在图内，带「逾期」文字', () => {
    const el = renderBoard([
      { id: 'late', title: '过期的任务', dueDate: ms(15, '2026-09-30') },
    ]);
    // 09-30 在本周窗口（09-28 起）内 → 不截断、不消失
    expect(el.querySelector('[data-testid="timeline-point-late"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="timeline-overdue-late"]')?.textContent).toContain('逾期');
    // 落在过去那一天的格内（位于今天刻度的左侧）
    const todayLeft = leftPercent(el, 'timeline-today-tick');
    expect(leftPercent(el, 'timeline-point-late')).toBeLessThan(todayLeft);
  });
});

describe('紧凑刻度（compactTicks）：窄屏密度减半', () => {
  /** 直接渲染共享板（TimelinePanel 没有透传 compact；这是移动端宿主的口）。 */
  function CompactHarness(): React.JSX.Element {
    const labels = useTimelineLabels();
    return (
      <HeytaUiProvider>
        <TimelineBoard
          rows={[
            { taskId: 'a', title: '甲', position: { kind: 'point', atMs: ms(15) }, aiMinutes: undefined },
          ]}
          today={DAY}
          now={NOW}
          compactTicks
          labels={labels.board}
        />
      </HeytaUiProvider>
    );
  }

  it('🔴 一周窗口的紧凑档：刻度数减半、今天的刻度不被跳掉（411dp 放不下 7 个标签）', () => {
    const wide = renderBoard([{ id: 'a', title: '甲', dueDate: ms(15) }]);
    const wideCount = wide.querySelectorAll('[data-testid^="timeline-tick-"]').length;
    const compact = renderElement(<CompactHarness />);
    const compactCount = compact.querySelectorAll('[data-testid^="timeline-tick-"]').length;
    expect(wideCount).toBe(7);
    expect(compactCount).toBeLessThan(wideCount);
    expect(compactCount).toBeGreaterThanOrEqual(3);
    // 今天的刻度保留（蓝色高亮那句）
    const todayTick = compact.querySelectorAll('[data-testid^="timeline-tick-"]');
    const texts = Array.from(todayTick).map((n) => n.textContent ?? '');
    expect(texts.some((t) => t.includes('今天'))).toBe(true);
  });
});

describe('P2：range（排期条）的生产者与渲染', () => {
  it('🔴 startDate + durationMinutes ⇒ 板上是一条 `timeline-bar`（不再是点），几何量 = 时长', () => {
    const start = parseLocalDate('2026-10-02').getTime() + 9 * 3_600_000;
    const el = renderBoard([
      {
        id: 'sched',
        title: '已排期的任务',
        startDate: start,
        durationMinutes: 120,
      } as TimelineTaskLike,
    ]);
    const bar = el.querySelector('[data-testid="timeline-bar-sched"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(el.querySelector('[data-testid="timeline-point-sched"]')).toBeNull();
    // 行头文字面仍在（无障碍不许丢）：标题 + 起点日期
    const rowText = el.querySelector('[data-testid="timeline-row-sched"]')?.textContent ?? '';
    expect(rowText).toContain('已排期的任务');
    expect(rowText).toContain('10-02');
  });

  it('durationMinutes 单独存在 ⇒ unscheduled（绝不编一条 —— ADR-0043 §3）', () => {
    const el = renderBoard([
      { id: 'no-start', title: '只有时长', durationMinutes: 90 } as TimelineTaskLike,
    ]);
    expect(el.querySelector('[data-testid="timeline-bar-no-start"]')).toBeNull();
    expect(el.querySelector('[data-testid="timeline-lane-item-no-start"]')).toBeTruthy();
  });
});

describe('全天 vs 有时刻（落笔位置）', () => {
  it('🔴 全天截止（0 点）的菱形落在**当天日格内**（不是日界线上），行头只有日期', () => {
    const allDay = parseLocalDate('2026-10-02').getTime(); // 0 点整
    const el = renderBoard([
      { id: 'allday', title: '全天任务', dueDate: allDay },
      { id: 'timed', title: '有时刻', dueDate: ms(15) },
    ]);
    const tick02 = leftPercent(el, `timeline-tick-${String(ms(0, '2026-10-02'))}`);
    const tick03 = leftPercent(el, `timeline-tick-${String(ms(0, '2026-10-03'))}`);
    const allDayLeft = leftPercent(el, 'timeline-point-allday');
    expect(allDayLeft).toBeGreaterThan(tick02); // 严格在 10-02 格内
    expect(allDayLeft).toBeLessThan(tick03);
    // 行头只有日期、没有钟点
    const rowText = el.querySelector('[data-testid="timeline-row-allday"]')?.textContent ?? '';
    expect(rowText).toContain('10-02');
    expect(rowText).not.toContain('0:00');
  });

  it('次日 12 点（全天）的菱形比当天 15:00（有时刻）更靠右 —— 顺序与时间一致', () => {
    const el = renderBoard([
      { id: 'timed', title: '今天 15:00', dueDate: ms(15) },
      { id: 'allday', title: '明天全天', dueDate: parseLocalDate('2026-10-02').getTime() },
    ]);
    expect(leftPercent(el, 'timeline-point-allday')).toBeGreaterThan(
      leftPercent(el, 'timeline-point-timed'),
    );
  });
});

/**
 * 选中（工单 W1）：时间线是任务的**第三种投影**，它必须跟随同一个选中。
 *
 * 🔴 **载体**：底色判据走 `getComputedStyle`，**不能用 `el.style.*`**。
 * 实测（2026-10-03 一次性探针）：RNW 把样式对象编译成 class
 * （`r-backgroundColor-o5e8d5`），不写内联 `style`，于是 `el.style.backgroundColor`
 * 恒为 `''` —— 拿它当判据会得到"三种投影全都没底色"这种**看起来像三个真缺陷**的空读数。
 * （对照：本文件上面那批几何判据读 `style.left` 是有效的，那是运行时算出的内联值。）
 */
describe('选中：时间线这一种投影也跟随', () => {
  const TWO = [
    { id: 'a', title: '甲', dueDate: ms(15) },
    { id: 'b', title: '乙', dueDate: ms(16) },
  ];

  /** 行在板上那一行（`timeline-row-*` 就是挂 `onPress` 的那颗 Pressable）。 */
  const rowOf = (el: HTMLElement, id: string): HTMLElement | null =>
    el.querySelector<HTMLElement>(`[data-testid="timeline-row-${id}"]`);

  const paint = (el: HTMLElement, id: string): string => {
    const node = rowOf(el, id);
    expect(node, `行 ${id} 没渲染出来`).not.toBeNull();
    return getComputedStyle(node as Element).backgroundColor.trim();
  };

  /** 探针实测：未选中是 `rgba(0, 0, 0, 0)`（透明），不是 `''`。 */
  const TRANSPARENT = 'rgba(0, 0, 0, 0)';

  function press(el: HTMLElement | null): void {
    expect(el, '要点的行没渲染出来').not.toBeNull();
    act(() => {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
        (el as HTMLElement).dispatchEvent(
          type.startsWith('pointer')
            ? new PointerEvent(type, { bubbles: true, pointerId: 1 })
            : new MouseEvent(type, { bubbles: true }),
        );
      }
    });
  }

  it('🔴 只给 activeTaskId 那一条画底色，另外两条情形都是透明', () => {
    const el = renderElement(
      <TimelinePanel tasks={TWO} today={DAY} now={NOW} activeTaskId="b" />,
    );
    const selected = paint(el, 'b');
    expect(selected, 'activeTaskId 那一行没有底色').not.toBe(TRANSPARENT);
    expect(paint(el, 'a'), '没被选中的行也画了底色 —— 高亮等于没有信息').toBe(TRANSPARENT);

    // 阳性对照：不递 activeTaskId 时**两条都**该是透明。
    // 少了这一句，"高亮"可能量的只是行自己的默认底色，用例会在一个根本没有
    // 高亮的实现上照样绿。
    const bare = renderBoard(TWO);
    expect(paint(bare, 'a') + paint(bare, 'b'), '没递 activeTaskId 却有底色').toBe(
      TRANSPARENT + TRANSPARENT,
    );
  });

  it('🔴 点一行 ⇒ 宿主收到那一行的 id（此前 web 的行体根本不可点，触屏端早能）', () => {
    const seen: string[] = [];
    const el = renderElement(
      <TimelinePanel tasks={TWO} today={DAY} now={NOW} onOpenTask={(id) => seen.push(id)} />,
    );
    press(rowOf(el, 'b'));
    // 计数器是"事件没被吞"的阳性对照：为空时这条用例什么都没测。
    expect(seen, '一次按下没到达宿主').toEqual(['b']);
  });

  /**
   * 无障碍表面**当前**的样子，钉住它并在改的时候红一次。
   *
   * 🔴 已登记缺口（工单 §8）：这一行的 `role` 是 `listitem` 而不是 `button` ——
   * `TimelineBoard` 在同一个 `Pressable` 上同时给了硬写的 `role="listitem"` 与
   * 条件 `accessibilityRole="button"`，而 RNW 让前者胜出（实测两种接线状态下
   * `role`、`tabindex="0"`、`cursor: pointer` **三者都一样**）。
   * 后果：读屏用户听到"列表项"而不是"按钮"，但键盘与点击是能用的。
   * 本条断言的是现状而不是理想 —— 将来谁把它改成 `button`（或改成外层
   * `listitem` + 内层 `button`）时这里会红，那是**该红**：它要求改的人顺手
   * 把这条缺口划掉，而不是让它悄悄漂成"没人记得为什么长这样"。
   */
  it('无障碍表面现状：可点但报 listitem（缺口已登记，改动要显式认领）', () => {
    const el = renderElement(
      <TimelinePanel tasks={TWO} today={DAY} now={NOW} onOpenTask={() => {}} />,
    );
    const row = rowOf(el, 'b');
    expect(row?.getAttribute('role')).toBe('listitem');
    expect(row?.getAttribute('tabindex'), '可点的行拿不到焦点').toBe('0');
  });
});
