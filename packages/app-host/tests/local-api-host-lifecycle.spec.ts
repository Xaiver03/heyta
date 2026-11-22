import { localDateTimeToEpoch } from '@heyta/domain';
/**
 * 工具层补全 P0/P1 —— `submitIntent` 的分发判据（seam 层）
 * ============================================================
 *
 * 这一组用例只守**一件事**：契约 §2 的那 19 条 `intent.action` 是不是真的被翻成了
 * **对应那个 action 方法、且参数正确**，以及"不存在的东西"有没有在门口被挡成
 * `{ ok:false, reason:'not-found' }`。
 *
 * 为什么用**假 action 桩**而不是真引擎（同目录其它 `local-api-host*.spec.ts` 用的是真
 * SQLite）：那些用例证的是"op 形状落对了"；这一层要证的是**接线**本身 ——
 * "trash-task 该调 `remove` 还是 `removeProject`"是 switch 的决定，不是领域规则。
 * 用真引擎时这条会被领域实现盖住（方法内部再判一次存在性，接线错了也未必红），
 * 而桩能精确断言"调的是谁、给了什么"。
 *
 * `createLocalApiHost` 内部会**自己构造** project/note/reminder/event 动作集（不从参数注入），
 * 所以这里用 `vi.mock` 把它们的工厂替换成假对象；`actions: TaskActions` 本来就是入参，直接传假桩。
 * `ctx` 只需要 `getState()`（存在性校验读物化状态）与 `dispatch()`（桩不会用到）。
 */

