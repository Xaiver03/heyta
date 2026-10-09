import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutomationEntitlementError,
  inspectAutomationEntitlementTicket,
  isAutomationEntitlementBindingUsable,
  redeemAutomationEntitlementTicket,
  signAutomationEntitlementTicket,
  type AutomationEntitlementKeyring,
  type AutomationEntitlementTicket,
  type EntitlementDatabase,
} from '../src/automation/entitlement-ticket';

const subject = 'acct-main';
const installationId = '11111111-1111-4111-8111-111111111111';
const localAccountUuid = '22222222-2222-4222-8222-222222222222';
const ruleId = '55555555-5555-4555-8555-555555555555';
const otherRuleId = '66666666-6666-4666-8666-666666666666';
const eventId = 'event-42';
const otherEventId = 'event-43';
const nonce = '33333333-3333-4333-8333-333333333333';
/** 票据 issuedAt=1000、expiresAt=1020；1005 秒时有效。 */
const VALID_MS = 1_005_000;

function fixture() {
  const pair = generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  const keyring: AutomationEntitlementKeyring = {
    issuer: 'https://official.example/entitlements',
    instanceId: installationId,
    keys: { k1: der.subarray(-32).toString('base64url') },
  };
  return { pair, keyring };
}

type Claims = Omit<AutomationEntitlementTicket, 'version'>;
const baseClaims = (overrides: Partial<Claims> = {}): Claims => ({
  issuer: 'https://official.example/entitlements', keyId: 'k1', action: 'session', capability: 'automation',
  officialSubject: subject, installationId, localAccountUuid, nonce,
  issuedAt: 1_000, expiresAt: 1_020, revocationVersion: 4, ...overrides,
});
const token = (privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], overrides: Partial<Claims> = {}) =>
  signAutomationEntitlementTicket(baseClaims(overrides), privateKey);

/** 账号锁、数据库时钟、nonce 唯一性与绑定写入都在这里假装成一份真库。 */
function database(options: { binding?: Record<string, unknown> | null; clockMs?: number | bigint | null } = {}) {
  const uses: Record<string, unknown>[] = [];
  const bindingWrites: Record<string, unknown>[] = [];
  const clockWrites: Record<string, unknown>[] = [];
  let binding = options.binding ?? null;
  const client = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('clock_timestamp')) return [{ nowMs: 1n * BigInt(VALID_MS) }];
      return [];
    }),
    automationEntitlementBinding: {
      findUnique: vi.fn(async () => binding),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        binding = { ...(binding as object), ...create, ...update };
        bindingWrites.push(binding as Record<string, unknown>);
        return binding;
      }),
    },
    automationEntitlementTicketUse: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (uses.some((row) => row.nonce === data.nonce)) throw Object.assign(new Error('unique violation'), { code: 'P2002' });
        uses.push(data);
        return data;
      }),
    },
    automationEntitlementClock: {
      findUnique: vi.fn(async () => (options.clockMs === null || options.clockMs === undefined
        ? null : { installationId, maxSeenAtMs: options.clockMs })),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        clockWrites.push({ ...create, ...update });
        return null;
      }),
    },
  };
  return { client: client as unknown as EntitlementDatabase, uses, bindingWrites, clockWrites };
}

const rede = (input: Parameters<typeof redeemAutomationEntitlementTicket>[0]) =>
  redeemAutomationEntitlementTicket({ nowMs: async () => VALID_MS, ...input });

