/**
 * jsdom 环境补齐
 * ================
 *
 * 🔴 这个文件存在的原因是**一个具体的崩溃**，不是"以后可能会用到"。
 *
 * `react-activity-calendar`（习惯热力图与成长页的年度视图都用它）在渲染前
 * 会校验主题色：
 *
 * ```js
 * if (typeof window !== 'undefined' && !CSS.supports('color', c)) throw ...
 * ```
 *
 * 而 jsdom **没有实现 CSSOM 的 `CSS.supports`**。于是任何在 jsdom 里渲染
 * 这个组件的用例都会炸在 `Cannot read properties of undefined (reading 'supports')`
 * —— 崩在库内部，报错完全指不到我们自己的代码。
 *
 * ⚠️ 这不是"我们传错了颜色"。我们用**真 Chromium**验过：
 *
 * ```
 * CSS.supports('color', 'var(--ht-color-primary)')  // → true
 * CSS.supports('color', '#22c55e')                  // → true
 * CSS.supports('color', 'notacolor')                // → false
 * ```
 *
 * 传 `var(--ht-*)` 是合法的：`var()` 的替换发生在 computed-value 阶段，
 * 声明在 parse 阶段就是有效的。所以浏览器里一切正常，
 * **只有 jsdom 需要这个补丁**。
 *
 * 补丁按上面实测的规则实现，而不是一律 `return true`：
 * 一律放行会让"真的传了个非法颜色"这种错误在测试里静默通过。
 */

interface CssLike {
  supports?: (property: string, value: string) => boolean;
  escape?: (value: string) => string;
}

const globalWithCss = globalThis as unknown as { CSS?: CssLike };

/** 与真 Chromium 实测行为一致：`var()` 在 parse 阶段即视为合法。 */
const CSS_VAR = /^var\(--[\w-]+\)$/;

/** jsdom 认得的颜色字面量形态（够用即可，不做完整 CSS 语法分析）。 */
const COLOR_LITERAL =
  /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\(|transparent$|currentcolor$)/i;

const existing: CssLike = globalWithCss.CSS ?? {};

if (typeof existing.supports !== 'function') {
  globalWithCss.CSS = {
    ...existing,
    supports: (property: string, value: string): boolean => {
      if (property === 'color') {
        const v = value.trim();
        return CSS_VAR.test(v) || COLOR_LITERAL.test(v);
      }
      // 只有 `color` 被真正建模 —— 目前唯一的调用点就是它。
      // 其余属性一律放行：这是个测试替身，不是校验器，
      // 在这里产生"假失败"比漏掉一个错误更糟。
      return true;
    },
  };
}

/**
 * jsdom 补齐之二：`window.matchMedia`
 *
 * 🔴 同上，也是**同一个库**的第二个缺口。`react-activity-calendar` 在渲染时
 * 直接读 `window.matchMedia('(prefers-color-scheme: dark)')` 决定用 light 还是
 * dark 那套主题色 —— 而 jsdom 没有实现 `matchMedia`，于是任何渲染它的用例
 * 都会炸在 `window.matchMedia is not a function`。
 *
 * ⚠️ 注意它读的是**系统**的 `prefers-color-scheme`，不是应用自己的主题开关。
 * 这在本项目里是无害的：两套主题色传的是同一组 `var(--ht-…)`，
 * 实际颜色由我们自己的 CSS 变量按应用主题解析（见 `src/lib/heatmap-theme.ts`）。
 *
 * 需要测暗色的用例可以自己覆盖 `window.matchMedia`。
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

/**
 * React 19 的 `act()` 需要这个全局开关，否则每渲染一次就警告一次
 * "The current testing environment is not configured to support act(...)"。
 * 警告本身不致命，但它会淹没真正的报错。
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;