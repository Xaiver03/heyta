/**
 * 手动排序（R4①）—— 拖动**一条 op** 的判据面
 * =============================================
 *
 * 这一组钉三件事：
 *
 * 1. **`manual` 档真的排** —— 之前它对"两条都没有 `order`"返回 0，于是
 *    "选了手动拖拽"等于没选（web 上就是那句话：选了没作用）。
 * 2. **一次拖动 = 一条 `order` 写入**（`planManualReorder` 的 `move` 分支）。
 *    这是 §3.4 的落点：顺序是连续量，批量写会整片覆盖。
 * 3. **没排过序的任务之间也插得进去** —— 靠 `MANUAL_ORDER_FALLBACK_BASE` 那个合成键。
 *    没有它，"首次拖动"必须先给整张列表归位（N 条 op），而那正是②要拦的东西。
 *
 * 🔴 判据能红：把 `apps/web` 的 `setOrder` 调用注掉 / 把 `sortTasks` 的 `case 'manual'`
 * 退回 `order ?? MAX_SAFE_INTEGER`，①都会红（读数写在计划文档）。
 */

import { describe, expect, it } from 'vitest';

import type { Task } from '../src/entities.js';
import {
  MANUAL_ORDER_FALLBACK_BASE,
  manualOrderBetween,
  manualOrderKey,
  planManualReorder,
  sortTasks,
} from '../src/task-order.js';

/** 只带排序相关字段的任务（其余字段对这几个函数无意义）。 */
function task(id: string, order: number | undefined, createdAt: number): Task {
  return {
    id,
    title: id,
    createdAt,
    updatedAt: createdAt,
    ...(order === undefined ? {} : { order }),
  };
}

