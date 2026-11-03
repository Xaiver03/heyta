/**
 * 任务动态投影（`task-activity.ts`）
 * =================================
 *
 * 这一族盯的是**四类会编造事实的写法**，它们全都静默：
 *
 *   1. 从单条 op 里读"旧值" → 永远是 `undefined` → 界面显示"从空改成 X"；
 *   2. 批量 op 的整份载荷算给一条任务 → 别的任务的改动出现在这条的流水里；
 *   3. 把"这台设备记录到的"说成"完整历史" → 新设备上是不实陈述；
 *   4. 顺序依赖入参 → 同一份日志在两台设备上流水顺序不同。
 */

import { describe, expect, it } from 'vitest';

import {
  projectTaskActivity,
  taskActivityCoverage,
  taskActivityTouchedFields,
  type TaskActivityOp,
} from '../src/task-activity.js';

const ID = 'task-1';
const OTHER = 'task-2';
const LOCAL = 'client-a';
const T0 = 1_700_000_000_000;

function op(over: Partial<TaskActivityOp> & { id: string }): TaskActivityOp {
  return {
    opType: 'UPD',
    timestamp: T0,
    clientId: LOCAL,
    entityId: ID,
    ...over,
  };
}

const opts = { localClientId: LOCAL };

describe('基本事件', () => {
  it('CRT 是一条 created，载荷里的字段就是它的初始值', () => {
    const events = projectTaskActivity(
      [op({ id: 'o1', opType: 'CRT', payload: { title: '买牛奶', priority: 3 } })],
      ID,
      opts,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('created');
    expect(events[0]?.changes.map((c) => c.field).sort()).toEqual(['priority', 'title']);
  });

  it('🔴 旧值来自投影自己折的快照，不是从单条 op 里读', () => {
    const events = projectTaskActivity(
      [
        op({ id: 'o1', opType: 'CRT', payload: { title: '买牛奶' } }),
        op({ id: 'o2', timestamp: T0 + 10, payload: { title: '买燕麦奶' } }),
      ],
      ID,
      opts,
    );
    const change = events.find((e) => e.kind === 'updated')?.changes[0];
    expect(change?.from).toBe('买牛奶');
    expect(change?.to).toBe('买燕麦奶');
  });

  it('写了个一模一样的值不算变更（不产生 change，也不产生噪音事件）', () => {
    const events = projectTaskActivity(
      [
        op({ id: 'o1', opType: 'CRT', payload: { title: 'a' } }),
        op({ id: 'o2', timestamp: T0 + 1, payload: { title: 'a' } }),
      ],
      ID,
      opts,
    );
    // ⚠️ 返回是**最近在前**，所以按 opId 取而不是按下标 —— 按下标会取到那条 CRT，
    //    而它有一个货真价实的初始变更。
    expect(events.find((e) => e.opId === 'o2')?.changes).toHaveLength(0);
  });

  it('清除写成 `null` ⇒ `cleared` 为真、`to` 是 undefined，且快照里这个字段被删掉', () => {
    const events = projectTaskActivity(
      [
        op({ id: 'o1', opType: 'CRT', payload: { title: 'a', dueDate: T0 } }),
        op({ id: 'o2', timestamp: T0 + 1, payload: { dueDate: null } }),
        op({ id: 'o3', timestamp: T0 + 2, payload: { dueDate: T0 + 99 } }),
      ],
      ID,
      opts,
    );
    expect(events.find((e) => e.opId === 'o2')?.changes[0]).toMatchObject({
      cleared: true,
      to: undefined,
      from: T0,
    });
    // 清除之后第三次改的 from 必须是 undefined，而不是被清除前的旧值。
    expect(events.find((e) => e.opId === 'o3')?.changes[0]?.from).toBeUndefined();
  });

  it('DEL ⇒ deleted；`deletedAt: null` 的 UPD ⇒ restored', () => {
    const events = projectTaskActivity(
      [
        op({ id: 'o1', opType: 'CRT', payload: { title: 'a' } }),
        op({ id: 'o2', opType: 'DEL', timestamp: T0 + 1 }),
        op({ id: 'o3', timestamp: T0 + 2, payload: { deletedAt: null } }),
      ],
      ID,
      opts,
    );
    expect(events.map((e) => e.kind)).toEqual(['restored', 'deleted', 'created']);
  });

  it('认不出的键走 other 并保留原名（不静默丢，也不冒充认识）', () => {
    const events = projectTaskActivity(
      [op({ id: 'o1', opType: 'CRT', payload: { title: 'a' } }), op({ id: 'o2', timestamp: T0 + 1, payload: { widgetSyncToken: 'x' } })],
      ID,
      opts,
    );
    const change = events.find((e) => e.opId === 'o2')?.changes[0];
    expect(change).toMatchObject({ field: 'other', rawField: 'widgetSyncToken' });
  });

  it('内部字段不进流水（每次写都带，报出来全是噪音）', () => {
    const events = projectTaskActivity(
      [op({ id: 'o1', timestamp: T0 + 1, payload: { title: 'a', updatedAt: T0 + 1, dueDateLocal: '2026-11-02' } })],
      ID,
      opts,
    );
    expect(taskActivityTouchedFields(events)).toEqual(new Set(['title']));
  });
});

describe('🔴 批量 op 只取本任务那一份', () => {
  it('payload.tasks 装着两条任务 ⇒ 流水里只有属于本任务的那次改动', () => {
    const events = projectTaskActivity(
      [
        op({
          id: 'b1',
          opType: 'BATCH',
          entityId: ID,
          entityIds: [ID, OTHER],
          payload: { tasks: [{ id: ID, title: '我的新标题' }, { id: OTHER, title: '别人的标题' }] },
        }),
      ],
      ID,
      opts,
    );
    expect(events[0]?.changes).toHaveLength(1);
    expect(events[0]?.changes[0]).toMatchObject({ field: 'title', to: '我的新标题' });
    expect(events[0]?.batched).toBe(true);
  });

  it('认不出批量结构时**不编造字段级事实**（changes 为空，但仍记这一次操作）', () => {
    const events = projectTaskActivity(
      [op({ id: 'b2', opType: 'BATCH', entityIds: [ID, OTHER], payload: { ids: [ID, OTHER] } })],
      ID,
      opts,
    );
    expect(events[0]?.changes).toHaveLength(0);
    expect(events[0]?.batched).toBe(true);
  });

  it('别的任务的 op 一条都不算进来', () => {
    const events = projectTaskActivity(
      [
        op({ id: 'x1', entityId: OTHER, payload: { title: '别人的' } }),
        op({ id: 'x2', payload: { title: '我的' } }),
      ],
      ID,
      opts,
    );
    expect(events.map((e) => e.opId)).toEqual(['x2']);
  });
});

describe('顺序、来源与覆盖范围', () => {
  it('入参乱序也按时间折（否则同一份日志在两台设备上流水不同）', () => {
    const events = projectTaskActivity(
      [
        op({ id: 'o3', timestamp: T0 + 2, payload: { title: 'c' } }),
        op({ id: 'o1', opType: 'CRT', timestamp: T0, payload: { title: 'a' } }),
        op({ id: 'o2', timestamp: T0 + 1, payload: { title: 'b' } }),
      ],
      ID,
      opts,
    );
    // 返回是**最近在前**，而 from 必须是按时间正序折出来的。
    expect(events.map((e) => e.opId)).toEqual(['o3', 'o2', 'o1']);
    expect(events[0]?.changes[0]?.from).toBe('b');
  });

  it('clientId 决定"是我写的还是别的设备写的"', () => {
    const events = projectTaskActivity(
      [
        op({ id: 'o1', opType: 'CRT', payload: { title: 'a' } }),
        op({ id: 'o2', timestamp: T0 + 1, clientId: 'client-b', payload: { title: 'b' } }),
      ],
      ID,
      opts,
    );
    expect(events.find((e) => e.opId === 'o2')?.local).toBe(false);
    expect(events.find((e) => e.opId === 'o1')?.local).toBe(true);
  });

  it('limit 从最近往回数，不截掉最近的', () => {
    const ops = Array.from({ length: 10 }, (_, i) =>
      op({ id: `o${i}`, opType: i === 0 ? 'CRT' : 'UPD', timestamp: T0 + i, payload: { title: `t${i}` } }),
    );
    const events = projectTaskActivity(ops, ID, { ...opts, limit: 3 });
    expect(events.map((e) => e.opId)).toEqual(['o9', 'o8', 'o7']);
  });

  it('includeValues 关掉后 from/to 一律不填（隐私敏感场景）', () => {
    const events = projectTaskActivity(
      [op({ id: 'o1', opType: 'CRT', payload: { title: '体检报告' } })],
      ID,
      { localClientId: LOCAL, includeValues: false },
    );
    expect(events[0]?.changes[0]).toMatchObject({ field: 'title', from: undefined, to: undefined });
  });

  it('🔴 覆盖范围：最早那条就是创建那条 ⇒ complete；否则只能说本机记录到的', () => {
    expect(
      taskActivityCoverage({ taskCreatedAt: T0, earliestEventAt: T0 }),
    ).toBe('complete');
    // 新设备：任务早就存在，本地日志只有后来的增量。
    expect(
      taskActivityCoverage({ taskCreatedAt: T0 - 10, earliestEventAt: T0 }),
    ).toBe('device-local-only');
    expect(taskActivityCoverage({ taskCreatedAt: T0, earliestEventAt: undefined })).toBe('empty');
  });
});
