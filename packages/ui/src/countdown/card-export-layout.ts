/**
 * 纪念卡片**成品图**的版面（W7）：**只有一份**，各端只负责把它画出来。
 * ==================================================================
 *
 * 为什么住在 `packages/ui` 而不是各自的壳里（原来它写在 `apps/web/.../card-export.ts`）：
 * 成品图不止一个端要出 —— 浏览器画 `<canvas>`，RN 画 `<Svg>` 再交给原生栅格化。
 * 版面留在 `apps/web` 的话，移动端只有两个选择：import 一个 web 文件（打不出包），
 * 或者**再写一遍版面**。后者是本仓库付过两次学费的形状（AGENTS §3.5：
 * "抽出了共享实现但旧的那份没删"、"两个宿主各一份 op 构造且真的漂移了"）——
 * 而这里的漂移表现是"屏幕上好看、导出的图错位"，只有人眼看得出，门禁挡不住。
 *
 * 🔴 所以分界线是：**版面（本文件）= 产品语义；绘制指令 → 像素 = 平台能力（各端自己写）**。
 *
 * ## `rasterScale` 为什么是**必填参数**，而不是默认 `EXPORT_CARD_SCALE`
 *
 * 取证结论（见 `docs/plans/countdown-w7-device-export.md` §2.2）：已装的
 * `react-native-svg@15.15.5` 两端都能栅格化，但**同一个 `toDataURL` 在两端的单位不一样** ——
 * Android 走 `Bitmap.createBitmap(width, height)`（**像素**），
 * iOS 走 `UIGraphicsImageRenderer initWithSize:`（**点**，默认 scale = 屏幕 scale）。
 * 所以"把契约那对数原样传进去"在 Android 上对、在 3× 的 iOS 设备上大出 3 倍。
 *
 * 把倍率做成必填参数（而不是给一个等于 web 值的默认）是刻意的：默认值会把
 * "移动端忘了考虑 density"伪装成"它用了契约那一档"，而那正是本单要防的事。
 * 各端应当这样推导（不引入新常数，全部来自既有事实源）：
 *
 * | 端 | 一单位等于多少像素 | `rasterScale` | 画布单位宽高 |
 * |---|---|---|---|
 * | 浏览器 / 桌面壳（canvas 就是像素） | 1 | `EXPORT_CARD_SCALE` | 1080 × 1440 |
 * | RN | `PixelRatio.get()` | `EXPORT_CARD_SCALE / PixelRatio.get()` | 360 / density 那一档 |
 *
 * 关系式：`rasterScale = EXPORT_CARD_SCALE / 每单位像素数` ⇒
 * 画布单位尺寸 = `EXPORT_CARD_EDGE_PX × rasterScale / EXPORT_CARD_SCALE`。
 * web 代进去得到 1080（契约值，逐字不变），RN 在 3× 设备上得到 360 ——
 * 而原生栅格化再把 360 单位 × density 乘回 1080 **像素**，出厂尺寸仍是契约那一对。
 */

import {
  EXPORT_CARD_EDGE_PX,
  EXPORT_CARD_FILE_STEM_MAX_CODE_POINTS,
  EXPORT_CARD_HEIGHT_PX,
  EXPORT_CARD_SCALE,
} from '@heyta/shared-schema';
import type { HeytaNativeTokens, RnTextStyle, TextStyleName } from '@heyta/design-system';
import type { EventCardTexts } from './model.js';

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

/** 画布上的一行：坐标与字号都在**该端的绘制单位**里（`0,0` 左上角，文字基线 top）。 */
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

export interface CardExportLayout {
  /** 画布宽，单位是**该端的绘制单位**（web = px，RN = dp）；不是契约像素。 */
  readonly width: number;
  readonly height: number;
  readonly ops: readonly CardExportDrawOp[];
  /**
   * 契约像素 → 本端绘制单位的因子（= `rasterScale / EXPORT_CARD_SCALE`）。
   *
   * 🔴 为什么把它**返回**出来而不是让各端自己再算一遍：`toDataURL` 要的
   * 位图尺寸在 Android 是像素、在 iOS 是点，各端都免不了要做一次这个换算 ——
   * 换算写三遍就是三次漂移的机会。这里给一次，各端只乘不推。
   */
  readonly pxToUnit: number;
}

