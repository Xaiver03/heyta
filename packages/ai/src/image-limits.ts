/**
 * 图片出境的**预算与几何** —— 纯函数，零 IO。
 * =====================================================================
 *
 * ## 为什么这份东西必须住在 `packages/ai`，而不是界面里
 *
 * 图片出境和文本出境不是同一个量级：文本一条任务标题几十字节，一张手机截图
 * **原始就有 2–8 MB**。而 `MAX_ASSISTANT_EGRESS_BYTES`（`assistant-limits.ts`）
 * 是**单次请求 200 KB** 的硬上界 —— 一张原图的 base64 就能把整个上界撞穿。
 *
 * 所以「能不能发」不能由界面上的一个"最大 5MB"提示决定，必须由**出境层**决定：
 * 这里定义预算，`wire.ts` 在**组装请求体时**执行它。界面拿到的只是同一个常量，
 * 用来提前告诉用户"这张太大了"，而不是替出境层做判断。
 *
 * ## 🔴 不放松上界，改成"本地存大、出境发小"
 *
 * 诱人的做法是把 200 KB 抬到 5 MB。不做，理由有两条：
 * 1. 那是**安全边际**，不是性能参数 —— 它挡的是"一步读出 500 条任务再回送"那类失控
 *    （见 `assistant-limits.ts` 文件头那张表）。为图片抬它，等于为一种输入取消对全部输入的约束。
 * 2. 抬了也解决不了问题：8 MB 的截图 base64 是 11 MB，任何"发送前判一下"都救不了延迟。
 *
 * 正确做法是参考实现（DeepSeek Harness 的 `attachment` 一族）用的那条：
 * **原图留在本地（几十 MB 都行），发出去的是一张归一化后的请求图**。
 * 于是出境层的预算不必动，界面也不必劝用户截图截小一点。
 *
 * ⚠️ **这里的几何函数是本仓自己写的，不是从 DSH 抄的**。借鉴的是它的**形状**
 * （预算五元组 + 按像素预算等比归一化 + 传大存小），不是它的表达式；
 * 登记在 `THIRD_PARTY_LICENSES.md` §3 "参考但未使用代码"。这样不必背 MIT 的署名义务，
 * 也就不会有人日后分不清"这段是我们写的还是搬的"。
 *
 * ## 预算是怎么定的
 *
 * 上界 200 000 字节（base64 之后的 JSON），base64 膨胀 4/3 ⇒ 图片二进制总额
 * 必须留在 **80 000 字节**以内（80 000 → 106 668 base64），剩下的给文本与历史
 * （实测一条多轮助手请求的文本面在 10–30 KB）。单张 45 000，于是
 * **一张宽裕、两张要靠总额那道闸**（见下面 `maxBytesPerImage` 的注释）。
 *
 * 一张 45 KB 的 JPEG 在 768 长边下通常是 q0.7–0.75，截图里的正文仍然读得出来
 * （2026-11-02 实测：420×160 的 PNG 转 base64 后 3 468 字节，模型正确读出图里
 * "Buy milk tomorrow 9am / priority: high"，消耗 230 prompt tokens）。
 */

/**
 * 允许出境的图片容器。
 *
 * 🔴 **只有光栅图**：SVG 是**可执行文档**（内含脚本与外部引用），把它当图片发给模型
 * 等于把一个 XML 解析器塞进出境面。GIF 也不收 —— 动图的"第几帧"没有定义，
 * 而模型只能看一帧，收下它只会让用户以为发的是动画。
 */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

/** 单次请求的图片预算。**唯一事实源**：界面与出境层读的是这一份。 */
export interface ImageBudget {
  /** 单张图的**二进制**上界（不含 base64 膨胀）。 */
  readonly maxBytesPerImage: number;
  /** 一条请求最多几张。 */
  readonly maxImagesPerRequest: number;
  /** 一条请求的图片二进制总额上界。 */
  readonly maxTotalImageBytes: number;
  /** 归一化后的像素上界（宽 × 高）。 */
  readonly maxImagePixels: number;
  /** 归一化后的单边像素上界。 */
  readonly maxImageDimension: number;
  readonly mediaTypes: readonly ImageMediaType[];
}

