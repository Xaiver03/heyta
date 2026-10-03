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
 * 🔴 **本文件里一个设计取值都不许多发明**：
 * 边长 / 比例 / 放大倍率 / 内容类型 / 文件名上限来自 `@heyta/shared-schema` 的
 * `EXPORT_CARD_*`（那是产品规格），颜色 / 间距 / 圆角 / 排版角色来自宿主传进来的
 * `useHeytaUiTheme()` 的 `tokens` 与 `text`（那是设计系统唯一事实源）。
 * 契约文件头写的裁决是"**成品图 = UI 的整倍放大**"，所以这里用的排版角色
 * 与 `packages/ui/src/countdown/EventBoard.tsx` 卡片上的是**同三个**：
 * `row-title`（标题）、`numeric-display`（那个大数字）、`row-meta`（日期与"已经 N 天"）。
 * 给海报单独定一套字号 = 第二套排版事实源，它的漂移表现是"预览好看、导出难看"。
 *
 * ## 🔴 零网络（工单判据）
 *
 * 这一条路上只有 `document.createElement('canvas')`、`canvas.toBlob`、
 * `URL.createObjectURL` 与一个 `<a download>` 点击 —— 全部是本机 API。
 * 刻意**不**引 `html2canvas` 那类库：它要新过 AGENTS §3.1/§3.2 两道门，
 * 而且它会为了排版保真顺手 `fetch` 外链字体，那正好把本单要证的"零出网"变成假话。
 * 判据在 `e2e/tests/countdown-export.spec.ts`（真浏览器数请求）。
 *
 * ## 失败只有一种，而且**必须让界面说**
 *
 * `getContext('2d')` 返回 `null`（禁了 canvas 的硬加固环境、内存压力）。
 * 这时返回 `{ ok: false }` 而不是静默什么都不做 —— 便签那条"失败静默吞掉"
 * 的高危不复制到这儿（`EventBoard` 文件头同一条纪律）。
 */

import {
  EXPORT_CARD_CONTENT_TYPE,
  EXPORT_CARD_EDGE_PX,
  EXPORT_CARD_FILE_STEM_MAX_CODE_POINTS,
  EXPORT_CARD_HEIGHT_PX,
  EXPORT_CARD_SCALE,
} from '@heyta/shared-schema';
import type { HeytaNativeTokens, RnTextStyle, TextStyleName } from '@heyta/design-system';
import type { EventCardTexts } from '@heyta/ui';

/** 宿主把当前主题的 token 表与语义排版整条交进来（本层不读 CSS 变量、不猜颜色）。 */
export interface CardExportTheme {
  readonly tokens: HeytaNativeTokens;
  readonly text: Record<TextStyleName, RnTextStyle>;
}

export interface CardExportRequest {
  /** 🔴 卡片上那四段话 —— 由共享层 `cardTextsFor` 生成，**不在这里再拼一遍措辞**。 */
  readonly texts: EventCardTexts;
  readonly theme: CardExportTheme;
  /** 左侧强调条的颜色（模板 = 分类色板的一格；由宿主解析，本层不给色）。 */
  readonly accentColor: string;
  /** 文件名里那一段日期（宿主用界面上同一条 `formatDate`，所以图与屏说的是同一天）。 */
  readonly dateStem: string;
}

export type CardExportFailure =
  /** 这台设备给不了 2D 画布（`getContext('2d')` 返回 `null`）。 */
  | 'no-canvas'
  /** 画布给了，但 `toBlob` 没产出字节（浏览器拒绝编码）。 */
  | 'encode-failed';

export type CardExportResult =
  | { readonly ok: true; readonly fileName: string; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly error: CardExportFailure };

/** 画布上的一行：`x`/`y` 已是**像素**（`0, 0` 是左上角，`textBaseline = 'top'`）。 */
export interface CardExportDrawOp {
  readonly kind: 'rect' | 'text';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly color: string;
  readonly text?: string;
  readonly fontSize?: number;
  /** 放大后的**绝对**行高（不是倍数）：`resolveTextStyle` 已经把倍数换成点值了。 */
  readonly lineHeight?: number;
  readonly fontWeight?: RnTextStyle['fontWeight'];
  readonly letterSpacing?: number;
  /** 等宽数位：`numeric-display` 带 `tabular-nums`，卡片上那个数不能随字宽跳。 */
  readonly tabularNums?: boolean;
  readonly maxLines?: number;
}

/**
 * 版面：**纯函数**，不碰 DOM。
 *
 * 🔴 为什么要单独导出它：jsdom **没有 2D 画布实现**（`getContext` 直接返回 `null`），
 * 所以"尺寸来自契约、间距来自 token、倍率来自 `EXPORT_CARD_SCALE`"这三件可在
 * node 里判的事必须能在**渲染之前**被断言。留在 `toBlob` 那一侧就只能靠 e2e，
 * 而 e2e 只能验"最后那张图的 IHDR 是多少"，验不了"这一行用的是哪个排版角色"。
 */
