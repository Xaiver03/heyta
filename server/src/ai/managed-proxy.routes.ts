/**
 * 托管（云端）AI 的**服务端代理**：`POST /api/ai/managed/chat`。
 * ==========================================================
 *
 * 这是 [ADR-0054](../../../docs/adr/0054-managed-ai-retention-and-selling-preconditions.md)
 * §6 那条前置顺序里"把计量接到生产路径上"的那一步 —— `ai/metering.ts` 此前**没有任何调用方**，
 * 也就是说"计量存在"只存在于测试里。本文件曾是它的**唯一一个**生产调用点；
 * 2026-10-27 起，闸门与发送那一整条腿搬到了 `managed-completion.ts`，
 * 因为自动收集多了一条**没有 HTTP 请求**的服务端抽取腿（[ADR-0077](../../../docs/adr/0077-inbound-hosted-extraction-at-ingest.md)），
 * 两条腿**必须**过同一套闸门 —— 各写一份就等于"发送点复算白名单"这句话有两套实现。
 *
 * 于是本文件只剩下 HTTP 那一层该管的事：鉴权、请求体校验、状态码与响应形状。
 *
 * ## 🔴 闸门顺序（实现在 `managed-completion.ts`，顺序本身就是判据）
 *
 * ```
 *   ① authenticate            → 401 / 410            （本文件）
 *   ② 请求体校验              → 400 INVALID_BODY      （本文件）
 *   ②'体积闸门（只看字节数）  → 400 INVALID_BODY      （managed-completion）
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
 * ## 上游地址与模型 id 为什么**不**在请求体里
 *
 * 见 `config.ts` 的 `ManagedAiConfig`：客户端能选上游 = 客户端能选我们把明文送到哪儿，
 * 客户端能选模型 = 客户端能选我们倒贴多少钱（ADR-0021「换模型就是改价」）。
 * zod 默认丢弃未声明键，所以请求体里塞 `baseUrl` / `model` / `requests` **到不了**逻辑层，
 * 而 ⑤ 的入参一律来自服务端（认证出的 `userId` + 服务端常量 `limit`）—— 这就是
 * AGENTS §8.10「计数只在服务端做」在这一条路由上的落点。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { prisma } from '../db';
import { authenticate, getAuthUser } from '../middleware';
import { loadConfigFromEnv, type ManagedAiConfig } from '../config';
import { createPrismaSqlExecutor, type SqlExecutor } from '../billing/pricing-store';
import { MANAGED_AI_REQUESTS_PER_PERIOD, peekManagedAiUsage } from './metering';
import { SERVER_MANAGED_AI_FEATURES, SERVER_MANAGED_MODEL_HOSTS, type ServerManagedModelHost } from './managed-upstream';
import {
  MANAGED_AI_ERROR_CODES, MANAGED_AI_REFUSAL_MESSAGE, managedAiFetchTransport,
  invokeManagedAiCompletion, recordManagedAiAttempt,
  type ManagedAiCompletionResult, type ManagedAiTransport,
} from './managed-completion';

/**
 * OpenAI 兼容线上的**消息形状**。
 *
 * 🔴 **`tool_call_id` 用下划线，不用驼峰** —— 客户端 `packages/ai/src/wire.ts`
 * 的 `toWireMessage()` 把内部的 `toolCallId` 归一化成下划线形式再发出（自备端点
 * 那条路依赖这个形状，因为 OpenAI 只认下划线）。服务端如果在这一层用驼峰，
 * zod 会**静默剥离**下划线那个键、发上游时把它丢掉，症状是"工具观察结果没有
 * 对应上调用 id"—— 上游 400、界面显示"AI 请求失败"，最难归因。
 *
 * ⚠️ 这条不是"风格偏好"：`tool_calls` 与 `tool_call_id` 是**供应商契约的一部分**，
 * 由不得中间层改名。
 */
const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  /** OpenAI 兼容格式要求工具观察结果回填对应的调用 id（线上键名是下划线形式）。 */
  tool_call_id: z.string().max(256).optional(),
});

/** OpenAI 兼容线上的**工具声明**形状（客户端 `wire.ts` 的 `WireTool` 一一对应）。 */
const WireToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1).max(128),
    description: z.string(),
    parameters: z.unknown(),
  }),
});

/**
 * 🔴 没有 `model`、没有 `baseUrl`、没有 `stream` 之外的任何"上游行为"字段。
 * 特别是**没有** `requests` / `used` / `limit`：客户端自报的计数一律不采信（AGENTS §8.10）。
 *
 * ⚠️ `tools` 与 `tool_choice` **照原样转发**给上游（launch-blockers §3.2 (a) 方案）：
 * 托管档的 assistant 需要工具才能"帮用户做决策"。工具目录由**客户端**决定，
 * 服务端只保证"过了 zod 的形状"，不去解释工具语义。
 */
