/**
 * 热力图 / 年度视图的主题色
 * ==========================
 *
 * `react-activity-calendar` 的 `theme` prop。习惯页的热力图与成长页的年度视图
 * 用的是同一套色阶，所以只留这一份 —— 两份一定会漂移，而这里的漂移代价是崩溃。
 *
 * 🔴 **必须是 `cssVar(...)`（即 `var(--ht-…)`），不能是裸的 token 名。**
 *
 * 这个库在渲染前会逐个校验主题色：
 *
 * ```js
 * if (typeof window !== 'undefined' && !CSS.supports('color', c)) {
 *   throw new Error(`Invalid color "${c}" passed.`);
 * }
 * ```
 *
 * 而裸的 `--ht-color-primary` **不是一个颜色值**。实测（真 Chromium）：
 *
 * | 取值 | `CSS.supports('color', …)` |
 * |---|---|
 * | `--ht-color-primary` | **false** ← 库会抛异常 |
 * | `var(--ht-color-primary)` | true |
 * | `#2563EB` | true |
 *
 * 抛异常发生在**组件渲染期间**，而应用没有错误边界 —— 实测点进那个视图，
 * **整个应用被打白**（`<body>` 只剩 10 个字符），控制台只有一句
 * `Invalid color "--ht-color-surface-sunken" passed.`。
 * 这个错误先前一直没被发现，是因为**习惯页的日历在建了第一条习惯之后才渲染** ——
 * 空态把它挡住了，而没有任何测试渲染过这个视图。
 *
 * `var()` 是合法的：替换发生在 computed-value 阶段，声明在 parse 阶段就有效。
 * 并且 SVG 的 `fill` **属性**里浏览器会真的解析它（实测 `fill="var(--c)"`
 * 计算得到 `rgb(37, 99, 235)`），所以色值仍然只有 `tokens.css` 一个来源，
 * 不需要把颜色抄成裸值（那也正是设计门禁要拦的东西）。
 *
 * ⚠️ 空档用 `color.heat-0` —— 它就是为这一格准备的，亮/暗各有一套取值
 * （亮 `slate-100`、暗 `#16203a`）。不要拿 `surface-sunken` 顶替：暗色里它比卡片底还暗，
 * 空格子会看不见。
 *
 * ⚠️ 四档活动色用 `heat-1..4`，不要全部用 `primary`：色阶的意义就是**一眼看出多少**，
 * 四档同色等于把"这周很密"和"只打过一次卡"画成同一个样子。
 */

import { cssVar } from '@heyta/design-system';

export function heatmapTheme(): { light: string[]; dark: string[] } {
  const levels = [
    cssVar('color.heat-0'),
    cssVar('color.heat-1'),
    cssVar('color.heat-2'),
    cssVar('color.heat-3'),
    cssVar('color.heat-4'),
  ];
  /**
   * 两份内容相同是**有意的**，不是漏抄。
   *
   * 色阶本身就是同一组语义 token，而它们**自己**会跟着主题变
   * （`tokens.css` 的暗色段重定义了 `--ht-color-heat-*`）。
   * `light` / `dark` 是库要求的形状，用来在没有 `matchMedia` 时先给出一个静态值；
   * 有 CSS 变量参与之后，实际颜色由浏览器实时解析。
   */
  return { light: [...levels], dark: [...levels] };
}

/**
 * 日历文案。
 *
 * 🔴 这个库的默认文案是**英文**的，而且它会直接画到界面上：
 * 截图里出现过 `Oct Nov Dec …`、`1 activities in 2025`、`Less / More`。
 * 界面文案门禁只看我们自己的源码，看不见库生成的字符串 ——
 * 所以这一条只能靠**真的看一眼**才发现。
 */
export function activityLabels(totalCount: string): {
  months: string[];
  totalCount: string;
  legend: { less: string; more: string };
} {
  return {
    months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    // 调用方自己写这句 —— 习惯页是 90 天、成长页是滚动一年，
    // 用同一句"最近一年"会在其中一个页面上说谎。
    totalCount,
    legend: { less: '少', more: '多' },
  };
}