export function buildCardExportLayout(request: CardExportRequest): {
  readonly width: number;
  readonly height: number;
  readonly ops: readonly CardExportDrawOp[];
} {
  const { tokens, text } = request.theme;
  // 🔴 唯一的放大器：契约说"成品图 = UI 按 EDGE_PX / REF_WIDTH_DP 整倍放大"。
  // 这里出现任何字面像素值，都等于把那张图从 token 体系里摘出去（AGENTS §5 规则 1）。
  const k = EXPORT_CARD_SCALE;
  const pad = tokens['space.6'] * k;
  const cardRadius = tokens['radius.xl'] * k;
  const innerX = pad + tokens['space.5'] * k;
  const gap = tokens['space.2'] * k;

  const accentWidth = tokens['size.progress-height'] * k;
  const title = text['row-title'];
  const display = text['numeric-display'];
  const meta = text['row-meta'];

  const ops: CardExportDrawOp[] = [
    {
      kind: 'rect',
      x: 0,
      y: 0,
      width: EXPORT_CARD_EDGE_PX,
      height: EXPORT_CARD_HEIGHT_PX,
      radius: 0,
      color: tokens['color.background'],
    },
    {
      kind: 'rect',
      x: pad,
      y: pad,
      width: EXPORT_CARD_EDGE_PX - pad * 2,
      height: EXPORT_CARD_HEIGHT_PX - pad * 2,
      radius: cardRadius,
      color: tokens['color.surface'],
    },
    // 强调条：与卡片上同一条（模板色只在**条**上出现，绝不当文字色用 —— `check:text-color`
    // 拦的正是"分类色当文字色"那件事，那张色板没有被对比度测试覆盖）。
    {
      kind: 'rect',
      x: innerX,
      y: pad + tokens['space.5'] * k,
      width: accentWidth,
      height: EXPORT_CARD_HEIGHT_PX - (pad + tokens['space.5'] * k) * 2,
      radius: tokens['radius.full'] * k,
      color: request.accentColor,
    },
    {
      kind: 'text',
      x: innerX + accentWidth + gap,
      y: pad + tokens['space.5'] * k,
      width: EXPORT_CARD_EDGE_PX - (innerX + accentWidth + gap + pad),
      height: title.lineHeight * k,
      radius: 0,
      color: tokens['color.foreground'],
      text: request.texts.title,
      fontSize: title.fontSize * k,
      lineHeight: title.lineHeight * k,
      fontWeight: title.fontWeight,
      letterSpacing: title.letterSpacing * k,
      maxLines: 2,
    },
    {
      kind: 'text',
      x: innerX + accentWidth + gap,
      y: EXPORT_CARD_HEIGHT_PX / 2 - (display.lineHeight * k) / 2,
      width: EXPORT_CARD_EDGE_PX - (innerX + accentWidth + gap + pad),
      height: display.lineHeight * k,
      radius: 0,
      color: tokens['color.foreground'],
      text: request.texts.face,
      fontSize: display.fontSize * k,
      lineHeight: display.lineHeight * k,
      fontWeight: display.fontWeight,
      letterSpacing: display.letterSpacing * k,
      tabularNums: true,
      maxLines: 1,
    },
    {
      kind: 'text',
      x: innerX + accentWidth + gap,
      y: EXPORT_CARD_HEIGHT_PX - pad - tokens['space.5'] * k - meta.lineHeight * k,
      width: EXPORT_CARD_EDGE_PX - (innerX + accentWidth + gap + pad),
      height: meta.lineHeight * k,
      radius: 0,
      color: tokens['color.foreground-muted'],
      text: request.texts.date,
      fontSize: meta.fontSize * k,
      lineHeight: meta.lineHeight * k,
      fontWeight: meta.fontWeight,
      letterSpacing: meta.letterSpacing * k,
      tabularNums: true,
      maxLines: 1,
    },
  ];

  // 「已经 N 天」那一行：共享层给的是 `string | undefined`，**没有空字符串**
  // （`cardTextsFor` 的注释把这条说完了：有没有这一行是判断，画不画才是展示）。
  if (request.texts.age !== undefined) {
    ops.push({
      kind: 'text',
      x: innerX + accentWidth + gap,
      y: ops[5]!.y - meta.lineHeight * k - gap,
      width: ops[5]!.width,
      height: meta.lineHeight * k,
      radius: 0,
      color: tokens['color.foreground-muted'],
      text: request.texts.age,
      fontSize: meta.fontSize * k,
      lineHeight: meta.lineHeight * k,
      fontWeight: meta.fontWeight,
      letterSpacing: meta.letterSpacing * k,
      tabularNums: true,
      maxLines: 1,
    });
  }

  return { width: EXPORT_CARD_EDGE_PX, height: EXPORT_CARD_HEIGHT_PX, ops };
}

/**
 * 文件名里标题那一段：**按码点**截断，并去掉对文件系统非法的字符。
 *
 * 🔴 用 `Array.from` 而不是 `.slice`：`'𐋀'.length === 2`（代理对），
 * 按 `.length` 截会把一个字符劈成半个，得到带问号的怪名字。
 * 上限与 `ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS` 同一口径（见契约的字段注释）。
 */
