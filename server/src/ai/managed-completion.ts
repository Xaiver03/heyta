/**
 * 托管（云端）AI 的**唯一一条发送腿**：闸门顺序、境内白名单、额度、上游请求的组装都只在这里。
 * ================================================================================
 *
 * 2026-10-27 从 `managed-proxy.routes.ts` 提出来，动机是自动收集新增的那条**服务端**抽取腿
 * （[ADR-0077](../../../docs/adr/0077-inbound-hosted-extraction-at-ingest.md)）：
 * 接收 webhook 时服务端要当场把事件正文交给模型抽字段。那条路没有 JWT、没有 HTTP 请求体，
 * 但它**必须**过与 `POST /api/ai/managed/chat` 一模一样的闸门——否则"发送点自己复算一次白名单"
 * （ADR-0056 §5 第 2 条）与"不保留内容"（ADR-0054 §3）就各自长出一份实现，
 * 而本仓库反复记过的那条是：**抽出一份共享实现不等于重复被消除了**，
 * 所以这里的判据是"`/chat/completions` 这枚端点路径在整个 `server/src` 里只出现一次"
 * （常驻断言在 `server/tests/inbound-hosted-extraction.spec.ts` 的最后一条）。
 *
 * ## 🔴 闸门顺序（顺序本身就是判据，与提出来之前一字未动）
 *
 * ```
 *   ②' 体积闸门（只看字节数）      → 400 INVALID_BODY / too_large
 *   ③  上游是否配置                → 503 MANAGED_AI_NOT_CONFIGURED
 *   ④  境内白名单（预检）          → 409 AI_UPSTREAM_NOT_DOMESTIC
 *   ⑤  权益 + 额度（原子）         → 402 SUBSCRIPTION_REQUIRED / 409 AI_QUOTA_EXCEEDED
 *   ⑥  境内白名单（发送点复算）    → 409 AI_UPSTREAM_NOT_DOMESTIC
 *   ⑦  真的发请求                  → 2xx 透传 / 502 AI_UPSTREAM_REQUEST_FAILED
 * ```
 *
 * ① 鉴权不在这里：它是 HTTP 层的 `preHandler`，而服务端抽取腿的"鉴权"是**签名 + 权益判定**，
 * 由 `automation/inbound.routes.ts` 自己在调用之前做完。
 *
 * 三条不能反的理由与原来相同，`server/tests/managed-proxy.routes.spec.ts` 逐条钉着：
 * ⑤ 在 ⑦ 之前（超额的请求不许打出去）、④ 在 ⑤ 之前（配置不合格不许白扣额度）、
 * ⑥ 与 ④ 是同一枚纯函数被调两次（发送点必须自己算一次）。
 *
 * ## 🔴 这里**不**留内容 —— 一次调用之后什么都不剩（ADR-0054 §3）
 *
 * 入参的 `messages` 与上游的响应体只在这一次调用的内存里存在。落盘的只有元数据：
 * 时间、用户、功能名（封闭词表）、结果状态、**字节数**、耗时 —— 一列内容都没有。
 * `recordManagedAiAttempt` 的参数表就是保留清单：它**没有任何接"用户内容"的位置**。
 *
 * 两个具体的泄露口子照搬过来、一个都没堵漏：
 * 1. 上游的非 2xx 响应体一律不回显、不读取（供应商的 4xx 文本常把请求内容抄回来）；
 * 2. 解析不出的端点不回显在错误里（`https://<key>@host` 是合法 URL）——见 `managed-upstream.ts`。
 */
import { Readable } from 'node:stream';

import { Logger } from '../logger';
import type { ManagedAiConfig } from '../config';
import type { SqlExecutor } from '../billing/pricing-store';
import { consumeManagedAiRequest } from './metering';
import { domesticUpstreamVerdict, type ServerManagedAiFeature, type ServerManagedModelHost } from './managed-upstream';

/** 一次托管调用的入参：**没有** `model`、`baseUrl`，也**没有**客户端自报的计数（AGENTS §8.10）。 */
export interface ManagedAiCompletionRequest {
  readonly userId: number;
  /** 封闭词表里的功能名。类型不是 `string` 的理由见 `managed-proxy.routes.ts` 里那段注释。 */
  readonly feature: ServerManagedAiFeature;
  readonly messages: readonly ManagedAiMessage[];
  readonly tools?: readonly ManagedAiTool[];
  readonly toolChoice?: 'auto';
  readonly stream?: boolean;
}

