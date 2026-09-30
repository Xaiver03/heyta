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

import { planTimelineBlock, planTimelineBlocks } from '../src/timeline-plan.js';

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

describe('planTimelineBlocks：顺序即块序，且每个任务都有块', () => {
  it('三个任务三种形态，一块都不少', () => {
    const blocks = planTimelineBlocks([
      { id: 'a', title: '甲' },
      { id: 'b', title: '乙', note: '- [ ] 一\n- [ ] 二\n预计耗时：30 分钟' },
      { id: 'c', title: '丙', note: '预计耗时：45 分钟' },
    ]);
    expect(blocks.map((b) => b.taskId)).toEqual(['a', 'b', 'c']);
    expect(blocks.map((b) => b.unattributable)).toEqual([false, true, false]);
  });
});
