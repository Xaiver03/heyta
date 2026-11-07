/**
 * 附件展示模型（共享 · 纯逻辑）
 * =============================
 *
 * `packages/domain/src/attachments.ts` 管**领域判断**（哪些附件算活着的、
 * 按什么顺序、字节数该显示成哪一档），本文件只管**把那些判断翻成"一行上要写什么"**。
 * 两者之间不许长第三份：
 *
 *   · 过滤与排序 → `aliveAttachmentsForTask`（动作层已经调过，见
 *     `app-host/src/attachment-actions.ts` 的 `attachmentsForTask`）；
 *   · 档位（bytes / kb / mb）与舍入 → `attachmentSizeIn`（`@heyta/domain`）；
 *   · **单位词与模板** → 宿主（`{n} KB` 是文案，共享层不 import `@heyta/i18n`，
 *     理由与 `EmptyState` / `ReminderList` 同一个：那会拖进第二份 React）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么"大小格式化"必须住在共享层
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 档位判断已经在领域层（上面那条），但**"缺体积时显示什么"**这一格两端的
 * 自然写法会分叉：一端写 `sizeBytes ?? 0`，另一端写"有没有这一格"。前者把
 * 一条老数据画成 `0 字节`，后者整行不显示体积 —— 同一份附件在两个端上是两句话
 * （"0 字节"与"不知道多大"不是同一件事，理由在 `attachments.ts` 的
 * `attachmentBytesTotal` 注释里）。{@link attachmentSizeLabelOf} 把这一格也收成一处：
 * 缺席 ⇒ `undefined` ⇒ 宿主**不渲染那一行**，而不是渲染一个 0。
 *
 * ⚠️ 只做映射、不做判断 —— 本文件里没有"哪些算图片""要不要排序"这类规则，
 * 它们全在 `@heyta/domain`。图片判定（`isImageAttachment`）**故意没有接**：
 * 两端的参考实现（`apps/mobile/src/screens/TaskDetailSheet.tsx` 的附件区）行首
 * 都不画图标，接进来就是一次没有判据的外观变更，而不是"把规则收到一处"。
 */

import { attachmentSizeIn } from '@heyta/domain';

/**
 * 一行附件需要的**最小读面**（动作层给的是 `Attachment` 实体，比这个宽）。
 *
 * ⚠️ 与 `AttachmentLike` 分开：那个是领域层的过滤/排序输入（`deletedAt` 才是
 * 它的重点），这里是**展示**输入 —— 只要列表上真的要写出来的那三格。
 */
export interface AttachmentItem {
  readonly id: string;
  /** 展示用文件名（含扩展名）。空/超长的拦截在领域层（`attachmentRejection`）。 */
  readonly fileName: string;
  /**
   * 字节数（服务端测到的那个数，不是客户端估的）。
   *
   * 缺席 = 这条老数据没记过大小 ⇒ **整行不显示体积**（见文件头）。
   */
  readonly sizeBytes?: number | undefined;
}

/**
 * 体积那一行的**三种模板**，由宿主注入。
 *
 * 🔴 形状是三个函数而不是一个 `Record<单位, 模板>` + 共享层的 `{n}` 插值：
 * 插值语法属于 i18n 包（`{n}` 是它的事），共享层自己再实现一遍就成了第二份
 * 模板引擎 —— 而两份对"缺参数时怎么办"的回答必然不同。
 */
export interface AttachmentSizeLabels {
  readonly bytes: (value: number) => string;
  readonly kb: (value: number) => string;
  readonly mb: (value: number) => string;
}

/**
 * 字节数 → 这一行要显示的字符串（档位与舍入**只**来自 `attachmentSizeIn`）。
 *
 * ⚠️ 负数 / `NaN` / 非有限值由领域层归零（它自己做 `Math.floor` 与 `> 0` 判断），
 * 这里不复判 —— 复判就是第二份档位规则。
 */
export function formatAttachmentSize(bytes: number, labels: AttachmentSizeLabels): string {
  const size = attachmentSizeIn(bytes);
  if (size.unit === 'mb') return labels.mb(size.value);
  if (size.unit === 'kb') return labels.kb(size.value);
  return labels.bytes(size.value);
}

/**
 * 这一行的体积文字；**没有大小的老数据返回 `undefined`**（宿主据此整行不画）。
 *
 * 🔴 不要把 `undefined` 兜成 `0`：见文件头。这一枚是"缺席"这一格唯一的出口，
 * 两个端都从它取，所以不可能出现"电脑上写 0 字节、手机上什么都不写"。
 */
export function attachmentSizeLabelOf(
  item: AttachmentItem,
  labels: AttachmentSizeLabels,
): string | undefined {
  return item.sizeBytes === undefined ? undefined : formatAttachmentSize(item.sizeBytes, labels);
}

/**
 * 附件这条链上**可能出现的失败原因**（封闭词表）。
 *
 * 三段来源，这里收成一份：
 *   · `too-large` / `quota-exceeded` / `network` / `rejected` —— 上传通道
 *     （`app-host/src/attachment-http.ts` 的 `AttachmentUploadResult.reason`）；
 *   · `no-channel` —— 这台设备没有接上传通道（`attachment-actions.ts` 的 `requireChannel`）；
 *   · `read-failed` —— 选中的文件本身读不出来（宿主那一层，移动端在
 *     `lib/attachment-pick.ts`）。
 *
 * 🔴 **为什么不用 `rejectionReasonOf`**（`../subtasks/model.ts` 那一枚）：
 * 它的正则写的是 `/（([a-z_]+)）/` —— **不认连字符**，而这条链上两个最要紧的
 * 原因恰恰带连字符（`too-large` / `quota-exceeded`）。用它读，两个都会判成
 * "认不出来"，于是界面把"额度满了"和"文件太大"一起降级成一句统称
 * —— 而用户要做的两件事完全相反（去清理 vs 换个小文件）。
 * ⚠️ 那一枚是给 `setParent` 的（`cycle` / `depth_exceeded`，全是下划线）写的，
 * 不是这里写错了；补它的词表属 `subtasks` 那条线，本单不改共享层别的目录。
 */
export type AttachmentFailureReason =
  | 'too-large'
  | 'quota-exceeded'
  | 'network'
  | 'no-channel'
  | 'rejected'
  | 'read-failed';

/** 词表的运行时形态（解析结果必须落在它里面，否则算"认不出来"）。 */
const ATTACHMENT_FAILURE_REASONS: readonly string[] = [
  'too-large',
  'quota-exceeded',
  'network',
  'no-channel',
  'rejected',
  'read-failed',
];

/**
 * 从动作层抛上来的错误里取**机器可读的原因**。
 *
 * 动作层的消息形状是 `上传失败（quota-exceeded）`（全角括号 + 原因 + 给人看的上下文），
 * 见 `attachment-actions.ts`。找不到、或找到的词不在 {@link ATTACHMENT_FAILURE_REASONS}
 * 里 ⇒ `undefined`（调用方落回统称）。**不猜**：猜错方向的提示比一句笼统的话更害人。
 */
export function attachmentFailureReasonOf(cause: unknown): AttachmentFailureReason | undefined {
  const message = cause instanceof Error ? cause.message : String(cause);
  const match = /（([a-z][a-z-]*)）/u.exec(message);
  const reason = match?.[1];
  if (reason === undefined || !ATTACHMENT_FAILURE_REASONS.includes(reason)) return undefined;
  return reason as AttachmentFailureReason;
}
