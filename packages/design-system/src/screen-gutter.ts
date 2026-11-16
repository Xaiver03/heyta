/**
 * 页面留白的唯一解析入口（`screen.gutter`）
 * ==========================================
 *
 * ## 这个文件解决的是什么问题
 *
 * 2026-11-16 实测：同一条"页面左右留白"在仓里有**三个答案**——
 *
 * | 位置 | 当时的值 |
 * |---|---|
 * | `tokens.css` 的 `--ht-screen-gutter` | `1rem`（16），且**没人按宽度改它** |
 * | Web 的 `.ht-content` | `var(--ht-space-6)`（24）—— 根本没引用那个 token |
 * | 移动端 `Screen` 的 `board` 档 | `0`（写死在三元表达式里） |
 *
 * 后果不是"某处差 8px"，而是**一整类屏贴着屏幕边**：日历 = 网格 + 内容卡，
 * 网格铺满是预期的，但下面那张「这一天没有到期的任务」卡和脚注一起贴到两边。
 * 于是修复只能逐个打补丁 —— 11-15 给脚注补 16dp、11-16 给整块板补 16dp，
 * 而 16dp 在 iPad（820–1366dp）上肉眼依然≈没有留白。
 *
 * ## 正确形态：一张阶梯表，两端共用一个解析器
 *
 * - **Web**：`tokens.css` 里那条 media query 就地覆盖 `--ht-screen-gutter`
 *   （48rem → 24、64rem → 32），消费侧只写 `var(--ht-screen-gutter)`。
 * - **原生**：RN 没有媒体查询，所以在运行时按宽度查**同一张表**。
 *
 * 两个世界共用 `SCREEN_GUTTER_STEPS` 这一份定义，所以"哪一档在哪个宽度生效"
 * 只有一个答案。判据：`packages/design-system/tests/screen-gutter.spec.ts`
 * 断言"表里的值与 `tokens.css` 的三档逐字相等"，改一处不同步就红。
 *
 * ## 🔴 为什么不是"给每个屏加一个 maxWidth"
 *
 * 收窄内容列是 **page 档**的手段（`CONTENT_MEASURE_MAX` = 680）。
 * 看板档（`board`：四象限 / 时间线 / 日历）**本来就不该收窄** —— 网格要铺开。
 * 这类屏缺的是"边距"，不是"最大宽"。给它们套 680 会把月历压成一条竖条。
 * 所以这里只管边距；"全出血"由 `screenGutterBleed()` 显式表达（见下）。
 */

import type { HeytaNativeTokens } from './native.js';

/**
 * 只有这三档参与计算 —— 用一个窄类型，好让"传错表"在编译期就红。
 * 同时它让 `SCREEN_GUTTER_STEPS[].token` 能直接索引 token 表
 * （用宽的 `TokenName` 会报 TS7053：`'focus-ring.width'` 不存在于这张窄表上）。
 */
type GutterToken = 'screen.gutter' | 'screen.gutter-md' | 'screen.gutter-lg';
type GutterTokens = Pick<HeytaNativeTokens, GutterToken>;

/** 一档留白：从多宽开始生效、取哪个 token。 */
export interface ScreenGutterStep {
  /** 生效的最小宽度（CSS px / dp）。`0` 表示基准档，永远成立。 */
  readonly minWidth: number;
  /** 该档取的 token 名（窄联合，见上面的 `GutterToken`）。 */
  readonly token: GutterToken;
  /**
   * 对应的 CSS 断点（`null` = 基准档，不写在 media query 里）。
   * 只用于文档与门禁对账，运行时不读它。
   */
  readonly cssBreakpointRem: number | null;
}

/**
 * 留白阶梯 —— **唯一一份**。
 *
 * | minWidth | token | CSS |
 * |---|---|---|
 * | 0 | `screen.gutter`（16） | 基准 `:root` |
 * | 768 | `screen.gutter-md`（24） | `@media (min-width: 48rem)` |
 * | 1024 | `screen.gutter-lg`（32） | `@media (min-width: 64rem)` |
 *
 * 三个值与 `docs/agents/design-system.md` §响应式断点那一把尺一致
 * （375 / 768 / 1024 / 1440 里取了后两个当台阶）。**窄于 375 不再减** ——
 * 16dp 已经是 iOS 的标准页边距，再窄会让中文行长不足。
 */
export const SCREEN_GUTTER_STEPS: ReadonlyArray<ScreenGutterStep> = [
  { minWidth: 0, token: 'screen.gutter', cssBreakpointRem: null },
  { minWidth: 768, token: 'screen.gutter-md', cssBreakpointRem: 48 },
  { minWidth: 1024, token: 'screen.gutter-lg', cssBreakpointRem: 64 },
];

/**
 * 按窗口宽度取页面留白。
 *
 * @param width 当前窗口宽度（CSS px / dp）
 * @param tokens 原生 token 表（`useHeytaTokens()` 的返回值）
 *
 * 🔴 传 `width` 而不是让调用方自己 `width >= 768 ? … : …`：
 * 那种写法在每个宿主里各写一遍，就是"同一条阶梯有 N 份实现"的起点，
 * 而 N 份里只要有一份漏了 1024 那档，**平板横屏就会回到 24** ——
 * 没有任何测试会红，只有对着 iPad 看才发现。
 */
export function resolveScreenGutter(width: number, tokens: GutterTokens): number {
  let value = tokens[SCREEN_GUTTER_STEPS[0]!.token];
  for (const step of SCREEN_GUTTER_STEPS) {
    if (width >= step.minWidth) value = tokens[step.token];
  }
  return value;
}

/**
 * 把 `token.screen.gutter` 就地替换成**当前宽度下的值**。
 *
 * ## 为什么这一步是"从根上解决"而不是"再加一层"
 *
 * 上面 `resolveScreenGutter` 只解决"怎么算"。真正让 20+ 个消费点各自漂移的，
 * 是**每个消费点都要自己拿到宽度**：`tokens['screen.gutter']` 在任何宽度上都是 16，
 * 而想用正确值就得在组件里 `useWindowDimensions()` + 再算一遍 ——
 * 结果就是有人算了、有人没算，且**没有任何测试会红**。
 *
 * 正确形态：**留白是 token 的属性，解析一次，注入上下文**
 * （`resolveHeytaUiTheme({ screenWidth })` → `HeytaUiProvider`）。
 * 之后共享层与各屏照旧写 `tokens['screen.gutter']`，拿到的就是 16 / 24 / 32。
 *
 * 这也让**共享组件**（`packages/ui` 里的 BottomSheet、CalendarBoard …）自动正确 ——
 * 它们拿不到 `react-native` 的窗口尺寸，此前根本没办法响应式。
 *
 * 🔴 纯函数、不 mutate 入参：token 表是 Provider 之间共享的引用，
 *    就地改会让"同一个表在两个宽度下"互相踩。
 */
export function withResolvedScreenGutter<T extends GutterTokens>(
  tokens: T,
  width: number | undefined,
): T {
  if (width === undefined || !Number.isFinite(width) || width <= 0) return tokens;
  const gutter = resolveScreenGutter(width, tokens);
  if (gutter === tokens['screen.gutter']) return tokens;
  return { ...tokens, 'screen.gutter': gutter };
}
