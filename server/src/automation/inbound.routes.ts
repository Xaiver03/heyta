import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  INBOUND_MAX_REQUEST_BYTES,
  InboundRequestError,
  decodeInboundUtf8,
  inboundBodyDigest,
  parseInboundJson,
  readWebhookHeaders,
  sealInbound,
  verifyWebhook,
} from '@heyta/inbound-core';
import { prisma } from '../db';
import { Logger } from '../logger';
import { loadAutomationWebhookSecret } from './rules';
import { resolveSenderCredential } from './sender-credentials';
import { evaluateAutomationEntitlementForUser, lockedAutomationEntitlementSource, ENTITLEMENT_ERROR_CODE } from '../entitlement';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUEUE_EVENTS = 1_000;
const MAX_QUEUE_BYTES = 64 * 1024 * 1024;
class InboundEntitlementError extends Error {}
class InboundQueueLimitError extends Error { constructor(public readonly kind: 'events' | 'bytes') { super('Inbound queue limit reached'); } }

export interface InboundRoutesOptions {
  /** Canonical origin used in the envelope AAD; must not include a path/query. */
  serverOrigin: string;
  now?: () => number;
}

type HookRequest = FastifyRequest<{ Params: { ruleId: string } }>;

const rawBodyOf = (body: unknown): Buffer | undefined => {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  return undefined;
};

// The authenticated recipient-key API transports base64url without padding,
// while the envelope contract intentionally uses canonical RFC 4648 base64.
// Normalize at this boundary and let sealInbound perform the strict roundtrip.
const canonicalPublicKey = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
};

const statusResponse = (eventId: string, state: string): { eventId: string; state: string } => ({ eventId, state });

const errorCode = (error: unknown): string => error instanceof InboundRequestError ? error.code : 'INVALID_REQUEST';

/**
 * Public inbound webhook receiver. The plugin is intentionally separate from the
 * authenticated API: it accepts no JWT and never writes plaintext event content.
 */
