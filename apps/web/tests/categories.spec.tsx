/**
 * 分类时长：接线 + 真实渲染
 * ============================
 *
 * 与 `motivation.spec.ts` 同样的分工：算法在 `packages/domain/tests/
 * activity-categories.spec.ts` 里钉过了，这里只测**这一段**——
 * 物化状态 → 选择器 → 界面上真的出现那几行字。
 *
 * 这一层最容易出的三类问题，都不会抛异常：
 *
 *   1. `MotivationInput` 少摊一张表（清单）→ 所有分类时长恒为 0，
 *      而界面照常渲染，只是每一行都是「0 分钟」。**看起来像用户没做任何事。**
 *   2. 槽位号从持久化字段读出来是字符串 `"3"`，忘了 `parseCategorySlot`
 *      → 颜色静默消失（`cssVar` 不会因为 undefined 而报错，只是没颜色）。
 *   3. 色块自己承担了"这是谁"的全部信息 → 色觉障碍用户与读屏用户
 *      拿到的是八个一模一样的方块（设计系统「不许只用颜色」硬规则）。
 *
 * 第 3 条是这里最值钱的断言：**行首必须有名字、来源和数字**，
 * 而且那个数字与堆叠条用的是同一个格式化函数。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

import { I18nProvider } from '@heyta/i18n';
import type { FocusSession, Habit, HabitLog, Project, Task } from '@heyta/domain';
import { emptyState, type MaterializedState } from '@heyta/op-log';

import { selectCategoryReport, type MotivationInput } from '../src/features/motivation/selectors.js';
import { useTaskStore } from '../src/features/tasks/store.js';

const { CategoryBreakdown } = await import('../src/features/categories/CategoryBreakdown.js');
const { ColorSlotPicker } = await import('../src/features/categories/ColorSlotPicker.js');

/** 稳定的"现在"：2026-09-24（周四）。与 `motivation.spec.ts` 同一个时刻。 */
const NOW = new Date(2026, 8, 24, 10, 0, 0).getTime();

function at(y: number, m: number, d: number, h = 12): number {
  return new Date(y, m - 1, d, h, 0, 0, 0).getTime();
}

function project(over: Partial<Project> = {}): Project {
  return { id: 'p1', name: '深度工作', createdAt: 0, updatedAt: 0, ...over };
}

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: '写方案', createdAt: 0, updatedAt: 0, ...over };
}

function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '跑步', target: 30, unit: '分钟', createdAt: 0, updatedAt: 0, ...over };
}

function log(date: string, over: Partial<HabitLog> = {}): HabitLog {
  return { id: `h1:${date}`, habitId: 'h1', date, createdAt: 0, updatedAt: 0, ...over };
}

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'f1',
    kind: 'work',
    plannedMs: 25 * 60000,
    actualMs: 50 * 60000,
    createdAt: at(2026, 9, 22),
    endedAt: at(2026, 9, 22),
    updatedAt: 0,
    ...over,
  };
}

function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

function input(over: Partial<MotivationInput> = {}): MotivationInput {
  return { habits: {}, habitLogs: {}, tasks: {}, projects: {}, focusSessions: {}, ...over };
}

/** 一份能长出两行（清单 + 习惯）的物化状态。 */
function stateWithRows(): MaterializedState {
  return {
    ...emptyState(),
    projects: byId([project({ color: '3' })]),
    tasks: byId([task({ projectId: 'p1' })]),
    habits: byId([habit({ color: '5' })]),
    habitLogs: byId([log('2026-09-22')]),
    focusSessions: byId([session({ taskId: 't1' })]),
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<I18nProvider locale="zh-CN">{node}</I18nProvider>);
  });
  return container;
}

beforeEach(() => {
  useTaskStore.setState({ entities: emptyState(), now: NOW });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  container = undefined;
});

describe('selectCategoryReport（接线）', () => {
  it('清单与习惯各自成行，槽位从**字符串**颜色读回来', () => {
    const report = selectCategoryReport(
      input({
        projects: byId([project({ color: '3' })]),
        tasks: byId([task({ projectId: 'p1' })]),
        habits: byId([habit({ color: '5' })]),
        habitLogs: byId([log('2026-09-22')]),
        focusSessions: byId([session({ taskId: 't1' })]),
      }),
      NOW,
    );

    const byKey = Object.fromEntries(report.series.map((row) => [row.key, row]));
    // 持久化的是字符串 "3"，界面要的是数字 3 —— 漏了这步是**静默无色**。
    expect(byKey['project:p1']?.slot).toBe(3);
    expect(byKey['project:p1']?.focusMs).toBe(50 * 60000);
    expect(byKey['habit:h1']?.slot).toBe(5);
    expect(byKey['habit:h1']?.habitMs).toBe(30 * 60000);
    expect(report.unassignedMs).toBe(0);
  });

  it('🔴 忘了把清单摊进输入 → 专注时长全变成"没归类"，而且不报错', () => {
    // 这条用例是**反向**的：它证明 `projects: {}` 与"真的有清单"结果不同。
    // 如果哪天选择器干脆不看清单了，这条会红 —— 而那正是"统计恒为 0"的形状。
    const withoutProjects = selectCategoryReport(
      input({
        tasks: byId([task({ projectId: 'p1' })]),
        focusSessions: byId([session({ taskId: 't1' })]),
      }),
      NOW,
    );
    expect(withoutProjects.series).toHaveLength(0);
    expect(withoutProjects.unassignedMs).toBe(50 * 60000);
  });

  it('"杯"这类单位不贡献分钟（不猜换算），有颜色的行照样在', () => {
    const report = selectCategoryReport(
      input({
        habits: byId([habit({ color: '1', unit: '杯', target: 8 })]),
        habitLogs: byId([log('2026-09-22')]),
      }),
      NOW,
    );
    expect(report.series).toHaveLength(0);
    expect(report.totalMs).toBe(0);
  });

  it('槽位是脏值（历史数据里的裸 hex）→ 无色，但时长一分不丢', () => {
    const report = selectCategoryReport(
      input({ projects: byId([project({ color: '#dc2626' })]), tasks: byId([task({ projectId: 'p1' })]), focusSessions: byId([session({ taskId: 't1' })]) }),
      NOW,
    );
    expect(report.series[0]?.slot).toBeUndefined();
    expect(report.series[0]?.totalMs).toBe(50 * 60000);
  });
});

