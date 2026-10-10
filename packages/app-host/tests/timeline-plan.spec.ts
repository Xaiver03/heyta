/**
 * 时间线规划语义（B 轨 `timeline` 整刀第 1 步）
 * ================================================
 *
 * 这些判据此前**不存在** —— `planTask` 住在 web 的视图文件里，只有组件级测试
 * 间接覆盖。搬进 `packages/app-host` 之后，把三个产品问题逐个钉死：
 *
 *   1. 没有清单时，任务是**消失**还是**整条自己算一条**？
 *   2. 备注里的 AI 估时，什么时候**能**落到条上？
 *   3. 落不下去时（清单有 N>1 条），是**编一个分摊**还是**明说摊不了**？
 *
 * ⚠️ 另有一条容易写错的边界：`0 分钟` 是"估了 0 分钟"，**不是**"没估过"。
 */

import { describe, expect, it } from 'vitest';

import { MIN_DURATION_MINUTES } from '@heyta/domain';

import {
  deriveTaskTimePosition,
  planTimelineBlock,
  planTimelineRows,
} from '../src/timeline-plan.js';

describe('planTimelineBlock：没有清单时整条任务自己算一条', () => {
  it('🔴 不静默消失：标题成为唯一可排单元的 title，工期退回默认值', () => {
    const block = planTimelineBlock({ id: 't1', title: '写周报' });
    expect(block.hasChecklist).toBe(false);
    expect(block.unitCount).toBe(1);
    expect(block.plan.entries.length).toBe(1);
    expect(block.plan.entries[0]?.title).toBe('写周报');
    expect(block.plan.entries[0]?.durationSource).toBe('default');
  });
});

describe('planTimelineBlock：估时能落到条上的两种形态', () => {
  it('没有清单时，整条任务的估时直接落上去', () => {
    const block = planTimelineBlock({ id: 't1', title: '上线', note: '预计耗时：90 分钟' });
    expect(block.aiMinutes).toBe(90);
    expect(block.unitCount).toBe(1);
    expect(block.unattributable).toBe(false);
    expect(block.plan.entries[0]?.durationMinutes).toBe(90);
    expect(block.plan.entries[0]?.durationSource).toBe('ai');
  });

  it('清单只有 1 条时，估时就是这一条的（不发生分摊）', () => {
    const block = planTimelineBlock({
      id: 't1',
      title: '上线',
      note: '- [ ] 全量发布\n预计耗时：90 分钟',
    });
    expect(block.hasChecklist).toBe(true);
    expect(block.unitCount).toBe(1);
    expect(block.unattributable).toBe(false);
    expect(block.plan.entries[0]?.title).toBe('全量发布');
    expect(block.plan.entries[0]?.durationMinutes).toBe(90);
    expect(block.plan.entries[0]?.durationSource).toBe('ai');
  });
});

describe('planTimelineBlock：清单 N>1 条时**明说摊不了**，绝不按比例编', () => {
  const note = '- [ ] 甲\n- [ ] 乙\n- [ ] 丙\n预计耗时：90 分钟';

  it('🔴 unattributable=true，且三条都按**默认工期**排（不是 90/3=30）', () => {
    const block = planTimelineBlock({ id: 't1', title: '多步', note });
    expect(block.unitCount).toBe(3);
    expect(block.aiMinutes).toBe(90);
    expect(block.unattributable).toBe(true);

    expect(block.plan.entries.map((e) => e.title)).toEqual(['甲', '乙', '丙']);
    for (const entry of block.plan.entries) {
      expect(entry.durationSource).toBe('default');
      // 🔴 30 会说明有人做了"平均分"——那正是本判据要拦的。
      expect(entry.durationMinutes).not.toBe(30);
    }
  });
});

