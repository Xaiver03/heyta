/**
 * `native-values.ts` 的测试
 * ==========================
 *
 * 🔴 这些用例的存在理由，是真机上踩到的一次**不会报错的失败**：
 * 把 `font.sans` 那整条 CSS 字体栈当 `fontFamily` 传给 RN，JS 侧毫无异常，
 * 屏幕上是条纹状的乱码字。既然运行时不会喊，就只能靠这里的断言钉住。
 *
 * 每条断言都配了一个"它真的会失败吗"的反例 —— 见文件末尾的 guarding 用例。
 */

import { describe, expect, it } from 'vitest';
import {
  parseCssColor,
  parseCssShadow,
  parseCubicBezier,
  assertDurationMs,
  resolveLineHeight,
  resolveTracking,
  resolveFontFamily,
} from '../src/native-values.js';
import { lightTokens } from '../src/native.js';

describe('resolveFontFamily', () => {
  const STACK = lightTokens['font.sans'];

  it('未打包任何字体时不返回字体名（而不是硬塞第一项）', () => {
    // 这是真机那次乱码的直接防线：栈里第一项是 'Plus Jakarta Sans'，
    // 但它没被打进包，传下去就是无效字体名。
    expect(resolveFontFamily(STACK, [])).toBeUndefined();
  });

  it('字体确实打包了才返回它', () => {
    expect(resolveFontFamily(STACK, ['Plus Jakarta Sans'])).toBe('Plus Jakarta Sans');
  });

  it('去掉引号', () => {
    expect(resolveFontFamily("'Foo Bar', sans-serif", ['Foo Bar'])).toBe('Foo Bar');
    expect(resolveFontFamily('"Foo Bar", sans-serif', ['Foo Bar'])).toBe('Foo Bar');
  });

  it('泛型族永远不被当成字体名', () => {
    // 栈里没有具体字体名，只有泛型族 —— 不能返回 sans-serif。
    expect(resolveFontFamily('sans-serif', ['sans-serif'])).toBeUndefined();
    expect(resolveFontFamily('-apple-system, BlinkMacSystemFont', [])).toBeUndefined();
  });

  it('空串 → undefined', () => {
    expect(resolveFontFamily('', [])).toBeUndefined();
    expect(resolveFontFamily('   ', [])).toBeUndefined();
  });

  it('真实 token 上：不加打包清单就拿不到字体名（这是有意的默认）', () => {
    expect(resolveFontFamily(STACK)).toBeUndefined();
    expect(resolveFontFamily(lightTokens['font.mono'], [])).toBeUndefined();
  });
});

describe('parseCssColor', () => {
  it('rgb 三参数', () => {
    expect(parseCssColor('rgb(15 23 42)')).toEqual({ hex: '#0f172a', alpha: 1 });
    expect(parseCssColor('rgb(15, 23, 42)')).toEqual({ hex: '#0f172a', alpha: 1 });
  });

  it('rgb + 斜杠 alpha（tokens.css 的实际写法）', () => {
    expect(parseCssColor('rgb(15 23 42 / 0.08)')).toEqual({ hex: '#0f172a', alpha: 0.08 });
  });

  it('百分比 alpha', () => {
    expect(parseCssColor('rgb(15 23 42 / 25%)')).toEqual({ hex: '#0f172a', alpha: 0.25 });
  });

  it('#rrggbb 与 #rrggbbaa', () => {
    expect(parseCssColor('#0F172A')).toEqual({ hex: '#0f172a', alpha: 1 });
    expect(parseCssColor('#0f172a80')).toEqual({ hex: '#0f172a', alpha: 128 / 255 });
  });

  it('超范围数值被夹紧', () => {
    expect(parseCssColor('rgb(300 -5 42)')).toEqual({ hex: '#ff002a', alpha: 1 });
  });

  it('认不出来就 null，不猜', () => {
    expect(parseCssColor('rebeccapurple')).toBeNull();
    expect(parseCssColor('color-mix(in srgb, red, blue)')).toBeNull();
    expect(parseCssColor('')).toBeNull();
  });
});

