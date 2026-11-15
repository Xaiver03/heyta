/**
 * 单选行形状契约的判据
 * =====================
 *
 * 这一层防的是**节奏塌陷**：面板里每一个间距都写 `space.2` 时，
 * 屏幕上的结果是"所有东西离得一样近"，眼睛读不出分组层级 ——
 * 而任何一层门禁都不会红（每个值都是合法 token）。
 *
 * 所以这里断言的是**关系**，不是具体值：
 *   组内（rowGap） < 标签→行（labelGap） < 组间（groupGap）
 * 且三者**互不相等**。改值可以，把三档压成两档/一档就会红 ——
 * 那正是要禁止的回归形状。
 */

import { describe, expect, it } from 'vitest';
import { lightTokens } from '../src/native.js';
import { CHOICE_ROW_SHAPE, CHOICE_ROW_TEXT } from '../src/choice-row-shape.js';
import { TEXT_STYLES } from '../src/typography.js';

/**
 * 按 token 名取数值。
 *
 * 🔴 两处类型修正（2026-11-15）：
 * 1. `HeytaNativeTokens` 没有字符串索引签名，直接 `as Record<string, number>`
 *    是不合法的转换（TS2352），必须先过 `unknown`。
 * 2. `noUncheckedIndexedAccess` 下索引结果是 `number | undefined`。原来的写法
 *    把 `undefined` 静默交给后面的 `toBeLessThan` —— 那时失败信息会是
 *    "expected undefined to be less than …"，指向比较表达式，而根因是**token 名写错了**。
 *    改成显式抛错，把根因留在出错的那一行。
 */
const px = (tokenName: string): number => {
  const table = lightTokens as unknown as Record<string, number>;
  const value = table[tokenName];
  if (value === undefined) throw new Error(`token 不存在：${tokenName}`);
  return value;
};

describe('CHOICE_ROW_SHAPE', () => {
  it('三个间距是三档互不相等的值，且从小到大是 组内 < 标签 < 组间', () => {
    const row = px(CHOICE_ROW_SHAPE.rowGap);
    const label = px(CHOICE_ROW_SHAPE.labelGap);
    const group = px(CHOICE_ROW_SHAPE.groupGap);

    expect(new Set([row, label, group]).size, '三档间距不许有任意两档相等').toBe(3);
    expect(row).toBeLessThan(label);
    expect(label).toBeLessThan(group);
  });

  it('行高是触控下限那一档，不是任务行高', () => {
    expect(px(CHOICE_ROW_SHAPE.minHeight)).toBe(px('touch-target.min'));
    // 断言它**不是**任务行高：单选行只有一行字，用 60 会让 4 个选项吃掉半屏。
    expect(px(CHOICE_ROW_SHAPE.minHeight)).toBeLessThan(px('size.row-min-height'));
  });

  it('行自己不加左右内边距（左缘由容器统一给）', () => {
    expect(px(CHOICE_ROW_SHAPE.rowInset)).toBe(0);
  });

  it('文字样式都在语义样式表里', () => {
    for (const name of Object.values(CHOICE_ROW_TEXT)) {
      expect(Object.keys(TEXT_STYLES)).toContain(name);
    }
    // 组标签与行文字必须是**两档**：一档的话组标签就退化成正文字。
    expect(CHOICE_ROW_TEXT.groupLabel).not.toBe(CHOICE_ROW_TEXT.option);
  });
});
