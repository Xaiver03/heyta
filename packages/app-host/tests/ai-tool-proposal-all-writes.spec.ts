/**
 * 目录里**每一个**写工具：提案不是落库
 * =====================================
 *
 * 这条不变量是整套确认机制存在的唯一理由：AI 选中一个写动作时**不许**碰库，
 * 用户点确认之前必须还能撤销。它一旦破在某个工具上，症状是"话还没说完，数据已经改了"。
 *
 * 为什么逐个工具跑，而不是跑一个代表：
 * 🔴 **破漏的形状是"某一条分支忘了走提案"**（例如新加的写工具直接 `ctx.dispatch`），
 * 用一个代表工具测不出其余那些。所以这里把目录里 `kind === 'write'` 的工具**全部**跑一遍，
 * 并且有一条**覆盖面判据**钉住"新加一个写工具却不在这个清单里"会直接红。
 *
 * 台架是真的（真引擎 + 真 SQLite `:memory:`），因为要数的是**磁盘上的 op**：
 * 假 host 的计数器只能证明"我没调 submit"，证明不了"没有别的路径写了库"。
 *
 * 每个工具三条腿，缺一腿都不算闭环：
 *   1. 提案阶段：跑完执行这一步，效果读数**没变**（"选中即落库"在这里被抓住）
 *   2. 确认之后：效果读数**恰好 +1**（否则第 1 条的"没变"只是因为整条路径是空操作）
 *   3. 未授权：`denied`，且效果读数没变（逐工具默认关对新工具同样成立）
 */

import { Priority, startOfDay } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { LOCAL_API_TOOLS, type LocalApiWriteIntent } from '@heyta/local-api';
import { OpType, type Operation } from '@heyta/sync-core';
import type { OpIntent } from '@heyta/op-log';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { confirmAiToolProposal, runSelectedTool } from '../src/ai-tool-run.js';

const authorization = (tool: string) => ({ getGrants: () => ({ [tool]: true }) });
import type { ToolArgs } from '../src/ai-tool-selection.js';
import { createLocalApiHost, type LocalApiHostOptions } from '../src/local-api-host.js';
import type { CommentActions } from '../src/comment-actions.js';

const CLOCK = 1_700_000_000_000;

let adapter: SqliteAdapter;
let engine: OpLogEngine;

/** 假评论存储：评论走 share 通道、**不落个人 op-log**，所以效果读数读这里（而非 engine 状态）。 */
interface FakeComments {
  comments: Map<string, { id: string; taskId: string; body: string }>;
  deleteCalls: number;
  seq: number;
}
let commentStore: FakeComments;
function resetCommentStore(): void {
  commentStore = { comments: new Map(), deleteCalls: 0, seq: 0 };
}
resetCommentStore();
function makeCommentActions(): CommentActions {
  return {
    addComment: async (taskId: string, body: string): Promise<string> => {
      const id = `c-${String(++commentStore.seq)}`;
      commentStore.comments.set(id, { id, taskId, body });
      return id;
    },
    removeComment: async (id: string): Promise<void> => {
      commentStore.deleteCalls += 1;
      commentStore.comments.delete(id);
    },
    editComment: async (): Promise<void> => undefined,
    restoreComment: async (): Promise<void> => undefined,
    listComments: async (taskId: string) =>
      [...commentStore.comments.values()].filter((c) => c.taskId === taskId),
  } as unknown as CommentActions;
}

function makeHost(extra: Partial<LocalApiHostOptions> = {}) {
  return createLocalApiHost(engine, createTaskActions(engine, { now: () => CLOCK }), {
    isReadable: () => true,
    now: () => CLOCK,
    commentActions: makeCommentActions(),
    ...extra,
  });
}

/** 直接落一条附件（无 blob 端口也可：rename/list 不依赖它，remove 的 DEL op 先发）。 */
async function seedAttachment(taskId: string, fileName: string): Promise<string> {
  const entityId = `att-${String(Math.floor(Math.random() * 1e9))}`;
  await engine.dispatch({
    entityType: 'ATTACHMENT' as OpIntent['entityType'],
    entityId,
    opType: OpType.Create,
    payload: { taskId, fileName, mimeType: null, sizeBytes: 10 },
  });
  return entityId;
}

/** 未删除实体的条数（效果读数的分母必须是活的实体，不然墓碑也算"写成功"）。 */
function alive<K extends 'tasks' | 'projects' | 'habits' | 'tags' | 'notes' | 'habitLogs' | 'focusSessions' | 'reminders' | 'events' | 'filters'>(
  key: K,
): number {
  const record = engine.getState()[key] as Record<string, { deletedAt?: number }>;
  return Object.values(record).filter((x) => x.deletedAt === undefined).length;
}

