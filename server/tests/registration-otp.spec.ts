import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'registration-otp-test-secret-long-enough';
});

const state = vi.hoisted(() => ({
  users: new Map<number, any>(),
  challenges: new Map<string, any>(),
  nextUserId: 1,
}));

const spies = vi.hoisted(() => ({
  hashFor: vi.fn(),
  checkNewPassword: vi.fn(),
  sendCode: vi.fn(),
  attachInvite: vi.fn(),
  settleReferral: vi.fn(),
  issueSession: vi.fn(),
}));

const matches = (row: any, where: any): boolean => {
  for (const [key, value] of Object.entries(where ?? {})) {
    if (key === 'attemptCount' || key === 'resendCount') {
      const actual = row[key];
      if (value && typeof value === 'object') {
        if ('lt' in value && !(actual < (value as any).lt)) return false;
        if ('lte' in value && !(actual <= (value as any).lte)) return false;
      }
      continue;
    }
    if (value && typeof value === 'object' && 'gt' in value) {
      if (!(row[key] > (value as any).gt)) return false;
      continue;
    }
    if (value && typeof value === 'object' && 'lte' in value) {
      if (!(row[key] <= (value as any).lte)) return false;
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
};

const db = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  emailPasswordRegistrationChallenge: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

vi.mock('../src/db', () => ({ prisma: db }));
vi.mock('../src/password/service', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, hashFor: spies.hashFor };
});
vi.mock('../src/password/policy', () => ({
  checkNewPassword: spies.checkNewPassword,
}));
vi.mock('../src/email', () => ({
  sendEmailPasswordRegistrationCodeEmail: spies.sendCode,
}));
vi.mock('../src/activity/invite', () => ({
  attachInviteOnRegister: spies.attachInvite,
  settleReferralActivation: spies.settleReferral,
}));
vi.mock('../src/config', () => ({
  loadConfigFromEnv: () => ({ privacy: null }),
  isConsentRequired: () => false,
}));
vi.mock('../src/sync/services/storage-quota.service', () => ({
  getDefaultStorageQuotaBytes: () => 100,
}));
vi.mock('../src/auth', () => ({
  getJwtSecret: () => 'registration-otp-test-secret-long-enough',
  issueSession: spies.issueSession,
}));

import {
  registrationCodeDigest,
  requestRegistrationCode,
  resendRegistrationCode,
  verifyRegistrationCode,
} from '../src/password/registration-otp';

const email = 'otp@example.com';
const passwordHash = '$argon2id$pending';

beforeEach(() => {
  vi.clearAllMocks();
  state.users.clear();
  state.challenges.clear();
  state.nextUserId = 1;
  spies.checkNewPassword.mockResolvedValue({ ok: true, normalized: 'correct horse battery staple' });
  spies.hashFor.mockResolvedValue(passwordHash);
  spies.sendCode.mockResolvedValue(true);
  spies.attachInvite.mockResolvedValue({ attached: false, reason: 'UNKNOWN_CODE' });
  spies.settleReferral.mockResolvedValue({ settled: false, reason: 'NO_REFERRAL' });
  spies.issueSession.mockReturnValue('session-token');

  db.user.findUnique.mockImplementation(async ({ where }: any) => {
    const row = [...state.users.values()].find((value) =>
      where.id !== undefined ? value.id === where.id : value.email === where.email,
    );
    return row ? { ...row } : null;
  });
  db.user.create.mockImplementation(async ({ data, select }: any) => {
    const row = {
      id: state.nextUserId++,
      email: data.email,
      passwordHash: data.passwordHash,
      isVerified: 0,
      locale: data.locale ?? null,
      tokenVersion: 0,
    };
    state.users.set(row.id, row);
    return select?.id ? { id: row.id } : { ...row };
  });
  db.user.updateMany.mockImplementation(async ({ where, data }: any) => {
    let count = 0;
    for (const row of state.users.values()) {
      if (!matches(row, where)) continue;
      Object.assign(row, data);
      count += 1;
    }
    return { count };
  });
  db.$queryRaw.mockImplementation(async () =>
    [...state.users.values()].map((row) => ({
      id: row.id,
      email: row.email,
      is_verified: row.isVerified,
      password_hash: row.passwordHash,
    })),
  );
  db.emailPasswordRegistrationChallenge.findUnique.mockImplementation(async ({ where }: any) => {
    const row = state.challenges.get(where.id);
    return row ? { ...row } : null;
  });
  db.emailPasswordRegistrationChallenge.findFirst.mockImplementation(async ({ where, select }: any) => {
    const row = [...state.challenges.values()].find((candidate) => matches(candidate, where));
    return row ? (select ? selectKeys(row, select) : { ...row }) : null;
  });
  db.emailPasswordRegistrationChallenge.create.mockImplementation(async ({ data, select }: any) => {
    const row = {
      ...data,
      attemptCount: 0,
      resendCount: 0,
      consumedAt: null,
      createdAt: new Date(),
    };
    state.challenges.set(row.id, row);
    return select ? { ...selectKeys(row, select) } : { ...row };
  });
  db.emailPasswordRegistrationChallenge.updateMany.mockImplementation(async ({ where, data }: any) => {
    let count = 0;
    for (const row of state.challenges.values()) {
      if (!matches(row, where)) continue;
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'increment' in value) row[key] += (value as any).increment;
        else row[key] = value;
      }
      count += 1;
    }
    return { count };
  });
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
});

