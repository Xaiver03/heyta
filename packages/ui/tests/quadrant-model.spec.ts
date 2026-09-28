/**
 * 四象限共享模型的单测（跑在 node）
 * ==================================
 *
 * `packages/ui/vitest.config.ts` 跑在 **node**、且刻意不 render 组件 ——
 * 所以这里测的是 `quadrant/model.ts` 的**纯判断**：
 *
 *   1. 展示顺序是 **Q1 → Q2 → Q3 → Q4**，不随对象键的插入顺序漂移；
 *   2. 象限 → 颜色 token 是全仓唯一的一处映射，且每一项都能在
 *      `@heyta/domain` 的 `QUADRANT_META` 里找到同源的名字；
 *   3. **空格也在**（矩阵的价值就在于四格同时在场）；
 *   4. `testID` 稳定（`quadrant-cell-1`…），且与槽位号一一对应；
 *   5. 分桶**一条领域规则都没有重写**：已完成 / 已删除被排除，
 *      桶内顺序就是 `bucketByQuadrant` 给的顺序。
 *
 * 🔴 第 4 条那条"与 `QUADRANT_META` 同源"的断言是**承重的**：
 * `model.ts` 里的槽位号是显式字面量（不是从 `tokenPrefix` 字符串切出来的），
 * 所以两边只改一边时，**只有这条断言会红**。
 */

import { describe, expect, it } from 'vitest';
import { QUADRANT_META, Quadrant, type Task } from '@heyta/domain';

import {
  QUADRANT_ORDER,
  quadrantSlot,
  quadrantSlotToken,
  toQuadrantCards,
} from '../src/quadrant/model.js';

/** 稳定的"现在"：2026-09-24 10:00（本地时间）。显式传入，不读 `Date.now()`。 */
const NOW = new Date(2026, 8, 24, 10, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: '写方案', createdAt: 0, updatedAt: 0, ...over };
}

describe('四象限：展示顺序', () => {
  it('固定 Q1 → Q2 → Q3 → Q4（顺序是产品语义，不是对象键的偶然顺序）', () => {
    expect(QUADRANT_ORDER).toEqual([
      Quadrant.UrgentImportant,
      Quadrant.ImportantNotUrgent,
      Quadrant.UrgentNotImportant,
      Quadrant.Neither,
    ]);
  });

  it('空格也在：没有任何任务时仍然产出四张卡', () => {
    const cards = toQuadrantCards([], NOW);
    expect(cards.map((c) => c.quadrant)).toEqual([...QUADRANT_ORDER]);
    expect(cards.every((c) => c.tasks.length === 0)).toBe(true);
    expect(cards.every((c) => c.count === 0)).toBe(true);
  });

  it('空缺的格子不会被折叠掉（哪怕只有一格有任务）', () => {
    const cards = toQuadrantCards([task({ important: true, dueDate: NOW + HOUR })], NOW);
    expect(cards).toHaveLength(4);
    expect(cards[0]?.count).toBe(1);
    expect(cards.slice(1).every((c) => c.count === 0)).toBe(true);
  });
});

describe('四象限：颜色 token 与测试标识', () => {
  it('每一格都映射到设计系统已有的 --ht-color-quadrant-* 族，不新定颜色', () => {
    const tokens = QUADRANT_ORDER.map((q) => quadrantSlotToken(q));
    expect(tokens).toEqual([
      'color.quadrant-1',
      'color.quadrant-2',
      'color.quadrant-3',
      'color.quadrant-4',
    ]);
  });

  it('🔴 槽位号与领域层 QUADRANT_META 的 tokenPrefix 同源（只改一边会红）', () => {
    for (const quadrant of QUADRANT_ORDER) {
      expect(`quadrant-${String(quadrantSlot(quadrant))}`).toBe(
        QUADRANT_META[quadrant].tokenPrefix,
      );
    }
  });

  it('testID 稳定且与槽位号一一对应', () => {
    const cards = toQuadrantCards([], NOW);
    expect(cards.map((c) => c.testID)).toEqual([
      'quadrant-cell-1',
      'quadrant-cell-2',
      'quadrant-cell-3',
      'quadrant-cell-4',
    ]);
  });
});

describe('四象限：分桶来自领域层，不在这里重算', () => {
  it('已完成 / 已删除的任务不进任何一格', () => {
    const cards = toQuadrantCards(
      [
        task({ id: 'done', important: true, dueDate: NOW + HOUR, completedAt: NOW }),
        task({ id: 'gone', important: true, dueDate: NOW + HOUR, deletedAt: NOW }),
        task({ id: 'live', important: true, dueDate: NOW + HOUR }),
      ],
      NOW,
    );
    expect(cards[0]?.tasks.map((t) => t.id)).toEqual(['live']);
  });

  it('紧迫性窗口以传入的 now 为基准（窗口外的重要任务落在 Q2）', () => {
    const cards = toQuadrantCards(
      [
        task({ id: 'soon', important: true, dueDate: NOW + HOUR }),
        task({ id: 'later', important: true, dueDate: NOW + 10 * DAY }),
      ],
      NOW,
    );
    expect(cards[0]?.tasks.map((t) => t.id)).toEqual(['soon']);
    expect(cards[1]?.tasks.map((t) => t.id)).toEqual(['later']);
  });

  it('桶内顺序就是领域层给的顺序（截止升序，本层不重排）', () => {
    const cards = toQuadrantCards(
      [
        task({ id: 'b', important: true, dueDate: NOW + 2 * HOUR }),
        task({ id: 'a', important: true, dueDate: NOW + HOUR }),
      ],
      NOW,
    );
    expect(cards[0]?.tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('count 是 tasks.length 的显式投影（宿主不必再 .length）', () => {
    const cards = toQuadrantCards(
      [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })],
      NOW,
    );
    const neither = cards[3];
    expect(neither?.count).toBe(3);
    expect(neither?.count).toBe(neither?.tasks.length);
  });
});
