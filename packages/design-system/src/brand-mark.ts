/**
 * heyta 品牌 mark 的**几何真源**（一份，放在 L0）。
 *
 * ## 为什么必须有这个文件
 *
 * 2026-10-04 实测：品牌「h」图标的几何原本只写在 `apps/web/scripts/gen-pwa.mjs`
 * 里，而各端要图标只有两条路 —— 要么**手抄一份路径数据**（落地页的
 * `public/favicon.svg` 就是这一条：它自己画了一个圆底 + 描边 h，于是站内其实
 * 存在两枚不同的 mark），要么**用系统/脚手架默认图**（Android 的
 * `mipmap` 各密度目录里的 ic_launcher.png 至今还是 React Native 模板那张青色机器人）。
 *
 * `apps/landing/src/components/BrandMark.tsx` 的文件头把这条纪律写得很清楚：
 * 「**两份几何一定会漂移**」，而且它点名要求「将来若真的需要一份静态 SVG，
 * **从本组件导出**，不要再手抄一份路径数据」。这个模块就是那个"一份"。
 *
 * ## 消费方式
 *
 * ```ts
 * import { brandMarkSvg, BRAND_MARK_CANVAS, BRAND_MARK_PWA_SAFE } from '@heyta/design-system';
 * const svg = brandMarkSvg({
 *   size: 512,
 *   radius: BRAND_MARK_RADIUS,
 *   ...BRAND_MARK_PWA_SAFE,
 *   background: tokens['color.primary'],   // 🔴 色值一律由调用方从 token 传进来
 *   glyph: tokens['color.on-primary'],
 * });
 * ```
 *
 * 🔴 **这里不写任何色值**。颜色属于 token（`packages/design-system/src/tokens.css`
 * 是唯一事实源），几何才是本文件的职责。生成脚本把 token 值当参数传进来，
 * 于是"改一次主色 ⇒ 全端图标跟着变"仍然成立，而这个模块也不会变成第二份配色表。
 *
 * 🔴 **字形是矩形，不是 `<text>`**：`rsvg-convert` 在没装对应字体的机器上会把
 * 文字**静默丢掉**（产出一张没有字形的图，而不是报错）。这条来自 gen-pwa 的
 * 实测，搬到所有栅格化路径上。
 */

/** 画布边长（px）。所有坐标都相对它，缩放由 `scale/offset` 决定。 */
export const BRAND_MARK_CANVAS = 512;

/** 圆角方底那一档的圆角半径（与 `icons/icon.svg` 历史取值一致）。 */
export const BRAND_MARK_RADIUS = 112;

/**
 * 「h」的三块：左竖（带升部）、右竖、横杠。
 * 坐标基于 {@link BRAND_MARK_CANVAS}，`rx` 统一由 {@link GLYPH_RADIUS} 给。
 */
const GLYPH_BARS = [
  { x: 140, y: 120, width: 52, height: 272 }, // 左竖（带升部）
  { x: 320, y: 228, width: 52, height: 164 }, // 右竖
  { x: 140, y: 228, width: 232, height: 48 }, // 横
] as const;

/** 每块端的圆帽半径。字形是"粗描边的 h"，圆角让它读起来像字标而不是柱状图。 */
const GLYPH_RADIUS = 22;

/**
 * 铺满画布（不缩不放）—— 各平台通用 launcher 圆角方块那一档用的就是它。
 * 单独命名是因为"这一档没有安全区"这件事本身需要被写下来：
 * 底板会跟着一起被系统遮罩切圆角，而字形不会越界（512 画布上字形最远到 372）。
 */
export const BRAND_MARK_SAFE = { scale: 1, offset: 0 } as const;

/**
 * PWA `maskable` 的安全区：内容必须落在中心 **80%**，
 * 否则被浏览器/系统的圆形或方形遮罩切掉字形（512×0.72 = 368.8，留边 71.6→72）。
 */
export const BRAND_MARK_PWA_SAFE = { scale: 0.72, offset: 72 } as const;

