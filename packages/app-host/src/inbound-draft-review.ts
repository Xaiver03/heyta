import { freezeInboundTaskBatch, inboundTaskDigest, openInbound, sealInbound } from '@heyta/inbound-core';
import { heytaTaskBatchPayloadSchema, inboundDraftPayloadSchema, inboundDraftTaskSchema, inboundEnvelopeSchema,
  type InboundDraftTask, type InboundDraftSnapshot, type HeytaTaskBatchPayload } from '@heyta/shared-schema';
import { createInboundRulesRemote } from './inbound-rules-remote.js';
import { createInboundRecipientRemote } from './inbound-recipient-remote.js';
import type { AutomationTicketRequest } from './inbound-entitlement-tickets.js';

export interface InboundDraftReviewOptions {
  accountId: string; baseUrl: string; getToken: () => Promise<string | undefined>;
  /** Returns a temporary key copy; this module clears it after use. */
  loadPrivateKey: (epoch: number) => Promise<Uint8Array | undefined>;
  assertActive: () => void;
  fetchImpl?: typeof fetch;
  /**
   * 只有**确认**要票：服务端把 `draft-confirm` 的授权放在账号锁之后、业务写事务之内
   * （`server/src/automation/events.ts` 的 `decideAutomationDraft`），而**取消**明确允许
   * 无订阅进行。给取消取票会多一次注定被拒的签发往返。
   */
  getEntitlementTicket?: (request: AutomationTicketRequest) => Promise<string>;
}
export interface InboundDraftReview {
  eventId: string; timezone: string; targetProjectId?: string;
  tasks: readonly InboundDraftTask[];
  confirm(tasks: readonly InboundDraftTask[]): Promise<void>;
  cancel(): Promise<void>;
}
const revision = (snapshot: InboundDraftSnapshot) => ({ expectedAttempt: snapshot.attempt,
  expectedRuleVersion: snapshot.ruleVersion, expectedDigest: snapshot.resultDigest });