export interface ManagedAiMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** OpenAI 兼容线要求工具观察结果回填对应的调用 id（键名是下划线，不是驼峰）。 */
  readonly tool_call_id?: string;
}

export interface ManagedAiTool {
  readonly type: 'function';
  readonly function: { readonly name: string; readonly description: string; readonly parameters: unknown };
}

/** 调用一次的闸门配置：全部由**服务端**提供，调用方不许从请求体里凑。 */
export interface ManagedAiCompletionContext {
  readonly upstream: ManagedAiConfig | undefined;
  readonly sql: SqlExecutor;
  readonly limit: number;
  readonly now: () => number;
  readonly transport: ManagedAiTransport;
  readonly hosts: readonly ServerManagedModelHost[];
  readonly plaintextHosts: readonly string[];
  /** 计时起点（毫秒 epoch）；由调用方在它那趟工作开始时取一次。 */
  readonly startedAt: number;
}

export interface ManagedAiRefusalDetail {
  readonly used?: number;
  readonly limit?: number;
  readonly periodAnchor?: number | null;
}

/**
 * 判别式结果：调用方**不需要**懂 HTTP。
 *
 * 🔴 `ok: false` 带着 `status`（400/409/502/503）是给路由回给客户端用的；
 * 服务端抽取腿不把它转成任何响应码，只把它转成**稳定码**存进事件的原因列 ——
 * 那里唯一该被用户读到的是"这台实例没配托管 AI"还是"这一期额度用完了"，
 * 而不是一个 HTTP 数字。
 */
export type ManagedAiCompletionResult =
  | { readonly ok: false; readonly status: number; readonly code: string; readonly reason?: string; readonly detail?: ManagedAiRefusalDetail }
  | { readonly ok: true; readonly streaming: true; readonly status: number; readonly contentType: string; readonly body: Readable }
  | { readonly ok: true; readonly streaming: false; readonly status: number; readonly contentType: string; readonly text: string };

/**
 * 业务拒绝的**稳定码**。
 *
 * 🔴 形状照抄既有先例，不新造 HTTP 语义：
 * - `409 + { error: <UPPER_SNAKE>, reason }` = `billing/checkout.routes.ts` 的
 *   `PRICE_NOT_SELLABLE`（"请求本身合法，但它要的那件事在当前状态下不成立"）；
 * - `402 + SUBSCRIPTION_REQUIRED` = `entitlement.ts` 已经在发的码；
 * - `503 + <XXX>_NOT_CONFIGURED` = 同文件 `BILLING_PROVIDER_NOT_CONFIGURED`
 *   （"这台实例没有这个能力"，不是"你请求写错了"）。
 *
 * `code` 是**给客户端机器匹配**的那个（界面按它取 i18n 词条），
 * `reason` 是**给运维定位**的那个。合成一个值会让"额度用尽"与"没买这一档"
 * 在界面上长得一样 —— 而用户的修复动作完全相反（等下一周期 vs 去买）。
 */
export const MANAGED_AI_ERROR_CODES = {
  INVALID_BODY: 'INVALID_BODY',
  NOT_CONFIGURED: 'MANAGED_AI_NOT_CONFIGURED',
  UPSTREAM_NOT_DOMESTIC: 'AI_UPSTREAM_NOT_DOMESTIC',
  ENTITLEMENT_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  QUOTA_EXCEEDED: 'AI_QUOTA_EXCEEDED',
  UPSTREAM_FAILED: 'AI_UPSTREAM_REQUEST_FAILED',
} as const;

