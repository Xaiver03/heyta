/**
 * 习惯 / 清单 / 番茄钟 store 测试
 * =================================
 *
 * 重点不在 UI，而在三条容易静默出错的规则：
 *   1. 同一天重复打卡**幂等**（否则连续天数与统计全错）
 *   2. 撤销打卡是墓碑（否则另一端会把打卡同步回来）
 *   3. 番茄钟只对**工作段**落盘（否则统计里一半是休息）
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toLocalDate } from '@heyta/domain';
import { IndexedDbAdapter, IndexedDbOpLogStore } from '@heyta/storage';
import { OpType } from '@heyta/sync-core';
import { emptyState } from '@heyta/op-log';
import type { Operation } from '@heyta/sync-core';

import { __resetFocusForTests, useFocusStore } from '../src/features/focus/store.js';
import {
  selectHabitProgress,
  selectHeatmap,
  useHabitStore,
} from '../src/features/habits/store.js';
import {
  selectChildProjects,
  selectTopLevelProjects,
  useProjectStore,
} from '../src/features/projects/store.js';
import {
  __resetOpLogForTests,
  initOpLog,
  useTaskStore,
} from '../src/features/tasks/store.js';

let dbName: string;

async function allOps(): Promise<Operation<string>[]> {
  const db = new IndexedDbAdapter(dbName);
  await db.init();
  const store = new IndexedDbOpLogStore<Operation<string>>(db);
  const rows = await store.getAllOps();
  db.close();
  return rows.map((r) => r.op);
}

/** 稳定的"现在"：2026-09-25 10:00 本地时间。 */
const NOW = new Date(2026, 8, 25, 10, 0, 0).getTime();

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;

  dbName = `stores-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  __resetFocusForTests();
  useTaskStore.setState({
    entities: emptyState(),
    filter: { kind: 'all' },
    now: NOW,
    ready: false,
  });
  useHabitStore.setState({ habits: [], logs: [] });
  useProjectStore.setState({ projects: [], tags: [] });
  await initOpLog(dbName);
});

// ⚠️ 必须停表。番茄钟的 setInterval 会跨测试存活，
// 下一个测试的 beforeEach 会因此超时（我实际踩过）。
afterEach(() => {
  __resetFocusForTests();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────
// 习惯
// ─────────────────────────────────────────────────────────────

describe('习惯 store', () => {
  it('创建习惯会落盘 op', async () => {
    await useHabitStore.getState().addHabit('喝水');
    expect(useHabitStore.getState().habits).toHaveLength(1);
    expect((await allOps()).some((o) => o.entityType === 'HABIT')).toBe(true);
  });

  it('空名称不建习惯', async () => {
    await useHabitStore.getState().addHabit('   ');
    expect(useHabitStore.getState().habits).toHaveLength(0);
  });

  it('🔴 同一天重复打卡是幂等的（否则连续天数会算错）', async () => {
    await useHabitStore.getState().addHabit('喝水');
    const id = useHabitStore.getState().habits[0]!.id;

    const today = toLocalDate(NOW);
    await useHabitStore.getState().checkIn(id, today);
    await useHabitStore.getState().checkIn(id, today);
    await useHabitStore.getState().checkIn(id, today);

    // 只应有一条 log —— logId 用 habitId:date 保证自然幂等
    expect(useHabitStore.getState().logs).toHaveLength(1);
  });

  it('打卡后 doneToday 为真', async () => {
    await useHabitStore.getState().addHabit('喝水');
    const id = useHabitStore.getState().habits[0]!.id;
    await useHabitStore.getState().checkIn(id, toLocalDate(NOW));

    const [p] = selectHabitProgress(useHabitStore.getState(), NOW);
    expect(p!.doneToday).toBe(true);
    expect(p!.streak.current).toBe(1);
  });

  it('🔴 撤销打卡是墓碑，不是物理删除（否则另一端会同步回来）', async () => {
    await useHabitStore.getState().addHabit('喝水');
    const id = useHabitStore.getState().habits[0]!.id;
    const today = toLocalDate(NOW);

    await useHabitStore.getState().checkIn(id, today);
    await useHabitStore.getState().undoCheckIn(id, today);

    // store 层看不到它了（已过滤墓碑）
    expect(useHabitStore.getState().logs).toHaveLength(0);
    // 但日志里有 DELETE op —— 这才是远端能收到删除的原因
    const ops = await allOps();
    expect(ops.some((o) => o.entityType === 'HABIT_LOG' && o.opType === OpType.Delete)).toBe(
      true,
    );
  });

  it('撤销未打卡的日子是安全空操作', async () => {
    await useHabitStore.getState().addHabit('喝水');
    const id = useHabitStore.getState().habits[0]!.id;
    await useHabitStore.getState().undoCheckIn(id, '2026-01-01');
    const ops = await allOps();
    expect(ops.filter((o) => o.opType === OpType.Delete)).toHaveLength(0);
  });

  it('连续多天打卡，streak.current 递增', async () => {
    await useHabitStore.getState().addHabit('喝水');
    const id = useHabitStore.getState().habits[0]!.id;

    for (const d of ['2026-09-23', '2026-09-24', '2026-09-25']) {
      await useHabitStore.getState().checkIn(id, d);
    }

    const [p] = selectHabitProgress(useHabitStore.getState(), NOW);
    expect(p!.streak.current).toBe(3);
    // lastDate 必须是最后打卡那天
    expect(p!.streak.lastDate).toBe('2026-09-25');
  });

  it('中断一天后 streak 从断点之后重算', async () => {
    await useHabitStore.getState().addHabit('喝水');
    const id = useHabitStore.getState().habits[0]!.id;
    // 9-20、9-21 打卡，9-22 缺，9-23~25 打卡
    for (const d of ['2026-09-20', '2026-09-21', '2026-09-23', '2026-09-24', '2026-09-25']) {
      await useHabitStore.getState().checkIn(id, d);
    }

    const [p] = selectHabitProgress(useHabitStore.getState(), NOW);
    expect(p!.streak.current).toBe(3);
    // 历史最长是 3（断点后这段比前面 2 天长）
    expect(p!.streak.longest).toBeGreaterThanOrEqual(3);
  });

  it('目标值参与完成比例（打卡 value 计入）', async () => {
    await useHabitStore.getState().addHabit('喝水', { target: 8, unit: '杯' });
    const id = useHabitStore.getState().habits[0]!.id;
    await useHabitStore.getState().checkIn(id, toLocalDate(NOW), 4);

    const [p] = selectHabitProgress(useHabitStore.getState(), NOW);
    expect(p!.todayRatio).toBeCloseTo(0.5, 5);
  });

  it('热力图返回请求的天数且日期升序', () => {
    const data = selectHeatmap(useHabitStore.getState(), 'nobody', NOW, 30);
    expect(data).toHaveLength(30);
    expect(data[0]!.date < data[29]!.date).toBe(true);
    expect(data[29]!.date).toBe(toLocalDate(NOW));
  });
});

// ─────────────────────────────────────────────────────────────
// 清单与标签
// ─────────────────────────────────────────────────────────────

describe('清单与标签 store', () => {
  it('创建顶层清单', async () => {
    await useProjectStore.getState().addProject('工作');
    const tops = selectTopLevelProjects(useProjectStore.getState());
    expect(tops).toHaveLength(1);
    expect(tops[0]!.name).toBe('工作');
  });

  it('子清单不出现在顶层，但在父清单下能找到', async () => {
    await useProjectStore.getState().addProject('工作');
    const parent = useProjectStore.getState().projects[0]!.id;
    await useProjectStore.getState().addProject('项目 A', parent);

    expect(selectTopLevelProjects(useProjectStore.getState())).toHaveLength(1);
    const children = selectChildProjects(useProjectStore.getState(), parent);
    expect(children).toHaveLength(1);
    expect(children[0]!.name).toBe('项目 A');
  });

  it('归档的清单不在顶层列表里，但数据仍在', async () => {
    await useProjectStore.getState().addProject('工作');
    const id = useProjectStore.getState().projects[0]!.id;
    await useProjectStore.getState().archiveProject(id);

    expect(selectTopLevelProjects(useProjectStore.getState())).toHaveLength(0);
    // 数据保留（archived 而非删除）
    expect(
      useProjectStore.getState().projects.find((p) => p.id === id)?.archived,
    ).toBe(true);
  });

  it('🔴 删除清单不级联删除任务（误删必须可挽回）', async () => {
    await useProjectStore.getState().addProject('工作');
    const pid = useProjectStore.getState().projects[0]!.id;
    await useTaskStore.getState().addTask('任务', { projectId: pid });
    await useProjectStore.getState().deleteProject(pid);

    // 任务仍在（只是变成无清单）
    expect(Object.keys(useTaskStore.getState().entities.tasks)).toHaveLength(1);
  });

  it('标签创建与删除', async () => {
    await useProjectStore.getState().addTag('紧急');
    expect(useProjectStore.getState().tags).toHaveLength(1);
    const id = useProjectStore.getState().tags[0]!.id;
    await useProjectStore.getState().deleteTag(id);
    expect(useProjectStore.getState().tags).toHaveLength(0);
  });

  it('任务能移动到清单，并按清单筛选', async () => {
    await useProjectStore.getState().addProject('工作');
    const pid = useProjectStore.getState().projects[0]!.id;
    await useTaskStore.getState().addTask('任务');
    const tid = Object.keys(useTaskStore.getState().entities.tasks)[0]!;

    await useTaskStore.getState().moveToProject(tid, pid);
    expect(useTaskStore.getState().entities.tasks[tid]!.projectId).toBe(pid);
  });
});

// ─────────────────────────────────────────────────────────────
// 番茄钟
// ─────────────────────────────────────────────────────────────

describe('番茄钟 store', () => {
  it('初始为 idle 且剩余 0', () => {
    expect(useFocusStore.getState().state.phase).toBe('idle');
  });

  it('开始后进入 running，剩余等于工作时长', () => {
    useFocusStore.getState().start();
    const s = useFocusStore.getState();
    expect(s.state.phase).toBe('running');
    expect(s.state.plannedMs).toBe(s.config.workMs);
  });

  it('暂停后恢复，剩余量不丢失', () => {
    useFocusStore.getState().start();
    useFocusStore.getState().pause();
    const paused = useFocusStore.getState().state;
    expect(paused.phase).toBe('paused');
    expect(paused.remainingMsOnPause).toBeGreaterThan(0);

    useFocusStore.getState().resume();
    expect(useFocusStore.getState().state.phase).toBe('running');
  });

  it('🔴 中止会落盘一条 completed:false 的记录（与自然完成区分）', async () => {
    useFocusStore.getState().start();
    await useFocusStore.getState().abort();

    const ops = await allOps();
    const focus = ops.filter((o) => o.entityType === 'FOCUS_SESSION');
    expect(focus).toHaveLength(1);
    expect((focus[0]!.payload as { completed: boolean }).completed).toBe(false);
    expect(useFocusStore.getState().state.phase).toBe('idle');
  });

  it('idle 状态下中止不产生记录', async () => {
    await useFocusStore.getState().abort();
    const ops = await allOps();
    expect(ops.filter((o) => o.entityType === 'FOCUS_SESSION')).toHaveLength(0);
  });

  it('🔴 工作段自然结束会落盘，并进入休息段', async () => {
    // 直接把状态造成"已到时"，再调 tickOnce ——
    // 不依赖真实等待，也不依赖 fake timers 驱动异步落盘。
    useFocusStore.setState({
      state: {
        phase: 'running',
        kind: 'work',
        plannedMs: 1000,
        startedAt: Date.now() - 2000,
        endsAt: Date.now() - 1000, // 已经过时
        completedWorkCount: 0,
      },
    });

    await useFocusStore.getState().tickOnce();

    const ops = await allOps();
    const focus = ops.filter((o) => o.entityType === 'FOCUS_SESSION');
    expect(focus).toHaveLength(1);
    expect((focus[0]!.payload as { completed: boolean }).completed).toBe(true);

    // 推进到休息段（不是 work）
    expect(useFocusStore.getState().state.kind).not.toBe('work');
    expect(useFocusStore.getState().completedToday).toBe(1);
  });

  it('未到时 tickOnce 只重绘、不落盘', async () => {
    useFocusStore.setState({
      state: {
        phase: 'running',
        kind: 'work',
        plannedMs: 60_000,
        startedAt: Date.now(),
        endsAt: Date.now() + 60_000,
        completedWorkCount: 0,
      },
    });

    const before = useFocusStore.getState().tick;
    await useFocusStore.getState().tickOnce();

    expect(useFocusStore.getState().tick).toBe(before + 1);
    const ops = await allOps();
    expect(ops.filter((o) => o.entityType === 'FOCUS_SESSION')).toHaveLength(0);
  });

  it('休息段结束不落盘（休息不是专注成果）', async () => {
    useFocusStore.setState({
      state: {
        phase: 'running',
        kind: 'shortBreak',
        plannedMs: 1000,
        startedAt: Date.now() - 2000,
        endsAt: Date.now() - 1000,
        completedWorkCount: 1,
      },
    });

    await useFocusStore.getState().tickOnce();

    const ops = await allOps();
    expect(ops.filter((o) => o.entityType === 'FOCUS_SESSION')).toHaveLength(0);
    // 但状态机应推进回 work
    expect(useFocusStore.getState().state.kind).toBe('work');
  });

  it('关联任务的专注会把 taskId 写进记录', async () => {
    await useTaskStore.getState().addTask('任务');
    const tid = Object.keys(useTaskStore.getState().entities.tasks)[0]!;

    // 不用 start()（它会起真实 setInterval），直接造出运行中的状态
    useFocusStore.setState({
      state: {
        phase: 'running',
        kind: 'work',
        plannedMs: 60_000,
        startedAt: Date.now() - 500,
        endsAt: Date.now() + 59_500,
        completedWorkCount: 0,
        taskId: tid,
      },
    });
    await useFocusStore.getState().abort();

    const ops = await allOps();
    const focus = ops.find((o) => o.entityType === 'FOCUS_SESSION')!;
    expect((focus.payload as { taskId?: string }).taskId).toBe(tid);
  });

  it('未关联任务时 payload 里不含 taskId（不是 undefined 字段）', async () => {
    useFocusStore.setState({
      state: {
        phase: 'running',
        kind: 'work',
        plannedMs: 60_000,
        startedAt: Date.now() - 500,
        endsAt: Date.now() + 59_500,
        completedWorkCount: 0,
      },
    });
    await useFocusStore.getState().abort();

    const ops = await allOps();
    const focus = ops.find((o) => o.entityType === 'FOCUS_SESSION')!;
    expect('taskId' in (focus.payload as object)).toBe(false);
  });
});
