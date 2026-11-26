/**
 * 陈述记忆的宿主写路径（store 级）
 * =================================
 *
 * 这一层测的是「用户说一句话 → op 落盘 → 物化状态可见」这条**真实链路**，
 * 不是领域纯函数（那份在 `packages/domain/tests/user-memory.spec.ts`）。
 * 两者都要：纯函数保证规则对，这一层保证规则**真的接上了**。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { IndexedDbAdapter, IndexedDbOpLogStore } from '@heyta/storage';
import { emptyState } from '@heyta/op-log';
import type { Operation } from '@heyta/sync-core';

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

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;
  dbName = `user-memory-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' }, now: Date.now(), ready: false });
  await initOpLog(dbName);
});

describe('明说捕获', () => {
  it('「记住：…」→ 落一条 USER_MEMORY op，物化可见且是 active', async () => {
    const id = await useTaskStore
      .getState()
      .captureStatedMemory('记住：以后回答先给结论，别铺垫');
    expect(id).not.toBeNull();

    const memories = Object.values(useTaskStore.getState().entities.userMemories);
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      kind: 'preference',
      status: 'active',
      origin: 'stated',
      text: '以后回答先给结论，别铺垫',
    });
    expect((await allOps()).some((op) => op.entityType === 'USER_MEMORY')).toBe(true);
  });

  it('不是明说句式 → 零 op、零条目', async () => {
    const id = await useTaskStore.getState().captureStatedMemory('今天有什么任务？');
    expect(id).toBeNull();
    expect(Object.keys(useTaskStore.getState().entities.userMemories)).toHaveLength(0);
    expect((await allOps()).some((op) => op.entityType === 'USER_MEMORY')).toBe(false);
  });

  it('同一句再说一遍不会长出第二条', async () => {
    const store = useTaskStore.getState();
    const first = await store.captureStatedMemory('记住：回答先给结论');
    const second = await store.captureStatedMemory('记住：回答先给结论');
    expect(first).toBe(second);
    expect(Object.keys(useTaskStore.getState().entities.userMemories)).toHaveLength(1);
  });
});

describe('自动推断（M9，默认关）', () => {
  it('开关打开：非明说的陈述句落 pending', async () => {
    await useTaskStore.getState().captureMemories('我通常晚上写代码。', true);
    const items = Object.values(useTaskStore.getState().entities.userMemories);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'pending', origin: 'extracted' });
  });

  it('开关关闭：同一句零写入', async () => {
    await useTaskStore.getState().captureMemories('我通常晚上写代码。', false);
    expect(Object.keys(useTaskStore.getState().entities.userMemories)).toHaveLength(0);
  });

  it('明说优先：不再走推断，直接 active', async () => {
    await useTaskStore.getState().captureMemories('记住：我通常晚上写代码', true);
    const items = Object.values(useTaskStore.getState().entities.userMemories);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'active', origin: 'stated' });
  });
});

describe('手动新增 / 忘记', () => {
  it('敏感内容被拒，且不落 op', async () => {
    await expect(
      useTaskStore.getState().addUserMemory({ kind: 'fact', text: '我的密码是 abc123' }),
    ).rejects.toThrow();
    expect((await allOps()).some((op) => op.entityType === 'USER_MEMORY')).toBe(false);
  });

  it('忘记 → 状态 forgotten、正文清空、指纹保留', async () => {
    const id = await useTaskStore
      .getState()
      .addUserMemory({ kind: 'preference', text: '回答先给结论' });
    await useTaskStore.getState().forgetUserMemory(id);

    const item = useTaskStore.getState().entities.userMemories[id];
    expect(item?.status).toBe('forgotten');
    expect(item?.text).toBe('');
    expect(item?.textHash).not.toBe('');
  });

  it('编辑正文：重算主题与指纹，来源标 manual', async () => {
    const id = await useTaskStore
      .getState()
      .addUserMemory({ kind: 'preference', text: '回答先给结论' });
    const before = useTaskStore.getState().entities.userMemories[id]?.textHash;
    await useTaskStore.getState().updateUserMemory(id, '回答要展开讲');
    const item = useTaskStore.getState().entities.userMemories[id];
    expect(item?.text).toBe('回答要展开讲');
    expect(item?.origin).toBe('manual');
    expect(item?.textHash).not.toBe(before);
    expect((await allOps()).some((op) => op.entityType === 'USER_MEMORY' && op.opType === 'UPD')).toBe(true);
  });

  it('确认推断：pending → active', async () => {
    const id = await useTaskStore
      .getState()
      .addUserMemory({ kind: 'fact', text: '主力设备是 Mac', origin: 'extracted' });
    expect(useTaskStore.getState().entities.userMemories[id]?.status).toBe('pending');
    await useTaskStore.getState().confirmUserMemory(id);
    expect(useTaskStore.getState().entities.userMemories[id]?.status).toBe('active');
  });
});
