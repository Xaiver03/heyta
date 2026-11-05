/**
 * 任务行密度的**关系**判据（2026-11-06，滴答对齐线；补 B264 那格欠的那一层）。
 *
 * 为什么钉关系而不是钉值：`typography.spec.ts` 里已经有两枚关系判据的先例
 * （「行高严格大于字号」「字号比 ≥ 1.33」）—— 它们不会因为设计师调密度而挡路，
 * 却能在"改了一处忘了另一处"时当场红。
 *
 * 🔴 这几条**能**抓住什么、**抓不住**什么，写在行上，别让人误读：
 *   · 能抓：只动一枚的"半改"。本仓真发生过 —— `BLOCKED.md` B261：`row-title` 的行高
 *     从 24 抬到 28，而 `size.row-min-height` 还留在 56（= 两行旧行高正好顶满），
 *     当时的红是 `typography.spec.ts` 的枚价值断言报的；有了下面第 ① 条，
 *     这种半改在**关系**层面也会红，不必依赖谁记得改那个数。
 *   · 抓不住：把四枚值**成套**退回旧密度（56 / 24 / 8 / 4 自己也是自洽的）。
 *     那要钉值才拦得住，而"行密度到底是契约还是可调旋钮"是设计系统线 / 产品的判据口径，
 *     本文件不替它拍。（B264 原先写"钉不变量后协同回退会红"，那句说过头了，已就地更正。）
 */
import { describe, expect, it } from 'vitest';
import { lightTokens } from '../src/native.js';
import { TASK_ROW_SHAPE } from '../src/task-row-shape.js';
import { resolveTextStyle } from '../src/typography.js';

/** rem → px（本仓的 rem 基准是 16，`tokens.css` 的 `:root` 没改过 `font-size`）。 */
const px = (value: string): number => {
  const n = Number.parseFloat(value);
  expect(Number.isFinite(n), `token 值解析不出数字：${value}`).toBe(true);
  return value.trim().endsWith('rem') ? n * 16 : n;
};

const rowMinHeight = px(String(lightTokens['size.row-min-height']));
const titleLeading = resolveTextStyle('row-title', lightTokens).lineHeight;
const bodyPadding = px(String(lightTokens[TASK_ROW_SHAPE.bodyPaddingBlock]));
const listGap = px(String(lightTokens[TASK_ROW_SHAPE.listGap]));

describe('任务行密度：三枚值之间的关系（B264 补的那一层）', () => {
  it('① 行最小高容得下**两行标题**，余量至少一枚 `space.1`', () => {
    const slack = rowMinHeight - 2 * titleLeading;
    expect(slack, `两行标题占 ${2 * titleLeading}px，行最小高 ${rowMinHeight}px ⇒ 余量 ${slack}px`).toBeGreaterThanOrEqual(
      px(String(lightTokens['space.1'])),
    );
  });

  it('② 一行的内容（标题行高 + 上下内间距）不许超过行最小高', () => {
    const content = titleLeading + 2 * bodyPadding;
    expect(content, `标题 ${titleLeading} + 2×内间距 ${bodyPadding} = ${content}px，超过行最小高 ${rowMinHeight}px`).toBeLessThanOrEqual(
      rowMinHeight,
    );
  });

  it('③ 行间距必须小于行内边距 —— 否则"一行"读不成一个整体', () => {
    expect(listGap, `行间距 ${listGap}px 不小于行内边距 ${bodyPadding}px ⇒ 相邻行会比行内更松散`).toBeLessThan(
      bodyPadding,
    );
  });
});
