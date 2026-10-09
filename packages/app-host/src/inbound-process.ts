import { runInboundAutomationEvent, type InboundAutomationRunOptions } from './inbound-runner.js';
import {
  claimAutomationEvent, readAutomationPreparedResult, publishAutomationResult, requestCommitPermitAndJournal,
  reserveAutomationAiAttempt, advanceAutomationAiAttempt, renewAutomationLease, AutomationEntitlementRequiredError,
  type AutomationCommitJournal, type AutomationWorkerCredential,
} from './inbound-worker.js';
import { AutomationTicketError, type AutomationTicketRequest } from './inbound-entitlement-tickets.js';
import { createTaskBatch, type TaskBatchContext } from './task-batch-actions.js';
import type { AiRoutingConfig, EgressConsent, SecretStore } from '@heyta/ai';
import type { InboundAutomationField } from '@heyta/inbound-core';
import { inboundTaskDigest, openInbound } from '@heyta/inbound-core';
import { heytaTaskBatchPayloadSchema, inboundEnvelopeSchema } from '@heyta/shared-schema';

/**
 * One host-owned inbound cycle. The transport is deliberately injected so the
 * same protocol is used by Web, Node and native shells while secrets and the
 * op-log remain platform-owned.
 */
export interface ProcessInboundAutomationOptions {
  baseUrl: string;
  token: string;
  worker: AutomationWorkerCredential;
  journal: AutomationCommitJournal;
  privateKey: Uint8Array;
  accountId: string;
  keyEpoch: number;
  allowedFields: readonly InboundAutomationField[];
  targetProjectId?: string;
  maxItems?: number;
  routing: AiRoutingConfig;
  secretStore?: SecretStore;
  consents: readonly EgressConsent[];
  systemPrompt: string;
  parseVersion: number;
  timezone?: string;
  /** Set when recovering a prepared result after a process crash. */
  eventId?: string;
  taskBatch: TaskBatchContext;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Load a retained private key when a frozen result uses an older epoch. */
  loadPrivateKey?: (keyEpoch: number) => Promise<Uint8Array | undefined>;
  /** Synchronous host fence: account/session/Vault must still belong to this run. */
  assertActive?: () => void;
  /**
   * 每一次受权益闸门的动作**临写之前**现取一枚只放行它自己的票据（协议 §4：票据绑
   * action + 实例 + 账号 + rule/event + nonce + 版本 + expiry，≤30 秒且一次使用）。
   * 不给 = 这一路不带票，服务端按官方模式那套订阅判定放行。
   */
  getEntitlementTicket?: (request: AutomationTicketRequest) => Promise<string>;
}

export type InboundAutomationCycleState = 'empty' | 'submitted' | 'needs-confirmation' | 'waiting-entitlement';

export type InboundAutomationCycleResult = { state: InboundAutomationCycleState; eventId?: string; itemCount?: number };

/**
 * Claim at most one event and finish the durable commit fence. A prepared
 * result is frozen before asking for a permit; the proof is journaled before
 * dispatching the single batch op. Re-running after a crash reuses that proof
 * and the stable event/task identities.
 *
 * 🔴 权益不足回 `waiting-entitlement`，不回一条报错：402（服务端判这台实例现在没资格）
 * 和"取票被拒且属于等待族"（没绑定 / 签发方没配 / 签发方不在这台实例上）都让用户
 * 重试同一个按钮没有意义。非等待族（票据坏、作用域不符）照原样抛出 —— 那是缺陷，
 * 把它一起吞成"等待权益"就是把 bug 说成订阅问题。
 */
export async function processInboundAutomationEvent(options: ProcessInboundAutomationOptions): Promise<InboundAutomationCycleResult> {
  try {
    return await runInboundAutomationCycle(options);
  } catch (error) {
    if (error instanceof AutomationTicketError && error.waiting) return { state: 'waiting-entitlement' };
    if (error instanceof AutomationEntitlementRequiredError) return { state: 'waiting-entitlement' };
    throw error;
  }
}

