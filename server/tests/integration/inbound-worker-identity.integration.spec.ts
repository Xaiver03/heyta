/** Real HTTP + PostgreSQL, including the public worker registration route. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { signCommitProof } from '../../src/automation/commit-proof';
import { generateWorkerCredential } from '../../src/automation/worker-identity';
import { signAutomationEntitlementTicket } from '../../src/automation/entitlement-ticket';
import { automationActivationCodeHash, inspectAutomationRevocationManifest, signAutomationRevocationManifest } from '../../src/automation/entitlement-issuer';
import { generateInboundKeyPair, openInbound, sealInbound, signWebhook } from '@heyta/inbound-core';

// auth reads its signing configuration during import, including imports reached
// through worker entitlement checks. Set the fixture before loading modules.
const originalJwtSecret = vi.hoisted(() => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'inbound-identity-test-secret-at-least-32';
  return previous;
});

const DATABASE_URL = process.env.DATABASE_URL;
describe.skipIf(!DATABASE_URL)('inbound identity through ordinary sync HTTP', () => {
  const db = new PrismaClient();
  const app = Fastify();
  const workerA = generateWorkerCredential();
  const workerB = generateWorkerCredential();
  const epoch = randomUUID();
  const clientA = `a-${randomUUID()}`;
  const clientB = `b-${randomUUID()}`;
  const eventId = randomUUID();
  const ruleId = randomUUID();
  const webhookEventId = `webhook-${randomUUID()}`;
  const webhookRuleId = randomUUID();
  const recipient = generateInboundKeyPair();
  const oldSecret = originalJwtSecret;
  const oldCommitKeys = process.env.AUTOMATION_COMMIT_KEYS;
  const oldWebhookKeys = process.env.AUTOMATION_WEBHOOK_KEYS;
  const oldMode = process.env.AUTOMATION_ENTITLEMENT_MODE;
  const signing = { instanceId: '6ff03f66-5bdb-48ab-a8e7-3606f38b7bf3', activeKeyId: 'test', keys: { test: '11'.repeat(32) } };
  let userId: number;
  let otherId: number;
  let base: string;
  let token: string;
  let otherToken: string;
  const op = {
    id: `inbound:${eventId}`, clientId: clientA, entityType: 'TASK', opType: 'BATCH',
    actionType: 'BATCH', entityId: `inbound:${eventId}:0`, entityIds: [`inbound:${eventId}:1`],
    payload: Buffer.alloc(44, 7).toString('base64'), isPayloadEncrypted: true,
    vectorClock: { [clientA]: 1 }, timestamp: Date.now(), schemaVersion: 1,
  };
  const upload = async (workerToken: string | undefined, overrides: {
    requestId?: string; epoch?: string; token?: string; op?: Record<string, unknown>; path?: string; proofs?: Record<string, string>;
  } = {}) => fetch(`${base}/api/sync/${overrides.path ?? 'ops'}`, {
    method: 'POST', headers: { authorization: overrides.token ?? token, 'content-type': 'application/json',
      ...(workerToken ? { 'x-heyta-worker-token': workerToken } : {}),
      'x-heyta-database-epoch': overrides.epoch ?? epoch },
    body: JSON.stringify({ clientId: clientA, requestId: overrides.requestId ?? 'inbound-identity-retry', ops: [overrides.op ?? op], inboundCommitProofs: overrides.proofs }),
  });
  beforeAll(async () => {
    process.env.JWT_SECRET = 'inbound-identity-test-secret-at-least-32';
    process.env.AUTOMATION_COMMIT_KEYS = JSON.stringify(signing);
    process.env.AUTOMATION_WEBHOOK_KEYS = JSON.stringify({ keys: { 'inbound-v1': '22'.repeat(32) } });
    // 这一套建模的是**官方托管**部署：权益来源是上面那条 grants ['ai','automation'] 订阅行。
    // 自托管在线核验（一次性 action 票据 + 短期绑定）在下面的 selfhost 段单独取证。
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
    const { initSyncService } = await import('../../src/sync/sync.service');
    const { syncRoutes } = await import('../../src/sync/sync.routes');
    const { apiRoutes } = await import('../../src/api');
    const { inboundAutomationRoutes } = await import('../../src/automation/inbound.routes');
    initSyncService();
    const user = await db.user.create({ data: { email: `inbound-${randomUUID()}@test.local`, isVerified: 1 } });
    const other = await db.user.create({ data: { email: `inbound-${randomUUID()}@test.local`, isVerified: 1 } });
    userId = user.id; otherId = other.id;
    await db.subscription.create({ data: { userId, status: 'active', grants: ['ai', 'automation'], currentPeriodEnd: BigInt(Date.now() + 86400000) } });
    await db.automationEvent.create({ data: { userId, ruleId, eventId, ruleVersion: 1, dedupeDigest: 'a'.repeat(64),
      status: 'prepared', payloadCiphertext: 'sealed-input', resultCiphertext: 'sealed-result', parseVersion: 1, resultDigest: 'a'.repeat(64), resultItemCount: 2, expiresAt: new Date(Date.now() + 86400000) } });
    const sign = (id: number, email: string) => `Bearer ${jwt.sign({ userId: id, email, tokenVersion: 0 }, process.env.JWT_SECRET!)}`;
    token = sign(user.id, user.email); otherToken = sign(other.id, other.email);
    for (const [worker, client] of [[workerA, clientA], [workerB, clientB]] as const) {
      await db.automationWorker.create({ data: { id: worker.workerId, userId,
        credentialHash: worker.credentialHash, syncClientId: client, databaseEpoch: epoch } });
    }
    await db.automationCommitPermit.create({ data: { eventId, userId, workerId: workerA.workerId,
      opId: op.id, ruleId, ruleVersion: 1, parseVersion: 1, resultDigest: 'a'.repeat(64), itemCount: 2 } });
    await db.automationRule.create({ data: { id: webhookRuleId, userId, enabled: true, keyId: 'inbound-v1' } });
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.register(inboundAutomationRoutes, { prefix: '/api', serverOrigin: 'http://127.0.0.1' });
    await app.register(syncRoutes, { prefix: '/api/sync' });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  }, 30000);
  afterAll(async () => {
    await app.close();
    if (userId) await db.user.delete({ where: { id: userId } });
    if (otherId) await db.user.delete({ where: { id: otherId } });
    await db.$disconnect();
    const { disconnectDb } = await import('../../src/db'); await disconnectDb();
    if (oldCommitKeys === undefined) delete process.env.AUTOMATION_COMMIT_KEYS; else process.env.AUTOMATION_COMMIT_KEYS = oldCommitKeys;
    if (oldWebhookKeys === undefined) delete process.env.AUTOMATION_WEBHOOK_KEYS; else process.env.AUTOMATION_WEBHOOK_KEYS = oldWebhookKeys;
    if (oldMode === undefined) delete process.env.AUTOMATION_ENTITLEMENT_MODE; else process.env.AUTOMATION_ENTITLEMENT_MODE = oldMode;
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
  });
  it('rejects missing credentials without writing', async () => {
    expect((await upload(undefined)).status).toBe(403);
    expect(await db.operation.count({ where: { id: op.id } })).toBe(0);
  });
  it('registers a worker through authenticated HTTP and stores only a hash', async () => {
    const response = await fetch(`${base}/api/automation/worker/register`, {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: `register-${randomUUID()}`, databaseEpoch: epoch }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { workerId: string; workerToken: string; databaseEpoch: string };
    expect(body.workerToken).toMatch(/^[0-9a-f]{64}$/);
    expect(body.databaseEpoch).toBe(epoch);
    const row = await db.automationWorker.findUniqueOrThrow({ where: { id: body.workerId } });
    expect(row.credentialHash).toHaveLength(64);
    expect(row.credentialHash).not.toBe(body.workerToken);
  });
  it('discovers frozen results only for the durable owner and never returns confirmation drafts', async () => {
    const recover = (workerToken: string, clientId: string, event?: string) => fetch(`${base}/api/automation/events/${event ? `${event}/result` : 'recover'}?clientId=${clientId}`, {
      headers: { authorization: token, 'x-heyta-worker-token': workerToken, 'x-heyta-database-epoch': epoch },
    });
    const owned = await recover(workerA.token, clientA);
    expect(owned.status).toBe(200);
    expect(await owned.json()).toMatchObject({ eventId, resultCiphertext: 'sealed-result', state: 'prepared' });
    expect(await (await recover(workerB.token, clientB)).json()).toEqual({ state: 'empty' });
    expect((await recover(workerB.token, clientB, eventId)).status).toBe(404);

    const unowned = randomUUID();
    const recoveryRule = randomUUID();
    await db.automationRule.create({ data: { id: recoveryRule, userId, enabled: true, keyId: 'inbound-v1' } });
    await db.automationEvent.create({ data: { userId, ruleId: recoveryRule, eventId: unowned, ruleVersion: 1,
      dedupeDigest: 'd'.repeat(64), status: 'prepared', parseVersion: 1, resultDigest: 'd'.repeat(64),
      resultItemCount: 1, resultCiphertext: 'sealed-prepared', expiresAt: new Date(Date.now() + 86400000) } });
    expect(await (await recover(workerB.token, clientB)).json()).toMatchObject({ eventId: unowned });
    await db.automationRule.update({ where: { id: recoveryRule }, data: { enabled: false } });
    expect(await (await recover(workerB.token, clientB)).json()).toEqual({ state: 'empty' });
    await db.automationRule.update({ where: { id: recoveryRule }, data: { enabled: true } });
    await db.automationEvent.updateMany({ where: { userId, eventId: unowned }, data: { status: 'needs-confirmation' } });
    expect(await (await recover(workerB.token, clientB)).json()).toEqual({ state: 'empty' });
    expect((await recover(workerB.token, clientB, unowned)).status).toBe(404);
    await db.automationEvent.updateMany({ where: { userId, eventId: unowned }, data: { status: 'prepared', expiresAt: new Date(1) } });
    expect(await (await recover(workerB.token, clientB)).json()).toEqual({ state: 'empty' });
    await db.automationEvent.deleteMany({ where: { userId, ruleId: recoveryRule } });
  });

  it('reads encrypted drafts and serializes confirm/cancel decisions through real HTTP and PostgreSQL', async () => {
    const draftRule = randomUUID();
    const draftEvent = randomUUID();
    const expiredEvent = randomUUID();
    await db.automationRule.create({ data: { id: draftRule, userId, enabled: true, keyId: 'inbound-v1', parseVersion: 1, maxItems: 2 } });
    await db.automationRecipientKey.upsert({ where: { userId }, create: { userId, keyEpoch: 1,
      publicKey: Buffer.from(recipient.publicKey, 'base64').toString('base64url'), packageVersion: 1 }, update: {
      keyEpoch: 1, publicKey: Buffer.from(recipient.publicKey, 'base64').toString('base64url'), packageVersion: 1,
    } });
    const context = { accountId: `user-${userId}`, serverOrigin: 'http://127.0.0.1', ruleId: draftRule,
      eventId: draftEvent, purpose: 'result' as const, keyEpoch: 1 };
    const resultCiphertext = JSON.stringify(await sealInbound(new TextEncoder().encode('encrypted draft content'), recipient.publicKey, context));
    const draft = { userId, ruleId: draftRule, ruleVersion: 1, status: 'needs-confirmation', reasonCode: 'needs-confirmation',
      attempt: 2, parseVersion: 1, resultDigest: 'a'.repeat(64), resultItemCount: 1, resultCiphertext,
      dedupeDigest: 'c'.repeat(64), expiresAt: new Date(Date.now() + 86400000) };
    const decision = { expectedAttempt: 2, expectedRuleVersion: 1, expectedDigest: draft.resultDigest };
    const decide = (event: string, body: unknown) => fetch(`${base}/api/automation/events/${event}/draft/decision`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    try {
      await db.automationEvent.create({ data: { ...draft, eventId: draftEvent } });
      await db.automationEvent.create({ data: { ...draft, eventId: expiredEvent, expiresAt: new Date(1) } });
      const read = await fetch(`${base}/api/automation/events/${draftEvent}/draft`, { headers: { authorization: token } });
      expect(read.status).toBe(200);
      expect(read.headers.get('cache-control')).toBe('no-store');
      const snapshot = await read.json() as any;
      expect(snapshot).toMatchObject({ eventId: draftEvent, resultCiphertext, attempt: 2 });
      expect(JSON.stringify(snapshot)).not.toContain('encrypted draft content');
      expect(new TextDecoder().decode(await openInbound(JSON.parse(snapshot.resultCiphertext), recipient.privateKey, context))).toBe('encrypted draft content');
      expect((await fetch(`${base}/api/automation/events/${draftEvent}/draft`, { headers: { authorization: otherToken } })).status).toBe(404);
      expect((await fetch(`${base}/api/automation/events/${expiredEvent}/draft`, { headers: { authorization: token } })).status).toBe(404);
      expect((await decide(draftEvent, { ...decision, decision: 'unknown' })).status).toBe(400);
      expect((await decide(draftEvent, { ...decision, decision: 'confirm', resultCiphertext: '{}', resultDigest: 'b'.repeat(64), resultItemCount: 1 })).status).toBe(400);
      expect((await decide(draftEvent, { ...decision, expectedAttempt: 1, decision: 'cancel' })).status).toBe(409);
      expect((await decide(expiredEvent, { ...decision, decision: 'cancel' })).status).toBe(409);
      const editedCiphertext = JSON.stringify(await sealInbound(new TextEncoder().encode('edited encrypted draft'), recipient.publicKey, context));
      const confirm = { ...decision, decision: 'confirm', resultDigest: 'b'.repeat(64), resultItemCount: 1, resultCiphertext: editedCiphertext };
      const results = await Promise.all([decide(draftEvent, confirm), decide(draftEvent, { ...decision, decision: 'cancel' })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const current = await db.automationEvent.findFirstOrThrow({ where: { userId, eventId: draftEvent } });
      expect(await db.automationCommitPermit.count({ where: { userId, eventId: draftEvent } })).toBe(0);
      expect(await db.operation.count({ where: { id: `inbound:${draftEvent}` } })).toBe(0);
      if (current.status === 'prepared') {
        expect(current.resultDigest).toBe(confirm.resultDigest);
        expect(new TextDecoder().decode(await openInbound(JSON.parse(current.resultCiphertext!), recipient.privateKey, context))).toBe('edited encrypted draft');
      } else {
        expect(current).toMatchObject({ status: 'cancelled', payloadCiphertext: null, resultCiphertext: null });
      }
    } finally {
      await db.automationEvent.deleteMany({ where: { userId, ruleId: draftRule } });
      await db.automationRule.delete({ where: { id: draftRule } });
    }
  });

  it('rechecks draft confirmation entitlement after an observed account lock wait while keeping cancellation usable', async () => {
    const draftRule = randomUUID();
    const draftEvent = randomUUID();
    const subscriptions = await db.subscription.findMany({ where: { userId } });
    const ciphertext = JSON.stringify(await sealInbound(new Uint8Array([1]), recipient.publicKey, {
      accountId: `user-${userId}`, serverOrigin: 'http://127.0.0.1', ruleId: draftRule, eventId: draftEvent, purpose: 'result', keyEpoch: 1,
    }));
    await db.automationRule.create({ data: { id: draftRule, userId, enabled: true, keyId: 'inbound-v1', parseVersion: 1 } });
    await db.automationEvent.create({ data: { userId, ruleId: draftRule, eventId: draftEvent, ruleVersion: 1,
      status: 'needs-confirmation', reasonCode: 'needs-confirmation', attempt: 1, parseVersion: 1, resultDigest: 'a'.repeat(64),
      resultItemCount: 1, resultCiphertext: ciphertext, dedupeDigest: 'a'.repeat(64), expiresAt: new Date(Date.now() + 86400000) } });
    const revision = { expectedAttempt: 1, expectedRuleVersion: 1, expectedDigest: 'a'.repeat(64) };
    const post = (body: unknown) => fetch(`${base}/api/automation/events/${draftEvent}/draft/decision`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    let unlock!: () => void;
    let ready!: () => void;
    const barrier = new Promise<void>((resolve) => { unlock = resolve; });
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      ready(); await barrier;
    }, { timeout: 15000 });
    await locked;
    let pending: Promise<Response> | undefined;
    try {
      try {
        pending = post({ ...revision, decision: 'confirm', resultDigest: 'b'.repeat(64), resultItemCount: 1, resultCiphertext: ciphertext });
        let waiting = false;
        for (let i = 0; i < 500; i++) {
          const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query ILIKE '%SELECT token_version%' AND pid <> pg_backend_pid()`;
          if (Number(rows[0].count) > 0) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await db.subscription.updateMany({ where: { userId }, data: { currentPeriodEnd: 1n } });
      } finally { unlock(); await holder; }
      expect((await pending!).status).toBe(409);
      expect(await db.automationEvent.findFirstOrThrow({ where: { userId, eventId: draftEvent } })).toMatchObject({ status: 'needs-confirmation' });
      expect((await post({ ...revision, decision: 'cancel' })).status).toBe(200);
      expect(await db.automationEvent.findFirstOrThrow({ where: { userId, eventId: draftEvent } })).toMatchObject({ status: 'cancelled', resultCiphertext: null });
    } finally {
      await pending?.catch(() => undefined);
      for (const subscription of subscriptions) await db.subscription.update({ where: { id: subscription.id }, data: { currentPeriodEnd: subscription.currentPeriodEnd } });
      await db.automationEvent.deleteMany({ where: { userId, ruleId: draftRule } });
      await db.automationRule.delete({ where: { id: draftRule } });
    }
  }, 20000);

  it('cannot resurrect ciphertext cleared by a sweep while draft confirmation waits on the event row', async () => {
    const draftRule = randomUUID();
    const draftEvent = randomUUID();
    const resultCiphertext = JSON.stringify(await sealInbound(new Uint8Array([1]), recipient.publicKey, {
      accountId: `user-${userId}`, serverOrigin: 'http://127.0.0.1', ruleId: draftRule, eventId: draftEvent, purpose: 'result', keyEpoch: 1,
    }));
    await db.automationRule.create({ data: { id: draftRule, userId, enabled: true, keyId: 'inbound-v1', parseVersion: 1 } });
    await db.automationEvent.create({ data: { userId, ruleId: draftRule, eventId: draftEvent, ruleVersion: 1,
      status: 'needs-confirmation', reasonCode: 'needs-confirmation', attempt: 1, parseVersion: 1, resultDigest: 'a'.repeat(64),
      resultItemCount: 1, resultCiphertext, dedupeDigest: 'a'.repeat(64), expiresAt: new Date(Date.now() + 86400000) } });
    let unlock!: () => void;
    let ready!: () => void;
    const barrier = new Promise<void>((resolve) => { unlock = resolve; });
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT event_id FROM automation_events WHERE user_id = ${userId} AND event_id = ${draftEvent} FOR UPDATE`;
      ready(); await barrier;
      await tx.automationEvent.updateMany({ where: { userId, eventId: draftEvent }, data: {
        status: 'expired', reasonCode: 'retention-expired', expiresAt: new Date(1), payloadCiphertext: null, resultCiphertext: null,
      } });
    }, { timeout: 15000 });
    await locked;
    let pending: Promise<Response> | undefined;
    try {
      try {
        pending = fetch(`${base}/api/automation/events/${draftEvent}/draft/decision`, {
          method: 'POST', headers: { authorization: token, 'content-type': 'application/json' }, body: JSON.stringify({
            decision: 'confirm', expectedAttempt: 1, expectedRuleVersion: 1, expectedDigest: 'a'.repeat(64),
            resultDigest: 'b'.repeat(64), resultItemCount: 1, resultCiphertext,
          }),
        });
        let waiting = false;
        for (let i = 0; i < 500; i++) {
          const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query ILIKE '%UPDATE%automation_events%' AND pid <> pg_backend_pid()`;
          if (Number(rows[0].count) > 0) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
      } finally { unlock(); await holder; }
      expect((await pending!).status).toBe(409);
      expect(await db.automationEvent.findFirstOrThrow({ where: { userId, eventId: draftEvent } }))
        .toMatchObject({ status: 'expired', resultCiphertext: null, payloadCiphertext: null });
      expect(await db.automationCommitPermit.count({ where: { userId, eventId: draftEvent } })).toBe(0);
    } finally {
      await pending?.catch(() => undefined);
      await db.automationEvent.deleteMany({ where: { userId, ruleId: draftRule } });
      await db.automationRule.delete({ where: { id: draftRule } });
    }
  }, 20000);

  it('issues one durable permit and an owner-held proof, with exact retry only', async () => {
    const client = `permit-${randomUUID()}`;
    const registration = await fetch(`${base}/api/automation/worker/register`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: client, databaseEpoch: epoch }),
    });
    const worker = await registration.json() as { workerToken: string };
    const event = randomUUID();
    const body = { clientId: client, databaseEpoch: epoch, eventId: event, opId: `inbound:${event}`,
      ruleId: randomUUID(), ruleVersion: 1, parseVersion: 1, resultDigest: 'd'.repeat(64), itemCount: 2 };
    await db.automationRule.create({ data: { id: body.ruleId, userId, enabled: true, keyId: 'inbound-v1' } });
    await db.automationEvent.create({ data: { userId, ruleId: body.ruleId, eventId: event, ruleVersion: 1,
      dedupeDigest: 'd'.repeat(64), status: 'prepared', parseVersion: 1, resultDigest: body.resultDigest,
      resultItemCount: 2, resultCiphertext: 'sealed-result', expiresAt: new Date(Date.now() + 86400000) } });
    const permit = await fetch(`${base}/api/automation/commit-permit`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json',
        'x-heyta-worker-token': worker.workerToken, 'x-heyta-database-epoch': epoch }, body: JSON.stringify(body),
    });
    expect(permit.status).toBe(201);
    const issued = await permit.json() as { proof: string };
    expect(issued.proof).toContain('.');
    expect(await db.automationCommitPermit.count({ where: { eventId: event } })).toBe(1);
    const retry = await fetch(`${base}/api/automation/commit-permit`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json',
        'x-heyta-worker-token': worker.workerToken, 'x-heyta-database-epoch': epoch }, body: JSON.stringify(body),
    });
    expect(retry.status).toBe(201);
    const conflict = await fetch(`${base}/api/automation/commit-permit`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json',
        'x-heyta-worker-token': worker.workerToken, 'x-heyta-database-epoch': epoch },
      body: JSON.stringify({ ...body, resultDigest: 'e'.repeat(64) }),
    });
    expect(conflict.status).toBe(403);
  });
  it('rechecks entitlement after waiting for the account lock while preserving exact owner retries', async () => {
    const freshEvent = randomUUID(); const freshRule = randomUUID();
    await db.automationRule.create({ data: { id: freshRule, userId, enabled: true, keyId: 'inbound-v1' } });
    await db.automationEvent.create({ data: { userId, ruleId: freshRule, eventId: freshEvent, ruleVersion: 1,
      dedupeDigest: 'd'.repeat(64), status: 'prepared', resultCiphertext: 'sealed', resultDigest: 'd'.repeat(64),
      resultItemCount: 1, parseVersion: 1, expiresAt: new Date(Date.now() + 86400000) } });
    const subscriptions = await db.subscription.findMany({ where: { userId } });
    const post = (body: object) => fetch(`${base}/api/automation/commit-permit`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json',
        'x-heyta-worker-token': workerA.token, 'x-heyta-database-epoch': epoch }, body: JSON.stringify(body),
    });
    const fresh = { clientId: clientA, databaseEpoch: epoch, eventId: freshEvent, opId: `inbound:${freshEvent}`,
      ruleId: freshRule, ruleVersion: 1, parseVersion: 1, resultDigest: 'd'.repeat(64), itemCount: 1 };
    let unlock!: () => void; let ready!: () => void;
    const barrier = new Promise<void>((resolve) => { unlock = resolve; });
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      ready(); await barrier;
    }, { timeout: 15000 });
    await locked;
    let pending: Promise<Response> | undefined;
    try {
      try {
        pending = post(fresh);
        let waiting = false;
        for (let i = 0; i < 500; i++) {
          const rows = await db.$queryRaw<Array<{ count: bigint }>>`
            SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
              AND wait_event_type = 'Lock' AND query ILIKE '%SELECT id FROM users%'
              AND pid <> pg_backend_pid()
          `;
          if (Number(rows[0].count) > 0) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await db.subscription.updateMany({ where: { userId }, data: { currentPeriodEnd: 1n } });
      } finally { unlock(); await holder; }
      expect((await pending!).status).toBe(403);
      expect(await db.automationCommitPermit.count({ where: { userId, eventId: freshEvent } })).toBe(0);
      const original = { clientId: clientA, databaseEpoch: epoch, eventId, opId: op.id,
        ruleId, ruleVersion: 1, parseVersion: 1, resultDigest: 'a'.repeat(64), itemCount: 2 };
      expect((await post(original)).status).toBe(201);
      expect((await post({ ...original, itemCount: 1 })).status).toBe(403);
    } finally {
      await pending?.catch(() => undefined);
      for (const subscription of subscriptions) await db.subscription.update({ where: { id: subscription.id },
        data: { currentPeriodEnd: subscription.currentPeriodEnd } });
      await db.automationEvent.deleteMany({ where: { userId, eventId: freshEvent } });
    }
  }, 20000);

  // 🔴 故障窗口 11 的前半：权益撤销与首次许可授予是两条并发事务，先后顺序必须唯一裁决。
  // 这一条测的是**锁的载体**：请求在等账号锁之后读订阅时必须 `FOR SHARE`，
  // 于是"读订阅时被占住的这一行"会把撤销的提交排在自己前面；
  // 换成普通 SELECT 就不会等 —— 下面那条 `waiting` 断言因此会红。
  it('serializes a revocation that commits during the permit read, through the subscription row lock', async () => {
    const lockRule = randomUUID();
    const lockEvent = randomUUID();
    await db.automationRule.create({ data: { id: lockRule, userId, enabled: true, keyId: 'inbound-v1' } });
    await db.automationEvent.create({ data: { userId, ruleId: lockRule, eventId: lockEvent, ruleVersion: 1,
      dedupeDigest: 'a'.repeat(64), status: 'prepared', resultCiphertext: 'sealed', resultDigest: 'a'.repeat(64),
      resultItemCount: 1, parseVersion: 1, expiresAt: new Date(Date.now() + 86400000) } });
    const subscriptions = await db.subscription.findMany({ where: { userId } });
    const post = () => fetch(`${base}/api/automation/commit-permit`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json',
        'x-heyta-worker-token': workerA.token, 'x-heyta-database-epoch': epoch },
      body: JSON.stringify({ clientId: clientA, databaseEpoch: epoch, eventId: lockEvent, opId: `inbound:${lockEvent}`,
        ruleId: lockRule, ruleVersion: 1, parseVersion: 1, resultDigest: 'a'.repeat(64), itemCount: 1 }),
    });
    let unlock!: () => void;
    let ready!: () => void;
    const barrier = new Promise<void>((resolve) => { unlock = resolve; });
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    // 占住订阅行而**不碰账号行**：撤销在同一次事务里写下去，提交排在放行之后。
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE user_id = ${userId} FOR UPDATE`;
      ready();
      await barrier;
      await tx.subscription.updateMany({ where: { userId }, data: { currentPeriodEnd: 1n } });
    }, { timeout: 15000 });
    await locked;
    let pending: Promise<Response> | undefined;
    try {
      pending = post();
      let waiting = false;
      for (let i = 0; i < 500; i++) {
        const rows = await db.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND query ILIKE '%FROM subscriptions%' AND pid <> pg_backend_pid()
        `;
        if (Number(rows[0]?.count ?? 0) > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      unlock();
      await holder;
      expect((await pending!).status).toBe(403);
      expect(await db.automationCommitPermit.count({ where: { userId, eventId: lockEvent } })).toBe(0);
    } finally {
      unlock();
      await holder.catch(() => undefined);
      await pending?.catch(() => undefined);
      for (const subscription of subscriptions) {
        await db.subscription.update({ where: { id: subscription.id }, data: { currentPeriodEnd: subscription.currentPeriodEnd } });
      }
      await db.automationEvent.deleteMany({ where: { userId, ruleId: lockRule } });
      await db.automationCommitPermit.deleteMany({ where: { userId, eventId: lockEvent } });
    }
  }, 30000);

  it('accepts a signed webhook into an encrypted event and exposes only opaque status', async () => {
    await db.automationRecipientKey.upsert({ where: { userId }, create: { userId, keyEpoch: 1,
      publicKey: Buffer.from(recipient.publicKey, 'base64').toString('base64url'), packageVersion: 3 }, update: {
      keyEpoch: 1, publicKey: Buffer.from(recipient.publicKey, 'base64').toString('base64url'), packageVersion: 3,
    } });
    const body = Buffer.from('{"title":"postgres-secret"}', 'utf8');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const path = `/api/automation/v1/hooks/${webhookRuleId}`;
    const secret = Buffer.from('22'.repeat(32), 'hex');
    const signature = signWebhook(secret, { method: 'POST', path, ruleId: webhookRuleId, keyId: 'inbound-v1', timestamp,
      eventId: webhookEventId, contentType: 'application/json', body });
    const response = await fetch(`${base}${path}`, { method: 'POST', body, headers: {
      'content-type': 'application/json', 'x-heyta-key-id': 'inbound-v1', 'x-heyta-timestamp': timestamp,
      'x-heyta-event-id': webhookEventId, 'x-heyta-signature': signature,
    } });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ eventId: webhookEventId, state: 'queued' });
    const stored = await db.automationEvent.findFirstOrThrow({ where: { eventId: webhookEventId, userId, ruleId: webhookRuleId } });
    expect(stored.payloadCiphertext).not.toContain('postgres-secret');
    const opened = await openInbound(JSON.parse(stored.payloadCiphertext), recipient.privateKey, {
      accountId: `user-${userId}`, serverOrigin: 'http://127.0.0.1', ruleId: webhookRuleId,
      eventId: webhookEventId, purpose: 'input', keyEpoch: 1,
    });
    expect(Buffer.from(opened).equals(body)).toBe(true);
    const different = Buffer.from('{"title":"different"}', 'utf8');
    const conflictTimestamp = String(Math.floor(Date.now() / 1000));
    const conflictSignature = signWebhook(secret, { method: 'POST', path, ruleId: webhookRuleId, keyId: 'inbound-v1', timestamp: conflictTimestamp,
      eventId: webhookEventId, contentType: 'application/json', body: different });
    expect((await fetch(`${base}${path}`, { method: 'POST', body: different, headers: {
      'content-type': 'application/json', 'x-heyta-key-id': 'inbound-v1', 'x-heyta-timestamp': conflictTimestamp,
      'x-heyta-event-id': webhookEventId, 'x-heyta-signature': conflictSignature,
    } })).status).toBe(409);
    const claim = await fetch(`${base}/api/automation/events/claim`, { method: 'POST', headers: {
      authorization: token, 'content-type': 'application/json', 'x-heyta-worker-token': workerA.token,
      'x-heyta-database-epoch': epoch,
    }, body: JSON.stringify({ clientId: clientA, eventId: webhookEventId }) });
    expect(claim.status).toBe(200);
    const claimed = await claim.json() as { eventId: string; leaseGeneration: number; payloadCiphertext: string; receivedAt: number };
    expect(claimed.eventId).toBe(webhookEventId);
    expect(claimed.receivedAt).toBe(stored.createdAt.getTime());
    const renewed = await fetch(`${base}/api/automation/events/${webhookEventId}/renew`, { method: 'POST', headers: {
      authorization: token, 'content-type': 'application/json', 'x-heyta-worker-token': workerA.token,
      'x-heyta-database-epoch': epoch,
    }, body: JSON.stringify({ clientId: clientA, leaseGeneration: claimed.leaseGeneration }) });
    expect(renewed.status).toBe(200);
    const invalidPublish = (overrides: object) => fetch(`${base}/api/automation/events/${webhookEventId}/result`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json',
        'x-heyta-worker-token': workerA.token, 'x-heyta-database-epoch': epoch },
      body: JSON.stringify({ clientId: clientA, leaseGeneration: claimed.leaseGeneration, parseVersion: 1,
        itemCount: 1, resultDigest: 'c'.repeat(64), resultCiphertext: claimed.payloadCiphertext, ...overrides }),
    });
    expect((await invalidPublish({ itemCount: undefined })).status).toBe(400);
    expect((await invalidPublish({ parseVersion: 2 })).status).toBe(409);
    expect(await db.automationEvent.findFirstOrThrow({ where: { userId, eventId: webhookEventId } }))
      .toMatchObject({ status: 'leased', resultCiphertext: null });
    const result = await fetch(`${base}/api/automation/events/${webhookEventId}/result`, { method: 'POST', headers: {
      authorization: token, 'content-type': 'application/json', 'x-heyta-worker-token': workerA.token,
      'x-heyta-database-epoch': epoch,
    }, body: JSON.stringify({ clientId: clientA, leaseGeneration: claimed.leaseGeneration, parseVersion: 1, itemCount: 1,
      resultDigest: 'c'.repeat(64), resultCiphertext: claimed.payloadCiphertext }) });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ eventId: webhookEventId, state: 'prepared', parseVersion: 1 });
    const resultRetry = await fetch(`${base}/api/automation/events/${webhookEventId}/result`, { method: 'POST', headers: {
      authorization: token, 'content-type': 'application/json', 'x-heyta-worker-token': workerA.token,
      'x-heyta-database-epoch': epoch,
    }, body: JSON.stringify({ clientId: clientA, leaseGeneration: claimed.leaseGeneration, parseVersion: 1, itemCount: 1,
      resultDigest: 'c'.repeat(64), resultCiphertext: claimed.payloadCiphertext }) });
    expect(resultRetry.status).toBe(200);
  });
  it('enforces retention before cleanup for renewal, publication and first permit', async () => {
    const expiredId = randomUUID();
    const expiredRuleId = randomUUID();
    const expiresAt = new Date(Date.now() - 1_000);
    const leaseExpiresAt = new Date(Date.now() + 60_000);
    const sealed = JSON.stringify({ version: 1, keyEpoch: 1,
      ephemeralPublicKey: Buffer.alloc(32, 1).toString('base64'),
      nonce: Buffer.alloc(12, 2).toString('base64'), ciphertext: Buffer.alloc(24, 3).toString('base64') });
    await db.automationRule.create({ data: { id: expiredRuleId, userId, enabled: true, keyId: 'inbound-v1' } });
    await db.automationEvent.create({ data: { userId, ruleId: expiredRuleId, eventId: expiredId, ruleVersion: 1,
      dedupeDigest: 'e'.repeat(64), status: 'leased', payloadCiphertext: sealed, leaseWorkerId: workerA.workerId,
      leaseGeneration: 1, attempt: 1, leaseExpiresAt, expiresAt } });
    const post = (path: string, body: unknown) => fetch(`${base}/api/automation/${path}`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json',
        'x-heyta-worker-token': workerA.token, 'x-heyta-database-epoch': epoch }, body: JSON.stringify(body),
    });
    const result = { clientId: clientA, leaseGeneration: 1, parseVersion: 1,
      resultDigest: 'e'.repeat(64), resultCiphertext: sealed, itemCount: 1 };
    expect((await post(`events/${expiredId}/renew`, { clientId: clientA, leaseGeneration: 1 })).status).toBe(409);
    expect((await post(`events/${expiredId}/result`, result)).status).toBe(409);
    expect(await db.automationEvent.findFirstOrThrow({ where: { userId, eventId: expiredId } }))
      .toMatchObject({ status: 'leased', leaseExpiresAt, resultCiphertext: null });
    // Even an exact publication retry must not serve or revive an expired draft.
    await db.automationEvent.updateMany({ where: { userId, eventId: expiredId }, data: {
      status: 'prepared', resultCiphertext: sealed, resultDigest: result.resultDigest, parseVersion: 1, resultItemCount: 1,
    } });
    expect((await post(`events/${expiredId}/result`, result)).status).toBe(409);
    expect((await post('commit-permit', { clientId: clientA, databaseEpoch: epoch, eventId: expiredId,
      opId: `inbound:${expiredId}`, ruleId: expiredRuleId, ruleVersion: 1, parseVersion: 1,
      resultDigest: result.resultDigest, itemCount: 1 })).status).toBe(403);
    expect(await db.automationCommitPermit.count({ where: { userId, eventId: expiredId } })).toBe(0);
    await db.automationEvent.deleteMany({ where: { userId, eventId: expiredId } });
  });

  it('fences model reservations and sends by current rule, attempt and retention', async () => {
    const event = randomUUID(); const rule = randomUUID();
    const future = new Date(Date.now() + 86_400_000);
    await db.automationRule.create({ data: { id: rule, userId, enabled: true, keyId: 'inbound-v1', parseVersion: 2 } });
    await db.automationEvent.create({ data: { userId, ruleId: rule, eventId: event, ruleVersion: 1,
      dedupeDigest: 'f'.repeat(64), status: 'leased', payloadCiphertext: 'sealed', leaseWorkerId: workerA.workerId,
      leaseGeneration: 1, attempt: 3, leaseExpiresAt: future, expiresAt: future } });
    const body = { clientId: clientA, ruleId: rule, parseVersion: 2, attempt: 3, leaseGeneration: 1 };
    const post = (action: string, overrides: object = {}) => fetch(`${base}/api/automation/events/${event}/ai-attempt/${action}`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json',
      'x-heyta-worker-token': workerA.token, 'x-heyta-database-epoch': epoch }, body: JSON.stringify({ ...body,
        ...(action === 'reserve' ? { billingSource: 'direct' } : {}), ...overrides }),
    });
    expect((await post('reserve', { attempt: 2 })).status).toBe(409);
    expect((await post('reserve', { parseVersion: 1 })).status).toBe(409);
    await db.automationEvent.updateMany({ where: { userId, eventId: event }, data: { expiresAt: new Date(1) } });
    expect((await post('reserve')).status).toBe(409);
    await db.automationEvent.updateMany({ where: { userId, eventId: event }, data: { expiresAt: future } });
    await db.automationRule.update({ where: { id: rule }, data: { enabled: false } });
    expect((await post('reserve')).status).toBe(409);
    expect(await db.automationAiAttempt.count({ where: { userId, eventId: event } })).toBe(0);
    await db.automationRule.update({ where: { id: rule }, data: { enabled: true } });
    const usedBefore = await db.aiUsageCounter.findMany({ where: { userId } });
    expect(await (await post('reserve')).json()).toMatchObject({ billingSource: 'direct', periodAnchor: null, state: 'reserved' });
    expect(await (await post('reserve')).json()).toMatchObject({ billingSource: 'direct', periodAnchor: null, state: 'reserved' });
    expect(await db.automationAiAttempt.count({ where: { userId, eventId: event } })).toBe(1);
    expect(await db.aiUsageCounter.findMany({ where: { userId } })).toEqual(usedBefore);
    const transition = { from: 'reserved', to: 'sent' };
    await db.automationEvent.updateMany({ where: { userId, eventId: event }, data: { expiresAt: new Date(1) } });
    expect((await post('state', transition)).status).toBe(409);
    await db.automationEvent.updateMany({ where: { userId, eventId: event }, data: { expiresAt: future } });
    await db.automationRule.update({ where: { id: rule }, data: { version: 2 } });
    expect((await post('state', transition)).status).toBe(409);
    await db.automationRule.update({ where: { id: rule }, data: { version: 1 } });
    expect(await (await post('state', transition)).json()).toEqual({ changed: true });
    expect(await (await post('state', transition)).json()).toEqual({ changed: false });
    // Once sent, a late response can settle the ledger without authorizing a new call.
    await db.automationEvent.updateMany({ where: { userId, eventId: event }, data: { expiresAt: new Date(1) } });
    expect(await (await post('state', { from: 'sent', to: 'consumed' })).json()).toEqual({ changed: true });
    await db.automationAiAttempt.deleteMany({ where: { userId, eventId: event } });
    await db.automationEvent.deleteMany({ where: { userId, eventId: event } });
  });

  it.each(['local', 'direct', 'managed'] as const)('reserves concurrent %s retries once and freezes their billing source', async (billingSource) => {
    const event = randomUUID(); const rule = randomUUID();
    const future = new Date(Date.now() + 86_400_000);
    await db.automationRule.create({ data: { id: rule, userId, enabled: true, keyId: 'inbound-v1' } });
    await db.automationEvent.create({ data: { userId, ruleId: rule, eventId: event, ruleVersion: 1,
      dedupeDigest: 'a'.repeat(64), status: 'leased', payloadCiphertext: 'sealed', leaseWorkerId: workerA.workerId,
      leaseGeneration: 1, attempt: 1, leaseExpiresAt: future, expiresAt: future } });
    const request = { clientId: clientA, ruleId: rule, parseVersion: 1, attempt: 1, leaseGeneration: 1 };
    const reserve = (source: string | undefined) => fetch(`${base}/api/automation/events/${event}/ai-attempt/reserve`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json',
        'x-heyta-worker-token': workerA.token, 'x-heyta-database-epoch': epoch },
      body: JSON.stringify({ ...request, billingSource: source }),
    });
    const total = async () => (await db.aiUsageCounter.findMany({ where: { userId } })).reduce((sum, row) => sum + row.requests, 0);
    const usedBefore = await total();
    try {
      expect((await reserve(undefined)).status).toBe(400);
      const responses = await Promise.all(Array.from({ length: 8 }, () => reserve(billingSource)));
      expect(responses.map((response) => response.status)).toEqual(Array(8).fill(200));
      const bodies = await Promise.all(responses.map((response) => response.json()));
      expect(bodies.every((body: any) => body.billingSource === billingSource && body.state === 'reserved')).toBe(true);
      expect(await db.automationAiAttempt.count({ where: { userId, eventId: event } })).toBe(1);
      expect(await total()).toBe(usedBefore + (billingSource === 'managed' ? 1 : 0));
      expect((await reserve(billingSource === 'managed' ? 'local' : 'managed')).status).toBe(409);
      expect(await total()).toBe(usedBefore + (billingSource === 'managed' ? 1 : 0));
      expect(await db.automationAiAttempt.findFirstOrThrow({ where: { userId, eventId: event } })).toMatchObject({
        billingSource, periodAnchor: billingSource === 'managed' ? expect.any(BigInt) : null,
      });
    } finally {
      await db.automationAiAttempt.deleteMany({ where: { userId, eventId: event } });
      await db.automationEvent.deleteMany({ where: { userId, eventId: event } });
      await db.automationRule.delete({ where: { id: rule } });
    }
  });

  it('requires reconciliation instead of buying another attempt after a sent lease expires', async () => {
    const pending = randomUUID();
    const pendingRule = randomUUID();
    await db.automationRule.create({ data: { id: pendingRule, userId, enabled: true, keyId: 'inbound-v1' } });
    await db.automationEvent.create({ data: { userId, ruleId: pendingRule, eventId: pending, ruleVersion: 1,
      dedupeDigest: 'e'.repeat(64), status: 'leased', payloadCiphertext: 'sealed', leaseWorkerId: workerA.workerId,
      leaseGeneration: 1, attempt: 1, leaseExpiresAt: new Date(1), expiresAt: new Date(Date.now() + 86400000) } });
    await db.automationAiAttempt.create({ data: { userId, ruleId: pendingRule, eventId: pending, parseVersion: 1, attempt: 1, periodAnchor: 1n, state: 'sent' } });
    const response = await fetch(`${base}/api/automation/events/claim`, { method: 'POST', headers: {
      authorization: token, 'content-type': 'application/json', 'x-heyta-worker-token': workerB.token,
      'x-heyta-database-epoch': epoch,
    }, body: JSON.stringify({ clientId: clientB, eventId: pending }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'empty' });
    expect(await db.automationEvent.findFirst({ where: { userId, eventId: pending } })).toMatchObject({
      status: 'needs-confirmation', reasonCode: 'model-result-uncertain', attempt: 1, leaseGeneration: 1,
    });
    expect(await db.automationAiAttempt.count({ where: { userId, eventId: pending } })).toBe(1);
    const eventsResponse = await fetch(`${base}/api/automation/events`, { headers: { authorization: token } });
    expect(eventsResponse.status).toBe(200);
    const summary = ((await eventsResponse.json()) as { events: Array<Record<string, unknown>> }).events.find((e) => e.eventId === pending)!;
    expect(Object.keys(summary).sort()).toEqual(['attempt', 'eventId', 'reasonCode', 'receivedAt', 'ruleId', 'ruleVersion', 'status']);
    const foreignEvents = await fetch(`${base}/api/automation/events`, { headers: { authorization: otherToken } });
    expect(await foreignEvents.json()).toEqual({ events: [] });
    const retry = (attempt: number, auth = token) => fetch(`${base}/api/automation/events/${pending}/retry`, {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedAttempt: attempt, expectedRuleVersion: 1 }),
    });
    // Unknown/cross-account identities and stale forms cannot authorize another call.
    expect((await retry(1, otherToken)).status).not.toBe(200);
    expect((await retry(2)).status).toBe(409);
    await db.automationRule.update({ where: { id: pendingRule }, data: { version: 2 } });
    expect((await retry(1)).status).toBe(409);
    await db.automationRule.update({ where: { id: pendingRule }, data: { version: 1 } });
    expect((await retry(1)).status).toBe(200);
    expect((await retry(1)).status).toBe(409);
    const staleRenewal = await fetch(`${base}/api/automation/events/${pending}/renew`, { method: 'POST', headers: {
      authorization: token, 'content-type': 'application/json', 'x-heyta-worker-token': workerA.token,
      'x-heyta-database-epoch': epoch,
    }, body: JSON.stringify({ clientId: clientA, leaseGeneration: 1 }) });
    expect(staleRenewal.status).toBe(409);
    const next = await fetch(`${base}/api/automation/events/claim`, { method: 'POST', headers: {
      authorization: token, 'content-type': 'application/json', 'x-heyta-worker-token': workerB.token,
      'x-heyta-database-epoch': epoch,
    }, body: JSON.stringify({ clientId: clientB, eventId: pending }) });
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ eventId: pending, attempt: 2, leaseGeneration: 3 });
    // Confirmation does not refund or erase the previous possibly charged attempt.
    expect(await db.automationAiAttempt.count({ where: { userId, eventId: pending } })).toBe(1);

  });
  it('keeps rule UUIDs as tombstones and gates enablement through the same API', async () => {
    const created = await fetch(`${base}/api/automation/rules`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ keyId: 'inbound-v1' }),
    });
    expect(created.status).toBe(201);
    const rule = await created.json() as { id: string; enabled: boolean; version: number };
    expect(rule.enabled).toBe(false);
    const enabled = await fetch(`${base}/api/automation/rules/${rule.id}/enabled`, {
      method: 'PUT', headers: { authorization: token, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(200);
    expect((await enabled.json() as any).enabled).toBe(true);
    const deleted = await fetch(`${base}/api/automation/rules/${rule.id}`, { method: 'DELETE', headers: { authorization: token } });
    expect(deleted.status).toBe(200);
    const tombstone = await deleted.json() as { id: string; enabled: boolean; deletedAt: string | null };
    expect(tombstone.id).toBe(rule.id); expect(tombstone.enabled).toBe(false); expect(tombstone.deletedAt).not.toBeNull();
    const listed = await fetch(`${base}/api/automation/rules`, { headers: { authorization: token } });
    expect((await listed.json() as any).rules.some((item: any) => item.id === rule.id && item.deletedAt !== null)).toBe(true);
  });
  it('publishes recipient keys with an account-locked CAS epoch', async () => {
    await db.automationRecipientKey.deleteMany({ where: { userId } });
    const keyA = Buffer.alloc(32, 1).toString('base64url');
    const first = await fetch(`${base}/api/automation/recipient-key`, {
      method: 'PUT', headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ keyEpoch: 1, publicKey: keyA, packageVersion: 1, expectedPackageVersion: null }),
    });
    expect(first.status).toBe(200);
    const stale = await fetch(`${base}/api/automation/recipient-key`, {
      method: 'PUT', headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ keyEpoch: 1, publicKey: keyA, packageVersion: 2, expectedPackageVersion: 0 }),
    });
    expect(stale.status).toBe(409);
    const keyB = Buffer.alloc(32, 2).toString('base64url');
    const rotated = await fetch(`${base}/api/automation/recipient-key`, {
      method: 'PUT', headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ keyEpoch: 2, publicKey: keyB, packageVersion: 2, expectedPackageVersion: 1 }),
    });
    expect(rotated.status).toBe(200);
    expect((await (await fetch(`${base}/api/automation/recipient-key`, { headers: { authorization: token } })).json() as any).keyEpoch).toBe(2);
  });
  it('rejects B even when BOTH clientId claims are A, on both upload paths', async () => {
    for (const path of ['ops', 'ops/causal']) expect((await upload(workerB.token, { path })).status).toBe(403);
    expect(await db.operation.count({ where: { id: op.id } })).toBe(0);
  });
  it('rejects wrong account, database epoch and scope', async () => {
    expect((await upload(workerA.token, { token: otherToken })).status).toBe(403);
    expect((await upload(workerA.token, { epoch: 'different-db' })).status).toBe(403);
    expect((await upload(workerA.token, { op: { ...op, entityIds: ['arbitrary-task'] } })).status).toBe(403);
    expect((await upload(workerA.token, { op: { ...op, opType: 'CRT' } })).status).toBe(403);
  });
  it('rolls back the operation when completion persistence fails', async () => {
    await db.$executeRaw`CREATE FUNCTION fail_inbound_completion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected completion failure'; END; $$`;
    await db.$executeRaw`CREATE TRIGGER fail_inbound_completion BEFORE UPDATE ON automation_events
      FOR EACH ROW WHEN (NEW.status = 'completed') EXECUTE FUNCTION fail_inbound_completion()`;
    try {
      const response = await upload(workerA.token, { requestId: 'completion-failure' });
      expect(response.status).toBe(200);
      expect((await response.json() as any).results[0].accepted).toBe(false);
      expect(await db.operation.count({ where: { id: op.id } })).toBe(0);
      expect(await db.automationEvent.findFirst({ where: { userId, eventId } })).toMatchObject({ status: 'prepared' });
    } finally {
      await db.$executeRaw`DROP TRIGGER fail_inbound_completion ON automation_events`;
      await db.$executeRaw`DROP FUNCTION fail_inbound_completion()`;
    }
  });
  it('accepts owner and exact retry once, but the populated request cache cannot authorize B', async () => {
    const first = await upload(workerA.token); expect(first.status).toBe(200);
    const body = await first.json() as any; expect(body.results[0].accepted).toBe(true);
    expect(await db.automationEvent.findFirst({ where: { userId, eventId } })).toMatchObject({ status: 'completed' });
    const retry = await upload(workerA.token); expect(retry.status).toBe(200);
    expect((await retry.json() as any).deduplicated).toBe(true);
    expect((await upload(workerB.token)).status).toBe(403);
    expect((await upload(undefined)).status).toBe(403);
    expect(await db.operation.count({ where: { id: op.id } })).toBe(1);
  });
  it('repairs completion on an exact persisted retry outside the HTTP cache', async () => {
    await db.automationEvent.updateMany({ where: { userId, eventId }, data: { status: 'prepared' } });
    const response = await upload(workerA.token, { requestId: 'completion-retry-uncached' });
    expect(response.status).toBe(200);
    expect((await response.json() as any).results[0].accepted).toBe(true);
    expect(await db.operation.count({ where: { id: op.id } })).toBe(1);
    expect(await db.automationEvent.findFirst({ where: { userId, eventId } })).toMatchObject({ status: 'completed' });
  });
  it('erases expired ciphertext without losing completion, and expires unprocessed drafts', async () => {
    const { purgeExpiredAutomationEvents } = await import('../../src/automation/rules');
    const expiry = new Date(Date.now() - 1);
    await db.automationEvent.updateMany({ where: { userId, eventId }, data: { expiresAt: expiry } });
    const pendingEvent = randomUUID();
    await db.automationEvent.create({ data: { userId, ruleId, eventId: pendingEvent, ruleVersion: 1,
      dedupeDigest: 'f'.repeat(64), status: 'prepared', resultCiphertext: 'draft-only', expiresAt: expiry } });
    expect(await purgeExpiredAutomationEvents()).toBe(2);
    expect(await db.automationEvent.findFirst({ where: { userId, eventId } })).toMatchObject({ status: 'completed', payloadCiphertext: null, resultCiphertext: null, reasonCode: null });
    expect(await db.automationEvent.findFirst({ where: { userId, eventId: pendingEvent } })).toMatchObject({ status: 'expired', resultCiphertext: null, reasonCode: 'retention-expired' });
    expect(await purgeExpiredAutomationEvents()).toBe(0);
  });
  it('internal upload callers cannot bypass identity checks for an exact persisted duplicate', async () => {
    const { getSyncService } = await import('../../src/sync/sync.service');
    const result = await getSyncService().uploadOps(userId, clientA, [structuredClone(op)] as never);
    expect(result[0].accepted).toBe(false);
    expect(await db.operation.count({ where: { id: op.id } })).toBe(1);
  });
  it('rechecks the authenticated JWT version against durable account state', async () => {
    const { authorizeInboundOperations, readInboundUploadIdentity } = await import('../../src/automation/worker-identity');
    const identity = readInboundUploadIdentity(['x-heyta-worker-token', workerA.token, 'x-heyta-database-epoch', epoch], 0);
    await db.user.update({ where: { id: userId }, data: { tokenVersion: 1 } });
    expect(await authorizeInboundOperations(db, userId, clientA, [op] as never, identity)).toBe(false);
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    token = `Bearer ${jwt.sign({ userId, email: user.email, tokenVersion: 1 }, process.env.JWT_SECRET!)}`;
    expect((await upload(workerA.token)).status).toBe(200);
  });
  it('rejects revoked owner before cached response', async () => {
    const { DeviceService } = await import('../../src/sync/services/device.service');
    await new DeviceService().revokeDevice(userId, clientA);
    expect((await upload(workerA.token)).status).toBe(403);
  });
  it('cannot reuse the reserved identity through snapshot cache or persistence', async () => {
    const response = await fetch(`${base}/api/sync/snapshot`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: clientA, opId: op.id, requestId: 'snapshot-forgery',
        state: op.payload, isPayloadEncrypted: true, vectorClock: {}, schemaVersion: 1, reason: 'initial' }),
    });
    // Existing snapshot contract requires UUID opIds and rejects before cache.
    expect(response.status).toBe(400);
  });
  it('rechecks revocation after HTTP preflight while upload waits on its transaction lock', async () => {
    const worker = generateWorkerCredential();
    const event = randomUUID();
    const raceOp = { ...op, id: `inbound:${event}`, entityId: `inbound:${event}:0`,
      entityIds: [`inbound:${event}:1`], vectorClock: { [clientA]: 2 } };
    await db.automationWorker.create({ data: { id: worker.workerId, userId,
      credentialHash: worker.credentialHash, syncClientId: clientA, databaseEpoch: epoch } });
    await db.automationCommitPermit.create({ data: { eventId: event, userId, workerId: worker.workerId,
      opId: raceOp.id, ruleId: randomUUID(), ruleVersion: 1, parseVersion: 1, resultDigest: 'b'.repeat(64), itemCount: 2 } });
    let unlock!: () => void;
    let locked!: () => void;
    const barrier = new Promise<void>((resolve) => { unlock = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM user_sync_state WHERE user_id = ${userId} FOR UPDATE`;
      locked(); await barrier;
    }, { timeout: 15000 });
    await ready;
    let pending: Promise<Response> | undefined;
    try {
      pending = upload(worker.token, { op: raceOp });
      // The real backend reports the upload blocked after HTTP authorization.
      let waiting = false;
      for (let i = 0; i < 500; i++) {
        const rows = await db.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query ILIKE '%user_sync_state%' AND pid <> pg_backend_pid()
        `;
        if (Number(rows[0].count) > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      const { DeviceService } = await import('../../src/sync/services/device.service');
      await new DeviceService().revokeDevice(userId, clientA);
    } finally { unlock(); await holder; }
    const response = await pending!;
    expect(response.status).toBe(200);
    expect((await response.json() as any).results[0].accepted).toBe(false);
    expect(await db.operation.count({ where: { id: raceOp.id } })).toBe(0);
  }, 20000);
  it('owner-held receipt permits late sync after erasing the server permit and digest', async () => {
    const worker = generateWorkerCredential();
    const event = randomUUID();
    const deletedRule = randomUUID();
    await db.automationRule.create({ data: { id: deletedRule, userId, enabled: true, keyId: 'inbound-v1' } });
    await db.automationEvent.create({ data: { userId, ruleId: deletedRule, eventId: event, ruleVersion: 1,
      dedupeDigest: 'c'.repeat(64), status: 'prepared', payloadCiphertext: 'sealed', expiresAt: new Date(Date.now() + 86400000) } });
    const lateOp = { ...op, id: `inbound:${event}`, entityId: `inbound:${event}:0`,
      entityIds: [`inbound:${event}:1`], vectorClock: { [clientA]: 3 } };
    await db.automationWorker.create({ data: { id: worker.workerId, userId,
      credentialHash: worker.credentialHash, syncClientId: clientA, databaseEpoch: epoch } });
    await db.automationCommitPermit.create({ data: { eventId: event, userId, workerId: worker.workerId,
      opId: lateOp.id, ruleId: deletedRule, ruleVersion: 1, parseVersion: 1, resultDigest: 'c'.repeat(64), itemCount: 2 } });
    const proof = signCommitProof({ userId, workerId: worker.workerId, syncClientId: clientA,
      databaseEpoch: epoch, eventId: event, itemCount: 2 }, signing);
    const { deleteAutomationRule } = await import('../../src/automation/rules');
    await deleteAutomationRule(userId, deletedRule);
    expect(await db.automationEvent.count({ where: { userId, ruleId: deletedRule } })).toBe(0);
    expect((await db.automationRule.findUniqueOrThrow({ where: { id: deletedRule } })).deletedAt).not.toBeNull();
    expect(await db.automationCommitPermit.findFirst({ where: { userId, eventId: event } })).toBeNull();
    expect((await upload(worker.token, { op: lateOp })).status).toBe(403);
    expect((await upload(worker.token, { op: lateOp, proofs: { [lateOp.id]: proof + 'x' } })).status).toBe(403);
    const proofs = { [lateOp.id]: proof };
    expect((await upload(workerB.token, { op: lateOp, proofs })).status).toBe(403);
    const first = await upload(worker.token, { op: lateOp, proofs });
    expect(first.status).toBe(200); expect((await first.json() as any).results[0].accepted).toBe(true);
    const retry = await upload(worker.token, { op: lateOp, proofs });
    expect((await retry.json() as any).results[0].accepted).toBe(true);
    expect(await db.operation.count({ where: { id: lateOp.id } })).toBe(1);
    const { DeviceService } = await import('../../src/sync/services/device.service');
    await new DeviceService().revokeDevice(userId, clientA);
    expect((await upload(worker.token, { op: lateOp, proofs })).status).toBe(403);
  });
  // 🔴 自托管在线核验：这台实例上"本机订阅行"不再是自动收集的权益来源，
  // 每个动作要自带一枚官方签发、绑定 action 与作用域、只能用一次的票据。
  describe('self-hosted online entitlement', () => {
    const official = generateKeyPairSync('ed25519');
    const rawPublic = official.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
    const installation = randomUUID();
    const localAccount = randomUUID();
    let modeSaved: string | undefined;
    let keysSaved: string | undefined;
    const ticketFor = (action: string, scope: Record<string, string>, lifetimeSeconds = 25) =>
      signAutomationEntitlementTicket({
        issuer: 'https://official.test/entitlements', keyId: 'k1', action: action as never, capability: 'automation',
        officialSubject: 'acct-postgres', installationId: installation, localAccountUuid: localAccount,
        nonce: randomUUID(), issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + lifetimeSeconds, revocationVersion: 1, ...scope,
      }, official.privateKey);
    beforeAll(() => {
      modeSaved = process.env.AUTOMATION_ENTITLEMENT_MODE;
      keysSaved = process.env.AUTOMATION_OFFICIAL_KEYS;
      process.env.AUTOMATION_ENTITLEMENT_MODE = 'selfhost-online';
      process.env.AUTOMATION_OFFICIAL_KEYS = JSON.stringify({
        issuer: 'https://official.test/entitlements', instanceId: installation, keys: { k1: rawPublic },
      });
    });
    afterAll(() => {
      if (modeSaved === undefined) delete process.env.AUTOMATION_ENTITLEMENT_MODE; else process.env.AUTOMATION_ENTITLEMENT_MODE = modeSaved;
      if (keysSaved === undefined) delete process.env.AUTOMATION_OFFICIAL_KEYS; else process.env.AUTOMATION_OFFICIAL_KEYS = keysSaved;
      return db.automationEvent.deleteMany({ where: { userId, ruleId: { in: [shRuleId] } } });
    });
    const shRuleId = randomUUID();
    const verify = (body: object) => fetch(`${base}/api/automation/entitlement/verify`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const hook = async (eventLabel: string, body = Buffer.from('{"title":"selfhost"}', 'utf8')) => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const path = `/api/automation/v1/hooks/${shRuleId}`;
      const signature = signWebhook(Buffer.from('22'.repeat(32), 'hex'), { method: 'POST', path, ruleId: shRuleId,
        keyId: 'inbound-v1', timestamp, eventId: eventLabel, contentType: 'application/json', body });
      return fetch(`${base}${path}`, { method: 'POST', body, headers: { 'content-type': 'application/json',
        'x-heyta-key-id': 'inbound-v1', 'x-heyta-timestamp': timestamp, 'x-heyta-event-id': eventLabel, 'x-heyta-signature': signature } });
    };
    // 这一档自带一台 worker：文件靠前的设备撤销测试已经吊销了 workerA/clientA，
    // 拿它测许可路径会把" worker 已撤销"误读成"票据被拒"。
    const shWorker = generateWorkerCredential();
    const shClient = `selfhost-${randomUUID()}`;
    const shEpoch = randomUUID();
    beforeAll(async () => {
      await db.automationWorker.create({ data: { id: shWorker.workerId, userId,
        credentialHash: shWorker.credentialHash, syncClientId: shClient, databaseEpoch: shEpoch } });
      await db.automationRule.create({ data: { id: shRuleId, userId, enabled: true, keyId: 'inbound-v1' } });
      await db.automationRecipientKey.upsert({ where: { userId }, create: { userId, keyEpoch: 1,
        publicKey: Buffer.from(recipient.publicKey, 'base64').toString('base64url'), packageVersion: 1 },
        update: { keyEpoch: 1, publicKey: Buffer.from(recipient.publicKey, 'base64').toString('base64url'), packageVersion: 1 } });
    });

    it('a local subscription row does not open the public receiver on a self-hosted instance', async () => {
      const response = await hook(`sh-no-binding-${randomUUID()}`);
      expect(response.status).toBe(402);
      expect(await db.automationEvent.count({ where: { userId, ruleId: shRuleId } })).toBe(0);
    });

    it('refuses instead of going free when the deployment has no official keyring', async () => {
      const keys = process.env.AUTOMATION_OFFICIAL_KEYS;
      delete process.env.AUTOMATION_OFFICIAL_KEYS;
      try {
        expect((await hook(`sh-no-keyring-${randomUUID()}`)).status).toBe(402);
      } finally { process.env.AUTOMATION_OFFICIAL_KEYS = keys; }
    });

    it('one session ticket authorizes the receiver once, and the same ticket cannot be spent twice', async () => {
      const ticket = ticketFor('session', {});
      const first = await verify({ ticket, localAccountUuid: localAccount });
      expect(first.status).toBe(200);
      const window = await first.json() as { state: string; expiresAt: string };
      expect(window.state).toBe('active');
      // 已披露的窗口：票据最多 30 秒，撤销对已签发票据只能在这个上界内生效。
      expect(new Date(window.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(30_000);
      expect((await hook(`sh-session-${randomUUID()}`)).status).toBe(202);
      const replay = await verify({ ticket, localAccountUuid: localAccount });
      expect(replay.status).toBe(403);
      expect((await replay.json() as { errorCode: string }).errorCode).toBe('AUTOMATION_TICKET_USED');
      const row = await db.automationEntitlementBinding.findUniqueOrThrow({ where: { userId } });
      expect(row).toMatchObject({ officialSubject: 'acct-postgres', installationId: installation, localAccountUuid: localAccount, revocationVersion: 1 });
    });

    it('a ticket for another local account cannot establish the binding here', async () => {
      expect((await verify({ ticket: ticketFor('session', {}), localAccountUuid: randomUUID() })).status).toBe(403);
    });

    it('spends two concurrent copies of one ticket exactly once', async () => {
      const ticket = ticketFor('session', {});
      const settled = await Promise.allSettled([verify({ ticket, localAccountUuid: localAccount }), verify({ ticket, localAccountUuid: localAccount })]);
      const statuses = settled.map((outcome) => outcome.status === 'fulfilled' ? outcome.value.status : 0);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 403)).toHaveLength(1);
      expect(await db.automationEntitlementTicketUse.count({ where: { userId } })).toBeGreaterThanOrEqual(1);
    });

    it('stops issuing when the installation clock rolls backwards', async () => {
      await db.automationEntitlementClock.upsert({ where: { installationId: installation },
        create: { installationId: installation, maxSeenAtMs: BigInt(Date.now() + 120_000), updatedAt: new Date() },
        update: { maxSeenAtMs: BigInt(Date.now() + 120_000), updatedAt: new Date() } });
      const response = await verify({ ticket: ticketFor('session', {}), localAccountUuid: localAccount });
      expect(response.status).toBe(403);
      expect((await response.json() as { errorCode: string }).errorCode).toBe('AUTOMATION_CLOCK_ROLLBACK');
      await db.automationEntitlementClock.deleteMany({ where: { installationId: installation } });
    });

    it('a commit-permit ticket only authorizes its own event, once', async () => {
      const permitRule = randomUUID();
      const permitEvent = randomUUID();
      await db.automationRule.create({ data: { id: permitRule, userId, enabled: true, keyId: 'inbound-v1' } });
      const prepared = { userId, ruleId: permitRule, eventId: permitEvent, ruleVersion: 1, dedupeDigest: 'e'.repeat(64),
        status: 'prepared' as const, resultCiphertext: 'sealed', resultDigest: 'e'.repeat(64), resultItemCount: 1,
        parseVersion: 1, expiresAt: new Date(Date.now() + 86400000) };
      await db.automationEvent.create({ data: prepared });
      const post = (body: object, entitlementTicket?: string) => fetch(`${base}/api/automation/commit-permit`, {
        method: 'POST', headers: { authorization: token, 'content-type': 'application/json',
          'x-heyta-worker-token': shWorker.token, 'x-heyta-database-epoch': shEpoch,
          ...(entitlementTicket ? { 'x-heyta-entitlement-ticket': entitlementTicket } : {}) },
        body: JSON.stringify(body),
      });
      const request = { clientId: shClient, databaseEpoch: shEpoch, eventId: permitEvent, opId: `inbound:${permitEvent}`,
        ruleId: permitRule, ruleVersion: 1, parseVersion: 1, resultDigest: 'e'.repeat(64), itemCount: 1 };
      // 没有票据 ⇒ 拒绝，且不落许可（订阅行有效也不例外）。
      expect((await post(request)).status).toBe(403);
      expect(await db.automationCommitPermit.count({ where: { userId, eventId: permitEvent } })).toBe(0);
      // 作用域属于另一个事件的票据同样不算数。
      const wrongScope = ticketFor('commit-permit', { eventId: `other-${randomUUID()}`.slice(0, 64) });
      expect((await post(request, wrongScope)).status).toBe(403);
      expect(await db.automationCommitPermit.count({ where: { userId, eventId: permitEvent } })).toBe(0);
      const scoped = ticketFor('commit-permit', { eventId: permitEvent });
      expect((await post(request, scoped)).status).toBe(201);
      expect(await db.automationCommitPermit.count({ where: { userId, eventId: permitEvent } })).toBe(1);
      // 换一个新事件复用同一枚票据 ⇒ nonce 已花掉，许可不得签发。
      const secondEvent = randomUUID();
      await db.automationEvent.create({ data: { ...prepared, eventId: secondEvent, dedupeDigest: 'f'.repeat(64), resultDigest: 'f'.repeat(64) } });
      const replay = { ...request, eventId: secondEvent, opId: `inbound:${secondEvent}`, resultDigest: 'f'.repeat(64) };
      expect((await post(replay, scoped)).status).toBe(403);
      expect(await db.automationCommitPermit.count({ where: { userId, eventId: secondEvent } })).toBe(0);
      await db.automationEvent.deleteMany({ where: { userId, ruleId: permitRule } });
      await db.automationRule.deleteMany({ where: { id: permitRule } });
    });

    // 🔴 T2：一次性票据的**消费**必须坐在业务写事务里，不是闸门事务里。
    // AC-1 那句"拒绝且不产生业务效果"的反向也要成立：业务写失败回滚的那一次，
    // nonce 不能被烧掉 —— 否则用户会因为一次与我们自己的故障而少一次机会，
    // 而"回滚不烧"这件事除了真 PostgreSQL 事务没人能证。
    // 这一档选的失败点是**产品自己的**：部署没配 sender KEK 时，密封密钥那一步在
    // 授权之后、create 之前抛 —— 不需要往被测路径里塞测试桩。
    it('写事务回滚不烧 nonce：同一枚票据在业务恢复后仍能用，且只用一次', async () => {
      const credentialRule = randomUUID();
      const savedKek = process.env.AUTOMATION_SENDER_KEK;
      delete process.env.AUTOMATION_SENDER_KEK;
      await db.automationRule.create({ data: { id: credentialRule, userId, enabled: true, keyId: 'inbound-v1' } });
      await db.automationEntitlementBinding.upsert({ where: { userId },
        create: { userId, officialSubject: 'acct-postgres', installationId: installation, localAccountUuid: localAccount,
          issuer: 'https://official.test/entitlements', keyId: 'k1', revocationVersion: 1,
          expiresAt: new Date(Date.now() + 600_000), checkedAt: new Date() },
        update: { officialSubject: 'acct-postgres', installationId: installation, localAccountUuid: localAccount,
          revocationVersion: 1, expiresAt: new Date(Date.now() + 600_000) } });
      const ticket = ticketFor('sender-credential-issue', { ruleId: credentialRule });
      const nonce = JSON.parse(Buffer.from(ticket.split('.')[0]!, 'base64url').toString('utf8')).nonce as string;
      const issue = () => fetch(`${base}/api/automation/rules/${credentialRule}/sender-credentials`, {
        method: 'POST', headers: { authorization: token, 'content-type': 'application/json', 'x-heyta-entitlement-ticket': ticket },
        body: JSON.stringify({ keyId: 'hk-rollback' }) });
      try {
        const failed = await issue();
        expect(failed.status).toBe(409);
        expect(await db.automationSenderCredential.count({ where: { userId, ruleId: credentialRule } })).toBe(0);
        // 🔴 反向那一半：那一次回滚**没有**把 nonce 烧掉。闸门若仍在自己的事务里消费，
        // 这一条就先红，后面那次 201 也拿不到。
        expect(await db.automationEntitlementTicketUse.count({ where: { nonce } })).toBe(0);

        process.env.AUTOMATION_SENDER_KEK = '33'.repeat(32);
        const issued = await issue();
        expect(issued.status).toBe(201);
        expect(await db.automationSenderCredential.count({ where: { userId, ruleId: credentialRule } })).toBe(1);
        expect(await db.automationEntitlementTicketUse.count({ where: { nonce } })).toBe(1);

        // 重放同一枚票据 ⇒ 拒。而"吊销旧凭据"与"建新的"在同一笔里，
        // 这次失败的那笔必须把已签发的那条原样留着。
        const replay = await issue();
        expect(replay.status).toBe(402);
        expect((await replay.json() as { ticketCode?: string }).ticketCode).toBe('AUTOMATION_TICKET_USED');
        const kept = await db.automationSenderCredential.findFirstOrThrow({ where: { userId, ruleId: credentialRule } });
        expect(kept.revokedAt).toBeNull();
        expect(await db.automationSenderCredential.count({ where: { userId, ruleId: credentialRule } })).toBe(1);
      } finally {
        if (savedKek === undefined) delete process.env.AUTOMATION_SENDER_KEK; else process.env.AUTOMATION_SENDER_KEK = savedKek;
        await db.automationSenderCredential.deleteMany({ where: { userId, ruleId: credentialRule } });
        await db.automationEntitlementTicketUse.deleteMany({ where: { nonce } });
        await db.automationRule.deleteMany({ where: { id: credentialRule } });
      }
    });

    it('闸门只预检：写在授权之前被产品条件拒掉的那些路径同样不烧 nonce', async () => {
      // 作用域不符（票据绑的是另一条清单）—— 消费必须在写事务里，
      // 而这一条连业务写都没走到，所以既没有效果也没有 nonce。
      const otherRule = randomUUID();
      await db.automationRule.create({ data: { id: otherRule, userId, enabled: true, keyId: 'inbound-v1' } });
      const ticket = ticketFor('sender-credential-issue', { ruleId: otherRule });
      const nonce = JSON.parse(Buffer.from(ticket.split('.')[0]!, 'base64url').toString('utf8')).nonce as string;
      try {
        const wrongScope = await fetch(`${base}/api/automation/rules/${randomUUID()}/sender-credentials`, {
          method: 'POST', headers: { authorization: token, 'content-type': 'application/json', 'x-heyta-entitlement-ticket': ticket },
          body: JSON.stringify({ keyId: 'hk-scope' }) });
        expect(wrongScope.status).toBe(402);
        expect((await wrongScope.json() as { ticketCode?: string }).ticketCode).toBe('AUTOMATION_TICKET_SCOPE_MISMATCH');
        expect(await db.automationEntitlementTicketUse.count({ where: { nonce } })).toBe(0);
      } finally {
        await db.automationRule.deleteMany({ where: { id: otherRule } });
      }
    });
  });

  // 🔴 签发端与账号绑定握手（official 模式、真库、真 HTTP）：
  // 主体 → 一次性激活码 → 绑定 → 只按绑定行签发的 session 票据 → 吊销下限在线生效。
  describe('official issuance and account binding handshake', () => {
    const officialKey = generateKeyPairSync('ed25519');
    const rawPublic = officialKey.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
    const rawSeed = officialKey.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64url');
    const ISSUER_URL = 'https://official.test/entitlements';
    const installation = randomUUID();
    const localAccount = randomUUID();
    const savedEnv: Record<string, string | undefined> = {};
    const post = (path: string, body: unknown, auth = token) => fetch(`${base}/api${path}`, {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const errorCode = async (response: Response) => (await response.json() as { errorCode?: string }).errorCode;
    let lastCode: string;

    beforeAll(async () => {
      for (const name of ['AUTOMATION_ENTITLEMENT_MODE', 'AUTOMATION_OFFICIAL_KEYS', 'AUTOMATION_OFFICIAL_ISSUER',
        'AUTOMATION_OFFICIAL_KEY_ID', 'AUTOMATION_OFFICIAL_PRIVATE_KEY'] as const) {
        savedEnv[name] = process.env[name];
      }
      process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
      process.env.AUTOMATION_OFFICIAL_ISSUER = ISSUER_URL;
      process.env.AUTOMATION_OFFICIAL_KEY_ID = 'k1';
      process.env.AUTOMATION_OFFICIAL_PRIVATE_KEY = rawSeed;
      process.env.AUTOMATION_OFFICIAL_KEYS = JSON.stringify({ issuer: ISSUER_URL, instanceId: installation, keys: { k1: rawPublic } });
      // 上一段自托管取证留下的绑定会与本段的三元组冲突；这里是干净首绑的取证，先清场。
      await db.automationEntitlementBinding.deleteMany({ where: { userId } });
      await db.automationEntitlementTicketUse.deleteMany({ where: { userId } });
      await db.automationEntitlementClock.deleteMany({});
      await db.subscription.create({ data: { userId: otherId, status: 'active', grants: ['automation'], currentPeriodEnd: BigInt(Date.now() + 86400000) } });
      await db.user.update({ where: { id: userId }, data: { isAdmin: true } });
    });
    afterAll(async () => {
      for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      await db.user.update({ where: { id: userId }, data: { isAdmin: false } });
      await db.subscription.deleteMany({ where: { userId: otherId } });
      await db.automationEntitlementActivation.deleteMany({});
      await db.automationEntitlementLink.deleteMany({});
      await db.automationEntitlementSubject.deleteMany({});
      await db.automationEntitlementRevocation.deleteMany({});
      await db.automationEntitlementBinding.deleteMany({ where: { userId } });
      await db.automationEntitlementTicketUse.deleteMany({ where: { userId } });
      await db.automationEntitlementClock.deleteMany({});
    });

    it('issues a stable subject and a one-time code that is stored only as a hash', async () => {
      const subject = await post('/automation/entitlement/subject', {});
      expect(subject.status).toBe(200);
      const first = (await subject.json() as { subject: string }).subject;
      expect(first).toMatch(/^htsub_[0-9a-f]{32}$/);
      const again = await post('/automation/entitlement/subject', {});
      expect((await again.json() as { subject: string }).subject).toBe(first);

      const activation = await post('/automation/entitlement/activations', { installationId: installation });
      expect(activation.status).toBe(200);
      const issued = await activation.json() as { code: string; subject: string };
      lastCode = issued.code;
      expect(issued.subject).toBe(first);
      expect(issued.code.length).toBeGreaterThanOrEqual(20);
      const row = await db.automationEntitlementActivation.findUniqueOrThrow({
        where: { userId_installationId: { userId, installationId: installation } },
      });
      expect(row.codeHash).toBe(automationActivationCodeHash(issued.code));
      expect(JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? String(value) : value)).not.toContain(issued.code);
    });

    it('refuses to bind a code that was issued for a different installation', async () => {
      const wrong = await post('/automation/entitlement/activations/redeem',
        { code: lastCode, installationId: randomUUID(), localAccountUuid: localAccount });
      expect(wrong.status).toBe(403);
      expect(await errorCode(wrong)).toBe('AUTOMATION_ACTIVATION_INVALID');
      expect(await db.automationEntitlementLink.count({ where: { userId } })).toBe(0);
      // 拒签不消耗码：给它的那台实例仍然能兑换。
      const right = await post('/automation/entitlement/activations/redeem',
        { code: lastCode, installationId: installation, localAccountUuid: localAccount });
      expect(right.status).toBe(200);
      expect(await db.automationEntitlementActivation.count({ where: { userId } })).toBe(0);
    });

    it('signs session tickets only from the recorded binding, never from what the client declares', async () => {
      const unbound = await post('/automation/entitlement/session', { installationId: randomUUID() });
      expect(unbound.status).toBe(403);
      expect(await errorCode(unbound)).toBe('AUTOMATION_LINK_NOT_BOUND');

      const signed = await post('/automation/entitlement/session', { installationId: installation });
      expect(signed.status).toBe(200);
      const { ticket } = await signed.json() as { ticket: string };
      const claims = JSON.parse(Buffer.from(ticket.split('.')[0]!, 'base64url').toString('utf8')) as Record<string, unknown>;
      const link = await db.automationEntitlementLink.findUniqueOrThrow({ where: { installationId: installation } });
      // 票据里的三个绑定字段逐字等于库里那一行 —— 请求体没有参与任何一个。
      expect(claims).toMatchObject({ action: 'session', officialSubject: link.subject, installationId: installation, localAccountUuid: link.localAccountUuid });
      expect(Number(claims.expiresAt) - Number(claims.issuedAt)).toBeLessThanOrEqual(30);

      // 自报另一个本地账号：票据不跟着变，消费侧按票据与请求体的不符直接拒。
      const lying = await post('/automation/entitlement/verify', { ticket, localAccountUuid: randomUUID() });
      expect(lying.status).toBe(403);
      expect(await errorCode(lying)).toBe('AUTOMATION_LOCAL_ACCOUNT_MISMATCH');

      const honest = await post('/automation/entitlement/verify', { ticket, localAccountUuid: link.localAccountUuid });
      expect(honest.status).toBe(200);
      const binding = await db.automationEntitlementBinding.findUniqueOrThrow({ where: { userId } });
      expect(binding).toMatchObject({ officialSubject: link.subject, installationId: installation, localAccountUuid: link.localAccountUuid });
    });

    it('换主体必须先撤销：一枚新码顶不掉别人在这台实例上的绑定', async () => {
      const otherActivation = await post('/automation/entitlement/activations', { installationId: installation }, otherToken);
      expect(otherActivation.status).toBe(200);
      const { code } = await otherActivation.json() as { code: string };
      const conflict = await post('/automation/entitlement/activations/redeem',
        { code, installationId: installation, localAccountUuid: randomUUID() }, otherToken);
      expect(conflict.status).toBe(403);
      expect(await errorCode(conflict)).toBe('AUTOMATION_LINK_CONFLICT');
      expect((await db.automationEntitlementLink.findUniqueOrThrow({ where: { installationId: installation } })).userId).toBe(userId);

      const revoked = await post('/automation/entitlement/activations/revoke', { installationId: installation });
      expect(revoked.status).toBe(200);
      expect((await revoked.json() as { revoked: boolean }).revoked).toBe(true);
      const rebound = await post('/automation/entitlement/activations/redeem',
        { code, installationId: installation, localAccountUuid: randomUUID() }, otherToken);
      expect(rebound.status).toBe(200);
      expect((await db.automationEntitlementLink.findUniqueOrThrow({ where: { installationId: installation } })).userId).toBe(otherId);
    });

    it('吊销下限在线抬上去之后，落后的票据与已存在的短期绑定都判拒', async () => {
      const before = await fetch(`${base}/api/automation/entitlement/revocations`);
      expect(before.status).toBe(200);
      const { manifest } = await before.json() as { manifest: string };
      expect(inspectAutomationRevocationManifest(manifest, {
        issuer: ISSUER_URL, instanceId: installation, keys: { k1: rawPublic },
      })).toMatchObject({ ok: true, claims: { revocationVersion: 0 } });

      const notAdmin = await post('/automation/entitlement/revocations', { revocationVersion: 4 }, otherToken);
      expect(notAdmin.status).toBe(403);
      const bumped = await post('/automation/entitlement/revocations', { revocationVersion: 4 });
      expect(bumped.status).toBe(200);
      // 只升不降：把下限往回抬必须被拒，而不是悄悄放行旧票据。
      expect((await post('/automation/entitlement/revocations', { revocationVersion: 3 })).status).toBe(403);
      expect(await db.automationEntitlementRevocation.findUniqueOrThrow({ where: { scope: 'global' } })).toMatchObject({ revocationVersion: 4 });

      // 一枚"旧下限"的票据（由同一个合法签发者签，revocationVersion=1）现在必须被拒。
      // 三元组取自库里那一行绑定 —— 吊销这一档在查绑定之前就先判，所以不需要那条绑定的存在。
      const staleLink = await db.automationEntitlementLink.findUniqueOrThrow({ where: { installationId: installation } });
      const stale = signAutomationEntitlementTicket({
        issuer: ISSUER_URL, keyId: 'k1', action: 'session', capability: 'automation',
        officialSubject: staleLink.subject,
        installationId: installation, localAccountUuid: staleLink.localAccountUuid, nonce: randomUUID(),
        issuedAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 20, revocationVersion: 1,
      }, officialKey.privateKey);
      const refused = await post('/automation/entitlement/verify', { ticket: stale, localAccountUuid: staleLink.localAccountUuid }, otherToken);
      expect(refused.status).toBe(403);
      expect(await errorCode(refused)).toBe('AUTOMATION_REVOCATION_STALE');

      // 闸门这一侧：绑定行停在 version 4 以下时，抬到 9 之后连"能不能建收件密钥"都要变红。
      await db.automationEntitlementRevocation.deleteMany({});
      await db.user.update({ where: { id: userId }, data: { isAdmin: false } });
      const keyring = JSON.stringify({ issuer: ISSUER_URL, instanceId: installation, keys: { k1: rawPublic } });
      process.env.AUTOMATION_ENTITLEMENT_MODE = 'selfhost-online';
      process.env.AUTOMATION_OFFICIAL_KEYS = keyring;
      try {
        const fresh = await post('/automation/entitlement/session', { installationId: installation });
        // 绑定行属于别的账号了，这里改为直接种一条当前下限下的绑定来单独测闸门。
        expect(fresh.status).toBe(403);
        await db.automationEntitlementBinding.upsert({ where: { userId }, create: { userId, officialSubject: 'acct-gate',
          installationId: installation, localAccountUuid: localAccount, issuer: ISSUER_URL, keyId: 'k1',
          revocationVersion: 4, expiresAt: new Date(Date.now() + 600_000), checkedAt: new Date() },
          update: { revocationVersion: 4, expiresAt: new Date(Date.now() + 600_000), installationId: installation } });
        // 这一档只测闸门：请求体本身必须是合法的（同 epoch 逐字节重发、版本号往前推），
        // 否则路由自己的 409 会抢在闸门前面，红的是别的账。
        const existingKey = await db.automationRecipientKey.findUnique({ where: { userId } });
        const republish = (packageVersion: number, expectedPackageVersion: number | null) => ({
          keyEpoch: existingKey?.keyEpoch ?? 1,
          publicKey: existingKey?.publicKey ?? Buffer.from(recipient.publicKey, 'base64').toString('base64url'),
          packageVersion,
          expectedPackageVersion,
        });
        const nextPackage = (existingKey?.packageVersion ?? 0) + 1;
        const gateBefore = await fetch(`${base}/api/automation/recipient-key`, { method: 'PUT', headers: { authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(republish(nextPackage, existingKey?.packageVersion ?? null)) });
        expect(gateBefore.status).toBe(200);
        const relayed = await post('/automation/entitlement/revocations/refresh', { manifest: signAutomationRevocationManifest({
          issuer: { issuer: ISSUER_URL, keyId: 'k1', privateKeySeed: rawSeed }, revocationVersion: 9,
        }) });
        expect(relayed.status).toBe(200);
        expect(await relayed.json() as object).toMatchObject({ revocationVersion: 9, refreshed: true });
        const gateAfter = await fetch(`${base}/api/automation/recipient-key`, { method: 'PUT', headers: { authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(republish(nextPackage + 1, nextPackage)) });
        expect(gateAfter.status).toBe(402);
        // 🔴 逐次放行的 action 闸门也要对着**同一个**下限判。票据本身合法（同一签发者、
        // 同一把钥、没过期、nonce 没用过），只是停在线下刷新后的下限之下。
        const staleClaim = signAutomationEntitlementTicket({
          issuer: ISSUER_URL, keyId: 'k1', action: 'event-claim', capability: 'automation',
          officialSubject: staleLink.subject, installationId: installation, localAccountUuid: localAccount,
          nonce: randomUUID(), issuedAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 20,
          revocationVersion: 5,
        }, officialKey.privateKey);
        const claimRefused = await fetch(`${base}/api/automation/events/claim`, { method: 'POST', headers: {
          authorization: token, 'content-type': 'application/json', 'x-heyta-entitlement-ticket': staleClaim },
          body: JSON.stringify({ clientId: randomUUID(), eventId: randomUUID() }) });
        expect(claimRefused.status).toBe(402);
        expect((await claimRefused.json() as { ticketCode?: string }).ticketCode).toBe('AUTOMATION_REVOCATION_STALE');
      } finally {
        process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
        await db.automationEntitlementBinding.deleteMany({ where: { userId } });
        await db.automationEntitlementRevocation.deleteMany({});
      }
    });
  });

  it('account deletion cascades both tables despite the composite worker ownership FK', async () => {
    await db.user.delete({ where: { id: userId } });
    expect(await db.automationWorker.count({ where: { userId } })).toBe(0);
    expect(await db.automationCommitPermit.count({ where: { userId } })).toBe(0);
    userId = 0;
  });
});
