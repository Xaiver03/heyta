/**
 * 托管（云端）AI 的**服务端代理**：`POST /api/ai/managed/chat`。
 * ==========================================================
 *
 * 这是 [ADR-0054](../../../docs/adr/0054-managed-ai-retention-and-selling-preconditions.md)
 * §6 那条前置顺序里"把计量接到生产路径上"的那一步 —— `ai/metering.ts` 此前**没有任何调用方**，
 * 也就是说"计量存在"只存在于测试里。本文件是它的**第一个也是唯一一个**生产调用点。
 *
 * ## 🔴 闸门顺序（这个文件的核心，顺序本身就是判据）
 *
 * ```
 *   ① authenticate            → 401 / 410
 *   ② 请求体校验              → 400 INVALID_BODY
 *   ③ 上游是否配置            → 503 MANAGED_AI_NOT_CONFIGURED
 *   ④ 境内白名单（预检）      → 409 AI_UPSTREAM_NOT_DOMESTIC
 *   ⑤ 权益 + 额度（原子）     → 402 SUBSCRIPTION_REQUIRED / 409 AI_QUOTA_EXCEEDED
 *   ⑥ 境内白名单（发送点复算）→ 409 AI_UPSTREAM_NOT_DOMESTIC
 *   ⑦ 真的发请求              → 200 透传 / 502 AI_UPSTREAM_REQUEST_FAILED
 * ```
 *
 * 三条不能反的理由，每条都对应一次可失败的用例（`server/tests/managed-proxy.routes.spec.ts`）：
 *
 * | 顺序 | 反了会怎样 | 哪条用例红 |
 * |---|---|---|
 * | ⑤ 在 ⑦ **之前** | 超额的请求**已经打出去**了：供应商按量计费的钱我们付了，额度却判的是"不许"。更坏的是"先转发再扣额"在并发下必然超发 | 「超额 ⇒ 假上游命中 0 次」 |
 * | ④ 在 ⑤ **之前** | 上游配置不合格时**白扣用户一次额度**（一次配置错误被乘以每个用户的每个月） | 「境外上游 ⇒ 计数器一字未动」 |
 * | ① 在全部之前 | 未认证的请求去消耗额度、去读别人的订阅 | 「无令牌 ⇒ 401 且**一条 SQL 都没发**」 |
 *
 * ⑥ 与 ④ 是**同一个纯函数被调两次**，不是重复劳动：ADR-0056 §5 第 2 条要求的正是
 * 「保存配置时校验一次，真发请求前再校验一次」，出处是 ADR-0010 从 SSOS 抄来的那句
 * 「Enforcement has to sit on the path that actually sends the request,
 * not only on the path that stores it.」。两把尺子各自**单独**被一条用例钉住：
 * 摘掉 ④ ⇒ 计数器那条断言红；摘掉 ⑥ ⇒ "发送点复算"那条用例红。
 *
 * ## 🔴 这里**不**留内容 —— 一次调用之后什么都不剩（ADR-0054 §3）
 *
 * 请求体与响应体只在这一次代理调用的内存里存在。落盘的只有元数据：
 * 时间、用户、功能名（封闭词表）、结果状态、**字节数**、耗时 —— 一列内容都没有。
 *
 * ⚠️ 这条不是靠注释维持的，`server/tests/managed-proxy.routes.spec.ts` 的
 * 「不保留内容」那一组是这么判的：假上游返回一句带**标记串**的补全、请求里带另一句
 * 标记串的提示词，然后断言这两个标记串**既不在捕获到的全部日志输出里，也不在库里
 * 任何一张表的任何一行里**。只断言"我们没有 content 列"是不够的 ——
 * 那拦不住一行 `Logger.info({ body })`。
 *
 * 两个具体的泄露口子，已经堵上并各有一条用例：
 * 1. **上游的非 2xx 响应体不回显**（供应商的错误信息经常把请求内容的一部分抄回来）。
 *    502 的响应体里只有状态码和稳定码，日志里只有字节数。
 * 2. **解析不出的端点不回显在错误里**（`https://<key>@host` 是合法 URL，
 *    自托管者可能把密钥写在里面）—— 见 `managed-upstream.ts` 的 `unparseable` 分支。
 *
 * ## 上游地址与模型 id 为什么**不**在请求体里
 *
 * 见 `config.ts` 的 `ManagedAiConfig`：客户端能选上游 = 客户端能选我们把明文送到哪儿，
 * 客户端能选模型 = 客户端能选我们倒贴多少钱（ADR-0021「换模型就是改价」）。
 * zod 默认丢弃未声明键，所以请求体里塞 `baseUrl` / `model` / `requests` **到不了**逻辑层，
 * 而 ⑤ 的入参一律来自服务端（认证出的 `userId` + 服务端常量 `limit`）—— 这就是
 * AGENTS §8.10「计数只在服务端做」在这一条路由上的落点。
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import { z } from 'zod';

import { prisma } from '../db';
import { Logger } from '../logger';
import { authenticate, getAuthUser } from '../middleware';
import { loadConfigFromEnv, type ManagedAiConfig } from '../config';
import { createPrismaSqlExecutor, type SqlExecutor } from '../billing/pricing-store';
import { MANAGED_AI_REQUESTS_PER_PERIOD, consumeManagedAiRequest } from './metering';
import {
  SERVER_MANAGED_AI_FEATURES,
  SERVER_MANAGED_MODEL_HOSTS,
  domesticUpstreamVerdict,
  type ServerManagedAiFeature,
  type ServerManagedModelHost,
} from './managed-upstream';

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
 * `error` 是**给客户端机器匹配**的那个（界面按它取 i18n 词条），
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

/**
 * 拒绝用的两个状态码，都取自**这个服务端已经在发**的形状，不新造语义：
 *
 * | 常量 | 先例 | 用在哪 |
 * |---|---|---|
 * | `CONFLICT_STATUS = 409` | `billing/checkout.routes.ts` 的 `PRICE_NOT_SELLABLE` | "请求本身合法，但它要的那件事在当前状态下不成立" —— 额度用尽、上游不合格 |
 * | `UPGRADE_REQUIRED_STATUS = 402` | `entitlement.ts` 的 `SUBSCRIPTION_REQUIRED` | 权益不成立（没买这一档 / 已到期） |
 *
 * 🔴 **额度之外的两个拒绝为什么是两个不同的码**（用户的修复动作相反）：
 *
 * | 原因 | 码 | 修复动作 |
 * |---|---|---|
 * | 没买 `ai` 这一档 / 已到期 | 402 | 去买（收银台那条路） |
 * | 这一期 300 次用完了 | 409 | 等下一个计费周期 |
 *
 * ⚠️ 第二行那句"等"不是修辞：`managedAiPeriodAnchor` 取的是**有效订阅里最晚的
 * `current_period_end`**，提前续费会**换锚、从 0 起**（那一档的语义是"多给一轮"，
 * 而多给一轮的前提是又付了一次钱）。界面在这两种拒绝上必须说不同的话，
 * 否则用满了的人会看到一个"去买"的 CTA，而它解决不了他**这一期**的问题。
 */
