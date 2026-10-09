import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTOMATION_ISSUER_DENIALS,
  AutomationIssuerError,
  applyAutomationRevocationManifest,
  bumpAutomationRevocationFloor,
  automationActivationCodeHash,
  ensureAutomationEntitlementSubject,
  inspectAutomationRevocationManifest,
  issueAutomationEntitlementActivation,
  loadEffectiveAutomationKeyring,
  readAutomationRevocationFloor,
  redeemAutomationEntitlementActivation,
  revokeAutomationEntitlementLink,
  signAutomationEntitlementActionTicket,
  signAutomationEntitlementSessionTicket,
  signAutomationRevocationManifest,
  type AutomationEntitlementIssuer,
  type IssuerDatabase,
} from '../src/automation/entitlement-issuer';
import {
  AUTOMATION_ENTITLEMENT_DENIALS,
  AUTOMATION_ENTITLEMENT_SCOPES,
  inspectAutomationEntitlementTicket,
  type AutomationEntitlementAction,
  type AutomationEntitlementKeyring,
} from '../src/automation/entitlement-ticket';
import { evaluateAutomationEntitlementForUser, type AutomationEntitlementSource } from '../src/entitlement';

const installationId = '11111111-1111-4111-8111-111111111111';
const otherInstallation = '99999999-9999-4999-8999-999999999999';
const localAccount = '22222222-2222-4222-8222-222222222222';
const otherLocalAccount = '33333333-3333-4333-8333-333333333333';
const ruleId = '44444444-4444-4444-8444-444444444444';
const otherRule = '55555555-5555-4555-8555-555555555555';
const eventId = 'evt_01ABCdef-9:_x';
const ISSUER = 'https://official.example/entitlements';

function keys() {
  const pair = generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  const rawSeed = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64url');
  const issuer: AutomationEntitlementIssuer = { issuer: ISSUER, keyId: 'k1', privateKeySeed: rawSeed };
  const keyring: AutomationEntitlementKeyring = {
    issuer: ISSUER, instanceId: installationId, keys: { k1: der.subarray(-32).toString('base64url') },
  };
  return { issuer, keyring };
}

/**
 * 四张签发端表用一个 Map 版替身，**被判定的是产品代码本身**：这里没有任何
 * "让判定通过"的桩，只有行的存取。真库那一层在
 * `tests/integration/inbound-worker-identity.integration.spec.ts` 里跑。
 */
