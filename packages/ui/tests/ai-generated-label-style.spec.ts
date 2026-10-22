/**
 * 法定显式标识的**字形**：灰色小字，不是一枚色块
 * =================================================
 *
 * 为什么单独钉这一条：标识的**存在**早就有判据了（六个宿主各自断言 testID 的
 * 文字），所以"嵌一枚蓝色 chip 在答案下方"在测试里一直是绿的 ——
 * 它拦不住的是**长得像按钮/标签**这件事本身：
 *
 *   · 一枚 11px 蓝底胶囊放在正文下面，读起来像一个可点的操作；
 *   · 它和"来源：本机/云端"那类**元数据**抢同一层注意力，
 *     而《标识办法》要的是"可被明显感知"，不是"必须打断阅读"。
 *
 * 同行（ChatGPT / Claude / Copilot / Gemini / Apple Intelligence）一律把它做成
 * **正文下方的次要灰色小字**，不带底色。这份判据钉的就是那个形状。
 *
 * ⚠️ 这里断言的是**样式计划**（纯数据），不是 DOM：`packages/ui` 的测试跑在
 * node 环境、不引 jsdom（见 `task-row-density.spec.ts` 文件头那条纪律）。
 * DOM 级的"标签在内容之后"由 `apps/web/tests` 的四个面板 spec 负责。
 */

import { describe, expect, it } from 'vitest';

import { resolveAllTextStyles, resolveNativeTokens } from '@heyta/design-system';

import { aiGeneratedLabelStyle } from '../src/ai/generated-label-style.js';

/**
 * ⚠️ 刻意**不**从 `../src/theme.js` 取主题：那个模块 import 了 `react-native`
 * 的运行时值，而 RN 的源码是 Flow 语法，Vite 在 node 环境直接解析失败
 * （实测：`Parse failure: Flow is not supported`）。这里只消费
 * `@heyta/design-system` 的**纯函数**，与 Provider 里那次解析同源同参。
 */
function themeFor(theme: 'light' | 'dark') {
  const tokens = resolveNativeTokens({ theme, reducedMotion: false, reducedTransparency: false });
  return { tokens, text: resolveAllTextStyles(tokens) };
}

const light = themeFor('light');
const dark = themeFor('dark');

describe('AI 生成合成内容标识 · 灰色小字（不是 chip）', () => {
  it('🔴 外框只承担「贴左 + 上距」——没有任何底色/内边距/圆角', () => {
    const style = aiGeneratedLabelStyle(light.tokens, light.text);
    // 键集合逐字相等：多加一个 `backgroundColor` / `paddingHorizontal` /
    // `borderRadius` 就会红。这是"它不是 chip"唯一可执行的判据。
    expect(Object.keys(style.frame).sort()).toEqual(['alignSelf', 'marginTop']);
    expect(style.frame.alignSelf).toBe('flex-start');
    expect(style.frame.marginTop).toBe(light.tokens['space.1']);
  });

  it('文字用 caption 档（12px 辅助文字下限）——不是自拼字号', () => {
    const style = aiGeneratedLabelStyle(light.tokens, light.text);
    for (const key of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] as const) {
      expect(style.label[key], `caption 的 ${key} 必须原样继承`).toEqual(light.text.caption[key]);
    }
    // 「最小字号下限」这条是 tokens.css 里写死的承诺：11px 只给极致紧凑标签，
    // 法定标识不是标签，它得能读。
    expect(style.label.fontSize).toBe(light.tokens['font-size.xs']);
  });

  it('颜色是 foreground-muted（灰）——不是 primary、也不带底色', () => {
    const style = aiGeneratedLabelStyle(light.tokens, light.text);
    expect(style.label.color).toBe(light.tokens['color.foreground-muted']);
    // 文字上也不许出现底色（`RnTextStyle` 本身就没有这个键 —— 那是类型层的第二道）。
    expect('backgroundColor' in style.label).toBe(false);
  });

  it('暗色下同样成立：换主题只换颜色，不换字形', () => {
    const style = aiGeneratedLabelStyle(dark.tokens, dark.text);
    expect(Object.keys(style.frame).sort()).toEqual(['alignSelf', 'marginTop']);
    expect(style.label.color).toBe(dark.tokens['color.foreground-muted']);
    expect(style.label.fontSize).toBe(dark.tokens['font-size.xs']);
  });

  it('对比度有出处：foreground-muted 在内容底色上 ≥ 4.5:1 由 tokens.spec 守着', () => {
    // 这里**不重算** WCAG（那会变成第二套公式）。只断言"我们挑的这一对
    // 正是 design-system 已经覆盖的那一对"，让"换颜色"这件事必须回到那里去改：
    // `packages/design-system/tests/tokens.spec.ts` 的玻璃档用例逐对算
    // `--ht-color-foreground-muted` × 内容色，门槛 4.5:1。
    const style = aiGeneratedLabelStyle(light.tokens, light.text);
    expect(style.label.color).toBe(light.tokens['color.foreground-muted']);
    expect(light.tokens['color.foreground-muted']).not.toBe(light.tokens['color.foreground-subtle']);
  });
});
