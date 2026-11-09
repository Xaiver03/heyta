/**
 * 流式光标的判据
 * ================================
 *
 * ⚠️ **为什么单独一个文件**：`ai-assistant-panel.spec.tsx` 里传的是
 * `revealStream={false}`（那些用例测数据契约），于是 `revealedText === live.text`、
 * 光标**根本不出现** —— 它在那边等于没被测。
 * 这里补上"它真的画得出来、可访问性对、降级时不丢信息"这三件事。
 *
 * 🔴 尤其是最后一条：「减少动效时光标**仍在**」是这次实现的一个刻意的
 * 产品判断（降级降的是动作，不是信息）。若没有人钉住它，下一次有人
 * "顺手把动画关掉"时会连元素一起删掉 —— 而那会让
 * "它还在想"与"它卡住了"在画面上重新变得无法区分。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import {
  HeytaUiProvider,
  resolveHeytaUiTheme,
  StreamCaret,
  STREAM_CARET_STATIC_OPACITY,
  type HeytaUiTheme,
} from '@heyta/ui';

function mount(ui: React.ReactElement): { el: HTMLDivElement; root: Root } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<HeytaUiProvider>{ui}</HeytaUiProvider>);
  });
  return { el, root };
}

/**
 * 用**显式主题**挂载。
 *
 * 🔴 存在的理由：`<HeytaUiProvider reducedMotion>` 这个 prop 在嵌套场景下
 * 会被外层 context 盖掉（见下面那条用例的注释）。要测"某个偏好下的渲染"，
 * 唯一可靠的姿势是算好 `HeytaUiTheme` 再从 `value` 传进去。
 */
function mountWithValue(theme: HeytaUiTheme, ui: React.ReactElement): { el: HTMLDivElement; root: Root } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<HeytaUiProvider value={theme}>{ui}</HeytaUiProvider>);
  });
  return { el, root };
}

describe('StreamCaret：流式光标', () => {
  it('按 testID 画得出来（判据挂得上）', () => {
    const { el, root } = mount(<StreamCaret testID="ai-chat-caret" fontSize={14} />);
    expect(el.querySelector('[data-testid="ai-chat-caret"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it('🔴 对读屏隐藏（它是纯装饰，信息由文本流承载）', () => {
    // 怎么让它红：去掉组件里的 `accessible={false}` / `aria-hidden`。
    // 一个没有名字的空元素被念出来只是噪音 —— "还在生成"这条信息
    // 由 `aria-live="polite"` 的文本流本身传达。
    const { el, root } = mount(<StreamCaret testID="caret-a11y" fontSize={14} />);
    const caret = el.querySelector('[data-testid="caret-a11y"]');
    expect(caret).not.toBeNull();
    // react-native-web 把 accessible={false} 落成 aria-hidden
    expect(caret?.getAttribute('aria-hidden')).toBe('true');
    act(() => root.unmount());
  });

  it('高度跟着 fontSize 走（换文字档时不会忽高忽低）', () => {
    /**
     * ⚠️ 断言的是 **class 名**，不是 `style.height`。
     *
     * 实测（2026-11-10）：`react-native-web` 把**静态**样式编译成 CSS class
     * （`r-height-tbmifm` 这种），`style` 属性里只剩**动态**值（`opacity`）。
     * 所以 `node.style.height` 是空串 —— 我最初按"读 style"写，得到空值，
     * 那条断言测的是错的东西。
     *
     * 不同 fontSize 必须产出不同 class ⇒ 说明它真的参与了样式计算。
     * 怎么让它红：把 `height: fontSize` 改成固定数字，
     * 两个 fontSize 会落到**同一个** class 上。
     */
    const heightClassOf = (fontSize: number, testID: string): string => {
      const { el, root } = mount(<StreamCaret testID={testID} fontSize={fontSize} />);
      const node = el.querySelector<HTMLElement>(`[data-testid="${testID}"]`);
      const cls = node?.className ?? '';
      act(() => root.unmount());
      // 取 r-height-* 那一段（RMW 的原子 class 命名）
      return cls.split(/\s+/).find((c) => c.startsWith('r-height-')) ?? '';
    };

    const small = heightClassOf(12, 'caret-sm');
    const large = heightClassOf(24, 'caret-lg');

    expect(small).not.toBe('');
    expect(large).not.toBe('');
    expect(small).not.toBe(large);
  });

  it('🔴 reducedMotion 下**仍然渲染**，只是不闪（降级降动作、不降信息）', () => {
    /**
     * ⚠️ 这里无法在 jsdom 里真的断言"停掉了 loop" —— 那要看有没有
     * `requestAnimationFrame` 被排。能断言的是**元素还在**，
     * 而那恰好是这条产品判断的核心：信息不能因为降级而消失。
     *
     * 怎么让它红：在组件里写成 `if (reducedMotion) return null;` ——
     * 那是最容易犯的"降级"误解，而它会丢掉信息。
     *
     * 🔴 **必须用 `value` 而不是 `reducedMotion` prop**：
     * 实测（2026-11-10）`<HeytaUiProvider reducedMotion>` 在这里**不生效** ——
     * `theme.tsx` 的嵌套继承逻辑是"外层已有主题就直接沿用"
     * （`value ?? (inherited !== null ? inherited : fallback)`），
     * 所以内层传的 `reducedMotion` 被外层 context 盖掉了。
     * 我最初就是这么写的，变异测试（改成 `return null`）**没能让它变红**，
     * 才发现这条断言测的不是它以为在测的东西。
     */
    const reduced = resolveHeytaUiTheme({ scheme: 'light', reducedMotion: true });
    const { el, root } = mountWithValue(
      reduced,
      <StreamCaret testID="caret-reduced" fontSize={14} />,
    );
    expect(el.querySelector('[data-testid="caret-reduced"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it('静态可见度是一个**看得见**的值（不是 0 —— 完全透明等于没有）', () => {
    // 怎么让它红：把 STATIC_OPACITY 改成 0。
    expect(STREAM_CARET_STATIC_OPACITY).toBeGreaterThan(0.3);
    expect(STREAM_CARET_STATIC_OPACITY).toBeLessThan(1);
  });
});
