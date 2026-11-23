/**
 * 把用户选的一张图压成头像契约要的形状（**平台能力**，不是业务规则）
 * ================================================================
 *
 * 为什么单独一个文件、而且为什么住在 `apps/web` 而不是 `packages/app-host`：
 * 缩放图片需要**画布**，而画布是各端不同的东西（浏览器有 `<canvas>`、RN 有
 * `ImageEditor`、macOS 壳有 `CoreGraphics`）。AGENTS §3.5 的分界线在这里是清楚的：
 * **数字**（边长、字节上限、允许的格式、压缩阶梯）是产品规格，住 `@heyta/shared-schema`；
 * **怎么把一张图按某一档编码**是平台调用，住各自的壳。
 * 把 canvas 塞进 app-host 的后果是移动端与 macOS 壳必须 import 一个它们没有的 API。
 *
 * 🔴 输出必须是**方形**的：显示侧用 `--ht-size-avatar-*` 加圆角裁成圆，
 * 非方形进去就会被切掉一边 —— 而"我的头像怎么少了半张脸"这种事用户
 * 只会归因到应用坏了。所以在这里就把话说完：短边居中裁切，再等比缩到边长。
 *
 * ## 🔴 为什么不在这里判"太大了"
 *
 * 任何"按原图尺寸估字节"的公式都会在某一类图上失准，失准的表现是**用户被挡在门外**：
 * "这张图超过 512 KB，换一张吧"。但一张 20 MB 的手机照片压完可能只有 30 KB，
 * 而一张带大量噪点的 PNG 压完反而超限 —— 原图多大根本不是我们该拿来拒的依据。
 *
 * 所以真正的机制在共享层：`avatarCompressionLadder(file.type)` 给出"先试 512、
 * 超预算就逐档降到 128 px"的档位序列，`encodeAvatarWithinBudget` 逐档编码、逐档量字节，
 * **第一档进预算就用**，末档 128 px 由算术保证必然收得下。
 * 本文件只提供"按某一档画到画布并编码"这一个平台动作，不参与任何阈值判断。
 */

import {
  avatarCompressionLadder,
  encodeAvatarWithinBudget,
  isAvatarContentType,
  type AvatarCompressionStep,
  type AvatarPayload,
} from '@heyta/shared-schema';

/** 失败原因分类。**每种对应界面上一句不同的话**，所以不许合并。 */
export type AvatarFileError =
  /** 不是契约白名单里的格式（白名单在服务端不可见 ⇒ 只有这里能拦）。 */
  | 'bad-type'
  /** 压到最小档（128 px）仍超 `ACCOUNT_AVATAR_MAX_SOURCE_BYTES`（正常不可达）。 */
  | 'too-big'
  /** 浏览器解不开这张图（坏文件、或它根本不是图片）。 */
  | 'undecodable';

export type EncodedAvatar =
  | { ok: true; image: AvatarPayload }
  | { ok: false; error: AvatarFileError };

/**
 * 读一张文件并压成 `{ contentType, dataBase64 }`。
 *
 * ⚠️ 保留 PNG 的**透明通道**：源图是 PNG 时 `avatarCompressionLadder` 只给 PNG 档
 * （转 JPEG 会把透明铺成黑底），靠降边长减字节；其余格式输出 JPEG。
 */
export async function loadAvatarImage(file: File): Promise<EncodedAvatar> {
  // 白名单在**动手解码之前**问一句（解一张 20 MB 的奇怪文件是要花时间的，
  // 而"格式不支持"这句话不该等到画布跑完才说）。
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

    // 短边居中裁成正方形（每个档位都从这张原图重裁，不叠加缩放损失）。
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - side) / 2;
    const sy = (image.naturalHeight - side) / 2;

    // 平台动作：按给定档位画到 `edgePx × edgePx` 的画布并编码成 base64；画布拿不到
    // 或没画出东西时回 `null`，由共享层的循环跳过这一档、继续试下一档。
    const encodeStep = (step: AvatarCompressionStep): string | null => {
      const canvas = document.createElement('canvas');
      canvas.width = step.edgePx;
      canvas.height = step.edgePx;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return null;
      ctx.drawImage(image, sx, sy, side, side, 0, 0, step.edgePx, step.edgePx);
      const dataUrl = canvas.toDataURL(step.contentType, step.quality);
      const comma = dataUrl.indexOf(',');
      if (comma === -1) return null;
      const dataBase64 = dataUrl.slice(comma + 1);
      return dataBase64 === '' ? null : dataBase64;
    };

    const outcome = await encodeAvatarWithinBudget(avatarCompressionLadder(file.type), encodeStep);
    if (outcome.action === 'reject') return { ok: false, error: outcome.reason };
    return { ok: true, image: outcome.payload };
  } finally {
    // 不 revoke 会一直占着这张图的内存直到页面卸载 —— 用户连选三次就是三张原图。
    URL.revokeObjectURL(url);
  }
}
