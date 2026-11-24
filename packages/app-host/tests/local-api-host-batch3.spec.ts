/**
 * 工具层补全 P2（批次 3）—— `submitIntent` 的分发判据（seam 层）
 * ================================================================
 *
 * 这一组用例只守**一件事**：契约 §2 的那 6 条 `intent.action` 是不是真的被翻成了
 * **对应那个动作方法、且参数正确**；"不存在的东西"有没有在门口被挡成
 * `{ ok:false, reason:'not-found' }`；以及动作层会 throw 的两条
 * （`createSubtask` 的非法父/超深、`setRepeat` 的非法 RRULE）有没有被翻成
 * `{ ok:false, reason:'invalid' }`；`restoreHabit` 的三种出口
 * （true / false / throw）有没有分别落成 ok / not-found / not-found。
 *
 * 为什么用**假 action 桩**：同 `local-api-host-batch2.spec.ts` 的理由 —— 这一层要证的是
 * **接线**本身（"create-subtask 该调 `createSubtask` 还是 `create`"是 switch 的决定），
 * 用真引擎会被领域实现盖住（方法内部再判一次存在性，接线错了也未必红）。
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
  // `listHabits` 直接读 `holder.state.habits` —— 于是测试里对 `state.habits` 的播种
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
    listFilters: () => Promise.resolve([]),
    listHabits: vi.fn(() => Object.values(holder.state.habits).filter(isAlive)),
    listLogs: vi.fn(() => []),
    renameHabit: vi.fn(async (_entityId: string, _name: string): Promise<void> => undefined),
    removeHabit: vi.fn(async (_entityId: string): Promise<void> => undefined),
    restoreHabit: vi.fn(async (_entityId: string): Promise<boolean> => true),
  };
  const projectActions = {
    listProjects: vi.fn(() => []),
    listAllProjects: vi.fn(() => []),
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
    habitLogId: vi.fn(() => 'log'),
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
    createSubtask: vi.fn(async (_parentId: string, _title: string): Promise<string> => 'child-1'),
    setNote: vi.fn(async (_entityId: string, _note: string | undefined): Promise<void> => undefined),
    setRepeat: vi.fn(async (_entityId: string, _rule: string | undefined): Promise<void> => undefined),
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
  stubs.habitActions.restoreHabit.mockResolvedValue(true);
});

// ───────────────────────────────────────────────────────────────────────────
// 任务：子任务 / 备注 / 重复
// ───────────────────────────────────────────────────────────────────────────

describe('子任务：create-subtask', () => {
  it('create-subtask → 先验父存在，再 actions.createSubtask(parentId, title)，回 ok + taskId', async () => {
    actions.findTask.mockReturnValue({ id: 'p1' });
    actions.createSubtask.mockResolvedValueOnce('child-9');
    const result = await makeHost().submit({
      action: 'create-subtask',
      parentId: 'p1',
      title: '买菜',
    });
    expect(actions.findTask).toHaveBeenCalledWith('p1');
    expect(actions.createSubtask).toHaveBeenCalledTimes(1);
    expect(actions.createSubtask).toHaveBeenCalledWith('p1', '买菜');
    expect(result).toEqual({ ok: true, taskId: 'child-9' });
  });

  it('create-subtask：父不存在 ⇒ not-found，且**不调** createSubtask', async () => {
    actions.findTask.mockReturnValue(undefined);
    const result = await makeHost().submit({
      action: 'create-subtask',
      parentId: 'ghost',
      title: '买菜',
    });
    expect(actions.createSubtask).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('create-subtask：createSubtask throw（超深 / 超子数 / 非法父）⇒ invalid，并把原因带出来', async () => {
    actions.findTask.mockReturnValue({ id: 'p1' });
    actions.createSubtask.mockRejectedValueOnce(
      new Error('建子任务被拒绝（depth_exceeded）：父 p1'),
    );
    const result = await makeHost().submit({
      action: 'create-subtask',
      parentId: 'p1',
      title: '买菜',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.message).toContain('depth_exceeded');
    }
  });

  it('create-subtask：createSubtask **同步** throw 也被 try/catch 翻成 invalid', async () => {
    actions.findTask.mockReturnValue({ id: 'p1' });
    actions.createSubtask.mockImplementationOnce(() => {
      throw new Error('建子任务被拒绝（children_exceeded）：父 p1');
    });
    const result = await makeHost().submit({
      action: 'create-subtask',
      parentId: 'p1',
      title: '买菜',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });
});

describe('任务备注：set-task-note', () => {
  it('set-task-note → 先验存在，再 actions.setNote(taskId, note)，回 ok', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({
      action: 'set-task-note',
      taskId: 't1',
      note: '记得开发票',
    });
    expect(actions.findTask).toHaveBeenCalledWith('t1');
    expect(actions.setNote).toHaveBeenCalledWith('t1', '记得开发票');
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('set-task-note（省略 note）→ setNote(taskId, undefined)，即清除', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    await makeHost().submit({ action: 'set-task-note', taskId: 't1' });
    expect(actions.setNote).toHaveBeenCalledWith('t1', undefined);
  });

  it('set-task-note：任务不存在 ⇒ not-found，且**不调** setNote', async () => {
    actions.findTask.mockReturnValue(undefined);
    const result = await makeHost().submit({ action: 'set-task-note', taskId: 'ghost', note: 'x' });
    expect(actions.setNote).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

describe('任务重复：set-task-repeat', () => {
  it('set-task-repeat → 先验存在，再 actions.setRepeat(taskId, rule)，回 ok', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({
      action: 'set-task-repeat',
      taskId: 't1',
      rule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    expect(actions.findTask).toHaveBeenCalledWith('t1');
    expect(actions.setRepeat).toHaveBeenCalledWith('t1', 'FREQ=WEEKLY;BYDAY=MO');
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('set-task-repeat（省略 rule）→ setRepeat(taskId, undefined)，即清除', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    await makeHost().submit({ action: 'set-task-repeat', taskId: 't1' });
    expect(actions.setRepeat).toHaveBeenCalledWith('t1', undefined);
  });

  it('set-task-repeat：任务不存在 ⇒ not-found，且**不调** setRepeat', async () => {
    actions.findTask.mockReturnValue(undefined);
    const result = await makeHost().submit({ action: 'set-task-repeat', taskId: 'ghost', rule: 'FREQ=DAILY' });
    expect(actions.setRepeat).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('set-task-repeat：非法 RRULE（setRepeat throw）⇒ invalid，并把原因带出来', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    actions.setRepeat.mockRejectedValueOnce(new Error('无效的重复规则：NOT-A-RRULE'));
    const result = await makeHost().submit({
      action: 'set-task-repeat',
      taskId: 't1',
      rule: 'NOT-A-RRULE',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.message).toContain('NOT-A-RRULE');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 习惯：改名 / 删除 / 恢复
// ───────────────────────────────────────────────────────────────────────────

describe('习惯改名：rename-habit', () => {
  it('rename-habit → 先验存在，再 habitActions.renameHabit(habitId, name)，回 HABIT 形状', async () => {
    state.habits['h1'] = { id: 'h1', name: '旧名' };
    const result = await makeHost().submit({ action: 'rename-habit', habitId: 'h1', name: '新名' });
    expect(stubs.habitActions.renameHabit).toHaveBeenCalledWith('h1', '新名');
    expect(result).toEqual({ ok: true, taskId: 'h1', entityId: 'h1', entityType: 'HABIT' });
  });

  it('rename-habit：名称全空白 ⇒ invalid，且**不调** renameHabit', async () => {
    state.habits['h1'] = { id: 'h1', name: '旧名' };
    const result = await makeHost().submit({ action: 'rename-habit', habitId: 'h1', name: '   ' });
    expect(stubs.habitActions.renameHabit).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('rename-habit：习惯不存在（或已删除）⇒ not-found，且**不调** renameHabit', async () => {
    state.habits['h1'] = { id: 'h1', name: '旧名', deletedAt: 5 };
    const result = await makeHost().submit({ action: 'rename-habit', habitId: 'h1', name: '新名' });
    expect(stubs.habitActions.renameHabit).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

describe('习惯删除：delete-habit', () => {
  it('delete-habit → 先验存在，再 habitActions.removeHabit(habitId)，回 HABIT 形状', async () => {
    state.habits['h1'] = { id: 'h1', name: '喝水' };
    const result = await makeHost().submit({ action: 'delete-habit', habitId: 'h1' });
    expect(stubs.habitActions.removeHabit).toHaveBeenCalledWith('h1');
    expect(result).toEqual({ ok: true, taskId: 'h1', entityId: 'h1', entityType: 'HABIT' });
  });

  it('delete-habit：习惯不存在 ⇒ not-found，且**不调** removeHabit', async () => {
    const result = await makeHost().submit({ action: 'delete-habit', habitId: 'ghost' });
    expect(stubs.habitActions.removeHabit).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

describe('习惯恢复：restore-habit', () => {
  it('restore-habit → habitActions.restoreHabit(habitId)，true 则 ok', async () => {
    stubs.habitActions.restoreHabit.mockResolvedValueOnce(true);
    const result = await makeHost().submit({ action: 'restore-habit', habitId: 'h1' });
    expect(stubs.habitActions.restoreHabit).toHaveBeenCalledWith('h1');
    expect(result).toEqual({ ok: true, taskId: 'h1', entityId: 'h1', entityType: 'HABIT' });
  });

  it('restore-habit：restoreHabit 回 false（本来就没删）⇒ not-found', async () => {
    stubs.habitActions.restoreHabit.mockResolvedValueOnce(false);
    const result = await makeHost().submit({ action: 'restore-habit', habitId: 'h1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('restore-habit：restoreHabit throw（不存在 / 已彻底删除）⇒ not-found，交给动作层判（I5）', async () => {
    // 🔴 I5：本层不读原始 `habits` 表、不自己判"在不在回收站/是否已 purge" —— 交给 restoreHabit。
    stubs.habitActions.restoreHabit.mockRejectedValueOnce(new Error('习惯「h1」已被彻底删除，无法恢复'));
    const result = await makeHost().submit({ action: 'restore-habit', habitId: 'h1' });
    expect(stubs.habitActions.restoreHabit).toHaveBeenCalledWith('h1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});
