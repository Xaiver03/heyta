import { describe, expect, it, vi } from 'vitest';
import { generateInboundKeyPair, openInbound, prepareInboundAutomationResult, sealInbound, inboundTaskDigest } from '@heyta/inbound-core';
import { heytaTaskBatchPayloadSchema } from '@heyta/shared-schema';
import { createInboundDraftReviewer } from '../src/inbound-draft-review.js';

async function fixture() {
  const old = generateInboundKeyPair();
  const current = generateInboundKeyPair();
  const scope = { eventId: 'event', ruleId: '11111111-1111-4111-8111-111111111111', ruleVersion: 1, parseVersion: 1 };
  const context = { accountId: 'account', serverOrigin: 'https://sync.test', eventId: scope.eventId, ruleId: scope.ruleId, purpose: 'result' as const };
  const result = prepareInboundAutomationResult({ ...scope, receivedAt: 1, timezone: 'Asia/Shanghai', targetProjectId: 'project',
    modelResult: { tasks: [{ title: 'Review date', dueDate: '2026-02-30' }] } });
  const ciphertext = JSON.stringify(await sealInbound(new TextEncoder().encode(JSON.stringify(result.payload)), old.publicKey, { ...context, keyEpoch: 1 }));
  const snapshot = { ...scope, attempt: 2, resultDigest: result.resultDigest, resultItemCount: 1, resultCiphertext: ciphertext };
  let active = true;
  const keyCopies: Uint8Array[] = [];
  const decisions: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/draft')) return Response.json(snapshot);
    if (path.endsWith('/rules')) return Response.json({ rules: [{ id: scope.ruleId, version: 1, enabled: true, keyId: 'hook',
      createdAt: '2026-01-01T00:00:00Z', deletedAt: null, allowedFields: ['title', 'dueDate'], targetProjectId: 'project',
      timezone: 'Asia/Shanghai', parseVersion: 1, authorizationVersion: 1, maxItems: 2 }] });
    if (path.endsWith('/recipient-key')) return Response.json({ keyEpoch: 2, packageVersion: 2,
      publicKey: current.publicKey.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') });
    if (path.endsWith('/decision')) {
      const body = JSON.parse(String(init?.body)); decisions.push(body);
      return Response.json({ eventId: 'event', state: body.decision === 'confirm' ? 'prepared' : 'cancelled' });
    }
    return new Response('', { status: 404 });
  });
  const loadPrivateKey = vi.fn(async (epoch: number) => {
    if (epoch !== 1) return undefined;
    const copy = old.privateKey.slice(); keyCopies.push(copy); return copy;
  });
  const reviewer = createInboundDraftReviewer({ accountId: 'account', baseUrl: 'https://sync.test', getToken: async () => 'jwt',
    loadPrivateKey, assertActive: () => { if (!active) throw new Error('session changed'); }, fetchImpl: fetch });
  return { reviewer, old, current, context, snapshot, decisions, keyCopies, loadPrivateKey, fetch,
    invalidate: () => { active = false; }, dispose: () => { old.privateKey.fill(0); current.privateKey.fill(0); } };
}
describe('encrypted draft review authority', () => {
  it('keeps invalid dates editable, then freezes corrected date-only values and seals to the current key', async () => {
    const f = await fixture();
    try {
      const review = await f.reviewer.open('event');
      expect(review.tasks[0]).toMatchObject({ dueDate: '2026-02-30', projectId: 'project' });
      expect(f.keyCopies[0]?.every((v) => v === 0)).toBe(true);
      await expect(review.confirm(review.tasks)).rejects.toThrow();
      expect(f.decisions).toHaveLength(0);
      await review.confirm(review.tasks.map((t) => ({ ...t, title: 'Corrected', dueDate: '2026-10-08' })));
      expect(f.decisions).toHaveLength(1);
      const decision = f.decisions[0]!;
      expect(decision).toMatchObject({ decision: 'confirm', expectedAttempt: 2, expectedRuleVersion: 1, expectedDigest: f.snapshot.resultDigest });
      expect(JSON.stringify(decision)).not.toContain('Corrected');
      const envelope = JSON.parse(String(decision.resultCiphertext)); expect(envelope.keyEpoch).toBe(2);
      const bytes = await openInbound(envelope, f.current.privateKey, { ...f.context, keyEpoch: 2 });
      const payload = heytaTaskBatchPayloadSchema.parse(JSON.parse(new TextDecoder().decode(bytes))); bytes.fill(0);
      expect(payload.tasks[0]).toMatchObject({ id: 'inbound:event:0', title: 'Corrected', projectId: 'project',
        dueDateLocal: '2026-10-08', dueDate: Date.UTC(2026, 9, 7, 16) });
      expect(payload.source.digest).toBe(inboundTaskDigest(payload.tasks));
      expect(payload.source.digest).toBe(decision.resultDigest);
    } finally { f.dispose(); }
  });
  it.each(['id', 'projectId'])('cannot edit the authority field %s', async (field) => {
    const f = await fixture();
    try {
      const review = await f.reviewer.open('event');
      await expect(review.confirm(review.tasks.map((t) => ({ ...t, dueDate: '2026-10-08', [field]: 'injected' })))).rejects.toThrow('scope changed');
      expect(f.decisions).toHaveLength(0);
    } finally { f.dispose(); }
  });
  it('recomputes content digest instead of trusting matching metadata and source digests', async () => {
    const f = await fixture();
    try {
      f.snapshot.resultDigest = 'a'.repeat(64);
      await expect(f.reviewer.open('event')).rejects.toThrow('frozen receipt');
      expect(f.decisions).toHaveLength(0);
      expect(f.keyCopies[0]?.every((v) => v === 0)).toBe(true);
    } finally { f.dispose(); }
  });
  it('allows cancellation without acquiring a private key', async () => {
    const f = await fixture();
    try {
      await f.reviewer.cancel('event');
      expect(f.loadPrivateKey).not.toHaveBeenCalled();
      expect(f.decisions).toEqual([{ expectedAttempt: 2, expectedRuleVersion: 1, expectedDigest: f.snapshot.resultDigest, decision: 'cancel' }]);
    } finally { f.dispose(); }
  });
  it('invalidates an open review without making a subsequent network request', async () => {
    const f = await fixture();
    try {
      const review = await f.reviewer.open('event'); const calls = f.fetch.mock.calls.length;
      f.invalidate();
      await expect(review.confirm(review.tasks.map((t) => ({ ...t, dueDate: '2026-10-08' })))).rejects.toThrow('session changed');
      await expect(review.cancel()).rejects.toThrow('session changed');
      expect(f.fetch).toHaveBeenCalledTimes(calls);
    } finally { f.dispose(); }
  });
});
