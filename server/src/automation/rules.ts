import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { INBOUND_AUTOMATION_FIELDS, type InboundAutomationField } from '@heyta/inbound-core';

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

type ScopedWebhookKey = { userId: number; secret: string };

const readWebhookKey = (keyId: string, userId?: number): string | undefined => {
  const raw = process.env.AUTOMATION_WEBHOOK_KEYS;
  if (!raw || raw.length > 8192) return undefined;
  try {
    const parsed = JSON.parse(raw) as { keys?: Record<string, unknown> };
    const value = parsed?.keys?.[keyId];
    if (value && typeof value === 'object') {
      const scoped = value as Partial<ScopedWebhookKey>;
      if (!Number.isSafeInteger(scoped.userId) || scoped.userId !== userId || typeof scoped.secret !== 'string' || !/^[0-9a-f]{64}$/.test(scoped.secret)) return undefined;
      return scoped.secret;
    }
    // Legacy single-tenant fixtures are accepted only by test processes. A
    // production process must use account-scoped key material.
    if (process.env.NODE_ENV === 'test' && typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) return value;
    return undefined;
  } catch { return undefined; }
};

const hasConfiguredWebhookKey = (keyId: string, userId?: number): boolean => readWebhookKey(keyId, userId) !== undefined;

export interface AutomationRuleSummary {
  id: string;
  version: number;
  enabled: boolean;
  keyId: string;
  createdAt: string;
  deletedAt: string | null;
  allowedFields: readonly InboundAutomationField[];
  targetProjectId: string | null;
  timezone: string | null;
  parseVersion: number;
  authorizationVersion: number;
  maxItems: number;
}

export interface AutomationRuleConfig {
  allowedFields?: readonly InboundAutomationField[];
  targetProjectId?: string | null;
  timezone?: string | null;
  parseVersion?: number;
  maxItems?: number;
}

const normalizeConfig = (config: AutomationRuleConfig = {}) => {
  const fields = config.allowedFields === undefined ? ['title'] as const : [...new Set(config.allowedFields)];
  if (fields.length === 0 || fields.some((field) => !(INBOUND_AUTOMATION_FIELDS as readonly string[]).includes(field))) {
    throw new Error('Invalid automation field policy');
  }
  const parseVersion = config.parseVersion ?? 1;
  const maxItems = config.maxItems ?? 50;
  if (!Number.isInteger(parseVersion) || parseVersion < 1 || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 50) {
    throw new Error('Invalid automation rule limits');
  }
  const timezone = config.timezone ?? null;
  if (timezone !== null) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); }
    catch { throw new Error('Invalid automation timezone'); }
  }
  const targetProjectId = config.targetProjectId ?? null;
  if (targetProjectId !== null && (typeof targetProjectId !== 'string' || targetProjectId.length > 128)) throw new Error('Invalid automation target');
  return { allowedFields: fields, targetProjectId, timezone, parseVersion, maxItems };
};

/** Load one 32-byte webhook secret without ever exposing the keyring in logs. */
export const loadAutomationWebhookSecret = (keyId: string, userId?: number): Uint8Array | undefined => {
  if (!KEY_ID.test(keyId)) return undefined;
  const value = readWebhookKey(keyId, userId);
  return value === undefined ? undefined : Uint8Array.from(Buffer.from(value, 'hex'));
};

const toSummary = (row: {
  id: string; version: number; enabled: boolean; keyId: string; createdAt: Date; deletedAt: bigint | null;
  allowedFields: unknown; targetProjectId: string | null; timezone: string | null;
  parseVersion: number; authorizationVersion: number; maxItems: number;
}): AutomationRuleSummary => ({
  id: row.id, version: row.version, enabled: row.enabled, keyId: row.keyId,
  createdAt: row.createdAt.toISOString(), deletedAt: row.deletedAt === null ? null : row.deletedAt.toString(),
  allowedFields: Array.isArray(row.allowedFields) && row.allowedFields.every((field): field is InboundAutomationField =>
    typeof field === 'string' && (INBOUND_AUTOMATION_FIELDS as readonly string[]).includes(field))
    ? row.allowedFields : ['title'],
  targetProjectId: row.targetProjectId ?? null, timezone: row.timezone ?? null,
  parseVersion: row.parseVersion ?? 1, authorizationVersion: row.authorizationVersion ?? 1,
  maxItems: row.maxItems ?? 50,
});