/**
 * 现行预算。
 *
 * 数字的来历见文件头「预算是怎么定的」。🔴 改这里的任何一个数，
 * 都要同时复核 `MAX_ASSISTANT_EGRESS_BYTES`（200 000）还够不够 ——
 * 两者是**一份预算的两种说法**，不是两个独立常量。
 */
export const IMAGE_BUDGET: ImageBudget = {
  /**
   * 🔴 **45 000 而不是 40 000**：如果单张上限 × 允许张数正好等于总额上限，
   * 那么「总额超预算」这条分支**永远不可能被触发** —— 它就成了一个没有构造点的
   * 死成员，而读者会以为还有一道闸。45 000 × 2 = 90 000 > 80 000，
   * 于是"两张都不算大、合起来太大"这种情况**真的会被拦住**（有测试打这条）。
   */
  maxBytesPerImage: 45_000,
  maxImagesPerRequest: 2,
  maxTotalImageBytes: 80_000,
  maxImagePixels: 1_000_000,
  maxImageDimension: 1_600,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp'],
};

/** 一个图片尺寸。整数像素。 */
export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * 等比缩到**总像素**预算以内。
 *
 * 语义（三条，都是为了"不要悄悄改变用户给的东西"）：
 * 1. **不放大** —— 源图已经在预算内就原样返回，绝不给小图插值。
 * 2. **长边先落** —— 先按 sqrt 比例落长边，再用短边修正，避免两次取整后仍超预算。
 * 3. **可能差一个像素** —— 短边四舍五入，长边向下取整；两处都兜了 `Math.max(1, …)`，
 *    所以极端长条图（10000×3）不会被算成 0 高。
 *
 * @param width 源宽（正整数）
 * @param height 源高（正整数）
 * @param maxPixels 像素上界（正整数）
 */
export function fitWithinPixels(
  width: number,
  height: number,
  maxPixels: number,
): ImageDimensions {
  const source = { width, height };
  if (width <= 0 || height <= 0 || maxPixels <= 0) return source;

  const total = width * height;
  if (total <= maxPixels) return source;

  const scale = Math.sqrt(maxPixels / total);
  if (width >= height) {
    const projectedWidth = Math.max(1, Math.floor(width * scale));
    let projectedHeight = Math.max(1, Math.round((projectedWidth * height) / width));
    let w = projectedWidth;
    while (w * projectedHeight > maxPixels && w > 1) {
      w -= 1;
      projectedHeight = Math.max(1, Math.round((w * height) / width));
    }
    return { width: w, height: projectedHeight };
  }

  const projectedHeight = Math.max(1, Math.floor(height * scale));
  let projectedWidth = Math.max(1, Math.round((projectedHeight * width) / height));
  let h = projectedHeight;
  while (projectedWidth * h > maxPixels && h > 1) {
    h -= 1;
    projectedWidth = Math.max(1, Math.round((h * width) / height));
  }
  return { width: projectedWidth, height: h };
}

/**
 * 等比缩到**单边**预算以内。
 *
 * 与 {@link fitWithinPixels} 是两条独立判据，调用方按需串联：
 * 先像素（挡住 8000×8000），再单边（挡住 10000×100 那种"像素不多但长边离谱"）。
 * 两个都要，因为两者各自都能被另一种形状绕过。
 */
export function fitWithinDimension(
  width: number,
  height: number,
  maxDimension: number,
): ImageDimensions {
  if (width <= 0 || height <= 0 || maxDimension <= 0) return { width, height };
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  if (width >= height) {
    return { width: maxDimension, height: Math.max(1, Math.round((maxDimension * height) / width)) };
  }
  return { width: Math.max(1, Math.round((maxDimension * width) / height)), height: maxDimension };
}

