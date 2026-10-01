/**
 * 搜索浮层的**底色**按"这一端有没有背景模糊"来选
 * ==============================================
 *
 * 设计系统把"玻璃"定义成**两半**：半透明 tint + `backdrop-filter: blur()`。
 * 两半缺一不可 —— 没有模糊时，tint 就是一张贴着内容的磨砂纸：
 * 底下的字会**穿过卡片**出现在前景上，对比度取决于"下面恰好排了什么字"，
 * 于是它不再是材质，而是一个随机数发生器。
 *
 * 2026-10-01 在 Android 模拟器上实测到的正是这个形状（`screencap` 留档）：
 * 浮层卡片半透明，而它恰好压住顶栏的两个图标与大号日期标题 ——
 * 截图里"关闭"的 ✕ 与底下那个同步图标**重叠成同一个字形**。
 *
 * 🔴 判据为什么是"有没有 blur"而不是"是不是 web"：
 * `backdrop-filter` 是 CSS 属性，只有渲染到 CSS 里的那一端有（RN 原生没有这个属性，
 * 与 shadow / cubic-bezier 同一类划分）。所以"有没有模糊"恰好由渲染目标决定 ——
 * 本层据此分支，而不是去猜某个具体产品端。
 */

import type { HeytaNativeTokens } from '@heyta/design-system';

/** 有模糊 ⇒ 用玻璃 tint（web / 桌面壳里的 RN-web）；没有 ⇒ 用**不透明**的浮层面。 */
export function panelSurfaceColor(
  tokens: Pick<HeytaNativeTokens, 'material.chrome-tint' | 'color.surface-raised'>,
  hasBackdropBlur: boolean,
): string {
  return hasBackdropBlur
    ? tokens['material.chrome-tint']
    : tokens['color.surface-raised'];
}