function database(seed: { links?: Record<string, unknown>[]; revocation?: { revocationVersion: number } } = {}) {
  const subjects = new Map<number, Record<string, unknown>>();
  const activations = new Map<string, Record<string, unknown>>();
  // Prisma 对"没设置的可空列"回的是 `null`，替身必须回同一个形状：留着 `undefined`
  // 会让"已撤销"这一判定在替身上永远不成立，而真库里成立。
  const linkRow = (row: Record<string, unknown>): Record<string, unknown> => ({ revokedAt: null, ...row });
  const links = new Map<string, Record<string, unknown>>();
  let revocation: Record<string, unknown> | null = seed.revocation ? { scope: 'global', ...seed.revocation } : null;
  const compound = (userId: number, inst: string) => `${userId}:${inst}`;
  for (const row of seed.links ?? []) links.set(String(row.installationId), linkRow(row));

  const client = {
    automationEntitlementSubject: {
      findUnique: async ({ where }: { where: { userId: number } }) => subjects.get(where.userId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (subjects.has(data.userId as number)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { ...data, createdAt: new Date() };
        subjects.set(data.userId as number, row);
        return row;
      },
    },
    automationEntitlementActivation: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        const byHash = where.codeHash as string | undefined;
        if (byHash !== undefined) return [...activations.values()].find((row) => row.codeHash === byHash) ?? null;
        const c = where.userId_installationId as { userId: number; installationId: string };
        return activations.get(compound(c.userId, c.installationId)) ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        // 显式标注而不是让 TS 去推：`{ ...Record<string, unknown>, createdAt }` 推出来只剩
        // `{ createdAt: Date }`，下面那两枚属性读会成类型错（运行时没事，因为测试文件不参与类型检查）。
        const row: Record<string, unknown> & { createdAt: Date } = { ...data, createdAt: new Date() };
        activations.set(compound(row.userId as number, String(row.installationId)), row);
        return row;
      },
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const c = where.userId_installationId as { userId: number; installationId: string };
        const current = activations.get(compound(c.userId, c.installationId))!;
        const next = { ...current, ...data, resendCount: (current.resendCount as number) + ((data.resendCount as { increment: number })?.increment ?? 0) };
        activations.set(compound(c.userId, c.installationId), next);
        return next;
      },
      delete: async ({ where }: { where: Record<string, unknown> }) => {
        const c = where.userId_installationId as { userId: number; installationId: string };
        activations.delete(compound(c.userId, c.installationId));
        return { count: 1 };
      },
    },
    automationEntitlementLink: {
      findUnique: async ({ where }: { where: { installationId: string } }) => links.get(where.installationId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = linkRow(data);
        links.set(String(row.installationId), row);
        return row;
      },
      update: async ({ where, data }: { where: { installationId: string }; data: Record<string, unknown> }) => {
        const row = { ...links.get(where.installationId)!, ...data };
        links.set(where.installationId, row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = links.get(String(where.installationId));
        if (!row || row.userId !== where.userId || row.revokedAt !== null) return { count: 0 };
        links.set(String(where.installationId), { ...row, ...data });
        return { count: 1 };
      },
    },
    automationEntitlementRevocation: {
      findUnique: async () => revocation,
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        revocation = revocation ? { ...revocation, ...update } : { ...create };
        return revocation;
      },
    },
  };
  const typed = client as unknown as IssuerDatabase;
  return { client: typed, links, activations, subjects, readRevocation: () => revocation };
}

const denial = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof AutomationIssuerError) return error.code;
    throw error;
  }
  throw new Error('期望被拒绝，但它通过了');
};