/** UPPER_SNAKE 稳定码 → 给人与日志的兜底句（界面文案归 i18n，不读这里）。 */
export const MANAGED_AI_REFUSAL_MESSAGE: Record<string, string> = {
  [MANAGED_AI_ERROR_CODES.INVALID_BODY]: 'Invalid request body.',
  [MANAGED_AI_ERROR_CODES.NOT_CONFIGURED]: 'Managed AI is not configured on this instance.',
  [MANAGED_AI_ERROR_CODES.UPSTREAM_NOT_DOMESTIC]: 'AI upstream is not eligible.',
  [MANAGED_AI_ERROR_CODES.ENTITLEMENT_REQUIRED]: 'A paid subscription is required to use this hosted service.',
  [MANAGED_AI_ERROR_CODES.QUOTA_EXCEEDED]: 'AI quota for this period is exhausted.',
  [MANAGED_AI_ERROR_CODES.UPSTREAM_FAILED]: 'AI upstream request failed.',
};

/**
 * 传输层的**字节上限**，只用于挡住"拿 20 MB 字符串来转发给供应商"。
 *
 * 🔴 它是**传输层**的闸门，不是业务规则：服务端全局 `bodyLimit` 是 20 MB（大导入要用，
 * 见 `server.ts`），而一条聊天补全请求比那个数小若干个数量级。这里不给它一个"业务上
 * 一次最多发几条消息"的含义 —— 那是 `feature` 词表与界面各自的事。
 */
export const MANAGED_AI_MAX_REQUEST_BYTES = 256 * 1024;

/** 一次上游调用的最小返回形状（流式时 `text` 为 `undefined`）。 */
export interface ManagedAiUpstreamResponse {
  readonly status: number;
  readonly contentType: string;
  /** 非流式：调用方读完整文本。 */
  text(): Promise<string>;
  /** 流式：Node 可读流，直接挂到 reply 上。 */
  stream(): Readable;
}

export interface ManagedAiUpstreamRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** 可注入的传输层。默认 `globalThis.fetch`，测试换成打真在进程里的假上游的实现。 */
export type ManagedAiTransport = (
  request: ManagedAiUpstreamRequest,
) => Promise<ManagedAiUpstreamResponse>;

export const managedAiFetchTransport: ManagedAiTransport = async (request) => {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
  });
  const contentType = response.headers.get('content-type') ?? 'application/json';
  return {
    status: response.status,
    contentType,
    text: async () => await response.text(),
    stream: () => {
      if (response.body === null) {
        // 上游回了流式却没有 body：这不是"空流"，是上游坏了。给一个立刻 EOF 的流
        // 会让客户端以为补全结束了 —— 空补全比一个 502 更接近说谎。
        throw new Error('upstream returned an empty stream body');
      }
      return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    },
  };
};

/**
 * 审计与运维日志的**唯一**出口。
 *
 * 🔴 参数表就是保留清单（ADR-0054 §4）：这里**没有任何接"用户内容"的位置** ——
 * 两个 `string` 字段（`event` / `outcome`）装的都是服务端自己写的常量。
 * 想加一个 `prompt` 字段，得先改这个签名、再改那条"标记串不许出现在日志里"的用例 ——
 * 后者会红，而这就是它存在的意义。
 */
export const recordManagedAiAttempt = (entry: {
  event: string;
  userId: number;
  /**
   * 🔴 类型是**封闭词表**，不是 `string`。
   *
   * ADR-0054 §4 允许保留的运维元数据写的是"功能名（封闭词表里的那一个）"，
   * 而把它声明成 `string` 会让这句变成形容词：请求体里那个字段在通过校验**之前**
   * 是一个客户端可控的任意字符串，"顺手记下来好排障"的日志就会成为内容仓库的入口。
   * 所以校验失败那一支（`managed-proxy.routes.ts` 的 ②）**省略**这个字段 ——
   * "没有功能名"与"功能名是用户敲出来的那串"是两件事，后者不该出现在日志里。
   */
  feature?: ServerManagedAiFeature;
  outcome: string;
  status: number;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
}): void => {
  Logger.audit(entry);
};

/**
 * 过一遍闸门并把这一次补全发出去。**不做** HTTP：拒绝以判别式返回，
 * 由调用方决定它是变成响应码（路由）还是变成事件上的稳定原因码（自动收集的服务端抽取腿）。
 *
 * 🔴 额度只在 ⑤ 消耗**一次**，`consumeManagedAiRequest` 在同一条 SQL 语句里读占用、
 * 对上限裁决、+1（AGENTS §8.15）。自动收集那条腿**不再**经过 `POST /managed/chat`，
 * 所以它不会像设备走托管路由那样"预留扣一次、代理再扣一次"（工单 A4 那格已确认的
 * 双重计费：修法归负责人，本文件不替它改语义）。
 */
