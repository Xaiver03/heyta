/**
 * `shouldShowListCard` —— **"空列表不画卡"的判据**
 * ================================================
 *
 * 背景：`TaskList` 的 `listCard` 会把整张列表画成一张白卡（移动端任务页）。
 * 列表为空时，空状态会被这张白卡包住，观感像一张孤零零的框 —— 空态应直接
 * 落在页面上，而不是被白卡包起来。所以"是否画卡"被抽成纯函数
 * `packages/ui/src/task-list/card-policy.ts` 的 `shouldShowListCard`。
 *
 * 语义：只有 `listCard === true` 且 `itemCount > 0` 才画卡；其余返回 `false`。
 *
 * ⚠️ 本包 import 的是**源码** `../src/...`（不是 `dist/`），与
 * `tests/task-row-density.spec.ts` 保持一致 —— 本文件不需要先 build。
 */

import { describe, expect, it } from 'vitest';

import { shouldShowListCard } from '../src/task-list/card-policy.js';

describe('shouldShowListCard —— 空列表不画卡', () => {
  it('listCard=true, itemCount=0 → false（空态不被白卡包住）', () => {
    expect(shouldShowListCard(true, 0)).toBe(false);
  });

  it('listCard=true, itemCount=1 → true（有内容才画卡）', () => {
    expect(shouldShowListCard(true, 1)).toBe(true);
  });

  it('listCard=true, itemCount=5 → true', () => {
    expect(shouldShowListCard(true, 5)).toBe(true);
  });

  it('listCard=false, itemCount=0 → false（未开启开关，不画卡）', () => {
    expect(shouldShowListCard(false, 0)).toBe(false);
  });

  it('listCard=false, itemCount=3 → false（未开启开关，即便有内容也不画卡）', () => {
    expect(shouldShowListCard(false, 3)).toBe(false);
  });

  it('listCard=true, itemCount=-1 → false（负数 count 防御性不画卡，实现用 >0 自然满足）', () => {
    expect(shouldShowListCard(true, -1)).toBe(false);
  });
});
