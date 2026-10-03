/**
 * 移动端栅格化的**换算**（W7）：纯函数，node 里能跑。
 * ==================================================================
 *
 * 🔴 为什么单独一个文件而不是留在 `card-export.tsx` 里：本壳**没有 RN 组件测试栈**
 * （`@testing-library/react-native` 不在依赖里，引它要先过 AGENTS §3.1 + §3.2 两道门），
 * 所以判据只能是"值导入纯模块 + 扫源码查接线"。而这几条恰好是**最该被真跑**的判据：
 * "iOS 与 Android 交给 `toDataURL` 的那对数单位不同"这件事，写进注释里就只是一句话，
 * 跑出来才是判据。把纯函数留在带 `react-native` 顶层 import 的文件里，node 一 import 就炸，
 * 于是"能测的那半"永远测不到。
 *
 * ## 这里唯一的产品取值都来自契约
 *
 * `EXPORT_CARD_SCALE` / `EXPORT_CARD_EDGE_PX` / `EXPORT_CARD_HEIGHT_PX` 全部来自
 * `@heyta/shared-schema`。本文件里出现的字面数只有单位换算的 `1`，没有一个设计取值。
 */

import { EXPORT_CARD_EDGE_PX, EXPORT_CARD_HEIGHT_PX, EXPORT_CARD_SCALE } from '@heyta/shared-schema';
import { estimateAdvance, wrapCardText, type CardExportDrawOp } from '@heyta/ui/node';

/**
 * 密度 → "语义 token → 该端绘制单位"的倍率。
 *
 * web 那一端画布就是像素，倍率是 `EXPORT_CARD_SCALE`；RN 的 SVG 用户单位是 dp，
 * 而 `dp × density = px` ⇒ 倍率要除掉 density，否则字会比屏幕上大 density 倍。
 */
export function rasterScaleFor(density: number): number {
  return EXPORT_CARD_SCALE / density;
}

/**
 * 该端 `toDataURL` 要的那对数 —— **单位随平台不同**，这是本单最容易错的一处。
 *
 * · Android：`SvgView.java:365` 的 `Bitmap.createBitmap(width, height, …)` 用的是**像素**
 *   ⇒ 直接交契约那一对数。
 * · iOS：`RNSVGSvgView.mm` 的 `UIGraphicsImageRenderer -initWithSize:` 用的是**点**，
 *   而它的默认 `scale` 是屏幕 scale ⇒ 必须交版面自己的单位（dp 与 pt 同数），
 *   由渲染器按 density 乘回像素。
 *
 * ⚠️ 两端"传错"的表现**不是崩溃**，而是导出一张尺寸不对的图，而屏幕上一切正常 ——
 * 所以这条判据不看界面，看的是这里返回值与契约的关系。
 */
export function rasterRequestFor(
  os: 'android' | 'ios' | string,
  layoutWidth: number,
  layoutHeight: number,
): { width: number; height: number } {
  return os === 'android'
    ? { width: EXPORT_CARD_EDGE_PX, height: EXPORT_CARD_HEIGHT_PX }
    : { width: layoutWidth, height: layoutHeight };
}

/** 一条文字指令在该端要画出的每一行（含坐标）。 */
export interface CardTextLine {
  readonly line: string;
  readonly x: number;
  readonly y: number;
}

/**
 * 折行 + 行位。
 *
 * 🔴 折行只走共享的 `wrapCardText`，本端只贡献尺子（`estimateAdvance`）。
 * RN 侧那把尺子是**估算** —— `react-native-svg` 的 `Text` 既没有 `numberOfLines`
 * 也没有同步测量 API，这条差别登记为 **W7-G4**（超长标题在图上的断行位置
 * 可能与屏上不同；不影响尺寸判据）。
 *
 * 🔴 多行必须展开成**多个** `<Text>` 元素：RNSVG 的 Text 不做流式布局，
 * 两行塞进同一个元素会叠在同一条基线上（表现是标题糊成一团，尺寸判据照样绿）。
 *
 * 基线与 web 那一端**同一条规则**：每行在自己的行盒里垂直居中
 * （canvas 侧 `textBaseline='middle'` + `y + i*lineHeight + lineHeight/2`）。
 */
export function cardTextLinesFor(op: CardExportDrawOp): readonly CardTextLine[] {
  const fontSize = op.fontSize ?? 0;
  const lineHeight = op.lineHeight ?? fontSize;
  const lines = wrapCardText(estimateAdvance(fontSize), op.text ?? '', op.width, op.maxLines ?? 1);
  return lines.map((line, index) => ({
    line,
    x: op.x,
    y: op.y + index * lineHeight + lineHeight / 2,
  }));
}
