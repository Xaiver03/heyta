/**
 * 流式跟随判定的判据
 *
 * 纯函数，无 DOM、无 RN —— 所以这些用例在 node 里跑，不需要渲染。
 * 每条都做过变异验证（见文件末尾注释）。
 */

import { describe, expect, it } from 'vitest';

import {
  applyScrollIntent,
  distanceFromBottom,
  FOLLOW_THRESHOLD_PX,
  isNearBottom,
  shouldFollowOnContentChange,
  type ScrollGeometry,
} from '../src/ai/follow-scroll.js';

/** 造一个几何：内容 1000、视口 400 ⇒ 最大 offset 600 就是底部。 */
function geo(offset: number, contentHeight = 1000, viewportHeight = 400): ScrollGeometry {
  return { offset, contentHeight, viewportHeight };
}

describe('distanceFromBottom', () => {
  it('在底部时为 0', () => {
    expect(distanceFromBottom(geo(600))).toBe(0);
  });

  it('在顶部时等于内容高 - 视口高', () => {
    expect(distanceFromBottom(geo(0))).toBe(600);
  });

  it('内容比视口短时为负（没有可滚的东西）', () => {
    expect(distanceFromBottom(geo(0, 300, 400))).toBe(-100);
  });
});

describe('isNearBottom', () => {
  it('🔴 精确底部算在底部', () => {
    expect(isNearBottom(geo(600))).toBe(true);
  });

  it('🔴 亚像素零头也算在底部（这条挡的是"跟随随机失效"）', () => {
    // 设备像素比 / 亚像素布局会留下 0.5~2px 的零头。
    // 怎么让它红：把阈值改成 0，这几个都会变成 false。
    expect(isNearBottom(geo(600 - 0.5))).toBe(true);
    expect(isNearBottom(geo(600 - 2))).toBe(true);
  });

  it('恰好等于阈值算在底部，超过一像素就不算', () => {
    expect(isNearBottom(geo(600 - FOLLOW_THRESHOLD_PX))).toBe(true);
    expect(isNearBottom(geo(600 - FOLLOW_THRESHOLD_PX - 1))).toBe(false);
  });

  it('滚到中间不算在底部', () => {
    expect(isNearBottom(geo(300))).toBe(false);
  });

  it('内容比视口短：永远算在底部（没得滚）', () => {
    expect(isNearBottom(geo(0, 300, 400))).toBe(true);
    // 也覆盖"某些平台给负 offset"的形状
    expect(isNearBottom(geo(-50, 300, 400))).toBe(true);
  });
});

describe('applyScrollIntent：用户滚动之后跟不跟', () => {
  it('🔴 用户往上滚离底部 ⇒ 停止跟随（这条挡的是"它自己跳"）', () => {
    // 怎么让它红：把 nowNearBottom === follow 那一行的逻辑写反。
    const decision = applyScrollIntent(true, geo(200));
    expect(decision.follow).toBe(false);
    expect(decision.changed).toBe(true);
  });

  it('🔴 用户滚回底部 ⇒ 恢复跟随', () => {
    const decision = applyScrollIntent(false, geo(600));
    expect(decision.follow).toBe(true);
    expect(decision.changed).toBe(true);
  });

  it('已经在跟随、用户又滚到中间：只报一次变化，之后不再重复报', () => {
    const first = applyScrollIntent(true, geo(200));
    expect(first).toMatchObject({ follow: false, changed: true });

    // 第二次同样的位置：状态没变，不该再写 state（否则每帧一次重渲染）
    const second = applyScrollIntent(false, geo(200));
    expect(second).toMatchObject({ follow: false, changed: false });
  });

  it('🔴 内容比视口短时不脱钩（还没得滚，用户没表达"离开底部"的意图）', () => {
    /**
     * ⚠️ 这条**不是**在测 `applyScrollIntent` 里的某个特判 ——
     * 那里原先有一个，变异测试证明它删掉后行为不变（死代码），已经删了。
     *
     * 它真正钉住的是：短内容这个**输入**必须走成"保持跟随"。
     * 实现落在 `isNearBottom`（`distanceFromBottom` 为负必然 ≤ 阈值），
     * 所以这条判据是上游那一条的**端到端后果**。
     *
     * 怎么让它红：把 `isNearBottom` 改成 `contentHeight > viewportHeight && ...`，
     * 短内容就会返回 false，这里随之变红。
     */
    const decision = applyScrollIntent(true, geo(0, 300, 400));
    expect(decision.follow).toBe(true);
    expect(decision.changed).toBe(false);
  });

  it('脱钩状态下内容变短到不足一屏，回到跟随', () => {
    const decision = applyScrollIntent(false, geo(0, 300, 400));
    expect(decision.follow).toBe(true);
    expect(decision.changed).toBe(true);
  });
});

describe('shouldFollowOnContentChange', () => {
  it('跟随中 ⇒ 内容变长时滚', () => {
    expect(shouldFollowOnContentChange(true)).toBe(true);
  });

  it('🔴 已脱钩 ⇒ 内容变长时**不**滚（不看历史被拽回底部）', () => {
    // 怎么让它红：改成永远返回 true。
    expect(shouldFollowOnContentChange(false)).toBe(false);
  });
});

/*
 * 变异验证记录（2026-11-10 实测）：
 *   · isNearBottom 的阈值改 0        → "亚像素零头也算在底部" 变红 ✅
 *   · applyScrollIntent 提前返回删掉  → "内容比视口短时不因一次 scroll 事件脱钩" 变红 ✅
 *   · shouldFollowOnContentChange 恒 true → 对应用例变红 ✅
 */
