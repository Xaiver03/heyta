/**
 * 选择器测试
 * ===========
 *
 * 这一层不定义业务口径，所以这里测的**不是**"今天是什么"（那在 domain 测），
 * 而是四件本层独有的、错了会很难归因的事：
 *
 *   1. 🔴 **与「今日进度」同源** —— 组件列出的条数必须恒等于进度条的 `tasksPlanned`。
 *      不同源的症状是"网页说 5 件、组件列了 4 件"，两边都不报错。
 *   2. 🔴 **字段映射** —— `Habit.name` → `title`、`completedAt` → `isDone`、
 *      `projectId` 省略而不是 `null`。映射写错的症状是"某一端少显示一列"。
 *   3. 🔴 **截断** —— 超限要**截**（应用侧的责任），不是丢给契约去拒。
 *   4. 🔴 **不变量** —— 不修改入参、空闲专注不泄露计划时长。
 */

import { describe, expect, it } from 'vitest';

import {
  computeTodayProgress,
  type FocusState,
  type Habit,
  type HabitLog,
  type Project,
  type Task,
} from '@heyta/domain';

import { WIDGET_MAX_TASKS } from '../src/contract.js';
import {
  buildWidgetPayload,
  selectFocus,
  selectHabits,
  selectProjectColors,
  selectQuadrant,
  selectTodayTasks,
  type WidgetSelectorInput,
} from '../src/selectors.js';
import { localNoon } from './fixture-source.js';

const TODAY = '2026-09-27'; // 周日
const NOW = localNoon(TODAY) + 15 * 60 * 60 * 1000;

function task(over: Partial<Task> & Pick<Task, 'id'>): Task {
  return { title: `任务 ${over.id}`, createdAt: 0, updatedAt: 0, ...over };
}

function habit(over: Partial<Habit> & Pick<Habit, 'id'>): Habit {
  return { name: `习惯 ${over.id}`, createdAt: 0, updatedAt: 0, ...over };
}