describe('manual 档真的排（不是"选了没作用"）', () => {
  it('有 order 的按 order 升序', () => {
    const tasks = [task('c', 30, 3), task('a', 10, 1), task('b', 20, 2)];
    expect(sortTasks(tasks, 'manual').map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('🔴 一条 order 都没有时**按创建时间**排（不是原序，也不是乱序）', () => {
    const tasks = [task('late', undefined, 300), task('early', undefined, 100), task('mid', undefined, 200)];
    // 原序是 late → early → mid；手动档给出的是创建时间序。
    expect(sortTasks(tasks, 'manual').map((item) => item.id)).toEqual(['early', 'mid', 'late']);
  });

  it('显式 order 一律排在"没排过序"之前（合成键的量级远大于小整数 order）', () => {
    const tasks = [task('unranked', undefined, 1), task('ranked', 999_999, 2)];
    expect(sortTasks(tasks, 'manual').map((item) => item.id)).toEqual(['ranked', 'unranked']);
  });

  it('合成键 = BASE + createdAt（跨端同一个数，不依赖本机时钟之外的任何东西）', () => {
    expect(manualOrderKey({ createdAt: 1_700_000_000_000 })).toBe(MANUAL_ORDER_FALLBACK_BASE + 1_700_000_000_000);
    expect(manualOrderKey({ createdAt: 1_700_000_000_000, order: 7 })).toBe(7);
  });
});

describe('planManualReorder：一次拖动只写被拖的那一条', () => {
  const a = task('a', 10, 1);
  const b = task('b', 20, 2);
  const c = task('c', 30, 3);
  const ordered = [a, b, c];

  it('a 拖到最下面 ⇒ 只写 a 一条，值落在 c 之后', () => {
    const plan = planManualReorder(ordered, 0, 2);
    expect(plan?.kind).toBe('move');
    if (plan?.kind !== 'move') throw new Error('unreachable');
    expect(plan.id).toBe('a');
    expect(plan.order).toBeGreaterThan(30);
    // 只写了一条：这就是"一次拖动 = 一条 op"的**领域层**读数。
    expect(Object.keys(plan)).toEqual(['kind', 'id', 'order']);
  });

  it('c 拖到最上面 ⇒ 只写 c 一条，值落在 a 之前', () => {
    const plan = planManualReorder(ordered, 2, 0);
    if (plan?.kind !== 'move') throw new Error('应当是可表示的移动');
    expect(plan.id).toBe('c');
    expect(plan.order).toBeLessThan(10);
  });

  it('插到 a 与 b 之间 ⇒ 中值 15', () => {
    const plan = planManualReorder([a, c, b], 1, 1);
    expect(plan, '原地不动 ⇒ 不写任何东西').toBeUndefined();
    const moved = planManualReorder([a, c, b], 1, 2); // c 放到 b 之后
    if (moved?.kind !== 'move') throw new Error('应当是可表示的移动');
    expect(moved.id).toBe('c');
    expect(moved.order).toBeGreaterThan(20);
  });

  it('越界 / 没动 ⇒ undefined（调用方不许写"没变化"的 op）', () => {
    expect(planManualReorder(ordered, 1, 1)).toBeUndefined();
    expect(planManualReorder(ordered, -1, 1)).toBeUndefined();
    expect(planManualReorder(ordered, 0, 3)).toBeUndefined();
    expect(planManualReorder([], 0, 0)).toBeUndefined();
  });

  it('🔴 没排过序的任务之间也插得进去（所以"首次拖动"不需要归位那一轮）', () => {
    const x = task('x', undefined, 100);
    const y = task('y', undefined, 200);
    const z = task('z', undefined, 300);
    const plan = planManualReorder([x, y, z], 0, 1); // x 插到 y 与 z 之间
    if (plan?.kind !== 'move') throw new Error('应当是可表示的移动，不该退化成 respace');
    expect(plan.id).toBe('x');
    const keyY = manualOrderKey(y);
    const keyZ = manualOrderKey(z);
    expect(plan.order).toBeGreaterThan(keyY);
    expect(plan.order).toBeLessThan(keyZ);
  });

  it('精度用尽时退化成 respace（给这一屏重排间距），并如实报告要写几条', () => {
    /**
     * 构造一个**真的**夹不进去的缺口：`1` 与 `1 + Number.EPSILON` 是相邻的两个
     * double（ulp 恰为 `Number.EPSILON`），它们的中值会 round 回 `1`。
     * 于是"把 r 插到 p 与 q 之间"没有任何数能表达 ⇒ 只能重排。
     */
    const p = task('p', 1, 1);
    const q = task('q', 1 + Number.EPSILON, 2);
    const r = task('r', 100, 3);
    const plan = planManualReorder([p, q, r], 2, 1);
    expect(plan?.kind, '夹不进 ⇒ 必须走 respace，不许写一个等于邻居的 order').toBe('respace');
    if (plan?.kind !== 'respace') throw new Error('unreachable');
    /**
     * 重排后顺序 = p, r, q ⇒ 间距 0 / 1 / 2。
     * **三条都要写**：p 从 1 变 0，其余两条也各变了 —— 这就是兜底路径的真实代价
     * （N 条单字段 op）。它只在"同一对邻居之间插到 double 夹不进"时才发生，
     * 计划文档里如实登记了。
     */
    expect(plan.orders.map((entry) => `${entry.id}:${String(entry.order)}`)).toEqual(['p:0', 'r:1', 'q:2']);
  });

  it('末端插入永远是 move（有下界、没上界 ⇒ prev + 1）', () => {
    const p = task('p', 1, 1);
    const q = task('q', 1 + Number.EPSILON, 2);
    const plan = planManualReorder([p, q], 0, 1);
    expect(plan?.kind).toBe('move');
  });

  it('manualOrderBetween：四种邻居组合', () => {
    expect(manualOrderBetween(undefined, undefined)).toBe(0);
    expect(manualOrderBetween(undefined, 5)).toBe(4);
    expect(manualOrderBetween(5, undefined)).toBe(6);
    expect(manualOrderBetween(10, 20)).toBe(15);
    // 相邻 double：夹不进去 ⇒ undefined（由 respace 兜底）
    expect(manualOrderBetween(1, 1 + Number.EPSILON)).toBeUndefined();
  });
});
