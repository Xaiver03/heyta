import { randomUUID } from 'node:crypto';
import { prisma } from '../db';

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

const hasConfiguredWebhookKey = (keyId: string): boolean => {
  const raw = process.env.AUTOMATION_WEBHOOK_KEYS;
  if (!raw || raw.length > 8192) return false;
  try {
    const parsed = JSON.parse(raw) as { keys?: Record<string, unknown> };
    return parsed !== null && typeof parsed === 'object' && parsed.keys !== undefined &&
      typeof parsed.keys === 'object' && parsed.keys !== null &&
      /^[0-9a-f]{64}$/.test(String((parsed.keys as Record<string, unknown>)[keyId] ?? ''));
  } catch { return false; }
};

export interface AutomationRuleSummary {
  id: string;
  version: number;
  enabled: boolean;
  keyId: string;
  createdAt: string;
  deletedAt: string | null;
}

const toSummary = (row: {
  id: string; version: number; enabled: boolean; keyId: string; createdAt: Date; deletedAt: bigint | null;
}): AutomationRuleSummary => ({
  id: row.id, version: row.version, enabled: row.enabled, keyId: row.keyId,
  createdAt: row.createdAt.toISOString(), deletedAt: row.deletedAt === null ? null : row.deletedAt.toString(),
});

export async function createAutomationRule(userId: number, keyId: string): Promise<AutomationRuleSummary> {
  if (!Number.isSafeInteger(userId) || userId < 1 || !KEY_ID.test(keyId)) throw new Error('Invalid automation rule');
  const row = await prisma.automationRule.create({ data: { id: randomUUID(), userId, keyId } });
  return toSummary(row);
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
    if (enabled && !hasConfiguredWebhookKey(current.keyId)) throw new Error('Automation webhook key is not configured');
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
    await tx.automationCommitPermit.deleteMany({ where: { userId, ruleId } });
    await tx.automationEvent.deleteMany({ where: { userId, ruleId } });
    return toSummary(row);
  });
}