/** 直接落一条前置实体（这些用例测的是"写工具走不走提案"，前置数据不是被测对象）。 */
async function seed(intent: LocalApiWriteIntent): Promise<string> {
  const result = await makeHost().submit(intent);
  if (!result.ok) throw new Error(`前置数据没落下来：${result.message}`);
  return result.taskId;
}

interface Case {
  /** 目录里的工具名（覆盖面判据按它比对）。 */
  tool: string;
  /** 提案里应当出现的意图动作 —— 钉住"工具翻译到了哪条写入分支"。 */
  intentAction: LocalApiWriteIntent['action'];
  label: string;
  /** 造参数（有的写动作必须挂在已存在的实体上）。 */
  args: () => Promise<ToolArgs>;
  /** 这次写入的**效果**读数；确认前后各取一次，差值必须是 1。 */
  effect: () => number;
}

const CASES: readonly Case[] = [
  {
    tool: 'create_task',
    intentAction: 'create-task',
    label: '任务',
    args: async () => ({ title: '写周报' }),
    effect: () => alive('tasks'),
  },
  {
    tool: 'update_task',
    intentAction: 'update-task',
    label: '任务标题',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '旧标题' }), fields: { title: '改过的标题' } }),
    // 改既有实体时"条数"不会变，所以效果读数取**改成的那个值出现了没有**。
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.title === '改过的标题').length,
  },
  {
    tool: 'complete_task',
    intentAction: 'complete-task',
    label: '完成状态',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '要完成的' }) }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.completedAt !== undefined).length,
  },
  {
    tool: 'append_task_checklist',
    intentAction: 'append-task-checklist',
    label: '任务清单',
    args: async () => ({
      taskId: await seed({ action: 'create-task', title: '要拆解的' }),
      items: ['准备说明'],
    }),
    effect: () =>
      Object.values(engine.getState().tasks).filter((t) => t.note === '- [ ] 准备说明').length,
  },
  {
    tool: 'set_task_priorities',
    intentAction: 'set-task-priorities',
    label: '任务优先级',
    args: async () => ({
      entries: [{ taskId: await seed({ action: 'create-task', title: '要排优先级的' }), priority: 'high' }],
    }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.priority === Priority.High).length,
  },
  {
    tool: 'set_task_estimate',
    intentAction: 'set-task-estimate',
    label: '任务估时',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '要估时的' }), minutes: 45 }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.note === '预计耗时：45 分钟').length,
  },
  {
    tool: 'create_project',
    intentAction: 'create-project',
    label: '清单',
    args: async () => ({ name: '读书' }),
    effect: () => alive('projects'),
  },
  {
    tool: 'create_habit',
    intentAction: 'create-habit',
    label: '习惯',
    args: async () => ({ name: '喝水', target: 8, unit: '杯' }),
    effect: () => alive('habits'),
  },
  {
    tool: 'create_tag',
    intentAction: 'create-tag',
    label: '标签',
    args: async () => ({ name: '重要' }),
    effect: () => alive('tags'),
  },
  {
    tool: 'set_task_tags',
    intentAction: 'set-task-tags',
    label: '任务的标签',
    args: async () => {
      const taskId = await seed({ action: 'create-task', title: '挂标签' });
      const tagId = await seed({ action: 'create-tag', name: '紧急' });
      return { taskId, tagIds: [tagId] };
    },
    effect: () => Object.values(engine.getState().tasks).filter((t) => (t.tagIds?.length ?? 0) > 0).length,
  },
  {
    tool: 'create_note',
    intentAction: 'create-note',
    label: '便签',
    args: async () => ({ content: '买咖啡豆' }),
    effect: () => alive('notes'),
  },
  {
    tool: 'update_note',
    intentAction: 'update-note',
    label: '便签正文',
    args: async () => ({
      noteId: await seed({ action: 'create-note', content: '原文' }),
      content: '改过了',
    }),
    effect: () => Object.values(engine.getState().notes).filter((n) => n.content === '改过了').length,
  },
  {
    tool: 'record_checkin',
    intentAction: 'record-checkin',
    label: '打卡记录',
    args: async () => ({ habitId: await seed({ action: 'create-habit', name: '喝水', target: 8 }) }),
    effect: () => alive('habitLogs'),
  },
  {
    tool: 'log_focus',
    intentAction: 'log-focus',
    label: '专注记录',
    args: async () => ({ kind: 'work', plannedMinutes: 25 }),
    effect: () => alive('focusSessions'),
  },
  {
    tool: 'create_event',
    intentAction: 'create-event',
    label: '倒数日',
    args: async () => ({ title: '妈妈生日', date: '2027-04-12' }),
    effect: () => alive('events'),
  },
  {
    tool: 'update_event',
    intentAction: 'update-event',
    label: '倒数日置顶',
    args: async () => ({
      eventId: await seed({ action: 'create-event', title: '体检', date: '2027-06-01' }),
      fields: { pinned: true },
    }),
    effect: () =>
      Object.values(engine.getState().events).filter((e) => e.pinnedAt !== undefined).length,
  },
  {
    tool: 'create_reminder',
    intentAction: 'create-reminder',
    label: '提醒',
    args: async () => ({
      taskId: await seed({ action: 'create-task', title: '交税' }),
      date: '2024-06-01',
      time: '09:30',
    }),
    effect: () => alive('reminders'),
  },
  // ── 2026-11-22 工具层补全：任务生命周期 / 清单·标签·笔记·提醒·事件 ──
  {
    tool: 'trash_task',
    intentAction: 'trash-task',
    label: '任务移入回收站',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '要删的' }) }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.deletedAt !== undefined).length,
  },
  {
    tool: 'restore_task',
    intentAction: 'restore-task',
    label: '任务从回收站恢复',
    args: async () => {
      const taskId = await seed({ action: 'create-task', title: '待恢复' });
      await makeHost().submit({ action: 'trash-task', taskId });
      return { taskId };
    },
    effect: () => alive('tasks'),
  },
  {
    tool: 'abandon_task',
    intentAction: 'abandon-task',
    label: '任务放弃',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '要归档的' }) }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.abandonedAt !== undefined).length,
  },
  {
    tool: 'unabandon_task',
    intentAction: 'unabandon-task',
    label: '任务取消放弃',
    args: async () => {
      const taskId = await seed({ action: 'create-task', title: '已归档' });
      await makeHost().submit({ action: 'abandon-task', taskId });
      return { taskId };
    },
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.abandonedAt === undefined).length,
  },
  {
    tool: 'move_task',
    intentAction: 'move-task',
    label: '任务移动清单',
    args: async () => {
      const taskId = await seed({ action: 'create-task', title: '要移动的' });
      const projectId = await seed({ action: 'create-project', name: '目标清单' });
      return { taskId, projectId };
    },
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.projectId !== undefined).length,
  },
  {
    tool: 'uncomplete_task',
    intentAction: 'uncomplete-task',
    label: '任务取消完成',
    args: async () => {
      const taskId = await seed({ action: 'create-task', title: '已完成' });
      await makeHost().submit({ action: 'complete-task', taskId });
      return { taskId };
    },
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.completedAt === undefined).length,
  },
  {
    tool: 'rename_project',
    intentAction: 'rename-project',
    label: '清单改名',
    args: async () => ({ projectId: await seed({ action: 'create-project', name: '旧清单' }), name: '改过的清单' }),
    effect: () => Object.values(engine.getState().projects).filter((p) => p.name === '改过的清单').length,
  },
  {
    tool: 'archive_project',
    intentAction: 'archive-project',
    label: '清单归档',
    args: async () => ({ projectId: await seed({ action: 'create-project', name: '要归档的清单' }) }),
    effect: () => Object.values(engine.getState().projects).filter((p) => p.archived === true).length,
  },
  {
    tool: 'delete_project',
    intentAction: 'delete-project',
    label: '清单移入回收站',
    args: async () => ({ projectId: await seed({ action: 'create-project', name: '要删的清单' }) }),
    effect: () => Object.values(engine.getState().projects).filter((p) => p.deletedAt !== undefined).length,
  },
  {
    tool: 'rename_tag',
    intentAction: 'rename-tag',
    label: '标签改名',
    args: async () => ({ tagId: await seed({ action: 'create-tag', name: '旧标签' }), name: '改过的标签' }),
    effect: () => Object.values(engine.getState().tags).filter((t) => t.name === '改过的标签').length,
  },
  {
    tool: 'delete_tag',
    intentAction: 'delete-tag',
    label: '标签移入回收站',
    args: async () => ({ tagId: await seed({ action: 'create-tag', name: '要删的标签' }) }),
    effect: () => Object.values(engine.getState().tags).filter((t) => t.deletedAt !== undefined).length,
  },
  {
    tool: 'delete_note',
    intentAction: 'delete-note',
    label: '便签移入回收站',
    args: async () => ({ noteId: await seed({ action: 'create-note', content: '要删的便签' }) }),
    effect: () => Object.values(engine.getState().notes).filter((n) => n.deletedAt !== undefined).length,
  },
  {
    tool: 'restore_note',
    intentAction: 'restore-note',
    label: '便签恢复',
    args: async () => {
      const noteId = await seed({ action: 'create-note', content: '待恢复便签' });
      await makeHost().submit({ action: 'delete-note', noteId });
      return { noteId };
    },
    effect: () => alive('notes'),
  },
  {
    tool: 'move_note',
    intentAction: 'move-note',
    label: '便签移动清单',
    args: async () => {
      const noteId = await seed({ action: 'create-note', content: '要移动的便签' });
      const projectId = await seed({ action: 'create-project', name: '便签目标清单' });
      return { noteId, projectId };
    },
    effect: () => Object.values(engine.getState().notes).filter((n) => n.projectId !== undefined).length,
  },
  {
    tool: 'update_reminder',
    intentAction: 'update-reminder',
    label: '提醒改时刻',
    args: async () => {
      const taskId = await seed({ action: 'create-task', title: '带提醒的' });
      const reminderId = await seed({ action: 'create-reminder', taskId, date: '2024-06-01', time: '09:30' });
      return { reminderId, date: '2024-07-01', time: '10:00' };
    },
    effect: () => Object.values(engine.getState().reminders).filter((r) => r.triggerAt === new Date(2024, 6, 1, 10, 0, 0).getTime()).length,
  },
  {
    tool: 'delete_reminder',
    intentAction: 'delete-reminder',
    label: '提醒删除',
    args: async () => {
      const taskId = await seed({ action: 'create-task', title: '带提醒任务' });
      const reminderId = await seed({ action: 'create-reminder', taskId, date: '2024-06-01', time: '09:30' });
      return { reminderId };
    },
    effect: () => Object.values(engine.getState().reminders).filter((r) => r.deletedAt !== undefined).length,
  },
  {
    tool: 'delete_event',
    intentAction: 'delete-event',
    label: '倒数日移入回收站',
    args: async () => ({ eventId: await seed({ action: 'create-event', title: '要删的纪念日', date: '2027-03-01' }) }),
    effect: () => Object.values(engine.getState().events).filter((e) => e.deletedAt !== undefined).length,
  },
  {
    tool: 'restore_event',
    intentAction: 'restore-event',
    label: '倒数日恢复',
    args: async () => {
      const eventId = await seed({ action: 'create-event', title: '待恢复纪念日', date: '2027-03-02' });
      await makeHost().submit({ action: 'delete-event', eventId });
      return { eventId };
    },
    effect: () => alive('events'),
  },
  {
    tool: 'archive_event',
    intentAction: 'archive-event',
    label: '倒数日归档',
    args: async () => ({ eventId: await seed({ action: 'create-event', title: '要归档的纪念日', date: '2027-03-03' }) }),
    effect: () => Object.values(engine.getState().events).filter((e) => e.archivedAt !== undefined).length,
  },

  // ── 批次2：层级移动 / 批量 / 排序 ──
  {
    tool: 'set_task_parent',
    intentAction: 'set-task-parent',
    label: '任务层级',
    args: async () => ({
      taskId: await seed({ action: 'create-task', title: '子任务' }),
      parentId: await seed({ action: 'create-task', title: '父任务' }),
    }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.parentId !== undefined).length,
  },
  {
    tool: 'trash_tasks',
    intentAction: 'trash-tasks',
    label: '批量删除',
    args: async () => ({ taskIds: [await seed({ action: 'create-task', title: '删A' })] }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.deletedAt !== undefined).length,
  },
  {
    tool: 'restore_tasks',
    intentAction: 'restore-tasks',
    label: '批量恢复',
    args: async () => {
      const a = await seed({ action: 'create-task', title: '恢复A' });
      await makeHost().submit({ action: 'trash-tasks', taskIds: [a] });
      return { taskIds: [a] };
    },
    effect: () => alive('tasks'),
  },
  {
    tool: 'reorder_task',
    intentAction: 'reorder-task',
    label: '任务排序',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '重排' }), order: 7 }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.order === 7).length,
  },
  {
    tool: 'move_project',
    intentAction: 'move-project',
    label: '清单层级',
    args: async () => ({
      projectId: await seed({ action: 'create-project', name: '子清单' }),
      parentId: await seed({ action: 'create-project', name: '父清单' }),
    }),
    effect: () => Object.values(engine.getState().projects).filter((p) => p.parentId !== undefined).length,
  },
  {
    tool: 'restore_project',
    intentAction: 'restore-project',
    label: '清单恢复',
    args: async () => {
      const projectId = await seed({ action: 'create-project', name: '待恢复清单' });
      await makeHost().submit({ action: 'delete-project', projectId });
      return { projectId };
    },
    effect: () => alive('projects'),
  },

  // ── 批次3：子任务 / 备注 / 重复 / 习惯 ──
  {
    tool: 'create_subtask',
    intentAction: 'create-subtask',
    label: '子任务',
    args: async () => ({ parentId: await seed({ action: 'create-task', title: '父任务' }), title: '子任务' }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.parentId !== undefined).length,
  },
  {
    tool: 'set_task_note',
    intentAction: 'set-task-note',
    label: '任务备注',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '带备注' }), note: '记一笔' }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.note === '记一笔').length,
  },
  {
    tool: 'set_task_repeat',
    intentAction: 'set-task-repeat',
    label: '任务重复',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '每天', dueDate: '2026-12-01' }), rule: 'FREQ=DAILY' }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.repeatRule === 'FREQ=DAILY').length,
  },
  {
    tool: 'rename_habit',
    intentAction: 'rename-habit',
    label: '习惯改名',
    args: async () => ({ habitId: await seed({ action: 'create-habit', name: '旧习惯' }), name: '新习惯' }),
    effect: () => Object.values(engine.getState().habits).filter((h) => h.name === '新习惯').length,
  },
  {
    tool: 'delete_habit',
    intentAction: 'delete-habit',
    label: '习惯删除',
    args: async () => ({ habitId: await seed({ action: 'create-habit', name: '要删的习惯' }) }),
    effect: () => Object.values(engine.getState().habits).filter((h) => h.deletedAt !== undefined).length,
  },
  {
    tool: 'restore_habit',
    intentAction: 'restore-habit',
    label: '习惯恢复',
    args: async () => {
      const habitId = await seed({ action: 'create-habit', name: '待恢复习惯' });
      await makeHost().submit({ action: 'delete-habit', habitId });
      return { habitId };
    },
    effect: () => alive('habits'),
  },

  // ── 批次4：任务标记 / 批量移动 / 打卡撤销 ──
  {
    tool: 'set_task_important',
    intentAction: 'set-task-important',
    label: '任务重要',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '重要的' }), important: true }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.important === true).length,
  },
  {
    tool: 'set_task_pinned',
    intentAction: 'set-task-pinned',
    label: '任务置顶',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '置顶的' }), pinned: true }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.pinnedAt !== undefined).length,
  },
  {
    tool: 'set_task_assignee',
    intentAction: 'set-task-assignee',
    label: '任务指派',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '要指派的' }), assigneeUserId: 'u1' }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.assigneeUserId === 'u1').length,
  },
  // 批8：附件（ATTACHMENT）
  {
    tool: 'rename_attachment',
    intentAction: 'rename-attachment',
    label: '附件改名',
    args: async () => ({
      attachmentId: await seedAttachment(await seed({ action: 'create-task', title: '带附件' }), 'a.txt'),
      fileName: 'b.txt',
    }),
    effect: () =>
      Object.values(engine.getState().attachments).filter((a) => a.deletedAt === undefined && a.fileName === 'b.txt').length,
  },
  {
    tool: 'remove_attachment',
    intentAction: 'remove-attachment',
    label: '附件移除',
    args: async () => ({
      attachmentId: await seedAttachment(await seed({ action: 'create-task', title: '待删附件' }), 'a.txt'),
    }),
    effect: () => Object.values(engine.getState().attachments).filter((a) => a.deletedAt !== undefined).length,
  },
  // 批8：评论（COMMENT，share 通道 —— 效果读假存储）
  {
    tool: 'add_task_comment',
    intentAction: 'add-task-comment',
    label: '加评论',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '评论任务' }), body: '好的' }),
    effect: () => commentStore.comments.size,
  },
  {
    tool: 'delete_task_comment',
    intentAction: 'delete-task-comment',
    label: '删评论',
    args: async () => {
      const taskId = await seed({ action: 'create-task', title: '删评论任务' });
      // 预置一条评论（直接进假存储，不计 deleteCalls）
      const id = `c-${String(++commentStore.seq)}`;
      commentStore.comments.set(id, { id, taskId, body: '旧评论' });
      return { commentId: id };
    },
    effect: () => commentStore.deleteCalls,
  },
  {
    tool: 'move_tasks',
    intentAction: 'move-tasks',
    label: '批量移动',
    args: async () => ({
      taskIds: [await seed({ action: 'create-task', title: '批量移' })],
      projectId: await seed({ action: 'create-project', name: '批量目标' }),
    }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.projectId !== undefined).length,
  },
  {
    tool: 'undo_checkin',
    intentAction: 'undo-checkin',
    label: '打卡撤销',
    args: async () => {
      const habitId = await seed({ action: 'create-habit', name: '待撤销打卡' });
      await makeHost().submit({ action: 'record-checkin', habitId, date: '2026-10-04' });
      return { habitId, date: '2026-10-04' };
    },
    effect: () => Object.values(engine.getState().habitLogs).filter((h) => h.deletedAt !== undefined).length,
  },

  // ── 批次5：重复任务控制 ──
  {
    tool: 'skip_task_occurrence',
    intentAction: 'skip-task-occurrence',
    label: '跳过这一次',
    args: async () => {
      const taskId = await seed({ action: 'create-task', title: '每日', dueDate: '2026-12-01' });
      await makeHost().submit({ action: 'set-task-repeat', taskId, rule: 'FREQ=DAILY' });
      return { taskId };
    },
    effect: () => Object.values(engine.getState().tasks).filter((t) => (t.exDates?.length ?? 0) > 0).length,
  },
  {
    tool: 'set_task_repeat_after_completion',
    intentAction: 'set-task-repeat-after-completion',
    label: '完成后顺延',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '顺延' }), on: true }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.repeatAfterCompletion === true).length,
  },

  // ── 批6：清单 / 习惯属性 ──
  {
    tool: 'set_project_color',
    intentAction: 'set-project-color',
    label: '清单设色',
    args: async () => ({ projectId: await seed({ action: 'create-project', name: '配色清单' }), color: 3 }),
    effect: () => Object.values(engine.getState().projects).filter((p) => p.color === '3').length,
  },
  // 2026-11-24 工作包 A：清单级设置
  {
    tool: 'set_project_icon',
    intentAction: 'set-project-icon',
    label: '清单设图标',
    args: async () => ({ projectId: await seed({ action: 'create-project', name: '图标清单' }), icon: 'star' }),
    effect: () => Object.values(engine.getState().projects).filter((p) => p.icon === 'star').length,
  },
  {
    tool: 'set_project_view_mode',
    intentAction: 'set-project-view-mode',
    label: '清单设视图',
    args: async () => ({ projectId: await seed({ action: 'create-project', name: '视图清单' }), viewMode: 'board' }),
    effect: () => Object.values(engine.getState().projects).filter((p) => p.viewMode === 'board').length,
  },
  {
    tool: 'set_project_kind',
    intentAction: 'set-project-kind',
    label: '清单设类型',
    args: async () => ({ projectId: await seed({ action: 'create-project', name: '类型清单' }), kind: 'notes' }),
    effect: () => Object.values(engine.getState().projects).filter((p) => p.kind === 'notes').length,
  },
  {
    tool: 'set_project_show_in_smart_list',
    intentAction: 'set-project-show-in-smart-list',
    label: '清单退出智能清单',
    args: async () => ({
      projectId: await seed({ action: 'create-project', name: '智能清单' }),
      showInSmartList: false,
    }),
    effect: () => Object.values(engine.getState().projects).filter((p) => p.showInSmartList === false).length,
  },
  {
    tool: 'set_habit_color',
    intentAction: 'set-habit-color',
    label: '习惯设色',
    args: async () => ({ habitId: await seed({ action: 'create-habit', name: '配色习惯' }), color: 2 }),
    effect: () => Object.values(engine.getState().habits).filter((h) => h.color === '2').length,
  },
  {
    tool: 'set_habit_icon',
    intentAction: 'set-habit-icon',
    label: '习惯设图标',
    args: async () => ({ habitId: await seed({ action: 'create-habit', name: '图标习惯' }), icon: 'book' }),
    effect: () => Object.values(engine.getState().habits).filter((h) => h.icon === 'book').length,
  },
  {
    tool: 'set_habit_goal',
    intentAction: 'set-habit-goal',
    label: '习惯改目标',
    args: async () => ({ habitId: await seed({ action: 'create-habit', name: '目标习惯' }), target: 5 }),
    effect: () => Object.values(engine.getState().habits).filter((h) => h.target === 5).length,
  },
  {
    tool: 'set_habit_frequency',
    intentAction: 'set-habit-frequency',
    label: '习惯改频率',
    args: async () => ({
      habitId: await seed({ action: 'create-habit', name: '频率习惯' }),
      frequency: { type: 'interval', everyNDays: 3 },
    }),
    effect: () => Object.values(engine.getState().habits).filter((h) => h.frequency !== undefined).length,
  },

  // ── 批6-2：四象限 / 推迟今天 ──
  {
    tool: 'set_task_quadrant',
    intentAction: 'set-task-quadrant',
    label: '四象限整格',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '象限' }), quadrant: 1 }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => t.important === true).length,
  },
  {
    tool: 'postpone_task_to_today',
    intentAction: 'postpone-task-to-today',
    label: '推迟今天',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '拖延', dueDate: '2020-01-01' }) }),
    effect: () =>
      Object.values(engine.getState().tasks).filter((t) => t.dueDate !== undefined && t.dueDate >= startOfDay(CLOCK)).length,
  },

  // ── 批6-3：批量打卡 ──
  {
    tool: 'record_habit_checkins',
    intentAction: 'record-habit-checkins',
    label: '批量打卡',
    args: async () => ({ habitIds: [await seed({ action: 'create-habit', name: '批量打卡习惯' })] }),
    effect: () => Object.values(engine.getState().habitLogs).filter((h) => h.deletedAt === undefined).length,
  },

  // ── 批7：任务结构化子项 ──
  {
    tool: 'set_task_checklist',
    intentAction: 'set-task-checklist',
    label: '设子项清单',
    args: async () => ({ taskId: await seed({ action: 'create-task', title: '清单' }), items: [{ text: '甲' }, { text: '乙', done: true }] }),
    effect: () => Object.values(engine.getState().tasks).filter((t) => (t.checklist?.length ?? 0) > 0).length,
  },
  {
    tool: 'toggle_checklist_item',
    intentAction: 'toggle-checklist-item',
    label: '勾子项',
    args: async () => {
      const taskId = await seed({ action: 'create-task', title: '勾' });
      await makeHost().submit({ action: 'set-task-checklist', taskId, items: [{ text: '甲' }] });
      return { taskId, itemText: '甲', done: true };
    },
    effect: () => Object.values(engine.getState().tasks).filter((t) => (t.checklist ?? []).some((x) => x.done)).length,
  },

  // ── ADR-0092：保存筛选（FILTER）—— 四个写工具各一例（个人数据，不落 share 通道）──
  {
    tool: 'create_filter',
    intentAction: 'create-filter',
    label: '保存筛选',
    args: async () => ({
      name: '我的高优先级',
      rule: { match: 'all', conditions: [{ kind: 'priority', values: [Priority.High] }] },
    }),
    effect: () => alive('filters'),
  },
  {
    tool: 'update_filter_rule',
    intentAction: 'update-filter-rule',
    label: '筛选规则',
    args: async () => ({
      filterId: await seed({
        action: 'create-filter',
        name: '待改规则',
        rule: { match: 'all', conditions: [{ kind: 'today' }] },
      }),
      rule: { match: 'any', conditions: [{ kind: 'tomorrow' }] },
    }),
    effect: () => Object.values(engine.getState().filters).filter((f) => f.rule.match === 'any').length,
  },
  {
    tool: 'rename_filter',
    intentAction: 'rename-filter',
    label: '筛选改名',
    args: async () => ({
      filterId: await seed({
        action: 'create-filter',
        name: '旧名',
        rule: { match: 'all', conditions: [{ kind: 'today' }] },
      }),
      name: '改过的名字',
    }),
    effect: () => Object.values(engine.getState().filters).filter((f) => f.name === '改过的名字').length,
  },
  {
    tool: 'delete_filter',
    intentAction: 'delete-filter',
    label: '筛选移入回收站',
    args: async () => ({
      filterId: await seed({
        action: 'create-filter',
        name: '要删的筛选',
        rule: { match: 'all', conditions: [{ kind: 'today' }] },
      }),
    }),
    effect: () => Object.values(engine.getState().filters).filter((f) => f.deletedAt !== undefined).length,
  },
];

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-test',
    now: () => CLOCK,
  });
  resetCommentStore();
});

