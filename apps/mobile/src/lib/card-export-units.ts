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

/**
 * 栅格化"等多久算没等到"。
 *
 * 🔴 为什么需要这条常量：`toDataURL` 的回调**可以永远不来**。iOS 侧
 * `RNSVGSvgViewModule.mm:57-59` 与 `:45-48` 那两条分支都是
 * `RCTLogError(...) + return` —— 既不回调也不报错。04 10:0x 在 iPhone 模拟器上
 * 量到的正是这一档：点「导出成品图」之后既没有图、也没有那一句失败文案，
 * 界面上什么都没错，而 Promise 永远悬着。
 * 15 秒取的是"比任何真机栅格化都宽、又短到人不回头就能等到"：Android 那趟
 * 从点击到落盘是秒级（`apps/mobile/evidence/card-export/README.md` 记的 11 项里
 * 判据②是"点之后立刻数得到文件"）。
 */
export const RASTERIZE_SETTLE_MS = 15_000;

export type RasterizeOutcome =
  | { readonly fired: true; readonly base64: string }
  | { readonly fired: false; readonly reason: 'timeout' | 'threw' };

/**
 * 等一帧，再去问原生要图。**不是"拍一个毫秒数"，是等一个事件。**
 *
 * 🔴 为什么需要它（2026-10-04 iPhone 模拟器实测）：React 的 effect 跑在 commit 之后，
 * 但**原生挂载事务刷到主队列之前**。那一刻 `RNSVGSvgViewModule.mm:31` 的
 * `viewForReactTag:` 返回 nil，日志是
 * `Invalid svg returned from registry, expecting RNSVGSvgView, got: (null)`，
 * 而那条分支是 `RCTLogError(...) + return` —— **既不回调也不报错**，
 * 于是 JS 侧只能等到下面那条 `rasterize-timeout`。
 * 让出一帧等于把"挂上了没有"这个问题交给调度器回答，而不是我自己猜一个时长。
 *
 * `nextFrame` 是**注入**的（不直接摸全局 `requestAnimationFrame`）：
 * 这个文件要在 node 里被判定（本壳没有 RN 组件测试栈），注入进来才判得动
 * "同一帧里没调、下一帧才调"这件事。
 */
export function afterNextFrame(nextFrame: (run: () => void) => void): Promise<void> {
  return new Promise<void>((resolve) => nextFrame(() => resolve()));
}

/**
 * 让帧的**预算**。
 *
 * 与 `RASTERIZE_SETTLE_MS` 分开是因为它们兜的是两段不同的等待：那一个管"原生回调可以永远不来"，
 * 这一个管"`requestAnimationFrame` 在**后台不触发**"。取 1 秒的依据：一帧是 16.7 ms，
 * 而 RN 的调度器让不出帧只可能是"整页被挂起"，那种情况下 1 秒与 5 秒对用户的体感没有区别，
 * 但 1 秒不会让人以为"应用卡住了"。
 */
export const NEXT_FRAME_BUDGET_MS = 1_000;

/**
 * 让一帧，但**等不到就返回 false**。
 *
 * 🔴 为什么不能只有 `afterNextFrame`：那个 Promise 在后台**永远不 resolve**（rAF 不触发），
 * 于是它兜不住自己 —— 表现是"点了没反应"，而回到前台之后它又会**突然**跑完，
 * 用户看到的是"几秒后突然弹出一个分享面板"。这一条挂在 `afterNextFrame` 之上而不是另写一个，
 * 是为了让 §6.4 那三臂判据量的仍然是**产品真正走的那条路**。
 */
export function afterNextFrameWithin(
  nextFrame: (run: () => void) => void,
  budgetMs: number = NEXT_FRAME_BUDGET_MS,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (framed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(framed);
    };
    const timer = setTimeout(() => finish(false), budgetMs);
    void afterNextFrame(nextFrame).then(() => finish(true));
  });
}

/**
 * 把"原生可能永远不回调"折成一个**值**。
 *
 * 单独成函数、且不 import `react-native`，是为了让这条判据能在这个壳里真跑
 * （本壳没有 RN 组件测试栈，见文件头）：调用方交进来的 `invoke` 在测试里就是一颗
 * 什么都不做的桩，于是"不回调 ⇒ 在 `RASTERIZE_SETTLE_MS` 内拿到 `fired:false`"
 * 是可判的，而不是"我保证会兜底"。
 */
export function settleRasterize(
  invoke: (onBase64: (base64?: string) => void) => void,
  timeoutMs: number = RASTERIZE_SETTLE_MS,
): Promise<RasterizeOutcome> {
  return new Promise<RasterizeOutcome>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ fired: false, reason: 'timeout' });
    }, timeoutMs);
    try {
      invoke((base64?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ fired: true, base64: base64 ?? '' });
      });
    } catch {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ fired: false, reason: 'threw' });
    }
  });
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
