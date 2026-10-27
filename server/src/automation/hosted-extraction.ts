/**
 * 自动收集的「接收即抽取」这一档（ADR-0077）：服务端在收到 webhook 的那一刻把正文
 * 交给托管模型抽出任务字段，把**冻结后的结果**用该账号的收件人公钥重新封好，
 * 然后立刻把正文丢掉。
 * =============================================================================
 *
 * ## 这条腿存在的唯一理由
 *
 * 收件人公钥是**设备**生成的：接收路径把正文封给一把自己永远打不开的钥匙
 * （`sealInbound` 用的是 HPKE，封给账号的收件人公钥）。所以服务端要读正文，
 * 只有一个时刻办得到 —— **它手里还拿着明文的那一秒**，也就是接收这一趟里。
 * 晚一步（异步队列）就等于要么把明文留在库里，要么把根密钥交给服务端。
 * 这两件事这条腿都不做，理由见下面两节。
 *
 * ## 🔴 三条红线，每条都有一条会红的用例钉着
 *
 * | 红线 | 落点 | 用例 |
 * |---|---|---|
 * | 正文**不落库**：抽取成功那一支把 `payload_ciphertext` 写成 `NULL`，库里只剩重封后的结果 | `finalize` 那两条 SQL | 「抽取成功 ⇒ 那一行的 `payload_ciphertext` 是 NULL，而标记串在整张表里搜不到」 |
 * | 正文**不进日志**：审计只走 `recordManagedAiAttempt` 那张参数表（没有接内容的位置） | `managed-completion.ts` | 复用 `managed-proxy.routes.spec.ts` 的标记串断言 + 本文件那条 `outcome` 码表 |
 * | **任务写回仍归设备**：这条腿不写 op-log、不碰 Vault 根密钥，只把结果冻在库里等设备来领 | 全文件没有任何 `automation_commit_permits` 写入 | 「本文件里不许出现 commit permit / op 写入」那条源码断言 |
 *
 * ## 抽取失败不是"丢了一条 webhook"
 *
 * 模型报错 / 额度用尽 / 上游没配 ⇒ 这一行**退回 `queued`**，密文仍是封给收件人公钥的那份，
 * 于是设备那条老路（claim → 自己解密 → 自己抽）照旧接管。也就是说：
 * 这一档**只可能让抽取更早，不可能让内容更少**。
 *
 * ## 🔴 额度只在这里扣**一次**
 *
 * 物理调用走 `invokeManagedAiCompletion`，额度由它第 ⑤ 步的 `consumeManagedAiRequest`
 * 消耗一次。这条腿**不写** `automation_ai_attempts` 那本台账 ——
 * 那本台账是为"设备发了活但结果不确定"设计的（它要能回答"这一趟到底发出去了没有"），
 * 而这条腿的同一件事由**那一行自己的租约**回答：抽取前把行置成 `leased` 且
 * `lease_worker_id = 'hosted-extraction'`，进程中途死掉 ⇒ 设备领到这条租约时
 * 按"结果不明"处理（`events.ts` 那一支），要用户显式重试，绝不静默再发一次。
 * ⚠️ 设备那条腿上「预留扣一次、代理再扣一次」的双重计费（工单 A4）是**另一件事**，
 * 修法归负责人；这一档不替它改语义，也不把它的错搬进来。
 */
import {
  buildInboundModelInput, INBOUND_AUTOMATION_SYSTEM_PROMPT,
  prepareInboundAutomationResult, sealInbound, type InboundAutomationField,
} from '@heyta/inbound-core';
import { z } from 'zod';

import { prisma } from '../db';
import { loadConfigFromEnv, type ManagedAiConfig } from '../config';
import { createPrismaSqlExecutor } from '../billing/pricing-store';
import { MANAGED_AI_ERROR_CODES, invokeManagedAiCompletion, managedAiFetchTransport,
  type ManagedAiCompletionContext, type ManagedAiCompletionRequest, type ManagedAiCompletionResult } from '../ai/managed-completion';
import { MANAGED_AI_REQUESTS_PER_PERIOD } from '../ai/metering';
import { SERVER_MANAGED_MODEL_HOSTS } from '../ai/managed-upstream';

/**
 * 服务端这条租约的持有者标识。
 *
 * 🔴 它**不是** `automation_workers` 里的一行：那一行代表"一台注册过的设备"，
 * 而服务端不是设备。写成这个字面量，是为了让 `claimAutomationEvent` 在
 * "租约过期但没人交结果"的那一刻能分辨这是谁的活 —— 它据此把事件转成
 * 待确认而不是重新抽一遍（宁可让用户点一次重试，不可静默多烧一次额度）。
 */
