/**
 * 确定性时间线测试
 * ==================
 *
 * 🔴 这个文件里**没有一次网络请求、没有一个模型** —— 这是刻意的。
 *
 * `docs/plans/ai-strategy.md` §3 的裁决是"甘特图不是 AI"。
 * 所以排程必须能在**完全没有 AI** 的情况下被独立验证；
 * 一旦这里的测试需要 mock `fetch`，就说明有模型调用漏进了排程层。
 *
 * 四条最重要的：
 *   1. 🔴 **环依赖不能死循环**（拓扑排序最常见的崩法）。
 *   2. 🔴 **工期缺失必须是确定的**，而且必须能被认出来（`durationSource`）。
 *   3. 🔴 **同样的输入必须产生同样的输出**（否则甘特图每渲染一次就跳一下）。
 *   4. 🔴 **单位必须是分钟** —— 与 `ai-duration.ts` 同单位，换算不该发生。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  MAX_TIMELINE_ENTRIES,
  MAX_TITLE_LENGTH,
  MIN_DURATION_MINUTES,
  buildTimeline,
  buildTimelineFromNote,
  parseChecklistFromNote,
  type ChecklistItem,
  type TimelinePlan,
} from '../src/index.js';

/** 断言：每条都排在它的（保留下来的）前置**结束之后**。 */
function assertDependenciesRespected(plan: TimelinePlan): void {
  const byTitle = new Map(plan.entries.map((e) => [e.title, e]));
  for (const entry of plan.entries) {
    if (entry.dependsOn === undefined) continue;
    const predecessor = byTitle.get(entry.dependsOn);
    expect(predecessor).toBeDefined();
    const predecessorEnd =
      (predecessor?.startOffsetMinutes ?? 0) + (predecessor?.durationMinutes ?? 0);
    expect(entry.startOffsetMinutes).toBeGreaterThanOrEqual(predecessorEnd);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 从备注里读清单
// ─────────────────────────────────────────────────────────────────────────

describe('parseChecklistFromNote', () => {
  it('读 Markdown 复选框行', () => {
    const items = parseChecklistFromNote('- [ ] 调研\n- [ ] 写方案\n- [ ] 评审');
    expect(items.map((i) => i.title)).toEqual(['调研', '写方案', '评审']);
  });

  it('🔴 `[x]` 标成已完成，而不是丢掉（"哪条做完了"要留给调用方）', () => {
    const items = parseChecklistFromNote('- [x] 调研\n- [ ] 写方案');
    expect(items[0]?.done).toBe(true);
    expect(items[1]?.done).toBeUndefined();
  });

  it('普通列表行也收（用户的备注不一定规范）', () => {
    expect(parseChecklistFromNote('- 调研\n* 写方案').map((i) => i.title)).toEqual([
      '调研',
      '写方案',
    ]);
  });

  it('🔴 跳过散文与标题 —— 它们不是待排的条目', () => {
    const note = [
      '## 上线计划',
      '先把灰度做好，再谈全量。',
      '',
      '- [ ] 灰度',
      '  这句话是缩进的说明，不是条目。',
      '- [ ] 全量',
    ].join('\n');
    expect(parseChecklistFromNote(note).map((i) => i.title)).toEqual(['灰度', '全量']);
  });

  it('剥掉 markdown 强调与代码标记', () => {
    expect(parseChecklistFromNote('- [ ] **灰度**\n- [ ] `全量`').map((i) => i.title)).toEqual([
      '灰度',
      '全量',
    ]);
  });

  it('读行尾的显式依赖标记', () => {
    const items = parseChecklistFromNote('- [ ] 灰度\n- [ ] 全量（依赖：灰度）');
    expect(items[1]?.title).toBe('全量');
    expect(items[1]?.dependsOn).toBe('灰度');
  });

  it('半角括号与半角冒号也认', () => {
    expect(parseChecklistFromNote('- [ ] 全量(依赖: 灰度)')[0]?.dependsOn).toBe('灰度');
  });

  it('🔴 认不出的依赖标记 = 没有依赖，且**不报错**（备注是自由文本，不是表单）', () => {
    // 漏了冒号：整段留在标题里，没有依赖 —— 但绝不抛错。
    const typo = parseChecklistFromNote('- [ ] 全量（依赖 灰度）');
    expect(typo[0]?.title).toBe('全量（依赖 灰度）');
    expect(typo[0]?.dependsOn).toBeUndefined();
    // 指向不存在的条目：标记被读出来了，由 buildTimeline 当作"依赖不存在"丢掉。
    const dangling = parseChecklistFromNote('- [ ] 全量（依赖：不存在的条目）');
    expect(dangling[0]?.dependsOn).toBe('不存在的条目');
    expect(() => buildTimeline(dangling)).not.toThrow();
    expect(buildTimeline(dangling).droppedDependencyCount).toBe(1);
  });

  it('🔴 同名条目只保留第一条（依赖按标题引用，重名会有歧义）', () => {
    expect(parseChecklistFromNote('- [ ] 甲\n- [ ] 甲\n- [ ] 乙').map((i) => i.title)).toEqual([
      '甲',
      '乙',
    ]);
  });

  it('空 / 未定义备注 → 空数组', () => {
    expect(parseChecklistFromNote(undefined)).toEqual([]);
    expect(parseChecklistFromNote('')).toEqual([]);
    expect(parseChecklistFromNote('   \n  \n')).toEqual([]);
  });

  it('🔴 数量封顶（防止一条几千行的备注撑爆视图）', () => {
    const note = Array.from({ length: 300 }, (_, i) => `- [ ] 条目 ${String(i)}`).join('\n');
    expect(parseChecklistFromNote(note)).toHaveLength(MAX_TIMELINE_ENTRIES);
  });

  it('超长标题被截断', () => {
    const items = parseChecklistFromNote(`- [ ] ${'啊'.repeat(500)}`);
    expect(items[0]?.title.length).toBe(MAX_TITLE_LENGTH);
  });

  it('保留中文标点与数字（不要过度清洗）', () => {
    expect(parseChecklistFromNote('- [ ] 确认 SLA：99.9%（见附录 A）')[0]?.title).toBe(
      '确认 SLA：99.9%（见附录 A）',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 单位：分钟（与 ai-duration.ts 一致）
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 单位是「分钟」', () => {
  it('🔴 90 就是 90 分钟 —— 不会被当成 90 天，也不会被压成 1 天', () => {
    // 这是这次改动最重要的一条：`ai-duration.ts` 的上限是 480 分钟（8 小时）。
    // 若内部按"天"排，每条估时都会被压成 1 天，AI 这条信号就被完全抹平。
    const plan = buildTimeline([{ title: '甲' }], { durationsInMinutes: { 甲: 90 } });
    expect(plan.entries[0]?.durationMinutes).toBe(90);
    expect(plan.totalMinutes).toBe(90);
    expect(plan.entries[0]?.durationSource).toBe('manual');
  });

  it('🔴 90 分钟与 30 分钟的比例是 3:1（甘特图宽度的根据）', () => {
    const plan = buildTimeline([{ title: '甲' }, { title: '乙' }], {
      durationsInMinutes: { 甲: 90, 乙: 30 },
    });
    const long = plan.entries.find((e) => e.title === '甲')?.durationMinutes ?? 0;
    const short = plan.entries.find((e) => e.title === '乙')?.durationMinutes ?? 0;
    expect(long / short).toBe(3);
  });

  it('上限与 ai-duration 对齐：480 分钟', () => {
    expect(MAX_DURATION_MINUTES).toBe(480);
    expect(MIN_DURATION_MINUTES).toBe(5);
    expect(DEFAULT_DURATION_MINUTES).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 模式一：无显式依赖 → 清单顺序即先后顺序
// ─────────────────────────────────────────────────────────────────────────

describe('buildTimeline —— 无显式依赖时退回清单顺序', () => {
  const items: ChecklistItem[] = [{ title: '甲' }, { title: '乙' }, { title: '丙' }];

  it('🔴 串行：每条排在上一条结束之后', () => {
    const plan = buildTimeline(items, {
      durationsInMinutes: new Map([
        ['甲', 120],
        ['乙', 180],
      ]),
    });
    expect(plan.entries.map((e) => [e.title, e.startOffsetMinutes, e.durationMinutes])).toEqual([
      ['甲', 0, 120],
      ['乙', 120, 180],
      // 丙没估时 → 默认 60 分钟
      ['丙', 300, DEFAULT_DURATION_MINUTES],
    ]);
    expect(plan.totalMinutes).toBe(360);
  });

  it('🔴 工期缺失 → 用**写明的默认值**，并标记来源（不编一个像模像样的数）', () => {
    const plan = buildTimeline(items);
    expect(plan.unestimatedCount).toBe(3);
    for (const entry of plan.entries) {
      expect(entry.durationSource).toBe('default');
      expect(entry.durationMinutes).toBe(DEFAULT_DURATION_MINUTES);
    }
    // 串行仍然成立
    expect(plan.entries.map((e) => e.startOffsetMinutes)).toEqual([0, 60, 120]);
  });

  it('🔴 非法工期（NaN / Infinity / 负数）一律退回默认值，而不是传播 NaN', () => {
    const plan = buildTimeline(items, {
      durationsInMinutes: new Map([
        ['甲', Number.NaN],
        ['乙', Number.POSITIVE_INFINITY],
        ['丙', -3],
      ]),
    });
    for (const entry of plan.entries) {
      expect(Number.isFinite(entry.startOffsetMinutes)).toBe(true);
      expect(entry.durationSource).toBe('default');
      expect(entry.durationMinutes).toBe(DEFAULT_DURATION_MINUTES);
    }
    expect(plan.unestimatedCount).toBe(3);
  });

  it('🔴 0 分钟是"估过"，不是"没估过"：夹到下限，但**不说成未估时**', () => {
    // `readDurationFromNote` 刻意区分 `undefined` 与 `0`（见 duration-note.ts）。
    // 0 分钟的条在图上没有宽度 → 夹到下限 5 分钟；但它仍然是"估过的"。
    const plan = buildTimeline([{ title: '甲' }], { durationsInMinutes: { 甲: 0 } });
    expect(plan.entries[0]?.durationSource).toBe('manual');
    expect(plan.entries[0]?.durationMinutes).toBe(MIN_DURATION_MINUTES);
    expect(plan.unestimatedCount).toBe(0);
  });

  it('🔴 `durationOrigin` 决定来源标签：ai 与 manual 分得开', () => {
    const asAi = buildTimeline([{ title: '甲' }], {
      durationsInMinutes: { 甲: 90 },
      durationOrigin: 'ai',
    });
    expect(asAi.entries[0]?.durationSource).toBe('ai');
    // 默认是更保守的一侧：来源不明的数字**不**说成"AI 估的"
    const asManual = buildTimeline([{ title: '甲' }], { durationsInMinutes: { 甲: 90 } });
    expect(asManual.entries[0]?.durationSource).toBe('manual');
  });

  it('🔴 超大工期被夹到上限（不是原样传播）', () => {
    const plan = buildTimeline([{ title: '甲' }], { durationsInMinutes: { 甲: 99_999 } });
    expect(plan.entries[0]?.durationMinutes).toBe(MAX_DURATION_MINUTES);
    expect(plan.entries[0]?.durationSource).toBe('manual');
  });

  it('🔴 过小工期被抬到下限（2 分钟 → 5 分钟）', () => {
    const plan = buildTimeline([{ title: '甲' }], { durationsInMinutes: { 甲: 2 } });
    expect(plan.entries[0]?.durationMinutes).toBe(MIN_DURATION_MINUTES);
    expect(plan.entries[0]?.durationSource).toBe('manual');
  });

  it('普通对象与 Map 两种映射都支持', () => {
    const viaObject = buildTimeline([{ title: '甲' }], { durationsInMinutes: { 甲: 240 } });
    const viaMap = buildTimeline([{ title: '甲' }], { durationsInMinutes: new Map([['甲', 240]]) });
    expect(viaObject.entries[0]?.durationMinutes).toBe(240);
    expect(viaMap.entries[0]?.durationMinutes).toBe(240);
  });

  it('已完成条目**不参与排期**', () => {
    const plan = buildTimeline([
      { title: '甲', done: true },
      { title: '乙' },
      { title: '丙' },
    ]);
    expect(plan.entries.map((e) => e.title)).toEqual(['乙', '丙']);
    expect(plan.entries[0]?.startOffsetMinutes).toBe(0);
  });

  it('空清单 → 空计划（不是崩溃，也不是一条假的）', () => {
    const plan = buildTimeline([]);
    expect(plan.entries).toEqual([]);
    expect(plan.totalMinutes).toBe(0);
    expect(plan.unestimatedCount).toBe(0);
  });

  it('空标题被丢掉', () => {
    const plan = buildTimeline([{ title: '   ' }, { title: '乙' }]);
    expect(plan.entries.map((e) => e.title)).toEqual(['乙']);
  });

  it('数量封顶并如实标记', () => {
    const many: ChecklistItem[] = Array.from({ length: 300 }, (_, i) => ({
      title: `条目 ${String(i)}`,
    }));
    const plan = buildTimeline(many);
    expect(plan.entries).toHaveLength(MAX_TIMELINE_ENTRIES);
    expect(plan.truncated).toBe(true);
  });

  it('默认工期可以覆盖', () => {
    const plan = buildTimeline([{ title: '甲' }], { defaultDurationMinutes: 120 });
    expect(plan.entries[0]?.durationMinutes).toBe(120);
    expect(plan.entries[0]?.durationSource).toBe('default');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 模式二：显式依赖 → 拓扑排序
// ─────────────────────────────────────────────────────────────────────────

describe('buildTimeline —— 显式依赖走拓扑排序', () => {
  it('没有前置的条目**并行**从第 0 分钟开始', () => {
    const plan = buildTimeline(
      [{ title: '甲' }, { title: '乙', dependsOn: '甲' }, { title: '丙' }],
      { durationsInMinutes: { 甲: 120, 乙: 60, 丙: 240 } },
    );
    const byTitle = new Map(plan.entries.map((e) => [e.title, e]));
    expect(byTitle.get('甲')?.startOffsetMinutes).toBe(0);
    expect(byTitle.get('丙')?.startOffsetMinutes).toBe(0);
    expect(byTitle.get('乙')?.startOffsetMinutes).toBe(120);
    expect(plan.totalMinutes).toBe(240);
    assertDependenciesRespected(plan);
  });

  it('链式依赖逐级推后', () => {
    const plan = buildTimeline(
      [
        { title: '甲' },
        { title: '乙', dependsOn: '甲' },
        { title: '丙', dependsOn: '乙' },
      ],
      { durationsInMinutes: { 甲: 60, 乙: 120, 丙: 180 } },
    );
    expect(plan.entries.map((e) => [e.title, e.startOffsetMinutes])).toEqual([
      ['甲', 0],
      ['乙', 60],
      ['丙', 180],
    ]);
    assertDependenciesRespected(plan);
  });

  it('🔴 顺序稳定：就绪节点里原下标小的先出（同样输入 → 同样行序）', () => {
    // 输入顺序：丙(依赖甲) / 甲 / 乙。
    // 甲 是丙的前置，必须先出；甲出完之后，就绪的是 丙(原下标 0) 与 乙(原下标 2)，
    // 取下标小的 → 丙。所以行序是 甲 / 丙 / 乙，而不是输入顺序。
    const items: ChecklistItem[] = [
      { title: '丙', dependsOn: '甲' },
      { title: '甲' },
      { title: '乙' },
    ];
    const plan = buildTimeline(items);
    expect(plan.entries.map((e) => e.title)).toEqual(['甲', '丙', '乙']);
    // 前置永远排在后继之前 —— 这是拓扑序的意义
    const order = plan.entries.map((e) => e.title);
    expect(order.indexOf('甲')).toBeLessThan(order.indexOf('丙'));
  });

  it('🔴 两次调用行序一致（否则甘特图每渲染一次就跳一下）', () => {
    const items: ChecklistItem[] = [
      { title: '丙', dependsOn: '甲' },
      { title: '甲' },
      { title: '乙' },
      { title: '丁' },
    ];
    const first = buildTimeline(items).entries.map((e) => e.title);
    const second = buildTimeline(items).entries.map((e) => e.title);
    expect(first).toEqual(second);
  });

  it('🔴 依赖指向不存在的条目 → 丢弃该依赖，条目照常排（不炸）', () => {
    const plan = buildTimeline([
      { title: '甲', dependsOn: '不存在的条目' },
      { title: '乙' },
    ]);
    expect(plan.droppedDependencyCount).toBe(1);
    // 一条有效显式依赖都没有 → 退回清单顺序
    expect(plan.entries.map((e) => e.startOffsetMinutes)).toEqual([0, 60]);
    expect(plan.entries[0]?.dependsOn).toBeUndefined();
  });

  it('自引用被丢弃', () => {
    const plan = buildTimeline([{ title: '甲', dependsOn: '甲' }, { title: '乙' }]);
    expect(plan.droppedDependencyCount).toBe(1);
    expect(plan.entries[0]?.dependsOn).toBeUndefined();
    assertDependenciesRespected(plan);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 环依赖
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 环依赖不得死循环', () => {
  it('🔴 A↔B：能排完，丢掉一条边，并如实计数', () => {
    const plan = buildTimeline([
      { title: 'A', dependsOn: 'B' },
      { title: 'B', dependsOn: 'A' },
    ]);
    expect(plan.entries).toHaveLength(2);
    expect(plan.droppedDependencyCount).toBe(1);
    assertDependenciesRespected(plan);
    // 结果里不可能同时存在 A→B 与 B→A
    const byTitle = new Map(plan.entries.map((e) => [e.title, e]));
    expect(byTitle.get('A')?.dependsOn === 'B' && byTitle.get('B')?.dependsOn === 'A').toBe(false);
  });

  it('🔴 A→B→C→A 三节点环同样能排完', () => {
    const plan = buildTimeline([
      { title: 'A', dependsOn: 'C' },
      { title: 'B', dependsOn: 'A' },
      { title: 'C', dependsOn: 'B' },
    ]);
    expect(plan.entries).toHaveLength(3);
    expect(plan.droppedDependencyCount).toBe(1);
    assertDependenciesRespected(plan);
  });

  it('🔴 环之外还有正常条目时，正常条目不受影响', () => {
    const plan = buildTimeline([
      { title: 'A', dependsOn: 'B' },
      { title: 'B', dependsOn: 'A' },
      { title: '独立' },
    ]);
    expect(plan.entries).toHaveLength(3);
    expect(plan.entries.find((e) => e.title === '独立')?.startOffsetMinutes).toBe(0);
    assertDependenciesRespected(plan);
  });

  it('🔴 大环也能在有限时间内排完（20 个节点首尾相接）', () => {
    const ring: ChecklistItem[] = Array.from({ length: 20 }, (_, i) => ({
      title: `节点 ${String(i)}`,
      dependsOn: `节点 ${String((i + 1) % 20)}`,
    }));
    const plan = buildTimeline(ring);
    expect(plan.entries).toHaveLength(20);
    expect(plan.droppedDependencyCount).toBe(1);
    assertDependenciesRespected(plan);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 确定性
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 纯函数：同样的输入必须产生同样的输出', () => {
  it('两次调用逐字节一致（含行序与偏移）', () => {
    const items: ChecklistItem[] = [
      { title: '甲' },
      { title: '乙', dependsOn: '甲' },
      { title: '丙' },
      { title: '丁', dependsOn: '丙' },
    ];
    const options = {
      durationsInMinutes: new Map([
        ['甲', 120],
        ['丙', 180],
      ]),
    };
    expect(JSON.stringify(buildTimeline(items, options))).toBe(
      JSON.stringify(buildTimeline(items, options)),
    );
  });

  it('不读时钟、不读环境：同一份输入在任何时刻结果都一样', () => {
    const items: ChecklistItem[] = [{ title: '甲' }, { title: '乙' }];
    const a = buildTimeline(items);
    const b = buildTimeline(items);
    expect(a.entries).toEqual(b.entries);
  });

  it('不修改传入的数组与映射（纯函数不该有副作用）', () => {
    const items: ChecklistItem[] = [{ title: '甲', dependsOn: '甲' }];
    const durations = new Map([['甲', 180]]);
    buildTimeline(items, { durationsInMinutes: durations });
    expect(items).toEqual([{ title: '甲', dependsOn: '甲' }]);
    expect([...durations.entries()]).toEqual([['甲', 180]]);
  });
});

describe('buildTimelineFromNote', () => {
  it('一步从备注排到计划', () => {
    const plan = buildTimelineFromNote('- [ ] 灰度\n- [ ] 全量（依赖：灰度）', {
      durationsInMinutes: { 灰度: 120, 全量: 60 },
    });
    expect(plan.entries.map((e) => [e.title, e.startOffsetMinutes])).toEqual([
      ['灰度', 0],
      ['全量', 120],
    ]);
    assertDependenciesRespected(plan);
  });

  it('备注为空 → 空计划', () => {
    expect(buildTimelineFromNote(undefined).entries).toEqual([]);
  });
});
