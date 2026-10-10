/**
 * Real PostgreSQL coverage for the public email-password registration challenge.
 *
 * Run with:
 *   DATABASE_URL=postgresql://... pnpm --dir server exec vitest run \
 *     --config vitest.integration.config.ts tests/integration/registration-otp.integration.spec.ts
 *
 * The suite is skipped without DATABASE_URL, like the other database integration suites.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const sendRegistrationCode = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.hoisted(() => {
  process.env.JWT_SECRET = 'registration-otp-integration-secret-at-least-32-characters';
  delete process.env.TEST_MODE;
  delete process.env.TEST_MODE_CONFIRM;
});

vi.mock('../../src/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/email')>()),
  sendEmailPasswordRegistrationCodeEmail: sendRegistrationCode,
}));

import { disconnectDb } from '../../src/db';
import { apiRoutes } from '../../src/api';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;
const RUN_ID = `${Date.now()}-${process.pid}`;
const EMAIL_PREFIX = `registration-otp-${RUN_ID}`;
const password = (suffix: string): string => `otp-${RUN_ID}-${suffix}-password-unique`;

describeWithDb('registration OTP races (PostgreSQL)', () => {
  let app: FastifyInstance;
  let termsApp: FastifyInstance;
  let observer: PrismaClient;

  beforeAll(async () => {
    observer = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.ready();
    termsApp = Fastify();
    await termsApp.register(apiRoutes, { prefix: '/api', requireTermsConsent: true });
    await termsApp.ready();
  });

  afterEach(async () => {
    await observer.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  });

  afterAll(async () => {
    await app.close();
    await termsApp.close();
    await observer.$disconnect();
    await disconnectDb();
  });

  const request = (email: string, password: string) =>
    app.inject({
      method: 'POST',
      url: '/api/register/email-password/request',
      payload: { email, password },
    });

  const requestWithTerms = (email: string, password: string, termsAccepted?: boolean) =>
    termsApp.inject({
      method: 'POST',
      url: '/api/register/email-password/request',
      payload: { email, password, ...(termsAccepted === undefined ? {} : { termsAccepted }) },
    });

  const verify = (challengeId: string, code: string) =>
    app.inject({
      method: 'POST',
      url: '/api/register/email-password/verify',
      payload: { challengeId, code },
    });

  it('does not disclose the active challenge id on a duplicate request', async () => {
    const email = `${EMAIL_PREFIX}-duplicate@example.test`;
    const first = await request(email, password('duplicate-first'));
    const firstBody = first.json() as { challengeId: string };
    const second = await request(email, password('duplicate-second'));
    const secondBody = second.json() as { challengeId: string };

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(secondBody.challengeId).not.toBe(firstBody.challengeId);
    expect(
      await observer.emailPasswordRegistrationChallenge.findUnique({
        where: { id: secondBody.challengeId },
      }),
    ).toBeNull();
  });

  it('enforces the request schema and required legal consent at the Fastify route', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/register/email-password/request',
      payload: { email: 'not-an-email', password: '' },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: 'validation_failed', message: 'Validation failed' });

    const email = `${EMAIL_PREFIX}-terms@example.test`;
    const missingTerms = await requestWithTerms(email, password('terms-missing'));
    expect(missingTerms.statusCode).toBe(400);
    expect(missingTerms.json()).toMatchObject({ code: 'validation_failed', message: 'Validation failed' });

    const rejectedTerms = await requestWithTerms(email, password('terms-false'), false);
    expect(rejectedTerms.statusCode).toBe(400);

    const acceptedTerms = await requestWithTerms(email, password('terms-true'), true);
    expect(acceptedTerms.statusCode).toBe(201);
    const user = await observer.user.findUniqueOrThrow({ where: { email } });
    expect(user.termsAcceptedAt).not.toBeNull();
  }, 30_000);

  it('serializes concurrent first requests to one live challenge', async () => {
    const email = `${EMAIL_PREFIX}-concurrent@example.test`;
    const responses = await Promise.all([
      request(email, password('concurrent-first')),
      request(email, password('concurrent-second')),
    ]);
    expect(responses.every((response) => response.statusCode === 201)).toBe(true);

    const user = await observer.user.findUniqueOrThrow({ where: { email } });
    const live = await observer.emailPasswordRegistrationChallenge.findMany({
      where: { userId: user.id, consumedAt: null },
    });
    expect(live).toHaveLength(1);
  });

  it('retires an expired challenge before creating its replacement', async () => {
    const email = `${EMAIL_PREFIX}-expired@example.test`;
    const first = await request(email, password('expired-first'));
    const firstBody = first.json() as { challengeId: string };

    await observer.emailPasswordRegistrationChallenge.update({
      where: { id: firstBody.challengeId },
      data: { expiresAt: BigInt(Date.now() - 1) },
    });

    const replacement = await request(email, password('expired-replacement'));
    const replacementBody = replacement.json() as { challengeId: string };
    expect(replacement.statusCode).toBe(201);
    expect(replacementBody.challengeId).not.toBe(firstBody.challengeId);

    const old = await observer.emailPasswordRegistrationChallenge.findUniqueOrThrow({
      where: { id: firstBody.challengeId },
      select: { consumedAt: true },
    });
    expect(old.consumedAt).not.toBeNull();

    const user = await observer.user.findUniqueOrThrow({ where: { email } });
    const live = await observer.emailPasswordRegistrationChallenge.findMany({
      where: { userId: user.id, consumedAt: null },
    });
    expect(live).toHaveLength(1);
  });

  it('atomically consumes a challenge when two verifications race', async () => {
    sendRegistrationCode.mockClear();
    const email = `${EMAIL_PREFIX}-verify-race@example.test`;
    const requested = await request(email, password('verify-race'));
    const { challengeId } = requested.json() as { challengeId: string };
    const code = sendRegistrationCode.mock.lastCall?.[1];
    expect(typeof code).toBe('string');

    const responses = await Promise.all([verify(challengeId, code as string), verify(challengeId, code as string)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);

    const challenge = await observer.emailPasswordRegistrationChallenge.findUniqueOrThrow({
      where: { id: challengeId },
      select: { consumedAt: true },
    });
    expect(challenge.consumedAt).not.toBeNull();
    await expect(observer.user.findUniqueOrThrow({ where: { email } })).resolves.toMatchObject({ isVerified: 1 });
  });

  it('returns one session on verify success and the public error code on reuse or malformed input', async () => {
    sendRegistrationCode.mockClear();
    const email = `${EMAIL_PREFIX}-verify-route@example.test`;
    const requested = await request(email, password('verify-route'));
    const { challengeId } = requested.json() as { challengeId: string };
    const code = sendRegistrationCode.mock.lastCall?.[1];
    expect(typeof code).toBe('string');

    const verified = await verify(challengeId, code as string);
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({ user: { email } });

    const reused = await verify(challengeId, code as string);
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toMatchObject({ code: 'invalid_registration_challenge' });

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/register/email-password/verify',
      payload: { challengeId: '', code: 'not-a-code' },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: 'invalid_registration_challenge' });
  }, 30_000);

  it('returns Retry-After for resend cooldown and sends after the cooldown', async () => {
    sendRegistrationCode.mockClear();
    const email = `${EMAIL_PREFIX}-resend-route@example.test`;
    const requested = await request(email, password('resend-route'));
    const { challengeId } = requested.json() as { challengeId: string };

    const rateLimited = await app.inject({
      method: 'POST',
      url: '/api/register/email-password/resend',
      payload: { challengeId },
    });
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.headers['retry-after']).toMatch(/^\d+$/);
    expect(rateLimited.json()).toMatchObject({ code: 'registration_code_rate_limited' });

    await observer.emailPasswordRegistrationChallenge.update({
      where: { id: challengeId },
      data: { resendAvailableAt: BigInt(Date.now() - 1) },
    });
    const resent = await app.inject({
      method: 'POST',
      url: '/api/register/email-password/resend',
      payload: { challengeId },
    });
    expect(resent.statusCode).toBe(200);
    expect(resent.json()).toMatchObject({ challengeId });

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/register/email-password/resend',
      payload: { challengeId: '' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'invalid_registration_challenge' });
  }, 30_000);

  it('keeps request and verify in the same user-then-challenge lock order', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      sendRegistrationCode.mockClear();
      const email = `${EMAIL_PREFIX}-lock-order-${attempt}@example.test`;
      const requested = await request(email, password(`lock-order-initial-${attempt}`));
      const { challengeId } = requested.json() as { challengeId: string };
      const code = sendRegistrationCode.mock.lastCall?.[1];
      expect(typeof code).toBe('string');
      await observer.emailPasswordRegistrationChallenge.update({
        where: { id: challengeId },
        data: { resendAvailableAt: BigInt(Date.now() - 1) },
      });

      const [requestResponse, verifyResponse] = await Promise.all([
        request(email, password(`lock-order-replacement-${attempt}`)),
        verify(challengeId, code as string),
      ]);
      expect(requestResponse.statusCode).toBe(201);
      expect([200, 400]).toContain(verifyResponse.statusCode);
    }
  }, 30_000);
});