/**
 * Android 自适应图标的安全区：可被遮罩保留的区域只有中心 **66dp / 108dp ≈ 0.61**，
 * 比 PWA 那一档更收。取 0.60 留余量。
 */
export const BRAND_MARK_ANDROID_SAFE = { scale: 0.6, offset: (BRAND_MARK_CANVAS * (1 - 0.6)) / 2 } as const;

export interface BrandMarkTransform {
  /** 字形相对画布的缩放。 */
  scale: number;
  /** 缩放后字形左上角的画布内偏移（与 scale 配套，使字形居中）。 */
  offset: number;
}

/**
 * 把三块矩形映射到任意画布坐标。
 *
 * ⚠️ 表达式的**书写顺序**与 gen-pwa 的历史实现逐字一致
 * （`offset + x * scale`，而不是 `(x + offset) * scale`）—— 浮点在这两种写法下
 * 会差出最后一位，而 gen-pwa 的产物是 `check:pwa` **逐字节**对账的提交物。
 */
export function brandMarkRects(
  transform: BrandMarkTransform,
): ReadonlyArray<{ x: number; y: number; width: number; height: number; rx: number }> {
  return GLYPH_BARS.map((bar) => ({
    x: transform.offset + bar.x * transform.scale,
    y: transform.offset + bar.y * transform.scale,
    width: bar.width * transform.scale,
    height: bar.height * transform.scale,
    rx: GLYPH_RADIUS * transform.scale,
  }));
}

/** 只画字形（底透明）。自适应图标的 foreground / monochrome 层用它。 */
export function brandMarkGlyphSvg(
  size: number,
  transform: BrandMarkTransform,
  glyph: string,
): string {
  const s = size / BRAND_MARK_CANVAS;
  const rects = brandMarkRects(transform)
    .map(
      (b) =>
        `<rect x="${b.x * s}" y="${b.y * s}" width="${b.width * s}" height="${b.height * s}" rx="${b.rx * s}" fill="${glyph}"/>`,
    )
    .join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g>
    ${rects}
  </g>
</svg>
`;
}

export interface BrandMarkOptions extends BrandMarkTransform {
  /** 画布边长（px）。 */
  size: number;
  /** 底板圆角；`0` = 满幅方底（iOS / MSIX 贴图交给系统遮罩）。 */
  radius: number;
  /** 底板色（必须是 token 值，不要在这里写字面量）。 */
  background: string;
  /** 字形色。 */
  glyph: string;
}

/**
 * 完整图标：底板 + 字形。
 *
 * 🔴 输出的字符串形状与 `gen-pwa.mjs` 历史实现**逐字节相同**，这不是巧合而是判据：
 * `check:pwa` 把 `icons/icon.svg` 与 `icons/icon-maskable.svg` 当提交物逐字比对，
 * 抽取几何这一步必须**不改变任何产物字节**（改了就叫重构混进行为变更）。
 */
export function brandMarkSvg(opts: BrandMarkOptions): string {
  const rects = brandMarkRects(opts)
    .map(
      (b) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${b.rx}" fill="${opts.glyph}"/>`,
    )
    .join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.size}" height="${opts.size}" viewBox="0 0 ${opts.size} ${opts.size}">
  <rect width="${opts.size}" height="${opts.size}" rx="${opts.radius}" fill="${opts.background}"/>
  <g>
    ${rects}
  </g>
</svg>
`;
}

/** 圆底版（Android `roundIcon`）：圆形底板 + 安全区字形。 */
export function brandMarkCircleSvg(opts: BrandMarkOptions): string {
  const rects = brandMarkRects(opts)
    .map(
      (b) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${b.rx}" fill="${opts.glyph}"/>`,
    )
    .join('\n    ');
  const r = opts.size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.size}" height="${opts.size}" viewBox="0 0 ${opts.size} ${opts.size}">
  <circle cx="${r}" cy="${r}" r="${r}" fill="${opts.background}"/>
  <g>
    ${rects}
  </g>
</svg>
`;
}