const CONFLICT_STATUS = 409;
const UPGRADE_REQUIRED_STATUS = 402;

/**
 * 传输层的**字节上限**，只用于挡住"拿 20 MB 字符串来转发给供应商"。
 *
 * 🔴 它是**传输层**的闸门，不是业务规则：服务端全局 `bodyLimit` 是 20 MB（大导入要用，
 * 见 `server.ts`），而一条聊天补全请求比那个数小若干个数量级。这里不给它一个"业务上
 * 一次最多发几条消息"的含义 —— 那是 `feature` 词表与界面各自的事。
 */
const MAX_REQUEST_BYTES = 256 * 1024;

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  /** OpenAI 兼容格式要求工具观察结果回填对应的调用 id。 */
  toolCallId: z.string().max(256).optional(),
});

/**
 * 🔴 没有 `model`、没有 `baseUrl`、没有 `stream` 之外的任何"上游行为"字段。
 * 特别是**没有** `requests` / `used` / `limit`：客户端自报的计数一律不采信（AGENTS §8.10）。
 */
const ChatBodySchema = z.object({
  feature: z.enum(SERVER_MANAGED_AI_FEATURES),
  messages: z.array(MessageSchema).min(1),
  /** 逐字透传上游的 SSE 流。关闭时整包读完再回。 */
  stream: z.boolean().optional(),
});