describe('parseCssShadow', () => {
  it('解析 tokens.css 的实际格式', () => {
    const s = parseCssShadow(lightTokens['shadow.md']);
    expect(s).not.toBeNull();
    expect(s!.shadowOffset).toEqual({ width: 0, height: 2 });
    expect(s!.shadowRadius).toBe(8);
    expect(s!.shadowColor).toBe('#0f172a');
    expect(s!.shadowOpacity).toBeCloseTo(0.08, 6);
  });

  it('`none` → null（不是全零阴影）', () => {
    // 全零阴影会画出淡淡的边，而 none 就该什么都不画。
    expect(parseCssShadow('none')).toBeNull();
    expect(parseCssShadow('')).toBeNull();
  });

  it('负偏移', () => {
    const s = parseCssShadow('-2px 4px 8px #000000');
    expect(s!.shadowOffset).toEqual({ width: -2, height: 4 });
  });

  it('颜色写在前面也能解析', () => {
    const s = parseCssShadow('rgb(0 0 0 / 0.5) 0 1px 2px');
    expect(s!.shadowOffset).toEqual({ width: 0, height: 1 });
    expect(s!.shadowOpacity).toBeCloseTo(0.5, 6);
  });

  it('多层阴影返回 null —— 不猜', () => {
    // 挑一层"看起来差不多"的，等于悄悄改设计。
    expect(parseCssShadow('0 1px 2px #000, 0 8px 16px #000')).toBeNull();
  });

  it('缺 blur / 非 px 单位 → null', () => {
    expect(parseCssShadow('0 1px #000')).toBeNull();
    expect(parseCssShadow('0 1px 2rem #000')).toBeNull();
  });

  it('elevation 随阴影强度单调不减', () => {
    const order = ['shadow.sm', 'shadow.md', 'shadow.lg', 'shadow.xl'] as const;
    const evs = order.map((k) => parseCssShadow(lightTokens[k])!.elevation);
    for (let i = 1; i < evs.length; i++) {
      expect(evs[i]!).toBeGreaterThanOrEqual(evs[i - 1]!);
    }
  });

  it('所有非 none 的 shadow token 都能解析出来', () => {
    for (const key of ['shadow.sm', 'shadow.md', 'shadow.lg', 'shadow.xl', 'shadow.focus'] as const) {
      expect(parseCssShadow(lightTokens[key]), key).not.toBeNull();
    }
  });
});

describe('parseCubicBezier', () => {
  it('解析 tokens.css 的实际格式', () => {
    expect(parseCubicBezier(lightTokens['ease.standard'])).toEqual([0.2, 0, 0.2, 1]);
  });

  it('允许超出 [0,1] 的值（spring 会回弹）', () => {
    expect(parseCubicBezier(lightTokens['ease.spring'])).toEqual([0.34, 1.56, 0.64, 1]);
  });

  it('非 cubic-bezier 写法 → null，不硬编一条等价曲线', () => {
    expect(parseCubicBezier('linear')).toBeNull();
    expect(parseCubicBezier('ease-in-out')).toBeNull();
    expect(parseCubicBezier('steps(4, end)')).toBeNull();
  });

  it('四个 ease token 全部可解析', () => {
    for (const key of ['ease.standard', 'ease.enter', 'ease.exit', 'ease.spring'] as const) {
      expect(parseCubicBezier(lightTokens[key]), key).not.toBeNull();
    }
  });
});

describe('assertDurationMs', () => {
  it('数字通过', () => {
    expect(assertDurationMs(150, 'duration.fast')).toBe(150);
  });

  it('字符串会抛 —— 这正是它存在的理由', () => {
    // 生成器若改回 '150ms' 字符串，这里立刻红，而不是让调用方拿去当数字用。
    expect(() => assertDurationMs('150ms', 'duration.fast')).toThrow(TypeError);
    expect(() => assertDurationMs('150ms', 'duration.fast')).toThrow(/期望毫秒数字/);
  });

  it('NaN / Infinity 也抛', () => {
    expect(() => assertDurationMs(Number.NaN, 'x')).toThrow(TypeError);
    expect(() => assertDurationMs(Number.POSITIVE_INFINITY, 'x')).toThrow(TypeError);
  });

  it('真实 token 全是数字', () => {
    for (const key of [
      'duration.instant',
      'duration.fast',
      'duration.normal',
      'duration.slow',
      'duration.exit',
    ] as const) {
      expect(assertDurationMs(lightTokens[key], key), key).toBeTypeOf('number');
    }
  });
});

