/**
 * 品牌 mark 的几何真源测试
 * =========================
 *
 * ## 它钉的是哪件事
 *
 * `brand-mark.ts` 声称自己是「h」这一枚图形的**唯一一份几何**，而各端图标
 * （PWA / Android / iOS / Windows / macOS / 落地页）都从它栅格化。
 * "唯一一份"是一个**可以被证伪的断言**，所以这里证伪它：
 *
 *   1. **与提交物逐字节相等**。`apps/web/public/icons/icon.svg` 与
 *      `icon-maskable.svg` 是仓库里已经躺着的产物（且被 `check:pwa` 逐字对账）。
 *      本测试用同一组参数重算一遍，要求**一字不差**。
 *      🔴 这一条同时管住两件事：抽取几何这一步没改变产物（重构不是行为变更），
 *      以及今后**任何**改动 brand-mark 几何的人必须同时改动产物 —— 否则红。
 *      没有这条，"几何只有一份"就只是一句注释。
 *
 *   2. **安全区是真的算过的**。自适应图标 / maskable 那两档缩放的动机是系统遮罩
 *      会裁掉画布外圈；如果字形有一角落在保留圆之外，用户看到的就是一枚被切掉的
 *      「h」（Android 上尤其明显，因为遮罩形状由启动器决定、开发者看不到）。
 *      这里按 Android 的 66dp/108dp 与 PWA 的中心 80% 各自算一遍最远角距离。
 *
 *   3. **两档不可能是同一张图**。若 1 和 2 的输入被谁写成同一个常量，
 *      上面两条会一起变成装饰 —— 所以正面断言它们**不相等**。
 *
 * ## 为什么色值不在这里的判据范围内
 *
 * 颜色来自 token（`tokensForTheme('light')`），token 的对比度与取值由
 * `tokens.spec.ts` / 对比度测试管。本文件只管几何，所以传色值是**输入**而不是断言。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BRAND_MARK_ANDROID_SAFE,
  BRAND_MARK_CANVAS,
  BRAND_MARK_PWA_SAFE,
  BRAND_MARK_RADIUS,
  BRAND_MARK_SAFE,
  brandMarkRects,
  brandMarkSvg,
} from '../src/brand-mark.js';
import { tokensForTheme } from '../src/native.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓库根（本文件在 packages/design-system/tests/ 下，所以要退三层）。 */
const ROOT = resolve(HERE, '../../..');

const light = tokensForTheme('light');
const PRIMARY = light['color.primary'];
const ON_PRIMARY = light['color.on-primary'];

const WebIcons = join(ROOT, 'apps/web/public/icons');
const committed = (name: string) => readFileSync(join(WebIcons, name), 'utf8');

describe('品牌 mark 几何只有一份', () => {
  it('重算的 icon.svg 与提交物逐字节相同', () => {
    const svg = brandMarkSvg({
      size: BRAND_MARK_CANVAS,
      radius: BRAND_MARK_RADIUS,
      ...BRAND_MARK_SAFE,
      background: PRIMARY,
      glyph: ON_PRIMARY,
    });
    expect(svg).toBe(committed('icon.svg'));
  });

  it('重算的 icon-maskable.svg 与提交物逐字节相同', () => {
    const svg = brandMarkSvg({
      size: BRAND_MARK_CANVAS,
      radius: 0,
      ...BRAND_MARK_PWA_SAFE,
      background: PRIMARY,
      glyph: ON_PRIMARY,
    });
    expect(svg).toBe(committed('icon-maskable.svg'));
  });

  it('铺满档与 maskable 档不是同一张图（挡"两档写成同一个常量"）', () => {
    const plain = brandMarkSvg({
      size: BRAND_MARK_CANVAS,
      radius: BRAND_MARK_RADIUS,
      ...BRAND_MARK_SAFE,
      background: PRIMARY,
      glyph: ON_PRIMARY,
    });
    const maskable = brandMarkSvg({
      size: BRAND_MARK_CANVAS,
      radius: 0,
      ...BRAND_MARK_PWA_SAFE,
      background: PRIMARY,
      glyph: ON_PRIMARY,
    });
    expect(plain).not.toBe(maskable);
  });
});

describe('系统遮罩的安全区', () => {
  /** 画布中心。 */
  const C = BRAND_MARK_CANVAS / 2;

  /** 一块矩形里离中心最远的角点，到中心的距离。 */
  function farthestCornerDistance(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): number {
    // 🔴 元组标注不是仪式：`noUncheckedIndexedAccess` 下 `[rect.x, rect.y]` 推断成
    // `number[]`，下面解构出的 `x`/`y` 就是 `number | undefined`，`pnpm -r typecheck` 会红。
    const corners: [number, number][] = [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y],
      [rect.x, rect.y + rect.height],
      [rect.x + rect.width, rect.y + rect.height],
    ];
    return Math.max(
      ...corners.map(([x, y]) => Math.hypot(x - C, y - C)),
    );
  }

  it('PWA maskable：字形整块落在中心 80% 的方形安全区内', () => {
    // Chrome/Android maskable 规范：内容必须在中心 80% 内，外圈可被切成圆/方/叶形。
    // 判据用**最远角距离**：一块矩形的四个角都在内接圆里，则整块都在（圆比方严）；
    // 而中心 80% 那一档真正要防的是"贴边的笔被切成直角"，所以圆的半径取 80% 的一半。
    const half = (BRAND_MARK_CANVAS * 0.8) / 2;
    for (const rect of brandMarkRects(BRAND_MARK_PWA_SAFE)) {
      // 允许 0.5px 的栅格化余量
      expect(farthestCornerDistance(rect)).toBeLessThanOrEqual(half + 0.5);
    }
  });

  it('Android 自适应：字形整块落在 66dp/108dp 的保留圆内', () => {
    // Android 官方：可被遮罩保留的区域是中心 66dp（画布 108dp）。
    // 换算到 512 画布：66/108 × 512 / 2 = 保留圆半径。
    const keepRadius = (66 / 108) * BRAND_MARK_CANVAS * 0.5;
    for (const rect of brandMarkRects(BRAND_MARK_ANDROID_SAFE)) {
      expect(farthestCornerDistance(rect)).toBeLessThanOrEqual(keepRadius);
    }
  });

  it('铺满档的字形不会越出画布（越界会被栅格器裁掉，读起来像缺笔）', () => {
    for (const rect of brandMarkRects(BRAND_MARK_SAFE)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(BRAND_MARK_CANVAS);
      expect(rect.y + rect.height).toBeLessThanOrEqual(BRAND_MARK_CANVAS);
    }
  });
});
