/**
 * vitest 的 jsdom 环境补丁。
 *
 * 🔴 **`fake-indexeddb/auto` 必须在任何被测模块之前加载。**
 *
 * `src/lib/oplog.ts` 的 `resolveStorageBackend()` 有两条路径：
 *   - `VITE_HEYTA_STORAGE=indexeddb` → `IndexedDbAdapter`（jsdom **没有** IndexedDB，靠这里补）；
 *   - 其它 → SQLite **Worker**（jsdom 也没有 `Worker`）。
 *
 * 如果不补 IndexedDB **且**不切后端，测试会走 Worker 路径并死在
 * `ReferenceError: Worker is not defined` —— 那个报错完全指不到
 * "你少了一个后端开关"。
 *
 * ⚠️ **不要**用"给 jsdom 塞一个假 Worker"来绕。那样 `oplog` 会在一个
 * 什么都不做的假 Worker 上跑，而"任务真的写进了 op-log"这类断言
 * 会变成**测一个假实现** —— 绿得毫无意义。正确的做法是让测试走
 * **真实存在**的另一条存储路径（IndexedDB + `fake-indexeddb`）。
 */
import 'fake-indexeddb/auto';

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
 * 实际颜色由我们自己的 CSS 变量按应用主题解析（该文件已删：热力图改成 RN 自绘后不再需要库的 theme 注入）。
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

/**
 * jsdom 补齐之三：把 `navigator.language` 钉成 `zh-CN`
 *
 * 🔴 2026-10-01 起应用读 `navigator.language` 做首启语言（四层解析链，
 * `src/lib/locale.ts` 文件头）。jsdom 的默认是 `'en-US'`，不钉的话
 * 所有隐式依赖「无偏好 ⇒ 中文」的既有用例会整体翻成英文 ——
 * 那些用例测的是各自的界面，不该被解析链的默认值牵着走。
 *
 * 要测解析链本身的用例（`tests/locale.spec.ts`）在自己的用例里
 * `vi.spyOn(navigator, 'language', 'get')` 覆写 —— 覆写后 `mockRestore()`
 * 还原到的是**本文件钉的这个值**（spy 接管的是当时的现状），用例间不泄漏。
 */
Object.defineProperty(window.navigator, 'language', {
  get: () => 'zh-CN',
  configurable: true,
});

/**
 * jsdom 补齐之四：`Element.prototype.scrollIntoView`
 *
 * 🔴 起因是一枚具体的崩溃，不是"以后可能用得到"：设置分组导航把"当前项要被滚进
 * 可视窗口"做成了 `active` 的 effect（窄屏那根条横向可滚，而选这一档有四条路，
 * 旧代码的 `scrollIntoView` 只挂在导航按钮自己的 `onClick` 上 ⇒ 从 rail「帮助」
 * 进来时选中态整个画在窗口外）。effect 一挂上，**任何打开过设置的用例**都会崩在
 * `scrollIntoView is not a function` —— 实测 8 枚测试文件、34 条用例同时红，
 * 报错指不到产品行为。
 *
 * ⚠️ 补在**测试这边**，不把宿主代码改成 `?.scrollIntoView?.()`：后者等于给生产代码
 * 开一条"环境不支持就什么都不做"的旁路，而那正是这条规则唯一需要被看见的失败形状。
 * 同一取舍在 `settings-anchor-focus.spec.tsx` / `search-panel.spec.tsx` 的文件头里
 * 已经写过一次，本文件是把它收在一处。
 *
 * 要拿它当判据的用例（`settings-nav-reveal.spec.tsx`）在自己的 `beforeEach` 里覆写成
 * 记录器、`afterEach` 还原 —— 还原到的就是这里这枚空函数，用例间不泄漏。
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function (): void {
    // jsdom 没有布局引擎：滚不动，也不该假装滚动了什么。
  };
}
/**
 * 同一族的另一半：`Element.prototype.scrollTo` 在 jsdom 里同样不存在。
 * 设置浮层"换一档 ⇒ 回到顶部"用的就是它，而那条规则现在挂在
 * `activeSettingsSection` 的 effect 上 ⇒ **任何打开过设置的用例**都会碰它。
 * 取舍与上面一条完全相同（补在测试这边，不把宿主代码写成可选调用）。
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function (): void {
    // 同上：jsdom 没有滚动位置可言。
  };
}
