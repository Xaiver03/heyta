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
  ACCOUNT_AVATAR_EDGE_PX,
  avatarOutputContentType,
  isAvatarContentType,
  planAvatarUpload,
  type AvatarPayload,
  type AvatarRejectReason,
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

/**
 * 共享裁决的三种拒绝 → 界面那三句话。
 *
 * ⚠️ `empty` 归到 `undecodable` 那句，**不是**新加一句文案：编码结果为空串在
 * 浏览器这一侧只可能是"画布没画出东西"，与解不开图是同一件对用户来说的事。
 * 而"上限是多少、白名单里有哪几种格式"这两条判断**不在这里** —— 它们在
 * `planAvatarUpload`，与移动端共用（原来 `decodedBytes` 住在本文件，
 * 等于把一条产品规格的实现留在了一个壳里，见 AGENTS §3.5）。
 */
const reasonToError: Record<AvatarRejectReason, AvatarFileError> = {
  'bad-type': 'bad-type',
  'too-big': 'too-big',
  empty: 'undecodable',
};

/**
 * 读一张文件并压成 `{ contentType, dataBase64 }`。
 *
 * ⚠️ 保留 PNG 的**透明通道**（有 alpha 的图转成 JPEG 会把透明铺成黑底）：
 * 判据用 `alpha` 是否存在，而不是文件后缀。原图是 PNG 就继续输出 PNG。
 */
export async function loadAvatarImage(file: File): Promise<EncodedAvatar> {
  // 白名单在**动手解码之前**问一句（`isAvatarContentType` 与 `planAvatarUpload`
  // 内部是同一个判法，这里只是把它提前到花画布时间之前）。
  if (!isAvatarContentType(file.type)) {
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

    const contentType = avatarOutputContentType(file.type);
    const dataUrl = canvas.toDataURL(contentType, contentType === 'image/jpeg' ? 0.86 : undefined);
    const comma = dataUrl.indexOf(',');
    const dataBase64 = comma === -1 ? '' : dataUrl.slice(comma + 1);
    const plan = planAvatarUpload({ contentType: file.type, dataBase64 });
    if (plan.action === 'reject') return { ok: false, error: reasonToError[plan.reason] };
    return { ok: true, image: plan.payload };
  } finally {
    // 不 revoke 会一直占着这张图的内存直到页面卸载 —— 用户连选三次就是三张原图。
    URL.revokeObjectURL(url);
  }
}
