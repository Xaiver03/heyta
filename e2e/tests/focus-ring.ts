/**
 * 键盘焦点环的**共用判据** —— 五份 spec 共用这一份，不许各写一套。
 *
 * ## 为什么要有这个文件
 *
 * 判据的本义是 WCAG 2.4.7（Focus Visible）：**键盘用户看得出焦点在哪**。
 * 它从来没有规定"环必须画在 `outline` 上"。但 2026-11-03 之前全仓只有一种实现
 * （`apps/web/src/styles/app/borderless-controls.css` 里的 `outline: … solid var(--ht-color-ring)`），
 * 于是五份 spec 各自把**实现细节**抄成了判据 —— `outlineStyle !== 'none'`。
 *
 * 产品负责人 2026-11-03 看着对话输入框问「为什么这个对话框还是没有圆角」：
 * **WebKit 的 `outline` 不跟随 `border-radius`**，圆角一上就露出方框。
 * 所以输入类控件的环改成了 `box-shadow`（它天然贴住圆角）。
 * 那一刻起，那五份 `outlineStyle !== 'none'` **量的是机制，不是缺陷**：
 * 环还在画面上（`e2e/test-results/focus-visible-matrix-正对照臂…/test-failed-1.png`
 * 里那圈蓝环清楚可见且跟着圆角走），读数却全红。
 *
 * ⇒ 判据改成**接受两种形态中的任意一种**，两种都指向同一件事"画面上有一圈环"：
 *   ① `outline-style !== 'none'` 且 `outline-width > 0`；
 *   ② `box-shadow` 里有一层**宽度 > 0 的环**。
 *
 * ## 🔴 这条判据保留了牙齿（不是"有阴影就算过"）
 *
 * `box-shadow` 是通用属性，装饰投影、卡片浮起都在用它 —— 只要有阴影也算焦点，
 * 这条判据就退化成恒真（AGENTS §7 元规则 2：一条永远通过的判据比没有判据更糟）。
 * 所以第 ② 形态要求这一层同时满足：
 *   · `inset` 与否不论（环可以画在盒子内侧，见 `--ht-focus-ring-offset` 那段注释），
 *     但**横向/纵向偏移必须为 0、模糊必须为 0** —— 装饰投影几乎总带偏移或模糊
 *     （本仓实测：`rgba(0, 0, 0, 0.1) 0px 4px 12px 0px` 这类一条都不满足）；
 *   · **spread > 0** —— 这就是"环带的宽度"，即全局那一条的 `--ht-border-width-thick`；
 *   · 颜色**必须等于 `--ht-color-ring`**（在浏览器里解析后的值）。
 *     这一条等价于"那个元素上存在 `--ht-color-ring` 的引用"，也把"某个 0 偏移的
 *     装饰描边"挡在外面：换一个颜色的 `0 0 0 2px` 不算焦点环。
 *
 * 反向验证（本轮做过，读数见交付报告）：把全局那一条 `box-shadow` 临时去掉，
 * 这五份 spec 立刻全红 —— 判据量的确实是"画面上有没有环"。
 */

import { expect, type Locator } from '@playwright/test';

/** 一次焦点读数的原始计算值。全部是 `getComputedStyle` 的字面结果。 */
export interface FocusRingReading {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  outlineOffset: string;
  boxShadow: string;
  backgroundColor: string;
  /** `--ht-color-ring` 在本页解析后的颜色（`rgb(r, g, b)`）。 */
  ringColor: string;
}

/** 判"环可见"的结果：哪一层形态、多宽、什么颜色。 */
export interface VisibleFocusRing {
  source: 'outline' | 'box-shadow';
  /** 环画在盒子内侧（`outline-offset` 为负 / `box-shadow: inset`）。 */
  inset: boolean;
  widthPx: number;
  color: string;
}

interface ShadowLayer {
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  inset: boolean;
  /** 这一层的原文，报错时贴出来比只贴数字好认。 */
  raw: string;
}

/** 把颜色归一成可比较的键：`rgba(37, 99, 235, 1)` 与 `rgb(37, 99, 235)` 视为同一个。 */
function colorKey(value: string): string {
  const text = value.trim().toLowerCase();
  const match = text.match(/^rgba?\(([^)]*)\)$/);
  if (match === null) return text;
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter((part) => part.length > 0)
    .map(Number);
  const [r, g, b] = parts;
  const alpha = parts.length > 3 ? parts[3] : 1;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return text;
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

function isTransparent(value: string): boolean {
  const key = colorKey(value);
  return key === 'transparent' || /,\s*0(?:\.0+)?\)$/.test(key);
}

/**
 * 拆 `box-shadow` 的计算值。
 *
 * 计算值形状（Chromium 实测）：`rgb(37, 99, 235) 0px 0px 0px 2px, rgb(255, 255, 255) 0px 0px 0px 1px`
 * —— 颜色在前。⚠️ 颜色自带逗号（`rgba(0, 0, 0, 0.1)`），所以**不能**直接按 `,` 切层。
 */
