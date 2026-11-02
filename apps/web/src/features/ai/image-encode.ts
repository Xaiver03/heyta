/**
 * 把用户选的一张图压成**出境预算要的形状**（平台能力，不是业务规则）
 * ====================================================================
 *
 * 与 [头像那一段](../settings/avatar-encode.ts) 是同一条分界线（AGENTS §3.5）：
 * **数字**（单张字节、张数、像素、单边、允许的格式）是产品规格，住
 * `@heyta/ai` 的 `image-limits.ts`；**怎么把一张图变成那个形状**要画布，
 * 而画布是各端不同的东西（浏览器 `<canvas>`、RN `ImageEditor`、macOS `CoreGraphics`）。
 * 把 canvas 塞进 `packages/` 的后果是移动端与 macOS 壳必须 import 一个它们没有的 API。
 *
 * ## 🔴 为什么要"试出来"而不是"算出来"
 *
 * 出境预算是**字节**（`IMAGE_BUDGET.maxBytesPerImage`），而字节数在编码完成之前
 * 是未知的：同样 768 长边，一张纯色截图压成 PNG 只要 8 KB，一张照片要 300 KB。
 * 任何"按尺寸估字节"的公式都会在某一类图上失准，而失准的表现是
 * **用户点了发送，然后被出境层拒绝** —— 那时已经晚了，用户只会觉得"这功能坏了"。
 *
 * 所以这里按"编码 → 量 → 不够就降一档"循环，**以实测字节为准**。
 * 降档顺序有意如此：先保清晰度（PNG 无损 → JPEG 高质 → 低质），最后才缩尺寸 ——
 * 缩尺寸会让小字先糊掉，而那正是截图转任务唯一需要的信息。
 */

import {
  base64ByteLength,
  IMAGE_BUDGET,
  requestImageDimensions,
  type ImageMediaType,
} from '@heyta/ai';

/** 失败原因分类。**每种对应界面上一句不同的话**，所以不许合并。 */
export type ImageFileError =
  /** 不在白名单里（SVG / GIF / HEIC 都在这一档 —— 理由见 `image-limits.ts`）。 */
  | 'bad-type'
  /** 压到最小档仍然超预算（极少见：通常是极端噪点的照片）。 */
  | 'too-big'
  /** 浏览器解不开（坏文件，或它根本不是图片）。 */
  | 'undecodable';

/** 一张**已经可以交给出境层**的图。 */
export interface EncodedImage {
  readonly mediaType: ImageMediaType;
  /** Canonical base64，不带 `data:` 前缀。 */
  readonly base64: string;
  /** 实测二进制字节数（由 base64 长度反算，与真实解码一致）。 */
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  /** 原图尺寸，用于界面上一句"已压到 …"的如实说明。 */
  readonly source: { readonly width: number; readonly height: number };
}

export type EncodeImageResult =
  | { readonly ok: true; readonly image: EncodedImage }
  | { readonly ok: false; readonly error: ImageFileError };

/**
 * JPEG 的质量档，**从高到低**。
 *
 * 0.75 是"截图里的 12px 正文还认得出"的下限附近；再低就只能靠放大镜。
 * 最后一档 0.45 不是给正常图的 —— 它是"宁可糊一点也别让用户发不出去"的兜底。
 */
const JPEG_QUALITIES = [0.75, 0.6, 0.45] as const;

/** 降尺寸的轮数上限。每轮 ×0.75，四轮后是原来的 32%。 */
const MAX_DOWNSCALE_ROUNDS = 4;

/** 白名单。读的是出境层那一份，不在壳里另抄一张表。 */
export function isImageInputType(type: string): type is ImageMediaType {
  return (IMAGE_BUDGET.mediaTypes as readonly string[]).includes(type);
}

/**
 * 把 `File` / 剪贴板里的一张图编码到预算内。
 *
 * 不抛异常：所有失败都变成 {@link ImageFileError}，因为界面上要说话的是人，
 * 而不是控制台里的一行 `Error`。
 */
export async function encodeImageForEgress(file: File): Promise<EncodeImageResult> {
  if (!isImageInputType(file.type)) return { ok: false, error: 'bad-type' };

  const url = URL.createObjectURL(file);
  try {
    const bitmap = await decode(url);
    if (bitmap === null) return { ok: false, error: 'undecodable' };

    const source = { width: bitmap.width, height: bitmap.height };
    let target = requestImageDimensions(source.width, source.height);

    for (let round = 0; round <= MAX_DOWNSCALE_ROUNDS; round += 1) {
      // ① 先试 PNG：截图里的文字是无损的，能塞进预算就别用 JPEG。
      const png = drawAndEncode(bitmap, target, 'image/png');
      if (png !== null && png.bytes <= IMAGE_BUDGET.maxBytesPerImage) {
        return { ok: true, image: { ...png, source } };
      }

      // ② 再试 JPEG 的三档质量。
      for (const quality of JPEG_QUALITIES) {
        const jpeg = drawAndEncode(bitmap, target, 'image/jpeg', quality);
        if (jpeg !== null && jpeg.bytes <= IMAGE_BUDGET.maxBytesPerImage) {
          return { ok: true, image: { ...jpeg, source } };
        }
      }

      // ③ 还不行就缩一档再来。
      const next = {
        width: Math.max(1, Math.round(target.width * 0.75)),
        height: Math.max(1, Math.round(target.height * 0.75)),
      };
      if (next.width === target.width && next.height === target.height) break;
      target = next;
    }

    return { ok: false, error: 'too-big' };
  } finally {
    // 不 revoke 会一直占着这张图的内存直到页面卸载 —— 用户连选三次就是三张原图。
    URL.revokeObjectURL(url);
  }
}

/**
 * 从剪贴板事件里取图片。
 *
 * 🔴 这是**截图转任务**的主入口：用户在别处截了图，切回来直接 ⌘V。
 * 剪贴板里同时有文字和图片时优先图片 —— 用户按粘贴的意图是"我刚截的那张"。
 */
export function imagesFromClipboard(data: DataTransfer | null): readonly File[] {
  if (data === null) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file !== null) files.push(file);
  }
  return files;
}

/** 解码一张图。失败一律 `null`（调用方只需要知道"解不开"）。 */
async function decode(url: string): Promise<ImageBitmap | null> {
  // `createImageBitmap` 在 Safari 15+ / 所有 Chromium 上都有；没有就退回 `<img>`。
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(await (await fetch(url)).blob());
    } catch {
      return null;
    }
  }
  try {
    return await new Promise<ImageBitmap>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el as unknown as ImageBitmap);
      el.onerror = () => reject(new Error('decode-failed'));
      el.src = url;
    });
  } catch {
    return null;
  }
}

/** 画到目标尺寸并编码。画布拿不到（无 GPU / 内存不足）时返回 `null`。 */
function drawAndEncode(
  bitmap: ImageBitmap,
  target: { readonly width: number; readonly height: number },
  mediaType: ImageMediaType,
  quality?: number,
): Omit<EncodedImage, 'source'> | null {
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  // ⚠️ JPEG 没有 alpha 通道，透明背景会被铺成**黑**底 —— 截图常带透明边缘，
  // 黑底上的深色小字等于没了。先铺白，再把图压上去。
  if (mediaType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
  }
  ctx.drawImage(bitmap, 0, 0, target.width, target.height);

  const dataUrl = canvas.toDataURL(mediaType, quality);
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const base64 = dataUrl.slice(comma + 1);

  return {
    mediaType,
    base64,
    bytes: base64ByteLength(base64),
    width: target.width,
    height: target.height,
  };
}