/**
 * 版面：**纯函数**，不碰 DOM、不碰 RN。
 *
 * 🔴 为什么要单独导出它：jsdom **没有 2D 画布实现**（`getContext` 直接返回 `null`），
 * 所以"尺寸来自契约、间距来自 token、倍率由调用方给"这三件必须在**绘制之前**就能被断言。
 * 只让 e2e 判的话，它量得到"最后那张图的 IHDR 是多少"，量不到"这一行用的是哪个**排版角色**"
 * —— 而后者正是 AGENTS §5 三条硬规则管的东西，`check:design` 只拦字面量、
 * 拦不住"挑错一个 token"。
 */
export function buildCardExportLayout(
  request: CardExportRequest,
  rasterScale: number,
): CardExportLayout {
  const { tokens, text } = request.theme;
  // 🔴 唯一的放大器。这里出现任何字面像素值，都等于把那张图从 token 体系里摘出去
  //（AGENTS §5 规则 1）。
  const k = rasterScale;
  const pxToUnit = k / EXPORT_CARD_SCALE;
  const canvasWidth = EXPORT_CARD_EDGE_PX * pxToUnit;
  const canvasHeight = EXPORT_CARD_HEIGHT_PX * pxToUnit;

  const pad = tokens['space.6'] * k;
  const cardRadius = tokens['radius.xl'] * k;
  const innerX = pad + tokens['space.5'] * k;
  const gap = tokens['space.2'] * k;
  const accentWidth = tokens['size.progress-height'] * k;
  const title = text['row-title'];
  const display = text['numeric-display'];
  const meta = text['row-meta'];
  const textX = innerX + accentWidth + gap;
  const textWidth = canvasWidth - (textX + pad);

  const ops: CardExportDrawOp[] = [
    {
      kind: 'rect',
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      radius: 0,
      color: tokens['color.background'],
    },
    {
      kind: 'rect',
      x: pad,
      y: pad,
      width: canvasWidth - pad * 2,
      height: canvasHeight - pad * 2,
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
      height: canvasHeight - (pad + tokens['space.5'] * k) * 2,
      radius: tokens['radius.full'] * k,
      color: request.accentColor,
    },
    {
      kind: 'text',
      x: textX,
      y: pad + tokens['space.5'] * k,
      width: textWidth,
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
      x: textX,
      y: canvasHeight / 2 - (display.lineHeight * k) / 2,
      width: textWidth,
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
      x: textX,
      y: canvasHeight - pad - tokens['space.5'] * k - meta.lineHeight * k,
      width: textWidth,
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
  // （`cardTextsFor` 把这条说完了：有没有这一行是判断，画不画才是展示）。
  if (request.texts.age !== undefined) {
    ops.push({
      kind: 'text',
      x: textX,
      y: ops[5]!.y - meta.lineHeight * k - gap,
      width: textWidth,
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

  return { width: canvasWidth, height: canvasHeight, ops, pxToUnit };
}

/**
 * 文件名里标题那一段：**按码点**截断，并去掉对文件系统非法的字符。
 *
 * 🔴 用 `Array.from` 而不是 `.slice`：`'𐋀'.length === 2`（代理对），
 * 按 `.length` 截会把一个字符劈成半个，得到带问号的怪名字。
 * 上限与 `ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS` 同一口径（见契约的字段注释）。
 */
export function cardExportFileStem(title: string): string {
  const characters = Array.from(title.replaceAll(/[/\\:*?"<>|\u0000-\u001F]/gu, '')).filter(
    (character) => character !== undefined,
  );
  const taken = characters.slice(0, EXPORT_CARD_FILE_STEM_MAX_CODE_POINTS).join('').trim();
  // 全被滤掉的标题（一条空名字的倒数日）不能产出一个以 `-` 开头的怪文件名。
  return taken === '' ? 'heyta' : taken;
}

/** `heyta-上线那天-2026年11月1日.png`：分隔用的是日期段，宿主给的。 */
export function cardExportFileName(stem: string, dateStem: string): string {
  const date = Array.from(dateStem.replaceAll(/[/\\:*?"<>|\u0000-\u001F]/gu, ''))
    .slice(0, 32)
    .join('');
  return `heyta-${stem}${date === '' ? '' : `-${date}`}.png`;
}

/** 折行要问"这一段多宽"。各端自带的尺子不一样，见下面两份实现。 */
export interface TextMeasurer {
  measureText(value: string): { readonly width: number };
}

/**
 * 按**测量宽度**折行，最多 `maxLines` 行，超出的部分以省略号收尾。
 *
 * 🔴 为什么这条也在共享层（原来它写在 `apps/web` 的画布绘制里）：折行**位置**是版面，
 * 不是画布能力。两端各写一遍的后果是"屏上两行、图上一行半"，而那种漂移只有人眼看得出。
 * 各端只贡献 `measurer`：
 *
 * | 端 | measurer | 精度 |
 * |---|---|---|
 * | 浏览器 | `CanvasRenderingContext2D.measureText` | 真测量 |
 * | RN | `estimateAdvance`（本文件下面） | **估算**，登记为缺口 W7-G4 |
 *
 * 行数上限来自版面（标题 2 行），与卡片上 `numberOfLines={2}` 是同一个数。
 * 按**码点**迭代（`Array.from`）而不是按 `.length`：一个 emoji 是两个 UTF-16 单元，
 * 按单元切会把它劈成半个问号。
 */
export function wrapCardText(
  measurer: TextMeasurer,
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
    if (measurer.measureText(candidate).width > maxWidth && current !== '') {
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
  const budget = maxWidth - measurer.measureText(ellipsis).width;
  const kept = lines.slice(0, maxLines);
  const tail = Array.from(kept[maxLines - 1] ?? '');
  while (tail.length > 1 && measurer.measureText(tail.join('')).width > budget) {
    tail.pop();
  }
  kept[maxLines - 1] = `${tail.join('')}${ellipsis}`;
  return kept;
}

/**
 * RN 那一端的尺子：**按码点估算**前进宽度（CJK 一个 `fontSize`，拉丁约 0.55 个）。
 *
 * 🔴 为什么是估算而不是真测量：`react-native-svg@15.15.5` 的 `Text` 没有
 * `numberOfLines`（全库 `numberOfLines` 命中 0 处），也没有同步的文字测量 API，
 * 而 `toDataURL` 是原生直接吃视图树 —— 想在 SVG 里折行只能自己算。
 * 后果登记成 **W7-G4**：超长标题下，成品图的断行位置可能与屏上
 * （`Text numberOfLines={2}` 走平台真测量）**不同**。两种语言混排的标题最容易。
 * 这条估算与卡片的差别只在"在哪一个字换行"，不影响尺寸判据（画布始终是契约那一对）。
 */
export function estimateAdvance(
  fontSize: number,
): TextMeasurer {
  return {
    measureText: (value: string) => {
      let units = 0;
      for (const character of Array.from(value)) {
        const code = character.codePointAt(0) ?? 0;
        // 汉字 / 假名 / 全角标点 / emoji 都按一整格算，其余按半格多一点。
        const wide =
          (code >= 0x1100 && code <= 0x115f) ||
          (code >= 0x2e80 && code <= 0xa4cf) ||
          (code >= 0xac00 && code <= 0xd7a3) ||
          (code >= 0xf900 && code <= 0xfaff) ||
          (code >= 0xfe30 && code <= 0xfe6f) ||
          code >= 0x1f300;
        units += wide ? 1 : 0.55;
      }
      return { width: units * fontSize };
    },
  };
}