describe('automation entitlement tickets', () => {
  it('verifies a bound Ed25519 session ticket inside its short online window', () => {
    const { pair, keyring } = fixture();
    const checked = inspectAutomationEntitlementTicket(token(pair.privateKey), keyring, { action: 'session', localAccountUuid });
    expect(checked).toMatchObject({ ok: true });
    if (checked.ok) expect(checked.claims).toMatchObject({ capability: 'automation', officialSubject: subject, installationId, localAccountUuid, revocationVersion: 4 });
  });

  it('rejects tampering, an unknown installation, and a foreign issuer', () => {
    const { pair, keyring } = fixture();
    const [body, signature] = token(pair.privateKey).split('.');
    const changed = `${body!.slice(0, -1)}${body!.endsWith('A') ? 'B' : 'A'}.${signature}`;
    expect(inspectAutomationEntitlementTicket(changed, keyring, { action: 'session', localAccountUuid }).ok).toBe(false);
    const foreign = inspectAutomationEntitlementTicket(
      token(pair.privateKey, { installationId: '44444444-4444-4444-8444-444444444444' }), keyring,
      { action: 'session', localAccountUuid },
    );
    expect(foreign).toMatchObject({ ok: false, code: 'AUTOMATION_TICKET_INVALID' });
    const foreignIssuer = inspectAutomationEntitlementTicket(
      token(pair.privateKey, { issuer: 'https://someone.else/entitlements' }), keyring, { action: 'session', localAccountUuid },
    );
    expect(foreignIssuer).toMatchObject({ ok: false, code: 'AUTOMATION_TICKET_INVALID' });
  });

  it('refuses a ticket whose action or scope is not this operation', () => {
    const { pair, keyring } = fixture();
    const enable = token(pair.privateKey, { action: 'rule-enable', ruleId, nonce });
    expect(inspectAutomationEntitlementTicket(enable, keyring, { action: 'rule-enable', ruleId }).ok).toBe(true);
    // 另一条规则 / 另一个事件 / 另一个动作，都不能复用同一枚票据。
    expect(inspectAutomationEntitlementTicket(enable, keyring, { action: 'rule-enable', ruleId: otherRuleId }))
      .toMatchObject({ ok: false, code: 'AUTOMATION_TICKET_SCOPE_MISMATCH' });
    expect(inspectAutomationEntitlementTicket(enable, keyring, { action: 'commit-permit', eventId }))
      .toMatchObject({ ok: false, code: 'AUTOMATION_TICKET_SCOPE_MISMATCH' });
    expect(inspectAutomationEntitlementTicket(enable, keyring, { action: 'session', localAccountUuid }))
      .toMatchObject({ ok: false, code: 'AUTOMATION_TICKET_SCOPE_MISMATCH' });
  });

  it('cannot be signed with an action and a scope that contradict each other', () => {
    const { pair } = fixture();
    expect(() => signAutomationEntitlementTicket(baseClaims({ action: 'session', ruleId }), pair.privateKey)).toThrow();
    expect(() => signAutomationEntitlementTicket(baseClaims({ action: 'commit-permit' }), pair.privateKey)).toThrow();
    expect(() => signAutomationEntitlementTicket(baseClaims({ action: 'commit-permit', eventId, ruleId }), pair.privateKey)).toThrow();
    expect(() => signAutomationEntitlementTicket(baseClaims({ action: 'ai-reserve', eventId }), pair.privateKey)).not.toThrow();
  });

  it('does not allow a ticket longer than the 30 second online window', () => {
    const { pair } = fixture();
    expect(() => token(pair.privateKey, { expiresAt: 1_031 })).toThrow();
  });

  it('rejects a ticket below the deployment revocation floor', () => {
    const { pair, keyring } = fixture();
    const revoked: AutomationEntitlementKeyring = { ...keyring, minRevocationVersion: 5 };
    expect(inspectAutomationEntitlementTicket(token(pair.privateKey, { revocationVersion: 4 }), revoked, { action: 'session', localAccountUuid }))
      .toMatchObject({ ok: false, code: 'AUTOMATION_REVOCATION_STALE' });
    expect(inspectAutomationEntitlementTicket(token(pair.privateKey, { revocationVersion: 5 }), revoked, { action: 'session', localAccountUuid }).ok).toBe(true);
  });

  it('without an official keyring it refuses instead of falling back to free', () => {
    const { pair } = fixture();
    expect(inspectAutomationEntitlementTicket(token(pair.privateKey), undefined, { action: 'session', localAccountUuid }))
      .toMatchObject({ ok: false, code: 'AUTOMATION_ISSUER_NOT_CONFIGURED' });
  });

  it('consumes a nonce exactly once, so one ticket cannot authorize two operations', async () => {
    const { pair, keyring } = fixture();
    const db = database();
    const claims = token(pair.privateKey);
    await rede({ client: db.client, userId: 7, action: 'session', localAccountUuid, token: claims, keyring });
    await expect(rede({ client: db.client, userId: 7, action: 'session', localAccountUuid, token: claims, keyring }))
      .rejects.toMatchObject({ code: 'AUTOMATION_TICKET_USED' });
    expect(db.uses).toHaveLength(1);
  });

  it('records which action and scope a consumed ticket authorized, and only `session` writes a binding', async () => {
    const { pair, keyring } = fixture();
    const db = database({ binding: { officialSubject: subject, installationId, localAccountUuid, issuer: keyring.issuer, keyId: 'k1', revocationVersion: 4, expiresAt: new Date(VALID_MS + 20_000) } });
    await rede({ client: db.client, userId: 7, action: 'commit-permit', eventId, token: token(pair.privateKey, { action: 'commit-permit', eventId }), keyring });
    expect(db.uses[0]).toMatchObject({ action: 'commit-permit', eventId, ruleId: null, installationId, userId: 7 });
    expect(db.bindingWrites).toHaveLength(0);
    expect(db.clockWrites).toHaveLength(1);

    const session = database({ binding: null });
    await rede({ client: session.client, userId: 7, action: 'session', localAccountUuid, token: token(pair.privateKey), keyring });
    expect(session.bindingWrites[0]).toMatchObject({ localAccountUuid, revocationVersion: 4 });
  });

  it('judges expiry after the account lock, with the database clock, not the request clock', async () => {
    const { pair, keyring } = fixture();
    const db = database();
    // 离线那一步在真时钟（1005 秒）下通过；锁后读到的数据库时钟已经是 1021 秒。
    let locked = false;
    (db.client.$queryRaw as ReturnType<typeof vi.fn>).mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('FOR UPDATE')) { locked = true; return []; }
      if (sql.includes('clock_timestamp')) return [{ nowMs: 1_021_000n }];
      return [];
    });
    // 不给 nowMs 注入：这一条测的就是生产路径只能信数据库时钟。
    await expect(redeemAutomationEntitlementTicket({ client: db.client, userId: 7, action: 'session', localAccountUuid, token: token(pair.privateKey), keyring }))
      .rejects.toMatchObject({ code: 'AUTOMATION_TICKET_EXPIRED' });
    expect(locked).toBe(true);
    expect(db.uses).toHaveLength(0);
    expect(db.bindingWrites).toHaveLength(0);
  });

  it('stops authorizing when the installation clock rolls backwards', async () => {
    const { pair, keyring } = fixture();
    const db = database({ clockMs: 1_010_000n });
    await expect(rede({ client: db.client, userId: 7, action: 'worker-register', token: token(pair.privateKey, { action: 'worker-register' }), keyring }))
      .rejects.toMatchObject({ code: 'AUTOMATION_CLOCK_ROLLBACK' });
    expect(db.uses).toHaveLength(0);
  });

  it('refuses to bind a ticket that belongs to another subject, account, or stale revocation version', async () => {
    const { pair, keyring } = fixture();
    const bound = database({ binding: { officialSubject: subject, installationId, localAccountUuid, issuer: keyring.issuer, keyId: 'k1', revocationVersion: 6, expiresAt: new Date(VALID_MS + 20_000) } });
    await expect(rede({ client: bound.client, userId: 7, action: 'session', localAccountUuid, token: token(pair.privateKey, { officialSubject: 'acct-other' }), keyring }))
      .rejects.toMatchObject({ code: 'AUTOMATION_SUBJECT_CONFLICT' });
    // 持票人拿自己账号的票据去绑**另一个**本地账号：请求侧声明与票据不符即拒。
    await expect(rede({ client: bound.client, userId: 7, action: 'session', localAccountUuid: '66666666-6666-4666-8666-666666666666',
      token: token(pair.privateKey), keyring }))
      .rejects.toMatchObject({ code: 'AUTOMATION_LOCAL_ACCOUNT_MISMATCH' });
    await expect(rede({ client: bound.client, userId: 7, action: 'session', localAccountUuid, token: token(pair.privateKey), keyring }))
      .rejects.toMatchObject({ code: 'AUTOMATION_REVOCATION_STALE' });
    expect(bound.uses).toHaveLength(0);
  });

  it('requires the local account on `session` so a ticket cannot be bound to an arbitrary account', async () => {
    const { pair, keyring } = fixture();
    const db = database();
    await expect(rede({ client: db.client, userId: 7, action: 'session', token: token(pair.privateKey), keyring }))
      .rejects.toMatchObject({ code: 'AUTOMATION_LOCAL_ACCOUNT_MISMATCH' });
    await expect(rede({ client: database().client, userId: 7, action: 'session', localAccountUuid: 'not-a-uuid', token: token(pair.privateKey), keyring }))
      .rejects.toThrow(AutomationEntitlementError);
  });

  describe('binding usability', () => {
    const binding = { officialSubject: subject, installationId, localAccountUuid, issuer: 'https://official.example/entitlements',
      keyId: 'k1', revocationVersion: 4, expiresAt: new Date(2_000) };
    it('expires', () => {
      const { keyring } = fixture();
      expect(isAutomationEntitlementBindingUsable(binding, keyring, 1_999)).toBe(true);
      expect(isAutomationEntitlementBindingUsable(binding, keyring, 2_000)).toBe(false);
      expect(isAutomationEntitlementBindingUsable(null, keyring, 1_000)).toBe(false);
    });
    it('is voided when the deployment switches issuer or installation', () => {
      const { keyring } = fixture();
      expect(isAutomationEntitlementBindingUsable(binding, { ...keyring, instanceId: '99999999-9999-4999-8999-999999999999' }, 1_000)).toBe(false);
      expect(isAutomationEntitlementBindingUsable(binding, { ...keyring, issuer: 'https://other/' }, 1_000)).toBe(false);
      expect(isAutomationEntitlementBindingUsable(binding, undefined, 1_000)).toBe(false);
    });
    it('is voided when the operator raises the revocation floor', () => {
      const { keyring } = fixture();
      expect(isAutomationEntitlementBindingUsable(binding, { ...keyring, minRevocationVersion: 5 }, 1_000)).toBe(false);
      expect(isAutomationEntitlementBindingUsable({ ...binding, revocationVersion: 5 }, { ...keyring, minRevocationVersion: 5 }, 1_000)).toBe(true);
    });
  });
});