afterEach(() => {
  adapter.close();
});

describe('🔴 提案不是落库：目录里每个写工具各跑一遍三条腿', () => {
  for (const c of CASES) {
    it(`${c.tool}：跑完执行这一步，${c.label}的效果读数**没变**`, async () => {
      const args = await c.args();
      const before = c.effect();
      const outcome = await runSelectedTool(
        { kind: 'tool', ruleId: `test.${c.tool}`, tool: c.tool, args },
        { host: makeHost(), grants: { [c.tool]: true } },
      );
      expect(outcome.kind).toBe('proposal');
      if (outcome.kind !== 'proposal') return;
      // 🔴 提案里是**意图**，不是 op：形状由该工具所属 pack 的 `toIntent` 决定。
      expect(outcome.proposal.tool).toBe(c.tool);
      expect(outcome.proposal.intent.action).toBe(c.intentAction);
      expect(c.effect()).toBe(before);
    });

    it(`${c.tool}：确认之后效果读数**恰好 +1**`, async () => {
      const args = await c.args();
      const host = makeHost();
      const before = c.effect();
      const outcome = await runSelectedTool(
        { kind: 'tool', ruleId: `test.${c.tool}`, tool: c.tool, args },
        { host, grants: { [c.tool]: true } },
      );
      if (outcome.kind !== 'proposal') throw new Error('这一条跑的不是提案路径');

      const confirmed = await confirmAiToolProposal(host, outcome.proposal, authorization(outcome.proposal.tool));
      expect(confirmed.ok).toBe(true);
      expect(c.effect()).toBe(before + 1);
    });

    it(`${c.tool}：没有逐工具授权 ⇒ denied，**连提案都不产出**`, async () => {
      const args = await c.args();
      const before = c.effect();
      const outcome = await runSelectedTool(
        { kind: 'tool', ruleId: `test.${c.tool}`, tool: c.tool, args },
        // 🔴 授权表里给的是**另一个**工具：这才能证明授权是按工具判的，
        // 而不是"助手这条路整体放行"。
        { host: makeHost(), grants: { [c.tool === 'create_task' ? 'list_tasks' : 'create_task']: true } },
      );
      expect(outcome.kind).toBe('denied');
      expect(before).toBe(c.effect());
    });
  }
});

