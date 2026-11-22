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

import { Priority } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { LOCAL_API_TOOLS, type LocalApiWriteIntent } from '@heyta/local-api';
import type { Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { confirmAiToolProposal, runSelectedTool } from '../src/ai-tool-run.js';

const authorization = (tool: string) => ({ getGrants: () => ({ [tool]: true }) });
import type { ToolArgs } from '../src/ai-tool-selection.js';
import { createLocalApiHost } from '../src/local-api-host.js';

const CLOCK = 1_700_000_000_000;

let adapter: SqliteAdapter;
let engine: OpLogEngine;

function makeHost() {
  return createLocalApiHost(engine, createTaskActions(engine, { now: () => CLOCK }), {
    isReadable: () => true,
    now: () => CLOCK,
  });
}

/** 未删除实体的条数（效果读数的分母必须是活的实体，不然墓碑也算"写成功"）。 */
function alive<K extends 'tasks' | 'projects' | 'habits' | 'tags' | 'notes' | 'habitLogs' | 'focusSessions' | 'reminders' | 'events'>(
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
