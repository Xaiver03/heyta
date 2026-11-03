/**
 * 附件字节的**客户端传输**（工单 #9，宿主无关）
 * =============================================
 *
 * 三条 HTTP 调用，形状与 `hosted-auth.ts` 里的头像那三条一模一样：
 * JSON body + base64、Bearer 访问令牌、失败**不抛错**而是回结构化原因。
 *
 * ## 🔴 为什么它不知道"加密档位"这件事
 *
 * 传进来的 `dataBase64` 已经是**最终形态**：明文档下就是文件字节，E2EE 档下
 * 是客户端加密后的密文（ADR-0081 —— 加密是整库的决定，发生在上传之前，
 * 不在这条通道里临时决定）。本模块因此可以保持成一件纯东西：
 * 只管"把这串 base64 送到那个 id 下面"。
 * ⇒ 谁调它之前必须先过档位那一步；把这个责任写成注释而不是代码，
 *   是因为这里没有任何可以判断档位的输入。
 *
 * ## 为什么这是一个**端口**而不是直接被 action 调用
 *
 * `createAttachmentActions` 收的是 `AttachmentBlobPort`（三个方法），
 * 而这一模块是它在真网络上的那个实现。分开的理由是 `comment-actions.ts`
 * 已经走过的同一条：动作层要能在**没有网络**的测试里跑完整序列
 * （上传失败 ⇒ 不许写 op），而"能不能失败"正是这件事的全部重点。
 * 把 fetch 直接写进 action，等于让最重要的一条路径只能靠 mock 全局 fetch 来测。
 */

import {
  ATTACHMENT_ERROR_CODES,
  ATTACHMENT_ROUTES,
} from '@heyta/shared-schema';

import { sendJson, type HostedAuthOptions } from './hosted-auth.js';

/** 上传成功回执。`hash` 由服务端算，客户端不自己算（Hermes 上没有 `crypto.subtle`）。 */
export interface AttachmentUploadReceipt {
  hash: string;
  /** 服务端测量的字节数 —— 配额显示以它为准。 */
  byteCount: number;
}

/**
 * 三个方法的返回值都是**结果联合**而不是抛错：
 * 调用方（`attachment-actions.ts`）要按不同分支决定"要不要写 op"、
 * "要不要回收孤儿 blob"，而那些判断不该被一个 try/catch 抹平成同一种失败。
 */
export type AttachmentUploadResult =
  | { ok: true; receipt: AttachmentUploadReceipt }
  | {
      ok: false;
      /**
       * · `too-large` —— 服务端说这一个文件超单文件上限（`MAX_ATTACHMENT_BYTES`）
       * · `quota-exceeded` —— 账号额度满了。⚠️ 这与"文件太大"是两句话：
       *   前者让用户换一个小的文件，后者让用户去清理**已有**的东西或升级额度。
       *   合成一句就等于让一半的用户去做一件没用的事。
       * · `network` —— 一次往返没成，可重试
       * · `rejected` —— 其他非 2xx（鉴权失败、id 不合法等），重试无用
       */
      reason: 'too-large' | 'quota-exceeded' | 'network' | 'rejected';
    };

export type AttachmentRemoveResult =
  | { ok: true; releasedBytes: number }
  | { ok: false; reason: 'network' | 'rejected' };

/** `attachment-actions.ts` 认的那个端口形状。 */
export interface AttachmentBlobPort {
  upload(attachmentId: string, dataBase64: string, contentType: string): Promise<AttachmentUploadResult>;
  remove(attachmentId: string): Promise<AttachmentRemoveResult>;
  // ⚠️ 没有 `download`。这条通道上读字节需要一个能用它的界面（点开/预览），
  // 而那一刀要连原生的"下载进本机文件"一起做 —— 见契约里 `ATTACHMENT_ROUTES`
  // 那段与 `docs/plans/task-detail-ticktick-parity.md` §5.9。
  // 先写一个没人调的方法，就是本仓库反复清理的"基础设施齐了、最后一米没接"。
}

