/**
 * 锚点弹层定位（共享模型）单测
 * ============================
 *
 * 钉的是 `placeAnchoredPanel` 的四件事：**往哪边弹**（哪边空间大，两侧相等留下方）、
 * **贴边**（触发器下方 + gap）、**水平夹进视口**（面板右边不许跑出视口）、
 * **越界时夹到 edge 而不是变负数**。
 *
 * 🔴 第 4 条（两侧相等留下方）是这条用例唯一的"边界"价值所在：把源码里的
 * `roomAbove > roomBelow` 写成 `>=`，只有这一条会红。
 * 第 5、6 条抓的是"负数"那一类 —— `min`/`max` 少套一层不会报错，只会把面板
 * 推出屏幕，而屏幕外的一切在自动化里长得和"渲染成功"一样。
 */

import { describe, expect, it } from 'vitest';

import { placeAnchoredPanel } from '../src/overlay/model.js';

const GAP = 4;
const EDGE = 8;
const options = { gap: GAP, edge: EDGE };

describe('placeAnchoredPanel', () => {
  it('下方空间大 → 贴在触发器下方', () => {
    const pos = placeAnchoredPanel(
      { top: 40, left: 120, bottom: 72 },
      { width: 200, height: 300 },
      { width: 800, height: 600 },
      options,
    );
    expect(pos.placement).toBe('below');
    expect(pos.top).toBe(72 + GAP);
    expect(pos.left).toBe(120);
  });

  it('上方空间大 → 翻到上方，面板底边贴在触发器上方', () => {
    const pos = placeAnchoredPanel(
      { top: 500, left: 120, bottom: 532 },
      { width: 200, height: 300 },
      { width: 800, height: 600 },
      options,
    );
    expect(pos.placement).toBe('above');
    expect(pos.top).toBe(500 - GAP - 300);
  });

  it('两侧空间相等 → 留在下方（`>` 是严格的，不是 `>=`）', () => {
    // roomAbove = 294 - 4 - 8 = 282，roomBelow = 600 - 306 - 4 - 8 = 282
    const pos = placeAnchoredPanel(
      { top: 294, left: 8, bottom: 306 },
      { width: 200, height: 100 },
      { width: 800, height: 600 },
      options,
    );
    expect(pos.placement).toBe('below');
    expect(pos.top).toBe(306 + GAP);
  });

  it('触发器靠左不足、面板比视口还宽 → 夹到 edge，不给出负数', () => {
    const pos = placeAnchoredPanel(
      { top: 40, left: 0, bottom: 72 },
      { width: 200, height: 300 },
      { width: 150, height: 600 },
      options,
    );
    expect(pos.left).toBe(EDGE);
  });

  it('面板右边会跑出视口 → 往回夹，夹完仍不小于 edge', () => {
    const pos = placeAnchoredPanel(
      { top: 40, left: 350, bottom: 72 },
      { width: 200, height: 300 },
      { width: 400, height: 600 },
      options,
    );
    expect(pos.left).toBe(400 - 200 - EDGE);
    expect(pos.left).toBeGreaterThanOrEqual(EDGE);
  });

  it('上方放不下（面板比上面那点空间高）→ 夹到 edge，不上屏幕外', () => {
    const pos = placeAnchoredPanel(
      { top: 500, left: 120, bottom: 520 },
      { width: 200, height: 600 },
      { width: 800, height: 560 },
      options,
    );
    expect(pos.placement).toBe('above');
    expect(pos.top).toBe(EDGE);
  });
});