function makeInput(over: Partial<WidgetSelectorInput> = {}): WidgetSelectorInput {
  return {
    tasks: [],
    habits: [],
    logs: [],
    projects: [],
    today: TODAY,
    now: NOW,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────
// 1. 与今日进度同源
// ─────────────────────────────────────────────────────────────
describe('🔴 selectTodayTasks 与「今日进度」同源', () => {
  const progressOf = (tasks: Task[]) =>
    computeTodayProgress({ habits: [], logs: [], tasks, focusSessions: [], today: TODAY })
      .tasksPlanned;

  /**
   * 🔴 **必须逐个探针单独比，不能只比一个混合语料的条数。**
   *
   * 这不是理论担忧 —— 我第一次写的就是混合语料 + 比条数，然后拿一次
   * "把判据 fork 成只认今天到期"的注入去试它，结果它**没红**：
   *
   *   - 注入版多算了「今天到期但昨天已完成」（正确实现要排除）
   *   - 注入版少算了「逾期未完成」（正确实现要包含）
   *   - 一个 +1、一个 −1 → 条数相等 → 测试通过
   *
   * 也就是说，比**条数**的等价性测试有**抵消式假阴性**：两种相反的错误能互相掩盖。
   * 单个探针只有"进或不进"两种结果，不可能抵消，所以下面每一条都是硬边界。
   * 混合语料那条保留作补充，但它**不是**这条性质的主要守卫。
   */
  const PROBES: { name: string; probe: Task }[] = [
    { name: '今天到期未完成', probe: task({ id: 'due_today', dueDate: localNoon(TODAY) }) },
    { name: '逾期未完成', probe: task({ id: 'overdue', dueDate: localNoon('2026-09-20') }) },
    { name: '明天到期', probe: task({ id: 'due_tomorrow', dueDate: localNoon('2026-09-28') }) },
    { name: '无截止日', probe: task({ id: 'no_due' }) },
    {
      name: '今天到期且今天完成',
      probe: task({ id: 'done_today', dueDate: localNoon(TODAY), completedAt: localNoon(TODAY) }),
    },
    {
      name: '🔴 今天到期但昨天已完成',
      probe: task({
        id: 'done_yesterday',
        dueDate: localNoon(TODAY),
        completedAt: localNoon('2026-09-26'),
      }),
    },
    {
      name: '🔴 逾期且昨天已完成',
      probe: task({
        id: 'overdue_done',
        dueDate: localNoon('2026-09-20'),
        completedAt: localNoon('2026-09-26'),
      }),
    },
    {
      name: '今天到期但已删除',
      probe: task({ id: 'deleted', dueDate: localNoon(TODAY), deletedAt: 1 }),
    },
    {
      name: '无截止日但今天完成（计划外）',
      probe: task({ id: 'bonus', completedAt: localNoon(TODAY) }),
    },
  ];

  it.each(PROBES)('单探针：$name', ({ probe }) => {
    expect(selectTodayTasks(makeInput({ tasks: [probe] })).length).toBe(progressOf([probe]));
  });

  it('混合语料也一致（补充，非主要守卫 —— 见上方注释）', () => {
    const tasks = PROBES.map((p) => p.probe);
    expect(selectTodayTasks(makeInput({ tasks })).length).toBe(progressOf(tasks));
  });

  it('空列表两边都是 0', () => {
    expect(selectTodayTasks(makeInput()).length).toBe(progressOf([]));
  });

  it('边界：今天 00:00 与 23:59 都算今天', () => {
    // 用 `localNoon` 之外的时刻，专门试日界 —— 这是"本地日"最容易错的地方。
    const dayStart = localNoon(TODAY) - 12 * 60 * 60 * 1000;
    const dayEnd = localNoon(TODAY) + 11 * 60 * 60 * 1000 + 59 * 60 * 1000;
    const tasks = [
      task({ id: 'start', dueDate: dayStart }),
      task({ id: 'end', dueDate: dayEnd }),
    ];
    expect(selectTodayTasks(makeInput({ tasks })).map((t) => t.id)).toEqual(['start', 'end']);
    expect(selectTodayTasks(makeInput({ tasks })).length).toBe(progressOf(tasks));
  });
});

// ─────────────────────────────────────────────────────────────
// 2. 字段映射
// ─────────────────────────────────────────────────────────────
describe('字段映射', () => {
  it('🔴 习惯的 `name` 映射成契约里的 `title`', () => {
    const result = selectHabits(
      makeInput({ habits: [habit({ id: 'h1', name: '喝水', frequency: { type: 'daily' } })] }),
    );
    expect(result).toEqual([{ id: 'h1', title: '喝水', doneToday: false, streak: 0 }]);
  });

  it('🔴 任务用 `completedAt` 派生 `isDone`，且 `projectId` 缺失时**键不存在**', () => {
    const result = selectTodayTasks(
      makeInput({
        tasks: [
          task({ id: 'a', dueDate: localNoon(TODAY), completedAt: localNoon(TODAY) }),
          task({ id: 'b', dueDate: localNoon(TODAY) }),
        ],
      }),
    );
    // 未完成的排前面
    expect(result[0]!.id).toBe('b');
    expect(result[0]).not.toHaveProperty('projectId');
    expect(result[1]!.isDone).toBe(true);
  });

  it('今日任务**不带** `quadrant`（两个视图的分工不重叠）', () => {
    const result = selectTodayTasks(
      makeInput({ tasks: [task({ id: 'a', dueDate: localNoon(TODAY), important: true })] }),
    );
    expect(result[0]).not.toHaveProperty('quadrant');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. 习惯的达成判据
// ─────────────────────────────────────────────────────────────
describe('selectHabits 的达成判据', () => {
  const water = habit({
    id: 'h1',
    name: '喝水',
    target: 3,
    goalType: 'atLeast',
    frequency: { type: 'daily' },
  });

  it('🔴 打过卡但没到目标值 → `doneToday` 仍是 false', () => {
    // "8 杯水只喝了 3 杯"不算达成。若某端实现成"有记录就算完成"，
    // 症状是"组件打了勾、进度条没满" —— 两个都对不上账。
    const logs: HabitLog[] = [
      { id: 'l1', habitId: 'h1', date: TODAY, value: 1, createdAt: 0, updatedAt: 0 },
    ];
    const [entry] = selectHabits(makeInput({ habits: [water], logs }));
    expect(entry!.doneToday).toBe(false);
  });

  it('达到目标值 → true', () => {
    const logs: HabitLog[] = [
      { id: 'l1', habitId: 'h1', date: TODAY, value: 3, createdAt: 0, updatedAt: 0 },
    ];
    const [entry] = selectHabits(makeInput({ habits: [water], logs }));
    expect(entry!.doneToday).toBe(true);
  });

  it('🔴 已删除的打卡记录等于没发生', () => {
    const logs: HabitLog[] = [
      { id: 'l1', habitId: 'h1', date: TODAY, value: 3, createdAt: 0, updatedAt: 0, deletedAt: 1 },
    ];
    const [entry] = selectHabits(makeInput({ habits: [water], logs }));
    expect(entry!.doneToday).toBe(false);
  });

  it('不排期（周三）的习惯不出现', () => {
    const result = selectHabits(
      makeInput({
        habits: [habit({ id: 'h1', frequency: { type: 'weekly', daysOfWeek: [3] } })],
      }),
    );
    expect(result).toEqual([]);
  });

  it('未设置频率 = 每天（`isScheduledOn` 的既有语义）', () => {
    const result = selectHabits(makeInput({ habits: [habit({ id: 'h1' })] }));
    expect(result).toHaveLength(1);
  });

  it('已删除的习惯不出现', () => {
    const result = selectHabits(
      makeInput({ habits: [habit({ id: 'h1', deletedAt: 1, frequency: { type: 'daily' } })] }),
    );
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. 四象限
// ─────────────────────────────────────────────────────────────
describe('selectQuadrant', () => {
  it('🔴 四个键永远都在（哪怕是空数组）', () => {
    // 四端是手写解析器；键会消失就意味着每端都要多一条分支。
    const result = selectQuadrant(makeInput());
    expect(Object.keys(result).sort()).toEqual(['1', '2', '3', '4']);
    for (const slot of ['1', '2', '3', '4']) expect(result[slot]).toEqual([]);
  });

  it('已完成与已删除的任务被排除，且每项都带自己的槽位号', () => {
    const result = selectQuadrant(
      makeInput({
        tasks: [
          task({ id: 'done', dueDate: localNoon(TODAY), completedAt: localNoon(TODAY) }),
          task({ id: 'deleted', dueDate: localNoon(TODAY), deletedAt: 1 }),
          task({ id: 'live', dueDate: localNoon(TODAY), important: true }),
        ],
      }),
    );
    const all = Object.values(result).flat();
    expect(all.map((t) => t.id)).toEqual(['live']);
    expect(all[0]!.quadrant).toBe(1);
  });

  it('`urgentWindowDays` 能传入并改变分桶', () => {
    // 4 天后到期：默认窗口（2 天）→ 不紧急；窗口放宽到 7 天 → 紧急
    const tasks = [task({ id: 'a', dueDate: localNoon('2026-10-01'), important: true })];
    const narrow = selectQuadrant(makeInput({ tasks }));
    const wide = selectQuadrant(makeInput({ tasks, urgentWindowDays: 7 }));
    expect(narrow['2']!.map((t) => t.id)).toEqual(['a']); // 重要不紧急
    expect(wide['1']!.map((t) => t.id)).toEqual(['a']); // 重要且紧急
  });
});

// ─────────────────────────────────────────────────────────────
// 5. 专注
// ─────────────────────────────────────────────────────────────
describe('selectFocus', () => {
  const base: FocusState = {
    phase: 'idle',
    kind: 'work',
    plannedMs: 25 * 60 * 1000,
    completedWorkCount: 0,
  };

  it('🔴 空闲时**不泄露**计划时长（与应用内的显示口径故意不同）', () => {
    // 应用内 `focusDisplayMs` 空闲返回 plannedMs（显示 25:00）——那是对的，因为
    // 静止的 00:00 在应用里像"坏了"。但组件空闲时要显示的是**「开始专注」按钮**；
    // 若这里也返回 1500 秒，用户会以为计时正在跑。所以这里必须什么都没有。
    const result = selectFocus(makeInput({ focus: base }));
    expect(result).toEqual({ active: false });
    expect(result).not.toHaveProperty('remainingSeconds');
    expect(result).not.toHaveProperty('targetSeconds');
  });

  it('没有专注功能（undefined）时同样是 active: false', () => {
    expect(selectFocus(makeInput())).toEqual({ active: false });
  });

  it('运行中：剩余秒数由结束时间戳算出', () => {
    const result = selectFocus(
      makeInput({
        focus: { ...base, phase: 'running', endsAt: NOW + 90_000, startedAt: NOW - 60_000 },
      }),
    );
    expect(result).toEqual({
      active: true,
      remainingSeconds: 90,
      targetSeconds: 1500,
      // 🔴 灵动岛 / Live Activity 的前提：一个**绝对**时刻。
      endsAt: NOW + 90_000,
    });
  });

  it('暂停中：用 `remainingMsOnPause`（暂停不丢已过去的进度）', () => {
    const result = selectFocus(
      makeInput({
        focus: { ...base, phase: 'paused', remainingMsOnPause: 42_000 },
      }),
    );
    expect(result.remainingSeconds).toBe(42);
  });

  it('🔴 暂停中**不带** `endsAt` —— 那个时刻已经不代表"会在那时结束"了', () => {
    // 暂停时 `state.endsAt` 仍然有一个值，但暂停会把它往前推。
    // 输出它 = 灵动岛按一个**错的**时刻倒计时，而且进度条会一格一格走：
    // 错得**有症状但看起来像在正常工作**。
    const result = selectFocus(
      makeInput({ focus: { ...base, phase: 'paused', remainingMsOnPause: 42_000 } }),
    );
    expect(result).not.toHaveProperty('endsAt');
    expect(result.active).toBe(true); // 仍然"在专注"，只是没有绝对终点
  });

  it('空闲 / 没有专注功能时同样不带 `endsAt`', () => {
    expect(selectFocus(makeInput({ focus: base }))).not.toHaveProperty('endsAt');
    expect(selectFocus(makeInput())).not.toHaveProperty('endsAt');
  });

  it('已到 0 时不出现负数', () => {
    const result = selectFocus(
      makeInput({ focus: { ...base, phase: 'running', endsAt: NOW - 60_000 } }),
    );
    expect(result.remainingSeconds).toBe(0);
  });

  it('关联任务时带上标题；任务不存在时不带（不崩）', () => {
    const withTask = selectFocus(
      makeInput({
        tasks: [task({ id: 't1', title: '写周报' })],
        focus: { ...base, phase: 'running', endsAt: NOW + 1000, taskId: 't1' },
      }),
    );
    expect(withTask.sessionTitle).toBe('写周报');

    const missing = selectFocus(
      makeInput({ focus: { ...base, phase: 'running', endsAt: NOW + 1000, taskId: 'gone' } }),
    );
    expect(missing).not.toHaveProperty('sessionTitle');
  });
});

// ─────────────────────────────────────────────────────────────
// 6. 清单颜色
// ─────────────────────────────────────────────────────────────
describe('selectProjectColors', () => {
  const projects: Project[] = [
    { id: 'p1', name: '工作', color: '3', createdAt: 0, updatedAt: 0 },
    { id: 'p2', name: '没设色', createdAt: 0, updatedAt: 0 },
    { id: 'p3', name: '坏数据', color: '99', createdAt: 0, updatedAt: 0 },
    { id: 'p4', name: '空串', color: '', createdAt: 0, updatedAt: 0 },
  ];

  it('🔴 解析成 { light, dark } 两个十六进制', () => {
    const result = selectProjectColors(projects, new Set(['p1']));
    expect(result['p1']).toEqual({ light: '#16a34a', dark: '#34d399' });
  });

  it('🔴 没设过色 / 槽位非法 / 清单不存在 → 一律不放进表里', () => {
    // 不放进去 = 原生查不到 → 用中性色。放进一个空值反而会让原生画成透明。
    const result = selectProjectColors(projects, new Set(['p2', 'p3', 'p4', 'p_missing']));
    expect(result).toEqual({});
  });

  it('没有被引用的清单时不查表（空集合直接返回）', () => {
    expect(selectProjectColors(projects, new Set())).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────
// 7. buildWidgetPayload
// ─────────────────────────────────────────────────────────────
describe('buildWidgetPayload', () => {
  it('🔴 五个字段永远都在（即使是空数组 / 空对象）', () => {
    const payload = buildWidgetPayload(makeInput());
    expect(Object.keys(payload).sort()).toEqual([
      'focus',
      'habits',
      'projectColors',
      'quadrant',
      'today',
    ]);
    expect(payload.today).toEqual([]);
    expect(payload.habits).toEqual([]);
    expect(payload.projectColors).toEqual({});
    expect(payload.focus).toEqual({ active: false });
  });

  it('只带上被今日/象限**实际引用**的清单颜色', () => {
    const payload = buildWidgetPayload(
      makeInput({
        tasks: [task({ id: 'a', dueDate: localNoon(TODAY), projectId: 'p1' })],
        projects: [
          { id: 'p1', name: '工作', color: '3', createdAt: 0, updatedAt: 0 },
          { id: 'p_unused', name: '没用到', color: '5', createdAt: 0, updatedAt: 0 },
        ],
      }),
    );
    expect(Object.keys(payload.projectColors!)).toEqual(['p1']);
  });

  it('产物能通过契约校验（选择器与契约自洽）', async () => {
    const { parsePayload } = await import('../src/contract.js');
    const payload = buildWidgetPayload(
      makeInput({
        tasks: [task({ id: 'a', dueDate: localNoon(TODAY), projectId: 'p1' })],
        habits: [habit({ id: 'h1', frequency: { type: 'daily' } })],
        projects: [{ id: 'p1', name: '工作', color: '3', createdAt: 0, updatedAt: 0 }],
      }),
    );
    const parsed = parsePayload(payload);
    expect(parsed.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 8. 不变量
// ─────────────────────────────────────────────────────────────
describe('不变量', () => {
  it('🔴 不修改传入的数组（排序不能原地改调用方的数据）', () => {
    const tasks = [
      task({ id: 'late', dueDate: localNoon('2026-09-30') }),
      task({ id: 'early', dueDate: localNoon(TODAY) }),
    ];
    const snapshot = tasks.map((t) => t.id);
    selectTodayTasks(makeInput({ tasks }));
    selectQuadrant(makeInput({ tasks }));
    expect(tasks.map((t) => t.id)).toEqual(snapshot);
  });

  it('🔴 超过上限时**截断**到 WIDGET_MAX_TASKS（不是抛错、不是截断到别处）', () => {
    // 契约拒绝 >20 的载荷，而"截断"是应用侧的责任 —— 就是这一层。
    const tasks = Array.from({ length: WIDGET_MAX_TASKS + 5 }, (_, i) =>
      // 截止日递增 → 排序后前 20 个恰好是 id 最小的 20 个
      task({ id: `t${String(i).padStart(2, '0')}`, dueDate: localNoon(TODAY) + i * 60_000 }),
    );
    const result = selectTodayTasks(makeInput({ tasks }));
    expect(result).toHaveLength(WIDGET_MAX_TASKS);
    expect(result[0]!.id).toBe('t00');
    expect(result[WIDGET_MAX_TASKS - 1]!.id).toBe(`t${WIDGET_MAX_TASKS - 1}`);
  });

  it('截断后的载荷能通过契约校验（边界正好不越界）', () => {
    const tasks = Array.from({ length: WIDGET_MAX_TASKS + 5 }, (_, i) =>
      task({ id: `t${i}`, dueDate: localNoon(TODAY) }),
    );
    const payload = buildWidgetPayload(makeInput({ tasks }));
    expect(payload.today).toHaveLength(WIDGET_MAX_TASKS);
  });
});