/**
 * `sendJson` 的失败 → 本模块那四个原因。
 *
 * 🔴 **只按服务端给的机器码 `code` 判别**，不按 `message` 做字符串匹配，也不按
 * HTTP 状态码猜：`hosted-auth.ts` 把这条纪律写在 `HostedAuthFailure.code` 的注释上，
 * 理由在这里同样成立 —— 状态码要过 `classifyFailure` 那一层映射，而文案一改
 * 匹配就悄悄失效，失败会静默退化成笼统的一类（"传不上去，重试"）。
 * 状态码只用作 `code` 缺席时的兜底。
 */
function classifyUploadFailure(result: { reason: string; status?: number; code?: string }): AttachmentUploadResult {
  if (result.code === ATTACHMENT_ERROR_CODES.tooLarge) return { ok: false, reason: 'too-large' };
  if (result.code === ATTACHMENT_ERROR_CODES.quotaExceeded) return { ok: false, reason: 'quota-exceeded' };
  if (result.reason === 'network' || result.reason === 'unconfigured' || result.reason === 'server-error') {
    return { ok: false, reason: 'network' };
  }
  if (result.status === 413) return { ok: false, reason: 'too-large' };
  if (result.status === 507) return { ok: false, reason: 'quota-exceeded' };
  return { ok: false, reason: 'rejected' };
}

function classifyRemoveFailure(result: { reason: string; status?: number }): AttachmentRemoveResult {
  // 404 = 本来就没有字节。删除要的终态已经到了，不该报成失败（头像同一个坑）。
  if (result.status === 404) return { ok: true, releasedBytes: 0 };
  if (result.reason === 'network' || result.reason === 'unconfigured' || result.reason === 'server-error') {
    return { ok: false, reason: 'network' };
  }
  return { ok: false, reason: 'rejected' };
}

/**
 * 用访问令牌拼一个真网络端口。
 *
 * ⚠️ `token` 是**函数**不是字符串：令牌会在一次长会话里轮换（换绑邮箱、
 * 重登、会话撤销），传字符串的那个端口会在轮换后一路 401，
 * 而用户看到的是"我传不上去"。`getAccessToken()` 给空 = 这台设备没登录，
 * 于是三个方法都直接回 `rejected`，不发请求。
 */
export function createAttachmentBlobPort(
  options: HostedAuthOptions,
  getAccessToken: () => string | undefined,
): AttachmentBlobPort {
  const token = (): string | undefined => {
    const raw = getAccessToken();
    if (raw === undefined || raw.trim() === '') return undefined;
    return raw;
  };

  return {
    async upload(attachmentId, dataBase64, contentType) {
      const access = token();
      if (access === undefined) return { ok: false, reason: 'rejected' };
      const result = await sendJson(
        options,
        'PUT',
        ATTACHMENT_ROUTES.upload(attachmentId),
        { dataBase64, contentType },
        access,
      );
      if (!result.ok) return classifyUploadFailure(result);
      const body = result.body as Partial<AttachmentUploadReceipt> | undefined;
      if (body === undefined || typeof body.hash !== 'string' || typeof body.byteCount !== 'number') {
        // 2xx 但形状不对：绝不当成功（`sendJson` 对这条纪律写得很硬）。
        return { ok: false, reason: 'rejected' };
      }
      return { ok: true, receipt: { hash: body.hash, byteCount: body.byteCount } };
    },

    async remove(attachmentId) {
      const access = token();
      if (access === undefined) return { ok: false, reason: 'rejected' };
      const result = await sendJson(options, 'DELETE', ATTACHMENT_ROUTES.remove(attachmentId), undefined, access);
      if (!result.ok) return classifyRemoveFailure(result);
      const body = result.body as { releasedBytes?: number } | undefined;
      return { ok: true, releasedBytes: typeof body?.releasedBytes === 'number' ? body.releasedBytes : 0 };
    },
  };
}

