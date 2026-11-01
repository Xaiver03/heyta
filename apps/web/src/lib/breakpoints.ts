/**
 * 响应式断点的 **JS 侧唯一表达**。
 * ================================================================
 *
 * ## 为什么需要这个模块（不是为了好看）
 *
 * CSS 的媒体查询**用不了 CSS 变量**（规范如此），所以"一把尺"不可能只住在
 * `tokens.css` 里 —— 它由 [文档约定 + 门禁] 两条腿钉住：
 *
 *   · 约定：`docs/agents/design-system.md` §响应式断点；
 *   · 门禁：`scripts/check-breakpoints.mjs`（`pnpm check:breakpoints`）。
 *
 * 而 JS 侧本来**抄了三份**：`useNarrowLayout.ts` 与 `ScopeDrawer.tsx` 各一份
 * `(max-width: 768px)`，`detail-pane-visible.ts` 一份
 * `(min-width: 1024px) and (min-height: 480px)`。三份抄件与 `narrow.css` 的四条规则之间
 * **没有任何机制保证一致** —— 改 CSS 的人不知道 JS 里还有两处。
 * 门禁的 B5 就是从这一处开始判的：`apps/web/src` 里出现宽/高字面量的 `.ts/.tsx`
 * 只许是本文件。
 *
 * ## 尺（与 `check-breakpoints.mjs` 的 TIERS 逐字同源）
 *
 * | 档 | 值 | px @16 | 判什么 |
 * |---|---|---|---|
 * | 紧凑 | `48rem` | ≤768 | 底栏导航 / 设置单栏 / 详情列不出 |
 * | 中等 | `48.0625rem`–`63.9375rem` | 769–1023 | 详情列仍不出（账在 `narrow.css` 文件头） |
 * | 宽屏 | `64rem` | ≥1024 | 三栏成立 |
 *
 * 🔴 **那两条"一像素"是算出来的，不许手写**：CSS 媒体查询没有"严格大于"，
 * 互补的两半只能差一像素，而 `769px` / `1023px` 这两个数在仓库里各被手写过一处，
 * 谁都不知道它们是从哪来的。这里 `ABOVE_COMPACT` / `BELOW_WIDE` 由 `COMPACT_MAX_REM`
 * 与 `WIDE_MIN_REM` 直接算出，改档时只需要改那两个数。
 *
 * 高度是**另一根轴**：`30rem`(480px) 是"这一屏还画得下两栏吗"的下沿（出处：Android
 * 窗口尺寸类的高度 Compact = 高 <480dp，`narrow.css` 里逐字引过），不是宽度档。
 */

/** 紧凑档上沿（含）。= 768px。 */
export const COMPACT_MAX_REM = 48;
/** 宽屏档下沿（含）。= 1024px。 */
export const WIDE_MIN_REM = 64;
/** 矮屏下沿（含）。= 480px。与宽度轴无关。 */
export const TALL_MIN_REM = 30;

/** CSS 媒体查询没有"严格大于"：互补侧的写法就是加一像素。1px = 1/16 rem。 */
const ONE_PX = 1 / 16;

const rem = (n: number): string => {
  // 0.0625 这类值必须原样输出（`48.0625rem`），不许多出尾零 ——
  // 媒体查询里的字面量与门禁的登记值逐字比对，`48.06250rem` 会被判成未登记。
  const rounded = Math.round(n * 1e4) / 1e4;
  return `${String(rounded)}rem`;
};

/** 紧凑档上沿（含）：`(max-width: 48rem)`。 */
export const COMPACT = `(max-width: ${rem(COMPACT_MAX_REM)})`;
/** 紧凑档的互补下限：`(min-width: 48.0625rem)`（= 769px）。 */
export const ABOVE_COMPACT = `(min-width: ${rem(COMPACT_MAX_REM + ONE_PX)})`;
/** 宽屏档的互补上限：`(max-width: 63.9375rem)`（= 1023px）。 */
export const BELOW_WIDE = `(max-width: ${rem(WIDE_MIN_REM - ONE_PX)})`;
/** 宽屏档下沿（含）：`(min-width: 64rem)`。 */
export const WIDE = `(min-width: ${rem(WIDE_MIN_REM)})`;
/** 矮屏：`(max-height: 29.9375rem)`（= 479px）。 */
export const SHORT = `(max-height: ${rem(TALL_MIN_REM - ONE_PX)})`;
/** 够高：`(min-height: 30rem)`（= 480px）。 */
export const TALL = `(min-height: ${rem(TALL_MIN_REM)})`;

/**
 * 详情列"这一屏放得下吗" —— 与 `narrow.css` 那两条隐藏规则**同源**。
 *
 * 三条隐藏规则的并集 = 宽 ≤1023 或（宽 ≥1024 且高 ≤479）
 * ⇒ 放得下 = 宽 ≥1024 **且** 高 ≥480。
 *
 * ⚠️ 两者必须同时成立：只按宽度判的话，1280×400 的窗口（带鱼屏切一半、或浏览器
 * 底部挂了 DevTools）会试着画三栏，而详情列在那种高度里只看得见一个标题。
 */
export const DETAIL_FITS_QUERY = `${WIDE} and ${TALL}`;
