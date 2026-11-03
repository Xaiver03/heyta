/**
 * 任务动态适配层（`task-activity.ts`）
 * ===================================
 *
 * 判据本体在 `@heyta/domain`，有 15 条穷举测。这一层只测它**自己那两件事**：
 *
 *   1. 引擎的 `Operation` → 领域层结构入参的映射没丢字段
 *      （`entityIds` 与 `payload` 丢了，批量 op 就会整条失效）；
 *   2. 🔴 覆盖范围问的是**最早那条**，而 `events` 是"最近在前" ⇒ 取错了下标
 *      会让几乎每台设备都被判成 `complete` —— 那是一个不会报错的不实陈述，
 *      所以这一条必须钉住，而不是靠注释。
 */

import type { TaskActivityOpSource } from '@heyta/app-host';
import type { EntityType } from '@heyta/shared-schema';
import type { Operation } from '@heyta/sync-core';
import { describe, expect, it } from 'vitest';

import { readTaskActivity } from '../src/task-activity.js';

const T0 = 1_700_000_000_000;
const ID = 'task-1';

/**
 * 只构造本层真会读到的字段。
 *
 * ⚠️ 用 `as unknown as Operation<string>` 而不是补一堆假字段：适配层**只**按名字取
 *   `id/opType/timestamp/clientId/entityId/entityIds/payload`，多写的那些既没人读、
 *   又会让"适配层其实依赖了别的字段"这种变化悄悄通过。
 */
function row(over: Record<string, unknown>): Operation<string> {
  return over as unknown as Operation<string>;
}

function source(ops: Operation<string>[], clientId = 'client-a'): TaskActivityOpSource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async getOpsForEntity(entityType: EntityType, entityId: string) {
      asked.push(`${entityType}:${entityId}`);
      return ops;
    },
    getClientId: () => clientId,
  };
}

describe('映射', () => {
  it('只查 TASK 这一族，且查的就是这条任务', async () => {
    const src = source([]);
    await readTaskActivity(src, { id: ID, createdAt: T0 });
    expect(src.asked).toEqual([`TASK:${ID}`]);
  });

  it('entityIds 与 payload 一路透到领域层（丢了批量 op 就整条失效）', async () => {
    const src = source([
      row({
        id: 'b1',
        opType: 'BATCH',
        timestamp: T0,
        clientId: 'client-a',
        entityId: ID,
        entityIds: [ID, 'task-2'],
        payload: { tasks: [{ id: ID, title: '我的新标题' }, { id: 'task-2', title: '别人的' }] },
      }),
    ]);
    const { events } = await readTaskActivity(src, { id: ID, createdAt: T0 });
    expect(events[0]).toMatchObject({ batched: true, local: true });
    expect(events[0]?.changes).toEqual([
      { field: 'title', from: undefined, to: '我的新标题', cleared: false },
    ]);
  });
});

describe('🔴 覆盖范围取的是最早那条，不是最新那条', () => {
  it('任务先存在、本地只有后来的增量 ⇒ device-local-only', async () => {
    // 三条 op 全在创建**之后**：取 `events[0]`（最新）会算出 complete，那是假的。
    const src = source([
      row({ id: 'o1', opType: 'UPD', timestamp: T0 + 100, clientId: 'client-a', entityId: ID, payload: { title: 'a' } }),
      row({ id: 'o2', opType: 'UPD', timestamp: T0 + 200, clientId: 'client-a', entityId: ID, payload: { title: 'b' } }),
    ]);
    const { events, coverage } = await readTaskActivity(src, { id: ID, createdAt: T0 });
    expect(events[0]?.opId).toBe('o2'); // 最近在前
    expect(coverage).toBe('device-local-only');
  });

  it('本地最早那条就是创建那条 ⇒ 才敢说 complete', async () => {
    const src = source([
      row({ id: 'o1', opType: 'CRT', timestamp: T0, clientId: 'client-a', entityId: ID, payload: { title: 'a' } }),
      row({ id: 'o2', opType: 'UPD', timestamp: T0 + 10, clientId: 'client-b', entityId: ID, payload: { title: 'b' } }),
    ]);
    const { coverage, events } = await readTaskActivity(src, { id: ID, createdAt: T0 });
    expect(coverage).toBe('complete');
    // 别的设备写的仍然在流水里（下行 op 会落本地日志）。
    expect(events.some((e) => !e.local)).toBe(true);
  });

  it('一条都没有 ⇒ empty，不拿 undefined 当"完整"', async () => {
    const { coverage } = await readTaskActivity(source([]), { id: ID, createdAt: T0 });
    expect(coverage).toBe('empty');
  });
});
