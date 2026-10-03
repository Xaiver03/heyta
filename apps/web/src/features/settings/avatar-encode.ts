/**
 * 把用户选的一张图压成头像契约要的形状（**平台能力**，不是业务规则）
 * ================================================================
 *
 * 为什么单独一个文件、而且为什么住在 `apps/web` 而不是 `packages/app-host`：
 * 缩放图片需要**画布**，而画布是各端不同的东西（浏览器有 `<canvas>`、RN 有
 * `ImageEditor`、macOS 壳有 `CoreGraphics`）。AGENTS §3.5 的分界线在这里是清楚的：
 * **数字**（边长、字节上限、允许的格式）是产品规格，住 `@heyta/shared-schema`；
 * **怎么把一张图变成那个形状**是平台调用，住各自的壳。
 * 把 canvas 塞进 app-host 的后果是移动端与 macOS 壳必须 import 一个它们没有的 API。
 *
 * 🔴 输出必须是**方形**的：显示侧用 `--ht-size-avatar-*` 加圆角裁成圆，
 * 非方形进去就会被切掉一边 —— 而"我的头像怎么少了半张脸"这种事用户
 * 只会归因到应用坏了。所以在这里就把话说完：短边居中裁切，再等比缩到边长。
 */

import {
  ACCOUNT_AVATAR_CONTENT_TYPES,
  ACCOUNT_AVATAR_EDGE_PX,
  ACCOUNT_AVATAR_MAX_SOURCE_BYTES,
  type AvatarPayload,
} from '@heyta/shared-schema';

/** 失败原因分类。**每种对应界面上一句不同的话**，所以不许合并。 */
export type AvatarFileError =
  /** 不是契约白名单里的格式（白名单在服务端不可见 ⇒ 只有这里能拦）。 */
  | 'bad-type'
  /** 压到方形后仍然超过 `ACCOUNT_AVATAR_MAX_SOURCE_BYTES`。 */
  | 'too-big'
  /** 浏览器解不开这张图（坏文件、或它根本不是图片）。 */
  | 'undecodable';

export type EncodedAvatar =
  | { ok: true; image: AvatarPayload }
  | { ok: false; error: AvatarFileError };

/** 抽出 `data:` URL 的 base64 段。 */
function base64Of(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? '' : dataUrl.slice(comma + 1);
}

/** base64 字符串还原成字节数（不实际解码：尾部 `=` 才是唯一需要小心的地方）。 */
function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * 读一张文件并压成 `{ contentType, dataBase64 }`。
 *
 * ⚠️ 保留 PNG 的**透明通道**（有 alpha 的图转成 JPEG 会把透明铺成黑底）：
 * 判据用 `alpha` 是否存在，而不是文件后缀。原图是 PNG 就继续输出 PNG。
 */
export async function loadAvatarImage(file: File): Promise<EncodedAvatar> {
  if (!(ACCOUNT_AVATAR_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: 'bad-type' };
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode-failed'));
      el.src = url;
    }).catch((): null => null);
    if (image === null || image.naturalWidth === 0 || image.naturalHeight === 0) {
      return { ok: false, error: 'undecodable' };
    }

    // 短边居中裁成正方形。
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - side) / 2;
    const sy = (image.naturalHeight - side) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = ACCOUNT_AVATAR_EDGE_PX;
    canvas.height = ACCOUNT_AVATAR_EDGE_PX;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return { ok: false, error: 'undecodable' };
    ctx.drawImage(image, sx, sy, side, side, 0, 0, ACCOUNT_AVATAR_EDGE_PX, ACCOUNT_AVATAR_EDGE_PX);

    const contentType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const dataUrl = canvas.toDataURL(contentType, contentType === 'image/jpeg' ? 0.86 : undefined);
    const dataBase64 = base64Of(dataUrl);
    if (dataBase64 === '') return { ok: false, error: 'undecodable' };
    // 🔴 上限判的是**压缩之后**的字节 —— 原图多大不是我们能选的（一张 4 MB 的截图
    // 压完可能 60 KB），而"原图超了所以拒绝"会把绝大多数手机相册里的照片挡在门外。
    if (decodedBytes(dataBase64) > ACCOUNT_AVATAR_MAX_SOURCE_BYTES) {
      return { ok: false, error: 'too-big' };
    }
    return { ok: true, image: { contentType, dataBase64 } };
  } finally {
    // 不 revoke 会一直占着这张图的内存直到页面卸载 —— 用户连选三次就是三张原图。
    URL.revokeObjectURL(url);
  }
}
