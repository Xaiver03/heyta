import { describe, expect, it } from 'vitest';
import { reserveAutomationAiAttempt, advanceAutomationAiAttempt } from '../src/automation/ai-metering';

const key = { userId: 1, ruleId: '11111111-1111-4111-8111-111111111111', eventId: 'event', parseVersion: 1, attempt: 1 };

describe('automation AI metering ledger', () => {
  it.each(['local', 'direct', 'managed'] as const)('reserves a %s attempt once with the correct quota source', async (source) => {
    let inserted = false;
    const calls: string[] = [];
    const tx = {
      query: async <T>(sql: string): Promise<T[]> => {
        calls.push(sql);
        if (sql.includes('automation_ai_attempts') && sql.startsWith('SELECT')) return (inserted ? [{ period_anchor: source === 'managed' ? 456 : null, billing_source: source, state: 'reserved' }] : []) as T[];
        if (sql.includes('subscriptions')) return [{ status: 'active', grants: ['ai'], current_period_end: 456 }] as T[];
        if (sql.includes('ai_usage_counters') && sql.trimStart().startsWith('INSERT')) return [{ requests: 1 }] as T[];
        throw new Error(`unexpected query: ${sql}`);
      },
      execute: async (sql: string): Promise<number> => { calls.push(sql); if (sql.includes('automation_ai_attempts')) inserted = true; return 1; },
    };
    const sql = { ...tx, transaction: async <T>(fn: (inner: typeof tx) => Promise<T>) => fn(tx) };
    const first = await reserveAutomationAiAttempt(key, 100, 3, sql, undefined, source);
    const second = await reserveAutomationAiAttempt(key, 100, 3, sql, undefined, source);
    expect(first).toEqual({ ...key, periodAnchor: source === 'managed' ? 456 : null, billingSource: source, state: 'reserved' });
    expect(second).toEqual(first);
    expect(calls.filter((statement) => statement.includes('ai_usage_counters') && statement.trimStart().startsWith('INSERT')))
      .toHaveLength(source === 'managed' ? 1 : 0);
    await expect(reserveAutomationAiAttempt(key, 100, 3, sql, undefined, source === 'direct' ? 'managed' : 'direct'))
      .rejects.toThrow('billing source conflicts');
  });

  it('requires the expected prior state for transitions', async () => {
    const sql = {
      query: async <T>(): Promise<T[]> => [{ ok: 1 }] as T[],
      transaction: async <T>(fn: any) => fn(sql),
    };
    await expect(advanceAutomationAiAttempt(key, 'reserved', 'sent', sql)).resolves.toBe(true);
  });
});