describe('automation entitlement deployment modes', () => {
  beforeEach(() => { delete process.env.AUTOMATION_ENTITLEMENT_MODE; });

  it('refuses to guess: unset mode denies, a bad value fails loudly', async () => {
    const { evaluateAutomationEntitlementForUser, resolveAutomationEntitlementMode } = await import('../src/entitlement');
    expect(resolveAutomationEntitlementMode()).toBeUndefined();
    expect(resolveAutomationEntitlementMode('OFFICIAL')).toBe('official');
    expect(() => resolveAutomationEntitlementMode('hosted')).toThrow(/Invalid AUTOMATION_ENTITLEMENT_MODE/);
    expect(await evaluateAutomationEntitlementForUser({ userId: 7, source: { readSubscriptions: async () => [{ status: 'active', grants: ['automation'], currentPeriodEnd: 9e12 }], readBinding: async () => null } }))
      .toMatchObject({ allowed: false, reason: 'ENTITLEMENT_MODE_UNCONFIGURED' });
  });

  it('self-hosted online mode does not let a local subscription grant automation', async () => {
    const { evaluateAutomationEntitlementForUser } = await import('../src/entitlement');
    const { keyring } = fixture();
    const decision = await evaluateAutomationEntitlementForUser({
      userId: 7, mode: 'selfhost-online', keyring, now: 1_000,
      source: { readSubscriptions: async () => [{ status: 'active', grants: ['automation'], currentPeriodEnd: 9e12 }], readBinding: async () => null },
    });
    expect(decision).toMatchObject({ allowed: false, reason: 'NO_BINDING' });
  });

  it('self-hosted online mode requires a keyring and honors deployment switches', async () => {
    const { evaluateAutomationEntitlementForUser } = await import('../src/entitlement');
    const { keyring } = fixture();
    const binding = { officialSubject: subject, installationId, localAccountUuid, issuer: keyring.issuer, keyId: 'k1', revocationVersion: 4, expiresAt: new Date(2_000) };
    const source = { readSubscriptions: async () => [], readBinding: async () => binding as never };
    expect(await evaluateAutomationEntitlementForUser({ userId: 7, mode: 'selfhost-online', now: 1_000, source, keyring }))
      .toMatchObject({ allowed: true });
    expect(await evaluateAutomationEntitlementForUser({ userId: 7, mode: 'selfhost-online', now: 1_000, source, keyring: undefined }))
      .toMatchObject({ allowed: false, reason: 'ISSUER_NOT_CONFIGURED' });
    expect(await evaluateAutomationEntitlementForUser({ userId: 7, mode: 'selfhost-online', now: 1_000, source,
      keyring: { ...keyring, instanceId: '99999999-9999-4999-8999-999999999999' } }))
      .toMatchObject({ allowed: false, reason: 'DEPLOYMENT_MISMATCH' });
    expect(await evaluateAutomationEntitlementForUser({ userId: 7, mode: 'selfhost-online', now: 3_000, source, keyring }))
      .toMatchObject({ allowed: false, reason: 'BINDING_EXPIRED' });
  });

  it('an operation in self-hosted mode must bring its own ticket', async () => {
    const { authorizeAutomationOperation } = await import('../src/entitlement');
    const { keyring } = fixture();
    expect(await authorizeAutomationOperation({ client: database().client, userId: 7, action: 'commit-permit', eventId,
      mode: 'selfhost-online', keyring })).toMatchObject({ allowed: false, reason: 'ENTITLEMENT_TICKET_REQUIRED' });
  });
});