describe('planTimelineBlock：0 与"没估过"是两件事', () => {
  it('🔴 0 分钟算**估过**（source=ai，夹到下限），未估过才是 default', () => {
    const zero = planTimelineBlock({ id: 't1', title: '估了零', note: '预计耗时：0 分钟' });
    expect(zero.aiMinutes).toBe(0);
    expect(zero.plan.entries[0]?.durationSource).toBe('ai');
    expect(zero.plan.entries[0]?.durationMinutes).toBe(MIN_DURATION_MINUTES);

    const never = planTimelineBlock({ id: 't2', title: '没估过' });
    expect(never.aiMinutes).toBeUndefined();
    expect(never.plan.entries[0]?.durationSource).toBe('default');
  });
});

describe('planTimelineBlock：三个任务三种形态，一块都不少', () => {
  // 🔴 `planTimelineBlocks`（复数版）已删（2026-10-01 重画）：板上走 `planTimelineRows`，
  // 详情预览逐任务调 `planTimelineBlock` —— 复数包装没有生产消费者，就是 AGENTS §3.5 说的"旧的那份"。
  it('三个任务三种形态，一块都不少', () => {
    const tasks = [
      { id: 'a', title: '甲' },
      { id: 'b', title: '乙', note: '- [ ] 一\n- [ ] 二\n预计耗时：30 分钟' },
      { id: 'c', title: '丙', note: '预计耗时：45 分钟' },
    ] as const;
    expect(tasks.map((t) => planTimelineBlock(t).taskId)).toEqual(['a', 'b', 'c']);
    expect(tasks.map((t) => planTimelineBlock(t).unattributable)).toEqual([false, true, false]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 板上的行（2026-10-01 重画）：三态推导 + 绝不编长度
// ─────────────────────────────────────────────────────────────────────────

describe('deriveTaskTimePosition：三态生产者（P1 point/unscheduled + P2 range，ADR-0043 §3）', () => {
  it('date-only due/start are projected into the current device calendar without changing their day', () => {
    const start = new Date(2026, 9, 8).getTime();
    const end = new Date(2026, 9, 11).getTime();
    expect(deriveTaskTimePosition({
      startDate: Date.UTC(2026, 9, 7, 16), startDateLocal: '2026-10-08',
      dueDate: Date.UTC(2026, 9, 9, 16), dueDateLocal: '2026-10-10',
    })).toEqual({ kind: 'range', startMs: start, endMs: end });
    expect(deriveTaskTimePosition({ dueDate: Date.UTC(2026, 9, 7, 16), dueDateLocal: '2026-10-08' }))
      .toEqual({ kind: 'point', atMs: start });
  });
  it('🔴 有合法 dueDate ⇒ point（atMs 原样），绝不画成条', () => {
    const at = Date.parse('2026-10-01T15:00:00');
    const p = deriveTaskTimePosition({ dueDate: at });
    assertPoint(p, at);
  });

  it('🔴 没有 / 非法 dueDate ⇒ unscheduled（NaN、0、负数、Infinity 都是"没有"）', () => {
    for (const bad of [undefined, Number.NaN, 0, -5, Number.POSITIVE_INFINITY] as const) {
      const p = deriveTaskTimePosition({ dueDate: bad });
      expect(p.kind).toBe('unscheduled');
    }
  });

  // ── P2：range 生产者（ADR-0043 §3 的表）──

  it('🔴 start + duration ⇒ range（end = start + 时长，分钟）', () => {
    const start = Date.parse('2026-10-02T09:00:00');
    const p = deriveTaskTimePosition({ startDate: start, durationMinutes: 90 });
    expect(p).toEqual({ kind: 'range', startMs: start, endMs: start + 90 * 60_000 });
  });

  it('🔴 start + due（due 在 start 之后）⇒ range（终点 = due）', () => {
    const start = Date.parse('2026-10-02T09:00:00');
    const due = Date.parse('2026-10-03T15:00:00');
    const p = deriveTaskTimePosition({ startDate: start, dueDate: due });
    expect(p).toEqual({ kind: 'range', startMs: start, endMs: due });
  });

  it('due 不在起点之后（<= start）⇒ 退化为 point（不画一条倒着的条）', () => {
    const start = Date.parse('2026-10-02T15:00:00');
    const p = deriveTaskTimePosition({ startDate: start, dueDate: start });
    assertPoint(p, start);
  });

  it('只有 start（无时长无截止）⇒ point 落在起点（"只有时刻 ⇒ 点"，R4 §5.2）', () => {
    const start = Date.parse('2026-10-02T09:00:00');
    const p = deriveTaskTimePosition({ startDate: start });
    assertPoint(p, start);
  });

  it('🔴 duration 单独存在 ⇒ unscheduled（没有起点就没有位置，绝不编一条）', () => {
    const p = deriveTaskTimePosition({ durationMinutes: 90 });
    expect(p.kind).toBe('unscheduled');
  });

  it('非法 start（NaN / <= 0）按"没有"处理：有合法 due ⇒ point', () => {
    const at = Date.parse('2026-10-01T15:00:00');
    assertPoint(deriveTaskTimePosition({ startDate: Number.NaN, dueDate: at }), at);
    assertPoint(deriveTaskTimePosition({ startDate: -1, dueDate: at }), at);
  });
});

describe('planTimelineRows：板上的行（TimelineBoardRow）', () => {
  it('🔴 dueDate 流到 position；估时只落 badge 字段（aiMinutes）', () => {
    const at = Date.parse('2026-10-01T15:00:00');
    const rows = planTimelineRows([
      { id: 'a', title: '有截止', dueDate: at, note: '预计耗时：90 分钟' },
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    assertPoint(row.position, at);
    expect(row.aiMinutes).toBe(90);
  });

  it('🔴 绝不编长度：只有估时没有日期 ⇒ unscheduled（估时不是排期凭据）', () => {
    const rows = planTimelineRows([{ id: 'a', title: '只估了时', note: '预计耗时：90 分钟' }]);
    expect(rows[0]?.position.kind).toBe('unscheduled');
  });

  it('🔴 行数据在形状上就没有长度字段（想编都没数可用）', () => {
    const rows = planTimelineRows([{ id: 'a', title: '任意', dueDate: 1 }]);
    const keys = Object.keys(rows[0] as unknown as Record<string, unknown>).sort();
    expect(keys).toEqual(['aiMinutes', 'position', 'taskId', 'title']);
    // position 是判别联合：point 只有 atMs，没有任何 duration/startOffset
    const p = rows[0]?.position;
    expect(p?.kind).toBe('point');
    expect(Object.keys(p as unknown as Record<string, unknown>).sort()).toEqual(['atMs', 'kind']);
  });

  it('🔴 字段时长是事实源：durationMinutes 在场时几何用字段，badge 也是字段（note 回退被盖住）', () => {
    const rows = planTimelineRows([
      {
        id: 'a',
        title: '字段赢',
        dueDate: Date.parse('2026-10-03T15:00:00'),
        startDate: Date.parse('2026-10-03T09:00:00'),
        durationMinutes: 120,
        note: '预计耗时：30 分钟',
      },
    ]);
    const p = rows[0]?.position;
    expect(p?.kind).toBe('range');
    if (p?.kind === 'range') {
      expect(p.endMs - p.startMs).toBe(120 * 60_000);
    }
    expect(rows[0]?.aiMinutes).toBe(120);
  });

  it('🔴 字段缺失时 note 估时行回退成 badge（旧数据不搬家）', () => {
    const rows = planTimelineRows([{ id: 'a', title: '旧数据', note: '预计耗时：45 分钟' }]);
    expect(rows[0]?.aiMinutes).toBe(45);
    expect(rows[0]?.position.kind).toBe('unscheduled');
  });

  it('顺序 = 输入序（显示序由共享层按时间排）', () => {
    const rows = planTimelineRows([
      { id: 'b', title: '乙' },
      { id: 'a', title: '甲', dueDate: 1 },
    ]);
    expect(rows.map((r) => r.taskId)).toEqual(['b', 'a']);
  });
});

/** point 形状的窄化断言（避免 `as` 强转把联合判据写弱）。 */
function assertPoint(p: { kind: string; atMs?: number }, at: number): void {
  expect(p.kind).toBe('point');
  expect(p.atMs).toBe(at);
}
