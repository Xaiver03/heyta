/**
 * 从相册/文件里选一张图，压成头像契约要的形状（**平台能力**那一半）
 * ================================================================
 *
 * 与 `apps/web/src/features/settings/avatar-encode.ts` 是同一件事的两种做法：
 * 浏览器用 `<canvas>`，Android 用 `Bitmap`。两边**共用的那几条规则**
 * （格式白名单、输出格式、压缩阶梯、压缩后字节上限）都在 `@heyta/shared-schema`：
 * `isAvatarContentType` / `avatarOutputContentType` / `avatarEdgeOnlyLadder` / `planAvatarUpload`。
 * 这里一行产品判断都不写（AGENTS §3.5）—— 写了就是"同一件事两处各裁一遍"，
 * 而它的症状从来不是报错，是"同一张图网页传得上、手机传不上"。
 *
 * ## 🔴 为什么这里跟着 web 一起逐档降边长
 *
 * 头像不再"压一次、超预算就拒"。`avatarEdgeOnlyLadder(sourceType)` 与 web 的
 * `avatarCompressionLadder` 走**同一串边长**（512 → 384 → 288 → 216 → 160 → 128），
 * 末档 128 px 由算术保证必然进预算。原生 `prepareAvatarBase64` 的质量写死在 86，
 * 不能像 web 那样逐次降质量，所以这里只在**边长**上走阶梯；少掉的只是"先降质量"的优化，
 * 兜底精度不变，且与 web 保底的同一条 128 px 对齐。
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
  avatarEdgeOnlyLadder,
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

  // 同一串边长，逐档试到进预算为止（末档 128 px 必然收得下）。
  let sawTooBig = false;
  for (const step of avatarEdgeOnlyLadder(sourceType)) {
    let dataBase64: string;
    try {
      dataBase64 = await mod.prepareAvatarBase64(uri, step.edgePx, step.contentType);
    } catch (e: unknown) {
      // 原生侧分码回抛的错都是**致命**的（解不开 / 没权限 / 没文件）——
      // 换更小的边长也救不回来，按码说话、不再往下试。
      const code = (e as { code?: string }).code ?? '';
      return { ok: false, error: codeToError[code] ?? 'undecodable' };
    }
    const plan = planAvatarUpload({ contentType: step.contentType, dataBase64 });
    if (plan.action === 'accept') return { ok: true, image: plan.payload };
    // `too-big` 才继续降档；`empty`（原生回了空串）跳过这一档，与 web 同语义。
    if (plan.reason === 'too-big') sawTooBig = true;
  }
  return { ok: false, error: sawTooBig ? 'too-big' : 'undecodable' };
}