function selectKeys(row: any, select: Record<string, boolean>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
}

describe('email password registration OTP', () => {
  it('stores only an HMAC digest and sends a six digit code', async () => {
    const result = await requestRegistrationCode({ email, password: 'a password' });
    expect(result.challengeId).toBeTruthy();
    expect(result.emailDelivered).toBe(true);
    const challenge = state.challenges.get(result.challengeId);
    expect(challenge.codeDigest).toMatch(/^[a-f0-9]{64}$/);
    const sentCode = spies.sendCode.mock.calls[0][1] as string;
    expect(sentCode).toMatch(/^\d{6}$/);
    expect(challenge.codeDigest).toBe(registrationCodeDigest(result.challengeId, sentCode));
    expect(challenge).not.toHaveProperty('code');
    expect(state.users.get(1).passwordHash).toBeNull();
  });

  it('does not return an existing live challenge to a second unauthenticated request', async () => {
    const first = await requestRegistrationCode({ email, password: 'a password' });
    const second = await requestRegistrationCode({ email, password: 'another password' });

    expect(second.challengeId).not.toBe(first.challengeId);
    expect(state.challenges.has(second.challengeId)).toBe(false);
    expect(spies.sendCode).toHaveBeenCalledTimes(1);
  });

  it('defers invite binding until the email code has been verified', async () => {
    const result = await requestRegistrationCode({
      email,
      password: 'a password',
      inviteCode: 'INVITE123',
    });
    expect(spies.attachInvite).not.toHaveBeenCalled();

    const sentCode = spies.sendCode.mock.calls[0][1] as string;
    await verifyRegistrationCode({ challengeId: result.challengeId, code: sentCode });

    expect(spies.attachInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteeUserId: 1,
        rawCode: 'INVITE123',
      }),
    );
  });

  it('unifies bad, expired and unknown codes, and locks after five guesses', async () => {
    const result = await requestRegistrationCode({ email, password: 'a password' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(verifyRegistrationCode({ challengeId: result.challengeId, code: '000000' })).rejects.toMatchObject({
        code: 'invalid_registration_challenge',
      });
    }
    expect(state.challenges.get(result.challengeId).attemptCount).toBe(5);
    const sentCode = spies.sendCode.mock.calls[0][1] as string;
    await expect(verifyRegistrationCode({ challengeId: result.challengeId, code: sentCode })).rejects.toMatchObject({
      code: 'invalid_registration_challenge',
    });
    await expect(verifyRegistrationCode({ challengeId: 'unknown', code: sentCode })).rejects.toMatchObject({
      code: 'invalid_registration_challenge',
    });

    state.challenges.get(result.challengeId).expiresAt = BigInt(Date.now() - 1);
    await expect(verifyRegistrationCode({ challengeId: result.challengeId, code: sentCode })).rejects.toMatchObject({
      code: 'invalid_registration_challenge',
    });
  });

  it('claims once under concurrent verification and returns the existing session shape', async () => {
    const result = await requestRegistrationCode({ email, password: 'a password' });
    const sentCode = spies.sendCode.mock.calls[0][1] as string;
    const outcomes = await Promise.allSettled([
      verifyRegistrationCode({ challengeId: result.challengeId, code: sentCode }),
      verifyRegistrationCode({ challengeId: result.challengeId, code: sentCode }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(state.users.get(1).passwordHash).toBe(passwordHash);
    expect(state.users.get(1).isVerified).toBe(1);
  });

  it('enforces the resend cooldown and keeps a failed delivery retryable', async () => {
    spies.sendCode.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await requestRegistrationCode({ email, password: 'a password' });
    expect(result.emailDelivered).toBe(false);
    await expect(resendRegistrationCode(result.challengeId)).rejects.toMatchObject({
      code: 'registration_code_rate_limited',
    });
    state.challenges.get(result.challengeId).resendAvailableAt = BigInt(Date.now() - 1);
    const resent = await resendRegistrationCode(result.challengeId);
    expect(resent.emailDelivered).toBe(true);
    expect(spies.sendCode).toHaveBeenCalledTimes(2);
  });

  it('does not mutate an existing verified account or send it a registration code', async () => {
    state.users.set(1, { id: 1, email, passwordHash: 'existing', isVerified: 1, locale: null, tokenVersion: 2 });
    const result = await requestRegistrationCode({ email, password: 'a password' });
    expect(result.challengeId).toBeTruthy();
    expect(spies.sendCode).not.toHaveBeenCalled();
    expect(state.users.get(1).passwordHash).toBe('existing');
    expect(state.users.get(1).isVerified).toBe(1);
  });
});