describe('resolveLineHeight', () => {
  it('倍数额字号才是 RN 要的绝对行高', () => {
    // CSS: line-height 1.5 × 16px = 24px
    expect(resolveLineHeight(lightTokens['line-height.normal'], lightTokens['font-size.base'])).toBe(
      24,
    );
  });

  it('严格大于字号 —— 直接传倍数会让行高塌掉', () => {
    for (const lh of ['line-height.tight', 'line-height.normal', 'line-height.relaxed'] as const) {
      for (const fs of ['font-size.sm', 'font-size.base', 'font-size.lg'] as const) {
        const px = resolveLineHeight(lightTokens[lh], lightTokens[fs]);
        expect(px, `${lh} × ${fs}`).toBeGreaterThan(lightTokens[fs]);
      }
    }
  });

  it('取整到整数像素', () => {
    expect(Number.isInteger(resolveLineHeight(1.25, 11))).toBe(true);
  });

  it('对照：line-height token 确实是小数倍数，不是像素', () => {
    // 若哪天生成器改成像素，这条会红，提醒这一层多余了。
    expect(lightTokens['line-height.normal']).toBeLessThan(3);
    expect(lightTokens['font-size.base']).toBeGreaterThan(10);
  });
});

describe('resolveTracking', () => {
  it('em 比例乘字号才是各端要的点值字距', () => {
    // -0.022em × 16px = -0.352pt
    expect(resolveTracking(lightTokens['tracking.display'], 16)).toBeCloseTo(-0.352, 3);
  });

  it('🔴 绝不取整 —— 取整会把字距清零', () => {
    // 这是本函数存在的唯一理由。字距的绝对值本来就小于 1pt，
    // Math.round(-0.352) === -0，字距完全消失、不报错、不告警，
    // 视觉上只是"标题看起来松了一点"。
    const px = resolveTracking(-0.022, 16);
    expect(px).not.toBe(0);
    expect(Math.round(-0.022 * 16)).toBe(-0);
    expect(px).toBeLessThan(0);
  });

  it('字距随字号放大 —— 同一个比例，大字号得到更大的绝对字距', () => {
    const small = resolveTracking(lightTokens['tracking.display'], lightTokens['font-size.sm']);
    const large = resolveTracking(lightTokens['tracking.display'], lightTokens['font-size.4xl']);
    expect(Math.abs(large)).toBeGreaterThan(Math.abs(small));
  });

  it('大字号收紧、小字号放宽 —— 方向不能反', () => {
    // Apple 规则：字距随字号变。display 收，caption 放。
    expect(lightTokens['tracking.display']).toBeLessThan(0);
    expect(lightTokens['tracking.caption']).toBeGreaterThan(0);
  });

  it('对照：tracking token 确实是 em 比例，不是点值', () => {
    // 若哪天生成器直接导出点值，这条会红，提醒这一层多余了。
    for (const t of ['tracking.display', 'tracking.title', 'tracking.body', 'tracking.caption'] as const) {
      expect(Math.abs(lightTokens[t]), t).toBeLessThan(0.1);
    }
  });
});

describe('对照：这些 token 原样喂给 RN 确实是无效的', () => {
  /**
   * 这一组不是测我们的解析器，而是**钉住前提**：
   * 如果哪天 tokens.css 把这些值改成了 RN 也能直接吃的形式，
   * 这些断言会红，提醒我们这一层可能已经多余了 —— 而不是让它默默留着。
   */
  it('font.sans 是 CSS 字体栈（含逗号与泛型族）', () => {
    expect(lightTokens['font.sans']).toContain(',');
    expect(lightTokens['font.sans']).toContain('sans-serif');
  });

  it('shadow.* 是 box-shadow 字符串（含 px）', () => {
    expect(lightTokens['shadow.md']).toMatch(/\d+px/);
    expect(lightTokens['shadow.md']).toContain('rgb(');
  });

  it('ease.* 是 cubic-bezier 函数写法', () => {
    expect(lightTokens['ease.standard']).toMatch(/^cubic-bezier\(/);
  });
});