/** 拒绝时的响应形状。字段固定这三个，**没有**放内容的地方。 */
interface RefusalBody {
  error: string;
  reason?: string;
  detail?: { used?: number; limit?: number; periodAnchor?: number | null };
}

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

const fetchTransport: ManagedAiTransport = async (request) => {
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
const recordManagedAiAttempt = (entry: {
  event: string;
  userId: number;
  /**
   * 🔴 类型是**封闭词表**，不是 `string`。
   *
   * ADR-0054 §4 允许保留的元数据写的是"功能名（封闭词表里的那一个）"，
   * 而把它声明成 `string` 会让这句变成形容词：请求体里那个字段在通过校验**之前**
   * 是一个客户端可控的任意字符串，"顺手记下来好排障"的日志就会成为内容仓库的入口。
   * 所以 ② 那一支（校验失败）**省略**这个字段 —— "没有功能名"与"功能名是
   * 用户敲出来的那串"是两件事，后者不该出现在日志里。
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

export interface ManagedAiProxyRoutesOptions {
  /** 上游配置。**省略时读环境**（`MANAGED_AI_*`），默认不存在 ⇒ 一律 503。 */
  readonly upstream?: ManagedAiConfig | undefined;
  /** 额度裁决用的 SQL 面。默认 `createPrismaSqlExecutor(prisma)`。 */
  readonly sql?: SqlExecutor;
  /** 额度上限。默认取 `metering.ts` 那个常量（与 SSOT 块由同一条测试对账）。 */
  readonly limit?: number;
  /** 可注入时钟。 */
  readonly now?: () => number;
  /**
   * 传输层。默认 `globalThis.fetch`。
   *
   * ⚠️ **本轮的用例一个都不注入它** —— 假上游是一个真的进程内 HTTP 服务器，
   * 走默认这条路才能证明"发出去的 URL / 头 / 字节"就是路由自己算出来的那一套。
   * 留着这个入参是为了两个**真服务器不好稳定复现**的形状
   * （上游回了流式却没有 body、连接层抛错的方式与时刻），不是装饰。
   * 🔴 也因此：`fetchTransport` 里那个 `stream()` 抛错分支目前**没有**测试覆盖。
   */
  readonly transport?: ManagedAiTransport;
  /**
   * 境内白名单表。**默认是生产那张**，没有第二个默认值。
   * 测试注入合成表，为的是能造出"在表上但所在地不是 `cn`"这一支 ——
   * 往生产表里塞一行境外供应商不是测试，那是在产品上开洞（同 `packages/ai` 那份
   * `managedEndpointVerdictAgainst` 把表做成必填入参的理由）。
   */
  readonly hosts?: readonly ServerManagedModelHost[];
  /**
   * 允许**明文**的主机。**默认空 ⇒ 一切 http 都拒**。
   *
   * 🔴 只为测试的假上游（`http://127.0.0.1:<port>`）存在，**`server.ts` 不传它**，
   * 而且它不在 `ManagedAiConfig` 里、没有任何环境变量能打开它。
   * 「这个默认值真的是空的」由 `managed-proxy.routes.spec.ts` 里那条
   * "不传它的默认路由 + 明文地址 ⇒ 拒绝且假上游命中 0 次"的用例钉住。
   */
  readonly plaintextHosts?: readonly string[];
}

/** 拒绝的统一出口：状态码 + 稳定码 + 定位用的 reason。日志由调用方先写好。 */
const refuse = (reply: FastifyReply, status: number, body: RefusalBody): FastifyReply =>
  reply.status(status).send(body);

export const managedAiProxyRoutes: FastifyPluginAsync<ManagedAiProxyRoutesOptions> = async (
  fastify,
  options,
) => {
  const upstream = options.upstream ?? loadConfigFromEnv().managedAi;
  const sql = options.sql ?? createPrismaSqlExecutor(prisma);
  const limit = options.limit ?? MANAGED_AI_REQUESTS_PER_PERIOD;
  const now = options.now ?? Date.now;
  const transport = options.transport ?? fetchTransport;
  const hosts = options.hosts ?? SERVER_MANAGED_MODEL_HOSTS;
  const plaintextHosts = options.plaintextHosts ?? [];

  // 🔴 **插件级 preHandler**：照 `admin/admin.routes.ts` 的 `addHook('preHandler', requireAdmin)`
  // 那一条形状。挂在这里而不是每条路由各写一遍，是因为"新增一条托管 AI 路由忘了鉴权"
  // 必须**不可能**发生 —— 封装作用域里的每一条路由都会带上它，忘了写反而是要费劲的事。
  fastify.addHook('preHandler', authenticate);

  fastify.post<{ Body: unknown }>(
    '/managed/chat',
    {
      config: {
        // 阈值**从被约束的那个常量推导**，不是拍一个数（AGENTS §7 元规则 2）。
        // `MANAGED_AI_REQUESTS_PER_PERIOD / 5`：允许把**整个周期的额度**压进 5 个
        // 15 分钟窗口之内 —— 再快就不是"用完了这一期"，而是脚本在打这台服务器。
        // ⚠️ 与额度是两把不同的尺子：这一层先撞时客户端拿的是 **429**（既有语义，
        // 不是本文件的稳定码表），而**额度才是这条路的守门人**（409 + `used/limit`）。
        // 除不尽时向下取整：`max` 必须是整数，而"多给一点"在这里没有任何收益。
        rateLimit: {
          max: Math.floor(MANAGED_AI_REQUESTS_PER_PERIOD / 5),
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const startedAt = now();
      const userId = getAuthUser(request).userId;

      // ── ② 请求体 ─────────────────────────────────────────────────────
      // 先于 ③④⑤：一个格式不对的请求**不该消耗额度**，也不该被算作一次"上游不合格"。
      const parsed = ChatBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        recordManagedAiAttempt({
          event: 'AI_PROXY_REQUEST',
          userId,
          // 🔴 **省略 `feature`**，不是写一个 `'unknown'` 顶上：
          // 校验失败时那个字段是客户端可控的任意字符串，记进日志就等于
          // 把"封闭词表"变成"日志里可能出现任意文本" —— ADR-0054 §4 那句话就白写了。
          outcome: 'invalid_body',
          status: 400,
          requestBytes: 0,
          responseBytes: 0,
          durationMs: now() - startedAt,
        });
        return refuse(reply, 400, { error: MANAGED_AI_ERROR_CODES.INVALID_BODY });
      }
      const { feature, stream } = parsed.data;
      // 🔴 体积闸门只看**消息数组**：此时还没到能拼出请求体的位置（上游可能不合格）。
      // `MAX_REQUEST_BYTES` 是传输层的，不带业务含义 —— 见它上面那段。
      const requestBytes = Buffer.byteLength(JSON.stringify(parsed.data.messages), 'utf8');
      if (requestBytes > MAX_REQUEST_BYTES) {
        // ⚠️ 拒绝的理由只有"太大"这一个词，**不回显内容的任何一部分**。
        recordManagedAiAttempt({
          event: 'AI_PROXY_REQUEST',
          userId,
          feature,
          outcome: 'too_large',
          status: 400,
          requestBytes,
          responseBytes: 0,
          durationMs: now() - startedAt,
        });
        return refuse(reply, 400, {
          error: MANAGED_AI_ERROR_CODES.INVALID_BODY,
          reason: 'too_large',
        });
      }

      // ── ③④ 上游：配了没有 + 合不合格（**预检**，在任何消耗之前）────────
      const preflight = domesticUpstreamVerdict(upstream?.baseUrl, hosts, plaintextHosts);
      if (upstream === undefined || preflight.ok === false) {
        // 判别式在上一行已经被收窄：只有 `preflight.ok === false` 那一支才有 `reason`。
        const rejection = preflight.ok === false ? preflight.reason : 'empty';
        const notConfigured = upstream === undefined || rejection === 'empty';
        const status = notConfigured ? 503 : CONFLICT_STATUS;
        recordManagedAiAttempt({
          event: 'AI_PROXY_REQUEST',
          userId,
          feature,
          outcome: notConfigured ? 'not_configured' : 'upstream_rejected',
          status,
          requestBytes,
          responseBytes: 0,
          durationMs: now() - startedAt,
        });
        return refuse(reply, status, {
          error: notConfigured
            ? MANAGED_AI_ERROR_CODES.NOT_CONFIGURED
            : MANAGED_AI_ERROR_CODES.UPSTREAM_NOT_DOMESTIC,
          // 🔴 只有 reason 码，**没有端点字符串**（见文件头泄露口子 2：
          // `https://<key>@host` 是合法 URL，把配置原样抄进错误就是抄进日志）。
          reason: notConfigured ? 'upstream_missing' : rejection,
        });
      }

      // ── 上游合格之后才组装请求体 ──────────────────────────────────────
      // 🔴 只有**已校验**的这条消息数组会被序列化并发出去；未声明的键
      // （`model` / `baseUrl` / `requests`）到这里已经没了。`model` **只**来自服务端配置。
      const outboundBody = JSON.stringify({
        model: upstream.modelId,
        messages: parsed.data.messages,
        ...(stream === true ? { stream: true } : {}),
      });
      // 记的是**即将发出去的那个串的字节数**，不是用户请求的字节数 —— 两者差的是
      // `model` 那一行。这个区分有用处：运维要看的是"我们到底往外送了多少"。
      const outboundBytes = Buffer.byteLength(outboundBody, 'utf8');

      // ── ⑤ 权益 + 额度（**原子**，一次调用两件事）─────────────────────
      // 🔴 入参一个都不来自请求体：`userId` 来自令牌，`limit` 来自服务端常量。
      // `consumeManagedAiRequest` 在同一条 SQL 语句里读占用、对上限裁决、+1
      // （AGENTS §8.15），所以这里**不需要**也**不应该**先读一次再比一次。
      const metering = await consumeManagedAiRequest({ userId, now: now(), limit, sql });
      if (metering.allowed === false) {
        const quota = metering.reason === 'QUOTA_EXCEEDED';
        const status = quota ? CONFLICT_STATUS : UPGRADE_REQUIRED_STATUS;
        recordManagedAiAttempt({
          event: 'AI_PROXY_REQUEST',
          userId,
          feature,
          outcome: quota ? 'quota_exceeded' : 'entitlement_denied',
          status,
          requestBytes,
          responseBytes: 0,
          durationMs: now() - startedAt,
        });
        return refuse(reply, status, {
          error: quota
            ? MANAGED_AI_ERROR_CODES.QUOTA_EXCEEDED
            : MANAGED_AI_ERROR_CODES.ENTITLEMENT_REQUIRED,
          reason: metering.reason,
          // 这两个数是《AI 服务条款》§5.3 承诺给用户看的：拒绝时也要能说清"已用 X / N"。
          detail: {
            used: metering.used,
            limit: metering.limit,
            periodAnchor: metering.periodAnchor,
          },
        });
      }

      // ── ⑥ 发送点复算（ADR-0056 §5 第 2 条）───────────────────────────
      const url = `${upstream.baseUrl}/chat/completions`;
      const sendPoint = domesticUpstreamVerdict(upstream.baseUrl, hosts, plaintextHosts);
      if (sendPoint.ok === false) {
        recordManagedAiAttempt({
          event: 'AI_PROXY_REQUEST',
          userId,
          feature,
          outcome: 'upstream_rejected_at_send_point',
          status: CONFLICT_STATUS,
          requestBytes: outboundBytes,
          responseBytes: 0,
          durationMs: now() - startedAt,
        });
        // ⚠️ 这一次额度**已经消耗了**，而且故意不退还：退还要一条第二写入路径与
        // "谁负责退"的状态机，而 ADR-0054 §2 要的是"服务端只有计数"这一件事。
        // 走到这里的唯一条件是 ④ 与 ⑥ 之间上游被换掉 —— 今天的代码里不可能，
        // 所以它是那条"发送点必须自己算一次"的纪律的**载体**，不是装饰：
        // 把它摘掉，「两把尺子各自单独钉住」那一组用例会红。
        return refuse(reply, CONFLICT_STATUS, {
          error: MANAGED_AI_ERROR_CODES.UPSTREAM_NOT_DOMESTIC,
          reason: sendPoint.reason,
        });
      }

      // ── ⑦ 真的发出去 ─────────────────────────────────────────────────
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        // 🔴 密钥只在这一个地方出现，且只进**请求头**：不进 URL、不进日志、不进响应。
        // 空串在这条路上不可能出现（`config.ts` 要求三项齐全才存在），
        // 所以这里不需要像 `packages/ai/src/wire.ts` 那样为"本机 Ollama 没有密钥"开口子。
        authorization: `Bearer ${upstream.apiKey}`,
      };

      let upstreamResponse: ManagedAiUpstreamResponse;
      try {
        upstreamResponse = await transport({ url, headers, body: outboundBody });
      } catch {
        // 🔴 **整个 catch 没有绑定 error**：上游与 undici 的报错文本会把 URL、
        // 甚至请求内容的一部分抄进来，而"顺手记一句 message"是这条路径上最自然的动作。
        // 判据是"标记串会不会出现在日志里"，不是"运维看着方不方便"。
        recordManagedAiAttempt({
          event: 'AI_PROXY_REQUEST',
          userId,
          feature,
          outcome: 'upstream_unreachable',
          status: 502,
          requestBytes: outboundBytes,
          responseBytes: 0,
          durationMs: now() - startedAt,
        });
        return refuse(reply, 502, {
          error: MANAGED_AI_ERROR_CODES.UPSTREAM_FAILED,
          reason: 'unreachable',
        });
      }

      const status = upstreamResponse.status;
      if (status >= 400) {
        // 🔴 **非 2xx 的上游响应体一律不回显、不落盘**。
        // 供应商的 4xx/5xx 文本经常把请求的一部分抄回来（`Invalid 'messages[1].content'`
        // 这类），于是"我们不保留内容"的承诺经由错误路径漏出去 —— 而这条路径
        // 平时没有流量，会在**第一次出问题时**才第一次被走到。
        // 这里连"读一下它有多长"都不做：读了就可能被用。
        recordManagedAiAttempt({
          event: 'AI_PROXY_REQUEST',
          userId,
          feature,
          outcome: 'upstream_error',
          status,
          requestBytes: outboundBytes,
          responseBytes: 0,
          durationMs: now() - startedAt,
        });
        return refuse(reply, 502, {
          error: MANAGED_AI_ERROR_CODES.UPSTREAM_FAILED,
          reason: 'upstream_status',
          // 额度**确实被消耗了**，所以这两个数仍然要给（用户质疑的是"我这一期用了几次"）。
          detail: {
            used: metering.used,
            limit: metering.limit,
            periodAnchor: metering.periodAnchor,
          },
        });
      }

      if (stream === true) {
        recordManagedAiAttempt({
          event: 'AI_PROXY_REQUEST',
          userId,
          feature,
          outcome: 'forwarded_stream',
          status,
          requestBytes: outboundBytes,
          // ⚠️ 响应字节**故意记 0**：流式要等结束才知道长度，而为了记它去缓冲整个流
          // 会破坏 `stream: true` 的意义。宁可少记一条元数据，不可为了元数据把内容
          // 留在内存里更久（ADR-0054 §3 那条"一次调用"）。
          responseBytes: 0,
          durationMs: now() - startedAt,
        });
        reply.status(status);
        // 🔴 必须把上游的 content-type 带过去：SSE 丢掉 `text/event-stream` 就等于
        // 客户端拿到一坨没有分隔语义的字节（`EventSource` 会直接报错），
        // 而这条只在**流式**那一路成立 —— 非流式那一路由 `reply.type(…)` 负责。
        reply.type(upstreamResponse.contentType);
        return reply.send(upstreamResponse.stream());
      }

      const payload = await upstreamResponse.text();
      recordManagedAiAttempt({
        event: 'AI_PROXY_REQUEST',
        userId,
        feature,
        outcome: 'forwarded',
        status,
        requestBytes: outboundBytes,
        responseBytes: Buffer.byteLength(payload, 'utf8'),
        durationMs: now() - startedAt,
      });
      // 原样发**文本**而不是重新 `JSON.stringify` 解析结果：透传的判据是
      // "客户端拿到的字节 = 上游回的字节"，重排键序会让那条断言变成测我们自己的序列化器。
      reply.status(status);
      return reply.type(upstreamResponse.contentType).send(payload);
    },
  );
};
