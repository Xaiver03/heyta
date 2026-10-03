/**
 * 纪念卡片**成品图**的浏览器栅格化（W7 · **平台能力**，不是业务规则）
 * ==================================================================
 *
 * 为什么住在 `apps/web` 而不是 `packages/app-host` / `packages/ui`：
 * 与 `../settings/avatar-encode.ts` **同一条分界**（那个文件的文件头把这个道理写过了）——
 * 画布是各端不同的东西（浏览器有 `<canvas>`、RN 有原生 `toDataURL`、macOS 壳有
 * `WKWebView.takeSnapshot`）。把画布塞进共享层的后果是移动端与原生壳必须
 * import 一个它们没有的 API。
 *
 * 🔴 **版面不在这里**。`buildCardExportLayout` / 文件名规则住在
 * `packages/ui/src/countdown/card-export-layout.ts`（唯一一份），本文件只做
 * "绘制指令 → 像素 → PNG 字节 → 下载"这一件事。
 * 在这里重新算一遍坐标就是第二张图，而它的漂移只有人眼看得出。
 *
 * 🔴 **一个设计取值都不许多发明**：边长 / 比例 / 放大倍率 / 内容类型 / 文件名上限
 * 来自 `@heyta/shared-schema` 的 `EXPORT_CARD_*`（产品规格），颜色 / 间距 / 圆角 /
 * 排版角色来自宿主传进来的 `useHeytaUiTheme()` 的 `tokens` 与 `text`（设计系统唯一事实源）。
 * 契约文件头的裁决是"**成品图 = UI 的整倍放大**"，所以浏览器这一端传的倍率
 * 恰好是 `EXPORT_CARD_SCALE`（canvas 的单位就是像素，1 单位 = 1 px）。
 *
 * ## 🔴 零网络（工单判据）
 *
 * 这一条路上只有 `document.createElement('canvas')`、`canvas.toBlob`、
 * `URL.createObjectURL` 与一个 `<a download>` 点击 —— 全部是本机 API。
 * 刻意**不**引 `html2canvas` 那类库：它要新过 AGENTS §3.1/§3.2 两道门，
 * 而且它会为了排版保真顺手 `fetch` 外链字体，那正好把本单要证的"零出网"变成假话。
 * 判据在 `e2e/tests/countdown-export.spec.ts`（真浏览器数请求 + 读下载文件的 IHDR）。
 *
 * ## 失败只有一种，而且**必须让界面说**
 *
 * `getContext('2d')` 返回 `null`（禁了 canvas 的硬加固环境、内存压力），
 * 或 `toBlob` 没产出字节。这时返回 `{ ok: false }` 而不是静默什么都不做 ——
 * 便签那条"失败静默吞掉"的高危不复制到这儿（`EventBoard` 文件头同一条纪律）。
 */

import { EXPORT_CARD_CONTENT_TYPE, EXPORT_CARD_SCALE } from '@heyta/shared-schema';
import {
  buildCardExportLayout,
  cardExportFileName,
  cardExportFileStem,
  wrapCardText,
  type CardExportLayout,
  type CardExportRequest,
} from '@heyta/ui';

export type { CardExportRequest, CardExportTheme } from '@heyta/ui';

export type CardExportFailure =
  /** 这台设备给不了 2D 画布（`getContext('2d')` 返回 `null`）。 */
  | 'no-canvas'
  /** 画布给了，但 `toBlob` 没产出字节（浏览器拒绝编码）。 */
  | 'encode-failed';

