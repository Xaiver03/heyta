/**
 * 工具层补全 P2（批次 4）—— `submitIntent` 的分发判据（seam 层）
 * ================================================================
 *
 * 这一组用例只守**一件事**：契约 §2 的那 4 条 `intent.action` 是不是真的被翻成了
 * **对应那个动作方法、且参数正确**；"不存在的东西"有没有在门口被挡成
 * `{ ok:false, reason:'not-found' }`；空 `taskIds` 有没有被挡成
 * `{ ok:false, reason:'invalid' }`；批量 move 的"整批预检"有没有生效（任一不在就一条都不动）；
 * 以及 `undoCheckIn` 的三种出口（true / false / throw）有没有分别落成
 * ok / not-found / not-found。
 *
 * 为什么用**假 action 桩**：同 `local-api-host-batch2.spec.ts` / `local-api-host-batch3.spec.ts`
 * 的理由 —— 这一层要证的是**接线**本身（"set-task-important 该调 `setImportant` 还是 `setPriority`"
 * 是 switch 的决定），用真引擎会被领域实现盖住（方法内部再判一次存在性，接线错了也未必红）。
 *
 * `createLocalApiHost` 内部会**自己构造** habit/project 等动作集（不从参数注入），
 * 所以这里用 `vi.mock` 把工厂换成假对象；`actions: TaskActions` 本身就是入参，直接传假桩。
 * `ctx` 只需要 `getState()`（存在性校验读物化状态）与 `dispatch()`（桩不会用到）。
 */

import type { ActionContext, TaskActions } from '../src/actions.js';
import type { MaterializedState } from '@heyta/op-log';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ───────────────────────────────────────────────────────────────────────────
// 假 action 桩 —— 在模块层替换掉 createLocalApiHost 内部构造的动作集。
// ───────────────────────────────────────────────────────────────────────────
const stubs = vi.hoisted(() => {
  // `listAllProjects` / `listHabits` 直接读 `holder.state` —— 于是测试里对 `state` 的播种
  // 同时驱动"存在/不存在"两条腿，与生产一致（出口层不遍历原始表，判活交给动作层）。
  const holder: {
    state: {
      habits: Record<string, unknown>;
      projects: Record<string, unknown>;
      tags: Record<string, unknown>;
      notes: Record<string, unknown>;
    };
  } = { state: { habits: {}, projects: {}, tags: {}, notes: {} } };
  const isAlive = (x: unknown): boolean => (x as { deletedAt?: number }).deletedAt === undefined;

  const habitActions = {
    listHabits: vi.fn(() => Object.values(holder.state.habits).filter(isAlive)),
    listLogs: vi.fn(() => []),
    // 三种出口都由测试注入：true=已撤销、false=没打卡、throw=习惯不存在。
    undoCheckIn: vi.fn(async (_habitId: string, _date?: string): Promise<boolean> => true),
  };
  const projectActions = {
    listProjects: vi.fn(() => []),
    listAllProjects: vi.fn(() => Object.values(holder.state.projects).filter(isAlive)),
    listTags: vi.fn(() => []),
  };
  const noteActions = { listNotes: vi.fn(() => []) };
  const reminderActions = {};
  const eventActions = { listEvents: vi.fn(() => []) };
  const focusActions = { listSessions: vi.fn(() => []) };

  return {
    holder,
    habitActions,
    projectActions,
    noteActions,
    reminderActions,
    eventActions,
    focusActions,
    // 用真实形状（习惯:日期），让 `entityId` 断言能证明确实按"这一天"算出来的。
    habitLogId: vi.fn((habitId: string, date: string) => `${habitId}:${date}`),
    focusLogFailureCode: vi.fn(() => undefined),
  };
});

vi.mock('../src/project-actions.js', () => ({
  createProjectActions: () => stubs.projectActions,
}));
vi.mock('../src/note-actions.js', () => ({
  createNoteActions: () => stubs.noteActions,
}));
vi.mock('../src/reminder-actions.js', () => ({
  createReminderActions: () => stubs.reminderActions,
}));
vi.mock('../src/event-actions.js', () => ({
  createEventActions: () => stubs.eventActions,
}));
vi.mock('../src/habit-actions.js', () => ({
  createHabitActions: () => stubs.habitActions,
  habitLogId: stubs.habitLogId,
}));
vi.mock('../src/focus-actions.js', () => ({
  createFocusActions: () => stubs.focusActions,
  focusLogFailureCode: stubs.focusLogFailureCode,
}));

