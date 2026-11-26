/**
 * #56 · 强调色（accent）：设备本地、只覆盖 primary 一族、主按钮文字逐档过 AA
 * =====================================================================
 *
 * 三件必须能红的事：
 *   1. `default` = **清空覆盖**（基准蓝白不被写死成另一套 inline 变量）；
 *   2. 每个强调色的 `--ht-color-on-primary` 与基色**实测对比度 ≥ 4.5:1**
 *      （亮暗两版各算一次 —— 琥珀/翠绿/天蓝偏亮，白字压不住）；
 *   3. 认不出的存储值回落 `default`（脏值不让界面变成一套没定义的颜色）。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { ACCENTS, accentVariables, applyAccent, loadAccent, saveAccent, ACCENT_STORAGE_KEY } from '../src/lib/accent.js';

/** 测试对照用的 token → hex（与 tokens.css 同值；改 token 必须重跑本测试）。 */
const TOKEN_HEX: Record<string, string> = {
  '--ht-emerald-600': '#059669',
  '--ht-emerald-400': '#34d399',
  '--ht-sky-600': '#0284c7',
  '--ht-sky-400': '#38bdf8',
  '--ht-amber-600': '#d97706',
  '--ht-amber-400': '#fbbf24',
  '--ht-slate-950': '#020617',
  '--ht-white': '#ffffff',
};

function rgbOf(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`bad hex ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 从 `var(--ht-xxx)` 取出 token 名。 */
function tokenOf(value: string): string {
  const m = /^var\((--ht-[a-z0-9-]+)\)$/.exec(value);
  if (m === null) throw new Error(`not a single var(): ${value}`);
  return m[1]!;
}

describe('#56 强调色', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const name of [
      '--ht-color-primary',
      '--ht-color-primary-hover',
      '--ht-color-primary-active',
      '--ht-color-primary-subtle',
      '--ht-color-primary-subtle-hover',
      '--ht-color-on-primary',
    ]) {
      document.documentElement.style.removeProperty(name);
    }
  });

  it('清单含 default 且无重复', () => {
    expect(ACCENTS).toContain('default');
    expect(new Set(ACCENTS).size).toBe(ACCENTS.length);
  });

  it('default = 不覆盖任何变量', () => {
    expect(accentVariables('default', 'light')).toEqual({});
    expect(accentVariables('default', 'dark')).toEqual({});
  });

  it('每个强调业主按钮文字与基色对比度 ≥ 4.5（亮 / 暗各一次）', () => {
    for (const accent of ACCENTS) {
      if (accent === 'default') continue;
      for (const theme of ['light', 'dark'] as const) {
        const vars = accentVariables(accent, theme);
        const baseToken = tokenOf(vars['--ht-color-primary']!);
        const onToken = tokenOf(vars['--ht-color-on-primary']!);
        const ratio = contrast(TOKEN_HEX[baseToken]!, TOKEN_HEX[onToken]!);
        expect(ratio, `${accent}/${theme}: ${onToken} on ${baseToken} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('hover / active / subtle 由同一基色派生，且亮暗方向相反', () => {
    const light = accentVariables('emerald', 'light');
    const dark = accentVariables('emerald', 'dark');
    // 亮色往深走、暗色往浅走 —— 与 tokens.css 的 blue 阶同向。
    expect(light['--ht-color-primary-hover']).toContain('var(--ht-slate-950)');
    expect(dark['--ht-color-primary-hover']).toContain('var(--ht-white)');
    expect(light['--ht-color-primary-subtle']).toContain('var(--ht-white)');
    expect(dark['--ht-color-primary-subtle']).toContain('var(--ht-ink-900)');
    expect(light['--ht-color-primary']).toBe('var(--ht-emerald-600)');
    expect(dark['--ht-color-primary']).toBe('var(--ht-emerald-400)');
  });

  it('applyAccent 写 inline 变量；default 清空它们', () => {
    applyAccent('amber', 'light');
    expect(document.documentElement.style.getPropertyValue('--ht-color-primary')).toBe('var(--ht-amber-600)');
    applyAccent('default', 'light');
    expect(document.documentElement.style.getPropertyValue('--ht-color-primary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--ht-color-on-primary')).toBe('');
  });

  it('存储：往返 + 脏值回落 default', () => {
    expect(loadAccent()).toBe('default');
    saveAccent('sky');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('sky');
    expect(loadAccent()).toBe('sky');
    localStorage.setItem(ACCENT_STORAGE_KEY, 'neon-nonsense');
    expect(loadAccent()).toBe('default');
  });
});