export const HOSTED_EXTRACTION_LEASE_OWNER = 'hosted-extraction';

/**
 * 一次接收的同步等待上限。
 *
 * 30 秒这个数不是拍的：公网发送方的重试窗口普遍落在 10–30 秒，而**重投这一发**
 * 会被 `eventId` 去重挡在门外（同一 event 不会抽第二次）。所以这条腿真正的约束是
 * "别在发送方已经放弃之后才回它" —— 超过这个上限就走 `queued` 退回设备那条腿，
 * 内容一个字都不少。
 */
export const HOSTED_EXTRACTION_TIMEOUT_MS = 30_000;

/** 抽取用那一行的租约时长：比同步等待上限长，留出"进程还在但网络慢"的余量。 */
export const HOSTED_EXTRACTION_LEASE_MS = 120_000;

export interface HostedExtractionRule {
  id: string;
  userId: number;
  version: number;
  allowedFields: readonly InboundAutomationField[];
  targetProjectId: string | null;
  timezone: string | null;
  parseVersion: number;
  maxItems: number;
}

export interface HostedExtractionRequest {
  rule: HostedExtractionRule;
  eventId: string;
  contentType: 'application/json' | 'text/plain';
  /** 正文明文：只在这一次调用栈里存在，本模块不把它写进任何一行、任何一条日志。 */
  plaintext: Uint8Array;
  /** 账号收件人公钥（canonical RFC 4648 base64，由调用方归一化过）。 */
  publicKey: string;
  keyEpoch: number;
  accountId: string;
  serverOrigin: string;
  receivedAt: number;
}

/**
 * 稳定原因码（**封闭词表**）：这一行的 `reason_code` 与审计里的 `outcome` 都从这里取。
 * 🔴 没有一条带正文 —— `payload_invalid` 说的就是"形状不对"，不是"我看到的是……"。
 */
export type HostedExtractionFailure =
  | 'model-not-configured'
  | 'model-upstream-rejected'
  | 'model-entitlement-required'
  | 'model-quota-exhausted'
  | 'model-request-failed'
  | 'model-result-unreadable'
  | 'payload-invalid'
  | 'result-conflict';

export type HostedExtractionOutcome =
  | { readonly state: 'prepared'; readonly resultCiphertext: string; readonly resultDigest: string;
      readonly itemCount: number }
  | { readonly state: 'needs-confirmation'; readonly resultCiphertext: string; readonly resultDigest: string;
      readonly itemCount: number }
  | { readonly state: 'failed'; readonly reason: HostedExtractionFailure };

/**
 * OpenAI 兼容响应里我们唯一要的那一格：**补全文本**，不读、不记任何其他字段。
 * 🔴 解析失败一律归到 `model-result-unreadable`，错误文本不回显（供应商会把请求内容抄回来）。
 */
const completionContentSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

/** 解析不成的 JSON 一律给 `undefined`：错误文本不回显、不入库、不进日志。 */
const safeJson = (text: string): unknown => {
  try { return JSON.parse(text); } catch { return undefined; }
};

/**
 * 这一次补全该由谁来发。默认就是那一条**唯一**的发送腿 `invokeManagedAiCompletion`；
 * 把它做成入参只为让用例能在不装库、不连上游的情况下逐支打红（闸门顺序本身由
 * `managed-proxy.routes.spec.ts` 在那条腿上钉着，这里不重复钉第二遍）。
 */
export type HostedCompletion = (context: ManagedAiCompletionContext, request: ManagedAiCompletionRequest) => Promise<ManagedAiCompletionResult>;

/** 导出只为让用例能读默认那一份：里面 `plaintextHosts` 必须是空，见下面那行注释。 */
export const hostedManagedCompletionContext = (): ManagedAiCompletionContext => ({
  upstream: loadConfigFromEnv().managedAi as ManagedAiConfig | undefined,
  sql: createPrismaSqlExecutor(prisma),
  limit: MANAGED_AI_REQUESTS_PER_PERIOD,
  now: Date.now,
  transport: managedAiFetchTransport(HOSTED_EXTRACTION_TIMEOUT_MS),
  hosts: SERVER_MANAGED_MODEL_HOSTS,
  // 🔴 明文主机表保持空：这条腿不发 `http://`，与设备走代理时同一道闸。
  plaintextHosts: [],
  startedAt: Date.now(),
});