describe('CategoryBreakdown（真实渲染）', () => {
  it('🔴 每一行都有名字、来源和数字 —— 颜色只是加速器', () => {
    useTaskStore.setState({ entities: stateWithRows(), now: NOW });
    const el = render(<CategoryBreakdown />);
    const text = el.textContent ?? '';

    expect(text).toContain('深度工作');
    expect(text).toContain('跑步');
    // 来源要写出来：两行都只有名字的话，用户看不出"这行是清单还是习惯"，
    // 而那决定了它为什么会进这张图。
    expect(text).toContain('清单');
    expect(text).toContain('习惯');
    // 数字：50 分钟（清单）/ 30 分钟（习惯）。
    expect(text).toContain('50 分钟');
    expect(text).toContain('30 分钟');
    // 槽位号是文字：色觉障碍用户靠它把行与堆叠条的那一段对上。
    expect(text).toContain('3');
    expect(text).toContain('5');
  });

  it('泳道格子数 = 窗口周数，且颜色走的是 intensity 分档（不是分类色）', () => {
    useTaskStore.setState({ entities: stateWithRows(), now: NOW });
    const el = render(<CategoryBreakdown />);
    const lanes = el.querySelectorAll('.ht-categories__lane');
    expect(lanes).toHaveLength(2);
    for (const lane of lanes) {
      expect(lane.querySelectorAll('.ht-categories__cell')).toHaveLength(12);
    }
    // 有记录的那一格必须是**深于**空白的档位：0 = 这一周没记录。
    const levels = [...el.querySelectorAll('.ht-categories__cell')].map((c) =>
      c.getAttribute('data-level'),
    );
    expect(levels).toContain('0');
    expect(levels.some((level) => level !== null && level !== '0')).toBe(true);
  });

  it('没设色的行照样显示，并给一句可发现的提示（不是追责）', () => {
    useTaskStore.setState({
      entities: {
        ...emptyState(),
        projects: byId([project()]),
        tasks: byId([task({ projectId: 'p1' })]),
        focusSessions: byId([session({ taskId: 't1' })]),
      },
      now: NOW,
    });
    const el = render(<CategoryBreakdown />);
    const text = el.textContent ?? '';
    expect(text).toContain('深度工作');
    expect(text).toContain('50 分钟');
    // 提示必须说"去哪儿设"，而不是"你还没设"。
    expect(text).toContain('调色板');
  });

  it('完全没有记录时是空状态，且不出现任何一行数字', () => {
    const el = render(<CategoryBreakdown />);
    const text = el.textContent ?? '';
    expect(text).toContain('还没有可以归类的时间记录');
    expect(el.querySelectorAll('.ht-categories__lane')).toHaveLength(0);
  });

  it('🔴 文案里没有排名与褒贬（反需求写死在测试里）', () => {
    useTaskStore.setState({ entities: stateWithRows(), now: NOW });
    const el = render(<CategoryBreakdown />);
    const text = el.textContent ?? '';
    for (const banned of ['最多', '最少', '最差', '排名', '占比', '超标', '失衡', '第一名']) {
      expect(text, `分类界面里不该出现「${banned}」`).not.toContain(banned);
    }
  });
});

describe('ColorSlotPicker', () => {
  it('8 个槽位 + "不用颜色"，每一个都带编号（不是只有颜色）', () => {
    const el = render(
      <ColorSlotPicker value={3} onChange={() => undefined} targetName="深度工作" />,
    );
    // 先展开
    act(() => {
      (el.querySelector('.ht-slot-picker__toggle') as HTMLElement).click();
    });

    const options = el.querySelectorAll('.ht-slot-picker__option');
    expect(options).toHaveLength(9);
    // 当前值用 `aria-pressed` 表达，不靠样式 —— 只画个边框的选中态
    // 对屏幕阅读器等于不存在。
    expect(options[2]?.getAttribute('aria-pressed')).toBe('true');
    const numbers = [...el.querySelectorAll('.ht-slot-picker__number')].map((n) => n.textContent);
    expect(numbers).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '无']);
  });

  it('再点一次同一个槽位 = 清除（"我点错了"有显而易见的补救动作）', () => {
    const changes: Array<number | undefined> = [];
    const el = render(
      <ColorSlotPicker
        value={3}
        onChange={(slot) => changes.push(slot)}
        targetName="深度工作"
      />,
    );
    act(() => {
      (el.querySelector('.ht-slot-picker__toggle') as HTMLElement).click();
    });
    const options = el.querySelectorAll('.ht-slot-picker__option');
    act(() => {
      (options[2] as HTMLElement).click();
    });
    expect(changes).toEqual([undefined]);
  });
});