export function shadowLayers(value: string): ShadowLayer[] {
  const text = value.trim();
  if (text === '' || text === 'none') return [];

  const chunks: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      chunks.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  chunks.push(current);

  return chunks.map((chunk) => {
    const colorMatch = chunk.match(/(rgba?\([^)]*\)|color\([^)]*\)|hsla?\([^)]*\)|transparent|#[0-9a-f]{3,8})/i);
    const color = colorMatch === null ? 'currentcolor' : colorMatch[0];
    const rest = colorMatch === null ? chunk : chunk.replace(colorMatch[0], ' ');
    const lengths = (rest.match(/-?[\d.]+px/g) ?? []).map((part) => Number.parseFloat(part));
    return {
      color,
      offsetX: lengths[0] ?? 0,
      offsetY: lengths[1] ?? 0,
      blur: lengths[2] ?? 0,
      spread: lengths[3] ?? 0,
      inset: /\binset\b/i.test(rest),
      raw: chunk.trim(),
    };
  });
}

/** 判"这个元素上画着一圈可见的键盘焦点环"。没有就返回 `null`。 */
export function visibleFocusRing(reading: FocusRingReading): VisibleFocusRing | null {
  // ① `outline` 形态（按钮/菜单/链接这一族仍走这一条）。
  //    ⚠️ `outline-style: none` 时 Chromium 仍把 `outline-width` 报成 `medium`（= 3px），
  //    所以必须先看 style，否则"没画"会被读成"画了一条 3px"（本仓踩过）。
  const outlineWidth = Number.parseFloat(reading.outlineWidth);
  if (reading.outlineStyle !== 'none' && Number.isFinite(outlineWidth) && outlineWidth > 0) {
    return {
      source: 'outline',
      inset: Number.parseFloat(reading.outlineOffset || '0') < 0,
      widthPx: outlineWidth,
      color: reading.outlineColor,
    };
  }

  // ② `box-shadow` 形态（输入类控件，2026-11-03 起）。
  const ringColor = colorKey(reading.ringColor);
  for (const layer of shadowLayers(reading.boxShadow)) {
    if (layer.offsetX !== 0 || layer.offsetY !== 0 || layer.blur !== 0) continue;
    if (!(layer.spread > 0)) continue;
    if (isTransparent(layer.color)) continue;
    if (colorKey(layer.color) !== ringColor) continue;
    return { source: 'box-shadow', inset: layer.inset, widthPx: layer.spread, color: layer.color };
  }
  return null;
}

/**
 * 环带外扩多少像素 —— 供"四条边都画得出来"那条几何判据用。
 *
 * `outline` 的环带 = `outline-offset + outline-width`（offset 为负就是内缩）；
 * `box-shadow` 的环带 = spread（只有环形态的层会走到这里，偏移与模糊都已为 0）。
 * 画在盒子内侧的环（`inset`）不向盒子外扩，所以是 0。
 */
export function ringBandPaddingPx(reading: FocusRingReading): number {
  const ring = visibleFocusRing(reading);
  if (ring === null) return 0;
  if (ring.source === 'outline') {
    return Number.parseFloat(reading.outlineOffset || '0') + ring.widthPx;
  }
  return ring.inset ? 0 : ring.widthPx;
}

/**
 * 环带之外的**装饰性**阴影层 —— 用来守住"无描边/无装饰投影"这条产品口径。
 *
 * 放行的只有**环公式那一种形状**：`0 0 0 Npx <color>`（偏移 0、模糊 0、spread > 0）。
 * 输入框的环就是这条公式的两层（`0 0 0 2px 环色` + `0 0 0 offset 底色`），
 * 两层都在放行之列；任何带偏移或模糊的层（`0 4px 12px rgba(0,0,0,.1)` 这种浮起投影）
 * 都算装饰，会被这条判据抓出来。
 */
export function decorativeShadowLayers(value: string): string[] {
  return shadowLayers(value)
    .filter((layer) => !(layer.offsetX === 0 && layer.offsetY === 0 && layer.blur === 0 && layer.spread > 0))
    .map((layer) => layer.raw);
}

/** 读一个 locator 的焦点计算值（含 `--ht-color-ring` 在本页的解析值）。 */
export async function readFocusRing(locator: Locator): Promise<FocusRingReading> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    // 把 token 解析成具体颜色：`--ht-color-ring` 是 `var(--ht-blue-600)` 链，
    // 直接读 custom property 拿到的是空串，必须让浏览器先解析一层。
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;color:var(--ht-color-ring)';
    document.body.appendChild(probe);
    const ringColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      boxShadow: style.boxShadow,
      backgroundColor: style.backgroundColor,
      ringColor,
    };
  });
}

/** 读 + 断言：这个 locator 上必须画着一圈可见的键盘焦点环。 */
export async function expectFocusRing(
  locator: Locator,
  options: { minWidthPx?: number; message?: string } = {},
): Promise<VisibleFocusRing> {
  const reading = await readFocusRing(locator);
  const ring = visibleFocusRing(reading);
  expect(
    ring,
    `${options.message ?? '键盘焦点环不见了 ⇒ 键盘用户看不出焦点在哪（WCAG 2.4.7）'}。`
      + `判据接受两种形态：① outline-style ≠ none 且 outline-width > 0；`
      + `② box-shadow 里有一层 0 偏移/0 模糊/spread > 0 且颜色 = --ht-color-ring 的环。`
      + `读数 ${JSON.stringify(reading)}`,
  ).not.toBeNull();
  if (options.minWidthPx !== undefined) {
    expect(
      ring!.widthPx,
      `焦点环只有 ${String(ring!.widthPx)}px（${ring!.source}），不足 ${String(options.minWidthPx)}px`,
    ).toBeGreaterThanOrEqual(options.minWidthPx);
  }
  return ring!;
}