import type {
  ActionContext,
  TaskActions,
} from '../src/actions.js';
import type { MaterializedState } from '@heyta/op-log';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ───────────────────────────────────────────────────────────────────────────
// 假 action 桩 —— 在模块层替换掉 createLocalApiHost 内部构造的六个动作集。
// `vi.hoisted` 保证这些 spy 在 `vi.mock` 工厂（被提升到 import 之前）里已存在。
// ───────────────────────────────────────────────────────────────────────────
const stubs = vi.hoisted(() => {
  // 存在性校验走动作层（`listAllProjects` / `listTags` / `listNotes`）；这三个假实现
  // 直接读 `holder.state` —— 于是测试里对 `state.*` 的播种同时驱动"存在/不存在"两条腿，
  // 与生产一致（出口层不许自己遍历原始表，见 `local-api-host.spec.ts` 的 I5 守卫）。
  const holder: {
    state: { projects: Record<string, unknown>; tags: Record<string, unknown>; notes: Record<string, unknown> };
  } = { state: { projects: {}, tags: {}, notes: {} } };
  const isAlive = (x: unknown): boolean => (x as { deletedAt?: number }).deletedAt === undefined;
  const projectActions = {
    renameProject: vi.fn(async () => undefined),
    archiveProject: vi.fn(async () => undefined),
    removeProject: vi.fn(async () => undefined),
    renameTag: vi.fn(async () => undefined),
    removeTag: vi.fn(async () => undefined),
    listAllProjects: vi.fn(() => Object.values(holder.state.projects).filter(isAlive)),
    listProjects: vi.fn(() => []),
    listTags: vi.fn(() => Object.values(holder.state.tags).filter(isAlive)),
  };
  const noteActions = {
    removeNote: vi.fn(async () => undefined),
    restoreNote: vi.fn(async () => true),
    setNoteProject: vi.fn(async () => undefined),
    listNotes: vi.fn(() => Object.values(holder.state.notes).filter(isAlive)),
  };
  const reminderActions = {
    rescheduleReminder: vi.fn(async () => undefined),
    removeReminder: vi.fn(async () => undefined),
  };
  const eventActions = {
    removeEvent: vi.fn(async () => undefined),
    restoreEvent: vi.fn(async () => true),
    archiveEvent: vi.fn(async () => undefined),
    eventOf: vi.fn((): unknown => undefined),
    listEvents: vi.fn(() => []),
  };
  const habitActions = {
    createHabit: vi.fn(async () => 'habit'),
    checkIn: vi.fn(async () => undefined),
    listHabits: vi.fn(() => []),
    listLogs: vi.fn(() => []),
  };
  const focusActions = {
    log: vi.fn(async () => 'focus'),
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

/** 物化状态的最小可写形状：这里只需要六个桶，键名与 `MaterializedState` 对齐。 */
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
    remove: vi.fn(async () => undefined),
    restore: vi.fn(async () => true),
    setAbandoned: vi.fn(async () => undefined),
    moveToProject: vi.fn(async () => undefined),
    setCompleted: vi.fn(async () => undefined),
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
  // `clearAllMocks` 只清调用记录，保留假实现（`resetAllMocks` 会连实现一起清掉，
  // 那会拆掉 listAllProjects / listTags / listNotes 那份读 `holder.state` 的实现）。
  vi.clearAllMocks();
  state = emptyState();
  stubs.holder.state = state;
  stubs.eventActions.eventOf.mockReturnValue(undefined);
  actions = makeTaskActionsStub();
});

// ───────────────────────────────────────────────────────────────────────────
// 任务生命周期（P0）
// ───────────────────────────────────────────────────────────────────────────

describe('任务生命周期：trash / restore / archive / unarchive / move / uncomplete', () => {
  it('trash-task → actions.remove(taskId)，返回 ok + taskId', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'trash-task', taskId: 't1' });
    expect(actions.remove).toHaveBeenCalledTimes(1);
    expect(actions.remove).toHaveBeenCalledWith('t1');
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('trash-task：任务不存在 ⇒ not-found，且**不调** remove', async () => {
    actions.findTask.mockReturnValue(undefined);
    const result = await makeHost().submit({ action: 'trash-task', taskId: 'nope' });
    expect(actions.remove).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('restore-task → actions.restore(taskId)（读含墓碑的记录），true 则 ok', async () => {
    state.tasks['t1'] = { id: 't1', deletedAt: 1 };
    actions.restore.mockResolvedValue(true);
    const result = await makeHost().submit({ action: 'restore-task', taskId: 't1' });
    expect(actions.restore).toHaveBeenCalledWith('t1');
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('restore-task：restore 回 false ⇒ not-found', async () => {
    state.tasks['t1'] = { id: 't1', deletedAt: 1 };
    actions.restore.mockResolvedValue(false);
    const result = await makeHost().submit({ action: 'restore-task', taskId: 't1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('restore-task：桶里根本没有 ⇒ not-found，且**不调** restore', async () => {
    const result = await makeHost().submit({ action: 'restore-task', taskId: 'ghost' });
    expect(actions.restore).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('archive-task → actions.setAbandoned(taskId, true)', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'archive-task', taskId: 't1' });
    expect(actions.setAbandoned).toHaveBeenCalledWith('t1', true);
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('unarchive-task → actions.setAbandoned(taskId, false)', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'unarchive-task', taskId: 't1' });
    expect(actions.setAbandoned).toHaveBeenCalledWith('t1', false);
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('move-task（带 projectId）→ 先验清单存在，再 moveToProject(taskId, projectId)', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    state.projects['p1'] = { id: 'p1', name: '家' };
    const result = await makeHost().submit({ action: 'move-task', taskId: 't1', projectId: 'p1' });
    expect(actions.moveToProject).toHaveBeenCalledWith('t1', 'p1');
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('move-task（不带 projectId）→ moveToProject(taskId, undefined)', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    await makeHost().submit({ action: 'move-task', taskId: 't1' });
    expect(actions.moveToProject).toHaveBeenCalledWith('t1', undefined);
  });

  it('move-task：目标清单不存在 ⇒ not-found，且**不调** moveToProject', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'move-task', taskId: 't1', projectId: 'ghost' });
    expect(actions.moveToProject).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('uncomplete-task → actions.setCompleted(taskId, false)', async () => {
    actions.findTask.mockReturnValue({ id: 't1' });
    const result = await makeHost().submit({ action: 'uncomplete-task', taskId: 't1' });
    expect(actions.setCompleted).toHaveBeenCalledWith('t1', false);
    expect(result).toEqual({ ok: true, taskId: 't1' });
  });

  it('uncomplete-task：任务不存在 ⇒ not-found，且**不调** setCompleted', async () => {
    actions.findTask.mockReturnValue(undefined);
    const result = await makeHost().submit({ action: 'uncomplete-task', taskId: 'ghost' });
    expect(actions.setCompleted).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 清单（P1）
// ───────────────────────────────────────────────────────────────────────────

describe('清单：rename / archive / delete', () => {
  it('rename-project → renameProject(projectId, name)（名字 trim 后落）', async () => {
    state.projects['p1'] = { id: 'p1', name: '旧名' };
    const result = await makeHost().submit({ action: 'rename-project', projectId: 'p1', name: '  新名  ' });
    expect(stubs.projectActions.renameProject).toHaveBeenCalledWith('p1', '新名');
    expect(result).toMatchObject({ ok: true, taskId: 'p1', entityId: 'p1', entityType: 'PROJECT' });
  });

  it('rename-project：空名 ⇒ invalid，且**不调** renameProject', async () => {
    state.projects['p1'] = { id: 'p1', name: '旧名' };
    const result = await makeHost().submit({ action: 'rename-project', projectId: 'p1', name: '   ' });
    expect(stubs.projectActions.renameProject).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('rename-project：清单不存在 ⇒ not-found', async () => {
    const result = await makeHost().submit({ action: 'rename-project', projectId: 'ghost', name: '新名' });
    expect(stubs.projectActions.renameProject).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('archive-project（缺省 archived）→ archiveProject(projectId, true)', async () => {
    state.projects['p1'] = { id: 'p1', name: '家' };
    const result = await makeHost().submit({ action: 'archive-project', projectId: 'p1' });
    expect(stubs.projectActions.archiveProject).toHaveBeenCalledWith('p1', true);
    expect(result).toMatchObject({ ok: true, entityType: 'PROJECT' });
  });

  it('archive-project（archived:false）→ archiveProject(projectId, false)', async () => {
    state.projects['p1'] = { id: 'p1', name: '家' };
    await makeHost().submit({ action: 'archive-project', projectId: 'p1', archived: false });
    expect(stubs.projectActions.archiveProject).toHaveBeenCalledWith('p1', false);
  });

  it('archive-project：清单不存在 ⇒ not-found，且**不调** archiveProject', async () => {
    const result = await makeHost().submit({ action: 'archive-project', projectId: 'ghost' });
    expect(stubs.projectActions.archiveProject).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('delete-project → removeProject(projectId)', async () => {
    state.projects['p1'] = { id: 'p1', name: '家' };
    const result = await makeHost().submit({ action: 'delete-project', projectId: 'p1' });
    expect(stubs.projectActions.removeProject).toHaveBeenCalledWith('p1');
    expect(result).toMatchObject({ ok: true, entityType: 'PROJECT' });
  });

  it('delete-project：清单不存在 ⇒ not-found，且**不调** removeProject', async () => {
    const result = await makeHost().submit({ action: 'delete-project', projectId: 'ghost' });
    expect(stubs.projectActions.removeProject).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 标签（P1）
// ───────────────────────────────────────────────────────────────────────────

describe('标签：rename / delete', () => {
  it('rename-tag → renameTag(tagId, name)', async () => {
    state.tags['g1'] = { id: 'g1', name: '旧' };
    const result = await makeHost().submit({ action: 'rename-tag', tagId: 'g1', name: '  重要  ' });
    expect(stubs.projectActions.renameTag).toHaveBeenCalledWith('g1', '重要');
    expect(result).toMatchObject({ ok: true, taskId: 'g1', entityId: 'g1', entityType: 'TAG' });
  });

  it('rename-tag：标签不存在 ⇒ not-found，且**不调** renameTag', async () => {
    const result = await makeHost().submit({ action: 'rename-tag', tagId: 'ghost', name: '重要' });
    expect(stubs.projectActions.renameTag).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('delete-tag → removeTag(tagId)', async () => {
    state.tags['g1'] = { id: 'g1', name: '重要' };
    const result = await makeHost().submit({ action: 'delete-tag', tagId: 'g1' });
    expect(stubs.projectActions.removeTag).toHaveBeenCalledWith('g1');
    expect(result).toMatchObject({ ok: true, entityType: 'TAG' });
  });

  it('delete-tag：标签不存在 ⇒ not-found，且**不调** removeTag', async () => {
    const result = await makeHost().submit({ action: 'delete-tag', tagId: 'ghost' });
    expect(stubs.projectActions.removeTag).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 笔记（P1）
// ───────────────────────────────────────────────────────────────────────────

describe('笔记：delete / restore / move', () => {
  it('delete-note → removeNote(noteId)', async () => {
    state.notes['n1'] = { id: 'n1' };
    const result = await makeHost().submit({ action: 'delete-note', noteId: 'n1' });
    expect(stubs.noteActions.removeNote).toHaveBeenCalledWith('n1');
    expect(result).toMatchObject({ ok: true, entityType: 'NOTE' });
  });

  it('delete-note：便签不存在 ⇒ not-found，且**不调** removeNote', async () => {
    const result = await makeHost().submit({ action: 'delete-note', noteId: 'ghost' });
    expect(stubs.noteActions.removeNote).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('restore-note → restoreNote(noteId)（读含墓碑的记录），true 则 ok', async () => {
    state.notes['n1'] = { id: 'n1', deletedAt: 1 };
    stubs.noteActions.restoreNote.mockResolvedValue(true);
    const result = await makeHost().submit({ action: 'restore-note', noteId: 'n1' });
    expect(stubs.noteActions.restoreNote).toHaveBeenCalledWith('n1');
    expect(result).toMatchObject({ ok: true, entityType: 'NOTE' });
  });

  it('restore-note：restoreNote 回 false ⇒ not-found', async () => {
    state.notes['n1'] = { id: 'n1', deletedAt: 1 };
    stubs.noteActions.restoreNote.mockResolvedValue(false);
    const result = await makeHost().submit({ action: 'restore-note', noteId: 'n1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('move-note（带 projectId）→ 先验清单存在，再 setNoteProject(noteId, projectId)', async () => {
    state.notes['n1'] = { id: 'n1' };
    state.projects['p1'] = { id: 'p1', name: '家' };
    const result = await makeHost().submit({ action: 'move-note', noteId: 'n1', projectId: 'p1' });
    expect(stubs.noteActions.setNoteProject).toHaveBeenCalledWith('n1', 'p1');
    expect(result).toMatchObject({ ok: true, entityType: 'NOTE' });
  });

  it('move-note（不带 projectId）→ setNoteProject(noteId, null)', async () => {
    state.notes['n1'] = { id: 'n1' };
    await makeHost().submit({ action: 'move-note', noteId: 'n1' });
    expect(stubs.noteActions.setNoteProject).toHaveBeenCalledWith('n1', null);
  });

  it('move-note：便签不存在 ⇒ not-found，且**不调** setNoteProject', async () => {
    const result = await makeHost().submit({ action: 'move-note', noteId: 'ghost', projectId: 'p1' });
    expect(stubs.noteActions.setNoteProject).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 提醒（P1）
// ───────────────────────────────────────────────────────────────────────────

describe('提醒：update / delete', () => {
  it('update-reminder → rescheduleReminder(reminderId, 换算后的毫秒)', async () => {
    state.reminders['r1'] = { id: 'r1', triggerAt: 1 };
    const result = await makeHost().submit({ action: 'update-reminder', reminderId: 'r1', date: '2026-10-04', time: '09:00' });
    // 与 create-reminder 同一换算（localDateTimeToEpoch），断言宿主真的把 date+time 变成了毫秒。
    const expected = localDateTimeToEpoch('2026-10-04T09:00');
    expect(expected).toBeTypeOf('number');
    expect(stubs.reminderActions.rescheduleReminder).toHaveBeenCalledWith('r1', expected);
    expect(result).toMatchObject({ ok: true, entityType: 'REMINDER' });
  });

  it('update-reminder：无法理解的时刻 ⇒ invalid，且**不调** rescheduleReminder', async () => {
    state.reminders['r1'] = { id: 'r1', triggerAt: 1 };
    for (const [date, time] of [['2026-13-40', '99:99'], ['not-a-date', '09:00'], ['2026-10-04', '25:00']]) {
      const result = await makeHost().submit({ action: 'update-reminder', reminderId: 'r1', date, time });
      expect(result.ok, `${date} ${time}`).toBe(false);
      if (!result.ok) expect(result.reason, `${date} ${time}`).toBe('invalid');
    }
    expect(stubs.reminderActions.rescheduleReminder).not.toHaveBeenCalled();
  });

  it('update-reminder：提醒不存在 ⇒ not-found，且**不调** rescheduleReminder', async () => {
    const result = await makeHost().submit({ action: 'update-reminder', reminderId: 'ghost', date: '2026-10-04', time: '09:00' });
    expect(stubs.reminderActions.rescheduleReminder).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('delete-reminder → removeReminder(reminderId)', async () => {
    state.reminders['r1'] = { id: 'r1', triggerAt: 1 };
    const result = await makeHost().submit({ action: 'delete-reminder', reminderId: 'r1' });
    expect(stubs.reminderActions.removeReminder).toHaveBeenCalledWith('r1');
    expect(result).toMatchObject({ ok: true, entityType: 'REMINDER' });
  });

  it('delete-reminder：提醒不存在 ⇒ not-found，且**不调** removeReminder', async () => {
    const result = await makeHost().submit({ action: 'delete-reminder', reminderId: 'ghost' });
    expect(stubs.reminderActions.removeReminder).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 事件（P1）
// ───────────────────────────────────────────────────────────────────────────

describe('事件：delete / restore / archive', () => {
  it('delete-event → eventOf 确认存在后 removeEvent(eventId)', async () => {
    stubs.eventActions.eventOf.mockReturnValue({ id: 'e1' });
    const result = await makeHost().submit({ action: 'delete-event', eventId: 'e1' });
    expect(stubs.eventActions.removeEvent).toHaveBeenCalledWith('e1');
    expect(result).toMatchObject({ ok: true, entityType: 'EVENT' });
  });

  it('delete-event：事件不存在 ⇒ not-found，且**不调** removeEvent', async () => {
    stubs.eventActions.eventOf.mockReturnValue(undefined);
    const result = await makeHost().submit({ action: 'delete-event', eventId: 'ghost' });
    expect(stubs.eventActions.removeEvent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('restore-event → restoreEvent(eventId)（读含墓碑的记录），true 则 ok', async () => {
    state.events['e1'] = { id: 'e1', deletedAt: 1 };
    stubs.eventActions.restoreEvent.mockResolvedValue(true);
    const result = await makeHost().submit({ action: 'restore-event', eventId: 'e1' });
    expect(stubs.eventActions.restoreEvent).toHaveBeenCalledWith('e1');
    expect(result).toMatchObject({ ok: true, entityType: 'EVENT' });
  });

  it('restore-event：restoreEvent 回 false ⇒ not-found', async () => {
    state.events['e1'] = { id: 'e1', deletedAt: 1 };
    stubs.eventActions.restoreEvent.mockResolvedValue(false);
    const result = await makeHost().submit({ action: 'restore-event', eventId: 'e1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('restore-event：桶里根本没有 ⇒ not-found，且**不调** restoreEvent', async () => {
    const result = await makeHost().submit({ action: 'restore-event', eventId: 'ghost' });
    expect(stubs.eventActions.restoreEvent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('archive-event → eventOf 确认存在后 archiveEvent(eventId)', async () => {
    stubs.eventActions.eventOf.mockReturnValue({ id: 'e1' });
    const result = await makeHost().submit({ action: 'archive-event', eventId: 'e1' });
    expect(stubs.eventActions.archiveEvent).toHaveBeenCalledWith('e1');
    expect(result).toMatchObject({ ok: true, entityType: 'EVENT' });
  });

  it('archive-event：事件不存在 ⇒ not-found，且**不调** archiveEvent', async () => {
    stubs.eventActions.eventOf.mockReturnValue(undefined);
    const result = await makeHost().submit({ action: 'archive-event', eventId: 'ghost' });
    expect(stubs.eventActions.archiveEvent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});
