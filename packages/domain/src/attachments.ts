/**
 * 任务附件的领域规则 —— **"哪些附件、按什么序、文件名能有多长"只有一个定义**（工单 #9）
 * ======================================================================
 *
 * 实体形状在 `entities.ts` 的 {@link Attachment}（**一个附件 = 一个实体**，
 * 与 `Reminder` / `Comment` / `AssistantTurn` 同一条推理），op 的构造在
 * `packages/app-host/src/attachment-actions.ts`，字节走
 * `packages/shared-schema/src/attachment-http-contract.ts` 那条 HTTP 通道。
 * 这里只有**纯函数**。
 *
 * ## 为什么这份逻辑必须住在领域层
 *
 * 过滤与排序写在各壳的组件里，就会出现"电脑上删掉的附件在手机上还在"，
 * 而 op-log 里两条记录都是对的 —— 与 `comments.ts` 文件头第一条同一个故障。
 * 附件还有第二条只有这里能判的规矩：**配额是账号级的**，"这一条任务占了
 * 多少字节"必须是所有出口用同一个求和，否则两处显示的已用量会不一样。
 *
 * 🔴 **这里不碰任何字节**，也不决定加密档位：元数据与数据的加密口径由整库档位
 * 决定（ADR-0081），领域层不知道也不该知道上传通道长什么样。
 */

import { isLive } from './entities.js';

/**
 * 文件名的长度上限（字符数）。
 *
 * 取 200：附件名会进任务详情面那一行、进同步载荷、进服务端的日志行。
 * 真实文件名极少超过这个长度，而"粘贴一整个路径 + 超长名"是病态数据，
 * 拦它的理由与 `COMMENT_MAX_LENGTH` 完全一样 —— 闸门，不是玩法。
 */
export const ATTACHMENT_NAME_MAX_LENGTH = 200;

/** 建附件 / 改名的拒绝原因。**返回原因而不是抛错** —— 调用方要能给出提示。 */
export type AttachmentRejection = 'empty-name' | 'name-too-long';

/**
 * 校验展示用的文件名。合法则返回 `undefined`。
 *
 * 🔴 **空白算空**（`trim()` 后判断）：一个没有名字的附件在列表里是一行空白，
 * 用户既不知道它是什么，也没有别的线索可点。
 *
 * ⚠️ 返回的是**领域词表**，不是 i18n key —— 翻成界面词条是宿主的事，
 * 与 `commentRejection` 同一条边界。
 */
export function attachmentRejection(fileName: string): AttachmentRejection | undefined {
  if (fileName.trim().length === 0) return 'empty-name';
  if (fileName.trim().length > ATTACHMENT_NAME_MAX_LENGTH) return 'name-too-long';
  return undefined;
}

/**
 * 附件的**最小读面**：过滤、排序、求和只用到这几格。
 *
 * 宽到 `AttachmentLike` 而不是死盯 `Attachment`，理由与 `CommentLike` 一样：
 * 调用方既会递进物化状态里的真实体，也会递进只带视图字段的形状。
 * **多出来的字段一律不读。**
 */
export interface AttachmentLike {
  id: string;
  /** 归属的任务 id。 */
  taskId: string;
  /** 创建时刻（epoch ms）。缺席按 0。 */
  createdAt?: number;
  /** 字节数（客户端上报，仅用于显示）。 */
  sizeBytes?: number;
  /** 软删除墓碑。在 = 这条附件不进列表。 */
  deletedAt?: number;
}

/**
 * 列表顺序：`createdAt` 升序，同刻按 id 字典序。
 *
 * ⚠️ **升序**（先加的在上）而不是"最近加的在上"：一个任务的附件是**一组材料**，
 * 用户靠位置回忆"我先把合同放进去、后来补了张图"。倒序会让每次上传都把
 * 已有列表整体下移一行，而附件区常常就在滚动的边界上。
 * id 决胜的理由与 `byCommentOrder` 相同 —— `createdAt` 由 op 时间戳派生，
 * 两台设备可以落到同一毫秒。
 */
export function byAttachmentOrder(a: AttachmentLike, b: AttachmentLike): number {
  const at = a.createdAt ?? 0;
  const bt = b.createdAt ?? 0;
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 某个任务下的附件列表：**软删的不在**，`createdAt` 升序（同刻按 id）。 */
export function aliveAttachmentsForTask<T extends AttachmentLike>(
  attachments: readonly T[],
  taskId: string,
): T[] {
  return attachments
    .filter((attachment) => attachment.taskId === taskId && isLive(attachment))
    .sort(byAttachmentOrder);
}

/**
 * 一组附件占用的字节数（用于"这一条任务已用 X"）。
 *
 * 🔴 缺 `sizeBytes` 的条目按 **0** 计入，并在返回值上带不出来 —— 调用方若要
 * 如实显示，得先数一下缺了几格。这里不抛错：一条老数据缺大小是**显示降级**
 * （那行不显示体积），不该让整列表读不出来。
 */
export function attachmentBytesTotal(attachments: readonly AttachmentLike[]): number {
  let total = 0;
  for (const attachment of attachments) {
    total += attachment.sizeBytes ?? 0;
  }
  return total;
}

/**
 * 是不是图片（决定行首用图片图标还是文件图标）。
 *
 * ⚠️ 只看 MIME 前缀，不看扩展名：扩展名是用户可改的字符串，MIME 才是上传那一步
 * 由系统给的。两者不一致时以 MIME 为准 —— 它同时也是下载时 `Content-Type` 的来源。
 * ⚠️ 比较前**转小写**：MIME 类型按规范是大小写不敏感的，而各平台传上来的写法不一致
 * （`image/png` / `Image/PNG` 都出现过）。只判小写会让某些设备的图片显示成通用文件图标。
 * 缺 MIME 一律按"不是图片"处理，图标降级为通用文件图标。
 */
export function isImageAttachment(mimeType?: string): boolean {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/');
}

/** 体积该用哪一档单位。**单位词本身是文案**，所以这里只出档位，不出字符串。 */
export type AttachmentSizeUnit = 'bytes' | 'kb' | 'mb';

/**
 * 把字节数换成"该显示成哪一档 + 数值"。
 *
 * 🔴 为什么住在领域层而不是各壳里算：档位与舍入是**判断**，两个壳各写一遍的
 * 表现是同一份附件在电脑上显示 `1024 KB`、在手机上显示 `1.0 MB` ——
 * 而没人会为此报错。单位词（KB/MB/字节）留在词条里，因为那是文案。
 *
 * ⚠️ 1000 进制而不是 1024：与用户在设计稿、系统设置里看到的写法一致
 * （`1.5 MB` 的图不会在应用里变成 `1.4 MB`）。
 */
export function attachmentSizeIn(bytes: number): { value: number; unit: AttachmentSizeUnit } {
  const value = Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0;
  if (value >= 1_000_000) return { value: Math.round((value / 1_000_000) * 10) / 10, unit: 'mb' };
  if (value >= 1_000) {
    const kb = Math.round(value / 1_000);
    /**
     * ⚠️ `999_999` 四舍五入后是 `1000 KB` —— 那句话技术上没错，但没有人会写
     * "1000 KB"，它会让人以为后面还有一个更大的单位没换过来。
     * 所以这一档再升一级：`1000 KB` → `1 MB`。
     */
    if (kb >= 1_000) return { value: Math.max(Math.round((value / 1_000_000) * 10) / 10, 0.1), unit: 'mb' };
    return { value: kb, unit: 'kb' };
  }
  return { value, unit: 'bytes' };
}