import { createLocalApiHost } from '../src/local-api-host.js';

// ───────────────────────────────────────────────────────────────────────────
// 台架
// ───────────────────────────────────────────────────────────────────────────

const CLOCK = 1_700_000_000_000;

interface FakeState {
  tasks: Record<string, Record<string, unknown>>;
  habits: Record<string, Record<string, unknown>>;
  projects: Record<string, Record<string, unknown>>;
  tags: Record<string, Record<string, unknown>>;
  notes: Record<string, Record<string, unknown>>;
}

function emptyState(): FakeState {
  return { tasks: {}, habits: {}, projects: {}, tags: {}, notes: {} };
}

/** TaskActions 的假桩（`actions` 是 `createLocalApiHost` 的入参，可直接注入）。 */
function makeTaskActionsStub() {
  return {
    findTask: vi.fn((): unknown => undefined),
    setImportant: vi.fn(async (_entityId: string, _important: boolean): Promise<void> => undefined),
    setPinned: vi.fn(async (_entityId: string, _pinned: boolean): Promise<void> => undefined),
    bulkMoveToProject: vi.fn(
      async (_entityIds: readonly string[], _projectId: string | undefined): Promise<void> => undefined,
    ),
    listTasks: vi.fn(() => []),
  };
}

let state: FakeState;
let actions: ReturnType<typeof makeTaskActionsStub>;

