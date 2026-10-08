import { runInboundAutomationEvent, type InboundAutomationRunOptions } from './inbound-runner.js';
import {
  claimAutomationEvent, readAutomationPreparedResult, publishAutomationResult, requestCommitPermitAndJournal,
  reserveAutomationAiAttempt, advanceAutomationAiAttempt, renewAutomationLease, type AutomationCommitJournal, type AutomationWorkerCredential,
} from './inbound-worker.js';
import { createTaskBatch, type TaskBatchContext } from './task-batch-actions.js';
import type { AiRoutingConfig, EgressConsent } from '@heyta/ai';
import type { InboundAutomationField } from '@heyta/inbound-core';
import { openInbound } from '@heyta/inbound-core';
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
}

/**
 * Claim at most one event and finish the durable commit fence. A prepared
 * result is frozen before asking for a permit; the proof is journaled before
 * dispatching the single batch op. Re-running after a crash reuses that proof
 * and the stable event/task identities.
 */
export async function processInboundAutomationEvent(options: ProcessInboundAutomationOptions): Promise<{
  state: 'empty' | 'submitted'; eventId?: string; itemCount?: number;
}> {
  const recovered = options.eventId === undefined ? undefined : await readAutomationPreparedResult({ baseUrl: options.baseUrl,
    token: options.token, worker: options.worker, eventId: options.eventId, fetchImpl: options.fetchImpl });
  const claimed = recovered === undefined
    ? await claimAutomationEvent({ baseUrl: options.baseUrl, token: options.token, worker: options.worker, fetchImpl: options.fetchImpl })
    : undefined;
  if (!recovered && !claimed) return { state: 'empty' };

  let frozen: { itemCount: number; resultDigest: string; payload: ReturnType<typeof heytaTaskBatchPayloadSchema.parse> } | undefined = undefined;
  if (recovered) {
    const envelope = inboundEnvelopeSchema.parse(JSON.parse(recovered.resultCiphertext));
    const recoveryKey = envelope.keyEpoch === options.keyEpoch
      ? options.privateKey
      : await options.loadPrivateKey?.(envelope.keyEpoch);
    if (recoveryKey === undefined) throw new Error('Inbound recipient key epoch is unavailable for recovery');
    let plaintext: Uint8Array;
    try {
      plaintext = await openInbound(envelope, recoveryKey, {
        accountId: options.accountId, serverOrigin: new URL(options.baseUrl).origin, ruleId: recovered.ruleId,
        eventId: recovered.eventId, purpose: 'result', keyEpoch: envelope.keyEpoch,
      });
    } finally {
      if (recoveryKey !== options.privateKey) recoveryKey.fill(0);
    }
    const payload = heytaTaskBatchPayloadSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
    if (payload.source.eventId !== recovered.eventId || payload.source.ruleId !== recovered.ruleId ||
        payload.source.ruleVersion !== recovered.ruleVersion || payload.source.parseVersion !== recovered.parseVersion ||
        payload.source.digest !== recovered.resultDigest || payload.tasks.length !== recovered.resultItemCount) {
      throw new Error('Recovered automation result does not match its server receipt');
    }
    frozen = { payload, itemCount: recovered.resultItemCount, resultDigest: recovered.resultDigest };
  }
  const transport: InboundAutomationRunOptions | undefined = claimed === undefined ? undefined : {
    claimed, privateKey: options.privateKey, accountId: options.accountId,
    serverOrigin: new URL(options.baseUrl).origin, keyEpoch: options.keyEpoch,
    // The server's claim snapshot is authoritative for this rule version;
    // caller-supplied values remain the recovery fallback for old fixtures.
    allowedFields: claimed.allowedFields.length > 0 ? claimed.allowedFields : options.allowedFields,
    routing: options.routing, consents: options.consents,
    systemPrompt: options.systemPrompt,
    parseVersion: claimed.parseVersion > 0 ? claimed.parseVersion : options.parseVersion,
    maxItems: claimed.maxItems > 0 ? claimed.maxItems : options.maxItems,
    timezone: claimed.timezone ?? options.timezone,
    reserve: (input) => reserveAutomationAiAttempt({ ...input, baseUrl: options.baseUrl, token: options.token,
      worker: options.worker, fetchImpl: options.fetchImpl }),
    advance: (input) => advanceAutomationAiAttempt({ ...input, baseUrl: options.baseUrl, token: options.token,
      worker: options.worker, fetchImpl: options.fetchImpl }),
    publish: (input) => publishAutomationResult({ ...input, baseUrl: options.baseUrl, token: options.token,
      worker: options.worker, fetchImpl: options.fetchImpl }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    now: options.now,
  };
  // Keep the lease alive while a provider call is in flight. The server still
  // fences every mutation by generation, so a late renewal cannot resurrect a
  // worker that lost ownership.
  const timer = claimed === undefined ? undefined : setInterval(() => {
    void renewAutomationLease({ baseUrl: options.baseUrl, token: options.token, worker: options.worker,
    eventId: claimed.eventId, leaseGeneration: claimed.leaseGeneration, fetchImpl: options.fetchImpl }).catch(() => undefined);
  }, 30_000);
  try { if (transport) frozen = await runInboundAutomationEvent(transport); }
  finally { if (timer !== undefined) clearInterval(timer); }
  const completed = frozen;
  if (!completed) throw new Error('Inbound automation result was not produced');
  const eventId = recovered?.eventId ?? claimed!.eventId;
  const ruleId = recovered?.ruleId ?? claimed!.ruleId;
  const ruleVersion = recovered?.ruleVersion ?? claimed!.ruleVersion;
  const opId = `inbound:${eventId}`;
  const existingProof = await options.journal.load(eventId);
  if (existingProof === undefined) {
    await requestCommitPermitAndJournal({ baseUrl: options.baseUrl, token: options.token, worker: options.worker,
      request: { clientId: options.worker.clientId, databaseEpoch: options.worker.databaseEpoch,
        eventId, opId, ruleId, ruleVersion,
        parseVersion: completed.payload.source.parseVersion, resultDigest: completed.resultDigest, itemCount: completed.itemCount },
      journal: options.journal, fetchImpl: options.fetchImpl });
  }
  const targetProjectId = recovered === undefined ? (claimed?.targetProjectId ?? options.targetProjectId) : options.targetProjectId;
  await createTaskBatch(options.taskBatch, completed.payload, {
    source: completed.payload.source,
    targetProjectId,
  });
  return { state: 'submitted', eventId, itemCount: completed.itemCount };
}
