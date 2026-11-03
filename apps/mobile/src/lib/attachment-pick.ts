/**
 * 选一个文件并读成附件契约要的那串 base64（**平台能力**那一半，工单 #9）
 * ====================================================================
 *
 * 结构与 `lib/avatar-prepare.ts` 一一对应，因为它们是同一件事的两种规模：
 * "从系统选一个东西 → 拿到字节 → 按契约检查 → 交给 app-host 上传"。
 *
 * ## 为什么字节必须走原生
 *
 * RN 0.84.1 / Android 上 `fetch(content://)` 与 `XHR(responseType:'blob')`
 * **都读不出本机 URI**（真因在 `NetworkingModule` 用 OkHttp 造假响应，
 * 只接受 http/https —— 见 `local-file-read.ts` 的文件头）。所以这里只有一条路：
 * `HeytaLocalFs.readUriBase64`。它回的是**原始字节**的 base64 —— 与头像那枚
 * `prepareAvatarBase64` 不同，后者按头像契约重编码过，对附件来说是换文件。
 *
 * ## 🔴 取不到通道时说"这台设备没有读字节的通道"，不说"这个文件读不开"
 *
 * iOS 侧目前没有对应原生模块（本工程是经典分组，加 `.m/.swift` 要改 pbxproj）。
 * 把它折叠成 `read-failed` 会让界面说"这个文件损坏了"，而真相是"这台设备还没接上" ——
 * 前者用户会换一个文件重试，后者只会让他等版本。两类失败的动作不一样，
 * 所以错误码不许合并（与 `avatar-prepare` 的 `no-channel` 同一条理由）。
 */

import { MAX_ATTACHMENT_BYTES } from '@heyta/shared-schema';

import { nativeModule } from './local-file-read';

/**
 * 每种失败对应界面上一句不同的话，所以不许合并。
 *
 * ⚠️ 这里**没有** `canceled`：用户在系统选择器里按取消是 `pick()` 那条 Promise
 * 被拒（`code === 'OPERATION_CANCELED'`），不是"读文件读失败"。把它塞进这张表
 * 就会逼调用方给一句取消的文案，而正常路径不该有句子。
 */
export type AttachmentPickError =
  /** 这台设备没有读字节通道（iOS 当前就是这一档）。 */
  | 'no-channel'
  /** 文件超过单文件上限。 */
  | 'too-large'
  /** 有通道，但这一次没读成（权限被拒 / URI 已失效 / 原生读失败 / 取不到名字）。 */
  | 'read-failed';

export type PickedAttachment = {
  ok: true;
  /** 展示名：优先用选择器给的 `name`，没有就从 URI 尾巴上取。 */
  fileName: string;
  /** MIME；缺 = 未知，界面降级为"不显示预览"。 */
  contentType?: string;
  dataBase64: string;
};

export type PickAttachmentResult = PickedAttachment | { ok: false; error: AttachmentPickError };

/**
 * 选择器回的那个文档形状（只取这里用得上的几格）。
 *
 * ⚠️ 每格都写成 `? | null`：`@react-native-documents/picker` 在缺信息时给的是
 * `null` 而不是 `undefined`（两端还不完全一致）。只写 `?` 的话，同一份数据
 * 在 iOS 上编译得过、在 Android 的回包上类型就是错的。
 */
export interface PickedDocument {
  uri: string;
  name?: string | null;
  type?: string | null;
  nativeType?: string | null;
  size?: number | null;
}

/**
 * `content://…/1234567` 这类没有 `name` 的 URI，从末段取一个可读的名字。
 *
 * ⚠️ 取不到就回空串，**不编一个中文名**：这里是写进实体、以后每一台设备都要显示的
 * 那串字符。编出来的"附件"既不是文件名，也永远不会被翻译层覆盖到
 * （`packages/i18n` 的门禁只管界面文案，不管数据）。
 */
function nameFromUri(uri: string): string {
  const tail = (uri.split('/').at(-1) ?? '').split('?')[0] ?? '';
  try {
    return decodeURIComponent(tail);
  } catch {
    // 百分号编码坏了（`%zz` 之类）：按原样用，不为一个畸形 URI 抛穿整条链路。
    return tail;
  }
}

const codeToError: Record<string, AttachmentPickError> = {
  OPEN_NULL: 'read-failed',
  READ_DENIED: 'read-failed',
  READ_FAILED: 'read-failed',
  TOO_LARGE: 'too-large',
  BAD_MAX: 'no-channel',
};

/**
 * 读一个已选中的文档。
 *
 * `maxBytes` 直接取共享层的 `MAX_ATTACHMENT_BYTES`：原生侧的护栏与产品的上限
 * 🔴 **必须是同一个数**，否则会出现"原生先拒了、JS 以为是别的东西坏了"那种
 * 分不出归属的失败。
 */
export async function readPickedDocument(doc: PickedDocument): Promise<PickAttachmentResult> {
  // 先按选择器报的大小挡一道：省掉一次注定失败的整文件读入。
  // ⚠️ `size` 可能是 `null`/缺席，那种时候**不**当作 0，交给原生那道计数拦。
  if (typeof doc.size === 'number' && doc.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'too-large' };
  }

  const mod = nativeModule();
  if (typeof mod?.readUriBase64 !== 'function') return { ok: false, error: 'no-channel' };

  try {
    const dataBase64 = await mod.readUriBase64(doc.uri, MAX_ATTACHMENT_BYTES);
    const fileName = ((doc.name ?? '').trim() !== '' ? (doc.name ?? '').trim() : nameFromUri(doc.uri));
    // 名字取不到就不写进实体：一串空的 `fileName` 会让列表里出现一行空白，
    // 而用户无从判断那是"没名字"还是"渲染坏了"（领域层的闸门同样拒空白）。
    if (fileName === '') return { ok: false, error: 'read-failed' };
    return {
      ok: true,
      fileName,
      contentType: doc.type ?? doc.nativeType ?? undefined,
      dataBase64,
    };
  } catch (e: unknown) {
    const code = (e as { code?: string }).code ?? '';
    return { ok: false, error: codeToError[code] ?? 'read-failed' };
  }
}