function makeHost() {
  const ctx = {
    dispatch: vi.fn(async () => undefined),
    getState: () => state as unknown as MaterializedState,
  } as unknown as ActionContext;
  return createLocalApiHost(ctx, actions as unknown as TaskActions, {
    isReadable: () => true,
    now: () => CLOCK,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state = emptyState();
  stubs.holder.state = state;
  actions = makeTaskActionsStub();
  stubs.habitActions.undoCheckIn.mockResolvedValue(true);
});

// ───────────────────────────────────────────────────────────────────────────
// 任务标记：set-task-important / set-task-pinned
// ───────────────────────────────────────────────────────────────────────────

describe('任务标记：set-task-important', () => {
  it('set-task-important → 先验存在，再 actions.setImportant(taskId, true)，回 ok + taskId', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'set-task-important', taskId: 't1', important: true });
    expect(actions.findTask).toHaveBeenCalledWith('t1');
    expect(actions.setImportant).toHaveBeenCalledTimes(1);
    expect(actions.setImportant).toHaveBeenCalledWith('t1', true);
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('set-task-important：important=false 也原样透传（不是"只认 true"）', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    await makeHost().submit({ action: 'set-task-important', taskId: 't1', important: false });
    expect(actions.setImportant).toHaveBeenCalledWith('t1', false);
  });

  it('set-task-important：任务不存在 ⇒ not-found，且**不调** setImportant', async () => {
    actions.findTask.mockReturnValue(undefined);
    const result = await makeHost().submit({ action: 'set-task-important', taskId: 'ghost', important: true });
    expect(actions.setImportant).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

describe('任务标记：set-task-pinned', () => {
  it('set-task-pinned → 先验存在，再 actions.setPinned(taskId, true)，回 ok + taskId', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'set-task-pinned', taskId: 't1', pinned: true });
    expect(actions.findTask).toHaveBeenCalledWith('t1');
    expect(actions.setPinned).toHaveBeenCalledWith('t1', true);
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('set-task-pinned：pinned=false 也原样透传（取消置顶）', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    await makeHost().submit({ action: 'set-task-pinned', taskId: 't1', pinned: false });
    expect(actions.setPinned).toHaveBeenCalledWith('t1', false);
  });

  it('set-task-pinned：任务不存在 ⇒ not-found，且**不调** setPinned', async () => {
    actions.findTask.mockReturnValue(undefined);
    const result = await makeHost().submit({ action: 'set-task-pinned', taskId: 'ghost', pinned: true });
    expect(actions.setPinned).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 任务批量：move-tasks
// ───────────────────────────────────────────────────────────────────────────

describe('任务批量：move-tasks', () => {
  it('move-tasks（带 projectId）→ 先验清单存在 + 全部任务存在，再 bulkMoveToProject(taskIds, projectId)，回 ok + taskIds', async () => {
    state.projects['p1'] = { id: 'p1', name: '目标清单' };
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({
      action: 'move-tasks',
      taskIds: ['t1', 't2'],
      projectId: 'p1',
    });
    expect(actions.bulkMoveToProject).toHaveBeenCalledTimes(1);
    expect(actions.bulkMoveToProject).toHaveBeenCalledWith(['t1', 't2'], 'p1');
    expect(result).toEqual({ ok: true, taskId: 't1', taskIds: ['t1', 't2'] });
  });

  it('move-tasks（省略 projectId）→ bulkMoveToProject(taskIds, undefined)，即移出到无清单', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'move-tasks', taskIds: ['t1'] });
    expect(actions.bulkMoveToProject).toHaveBeenCalledWith(['t1'], undefined);
    expect(result).toEqual({ ok: true, taskId: 't1', taskIds: ['t1'] });
  });

  it('move-tasks：空数组 ⇒ invalid，且**不调** bulkMoveToProject', async () => {
    const result = await makeHost().submit({ action: 'move-tasks', taskIds: [] });
    expect(actions.bulkMoveToProject).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('move-tasks：目标清单不存在 ⇒ not-found，且**不调** bulkMoveToProject', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({
      action: 'move-tasks',
      taskIds: ['t1'],
      projectId: 'ghost-project',
    });
    expect(actions.bulkMoveToProject).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('move-tasks：任一任务不存在 ⇒ not-found，且**不调** bulkMoveToProject（整批预检，不半批写入）', async () => {
    actions.findTask.mockReturnValueOnce({ id: 't1' }).mockReturnValueOnce(undefined);
    const result = await makeHost().submit({ action: 'move-tasks', taskIds: ['t1', 'ghost'] });
    expect(actions.bulkMoveToProject).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('move-tasks：重复 id 去重后再整批移动（避免同一条被搬两次）', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'move-tasks', taskIds: ['t1', 't1'] });
    expect(actions.bulkMoveToProject).toHaveBeenCalledWith(['t1'], undefined);
    expect(result).toEqual({ ok: true, taskId: 't1', taskIds: ['t1'] });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 习惯：undo-checkin
// ───────────────────────────────────────────────────────────────────────────

describe('习惯打卡撤销：undo-checkin', () => {
  it('undo-checkin（给定日期）→ habitActions.undoCheckIn(habitId, date)，回 HABIT_LOG 形状', async () => {
    stubs.habitActions.undoCheckIn.mockResolvedValueOnce(true);
    const result = await makeHost().submit({
      action: 'undo-checkin',
      habitId: 'h1',
      date: '2026-01-02',
    });
    expect(stubs.habitActions.undoCheckIn).toHaveBeenCalledWith('h1', '2026-01-02');
    expect(result).toEqual({
      ok: true,
      taskId: 'h1:2026-01-02',
      entityId: 'h1:2026-01-02',
      entityType: 'HABIT_LOG',
    });
  });

  it('undo-checkin（省略 date）→ 传今天的本地日期（YYYY-MM-DD）给动作层', async () => {
    stubs.habitActions.undoCheckIn.mockResolvedValueOnce(true);
    const result = await makeHost().submit({ action: 'undo-checkin', habitId: 'h1' });
    expect(stubs.habitActions.undoCheckIn).toHaveBeenCalledWith(
      'h1',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entityType).toBe('HABIT_LOG');
  });

  it('undo-checkin：undoCheckIn 回 false（那天本来就没打卡）⇒ not-found', async () => {
    stubs.habitActions.undoCheckIn.mockResolvedValueOnce(false);
    const result = await makeHost().submit({
      action: 'undo-checkin',
      habitId: 'h1',
      date: '2026-01-02',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('undo-checkin：undoCheckIn throw（习惯不存在）⇒ not-found，交给动作层判（I5）', async () => {
    // 🔴 I5：本层不读原始打卡表、不自己判"这一天有没有记录" —— 交给 undoCheckIn。
    stubs.habitActions.undoCheckIn.mockRejectedValueOnce(new Error('找不到习惯「ghost」'));
    const result = await makeHost().submit({
      action: 'undo-checkin',
      habitId: 'ghost',
      date: '2026-01-02',
    });
    expect(stubs.habitActions.undoCheckIn).toHaveBeenCalledWith('ghost', '2026-01-02');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});
