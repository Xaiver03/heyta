/**
 * 工具层补全 P2（批次 2）—— `submitIntent` 的分发判据（seam 层）
 * ================================================================
 *
 * 这一组用例只守**一件事**：契约 §2 的那 6 条 `intent.action` 是不是真的被翻成了
 * **对应那个 action 方法、且参数正确**；"不存在的东西"有没有在门口被挡成
 * `{ ok:false, reason:'not-found' }`；以及 `setParent` 的 throw（环 / 超深 / 父不存在）
 * 有没有被翻成 `{ ok:false, reason:'invalid' }`。
 *
 * 为什么用**假 action 桩**：同 `local-api-host-lifecycle.spec.ts` 的理由 —— 这一层要证的是
 * **接线**本身（"reorder-task 该调 `setOrder` 还是 `setAbandoned`"是 switch 的决定），
 * 用真引擎会被领域实现盖住（方法内部再判一次存在性，接线错了也未必红）。
 *
 * `createLocalApiHost` 内部会**自己构造** project 动作集（不从参数注入），所以这里用
 * `vi.mock` 把工厂换成假对象；`actions: TaskActions` 本身就是入参，直接传假桩。
 * `ctx` 只需要 `getState()`（存在性校验读物化状态）与 `dispatch()`（桩不会用到）。
 */

