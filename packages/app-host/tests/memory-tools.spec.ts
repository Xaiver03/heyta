/**
 * 记忆工具（读 / 写）在宿主上的真实行为
 * ======================================
 *
 * 这一层不测目录形状（`local-api` 的 tool-pack-coverage 管那个），测的是
 * **接上真实 op-log 之后**的三件事：
 *
 *   1. 写 `remember_memory` 真的落一条 `USER_MEMORY` op，且是 active；
 *   2. 读 `list_memories` 只给 active —— pending / forgotten 一条都不许出境；
 *   3. 敏感内容与空文本被拒绝，且**零 op**。
 */

import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import type { Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';
import { createLocalApiHost } from '../src/local-api-host.js';
import { createUserMemoryActions } from '../src/user-memory-actions.js';
import type { UserMemory } from '@heyta/domain';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;
let host: ReturnType<typeof createLocalApiHost>;
const clock = 1_700_000_000_000;
const now = (): number => clock;

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-test',
    now,
  });
  actions = createTaskActions(engine, { now });
  host = createLocalApiHost(engine, actions, { isReadable: () => true });
});

afterEach(() => {
  adapter.close();
});

const opsOf = (entityId: string): Promise<readonly Operation<string>[]> =>
  engine.getOpsForEntity('USER_MEMORY', entityId);

describe('remember_memory → USER_MEMORY op', () => {
  it('写一条：ok + id，op 真的落了，读得到 active', async () => {
    const result = await host.submit({
      action: 'remember-memory',
      text: '回答先给结论',
      kind: 'preference',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const list = await host.listMemories?.();
    expect(list).toEqual([{ id: result.taskId, kind: 'preference', text: '回答先给结论' }]);

    const ops = await opsOf(result.taskId);
    expect(ops.length).toBe(1);
  });

  it('不给 kind 时按事实落，不猜成偏好', async () => {
    const result = await host.submit({ action: 'remember-memory', text: '主力设备是 Mac' });
    expect(result.ok).toBe(true);
    const list = await host.listMemories?.();
    expect(list?.[0]?.kind).toBe('fact');
  });

  it('同一句重复写：幂等，不会长出两条', async () => {
    const first = await host.submit({ action: 'remember-memory', text: '回答先给结论' });
    const second = await host.submit({ action: 'remember-memory', text: '回答先给结论' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.taskId).toBe(first.taskId);
    expect(await host.listMemories?.()).toHaveLength(1);
  });

  it('空文本与敏感内容被拒，零 op', async () => {
    const empty = await host.submit({ action: 'remember-memory', text: '   ' });
    expect(empty.ok).toBe(false);
    const secret = await host.submit({ action: 'remember-memory', text: '我的密码是 abc123' });
    expect(secret.ok).toBe(false);
    expect(await host.listMemories?.()).toHaveLength(0);
  });
});

describe('list_memories 只出境 active', () => {
  it('pending / forgotten 不在列表里', async () => {
    const memoryActions = createUserMemoryActions(engine, { now });
    await memoryActions.add({ kind: 'fact', text: '推断出来的一条', origin: 'extracted' });
    const active = await memoryActions.add({ kind: 'preference', text: '回答先给结论' });
    const forgotten = await memoryActions.add({ kind: 'fact', text: '将要忘掉的一条' });
    await memoryActions.forget(forgotten);

    const list = await host.listMemories?.();
    expect(list?.map((m) => m.id)).toEqual([active]);
    expect(list?.[0]?.text).toBe('回答先给结论');
  });

  it('宿主没接 listMemories 时，读工具明确报读不到（不是空列表）', async () => {
    const bare = createLocalApiHost(engine, actions, { isReadable: () => true });
    delete (bare as { listMemories?: unknown }).listMemories;
    const { runReadTool } = await import('@heyta/local-api');
    const outcome = await runReadTool(bare, 'list_memories', {});
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('读不到');
  });
});

// 类型锚：payload 里不许把 pending 当 active 投影出去（防止后来者"顺手全给"）。
const _typeAnchor: UserMemory['status'][] = ['active', 'pending', 'superseded', 'archived', 'forgotten'];
void _typeAnchor;