export type CardExportResult =
  | { readonly ok: true; readonly fileName: string; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly error: CardExportFailure };

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** 把版面**画**到一块画布上（唯一的 DOM 绘制点）。`fontFamily` 由宿主读运行时值。 */
export function paintCardExport(
  ctx: CanvasRenderingContext2D,
  layout: Pick<CardExportLayout, 'ops'>,
  fontFamily: string,
): void {
  for (const op of layout.ops) {
    ctx.save();
    ctx.fillStyle = op.color;
    if (op.kind === 'rect') {
      roundedRectPath(ctx, op.x, op.y, op.width, op.height, op.radius);
      ctx.fill();
      ctx.restore();
      continue;
    }
    // 🔴 基线用 **middle**，行内居中：RN 那一端的 `<Text dominantBaseline="central">`
    // 是同一条规则。两端各写一种对齐（一边 top、一边 central）表现为"字的位置差半行"，
    // 而那种漂移尺寸判据抓不到，只有人眼看得出。
    ctx.textBaseline = 'middle';
    if (op.letterSpacing !== undefined && op.letterSpacing !== 0) {
      // Chromium 99+ / Safari 17.4+ 有 `letterSpacing`；没有就少一个 em 级的微调，
      // 不影响尺寸判据 —— 所以这里**不**为它写兜底字号。
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
        `${String(op.letterSpacing)}px`;
    }
    ctx.font = `${op.fontWeight ?? '400'} ${String(op.fontSize ?? 0)}px ${fontFamily}`;
    // canvas 的 `font` 简写不认 `font-variant-numeric`，等宽数位改走 `fontFeatureSettings`
    // （RN 侧同一个意图落在 `react-native-svg` 上是**没有通道的** —— 它的 `Text`
    //  不接受 `fontVariant`，缺口登记为 W7-G5，不在这里假装两边一样）。
    // TS 的 DOM 声明还没有 `fontFeatureSettings`（Chromium 99+ / Safari 16.4+ 有）：
    // 与 `letterSpacing` 同一处收口，**不在别处再 cast 一次**。
    (ctx as CanvasRenderingContext2D & { fontFeatureSettings?: string }).fontFeatureSettings =
      op.tabularNums === true ? '"tnum"' : 'normal';

    const lines = wrapCardText(ctx, op.text ?? '', op.width, op.maxLines ?? 1);
    // 行高用的是语义样式解析出来的**绝对值**（`resolveTextStyle` 已经把"倍数 → 点值"
    // 那一步做掉了；这里再乘一个自定的倍数就是第二套行高，而漏乘的表现是行叠行）。
    const lineHeight = op.lineHeight ?? op.fontSize ?? 0;
    lines.forEach((line, index) => {
      ctx.fillText(line, op.x, op.y + index * lineHeight + lineHeight / 2);
    });
    ctx.restore();
  }
}

/**
 * 按**测量宽度**折行这件事在共享版面里（`wrapCardText`），本端只贡献尺子：
 * canvas 的 `measureText`。 RN 那一端贡献的是 `estimateAdvance`（估算，缺口 W7-G4）。
 * 两端各写一遍断行算法的后果是"屏上两行、图上一行半"，而那种漂移门禁挡不住。
 */

/** `canvas.toBlob` 的 Promise 版：`null` 是**失败**，不是"空的也没关系"。 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), EXPORT_CARD_CONTENT_TYPE);
  });
}

/**
 * 导出一张成品图。返回结果由界面决定怎么说（失败要看得见）。
 *
 * ⚠️ 尺寸对账（`EXPORT_CARD_SIZE`）**不在这里做**：这里画多大就是多大，
 * 真正"出厂尺寸对不对"的判据在 e2e 里读**下载下来的那张 PNG 的 IHDR**。
 * 在这一处 self-check 只能证明"我自己说的和我自己画的一致"，那是同义反复。
 */
export async function exportEventCard(
  request: CardExportRequest,
): Promise<CardExportResult> {
  // 浏览器这一端 1 单位 == 1 像素，所以倍率就是契约的放大倍率本身。
  const layout = buildCardExportLayout(request, EXPORT_CARD_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return { ok: false, error: 'no-canvas' };

  // 🔴 字体栈**读运行时值**，不在这里写字体名：设计系统的 `--ht-font-sans`
  // 已经被样式表应用到 `body`，`getComputedStyle` 拿到的就是界面真在用的那一套。
  // 抄一份 `'Inter, system-ui, …'` 就是第二套事实源，而且是那种"预览好看、导出难看"的。
  const fontFamily = getComputedStyle(document.body).fontFamily;
  paintCardExport(ctx, layout, fontFamily);

  const blob = await canvasToBlob(canvas);
  if (blob === null) return { ok: false, error: 'encode-failed' };

  const fileName = cardExportFileName(cardExportFileStem(request.texts.title), request.dateStem);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  // 与 `../settings/export-download.ts` 同一套收尾：挂上 → 点 → 摘掉 → revoke。
  // 不 revoke 就是每导一张泄漏一个 blob（导出的是位图，比文本大两个数量级）。
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { ok: true, fileName, width: layout.width, height: layout.height };
}