async function runInboundAutomationCycle(options: ProcessInboundAutomationOptions): Promise<InboundAutomationCycleResult> {
  const assertActive = (): void => { options.assertActive?.(); };
  const getTicket = options.getEntitlementTicket;
  // 没配取票源时返回空展开，而不是 `entitlementTicket: undefined` —— 这个仓库的可选属性
  // 是精确可选的，塞一个 undefined 进去与"没有这一项"不是同一件事。
  const ticketFor = async (request: AutomationTicketRequest): Promise<{ readonly entitlementTicket: string } | Record<string, never>> =>
    getTicket === undefined ? {} : { entitlementTicket: await getTicket(request) };
  const fetchImpl: typeof fetch = async (input, init) => {
    assertActive();
    const response = await (options.fetchImpl ?? globalThis.fetch)(input, init);
    assertActive();
    return response;
  };
  assertActive();
  const recovered = await readAutomationPreparedResult({ baseUrl: options.baseUrl,
    token: options.token, worker: options.worker, eventId: options.eventId, fetchImpl });
  const claimed = recovered === undefined
    ? await claimAutomationEvent({ baseUrl: options.baseUrl, token: options.token, worker: options.worker, eventId: options.eventId, fetchImpl,
      ...(await ticketFor({ action: 'event-claim' })) })
    : undefined;
  assertActive();
  if (!recovered && !claimed) return { state: 'empty' };

  let frozen: Awaited<ReturnType<typeof runInboundAutomationEvent>> | undefined = undefined;
  if (recovered) {
    const envelope = inboundEnvelopeSchema.parse(JSON.parse(recovered.resultCiphertext));
    const recoveryKey = envelope.keyEpoch === options.keyEpoch
      ? options.privateKey
      : await options.loadPrivateKey?.(envelope.keyEpoch);
    if (recoveryKey === undefined) throw new Error('Inbound recipient key epoch is unavailable for recovery');
    let plaintext: Uint8Array;
    try {
      assertActive();
      plaintext = await openInbound(envelope, recoveryKey, {
        accountId: options.accountId, serverOrigin: new URL(options.baseUrl).origin, ruleId: recovered.ruleId,
        eventId: recovered.eventId, purpose: 'result', keyEpoch: envelope.keyEpoch,
      });
    } finally {
      if (recoveryKey !== options.privateKey) recoveryKey.fill(0);
    }
    let payload: ReturnType<typeof heytaTaskBatchPayloadSchema.parse>;
    try { payload = heytaTaskBatchPayloadSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext))); }
    finally { plaintext.fill(0); }
    if (payload.source.eventId !== recovered.eventId || payload.source.ruleId !== recovered.ruleId ||
        payload.source.ruleVersion !== recovered.ruleVersion || payload.source.parseVersion !== recovered.parseVersion ||
        payload.source.digest !== recovered.resultDigest || payload.tasks.length !== recovered.resultItemCount ||
        inboundTaskDigest(payload.tasks) !== recovered.resultDigest) {
      throw new Error('Recovered automation result does not match its server receipt');
    }
    frozen = { payload, itemCount: recovered.resultItemCount, resultDigest: recovered.resultDigest, needsConfirmation: false };
  }
  const transport: InboundAutomationRunOptions | undefined = claimed === undefined ? undefined : {
    claimed, privateKey: options.privateKey, loadPrivateKey: options.loadPrivateKey, accountId: options.accountId,
    serverOrigin: new URL(options.baseUrl).origin, keyEpoch: options.keyEpoch,
    // The server's claim snapshot is authoritative for this rule version;
    // caller-supplied values remain the recovery fallback for old fixtures.
    allowedFields: claimed.allowedFields.length > 0 ? claimed.allowedFields : options.allowedFields,
    routing: options.routing, consents: options.consents, secretStore: options.secretStore,
    systemPrompt: options.systemPrompt,
    parseVersion: claimed.parseVersion > 0 ? claimed.parseVersion : options.parseVersion,
    maxItems: claimed.maxItems > 0 ? claimed.maxItems : options.maxItems,
    timezone: claimed.timezone ?? options.timezone,
    targetProjectId: claimed.targetProjectId,
    reserve: async (input) => reserveAutomationAiAttempt({ ...input, baseUrl: options.baseUrl, token: options.token,
      worker: options.worker, fetchImpl, ...(await ticketFor({ action: 'ai-reserve', eventId: input.eventId })) }),
    advance: (input) => advanceAutomationAiAttempt({ ...input, baseUrl: options.baseUrl, token: options.token,
      worker: options.worker, fetchImpl }),
    publish: async (input) => publishAutomationResult({ ...input, baseUrl: options.baseUrl, token: options.token,
      worker: options.worker, fetchImpl, ...(await ticketFor({ action: 'result-publish', eventId: input.eventId })) }),
    fetchImpl,
    now: options.now,
  };
  // Keep the lease alive while a provider call is in flight. The server still
  // fences every mutation by generation, so a late renewal cannot resurrect a
  // worker that lost ownership.
  const timer = claimed === undefined ? undefined : setInterval(() => {
    void renewAutomationLease({ baseUrl: options.baseUrl, token: options.token, worker: options.worker,
    eventId: claimed.eventId, leaseGeneration: claimed.leaseGeneration, fetchImpl }).catch(() => undefined);
  }, 20_000);
  try { if (transport) frozen = await runInboundAutomationEvent(transport); }
  finally { if (timer !== undefined) clearInterval(timer); }
  const completed = frozen;
  if (!completed) throw new Error('Inbound automation result was not produced');
  const eventId = recovered?.eventId ?? claimed!.eventId;
  if (completed.needsConfirmation) {
    // The result is encrypted and frozen on the server, but no commit permit
    // or local op may be created until the user explicitly resolves it.
    return { state: 'needs-confirmation', eventId, itemCount: completed.itemCount };
  }
  const payload = heytaTaskBatchPayloadSchema.parse(completed.payload);
  const ruleId = recovered?.ruleId ?? claimed!.ruleId;
  const ruleVersion = recovered?.ruleVersion ?? claimed!.ruleVersion;
  const opId = `inbound:${eventId}`;
  const existingProof = await options.journal.load(eventId);
  assertActive();
  if (existingProof === undefined) {
    await requestCommitPermitAndJournal({ baseUrl: options.baseUrl, token: options.token, worker: options.worker,
      request: { clientId: options.worker.clientId, databaseEpoch: options.worker.databaseEpoch,
        eventId, opId, ruleId, ruleVersion,
        parseVersion: completed.payload.source.parseVersion, resultDigest: completed.resultDigest, itemCount: completed.itemCount },
      journal: options.journal, fetchImpl, ...(await ticketFor({ action: 'commit-permit', eventId })) });
  }
  // The sealed result froze the original rule target. Neither current UI state
  // nor a caller fallback may retarget an already prepared batch during recovery.
  const targetProjectId = completed.payload.tasks[0]?.projectId;
  assertActive();
  await createTaskBatch({ dispatchValidated: (intent, validate) => options.taskBatch.dispatchValidated(intent, (state) => {
    // This runs inside the engine's serialized dispatch, after queued writes.
    assertActive();
    validate(state);
  }) }, payload, {
    source: payload.source,
    targetProjectId,
  });
  return { state: 'submitted', eventId, itemCount: completed.itemCount };
}
