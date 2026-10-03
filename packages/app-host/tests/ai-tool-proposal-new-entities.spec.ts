/**
 * 新增的写工具：**提案不是落库**（AI 侧那条最贵的不变量）
 * =======================================================
 *
 * 形状照 `ai-tool-run.spec.ts`，但两件事不同，而且都是刻意的：
 *
 * 1. **宿主是真的**（真引擎 + 真 SQLite），所以"提案阶段一条 op 都没有"
 *    是**数磁盘上的 op** 数出来的，不是数假宿主被调了几次。
 *    假 host 的计数器只能证明"我没调它"，证明不了"没有别的路径写了库"。
 * 2. **逐个新写工具都跑一遍**（`create_project` / `create_habit`），
 *    并且把"确认"那一步也跑完 —— 半边绿不算数：
 *    "跑完所有路径后 submit 为 0"这类判据，配上"确认后恰好 1 条 op"才闭环。
 */

import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import type { Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { confirmAiToolProposal, runSelectedTool } from '../src/ai-tool-run.js';
import { createLocalApiHost } from '../src/local-api-host.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;

const ALL_GRANTS = { create_project: true, create_habit: true } as const;

function makeHost() {
  return createLocalApiHost(engine, createTaskActions(engine, { now: () => 1_700_000_000_000 }), {
    isReadable: () => true,
  });
}

/** 状态里未删除的清单 / 习惯条数 —— 提案阶段的"零"要数得出分母。 */
function aliveProjects(): number {
  return Object.values(engine.getState().projects).filter((p) => p.deletedAt === undefined).length;
}
function aliveHabits(): number {
  return Object.values(engine.getState().habits).filter((h) => h.deletedAt === undefined).length;
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-test',
    now: () => 1_700_000_000_000,
  });
});

afterEach(() => {
  adapter.close();
});

const CASES = [
  { tool: 'create_project', args: { name: '读书' }, label: '清单', count: aliveProjects },
  { tool: 'create_habit', args: { name: '喝水', target: 8, unit: '杯' }, label: '习惯', count: aliveHabits },
] as const;

describe('🔴 写工具只产出提案，确认之后才有一条 op', () => {
  for (const c of CASES) {
    it(`${c.tool}：跑完执行这一步，${c.label}数为 0 且**状态里什么都没多**`, async () => {
      const before = c.count();
      const outcome = await runSelectedTool(
        { kind: 'tool', ruleId: `test.${c.tool}`, tool: c.tool, args: c.args },
        { host: makeHost(), grants: ALL_GRANTS },
      );
      expect(outcome.kind).toBe('proposal');
      if (outcome.kind !== 'proposal') return;
      expect(outcome.proposal.tool).toBe(c.tool);
      // 🔴 提案里是**意图**，不是 op：形状由 pack 的 `toIntent` 决定。
      expect(outcome.proposal.intent.action).toBe(
        c.tool === 'create_project' ? 'create-project' : 'create-habit',
      );
      // 这一步一条 op 都没写（"AI 一选中就落库"就是在这里被抓住的）。
      expect(c.count()).toBe(before);
    });

    it(`${c.tool}：确认之后**恰好一条** CRT op，且界面上真的看得见那条${c.label}`, async () => {
      const host = makeHost();
      const before = c.count();
      const outcome = await runSelectedTool(
        { kind: 'tool', ruleId: `test.${c.tool}`, tool: c.tool, args: c.args },
        { host, grants: ALL_GRANTS },
      );
      if (outcome.kind !== 'proposal') throw new Error('这一条跑的是提案路径');

      const confirmed = await confirmAiToolProposal(host, outcome.proposal);
      expect(confirmed.ok).toBe(true);
      expect(c.count()).toBe(before + 1);

      const entityId = confirmed.ok ? confirmed.taskId : '';
      const ops = await engine.getOpsForEntity(
        c.tool === 'create_project' ? 'PROJECT' : 'HABIT',
        entityId,
      );
      expect(ops).toHaveLength(1);
      // 确认之后读侧立刻读得回来 —— 写与读接的是同一份状态，不是两个平行世界。
      const listed =
        c.tool === 'create_project' ? await host.listProjects() : await host.listHabits();
      expect(listed.map((x) => x.id)).toContain(entityId);
    });
  }

  it('🔴 没授权的新工具：执行前复查拦住，**不产提案也不写库**', async () => {
    const host = makeHost();
    const before = aliveProjects();
    const outcome = await runSelectedTool(
      { kind: 'tool', ruleId: 'test.create_project', tool: 'create_project', args: { name: '读书' } },
      { host, grants: { create_habit: true } },
    );
    expect(outcome.kind).toBe('denied');
    expect(aliveProjects()).toBe(before);
  });

  it('🔴 重复确认同一个提案 = 两次写入（**这不是幂等**，所以调用方只能确认一次）', async () => {
    // 登记这条现有行为，是为了让"以后有人在这里加去重"时必须在类型/测试上表态：
    // op-log 的幂等键是 op id，而两次 `submit` 生成的是两个 id。
    const host = makeHost();
    const outcome = await runSelectedTool(
      { kind: 'tool', ruleId: 'test.create_habit', tool: 'create_habit', args: { name: '冥想' } },
      { host, grants: ALL_GRANTS },
    );
    if (outcome.kind !== 'proposal') throw new Error('这一条跑的是提案路径');
    await confirmAiToolProposal(host, outcome.proposal);
    await confirmAiToolProposal(host, outcome.proposal);
    expect(aliveHabits()).toBe(2);
  });
});