export const inboundAutomationRoutes = async (
  fastify: FastifyInstance,
  options: InboundRoutesOptions,
): Promise<void> => {
  const now = options.now ?? Date.now;

  // Fastify would otherwise JSON.parse before the handler and destroy the signed
  // bytes (whitespace, key order and UTF-8 spelling are all part of the MAC).
  for (const contentType of ['application/json', 'text/plain'] as const) {
    fastify.addContentTypeParser(contentType, { parseAs: 'buffer' }, (_req, body: Buffer, done) => {
      done(null, body);
    });
  }

  fastify.post<{ Params: { ruleId: string } }>(
    '/automation/v1/hooks/:ruleId',
    {
      bodyLimit: INBOUND_MAX_REQUEST_BYTES,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const request = req as HookRequest;
      const rawBody = rawBodyOf(request.body);
      if (!rawBody) return reply.status(415).send({ error: 'Raw request body is required' });

      let headers: ReturnType<typeof readWebhookHeaders>;
      try {
        headers = readWebhookHeaders(request.raw.rawHeaders);
        const input = {
          method: 'POST' as const,
          path: request.raw.url ?? request.url,
          ruleId: request.params.ruleId,
          keyId: headers.keyId,
          timestamp: headers.timestamp,
          eventId: headers.eventId,
          contentType: headers.contentType,
          body: new Uint8Array(rawBody),
        };
        // Validate before writing. The parsed object is deliberately
        // discarded: field mapping belongs to the authorized worker, not the receiver.
        if (headers.contentType === 'application/json') parseInboundJson(new Uint8Array(rawBody));
        else decodeInboundUtf8(new Uint8Array(rawBody));

        const rule = await prisma.automationRule.findUnique({ where: { id: request.params.ruleId } });
        const managed = rule ? await resolveSenderCredential(rule.userId, rule.id, headers.keyId).catch(() => ({ configured: true, credentialId: undefined, secret: undefined })) : undefined;
        const secret = managed?.configured ? managed.secret : rule ? loadAutomationWebhookSecret(headers.keyId, rule.userId) : undefined;
        if (!secret) return reply.status(401).send({ error: 'Invalid webhook signature' });
        try { verifyWebhook(secret, input, headers.signature, now()); }
        finally { managed?.secret?.fill(0); }
        if (!rule || rule.deletedAt !== null || !rule.enabled || rule.keyId !== headers.keyId) {
          return reply.status(403).send({ error: 'Webhook is not enabled' });
        }

        {
          // 公网发送方不是账号，拿不到 action 票据，所以接收路径只能按**短期绑定**判：
          // 自托管在线模式下这是"至多 30 秒的已签发窗口"（协议 §4 要求对外披露的那一格），
          // 不是"撤销瞬时生效"。锁内那次判定才是本次落库的依据。
          const decision = await evaluateAutomationEntitlementForUser({ userId: rule.userId, now: now() });
          if (!decision.allowed) {
            Logger.audit({ event: 'ENTITLEMENT_DENIED', userId: rule.userId, errorCode: ENTITLEMENT_ERROR_CODE,
              reason: decision.reason, capability: 'automation' });
            return reply.status(402).send({ error: 'A paid subscription is required to use this hosted service.', errorCode: ENTITLEMENT_ERROR_CODE, reason: decision.reason });
          }
        }

        const digest = inboundBodyDigest(new Uint8Array(rawBody));
        const contentType = headers.contentType;
        const existing = await prisma.automationEvent.findFirst({ where: { eventId: headers.eventId, userId: rule.userId, ruleId: rule.id } });
        if (existing) {
          if (existing.userId !== rule.userId || existing.ruleId !== rule.id) {
            return reply.status(403).send({ error: 'Webhook is not enabled' });
          }
          if (existing.dedupeDigest !== digest || existing.contentType !== contentType) {
            return reply.status(409).send({ error: 'EVENT_CONTENT_CONFLICT' });
          }
          return reply.status(202).send(statusResponse(existing.eventId, existing.status));
        }

        const recipient = await prisma.automationRecipientKey.findUnique({ where: { userId: rule.userId } });
        if (!recipient) return reply.status(503).send({ error: 'Recipient key is not available' });

        const envelope = await sealInbound(
          new Uint8Array(rawBody),
          canonicalPublicKey(recipient.publicKey),
          {
            accountId: `user-${rule.userId}`,
            serverOrigin: options.serverOrigin,
            ruleId: rule.id,
            eventId: headers.eventId,
            purpose: 'input',
            keyEpoch: recipient.keyEpoch,
          },
        );
        const expiresAt = new Date(now() + RETENTION_MS);
        let row;
        const payloadCiphertext = JSON.stringify(envelope);
        try {
          row = await prisma.$transaction(async (tx) => {
            // Serialize the quota check with competing receives for this
            // account. The envelope is already sealed, so only its byte size
            // is counted; no plaintext enters the query or error path.
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${rule.userId} FOR UPDATE`;
            const currentRule = await tx.automationRule.findUnique({ where: { id: rule.id } });
            if (!currentRule || !currentRule.enabled || currentRule.deletedAt !== null || currentRule.keyId !== headers.keyId || currentRule.version !== rule.version) {
              throw new InboundRequestError('INVALID_REQUEST');
            }
            const currentManaged = await tx.automationSenderCredential.findFirst({ where: { userId: rule.userId, ruleId: rule.id, keyId: headers.keyId }, orderBy: { createdAt: 'desc' }, select: { id: true, revokedAt: true } });
            if (currentManaged !== null && (managed?.credentialId === undefined || currentManaged.id !== managed.credentialId || currentManaged.revokedAt !== null)) {
              throw new InboundRequestError('INVALID_SIGNATURE');
            }
            const currentRecipient = await tx.automationRecipientKey.findUnique({ where: { userId: rule.userId } });
            if (!currentRecipient || currentRecipient.packageVersion !== recipient.packageVersion || currentRecipient.publicKey !== recipient.publicKey) {
              throw new InboundRequestError('INVALID_REQUEST');
            }
            if (!(await evaluateAutomationEntitlementForUser({ userId: rule.userId, now: now(), source: lockedAutomationEntitlementSource(tx) })).allowed) {
              throw new InboundEntitlementError();
            }
            const usage = await tx.$queryRaw<Array<{ events: bigint; bytes: bigint }>>`
              SELECT COUNT(*)::bigint AS events,
                     COALESCE(SUM(octet_length(payload_ciphertext)), 0)::bigint AS bytes
              FROM automation_events
              WHERE user_id = ${rule.userId}
                AND payload_ciphertext IS NOT NULL
                AND status NOT IN ('cancelled', 'expired', 'completed', 'no-items', 'failed')`;
            const events = Number(usage[0]?.events ?? 0n);
            const bytes = Number(usage[0]?.bytes ?? 0n);
            if (events >= MAX_QUEUE_EVENTS) throw new InboundQueueLimitError('events');
            if (!Number.isSafeInteger(bytes) || bytes + Buffer.byteLength(payloadCiphertext, 'utf8') > MAX_QUEUE_BYTES) throw new InboundQueueLimitError('bytes');
            return tx.automationEvent.create({ data: {
              eventId: headers.eventId, userId: rule.userId, ruleId: rule.id, ruleVersion: rule.version,
              dedupeDigest: digest, contentType, payloadCiphertext, status: 'queued', expiresAt,
            } });
          });
        } catch (error) {
          // Another receiver may have linearized the same event between the
          // lookup and insert. Re-read the winner and apply the same exact
          // retry/conflict rule instead of leaking a 500 or creating a second
          // envelope.
          if ((error as { code?: string }).code !== 'P2002') throw error;
          const winner = await prisma.automationEvent.findFirst({ where: { eventId: headers.eventId, userId: rule.userId, ruleId: rule.id } });
          if (!winner || winner.userId !== rule.userId || winner.ruleId !== rule.id) {
            return reply.status(409).send({ error: 'EVENT_CONTENT_CONFLICT' });
          }
          if (winner.dedupeDigest !== digest || winner.contentType !== contentType) {
            return reply.status(409).send({ error: 'EVENT_CONTENT_CONFLICT' });
          }
          return reply.status(202).send(statusResponse(winner.eventId, winner.status));
        }
        return reply.status(202).send(statusResponse(row.eventId, row.status));
      } catch (error) {
        if (error instanceof InboundEntitlementError) return reply.status(402).send({ errorCode: ENTITLEMENT_ERROR_CODE });
        const code = errorCode(error);
        if (error instanceof InboundQueueLimitError) {
          return reply.status(error.kind === 'events' ? 429 : 413).send({ error: error.kind === 'events' ? 'QUEUE_EVENTS_LIMIT' : 'QUEUE_BYTES_LIMIT' });
        }
        if (error instanceof InboundRequestError) {
          const status = code === 'BODY_TOO_LARGE' ? 413 : code === 'SIGNATURE_EXPIRED' || code === 'INVALID_SIGNATURE' ? 401 : 400;
          return reply.status(status).send({ error: code });
        }
        // Do not include event IDs, rule IDs or database details in the public response.
        Logger.warn(`Inbound automation receiver rejected request: ${code}`);
        return reply.status(500).send({ error: 'Inbound event could not be accepted' });
      }
    },
  );

  // Sender-side status lookup uses the same HMAC key and raw-header rules. It
  // deliberately returns only opaque state; a webhook credential never grants
  // access to the sealed input or frozen result.
  fastify.get<{ Params: { ruleId: string; eventId: string } }>(
    '/automation/v1/hooks/:ruleId/events/:eventId',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const rawBody = Buffer.alloc(0);
      try {
        const headers = readWebhookHeaders(req.raw.rawHeaders);
        const input = {
          method: 'GET' as const,
          path: req.raw.url ?? req.url,
          ruleId: req.params.ruleId,
          keyId: headers.keyId,
          timestamp: headers.timestamp,
          eventId: req.params.eventId,
          contentType: headers.contentType,
          body: new Uint8Array(rawBody),
        };
        const rule = await prisma.automationRule.findUnique({ where: { id: req.params.ruleId } });
        const managed = rule ? await resolveSenderCredential(rule.userId, rule.id, headers.keyId).catch(() => ({ configured: true, credentialId: undefined, secret: undefined })) : undefined;
    const secret = managed?.configured ? managed.secret : rule ? loadAutomationWebhookSecret(headers.keyId, rule.userId) : undefined;
        if (!secret) return reply.status(401).send({ error: 'Invalid webhook signature' });
        // The header event ID must match the path event ID. This prevents a
        // valid signature for one event from being replayed as another lookup.
        if (headers.eventId !== req.params.eventId) return reply.status(400).send({ error: 'INVALID_REQUEST' });
        try { verifyWebhook(secret, input, headers.signature, now()); }
        finally { managed?.secret?.fill(0); }
        const latestManaged = await resolveSenderCredential(rule!.userId, rule!.id, headers.keyId).catch(() => ({ configured: true, credentialId: undefined, secret: undefined }));
        latestManaged.secret?.fill(0);
        if (latestManaged.configured !== managed?.configured || latestManaged.credentialId !== managed?.credentialId) {
          return reply.status(401).send({ error: 'Invalid webhook signature' });
        }
        if (!rule || rule.deletedAt !== null || !rule.enabled || rule.keyId !== headers.keyId) {
          return reply.status(403).send({ error: 'Webhook is not enabled' });
        }
        const event = await prisma.automationEvent.findFirst({ where: { eventId: req.params.eventId, userId: rule.userId, ruleId: rule.id } });
        if (!event) return reply.status(404).send({ error: 'Event not found' });
        return reply.send(statusResponse(event.eventId, event.status));
      } catch (error) {
        if (error instanceof InboundRequestError) {
          const code = error.code;
          const status = code === 'SIGNATURE_EXPIRED' || code === 'INVALID_SIGNATURE' ? 401 : 400;
          return reply.status(status).send({ error: code });
        }
        Logger.warn('Inbound automation status lookup failed');
        return reply.status(500).send({ error: 'Event status is unavailable' });
      }
    },
  );
};
