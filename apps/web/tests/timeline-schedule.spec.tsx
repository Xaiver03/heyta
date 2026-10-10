/**
 * 排期拖拽的**出口判据**（时间线 P2，goal §3.3 三条骨架）
 * ====================================================
 *
 * 骨架 1（op 形状）：拖拽出口 → `store.setSchedule` → `TaskActions.setSchedule` →
 * `dispatch()` —— op-log 里必须出现**恰好一条**形状正确的 UPD。
 * 「状态变了」不算数（§7 元规则：『状态对』在『没生效』时也可能绿），
 * 这里的证据是 **op 本身**。
 *
 * 骨架 2（本地优先）：op 落在**本地** op-log（fake IndexedDB 的真 SQLite 存储），
 * 物化状态由引擎重放得到 —— 整个测试**零网络**。离线刷新后位置仍在的
 * 机制就是它：重放 ops，字段还在。
 *
 * 骨架 3（变异）：把 `store.setSchedule` 改成**绕过 dispatch 直改实体** ⇒
 * 骨架 1 的判据转红（2026-10-02 已执行：变异下 `getOpsForEntity` 停在基线，
 * `setSchedule 判据` 红，恢复后转绿 —— 台账）。
 */

import { parseLocalDate } from '@heyta/domain';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { OpType } from '@heyta/sync-core';

import { __resetOpLogForTests, initOpLog, requireEngine } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';

beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  __resetOpLogForTests();
  await initOpLog();
});

describe('🔴🔴 P2 出口判据：拖拽 → setSchedule → 恰好一条形状正确的 op', () => {
  it('🔴 泳道拖上轴：一条 UPD{startDate, durationMinutes}（骨架 1）+ 物化状态到位（骨架 2）', async () => {
    await useTaskStore.getState().addTask('被拖的任务');
    // addTask 不返回 id（store 形状如此）—— 从实体表里按标题找。
    const state = useTaskStore.getState().entities;
    const entry = Object.values(state.tasks ?? {}).find((t) => t.title === '被拖的任务');
    expect(entry, '建任务后实体表里应有它').toBeTruthy();
    const taskId = entry!.id;

    const engine = requireEngine();
    const before = await engine.getOpsForEntity('TASK', taskId);

    const start = parseLocalDate('2026-10-02').getTime() + 9 * 3_600_000;
    await useTaskStore.getState().setSchedule(taskId, { startDate: start, durationMinutes: 90 });

    const ops = await engine.getOpsForEntity('TASK', taskId);
    expect(ops).toHaveLength(before.length + 1);
    const last = ops[ops.length - 1]!;
    expect(last.opType).toBe(OpType.Update);
    expect(last.payload).toEqual({ startDate: start, startDateLocal: null, durationMinutes: 90 });

    // 骨架 2 的形态：引擎重放出的物化状态就是"离线刷新后"看到的东西。
    const fresh = useTaskStore.getState().entities;
    const task = fresh.tasks?.[taskId];
    expect(task?.startDate).toBe(start);
    expect(task?.durationMinutes).toBe(90);
  });

  it('🔴 手势 4「点空白建任务带日期」：addTask 带 startDate ⇒ 一条 CRT，载荷含标题+日期字段', async () => {
    const engine = requireEngine();
    const start = parseLocalDate('2026-10-02').getTime() + 14 * 3_600_000;
    // 这就是宿主把 `onCreateAt` 接到的那条路径：既有建任务 op + 日期字段，
    // 一次 CRT 完成、不 fan-out（goal §3.2 手势 4）。
    await useTaskStore.getState().addTask('未命名任务', { startDate: start });

    const state = useTaskStore.getState().entities;
    const entry = Object.values(state.tasks ?? {}).find((t) => t.title === '未命名任务');
    expect(entry, '建完实体表里应有它').toBeTruthy();
    const ops = await engine.getOpsForEntity('TASK', entry!.id);
    // 🔴 一条 CRT —— 不 fan-out（没有第二条「补日期」的 op）
    expect(ops).toHaveLength(1);
    expect(ops[0]!.opType).toBe(OpType.Create);
    expect(ops[0]!.payload).toEqual({ title: '未命名任务', priority: 0, startDate: start });
    // 生产者读它 ⇒ 板上的点落在点击的时刻
    expect(entry!.startDate).toBe(start);
  });

  it('🔴 拖整条移动：第二条 op 只含 startDate（时长不被覆盖）', async () => {
    await useTaskStore.getState().addTask('先排后移');
    const entry = Object.values(useTaskStore.getState().entities.tasks ?? {}).find(
      (t) => t.title === '先排后移',
    )!;
    const engine = requireEngine();
    const start = parseLocalDate('2026-10-02').getTime() + 9 * 3_600_000;
    await useTaskStore.getState().setSchedule(entry.id, { startDate: start, durationMinutes: 60 });

    const before = await engine.getOpsForEntity('TASK', entry.id);
    await useTaskStore.getState().setSchedule(entry.id, { startDate: start + 3_600_000 });
    const ops = await engine.getOpsForEntity('TASK', entry.id);
    expect(ops).toHaveLength(before.length + 1);
    expect(ops[ops.length - 1]!.payload).toEqual({ startDate: start + 3_600_000, startDateLocal: null });

    const task = useTaskStore.getState().entities.tasks?.[entry.id];
    expect(task?.startDate).toBe(start + 3_600_000);
    expect(task?.durationMinutes).toBe(60); // 没被移动这条 op 碰掉
  });
});