export function cardExportFileStem(title: string): string {
  // 🔴 全程按**码点数组**走：`String.prototype.slice` 切的是 UTF-16 单元，
  // 对非 BMP 字符（emoji、`𐋀`）会在字符中间劈开，得到一个落单的替换字符 ——
  // 而这条判据（"名字里有半个字符"）只有按码点数才会被发现。
  const characters = Array.from(title.replaceAll(/[/\\:*?"<>|\u0000-\u001F]/gu, '')).filter(
    (character) => character !== undefined,
  );
  const taken = characters
    .slice(0, EXPORT_CARD_FILE_STEM_MAX_CODE_POINTS)
    .join('')
    .trim();
  // 全被滤掉的标题（一条空名字的倒数日）不能产出一个以 `-` 开头的怪文件名。
  return taken === '' ? 'heyta' : taken;
}

/** `heyta-上线那天-2026年11月1日.png`：分隔用的是日期段，宿主给的。 */
export function cardExportFileName(stem: string, dateStem: string): string {
  const date = Array.from(dateStem.replaceAll(/[/\\:*?"<>|\u0000-\u001F]/gu, '')).slice(0, 32).join('');
  return `heyta-${stem}${date === '' ? '' : `-${date}`}.png`;
}

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

/** 把版面**画**到一块画布上（唯一的 DOM 调用点之一）。`fontFamily` 由宿主读运行时值。 */
export function paintCardExport(
  ctx: CanvasRenderingContext2D,
  layout: { readonly ops: readonly CardExportDrawOp[] },
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
    ctx.textBaseline = 'top';
    if (op.letterSpacing !== undefined && op.letterSpacing !== 0) {
      // Chromium 99+ / Safari 17.4+ 有 `letterSpacing`；没有就少一个 em 级的微调，
      // 不影响尺寸判据 —— 所以这里**不**为它写兜底字号。
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
        `${String(op.letterSpacing)}px`;
    }
    ctx.font = `${op.fontWeight ?? '400'} ${String(op.fontSize ?? 0)}px ${fontFamily}`;
    // canvas 的 `font` 简写不认 `font-variant-numeric`，等宽数位改走 `fontFeatureSettings`
    // （RN 侧同一个意图写的是 `fontVariant: ['tabular-nums']`，见 `RnTextStyle`）。
    // TS 的 DOM 声明还没有 `fontFeatureSettings`（Chromium 99+ / Safari 16.4+ 有）：
    // 与 `letterSpacing` 同一处收口，**不在别处再 cast 一次**。
    (ctx as CanvasRenderingContext2D & { fontFeatureSettings?: string }).fontFeatureSettings =
      op.tabularNums === true ? '"tnum"' : 'normal';

    const lines = wrapText(ctx, op.text ?? '', op.width, op.maxLines ?? 1);
    // 行高用的是语义样式解析出来的**绝对值**（`resolveTextStyle` 已经把"倍数 → 点值"
    // 那一步做掉了；这里再乘一个自定的倍数就是第二套行高，而漏乘的表现是行叠行）。
    const lineHeight = op.lineHeight ?? op.fontSize ?? 0;
    lines.forEach((line, index) => {
      ctx.fillText(line, op.x, op.y + index * lineHeight);
    });
    ctx.restore();
  }
}

/**
 * 按**测量宽度**折行，最多 `maxLines` 行，超出的部分以省略号收尾。
 *
 * 卡片上 `numberOfLines={2}` 是 RN/RNW 做的事；画布没有等价物，只能自己折。
 * 行数上限与卡片**同一个数**（标题 2 行），否则"屏幕上两行、图上一行半"又是漂移。
 * 按**码点**迭代（`Array.from`）而不是按 `.length`：一个 emoji 是两个 UTF-16 单元，
 * 按单元切会把它劈成半个问号。
 */
export function wrapText(
  ctx: { measureText: (s: string) => { width: number } },
  value: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const characters = Array.from(value);
  if (characters.length === 0 || maxWidth <= 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const character of characters) {
    const candidate = current + character;
    if (ctx.measureText(candidate).width > maxWidth && current !== '') {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  if (lines.length <= maxLines) return lines;

  // 溢出：末行留出一格省略号的宽度后硬截。
  const ellipsis = '…';
  const budget = maxWidth - ctx.measureText(ellipsis).width;
  const kept = lines.slice(0, maxLines);
  const tail = Array.from(kept[maxLines - 1] ?? '');
  while (tail.length > 1 && ctx.measureText(tail.join('')).width > budget) {
    tail.pop();
  }
  kept[maxLines - 1] = `${tail.join('')}${ellipsis}`;
  return kept;
}

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
 * 真正"出厂尺寸对不对"的判据在 e2e 里读**下载下来的那张 PNG 的 IHDR**（§4）。
 * 在这一处 self-check 只能证明"我自己说的和我自己画的一致"，那是同义反复。
 */
export async function exportEventCard(
  request: CardExportRequest,
): Promise<CardExportResult> {
  const layout = buildCardExportLayout(request);
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
