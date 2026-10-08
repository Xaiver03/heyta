import { invokeRouted, type AiRoutingConfig, type EgressConsent } from '@heyta/ai';
import {
  buildInboundModelInput, freezeInboundTaskBatch, inboundPublicKey, openInbound, sealInbound,
  type InboundAutomationField,
} from '@heyta/inbound-core';
import type { ClaimedAutomationEvent } from './inbound-worker.js';

export interface InboundAutomationRunOptions {
  claimed: ClaimedAutomationEvent;
  privateKey: Uint8Array;
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
  reserve?: (input: { eventId: string; ruleId: string; parseVersion: number; attempt: number; leaseGeneration: number }) => Promise<{ state: string }>;
  advance?: (input: { eventId: string; ruleId: string; parseVersion: number; attempt: number; leaseGeneration: number; from: 'reserved' | 'sent'; to: 'sent' | 'consumed' | 'unknown' }) => Promise<boolean>;
  publish: (input: { eventId: string; leaseGeneration: number; parseVersion: number; itemCount: number; resultDigest: string; resultCiphertext: string; needsConfirmation?: boolean }) => Promise<unknown>;
  /** Same host/network injection used by the worker transport and provider call. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** One host-owned claim → decrypt → authorized model call → freeze → encrypt → publish cycle. */
export async function runInboundAutomationEvent(options: InboundAutomationRunOptions): Promise<{ itemCount: number; resultDigest: string; payload: ReturnType<typeof freezeInboundTaskBatch>['payload'] }> {
  const now = options.now ?? Date.now;
  const plaintext = await openInbound(JSON.parse(options.claimed.payloadCiphertext), options.privateKey, {
    accountId: options.accountId, serverOrigin: options.serverOrigin, ruleId: options.claimed.ruleId,
    eventId: options.claimed.eventId, purpose: 'input', keyEpoch: options.keyEpoch,
  });
  let raw: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    raw = options.claimed.contentType === 'text/plain' ? { title: text } : JSON.parse(text);
  } catch { throw new Error('Inbound event payload is invalid'); }
  const projected = buildInboundModelInput(raw, options.allowedFields);
  const reservation = await options.reserve?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId,
    parseVersion: options.parseVersion, attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration });
  // A prior `sent`/`consumed`/`unknown` attempt may have reached a provider;
  // never issue a second physical model request without explicit recovery.
  if (reservation?.state === 'sent' || reservation?.state === 'consumed' || reservation?.state === 'unknown') {
    throw new Error('Inbound automation attempt requires reconciliation');
  }
  await options.advance?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId,
    parseVersion: options.parseVersion, attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration,
    from: 'reserved', to: 'sent' });
  let routed;
  try {
    routed = await invokeRouted(options.routing, {
      feature: 'inbound-automation', system: options.systemPrompt, user: JSON.stringify(projected), fields: options.allowedFields,
    }, options.consents, undefined, options.fetchImpl === undefined ? undefined : { fetchImpl: options.fetchImpl });
  } catch (error) {
    try { await options.advance?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId, parseVersion: options.parseVersion,
      attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration, from: 'sent', to: 'unknown' }); } catch { /* preserve provider failure */ }
    throw error;
  }
  if (!routed.result.ok) {
    try { await options.advance?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId, parseVersion: options.parseVersion,
      attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration, from: 'sent', to: 'unknown' }); } catch { /* preserve provider failure */ }
    throw new Error(`Inbound automation model failed: ${routed.result.reason}`);
  }
  let frozen;
  try {
    frozen = freezeInboundTaskBatch({
      eventId: options.claimed.eventId, ruleId: options.claimed.ruleId, ruleVersion: options.claimed.ruleVersion,
      parseVersion: options.parseVersion, maxItems: options.maxItems, timezone: options.timezone,
      modelResult: JSON.parse(routed.result.suggestion.text), receivedAt: now(),
    });
  } catch (error) {
    try { await options.advance?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId, parseVersion: options.parseVersion,
      attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration, from: 'sent', to: 'unknown' }); } catch { /* preserve parse failure */ }
    throw error;
  }
  await options.advance?.({ eventId: options.claimed.eventId, ruleId: options.claimed.ruleId, parseVersion: options.parseVersion,
    attempt: options.claimed.attempt, leaseGeneration: options.claimed.leaseGeneration, from: 'sent', to: 'consumed' });
  const envelope = await sealInbound(new TextEncoder().encode(JSON.stringify(frozen.payload)), inboundPublicKey(options.privateKey), {
    accountId: options.accountId, serverOrigin: options.serverOrigin, ruleId: options.claimed.ruleId,
    eventId: options.claimed.eventId, purpose: 'result', keyEpoch: options.keyEpoch,
  });
  await options.publish({ eventId: options.claimed.eventId, leaseGeneration: options.claimed.leaseGeneration,
    parseVersion: options.parseVersion, itemCount: frozen.itemCount, resultDigest: frozen.resultDigest,
    resultCiphertext: JSON.stringify(envelope) });
  return { itemCount: frozen.itemCount, resultDigest: frozen.resultDigest, payload: frozen.payload };
}
