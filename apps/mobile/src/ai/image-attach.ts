/**
 * 移动端「附图」通道：选图 → 归一化 → 按出境预算校验。
 *
 * ## 为什么用 `react-native-image-picker`
 *
 * 出境预算（`@heyta/ai` 的 `IMAGE_BUDGET`）是**硬上界**：单张 45 KB、总 80 KB、
 * 单边 1600 px、总量 100 万像素。一张手机原图动辄 2–8 MB，**必须**在壳里先缩放重编码。
 * 纯 JS 在 RN 上没有 canvas/ImageBitmap，做不了这个缩放；而 `react-native-image-picker`
 * 的原生 picker 支持 `maxWidth/maxHeight/quality/includeBase64`，一步就完成
 * **选图 + 缩放 + 重编码 + base64**，正是这道预算要的形状。
 *
 * 🔴 许可与维护（AGENTS §3.1–3.2，本轮实测）：
 *   · license = **MIT**（允许）；
 *   · 最新版 8.3.0 发布于 **2026-10-13**（2021 年之后仍在发版）；
 *   · 已登记进 `THIRD_PARTY_LICENSES.md`，`license-inventory.mjs` 通过。
 *
 * ## 预算判定不在这里重写
 *
 * 选完图后调用的是 `@heyta/ai` 的 `planImageRequest`（与出境层组装请求体时**同一个函数**）。
 * 壳只负责把"界面上这张图"归一化成 `PlannedImage`，判定规则仍只有一处。
 */

import { launchImageLibrary } from 'react-native-image-picker';
import {
  IMAGE_BUDGET,
  base64ByteLength,
  planImageRequest,
  type AiImagePart,
  type ImageMediaType,
  type ImageRejection,
  type PlannedImage,
} from '@heyta/ai';

export type PickImagesResult =
  | { readonly ok: true; readonly images: readonly AiImagePart[] }
  | { readonly ok: false; readonly reason: ImageRejection | 'cancelled' };

/** 白名单判定：picker 回的 mime 只有落在这三个里才接受（HEIC/GIF/SVG 一律拒）。 */
function asMediaType(type: string | undefined): ImageMediaType | undefined {
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp' ? type : undefined;
}

/**
 * 打开系统相册选图，返回**已过预算**的 `AiImagePart[]`。
 *
 * @param remaining 这一轮还剩几张额度（`IMAGE_BUDGET.maxImagesPerRequest - 已选`）。
 *   传进原生 picker 的 `selectionLimit`，让用户一次选不了超额的张数。
 */
export async function pickImages(remaining: number): Promise<PickImagesResult> {
  if (remaining <= 0) return { ok: false, reason: 'too-many-images' };
  const response = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: remaining,
    includeBase64: true,
    maxWidth: IMAGE_BUDGET.maxImageDimension,
    maxHeight: IMAGE_BUDGET.maxImageDimension,
    quality: 0.7,
  });
  if (response.didCancel === true) return { ok: false, reason: 'cancelled' };
  if (response.errorCode !== undefined) return { ok: false, reason: 'unsupported-media-type' };

  const assets = response.assets ?? [];
  const planned: PlannedImage[] = [];
  const parts: AiImagePart[] = [];
  for (const asset of assets) {
    const mediaType = asMediaType(asset.type);
    if (mediaType === undefined || asset.base64 === undefined) continue;
    const bytes = base64ByteLength(asset.base64);
    const width = asset.width ?? 0;
    const height = asset.height ?? 0;
    planned.push({ mediaType, bytes, width, height });
    parts.push({
      mediaType,
      base64: asset.base64,
      ...(asset.fileName !== undefined ? { name: asset.fileName } : {}),
    });
  }
  if (planned.length === 0) return { ok: false, reason: 'unsupported-media-type' };

  const plan = planImageRequest(planned);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  return { ok: true, images: parts };
}