/** 把一次托管补全的拒绝码翻成这条腿的稳定原因码（封闭词表，界面上取词条）。 */
const failureForRefusal = (result: Extract<ManagedAiCompletionResult, { ok: false }>): HostedExtractionFailure => {
  if (result.code === MANAGED_AI_ERROR_CODES.NOT_CONFIGURED) return 'model-not-configured';
  if (result.code === MANAGED_AI_ERROR_CODES.UPSTREAM_NOT_DOMESTIC) return 'model-upstream-rejected';
  if (result.code === MANAGED_AI_ERROR_CODES.ENTITLEMENT_REQUIRED) return 'model-entitlement-required';
  if (result.code === MANAGED_AI_ERROR_CODES.QUOTA_EXCEEDED) return 'model-quota-exhausted';
  return 'model-request-failed';
};

/**
 * 只做"把正文交给模型、把结果冻成契约里的形状"这一段。
 * 不碰数据库、不碰租约 —— 所以它可以在不装库的情况下被用例逐支打红。
 */
export async function extractInboundAtIngest(request: HostedExtractionRequest,
  complete: HostedCompletion = invokeManagedAiCompletion,
  context: ManagedAiCompletionContext = hostedManagedCompletionContext()): Promise<HostedExtractionOutcome> {
  let raw: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(request.plaintext);
    raw = request.contentType === 'text/plain' ? { title: text } : JSON.parse(text);
  } catch {
    return { state: 'failed', reason: 'payload-invalid' };
  }
  let modelInput: Record<string, unknown>;
  try {
    modelInput = buildInboundModelInput(raw, request.rule.allowedFields);
  } catch {
    return { state: 'failed', reason: 'payload-invalid' };
  }
  const result = await complete(context, {
    userId: request.rule.userId,
    feature: 'inbound-automation',
    messages: [
      { role: 'system', content: INBOUND_AUTOMATION_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ source: modelInput,
        context: { receivedAt: new Date(request.receivedAt).toISOString(), timezone: request.rule.timezone ?? 'UTC' } }) },
    ],
  });
  if (result.ok === false) return { state: 'failed', reason: failureForRefusal(result) };
  if (result.streaming === true) return { state: 'failed', reason: 'model-result-unreadable' };
  const parsedCompletion = completionContentSchema.safeParse(safeJson(result.text));
  const content = parsedCompletion.success ? parsedCompletion.data.choices[0]?.message.content : undefined;
  if (typeof content !== 'string') return { state: 'failed', reason: 'model-result-unreadable' };
  const modelResult = safeJson(content);
  if (modelResult === undefined) return { state: 'failed', reason: 'model-result-unreadable' };
  let frozen;
  try {
    frozen = prepareInboundAutomationResult({
      eventId: request.eventId, ruleId: request.rule.id, ruleVersion: request.rule.version,
      parseVersion: request.rule.parseVersion, maxItems: request.rule.maxItems,
      timezone: request.rule.timezone ?? undefined, targetProjectId: request.rule.targetProjectId ?? undefined,
      modelResult, receivedAt: request.receivedAt,
    });
  } catch {
    // 模型给了不合规的字段 / 超出条数上限：这不是"结果待确认"，是这一次抽取没成 ——
    // 退回设备那条腿，让它按老路自己抽一遍（它有同一个 parseVersion 与同一套校验）。
    return { state: 'failed', reason: 'model-result-unreadable' };
  }
  const envelope = await sealInbound(
    new TextEncoder().encode(JSON.stringify(frozen.payload)),
    request.publicKey,
    { accountId: request.accountId, serverOrigin: request.serverOrigin, ruleId: request.rule.id,
      eventId: request.eventId, purpose: 'result', keyEpoch: request.keyEpoch },
  );
  return { state: frozen.needsConfirmation === true ? 'needs-confirmation' : 'prepared',
    resultCiphertext: JSON.stringify(envelope), resultDigest: frozen.resultDigest, itemCount: frozen.itemCount };
}

/**
 * 把这一行领成服务端这条腿的活：`queued` → `leased`（持有者写成本模块那枚字面量）。
 *
 * 🔴 领取与设备那条路用的是**同一套行状态**，所以两台设备正在抢的同一发事件
 * 不会同时被两边抽：谁先把 `status = 'queued'` 改成 `leased`，另一边就匹配 0 行。
 * 领不到就什么都不做（连一次模型请求都不发），交给先到的那一方。
 */