import type { ActionContext, TaskActions } from '../src/actions.js';
import type { MaterializedState } from '@heyta/op-log';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ───────────────────────────────────────────────────────────────────────────
// 假 action 桩 —— 在模块层替换掉 createLocalApiHost 内部构造的 project 动作集。
// ───────────────────────────────────────────────────────────────────────────
const stubs = vi.hoisted(() => {
  // `listAllProjects` 直接读 `holder.state` —— 于是测试里对 `state.projects` 的播种
  // 同时驱动"存在/不存在"两条腿，与生产一致（出口层不许自己遍历原始表）。
  const holder: {
    state: { projects: Record<string, unknown>; tags: Record<string, unknown>; notes: Record<string, unknown> };
  } = { state: { projects: {}, tags: {}, notes: {} } };
  const isAlive = (x: unknown): boolean => (x as { deletedAt?: number }).deletedAt === undefined;
  const projectActions = {
    setParent: vi.fn(async (_entityId: string, _parentId?: string) => undefined),
    restoreProject: vi.fn(async (_entityId: string): Promise<boolean> => true),
    listAllProjects: vi.fn(() => Object.values(holder.state.projects).filter(isAlive)),
    listProjects: vi.fn(() => []),
    listTags: vi.fn(() => []),
  };
  const noteActions = {
    listNotes: vi.fn(() => []),
  };
  const reminderActions = {};
  const eventActions = {
    listEvents: vi.fn(() => []),
  };
  const habitActions = {
    listFilters: () => Promise.resolve([]),
    listHabits: vi.fn(() => []),
    listLogs: vi.fn(() => []),
  };
  const focusActions = {
    listSessions: vi.fn(() => []),
  };
  return {
    holder,
    projectActions,
    noteActions,
    reminderActions,
    eventActions,
    habitActions,
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
  projects: Record<string, Record<string, unknown>>;
  tags: Record<string, Record<string, unknown>>;
  notes: Record<string, Record<string, unknown>>;
  reminders: Record<string, Record<string, unknown>>;
  events: Record<string, Record<string, unknown>>;
}

function emptyState(): FakeState {
  return { tasks: {}, projects: {}, tags: {}, notes: {}, reminders: {}, events: {} };
}

/** TaskActions 的假桩（`actions` 是 `createLocalApiHost` 的入参，可直接注入）。 */
function makeTaskActionsStub() {
  return {
    findTask: vi.fn((): unknown => undefined),
    setParent: vi.fn(async (_entityId: string, _parentId?: string): Promise<void> => undefined),
    bulkRemove: vi.fn(async (_ids: readonly string[]): Promise<void> => undefined),
    bulkRestore: vi.fn(async (_ids: readonly string[]): Promise<void> => undefined),
    setOrder: vi.fn(async (_entityId: string, _order: number): Promise<void> => undefined),
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
  stubs.projectActions.restoreProject.mockResolvedValue(true);
});

// ───────────────────────────────────────────────────────────────────────────
// 任务层级 / 批量 / 排序（P2）
// ───────────────────────────────────────────────────────────────────────────

describe('任务层级：set-task-parent', () => {
  it('set-task-parent → 先验存在，再 actions.setParent(taskId, parentId)', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'set-task-parent', taskId: 't1', parentId: 't2' });
    expect(actions.findTask).toHaveBeenCalledWith('t1');
    expect(actions.setParent).toHaveBeenCalledTimes(1);
    expect(actions.setParent).toHaveBeenCalledWith('t1', 't2');
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('set-task-parent（省略 parentId）→ setParent(taskId, undefined)，即提为顶级', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    await makeHost().submit({ action: 'set-task-parent', taskId: 't1' });
    expect(actions.setParent).toHaveBeenCalledWith('t1', undefined);
  });

  it('set-task-parent：任务不存在 ⇒ not-found，且**不调** setParent', async () => {
    actions.findTask.mockReturnValue(undefined);
    const result = await makeHost().submit({ action: 'set-task-parent', taskId: 'ghost', parentId: 't2' });
    expect(actions.setParent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('set-task-parent：setParent throw（环 / 超深）⇒ invalid，并把原因带出来', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    actions.setParent.mockRejectedValueOnce(new Error('改父被拒绝（cycle）：t1 → t2'));
    const result = await makeHost().submit({ action: 'set-task-parent', taskId: 't1', parentId: 't2' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.message).toContain('cycle');
    }
  });

  it('set-task-parent：setParent **同步** throw 也被 try/catch 翻成 invalid', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    actions.setParent.mockImplementationOnce(() => {
      throw new Error('改父被拒绝（depth_exceeded）：t1 → t2');
    });
    const result = await makeHost().submit({ action: 'set-task-parent', taskId: 't1', parentId: 't2' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });
});

describe('任务批量：trash-tasks / restore-tasks', () => {
  it('trash-tasks → 全部存在则 actions.bulkRemove(taskIds)，回 ok + taskIds', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'trash-tasks', taskIds: ['t1', 't2'] });
    expect(actions.bulkRemove).toHaveBeenCalledWith(['t1', 't2']);
    expect(result).toEqual({ ok: true, taskId: 't1', taskIds: ['t1', 't2'] });
  });

  it('trash-tasks：空数组 ⇒ invalid，且**不调** bulkRemove', async () => {
    const result = await makeHost().submit({ action: 'trash-tasks', taskIds: [] });
    expect(actions.bulkRemove).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('trash-tasks：任一不存在 ⇒ not-found，且**不调** bulkRemove（不半批写入）', async () => {
    // 预检按 `taskIds` 顺序逐个 `findTask`：t1 在、ghost 不在。
    actions.findTask.mockReturnValueOnce({ id: 't1' }).mockReturnValueOnce(undefined);
    const result = await makeHost().submit({ action: 'trash-tasks', taskIds: ['t1', 'ghost'] });
    expect(actions.bulkRemove).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('restore-tasks → 回收站里都在则 actions.bulkRestore(taskIds)，回 ok + taskIds', async () => {
    state.tasks['t1'] = { id: 't1', deletedAt: 1 };
    state.tasks['t2'] = { id: 't2', deletedAt: 2 };
    const result = await makeHost().submit({ action: 'restore-tasks', taskIds: ['t1', 't2'] });
    expect(actions.bulkRestore).toHaveBeenCalledWith(['t1', 't2']);
    expect(result).toEqual({ ok: true, taskId: 't1', taskIds: ['t1', 't2'] });
  });

  it('restore-tasks：空数组 ⇒ invalid，且**不调** bulkRestore', async () => {
    const result = await makeHost().submit({ action: 'restore-tasks', taskIds: [] });
    expect(actions.bulkRestore).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('restore-tasks：桶里没有 / 已被彻底删除 ⇒ not-found，且**不调** bulkRestore', async () => {
    state.tasks['t1'] = { id: 't1', deletedAt: 1, purgedAt: 9 };
    const result = await makeHost().submit({ action: 'restore-tasks', taskIds: ['t1', 'ghost'] });
    expect(actions.bulkRestore).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

describe('任务排序：reorder-task', () => {
  it('reorder-task → 先验存在，再 actions.setOrder(taskId, order)', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'reorder-task', taskId: 't1', order: 3 });
    expect(actions.setOrder).toHaveBeenCalledWith('t1', 3);
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('reorder-task：任务不存在 ⇒ not-found，且**不调** setOrder', async () => {
    actions.findTask.mockReturnValue(undefined);
    const result = await makeHost().submit({ action: 'reorder-task', taskId: 'ghost', order: 1 });
    expect(actions.setOrder).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('reorder-task：order 非有限数 ⇒ invalid，且**不调** setOrder', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    for (const order of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await makeHost().submit({ action: 'reorder-task', taskId: 't1', order });
      expect(result.ok, String(order)).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid');
    }
    expect(actions.setOrder).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 清单层级 / 恢复（P2）
// ───────────────────────────────────────────────────────────────────────────

describe('清单层级：move-project', () => {
  it('move-project → 先验存在，再 projectActions.setParent(projectId, parentId)', async () => {
    state.projects['p1'] = { id: 'p1', name: '子' };
    const result = await makeHost().submit({ action: 'move-project', projectId: 'p1', parentId: 'p2' });
    expect(stubs.projectActions.setParent).toHaveBeenCalledWith('p1', 'p2');
    expect(result).toMatchObject({ ok: true, taskId: 'p1', entityId: 'p1', entityType: 'PROJECT' });
  });

  it('move-project（省略 parentId）→ setParent(projectId, undefined)，即提为顶级', async () => {
    state.projects['p1'] = { id: 'p1', name: '子' };
    await makeHost().submit({ action: 'move-project', projectId: 'p1' });
    expect(stubs.projectActions.setParent).toHaveBeenCalledWith('p1', undefined);
  });

  it('move-project：清单不存在 ⇒ not-found，且**不调** setParent', async () => {
    const result = await makeHost().submit({ action: 'move-project', projectId: 'ghost', parentId: 'p2' });
    expect(stubs.projectActions.setParent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('move-project：setParent throw（环 / 超深）⇒ invalid，并把原因带出来', async () => {
    state.projects['p1'] = { id: 'p1', name: '子' };
    stubs.projectActions.setParent.mockRejectedValueOnce(new Error('改父被拒绝（cycle）：p1 → p2'));
    const result = await makeHost().submit({ action: 'move-project', projectId: 'p1', parentId: 'p2' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.message).toContain('cycle');
    }
  });
});

describe('清单恢复：restore-project', () => {
  it('restore-project → restoreProject(projectId)，true 则 ok', async () => {
    state.projects['p1'] = { id: 'p1', name: '旧', deletedAt: 1 };
    stubs.projectActions.restoreProject.mockResolvedValue(true);
    const result = await makeHost().submit({ action: 'restore-project', projectId: 'p1' });
    expect(stubs.projectActions.restoreProject).toHaveBeenCalledWith('p1');
    expect(result).toMatchObject({ ok: true, taskId: 'p1', entityId: 'p1', entityType: 'PROJECT' });
  });

  it('restore-project：restoreProject 回 false ⇒ not-found', async () => {
    state.projects['p1'] = { id: 'p1', name: '旧' };
    stubs.projectActions.restoreProject.mockResolvedValue(false);
    const result = await makeHost().submit({ action: 'restore-project', projectId: 'p1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('restore-project：桶里根本没有 ⇒ 由动作层判、返回 not-found', async () => {
    // 🔴 I5：本层不读 `.projects`、不自己判"在不在回收站/是否已 purge" —— 交给 restoreProject。
    stubs.projectActions.restoreProject.mockRejectedValueOnce(new Error('找不到清单「ghost」'));
    const result = await makeHost().submit({ action: 'restore-project', projectId: 'ghost' });
    expect(stubs.projectActions.restoreProject).toHaveBeenCalledWith('ghost');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('restore-project：已被彻底删除（purgedAt）⇒ 动作层 throw → not-found', async () => {
    stubs.projectActions.restoreProject.mockRejectedValueOnce(new Error('清单「p1」已被彻底删除，无法恢复'));
    const result = await makeHost().submit({ action: 'restore-project', projectId: 'p1' });
    expect(stubs.projectActions.restoreProject).toHaveBeenCalledWith('p1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});