/** Host-neutral decryption/editing; UI cannot replace source, target or task IDs. */
export function createInboundDraftReviewer(options: InboundDraftReviewOptions) {
  const assertActive = options.assertActive;
  const fetchImpl: typeof fetch = async (input, init) => {
    assertActive();
    const response = await (options.fetchImpl ?? globalThis.fetch)(input, init);
    assertActive();
    return response;
  };
  const getToken = async () => { assertActive(); const token = await options.getToken(); assertActive(); return token; };
  const remote = createInboundRulesRemote({ baseUrl: options.baseUrl, getToken, fetchImpl,
    ...(options.getEntitlementTicket === undefined ? {} : { getEntitlementTicket: options.getEntitlementTicket }) });
  const recipient = createInboundRecipientRemote({ baseUrl: options.baseUrl, getToken, fetchImpl });
  const cancel = async (snapshot: InboundDraftSnapshot): Promise<void> => {
    assertActive();
    await remote.decideDraft(snapshot.eventId, { ...revision(snapshot), decision: 'cancel' });
    assertActive();
  };
  return {
    /** Cancellation requires account authentication, not private-key recovery. */
    async cancel(eventId: string): Promise<void> {
      const snapshot = await remote.readDraft(eventId);
      assertActive();
      await cancel(snapshot);
    },
    async open(eventId: string): Promise<InboundDraftReview> {
      assertActive();
      const snapshot = await remote.readDraft(eventId);
      assertActive();
      const envelope = inboundEnvelopeSchema.parse(JSON.parse(snapshot.resultCiphertext));
      const key = await options.loadPrivateKey(envelope.keyEpoch);
      if (key === undefined) throw new Error('Inbound draft key recovery is required');
      let bytes: Uint8Array | undefined;
      let payload: HeytaTaskBatchPayload | ReturnType<typeof inboundDraftPayloadSchema.parse>;
      try {
        assertActive();
        bytes = await openInbound(envelope, key, { accountId: options.accountId, serverOrigin: new URL(options.baseUrl).origin,
          eventId, ruleId: snapshot.ruleId, purpose: 'result', keyEpoch: envelope.keyEpoch });
        assertActive();
        const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        const batch = heytaTaskBatchPayloadSchema.safeParse(raw);
        payload = batch.success ? batch.data : inboundDraftPayloadSchema.parse(raw);
      } finally { bytes?.fill(0); key.fill(0); }
      const source = payload.source;
      if (source.eventId !== eventId || source.ruleId !== snapshot.ruleId || source.ruleVersion !== snapshot.ruleVersion ||
          source.parseVersion !== snapshot.parseVersion || source.digest !== snapshot.resultDigest ||
          payload.tasks.length !== snapshot.resultItemCount || inboundTaskDigest(payload.tasks) !== snapshot.resultDigest) {
        throw new Error('Inbound draft content does not match its frozen receipt');
      }
      const rules = await remote.list();
      assertActive();
      const rule = rules.find((r) => r.id === source.ruleId && r.version === source.ruleVersion && r.parseVersion === source.parseVersion && r.deletedAt === null);
      if (!rule || payload.tasks.some((task) => task.projectId !== (rule.targetProjectId ?? undefined))) {
        throw new Error('Inbound draft rule changed');
      }
      const timezone = rule.timezone ?? 'UTC';
      const targetProjectId = rule.targetProjectId ?? undefined;
      const tasks = payload.tasks.map((task): InboundDraftTask => {
        const result: InboundDraftTask = { id: task.id, title: task.title, priority: task.priority,
          ...(task.note === undefined ? {} : { note: task.note }),
          ...(task.projectId === undefined ? {} : { projectId: task.projectId }),
          ...(task.durationMinutes === undefined ? {} : { durationMinutes: task.durationMinutes }) };
        for (const field of ['dueDate', 'startDate'] as const) {
          const dateOnly = 'heytaTaskBatch' in payload ? (task as HeytaTaskBatchPayload['tasks'][number])[`${field}Local`] : undefined;
          const value = task[field];
          if (value !== undefined) result[field] = dateOnly ?? (typeof value === 'number' ? new Date(value).toISOString() : value);
        }
        return result;
      });
      const ids = tasks.map((task) => task.id);
      // Neither UI mutations nor a changed rule can alter the captured authority.
      const authority = { eventId, ruleId: source.ruleId, ruleVersion: source.ruleVersion, parseVersion: source.parseVersion };
      return { eventId, timezone, ...(targetProjectId === undefined ? {} : { targetProjectId }),
        tasks: tasks.map((task) => ({ ...task })),
        cancel: () => cancel(snapshot),
        async confirm(edited): Promise<void> {
          assertActive();
          if (edited.length !== ids.length) throw new Error('Inbound draft item scope changed');
          const modelTasks = edited.map((raw, index) => {
            const task = inboundDraftTaskSchema.parse(raw);
            if (task.id !== ids[index] || task.projectId !== targetProjectId) throw new Error('Inbound draft item scope changed');
            const { id: _id, projectId: _target, ...fields } = task;
            return fields;
          });
          const frozen = freezeInboundTaskBatch({ ...authority, modelResult: { tasks: modelTasks },
            receivedAt: 0, timezone, targetProjectId, maxItems: rule.maxItems });
          assertActive();
          const current = await recipient.get();
          assertActive();
          if (!current) throw new Error('Inbound recipient key is unavailable');
          const publicKey = current.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '=';
          const encoded = new TextEncoder().encode(JSON.stringify(frozen.payload));
          let sealed;
          try { sealed = await sealInbound(encoded, publicKey, { accountId: options.accountId, serverOrigin: new URL(options.baseUrl).origin,
            eventId, ruleId: authority.ruleId, purpose: 'result', keyEpoch: current.keyEpoch }); }
          finally { encoded.fill(0); }
          assertActive();
          await remote.decideDraft(eventId, { ...revision(snapshot), decision: 'confirm', resultDigest: frozen.resultDigest,
            resultItemCount: frozen.itemCount, resultCiphertext: JSON.stringify(sealed) }, { action: 'draft-confirm', eventId });
          assertActive();
        },
      };
    },
  };
}