/** 按现行预算把一张图归一化到**该发的尺寸**（先像素后单边）。 */
export function requestImageDimensions(
  width: number,
  height: number,
  budget: ImageBudget = IMAGE_BUDGET,
): ImageDimensions {
  const pixelFit = fitWithinPixels(width, height, budget.maxImagePixels);
  return fitWithinDimension(pixelFit.width, pixelFit.height, budget.maxImageDimension);
}

/**
 * 字节数 → base64 之后的字符数（含 `=` 填充）。
 *
 * 出境预算量的是**请求体 JSON 的字节数**，而请求体里躺的是 base64 串。
 * 少算这一步会让"看起来 60 KB、实际 80 KB"，而超预算的表现是发送前被拒 ——
 * 用户只会看到"这张图发不出去"，不知道是算错了一档。
 */
export function base64Length(byteLength: number): number {
  if (byteLength <= 0) return 0;
  return Math.ceil(byteLength / 3) * 4;
}

/**
 * base64 串 → 它解码后的**字节数**（不真的解码）。
 *
 * ⚠️ 出境层手里只有 base64 串，没有原始 `File`；而预算判据要的是字节数。
 * 真的去 `atob` 一遍既慢又要额外内存（8 MB 图会临时多占 8 MB），
 * 而 base64 的长度与字节数是**确定关系**：每 4 个字符 3 字节，末尾 `=` 各扣 1。
 */
export function base64ByteLength(base64: string): number {
  const withoutPadding = base64.endsWith('==')
    ? base64.length - 2
    : base64.endsWith('=')
      ? base64.length - 1
      : base64.length;
  return Math.floor((withoutPadding * 3) / 4);
}

/** 一条请求里的图片**被拒**的原因。**封闭词表** —— 每个成员都要有一句给用户听的话。 */
export type ImageRejection =
  /** 格式不在白名单（含 SVG / GIF / HEIC）。 */
  | 'unsupported-media-type'
  /** 单张超过 `maxBytesPerImage`。 */
  | 'image-too-large'
  /** 张数超过 `maxImagesPerRequest`。 */
  | 'too-many-images'
  /** 图片二进制总额超过 `maxTotalImageBytes`。 */
  | 'images-over-total-budget'
  /** 归一化后仍超像素 / 单边预算（通常是尺寸读错了）。 */
  | 'image-dimensions-too-large';

/** 一条待发的图片（**已经归一化过的**）。 */
export interface PlannedImage {
  readonly mediaType: ImageMediaType;
  /** 归一化后的二进制字节数。 */
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

export type ImagePlanResult =
  | { readonly ok: true; readonly totalBytes: number; readonly totalBase64: number }
  | { readonly ok: false; readonly reason: ImageRejection };

/**
 * 发送前的**唯一**一次预算判定。
 *
 * 顺序是有意的：先查格式（最便宜且原因最明确），再查单张，再查张数，最后查总额 ——
 * 这样用户拿到的永远是**最该先解决的那一条**，而不是"总额超了"这种合并症状。
 */
export function planImageRequest(
  images: readonly PlannedImage[],
  budget: ImageBudget = IMAGE_BUDGET,
): ImagePlanResult {
  for (const image of images) {
    if (!budget.mediaTypes.includes(image.mediaType)) {
      return { ok: false, reason: 'unsupported-media-type' };
    }
    if (image.bytes > budget.maxBytesPerImage) {
      return { ok: false, reason: 'image-too-large' };
    }
    if (
      image.width <= 0 ||
      image.height <= 0 ||
      image.width > budget.maxImageDimension ||
      image.height > budget.maxImageDimension ||
      image.width * image.height > budget.maxImagePixels
    ) {
      return { ok: false, reason: 'image-dimensions-too-large' };
    }
  }

  if (images.length > budget.maxImagesPerRequest) {
    return { ok: false, reason: 'too-many-images' };
  }

  let totalBytes = 0;
  for (const image of images) totalBytes += image.bytes;
  if (totalBytes > budget.maxTotalImageBytes) {
    return { ok: false, reason: 'images-over-total-budget' };
  }

  return { ok: true, totalBytes, totalBase64: base64Length(totalBytes) };
}