describe('自动收集权益签发端', () => {
  let db: ReturnType<typeof database>;
  let issuerConfig: AutomationEntitlementIssuer;
  let keyring: AutomationEntitlementKeyring;

  beforeEach(() => {
    db = database();
    const pair = keys();
    issuerConfig = pair.issuer;
    keyring = pair.keyring;
  });

  it('一个账号的稳定主体只生成一次', async () => {
    const first = await ensureAutomationEntitlementSubject(db.client, 7);
    const second = await ensureAutomationEntitlementSubject(db.client, 7);
    expect(second.subject).toBe(first.subject);
    expect(first.subject).toMatch(/^htsub_[0-9a-f]{32}$/);
    expect(await ensureAutomationEntitlementSubject(db.client, 8)).not.toMatchObject(first);
  });

  it('激活码明文只在签发响应里出现，库里存的是它的哈希', async () => {
    const issued = await issueAutomationEntitlementActivation({ client: db.client, userId: 7, installationId, now: new Date(1_000) });
    expect(issued.code.length).toBeGreaterThanOrEqual(20);
    expect(issued.code).not.toContain(issued.subject);
    const stored = [...db.activations.values()][0]!;
    expect(Object.values(stored)).not.toContain(issued.code);
    expect(stored.codeHash).toBe(automationActivationCodeHash(issued.code));
    expect(stored.expiresAt).toEqual(new Date(1_000 + 15 * 60 * 1000));
  });

  it('重发节流：一分钟内的第二次直接被拒', async () => {
    await issueAutomationEntitlementActivation({ client: db.client, userId: 7, installationId, now: new Date(0) });
    expect(await denial(() => issueAutomationEntitlementActivation({ client: db.client, userId: 7, installationId, now: new Date(30_000) })))
      .toBe(AUTOMATION_ISSUER_DENIALS.ACTIVATION_RATE_LIMITED);
    const second = await issueAutomationEntitlementActivation({ client: db.client, userId: 7, installationId, now: new Date(61_000) });
    expect([...db.activations.values()][0]!.resendCount).toBe(1);
    expect(second.code.length).toBeGreaterThanOrEqual(20);
  });

  it('错实例：给 A 发的码不能在 B 上兑换', async () => {
    const issued = await issueAutomationEntitlementActivation({ client: db.client, userId: 7, installationId, now: new Date(0) });
    expect(await denial(() => redeemAutomationEntitlementActivation({
      client: db.client, userId: 7, code: issued.code, installationId: otherInstallation, localAccountUuid: localAccount, now: new Date(1_000),
    }))).toBe(AUTOMATION_ISSUER_DENIALS.ACTIVATION_INVALID);
    // 拒绝不消耗码：给它的那台实例仍然能兑换。
    const link = await redeemAutomationEntitlementActivation({
      client: db.client, userId: 7, code: issued.code, installationId, localAccountUuid: localAccount, now: new Date(1_000),
    });
    expect(link.installationId).toBe(installationId);
  });

  it('错主体：这台实例已绑给别人的账号，一枚新码顶不掉', async () => {
    const issued = await issueAutomationEntitlementActivation({ client: db.client, userId: 7, installationId, now: new Date(0) });
    await redeemAutomationEntitlementActivation({ client: db.client, userId: 7, code: issued.code, installationId, localAccountUuid: localAccount, now: new Date(1) });
    const other = await issueAutomationEntitlementActivation({ client: db.client, userId: 8, installationId, now: new Date(2) });
    expect(await denial(() => redeemAutomationEntitlementActivation({
      client: db.client, userId: 8, code: other.code, installationId, localAccountUuid: otherLocalAccount, now: new Date(3),
    }))).toBe(AUTOMATION_ISSUER_DENIALS.LINK_CONFLICT);
    expect(db.links.get(installationId)).toMatchObject({ userId: 7, localAccountUuid: localAccount });
  });

  it('一次性：兑换成功后活码行消失，同一枚码不能再兑换', async () => {
    const issued = await issueAutomationEntitlementActivation({ client: db.client, userId: 7, installationId, now: new Date(0) });
    await redeemAutomationEntitlementActivation({ client: db.client, userId: 7, code: issued.code, installationId, localAccountUuid: localAccount, now: new Date(1) });
    expect(db.activations.size).toBe(0);
    expect(await denial(() => redeemAutomationEntitlementActivation({
      client: db.client, userId: 7, code: issued.code, installationId, localAccountUuid: localAccount, now: new Date(2),
    }))).toBe(AUTOMATION_ISSUER_DENIALS.ACTIVATION_INVALID);
  });

  it('过期与别人的码都算无效，且都不写绑定', async () => {
    const issued = await issueAutomationEntitlementActivation({ client: db.client, userId: 7, installationId, now: new Date(0) });
    expect(await denial(() => redeemAutomationEntitlementActivation({
      client: db.client, userId: 7, code: issued.code, installationId, localAccountUuid: localAccount, now: new Date(16 * 60 * 1000),
    }))).toBe(AUTOMATION_ISSUER_DENIALS.ACTIVATION_INVALID);
    expect(await denial(() => redeemAutomationEntitlementActivation({
      client: db.client, userId: 8, code: issued.code, installationId, localAccountUuid: localAccount, now: new Date(1_000),
    }))).toBe(AUTOMATION_ISSUER_DENIALS.ACTIVATION_INVALID);
    expect(db.links.size).toBe(0);
  });

  it('签出的 session 票据三个绑定字段全部来自绑定行，撤销后不再签', async () => {
    const issued = await issueAutomationEntitlementActivation({ client: db.client, userId: 7, installationId, now: new Date(0) });
    const subject = issued.subject;
    await redeemAutomationEntitlementActivation({ client: db.client, userId: 7, code: issued.code, installationId, localAccountUuid: localAccount, now: new Date(1) });
    const signed = await signAutomationEntitlementSessionTicket({
      client: db.client, userId: 7, installationId, issuer: issuerConfig, revocationVersion: 4, now: 1_000_000,
    });
    const claims = JSON.parse(Buffer.from(signed.token.split('.')[0]!, 'base64url').toString('utf8'));
    expect(claims).toMatchObject({ action: 'session', capability: 'automation', issuer: ISSUER, keyId: 'k1', officialSubject: subject, installationId, localAccountUuid: localAccount, revocationVersion: 4 });
    expect(claims.expiresAt - claims.issuedAt).toBe(30);

    expect(await denial(() => signAutomationEntitlementSessionTicket({ client: db.client, userId: 8, installationId, issuer: issuerConfig, revocationVersion: 4, now: 1_000_000 })))
      .toBe(AUTOMATION_ISSUER_DENIALS.SUBJECT_MISMATCH);
    expect(await revokeAutomationEntitlementLink({ client: db.client, userId: 7, installationId, now: new Date(5) })).toBe(true);
    expect(await denial(() => signAutomationEntitlementSessionTicket({ client: db.client, userId: 7, installationId, issuer: issuerConfig, revocationVersion: 4, now: 1_000_000 })))
      .toBe(AUTOMATION_ISSUER_DENIALS.LINK_NOT_BOUND);
    // 撤销是置时间戳，不是删行：换绑历史留得住。
    expect(db.links.get(installationId)).toMatchObject({ revokedAt: new Date(5) });
  });

  it('吊销清单：验签只认本部署配置的公钥，合并只升不降', async () => {
    const manifest = signAutomationRevocationManifest({ issuer: issuerConfig, revocationVersion: 6, now: 1_000_000 });
    expect(inspectAutomationRevocationManifest(manifest, keyring)).toMatchObject({ ok: true, claims: { revocationVersion: 6, scope: 'global' } });
    const stranger = keys();
    expect(inspectAutomationRevocationManifest(signAutomationRevocationManifest({ issuer: stranger.issuer, revocationVersion: 6, now: 1_000_000 }), keyring))
      .toMatchObject({ ok: false, code: AUTOMATION_ISSUER_DENIALS.MANIFEST_INVALID });
    expect(inspectAutomationRevocationManifest(`${manifest.slice(0, -4)}AAAA`, keyring))
      .toMatchObject({ ok: false, code: AUTOMATION_ISSUER_DENIALS.MANIFEST_INVALID });
    expect(inspectAutomationRevocationManifest(manifest, undefined))
      .toMatchObject({ ok: false, code: AUTOMATION_ISSUER_DENIALS.ISSUER_NOT_CONFIGURED });

    const applied = await applyAutomationRevocationManifest({ client: db.client, manifest, keyring, now: 1_000_000 });
    expect(applied).toEqual({ revocationVersion: 6, refreshed: true });
    const stale = await applyAutomationRevocationManifest({
      client: db.client, manifest: signAutomationRevocationManifest({ issuer: issuerConfig, revocationVersion: 3, now: 1_000_000 }), keyring, now: 1_000_000,
    });
    expect(stale).toEqual({ revocationVersion: 6, refreshed: false });
    expect(db.readRevocation()).toMatchObject({ revocationVersion: 6, manifestKeyId: 'k1' });
  });

  it('运营者抬下限：只许升，降回去被拒', async () => {
    expect(await bumpAutomationRevocationFloor({ client: db.client, revocationVersion: 5 })).toBe(5);
    expect(await readAutomationRevocationFloor(db.client)).toBe(5);
    expect(await denial(() => bumpAutomationRevocationFloor({ client: db.client, revocationVersion: 5 })))
      .toBe(AUTOMATION_ISSUER_DENIALS.REVOCATION_NOT_INCREASING);
    expect(await denial(() => bumpAutomationRevocationFloor({ client: db.client, revocationVersion: 4 })))
      .toBe(AUTOMATION_ISSUER_DENIALS.REVOCATION_NOT_INCREASING);
  });

  it('判定用的下限 = 手配与在线刷新里较大的那一个', async () => {
    const withEnv = { ...keyring, minRevocationVersion: 2 };
    expect(await loadEffectiveAutomationKeyring(db.client, withEnv)).toMatchObject({ minRevocationVersion: 2 });
    await applyAutomationRevocationManifest({ client: db.client, manifest: signAutomationRevocationManifest({ issuer: issuerConfig, revocationVersion: 9, now: 1_000_000 }), keyring: withEnv, now: 1_000_000 });
    expect(await loadEffectiveAutomationKeyring(db.client, withEnv)).toMatchObject({ minRevocationVersion: 9 });
    // 手配比库里高时不被"刷新"降下去。
    expect(await loadEffectiveAutomationKeyring(database().client, { ...keyring, minRevocationVersion: 12 })).toMatchObject({ minRevocationVersion: 12 });
  });

  it('🔴 吊销落后一条：绑定写于下限 4，清单刷到 9 之后判定必须转拒', async () => {
    const binding = {
      officialSubject: 'acct-1', installationId, localAccountUuid: localAccount, issuer: ISSUER, keyId: 'k1',
      revocationVersion: 4, expiresAt: new Date(4_100_000),
    };
    const source = (floor: number): AutomationEntitlementSource => ({
      readSubscriptions: async () => [],
      readBinding: async () => binding,
      readRevocationFloor: async () => floor,
    });
    const base = { ...keyring, minRevocationVersion: 4 };
    expect(await evaluateAutomationEntitlementForUser({ userId: 7, mode: 'selfhost-online', now: 4_000_000, source: source(4), keyring: base }))
      .toEqual({ allowed: true });
    expect(await evaluateAutomationEntitlementForUser({ userId: 7, mode: 'selfhost-online', now: 4_000_000, source: source(9), keyring: base }))
      .toMatchObject({ allowed: false, reason: 'REVOKED_VERSION' });
  });

  describe('逐次动作票据的签发通道', () => {
    /** 取票只认绑定行：先用真握手把 `installationId` 绑到账号 7 的官方主体上。 */
    const bind = async (): Promise<string> => {
      const issued = await issueAutomationEntitlementActivation({ client: db.client, userId: 7, installationId, now: new Date(0) });
      await redeemAutomationEntitlementActivation({ client: db.client, userId: 7, code: issued.code, installationId, localAccountUuid: localAccount, now: new Date(1) });
      return issued.subject;
    };
    // `db` / `issuerConfig` 是 beforeEach 才赋值的，所以这里必须是**取一次算一次**的函数：
    // 写成常量会在用例收集期读到 undefined。
    const base = () => ({ client: db.client, userId: 7, installationId, issuer: issuerConfig, revocationVersion: 4, now: 1_000_000 });
    const claimsOf = (token: string): Record<string, unknown> =>
      JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as Record<string, unknown>;

    it('每个动作的 scope 由词表决定，签出的票据能被判定核在同一动作上认下', async () => {
      const subject = await bind();
      const actions = Object.entries(AUTOMATION_ENTITLEMENT_SCOPES).filter(([action]) => action !== 'session');
      // 分母自检：词表里除了 session 之外每一个动作都要走一遍，漏一个就是漏签一种。
      expect(actions).toHaveLength(8);
      for (const [rawAction, scope] of actions) {
        const action = rawAction as AutomationEntitlementAction;
        const scopeFields = scope === 'rule' ? { ruleId } : scope === 'event' ? { eventId } : {};
        const signed = await signAutomationEntitlementActionTicket({ ...base(), action, ...scopeFields });
        expect(signed.action).toBe(action);
        expect(signed.subject).toBe(subject);
        const inspected = inspectAutomationEntitlementTicket(signed.token, keyring, { action, ...scopeFields, localAccountUuid: localAccount });
        expect(inspected).toMatchObject({ ok: true });
        expect(claimsOf(signed.token)).toMatchObject({ action, capability: 'automation', officialSubject: subject, revocationVersion: 4 });
      }
    });

    it('session 不许走取票通道：它是唯一能写绑定的动作', async () => {
      await bind();
      expect(await denial(() => signAutomationEntitlementActionTicket({ ...base(), action: 'session' })))
        .toBe(AUTOMATION_ISSUER_DENIALS.ACTION_UNKNOWN);
    });

    it('作用域与动作不符一律不签：缺 id、多 id、串台各算一次', async () => {
      await bind();
      expect(await denial(() => signAutomationEntitlementActionTicket({ ...base(), action: 'rule-enable' })))
        .toBe(AUTOMATION_ISSUER_DENIALS.SCOPE_MISMATCH);
      expect(await denial(() => signAutomationEntitlementActionTicket({ ...base(), action: 'event-claim', ruleId })))
        .toBe(AUTOMATION_ISSUER_DENIALS.SCOPE_MISMATCH);
      expect(await denial(() => signAutomationEntitlementActionTicket({ ...base(), action: 'result-publish' })))
        .toBe(AUTOMATION_ISSUER_DENIALS.SCOPE_MISMATCH);
      expect(await denial(() => signAutomationEntitlementActionTicket({ ...base(), action: 'result-publish', ruleId, eventId })))
        .toBe(AUTOMATION_ISSUER_DENIALS.SCOPE_MISMATCH);
    });

    it('绑定字段取自绑定行而不是请求：换账号顶不掉，未绑定与已撤销都不签', async () => {
      const subject = await bind();
      const signed = await signAutomationEntitlementActionTicket({ ...base(), action: 'worker-register' });
      expect(claimsOf(signed.token)).toMatchObject({ officialSubject: subject, installationId, localAccountUuid: localAccount });
      expect((claimsOf(signed.token).expiresAt as number) - (claimsOf(signed.token).issuedAt as number)).toBe(30);
      expect(await denial(() => signAutomationEntitlementActionTicket({ ...base(), userId: 8, action: 'worker-register' })))
        .toBe(AUTOMATION_ISSUER_DENIALS.SUBJECT_MISMATCH);

      const unbound = database();
      expect(await denial(() => signAutomationEntitlementActionTicket({ ...base(), client: unbound.client, action: 'worker-register' })))
        .toBe(AUTOMATION_ISSUER_DENIALS.LINK_NOT_BOUND);
      expect(await revokeAutomationEntitlementLink({ client: db.client, userId: 7, installationId, now: new Date(5) })).toBe(true);
      expect(await denial(() => signAutomationEntitlementActionTicket({ ...base(), action: 'worker-register' })))
        .toBe(AUTOMATION_ISSUER_DENIALS.LINK_NOT_BOUND);
    });

    it('一枚票据只放行它那一个动作：换 rule、换动作都判 SCOPE_MISMATCH', async () => {
      await bind();
      const signed = await signAutomationEntitlementActionTicket({ ...base(), action: 'rule-enable', ruleId });
      expect(inspectAutomationEntitlementTicket(signed.token, keyring, { action: 'rule-enable', ruleId, localAccountUuid: localAccount }))
        .toMatchObject({ ok: true });
      expect(inspectAutomationEntitlementTicket(signed.token, keyring, { action: 'rule-enable', ruleId: otherRule, localAccountUuid: localAccount }))
        .toMatchObject({ ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_SCOPE_MISMATCH });
      expect(inspectAutomationEntitlementTicket(signed.token, keyring, { action: 'worker-register', localAccountUuid: localAccount }))
        .toMatchObject({ ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_SCOPE_MISMATCH });
    });
  });
});
