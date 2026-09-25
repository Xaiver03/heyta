/**
 * 语义文字样式层测试
 * ===================
 *
 * 这一层防的是**排版漂移**：同一个"任务标题"在不同界面被拼成不同的
 * 字号/行高组合，而没有任何一处会报错。所以这里的断言分两类：
 *
 *   1. **值本身的正确性** —— 行高是绝对点值不是倍数，字距不是 0。
 *   2. **不变量** —— 这些才是有价值的：漏加 tracking、两个样式重复定义、
 *      样式在主题间不一致，都会在这里红。
 */

import { describe, expect, it } from 'vitest';
import { darkTokens, lightTokens } from '../src/native.js';
import {
  TEXT_STYLES,
  resolveAllTextStyles,
  resolveTextStyle,
} from '../src/typography.js';
import type { TextStyleName } from '../src/typography.js';

const STYLE_NAMES = Object.keys(TEXT_STYLES) as TextStyleName[];

describe('语义文字样式：值正确性', () => {
  it('row-title = 16px / 400 / 行高 24 / 字距 -0.176', () => {
    // 全应用最高频的样式。行高必须是绝对点值（1.5 倍数 × 16），
    // 字距必须是点值（-0.011 em × 16）。
    const s = resolveTextStyle('row-title', lightTokens);
    expect(s.fontSize).toBe(16);
    expect(s.fontWeight).toBe('400');
    expect(s.lineHeight).toBe(24);
    expect(s.letterSpacing).toBeCloseTo(-0.176, 3);
  });

  it('numeric-display = 36px / 700 / 行高 45 / 字距 -0.792', () => {
    const s = resolveTextStyle('numeric-display', lightTokens);
    expect(s.fontSize).toBe(36);
    expect(s.fontWeight).toBe('700');
    expect(s.lineHeight).toBe(45);
    expect(s.letterSpacing).toBeCloseTo(-0.792, 3);
  });

  it('字重是字符串而不是数字（数字在部分 RN 版本会被静默忽略）', () => {
    for (const name of STYLE_NAMES) {
      expect(typeof resolveTextStyle(name, lightTokens).fontWeight, name).toBe('string');
    }
  });
});

describe('语义文字样式：不变量', () => {
  it('每一个样式都能解析 —— 没有引用不存在的 token', () => {
    // resolveTextStyle 会在 token 缺失或类型不对时抛错。
    // 遍历一遍等于把 TEXT_STYLES 全部接了一遍类型。
    for (const name of STYLE_NAMES) {
      expect(() => resolveTextStyle(name, lightTokens), name).not.toThrow();
    }
  });

  it('🔴 行高严格大于字号 —— 直接传倍数会让行高塌掉', () => {
    // CSS line-height 是倍数，RN lineHeight 是点值。
    // 若哪天有人在 typography 里漏了换算，这条会红。
    for (const name of STYLE_NAMES) {
      const s = resolveTextStyle(name, lightTokens);
      expect(s.lineHeight, `${name} 行高 ${s.lineHeight} 未超过字号 ${s.fontSize}`).toBeGreaterThan(
        s.fontSize,
      );
    }
  });

  it('🔴 每一个样式都有非零字距 —— 不允许"忘了写字距所以是 0"', () => {
    // Apple 规则：字距随字号变。一个样式完全没字距，
    // 说明它的 tracking token 配错了或漏了。
    for (const name of STYLE_NAMES) {
      expect(resolveTextStyle(name, lightTokens).letterSpacing, `${name} 字距为 0`).not.toBe(0);
    }
  });

  it('小字号字距放宽、大字号收紧（方向不能反）', () => {
    const caption = resolveTextStyle('caption', lightTokens);
    const display = resolveTextStyle('numeric-display', lightTokens);
    expect(caption.letterSpacing).toBeGreaterThan(0);
    expect(display.letterSpacing).toBeLessThan(0);
  });

  it('🔴 数字类样式必须等宽 —— 否则计时器每秒让版面横向抖动', () => {
    for (const name of ['numeric-display', 'numeric-body'] as const) {
      expect(resolveTextStyle(name, lightTokens).fontVariant, name).toEqual(['tabular-nums']);
    }
  });

  it('非数字类样式**不**带等宽（避免无谓的字体回退）', () => {
    for (const name of ['row-title', 'row-meta', 'caption', 'headline'] as const) {
      expect(resolveTextStyle(name, lightTokens).fontVariant, name).toBeUndefined();
    }
  });
});

describe('语义文字样式：主题无关性', () => {
  it('🔴 亮暗主题下排版完全一致 —— 换主题只该换颜色', () => {
    // 若哪天有人把字号放进暗色块（"暗色下字小一点"），这条会红。
    // 排版随主题变是错的方向：用户切换主题不该看到版面重排。
    const light = resolveAllTextStyles(lightTokens);
    const dark = resolveAllTextStyles(darkTokens);
    expect(dark).toEqual(light);
  });
});

describe('语义文字样式：清单卫生', () => {
  it('没有两个样式完全相同（重复定义说明该合并）', () => {
    // 两个名字一样的样式不是"分类"，是没人删的冗余。
    const seen = new Map<string, TextStyleName>();
    for (const name of STYLE_NAMES) {
      const key = JSON.stringify(resolveTextStyle(name, lightTokens));
      const prev = seen.get(key);
      expect(prev, `${name} 与 ${prev} 解析结果完全相同`).toBeUndefined();
      seen.set(key, name);
    }
  });

  it('样式数量受控 —— 每多一个就多一处"该用哪个"的模糊', () => {
    // 这不是硬性上限，是一个提醒：要突破它，先问是不是真的有两种排版意图。
    expect(STYLE_NAMES.length).toBeLessThanOrEqual(12);
  });

  it('resolveAllTextStyles 覆盖每一个样式名', () => {
    expect(Object.keys(resolveAllTextStyles(lightTokens)).sort()).toEqual([...STYLE_NAMES].sort());
  });
});