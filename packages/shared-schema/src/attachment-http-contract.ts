/**
 * 附件字节通道的**线协议契约**（工单 #9）
 * ======================================
 *
 * ## 为什么字节不能走 op-log
 *
 * op-log 的载荷参与**每一次**全量快照与增量同步：把一张 3MB 的图塞进 op，
 * 等于每台新设备第一次同步都要重传这张图，而且账号级的 `payloadBytes`
 * 统计与单条 op 上限全被撑变形。所以这里把它拆成两条通道：
 *
 *   · **元数据**（文件名 / MIME / 字节数）= `ATTACHMENT` 实体，走 op-log，
 *     因此它跨设备同步、受整库加密档位管；
 *   · **字节** = 下面这条通道，以**附件实体的 id** 为键，
 *     先例是 `UserAvatar.data Bytes` + 账号上的 `storageQuotaBytes`。
 *
 * ## 🔴 加密口径按 ADR-0081：**跟随整库档位，不单独强制 E2EE**
 *
 * 默认档是明文 `readable`（服务端能看到内容，才能帮用户找回），
 * 端到端加密是**整库**的显式选择。附件不在这条决定之外：
 * 明文档下服务端拿到的是明文字节，E2EE 档下拿到的是密文 ——
 * 由客户端在上传前按当前档位加密，服务端只存不解读。
 * ⚠️ 这一条要写进界面文案：用户在明文档上传附件时，"服务器看得到这些文件"
 * 与"任务内容看得到"是同一件事，不能对附件单独给一个更强的承诺。
 *
 * ## 为什么 id 由客户端先生成
 *
 * 上传必须发生在实体存在**之前**（否则用户等一个"先建实体再传字节"的两步
 * 半途失败），而 blob 的键要提前定下来。客户端生成 id → 传字节 → 发 CREATE op，
 * 于是：
 *   · 传成功、op 失败 ⇒ 服务端多一个没有主人的 blob（配额算得出、可回收），
 *     但**不会出现"有实体没有字节"**那种点开就报错的附件；
 *   · 重试同一个附件时键不变 ⇒ 上传天然幂等。
 */

import { z } from 'zod';

/**
 * 单个附件的字节上限。
 *
 * 取 20 MiB 而不是更大：账号默认配额是 100 MiB（`storageQuotaBytes` 默认值），
 * 一个 20 MiB 的口子意味着"最多五个文件就满"，那是用户能自己算过来的量级；
 * 放到 100 MiB 会变成"一个文件就把整个账号塞满"，而配额满的报错
 * 出现在第五个文件上时，用户已经上传了前四个。
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** 附件字节通道的路由（客户端与服务端同一份，不各写一遍字符串）。 */
export const ATTACHMENT_ROUTES = {
  /** `PUT` 上传字节（JSON body 里的 base64，与头像同形，不引 multipart 依赖）。 */
  upload: (attachmentId: string): string => `/api/attachments/${attachmentId}`,
  /** `DELETE` 只回收字节；实体由 op-log 的墓碑负责。 */
  remove: (attachmentId: string): string => `/api/attachments/${attachmentId}`,
  // ⚠️ **这一条通道上没有 `GET`** —— 不是漏了，是这一轮没有能用它的界面：
  // 把字节取回来只有两条路，两条都不该塞进这一刀：
  //   · base64 进 JS 再拼 `data:` URI —— 一张 20 MB 的图要过两次 RN 桥，
  //     在 Hermes 上是可观测的卡顿加内存尖峰（头像那条能这么走只因为它 ≤ 1 MiB
  //     且已经压成正方形小图，见 ADR-0079 那条链）；
  //   · 原生把响应直接落进本机文件再交给系统预览 —— 需要一枚新的原生模块方法，
  //     而 iOS 侧那台工程连"读本机字节"的原生模块都还没有（见 `lib/attachment-pick.ts` 文件头）。
  // 所以"点开附件"连同它的 GET 路由一起记在 `docs/plans/task-detail-ticktick-parity.md` §5.9
  // 的未做清单里。**先把能诚实做完的那一半做完。**
} as const;

/**
 * 🔴 服务端注册路由用的**模式**（不是某个具体 id 的路径）。
 *
 * 它与 `ATTACHMENT_ROUTES` 必须指向同一条路，而两边的写法天然不同（一边是
 * `:attachmentId`、一边是真 id）。把模式也只留一份字面量，注册处
 * `fastify.put(ATTACHMENT_ROUTE_PATTERN, ...)` 直接 import 它 ——
 * 契约与实现漂移的症状是 404，不是报错（与 `ACCOUNT_PROFILE_PATHS` 同一条纪律）。
 */
export const ATTACHMENT_ROUTE_PATTERN = '/attachments/:attachmentId';

/**
 * 附件 id 的形状闸门。
 *
 * 它同时是**路径段的安全性**依据：id 会出现在 URL 里，含 `/`、`%`、`?`
 * 的字符串会让一条请求打到别的路由上。`att-${randomId()}` 的两种运行时分支
 * （UUID 与 base36 回退）都落在这个字符集里。
 */
export const ATTACHMENT_ID_REGEX = /^att-[A-Za-z0-9-]{8,64}$/u;

/**
 * base64 形态的请求体上限。
 *
 * base64 每 3 字节膨胀成 4 个字符，所以 `dataBase64` 的长度最多是
 * `MAX_ATTACHMENT_BYTES` 的 4/3。这个数字必须**由源字节上限推导**，不能另写一遍：
 * 手写的两个数一旦不同步，症状就是"文件明明没超限，却总被拒"（或反过来）。
 */
export const MAX_ATTACHMENT_UPLOAD_BASE64_BYTES = Math.ceil(
  (MAX_ATTACHMENT_BYTES / 3) * 4,
);

/** 与 `ATTACHMENT_ID_REGEX` 同一个字符集的 zod 版（错误信息给人看，正则给机器）。 */
const base64Schema = z
  .string()
  .min(1, '附件内容不能为空')
  .regex(/^[A-Za-z0-9+/]+={0,2}$/u, '附件必须是标准 base64')
  .max(
    MAX_ATTACHMENT_UPLOAD_BASE64_BYTES,
    `附件超过 ${String(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MiB 单文件上限`,
  );

/** `PUT /attachments/:id` 的请求体。 */
export const attachmentUploadSchema = z.object({
  /** 原始字节的 base64。明文档下就是文件本身，E2EE 档下是客户端密文。 */
  dataBase64: base64Schema,
  /** 客户端带来的 MIME；服务端只回填，不解读内容。 */
  contentType: z.string().min(1).max(128, 'MIME 类型不合法'),
});
export type AttachmentUploadPayload = z.infer<typeof attachmentUploadSchema>;

/** 这条通道独有的错误码（与 `SYNC_ERROR_CODES` 分开，因为它不是 op 上传）。 */
export const ATTACHMENT_ERROR_CODES = {
  /** 超过 `MAX_ATTACHMENT_BYTES`。 */
  tooLarge: 'ATTACHMENT_TOO_LARGE',
  /** 账号配额已满（`storageUsedBytes + size > storageQuotaBytes`）。 */
  quotaExceeded: 'STORAGE_QUOTA_EXCEEDED',
} as const;

export type AttachmentErrorCode = (typeof ATTACHMENT_ERROR_CODES)[keyof typeof ATTACHMENT_ERROR_CODES];
