import { DEFAULT_ROUTING_POLICY, invokeRouted, type AiRoutingConfig, type EgressConsent, type SecretStore } from '@heyta/ai';
import { inboundEnvelopeSchema } from '@heyta/shared-schema';
import {
  buildInboundModelInput, freezeInboundTaskBatch, inboundPublicKey, openInbound, sealInbound,
  type InboundAutomationField,
} from '@heyta/inbound-core';
import type { ClaimedAutomationEvent } from './inbound-worker.js';

export interface InboundAutomationRunOptions {
  claimed: ClaimedAutomationEvent;
  privateKey: Uint8Array;
  loadPrivateKey?: (keyEpoch: number) => Promise<Uint8Array | undefined>;
  secretStore?: SecretStore;
  accountId: string;
  serverOrigin: string;
  keyEpoch: number;
  allowedFields: readonly InboundAutomationField[];
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  systemPrompt: string;
  parseVersion: number;
  timezone?: string;
  maxItems?: number;
  targetProjectId?: string;
  reserve?: (input: { eventId: string; ruleId: string; parseVersion: number; attempt: number; leaseGeneration: number }) => Promise<{ state: string }>;
  advance?: (input: { eventId: string; ruleId: string; parseVersion: number; attempt: number; leaseGeneration: number; from: 'reserved' | 'sent'; to: 'sent' | 'consumed' | 'unknown' }) => Promise<boolean>;
  publish: (input: { eventId: string; leaseGeneration: number; parseVersion: number; itemCount: number; resultDigest: string; resultCiphertext: string; needsConfirmation?: boolean }) => Promise<unknown>;
  /** Same host/network injection used by the worker transport and provider call. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** One host-owned claim → decrypt → authorized model call → freeze → encrypt → publish cycle. */
export async function runInboundAutomationEvent(options: InboundAutomationRunOptions): Promise<{ itemCount: number; resultDigest: string; payload: ReturnType<typeof freezeInboundTaskBatch>['payload'] }> {
  const envelope = inboundEnvelopeSchema.parse(JSON.parse(options.claimed.payloadCiphertext));
  const inputKey = envelope.keyEpoch === options.keyEpoch ? options.privateKey : await options.loadPrivateKey?.(envelope.keyEpoch);
  if (inputKey === undefined) throw new Error('Inbound input key epoch is unavailable');
  let plaintext: Uint8Array;
  try {
    plaintext = await openInbound(envelope, inputKey, {
      accountId: options.accountId, serverOrigin: options.serverOrigin, ruleId: options.claimed.ruleId,
      eventId: options.claimed.eventId, purpose: 'input', keyEpoch: envelope.keyEpoch,
    });
  } finally { if (inputKey !== options.privateKey) inputKey.fill(0); }
  let raw: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    raw = options.claimed.contentType === 'text/plain' ? { title: text } : JSON.parse(text);
  } catch { throw new Error('Inbound event payload is invalid'); }
  finally { plaintext.fill(0); }
  const projected = buildInboundModelInput(raw, options.allowedFields);
  let sent = false;
  // The provider calls this only after route, consent, secret and wire checks.
  // One durable attempt maps to at most one physical request: automatic route
  // fallback would otherwise bypass the attempt ledger and double-charge.
  const meteredFetch: typeof fetch = async (input, init) => {
    if (sent) throw new Error('Inbound automation attempt already sent');
    const reservation = await options.reserve?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId,
      parseVersion: options.parseVersion, attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration });
    if (reservation !== undefined && reservation.state !== 'reserved') throw new Error('Inbound automation attempt requires reconciliation');
    const advanced = await options.advance?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId,
      parseVersion: options.parseVersion, attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration,
      from: 'reserved', to: 'sent' });
    if (advanced === false) throw new Error('Inbound automation attempt lost ownership');
    sent = true;
    return (options.fetchImpl ?? globalThis.fetch)(input, init);
  };
  let routed;
  try {
    routed = await invokeRouted(options.routing, {
      feature: 'inbound-automation', system: options.systemPrompt, user: JSON.stringify({ source: projected, context: { receivedAt: new Date(options.claimed.receivedAt).toISOString(), timezone: options.timezone ?? 'UTC' } }), fields: options.allowedFields,
    }, options.consents, { ...DEFAULT_ROUTING_POLICY, maxAttempts: 1, timeoutMs: 45_000 }, { fetchImpl: meteredFetch, secretStore: options.secretStore });
  } catch (error) {
    try { if (sent) await options.advance?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId, parseVersion: options.parseVersion,
      attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration, from: 'sent', to: 'unknown' }); } catch { /* preserve provider failure */ }
    throw error;
  }
  if (!routed.result.ok) {
    try { if (sent) await options.advance?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId, parseVersion: options.parseVersion,
      attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration, from: 'sent', to: 'unknown' }); } catch { /* preserve provider failure */ }
    throw new Error(`Inbound automation model failed: ${routed.result.reason}`);
  }
  await options.advance?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId, parseVersion: options.parseVersion,
    attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration, from: 'sent', to: 'consumed' });
  const frozen = freezeInboundTaskBatch({
      eventId: options.claimed.eventId, ruleId: options.claimed.ruleId, ruleVersion: options.claimed.ruleVersion,
      parseVersion: options.parseVersion, maxItems: options.maxItems, timezone: options.timezone, targetProjectId: options.targetProjectId,
      modelResult: JSON.parse(routed.result.suggestion.text), receivedAt: options.claimed.receivedAt,
    });
  const resultEnvelope = await sealInbound(new TextEncoder().encode(JSON.stringify(frozen.payload)), inboundPublicKey(options.privateKey), {
    accountId: options.accountId, serverOrigin: options.serverOrigin, ruleId: options.claimed.ruleId,
    eventId: options.claimed.eventId, purpose: 'result', keyEpoch: options.keyEpoch,
  });
  await options.publish({ eventId: options.claimed.eventId, leaseGeneration: options.claimed.leaseGeneration,
    parseVersion: options.parseVersion, itemCount: frozen.itemCount, resultDigest: frozen.resultDigest,
    resultCiphertext: JSON.stringify(resultEnvelope) });
  return { itemCount: frozen.itemCount, resultDigest: frozen.resultDigest, payload: frozen.payload };
}
