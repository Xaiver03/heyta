/**
 * heyta 品牌 mark 的几何真源（一份，放在 L0）。
 *
 * ## 2026-11-27：字形从旧「h」三矩形，改为 D1「错位双柱 · 并行向上」
 *
 * 旧字形是三块圆角矩形拼成的「h」，辨识度低。新字形：
 *   - 两块圆角竖柱：左矮右高、底部齐平（两柱「错位」= 并行向上）；
 *   - 中间一块斜向连接块（平行四边形），把两柱连成「一起向上」的动势。
 * 这是一枚符号化标记，刻意**不含对勾、不含圆环**，与滴答清单(TickTick 蓝环+对勾)彻底区分。
 *
 * ## 消费方式（不变）
 *
 * 各端图标 / 首屏动画 / 落地页 favicon 全部从本文件派生：
 *   `scripts/gen-app-icons.mjs`（PWA/Android/iOS/Windows/macOS/favicon）、
 *   `apps/web/scripts/gen-pwa.mjs`、`scripts/gen-boot-splash.mjs`。
 * 🔴 几何只此一份，任何消费方都**不要**再手抄坐标。
 *
 * 🔴 这里不写任何色值：颜色属于 token（tokens.css 是唯一事实源），本文件只管几何。
 * 🔴 字形用 rect / polygon 表达，**不用 `<text>`**：rsvg-convert 缺字体时会静默丢字形。
 */

/** 画布边长（px）。所有坐标都相对它，缩放由 `scale/offset` 决定。 */
export const BRAND_MARK_CANVAS = 512;

/** 圆角方底那一档的圆角半径（与历史取值一致）。 */
export const BRAND_MARK_RADIUS = 112;

/** 变换：先 `x*scale` 再 `+offset`（书写顺序与历史实现一致，避免浮点漂移）。 */
export interface BrandMarkTransform {
  /** 字形相对画布的缩放。 */
  scale: number;
  /** 缩放后字形左上角的画布内偏移（与 scale 配套，使字形居中）。 */
  offset: number;
}

type RectShape = { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number };
type PolygonShape = { kind: 'polygon'; points: ReadonlyArray<readonly [number, number]> };
/** 字形由若干 rect / polygon 组成（D1：两竖柱 + 一斜块）。 */
export type GlyphShape = RectShape | PolygonShape;

/**
 * 字形形状（画布坐标，512）：左柱 136–218（矮，y 196–410），右柱 294–376（高，y 104–410），
 * 底部均为 410；斜块 210–302、y 232–374 向右上倾斜，两端各嵌入柱内 8px 消除接缝。整体水平居中于 256。
 */
const GLYPH_SHAPES: ReadonlyArray<GlyphShape> = [
  { kind: 'rect', x: 136, y: 196, width: 82, height: 214, rx: 41 }, // 左柱（矮）
  { kind: 'rect', x: 294, y: 104, width: 82, height: 306, rx: 41 }, // 右柱（高）
  { kind: 'polygon', points: [[210, 302], [302, 232], [302, 304], [210, 374]] }, // 斜向连接块
];

/** 铺满画布（不缩不放）。 */
export const BRAND_MARK_SAFE = { scale: 1, offset: 0 } as const;

/** PWA `maskable` 安全区：内容落在中心 80%（512*0.72，留边 72）。 */
export const BRAND_MARK_PWA_SAFE = { scale: 0.72, offset: 72 } as const;

/** Android 自适应图标安全区：中心 66dp/108dp ≈ 0.61，取 0.60 留余量。 */
export const BRAND_MARK_ANDROID_SAFE = { scale: 0.6, offset: (BRAND_MARK_CANVAS * (1 - 0.6)) / 2 } as const;

/** 一个字形元素（rect 或 polygon），attrs 为已按 transform 计算好的画布坐标属性。 */
export interface GlyphElement {
  tag: 'rect' | 'polygon';
  attrs: Record<string, string | number>;
}

function tx(x: number, t: BrandMarkTransform): number {
  return t.offset + x * t.scale;
}

/** 把字形形状映射到变换后的画布坐标，返回 rect/polygon 元素列表。 */
export function brandMarkElements(t: BrandMarkTransform): GlyphElement[] {
  return GLYPH_SHAPES.map((s): GlyphElement => {
    if (s.kind === 'rect') {
      return {
        tag: 'rect',
        attrs: {
          x: tx(s.x, t),
          y: tx(s.y, t),
          width: s.width * t.scale,
          height: s.height * t.scale,
          rx: s.rx * t.scale,
        },
      };
    }
    return {
      tag: 'polygon',
      attrs: { points: s.points.map(([x, y]) => `${tx(x, t)},${tx(y, t)}`).join(' ') },
    };
  });
}

/**
 * 只返回矩形部分（旧 API，供安全区测试与兼容消费方使用）。
 * ⚠️ 斜块是 polygon，不在此列；需要完整字形请用 {@link brandMarkElements} / {@link brandMarkGlyphMarkup}。
 */
export function brandMarkRects(
  t: BrandMarkTransform,
): ReadonlyArray<{ x: number; y: number; width: number; height: number; rx: number }> {
  return GLYPH_SHAPES.filter((s): s is RectShape => s.kind === 'rect').map((s) => ({
    x: tx(s.x, t),
    y: tx(s.y, t),
    width: s.width * t.scale,
    height: s.height * t.scale,
    rx: s.rx * t.scale,
  }));
}

/** 完整字形的 SVG 元素串（rect + polygon），已按 transform 计算并带 fill。 */
export function brandMarkGlyphMarkup(t: BrandMarkTransform, fill: string): string {
  return brandMarkElements(t)
    .map((el) => {
      const attrs = Object.entries(el.attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${el.tag} ${attrs} fill="${fill}"/>`;
    })
    .join('\n    ');
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

/** 完整图标：底板 + 字形（rect + polygon）。 */
export function brandMarkSvg(opts: BrandMarkOptions): string {
  const glyph = brandMarkGlyphMarkup(opts, opts.glyph);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.size}" height="${opts.size}" viewBox="0 0 ${opts.size} ${opts.size}">
  <rect width="${opts.size}" height="${opts.size}" rx="${opts.radius}" fill="${opts.background}"/>
  <g>
    ${glyph}
  </g>
</svg>
`;
}

/** 只画字形（底透明）。自适应图标的 foreground / monochrome 层用它。 */
export function brandMarkGlyphSvg(size: number, t: BrandMarkTransform, glyph: string): string {
  const markup = brandMarkGlyphMarkup(t, glyph);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${BRAND_MARK_CANVAS} ${BRAND_MARK_CANVAS}">
  <g>
    ${markup}
  </g>
</svg>
`;
}

/** 圆底版（Android `roundIcon`）：圆形底板 + 安全区字形。 */
export function brandMarkCircleSvg(opts: BrandMarkOptions): string {
  const glyph = brandMarkGlyphMarkup(opts, opts.glyph);
  const r = opts.size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.size}" height="${opts.size}" viewBox="0 0 ${opts.size} ${opts.size}">
  <circle cx="${r}" cy="${r}" r="${r}" fill="${opts.background}"/>
  <g>
    ${glyph}
  </g>
</svg>
`;
}
