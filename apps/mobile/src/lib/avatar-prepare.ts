/**
 * 从相册/文件里选一张图，压成头像契约要的形状（**平台能力**那一半）
 * ================================================================
 *
 * 与 `apps/web/src/features/settings/avatar-encode.ts` 是同一件事的两种做法：
 * 浏览器用 `<canvas>`，Android 用 `Bitmap`。两边**共用的那三条规则**
 * （格式白名单、输出格式、压缩后字节上限）都在 `@heyta/shared-schema`：
 * `isAvatarContentType` / `avatarOutputContentType` / `planAvatarUpload`。
 * 这里一行产品判断都不写（AGENTS §3.5）—— 写了就是"同一件事两处各裁一遍"，
 * 而它的症状从来不是报错，是"同一张图网页传得上、手机传不上"。
 *
 * ## 为什么必须走原生，而不是 `readLocalTextUri` + JS 里 base64
 *
 * `readTextUri` 按 `Charsets.UTF_8` 把字节强转成字符串，对 PNG/JPEG 是**有损**的
 * （非法 UTF-8 序列被替换字符吃掉）—— 拿它读图片，结局是"上传成功而服务端解不开"。
 * 所以二进制由 `HeytaLocalFs.prepareAvatarBase64` 直接回 base64。
 *
 * ## 🔴 没有这个模块时说的是"没有通道"，不是"图不行"
 *
 * iOS 侧目前没有对应原生模块（本工程是经典分组，加 `.m/.swift` 要改 pbxproj）。
 * 那条路必须**单独一句话**：把它折叠成 `undecodable` 会让界面说"这张图解不开"，
 * 而真相是"这台设备还没接上读图通道" —— 后者用户还能等版本，前者只会让他换一张照片。
 */

import {
  ACCOUNT_AVATAR_EDGE_PX,
  avatarOutputContentType,
  isAvatarContentType,
  planAvatarUpload,
  type AvatarPayload,
} from '@heyta/shared-schema';

import { nativeModule } from './local-file-read';

/** 每种失败对应界面上一句不同的话，所以不许合并。 */
export type AvatarPrepareError =
  | 'bad-type'
  | 'too-big'
  | 'undecodable'
  /** 这台设备没有读图通道（iOS 当前就是这一档）。 */
  | 'no-channel';

export type PreparedAvatar =
  | { ok: true; image: AvatarPayload }
  | { ok: false; error: AvatarPrepareError };

/** 原生侧的错误码 → 界面那一句话。分码回抛的意义就在这里。 */
const codeToError: Record<string, AvatarPrepareError> = {
  DECODE_FAILED: 'undecodable',
  ENCODE_FAILED: 'undecodable',
  OPEN_NULL: 'undecodable',
  READ_DENIED: 'undecodable',
  READ_FAILED: 'undecodable',
  BAD_FORMAT: 'bad-type',
  BAD_EDGE: 'no-channel',
};

/**
 * @param uri 选来的图的 URI（SAF 的 `content://` 或 `keepLocalCopy` 的 `file://`）
 * @param sourceType 它的 MIME（`pick()` 回的那个 `type`）
 */
export async function prepareAvatarFromUri(
  uri: string,
  sourceType: string,
): Promise<PreparedAvatar> {
  if (!isAvatarContentType(sourceType)) return { ok: false, error: 'bad-type' };

  const mod = nativeModule();
  if (typeof mod?.prepareAvatarBase64 !== 'function') {
    return { ok: false, error: 'no-channel' };
  }

  const contentType = avatarOutputContentType(sourceType);
  try {
    const dataBase64 = await mod.prepareAvatarBase64(uri, ACCOUNT_AVATAR_EDGE_PX, contentType);
    const plan = planAvatarUpload({ contentType, dataBase64 });
    if (plan.action === 'reject') {
      // `empty` 在原生侧已经被 `ENCODE_FAILED` 拦掉了；真走到这里说明
      // 通道回了一个空串 —— 那是"解不开"这一类，不是"太大"。
      return { ok: false, error: plan.reason === 'too-big' ? 'too-big' : 'undecodable' };
    }
    return { ok: true, image: plan.payload };
  } catch (e: unknown) {
    const code = (e as { code?: string }).code ?? '';
    return { ok: false, error: codeToError[code] ?? 'undecodable' };
  }
}