export async function leaseForHostedExtraction(input: {
  userId: number; ruleId: string; eventId: string; ruleVersion: number; now: () => number;
}): Promise<{ leaseGeneration: number; attempt: number } | undefined> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
    const current = await tx.automationEvent.findFirst({ where: {
      userId: input.userId, ruleId: input.ruleId, eventId: input.eventId,
    } });
    // `payload_ciphertext IS NOT NULL` 这一条不是多余：抽取成功后正文那一列被抹成 NULL，
    // 重投的同一发（同 eventId）绝不能被再领一次去重新抽 —— 那等于同一份内容烧两次额度。
    if (!current || current.status !== 'queued' || current.payloadCiphertext === null ||
        current.ruleVersion !== input.ruleVersion || current.expiresAt.getTime() <= input.now()) return undefined;
    const rule = await tx.automationRule.findFirst({ where: { id: input.ruleId, userId: input.userId },
      select: { enabled: true, deletedAt: true, version: true } });
    if (!rule || !rule.enabled || rule.deletedAt !== null || rule.version !== input.ruleVersion) return undefined;
    const next = await tx.automationEvent.update({ where: { userId_ruleId_eventId: {
      userId: input.userId, ruleId: input.ruleId, eventId: input.eventId } }, data: {
      status: 'leased', leaseWorkerId: HOSTED_EXTRACTION_LEASE_OWNER, leaseGeneration: { increment: 1 },
      leaseExpiresAt: new Date(input.now() + HOSTED_EXTRACTION_LEASE_MS), attempt: { increment: 1 },
    } });
    return { leaseGeneration: next.leaseGeneration, attempt: next.attempt };
  });
}

/** 抽取的终态落回那一行；租约已被别人接走时匹配 0 行，这一次的结果直接丢弃。 */
export async function finalizeHostedExtraction(input: {
  userId: number; ruleId: string; eventId: string; leaseGeneration: number; parseVersion: number;
  now: () => number;
}, outcome: HostedExtractionOutcome): Promise<'prepared' | 'needs-confirmation' | 'queued' | 'stale'> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
    const identity = { userId_ruleId_eventId: { userId: input.userId, ruleId: input.ruleId, eventId: input.eventId } };
    const current = await tx.automationEvent.findFirst({ where: {
      userId: input.userId, ruleId: input.ruleId, eventId: input.eventId,
      status: 'leased', leaseWorkerId: HOSTED_EXTRACTION_LEASE_OWNER, leaseGeneration: input.leaseGeneration,
    } });
    if (!current || current.expiresAt.getTime() <= input.now()) return 'stale';
    if (outcome.state === 'failed') {
      // 退回 `queued`：正文那份密文还在（`payload_ciphertext` 从没被写过 NULL），
      // 设备那条老路于是能照旧接管 —— 这一档"只可能更早，不可能更少"就落在这条 SQL 上。
      await tx.automationEvent.update({ where: identity, data: {
        status: 'queued', reasonCode: null, leaseWorkerId: null, leaseExpiresAt: null } });
      return 'queued';
    }
    await tx.automationEvent.update({ where: identity, data: {
      status: outcome.state, reasonCode: outcome.state === 'needs-confirmation' ? 'needs-confirmation' : null,
      parseVersion: input.parseVersion, resultDigest: outcome.resultDigest,
      resultCiphertext: outcome.resultCiphertext, resultItemCount: outcome.itemCount,
      // 🔴 这一行就是这条腿的全部意义：正文的密文从此不再存在。
      payloadCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null,
    } });
    return outcome.state;
  });
}

/**
 * 接收这一趟的完整一条腿：领活 → 当场抽 → 落终态。
 * 返回事件对发送方披露的状态（与既有 `statusResponse` 同一词表）。
 */
export async function runHostedExtractionAtIngest(request: HostedExtractionRequest,
  extraction: { complete?: HostedCompletion; context?: ManagedAiCompletionContext } = {}): Promise<HostedExtractionOutcome> {
  const lease = await leaseForHostedExtraction({ userId: request.rule.userId, ruleId: request.rule.id,
    eventId: request.eventId, ruleVersion: request.rule.version, now: Date.now });
  if (lease === undefined) return { state: 'failed', reason: 'result-conflict' };
  let outcome: HostedExtractionOutcome;
  try {
    outcome = await extractInboundAtIngest(request, extraction.complete, extraction.context);
  } catch {
    // 抛出来的一切（封不上、契约不合、上游炸了）都归到"这一次没成"：
    // 下面那一步于是把行退回 `queued`，设备那条老路接管。
    // 🔴 `catch` 不绑 error：错误文本里可能带着正文的一部分，而这条路径上没有任何地方该接住它。
    outcome = { state: 'failed', reason: 'model-request-failed' };
  }
  const settled = await finalizeHostedExtraction({ userId: request.rule.userId, ruleId: request.rule.id,
    eventId: request.eventId, leaseGeneration: lease.leaseGeneration, parseVersion: request.rule.parseVersion,
    now: Date.now }, outcome);
  if (settled === 'stale') return { state: 'failed', reason: 'result-conflict' };
  return outcome;
}