export async function invokeManagedAiCompletion(
  context: ManagedAiCompletionContext,
  request: ManagedAiCompletionRequest,
): Promise<ManagedAiCompletionResult> {
  const { upstream, sql, limit, now, transport, hosts, plaintextHosts, startedAt } = context;
  const { feature, stream } = request;
  const requestBytes = Buffer.byteLength(JSON.stringify(request.messages), 'utf8');

  // ── ②' 体积闸门只看**消息数组**的字节数 ────────────────────────────
  // 太大的理由只有"太大"这一个词，**不回显内容的任何一部分**。
  if (requestBytes > MANAGED_AI_MAX_REQUEST_BYTES) {
    recordManagedAiAttempt({ event: 'AI_PROXY_REQUEST', userId: request.userId, feature, outcome: 'too_large',
      status: 400, requestBytes, responseBytes: 0, durationMs: now() - startedAt });
    return { ok: false, status: 400, code: MANAGED_AI_ERROR_CODES.INVALID_BODY, reason: 'too_large' };
  }

  // ── ③④ 上游：配了没有 + 合不合格（**预检**，在任何消耗之前）────────
  const preflight = domesticUpstreamVerdict(upstream?.baseUrl, hosts, plaintextHosts);
  if (upstream === undefined || preflight.ok === false) {
    const rejection = preflight.ok === false ? preflight.reason : 'empty';
    const notConfigured = upstream === undefined || rejection === 'empty';
    const status = notConfigured ? 503 : 409;
    recordManagedAiAttempt({ event: 'AI_PROXY_REQUEST', userId: request.userId, feature,
      outcome: notConfigured ? 'not_configured' : 'upstream_rejected', status, requestBytes, responseBytes: 0,
      durationMs: now() - startedAt });
    return {
      ok: false, status,
      code: notConfigured ? MANAGED_AI_ERROR_CODES.NOT_CONFIGURED : MANAGED_AI_ERROR_CODES.UPSTREAM_NOT_DOMESTIC,
      reason: notConfigured ? 'upstream_missing' : rejection,
    };
  }

  // ── 上游合格之后才组装请求体 ────────────────────────────────────────
  // 🔴 只有**已校验**的这条消息数组与工具目录会被序列化并发出去。`model` **只**来自服务端配置。
  const withTools = request.tools !== undefined && request.tools.length > 0;
  const outboundBody = JSON.stringify({
    model: upstream.modelId,
    messages: request.messages,
    ...(withTools
      ? {
          tools: request.tools,
          ...(request.toolChoice === undefined ? {} : { tool_choice: request.toolChoice }),
        }
      : {}),
    ...(stream === true ? { stream: true } : {}),
  });
  // 记的是**即将发出去的那个串的字节数**，不是用户请求的字节数 —— 两者差的是 `model` 那一行。
  const outboundBytes = Buffer.byteLength(outboundBody, 'utf8');

  // ── ⑤ 权益 + 额度（**原子**，一次调用两件事）─────────────────────
  const metering = await consumeManagedAiRequest({ userId: request.userId, now: now(), limit, sql });
  if (metering.allowed === false) {
    const quota = metering.reason === 'QUOTA_EXCEEDED';
    const status = quota ? 409 : 402;
    recordManagedAiAttempt({ event: 'AI_PROXY_REQUEST', userId: request.userId, feature,
      outcome: quota ? 'quota_exceeded' : 'entitlement_denied', status, requestBytes, responseBytes: 0,
      durationMs: now() - startedAt });
    return {
      ok: false, status,
      code: quota ? MANAGED_AI_ERROR_CODES.QUOTA_EXCEEDED : MANAGED_AI_ERROR_CODES.ENTITLEMENT_REQUIRED,
      reason: metering.reason,
      // 这两个数是《AI 服务条款》§5.3 承诺给用户看的：拒绝时也要能说清"已用 X / N"。
      detail: { used: metering.used, limit: metering.limit, periodAnchor: metering.periodAnchor },
    };
  }

  // ── ⑥ 发送点复算（ADR-0056 §5 第 2 条）───────────────────────────
  const url = `${upstream.baseUrl}/chat/completions`;
  const sendPoint = domesticUpstreamVerdict(upstream.baseUrl, hosts, plaintextHosts);
  if (sendPoint.ok === false) {
    recordManagedAiAttempt({ event: 'AI_PROXY_REQUEST', userId: request.userId, feature,
      outcome: 'upstream_rejected_at_send_point', status: 409, requestBytes: outboundBytes, responseBytes: 0,
      durationMs: now() - startedAt });
    // ⚠️ 这一次额度**已经消耗了**，而且故意不退还（理由见 `managed-proxy.routes.ts` 原注释：
    // 走到这里的唯一条件是 ④ 与 ⑥ 之间上游被换掉，而这一格是那两条纪律的**载体**）。
    return { ok: false, status: 409, code: MANAGED_AI_ERROR_CODES.UPSTREAM_NOT_DOMESTIC, reason: sendPoint.reason };
  }

  // ── ⑦ 真的发出去 ─────────────────────────────────────────────────
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // 🔴 密钥只在这一个地方出现，且只进**请求头**：不进 URL、不进日志、不进响应。
    // 空串在这条路上不可能出现（`config.ts` 要求三项齐全才存在）。
    authorization: `Bearer ${upstream.apiKey}`,
  };

  let upstreamResponse: ManagedAiUpstreamResponse;
  try {
    upstreamResponse = await transport({ url, headers, body: outboundBody });
  } catch {
    // 🔴 **整个 catch 没有绑定 error**：上游与 undici 的报错文本会把 URL、
    // 甚至请求内容的一部分抄进来，而"顺手记一句 message"是这条路径上最自然的动作。
    recordManagedAiAttempt({ event: 'AI_PROXY_REQUEST', userId: request.userId, feature,
      outcome: 'upstream_unreachable', status: 502, requestBytes: outboundBytes, responseBytes: 0,
      durationMs: now() - startedAt });
    return { ok: false, status: 502, code: MANAGED_AI_ERROR_CODES.UPSTREAM_FAILED, reason: 'unreachable' };
  }

  const status = upstreamResponse.status;
  if (status >= 400) {
    // 🔴 **非 2xx 的上游响应体一律不回显、不落盘**，连"读一下它有多长"都不做：
    // 供应商的错误文本经常把请求的一部分抄回来，于是"不保留内容"经由错误路径漏出去。
    recordManagedAiAttempt({ event: 'AI_PROXY_REQUEST', userId: request.userId, feature,
      outcome: 'upstream_error', status, requestBytes: outboundBytes, responseBytes: 0,
      durationMs: now() - startedAt });
    return {
      ok: false, status: 502, code: MANAGED_AI_ERROR_CODES.UPSTREAM_FAILED, reason: 'upstream_status',
      // 额度**确实被消耗了**，所以这两个数仍然要给（用户质疑的是"我这一期用了几次"）。
      detail: { used: metering.used, limit: metering.limit, periodAnchor: metering.periodAnchor },
    };
  }

  if (stream === true) {
    recordManagedAiAttempt({ event: 'AI_PROXY_REQUEST', userId: request.userId, feature,
      outcome: 'forwarded_stream', status, requestBytes: outboundBytes,
      // ⚠️ 响应字节**故意记 0**：流式要等结束才知道长度，而为了记它去缓冲整个流
      // 会破坏 `stream: true` 的意义。宁可少记一条元数据，不可把内容留在内存里更久。
      responseBytes: 0, durationMs: now() - startedAt });
    return { ok: true, streaming: true, status, contentType: upstreamResponse.contentType, body: upstreamResponse.stream() };
  }

  const payload = await upstreamResponse.text();
  recordManagedAiAttempt({ event: 'AI_PROXY_REQUEST', userId: request.userId, feature,
    outcome: 'forwarded', status, requestBytes: outboundBytes, responseBytes: Buffer.byteLength(payload, 'utf8'),
    durationMs: now() - startedAt });
  // 原样交出**文本**而不是重新序列化：透传的判据是"客户端拿到的字节 = 上游回的字节"。
  return { ok: true, streaming: false, status, contentType: upstreamResponse.contentType, text: payload };
}