const ChatBodySchema = z.object({
  feature: z.enum(SERVER_MANAGED_AI_FEATURES),
  messages: z.array(MessageSchema).min(1),
  tools: z.array(WireToolSchema).max(64).optional(),
  tool_choice: z.literal('auto').optional(),
  /** 逐字透传上游的 SSE 流。关闭时整包读完再回。 */
  stream: z.boolean().optional(),
});

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
   * 走默认这条路才能证明"发出去的 URL / 头 / 字节"就是这条腿自己算出来的那一套。
   * 留着这个入参是为了两个**真服务器不好稳定复现**的形状
   * （上游回了流式却没有 body、连接层抛错的方式与时刻），不是装饰。
   * 🔴 也因此：`managedAiFetchTransport` 里那个 `stream()` 抛错分支目前**没有**测试覆盖。
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

export const managedAiProxyRoutes: FastifyPluginAsync<ManagedAiProxyRoutesOptions> = async (
  fastify,
  options,
) => {
  const upstream = options.upstream ?? loadConfigFromEnv().managedAi;
  const sql = options.sql ?? createPrismaSqlExecutor(prisma);
  const limit = options.limit ?? MANAGED_AI_REQUESTS_PER_PERIOD;
  const now = options.now ?? Date.now;
  const transport = options.transport ?? managedAiFetchTransport();
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
        // 不是稳定码表里的那些），而**额度才是这条路的守门人**（409 + `used/limit`）。
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
        return reply.status(400).send({ code: MANAGED_AI_ERROR_CODES.INVALID_BODY,
          message: MANAGED_AI_REFUSAL_MESSAGE[MANAGED_AI_ERROR_CODES.INVALID_BODY] });
      }
      const { feature, messages, tools, tool_choice: toolChoice, stream } = parsed.data;
      const result = await invokeManagedAiCompletion(
        { upstream, sql, limit, now, transport, hosts, plaintextHosts, startedAt },
        { userId, feature, messages, ...(tools === undefined ? {} : { tools }),
          ...(toolChoice === undefined ? {} : { toolChoice }), ...(stream === undefined ? {} : { stream }) },
      );
      return shapeCompletionReply(reply, result);
    },
  );
  /**
   * `GET /api/ai/managed/usage` —— 「本周期已用 X / 300」的那个读数。
   *
   * ## 它兑现的是哪句话
   *
   * 法务 §5.3 承诺「设置页可以查到本周期已用 X / 300 次」。`peekManagedAiUsage`
   * 早就实现了，但**此前零调用方、也没有任何读用量的路由** ⇒ 那句承诺在界面上兑现不了。
   * 这条路由就是它的出口。
   *
   * ## 🔴 三个不能改的形状
   *
   * 1. **只读，不消耗额度**：走 `peekManagedAiUsage`，它一行都不写。做成"顺手 `consume`
   *    一次好让数字更新"就是把查询变成扣费 —— 用户点开设置页会掉一次额度。
   * 2. **与裁决同源**：`peekManagedAiUsage` 复用同一个 `SELECT_SUBSCRIPTION_PROJECTION`
   *    与同一个 `managedAiPeriodAnchor`。自己在这里算周期边界 = 第二套锚点规则，
   *    结果是"界面显示还剩 3 次"而第 4 次已经被拒（界面与实际用的是两个"本周期"）。
   * 3. **鉴权靠插件级 `preHandler`**（上面那一行 `addHook`），不在这里另写一遍 ——
   *    `check:public-facts` 判据 4 认的正是插件级 `addHook('preHandler', authenticate)`。
   *    写成匿名 GET 它会红，而且那本来就意味着"任何人可以读别人的额度"。
   *
   * ## ⚠️ 客户端读法（这一条是给界面的）
   *
   * `entitled: false` 时 `used` 恒为 `0`，而它**不是**"这一期还没用过"，
   * 是"根本没有这一期"（没买这一档 / 已到期）。界面把它渲染成「已用 0 / 300」
   * 就是在说反话，正确渲染是"未订阅"那一档。
   */
  fastify.get('/managed/usage', async (request, reply) => {
    const userId = getAuthUser(request).userId;
    const usage = await peekManagedAiUsage({ userId, now: now(), limit, sql });
    reply.status(200);
    return reply.send(usage);
  });
};

/**
 * 把一次补全的结果变成 HTTP 响应。这一层**只做形状**：
 * 状态码与稳定码是 `invokeManagedAiCompletion` 判的，这里一个都不重新解释。
 */
const shapeCompletionReply = (reply: import('fastify').FastifyReply, result: ManagedAiCompletionResult) => {
  if (result.ok === false) {
    return reply.status(result.status).send({
      code: result.code,
      message: MANAGED_AI_REFUSAL_MESSAGE[result.code] ?? result.code,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    });
  }
  reply.status(result.status);
  if (result.streaming === true) {
    // 🔴 必须把上游的 content-type 带过去：SSE 丢掉 `text/event-stream` 就等于
    // 客户端拿到一坨没有分隔语义的字节（`EventSource` 会直接报错），
    // 而这条只在**流式**那一路成立 —— 非流式那一路由下面的 `reply.type(…)` 负责。
    reply.type(result.contentType);
    return reply.send(result.body);
  }
  // 原样发**文本**而不是重新 `JSON.stringify` 解析结果：透传的判据是
  // "客户端拿到的字节 = 上游回的字节"，重排键序会让那条断言变成测我们自己的序列化器。
  return reply.type(result.contentType).send(result.text);
};