describe('任务估时提案先规范化再确认', () => {
  it.each([
    { raw: 900, normalized: 480 },
    { raw: 1, normalized: 5 },
  ])('原始 $raw 分钟在提案与落库中都使用 $normalized 分钟', async ({ raw, normalized }) => {
    const taskId = await seed({ action: 'create-task', title: '估时规范化' });
    const host = makeHost();
    const outcome = await runSelectedTool(
      {
        kind: 'tool',
        ruleId: 'test.set_task_estimate.normalize',
        tool: 'set_task_estimate',
        args: { taskId, minutes: raw },
      },
      { host, grants: { set_task_estimate: true } },
    );

    expect(outcome.kind).toBe('proposal');
    if (outcome.kind !== 'proposal') return;
    expect(outcome.proposal.intent).toEqual({
      action: 'set-task-estimate',
      taskId,
      minutes: normalized,
    });

    const confirmed = await confirmAiToolProposal(host, outcome.proposal, authorization('set_task_estimate'));
    expect(confirmed.ok).toBe(true);
    expect(engine.getState().tasks[taskId]?.note).toBe(`预计耗时：${String(normalized)} 分钟`);
  });
});

describe('🔴 这份清单必须跟着目录走', () => {
  it('目录里每个 `kind === write` 的工具都在这里（新加写工具却不登记 ⇒ 红）', () => {
    const writeTools = LOCAL_API_TOOLS.filter((t) => t.kind === 'write')
      .map((t) => t.name)
      .sort();
    const covered = CASES.map((c) => c.tool).sort();
    expect(covered).toEqual(writeTools);
  });

  it('🔴 并发或重复确认同一个提案只产生一次写入', async () => {
    // 登记这条现有行为，是为了让"以后有人在这里加去重"时必须在类型/测试上表态：
    // op-log 的幂等键是 op id，而两次 `submit` 生成的是两个 id。
    const host = makeHost();
    const before = alive('projects');
    const outcome = await runSelectedTool(
      { kind: 'tool', ruleId: 'test.create_project', tool: 'create_project', args: { name: '冥想' } },
      { host, grants: { create_project: true } },
    );
    if (outcome.kind !== 'proposal') throw new Error('这一条跑的是提案路径');
    await confirmAiToolProposal(host, outcome.proposal, authorization(outcome.proposal.tool));
    await confirmAiToolProposal(host, outcome.proposal, authorization(outcome.proposal.tool));
    expect(alive('projects')).toBe(before + 1);
  });
});