export async function createAutomationRule(userId: number, keyId: string, config: AutomationRuleConfig = {}): Promise<AutomationRuleSummary> {
  if (!Number.isSafeInteger(userId) || userId < 1 || !KEY_ID.test(keyId)) throw new Error('Invalid automation rule');
  const normalized = normalizeConfig(config);
  const row = await prisma.automationRule.create({ data: { id: randomUUID(), userId, keyId,
    allowedFields: normalized.allowedFields, targetProjectId: normalized.targetProjectId,
    timezone: normalized.timezone, parseVersion: normalized.parseVersion, maxItems: normalized.maxItems } });
  return toSummary(row);
}

export async function updateAutomationRuleConfig(userId: number, ruleId: string, config: AutomationRuleConfig): Promise<AutomationRuleSummary> {
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[0-9a-f-]{36}$/.test(ruleId)) throw new Error('Invalid automation rule');
  const normalized = normalizeConfig(config);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.automationRule.findFirst({ where: { id: ruleId, userId, deletedAt: null } });
    if (!current) throw new Error('Automation rule not found');
    const row = await tx.automationRule.update({ where: { id: ruleId }, data: {
      enabled: false, version: { increment: 1 }, authorizationVersion: { increment: 1 },
      allowedFields: normalized.allowedFields, targetProjectId: normalized.targetProjectId,
      timezone: normalized.timezone, parseVersion: normalized.parseVersion, maxItems: normalized.maxItems,
    } });
    return toSummary(row);
  });
}

export async function listAutomationRules(userId: number): Promise<AutomationRuleSummary[]> {
  const rows = await prisma.automationRule.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  return rows.map(toSummary);
}

export async function setAutomationRuleEnabled(userId: number, ruleId: string, enabled: boolean): Promise<AutomationRuleSummary> {
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[0-9a-f-]{36}$/.test(ruleId)) throw new Error('Invalid automation rule');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.automationRule.findFirst({ where: { id: ruleId, userId, deletedAt: null } });
    if (!current) throw new Error('Automation rule not found');
    if (enabled) {
      const managed = await tx.automationSenderCredential.findFirst({ where: { userId, ruleId: current.id, keyId: current.keyId, revokedAt: null }, select: { id: true } });
      if (!managed && !hasConfiguredWebhookKey(current.keyId, userId)) throw new Error('Automation webhook key is not configured');
    }
    const row = await tx.automationRule.update({ where: { id: current.id }, data: { enabled, version: { increment: 1 } } });
    return toSummary(row);
  });
}

/** Deletion is a tombstone: the UUID row remains and can never be reused. */
export async function deleteAutomationRule(userId: number, ruleId: string): Promise<AutomationRuleSummary> {
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[0-9a-f-]{36}$/.test(ruleId)) throw new Error('Invalid automation rule');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.automationRule.findFirst({ where: { id: ruleId, userId } });
    if (!current) throw new Error('Automation rule not found');
    if (current.deletedAt !== null) return toSummary(current);
    const row = await tx.automationRule.update({ where: { id: current.id }, data: { enabled: false, deletedAt: BigInt(Date.now()), version: { increment: 1 } } });
    // The owner journals a signed receipt BEFORE any local commit. That receipt
    // authorizes a late upload without retaining rule/event digests server-side.
    // Keep only the rule tombstone so its identity can never be reused.
    await tx.automationAiAttempt.deleteMany({ where: { userId, ruleId } });
    await tx.automationCommitPermit.deleteMany({ where: { userId, ruleId } });
    await tx.automationEvent.deleteMany({ where: { userId, ruleId } });
    await tx.automationSenderCredential.deleteMany({ where: { userId, ruleId } });
    return toSummary(row);
  });
}

/** Seven-day ciphertext retention sweep; the event ledger itself is retained. */
export async function purgeExpiredAutomationEvents(now = new Date()): Promise<number> {
  // One statement serializes with an upload's completion update. Erasing
  // ciphertext must never turn a completed/cancelled event into a failed one.
  return prisma.$executeRaw`
    UPDATE automation_events
    SET payload_ciphertext = NULL, result_ciphertext = NULL,
      status = CASE WHEN status IN ('queued', 'received', 'leased', 'prepared', 'needs-confirmation') THEN 'expired' ELSE status END,
      reason_code = CASE WHEN status IN ('queued', 'received', 'leased', 'prepared', 'needs-confirmation') THEN 'retention-expired' ELSE reason_code END,
      lease_worker_id = NULL, lease_expires_at = NULL
    WHERE expires_at <= ${now} AND (payload_ciphertext IS NOT NULL OR result_ciphertext IS NOT NULL)
  `;
}
