import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  advanceAutomationAiAttempt,
  reconcileAutomationAiMetering,
  reserveAutomationAiAttempt,
} from '../src/automation/ai-metering';
import type { SqlExecutor, SqlRunner } from '../src/billing/pricing-store';
import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

/**
 * 自动收集**事件级计量账本**的数据库层证据（PGlite = 真的 PostgreSQL，跑在进程里）。
 *
 * 为什么必须是真库而不是语句桩：这一层要证的每一条都是**库语义**——
 *
 * | 要证的性质 | 只有真库能给的东西 |
 * |---|---|
 * | `reserved → released` 只退一次 | CAS `WHERE state = $6` 在真行上匹配 0 行 |
 * | 退款不会把额度退成负数 | `ai_usage_counters_requests_non_negative` 那条 **CHECK** |
 * | `(managed, period_anchor NULL)` 根本不存在 | `automation_ai_attempts_billing_source_known` 那条 CHECK |
 * | 对账读的是同一张计数器 | `GROUP BY period_anchor` 的真实结果 |
 *
 * DDL **从发布中的迁移文件读出来**，不手抄（与 `ai-metering.pglite.spec.ts` 同一条纪律）：
 * 抄一份的测试只能证明"抄本是对的"，迁移漂移时它会安静地继续通过。
 *
 * ⚠️ PGlite 是单连接的，"两个 worker 同时释放同一枚预留"那种**真并发**在这里跑不出交错；
 * 那一格由 `tests/integration/`（需要 `DATABASE_URL`）负责，本文件不冒充它。
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

/** 按**后缀**在盘上找迁移目录，不写死日期前缀（合流时编号会重排，写死会 ENOENT 红在探针自己身上）。 */
const migrationSqlFor = (suffix: string, anchors: readonly string[]): string => {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => entry.name)
    .sort();
  if (dirs.length !== 1) {
    throw new Error(`期望恰好一笔 *${suffix} 迁移，实际 ${String(dirs.length)} 笔：${dirs.join(', ') || '（一笔都没有）'}`);
  }
  const sql = readFileSync(join(migrationsDir, String(dirs[0]), 'migration.sql'), 'utf8');
  for (const anchor of anchors) {
    if (!sql.includes(anchor)) throw new Error(`${dirs[0]}/migration.sql 里找不到 \`${anchor}\` —— 迁移被改名/重构时请更新锚点，别删断言`);
  }
  return sql;
};

const COUNTERS_DDL = migrationSqlFor('_add_ai_usage_counters', ['CREATE TABLE "ai_usage_counters"']);
const ATTEMPTS_DDL = migrationSqlFor('_add_automation_ai_attempts', ['CREATE TABLE "automation_ai_attempts"']);
const ATTEMPTS_DIRECT_DDL = migrationSqlFor('_separate_direct_automation_ai_attempts', ['ADD COLUMN "billing_source"']);
const ATTEMPTS_LOCAL_DDL = migrationSqlFor('_allow_local_automation_ai_attempts', ['automation_ai_attempts_billing_source_known']);

/** `subscriptions` 的最小替身：只留计量这条路读到的那几列（与 ai-metering 那份 PGlite 证据同形状）。 */
const MINIMAL_SUBSCRIPTIONS_DDL = `
  CREATE TABLE subscriptions (
    id                  serial PRIMARY KEY,
    user_id             integer NOT NULL,
    status              text,
    grants              text[] NOT NULL DEFAULT ARRAY[]::text[],
    current_period_end  bigint
  );
`;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;
const PERIOD_END = NOW + 30 * DAY_MS;
const NEXT_PERIOD_END = PERIOD_END + 30 * DAY_MS;
const RULE = '11111111-1111-4111-8111-111111111111';

let db: PGlite;
let executor: SqlExecutor;

const createPgliteExecutor = (pglite: PGlite): SqlExecutor => {
  const inner: SqlExecutor = {
    query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
      const res = await pglite.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    execute: async (sql: string, params: readonly unknown[] = []): Promise<number> => {
      const res = await pglite.query(sql, params as unknown[]);
      return res.affectedRows ?? 0;
    },
    transaction: async <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> => {
      await pglite.exec('BEGIN');
      try {
        const result = await fn(inner);
        await pglite.exec('COMMIT');
        return result;
      } catch (error) {
        await pglite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return inner;
};

let userSeq = 0;
const makeAccount = async (currentPeriodEnd: number): Promise<number> => {
  userSeq += 1;
  const res = await db.query<{ id: number }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [`automation-metering-${userSeq}@example.test`]);
  const id = Number(res.rows[0]!.id);
  await db.query(
    'INSERT INTO subscriptions (user_id, status, grants, current_period_end) VALUES ($1, $2, $3::text[], $4)',
    [id, 'active', ['hosting', 'ai'], currentPeriodEnd],
  );
  return id;
};

const counterRequests = async (userId: number, anchor: number): Promise<number | null> => {
  const res = await db.query<{ requests: number }>('SELECT requests FROM ai_usage_counters WHERE user_id = $1 AND period_anchor = $2', [userId, anchor]);
  return res.rows.length === 0 ? null : Number(res.rows[0]!.requests);
};

const attemptState = async (userId: number, eventId: string, attempt: number): Promise<string> => {
  const res = await db.query<{ state: string }>(
    'SELECT state FROM automation_ai_attempts WHERE user_id = $1 AND rule_id = $2 AND event_id = $3 AND parse_version = 1 AND attempt = $4',
    [userId, RULE, eventId, attempt],
  );
  return String(res.rows[0]!.state);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`${MINIMAL_USERS_DDL}\n${MINIMAL_SUBSCRIPTIONS_DDL}\n${COUNTERS_DDL}\n${ATTEMPTS_DDL}\n${ATTEMPTS_DIRECT_DDL}\n${ATTEMPTS_LOCAL_DDL}`);
  executor = createPgliteExecutor(db);
});

beforeEach(async () => {
  await db.exec('DELETE FROM automation_ai_attempts; DELETE FROM ai_usage_counters; DELETE FROM subscriptions; DELETE FROM users;');
});

describe('automation AI metering — 额度退回（真库）', () => {
  it('退回 reserved→released 那一次预留的托管额度，且对账净额归零', async () => {
    const userId = await makeAccount(PERIOD_END);
    const key = { userId, ruleId: RULE, eventId: 'ev-refund', parseVersion: 1, attempt: 1 };
    await reserveAutomationAiAttempt(key, NOW, undefined, executor, undefined, 'managed');
    expect(await counterRequests(userId, PERIOD_END)).toBe(1);

    expect(await advanceAutomationAiAttempt(key, 'reserved', 'released', executor)).toBe(true);
    expect(await counterRequests(userId, PERIOD_END)).toBe(0);
    const reading = await reconcileAutomationAiMetering({ userId, sql: executor });
    expect(reading.periods).toEqual([
      { periodAnchor: PERIOD_END, chargedAttempts: 0, refundedAttempts: 1, counterRequests: 0, short: false, unexplainedByAutomation: 0 },
    ]);
  });

  it('重复释放同一枚预留不退第二次（CAS 挡住的那一路）', async () => {
    const userId = await makeAccount(PERIOD_END);
    const key = { userId, ruleId: RULE, eventId: 'ev-double', parseVersion: 1, attempt: 1 };
    await reserveAutomationAiAttempt(key, NOW, undefined, executor, undefined, 'managed');
    expect(await advanceAutomationAiAttempt(key, 'reserved', 'released', executor)).toBe(true);
    // 第二趟：库里那枚已经不是 reserved，CAS 匹配 0 行 ⇒ 返回 false 且**一条计数器都不动**。
    expect(await advanceAutomationAiAttempt(key, 'reserved', 'released', executor)).toBe(false);
    expect(await counterRequests(userId, PERIOD_END)).toBe(0);
  });

  it('已发出过的那一枚（sent→released）不退——供应商已经产生一次物理调用', async () => {
    const userId = await makeAccount(PERIOD_END);
    const key = { userId, ruleId: RULE, eventId: 'ev-sent', parseVersion: 1, attempt: 1 };
    await reserveAutomationAiAttempt(key, NOW, undefined, executor, undefined, 'managed');
    expect(await advanceAutomationAiAttempt(key, 'reserved', 'sent', executor)).toBe(true);
    expect(await advanceAutomationAiAttempt(key, 'sent', 'released', executor)).toBe(true);
    expect(await counterRequests(userId, PERIOD_END)).toBe(1);
    const reading = await reconcileAutomationAiMetering({ userId, sql: executor });
    // 这条形状是**故意的**：释放了但额度仍算 —— 计数器 1 vs 净额 0，多出来的那一次
    // 属于"发出去过"的物理调用，`short` 必须为 false（它不是少记，是已经用掉）。
    expect(reading.periods[0]).toMatchObject({ chargedAttempts: 0, refundedAttempts: 1, counterRequests: 1, short: false });
  });

  it('计数器行不存在时释放不会报错，也不会替用户凭空建一行', async () => {
    const userId = await makeAccount(PERIOD_END);
    const key = { userId, ruleId: RULE, eventId: 'ev-purged', parseVersion: 1, attempt: 1 };
    await reserveAutomationAiAttempt(key, NOW, undefined, executor, undefined, 'managed');
    // 模拟 45 天保留期把那一行删掉之后才来的释放（或运维手工删的行）。
    await db.exec('DELETE FROM ai_usage_counters');
    expect(await advanceAutomationAiAttempt(key, 'reserved', 'released', executor)).toBe(true);
    const res = await db.query('SELECT 1 FROM ai_usage_counters WHERE user_id = $1', [userId]);
    expect(res.rows).toHaveLength(0);
    expect(await attemptState(userId, 'ev-purged', 1)).toBe('released');
  });

  it('计数器已被手工调到 0 时，释放既不报错也不把它退成负数', async () => {
    const userId = await makeAccount(PERIOD_END);
    const key = { userId, ruleId: RULE, eventId: 'ev-zero', parseVersion: 1, attempt: 1 };
    await reserveAutomationAiAttempt(key, NOW, undefined, executor, undefined, 'managed');
    // 运维手工调额（或一次更早的退款）留下的 0 行：库里那条
    // `ai_usage_counters_requests_non_negative` CHECK 会拒绝 -1，而"释放租约"这件事
    // 不该因此变成一次 409 —— 那会把隐私/运维侧的一次改动放大成用户端的失败。
    await db.exec('UPDATE ai_usage_counters SET requests = 0 WHERE user_id = ' + userId);
    expect(await advanceAutomationAiAttempt(key, 'reserved', 'released', executor)).toBe(true);
    expect(await counterRequests(userId, PERIOD_END)).toBe(0);
  });

  it('local / direct 的预留与释放都不碰托管计数器', async () => {
    const userId = await makeAccount(PERIOD_END);
    for (const source of ['local', 'direct'] as const) {
      const key = { userId, ruleId: RULE, eventId: `ev-${source}`, parseVersion: 1, attempt: 1 };
      const reserved = await reserveAutomationAiAttempt(key, NOW, undefined, executor, undefined, source);
      expect(reserved.periodAnchor).toBeNull();
      expect(await advanceAutomationAiAttempt(key, 'reserved', 'released', executor)).toBe(true);
    }
    const res = await db.query('SELECT 1 FROM ai_usage_counters WHERE user_id = $1', [userId]);
    expect(res.rows).toHaveLength(0);
  });

  it('退款与 CAS 同一个事务：事务后半段炸掉时，状态与额度一起回滚', async () => {
    const userId = await makeAccount(PERIOD_END);
    const key = { userId, ruleId: RULE, eventId: 'ev-atomic', parseVersion: 1, attempt: 1 };
    await reserveAutomationAiAttempt(key, NOW, undefined, executor, undefined, 'managed');
    // 包住真执行器：CAS 之后强行抛，验证两个写入是一个提交边界（不是"额度退了、状态没改"）。
    const bomb: SqlExecutor = {
      query: <T>(sql: string, params?: readonly unknown[]): Promise<T[]> => executor.query<T>(sql, params),
      execute: async (sql, params) => {
        const affected = await executor.execute(sql, params);
        if (sql.includes('ai_usage_counters')) throw new Error('注入：退款之后炸');
        return affected;
      },
      transaction: (fn) => executor.transaction((tx) => fn({ query: (sql, params) => tx.query(sql, params), execute: (sql, params) => bomb.execute(sql, params) })),
    };
    await expect(advanceAutomationAiAttempt(key, 'reserved', 'released', bomb)).rejects.toThrow('注入：退款之后炸');
    expect(await counterRequests(userId, PERIOD_END)).toBe(1);
    expect(await attemptState(userId, 'ev-atomic', 1)).toBe('reserved');
  });
});

describe('automation AI metering — 逐事件与逐周期对账（真库）', () => {
  it('按周期分行，净额高于计数器时判 short', async () => {
    const userId = await makeAccount(PERIOD_END);
    for (const attempt of [1, 2, 3]) {
      await reserveAutomationAiAttempt({ userId, ruleId: RULE, eventId: 'ev-multi', parseVersion: 1, attempt }, NOW, undefined, executor, undefined, 'managed');
    }
    expect(await counterRequests(userId, PERIOD_END)).toBe(3);
    // 伪造一次"少记"（等价于额度被多退/被删）：把计数器压到 1，而库里仍有 3 枚仍占额度的尝试。
    await db.exec('UPDATE ai_usage_counters SET requests = 1 WHERE user_id = ' + userId);
    const reading = await reconcileAutomationAiMetering({ userId, sql: executor });
    expect(reading.periods).toHaveLength(1);
    expect(reading.periods[0]).toMatchObject({ periodAnchor: PERIOD_END, chargedAttempts: 3, counterRequests: 1, short: true });
    expect(reading.events).toHaveLength(3);
  });

  it('计数器多出来的手工托管用量不算缺陷，只披露成 unexplainedByAutomation', async () => {
    const userId = await makeAccount(PERIOD_END);
    await reserveAutomationAiAttempt({ userId, ruleId: RULE, eventId: 'ev-one', parseVersion: 1, attempt: 1 }, NOW, undefined, executor, undefined, 'managed');
    // 同一行里再叠一次"人工在设置页点的托管 AI"——共用账号级计数器，逐请求不留痕（ADR-0054 §2）。
    await db.exec('UPDATE ai_usage_counters SET requests = requests + 1 WHERE user_id = ' + userId);
    const reading = await reconcileAutomationAiMetering({ userId, sql: executor });
    expect(reading.periods[0]).toMatchObject({ chargedAttempts: 1, counterRequests: 2, short: false, unexplainedByAutomation: 1 });
  });

  it('跨周期分行：换订阅周期之后的预留落在另一个锚上，两行各自可对账', async () => {
    const userId = await makeAccount(PERIOD_END);
    await reserveAutomationAiAttempt({ userId, ruleId: RULE, eventId: 'ev-old', parseVersion: 1, attempt: 1 }, NOW, undefined, executor, undefined, 'managed');
    // 续费把到期时刻推后 ⇒ 锚点跟着换一期（`managedAiPeriodAnchor` 取最晚的那一行）。
    await db.query('UPDATE subscriptions SET current_period_end = $2 WHERE user_id = $1', [userId, NEXT_PERIOD_END]);
    await reserveAutomationAiAttempt({ userId, ruleId: RULE, eventId: 'ev-new', parseVersion: 1, attempt: 1 }, NOW, undefined, executor, undefined, 'managed');
    const reading = await reconcileAutomationAiMetering({ userId, sql: executor });
    expect(reading.periods.map((row) => [row.periodAnchor, row.chargedAttempts, row.counterRequests, row.short])).toEqual([
      [PERIOD_END, 1, 1, false],
      [NEXT_PERIOD_END, 1, 1, false],
    ]);
  });

  it('逐事件明细按 (规则, 事件, 解析版本, 尝试) 归属，状态与来源逐行可见', async () => {
    const userId = await makeAccount(PERIOD_END);
    const base = { userId, ruleId: RULE, eventId: 'ev-detail' };
    await reserveAutomationAiAttempt({ ...base, parseVersion: 1, attempt: 1 }, NOW, undefined, executor, undefined, 'managed');
    await reserveAutomationAiAttempt({ ...base, parseVersion: 1, attempt: 2 }, NOW, undefined, executor, undefined, 'direct');
    await reserveAutomationAiAttempt({ ...base, parseVersion: 2, attempt: 1 }, NOW, undefined, executor, undefined, 'local');
    await advanceAutomationAiAttempt({ ...base, parseVersion: 1, attempt: 1 }, 'reserved', 'sent', executor);
    await advanceAutomationAiAttempt({ ...base, parseVersion: 1, attempt: 2 }, 'reserved', 'released', executor);
    const reading = await reconcileAutomationAiMetering({ userId, sql: executor });
    expect(reading.events).toEqual([
      { ruleId: RULE, eventId: 'ev-detail', parseVersion: 1, attempt: 1, state: 'sent', billingSource: 'managed' },
      { ruleId: RULE, eventId: 'ev-detail', parseVersion: 1, attempt: 2, state: 'released', billingSource: 'direct' },
      { ruleId: RULE, eventId: 'ev-detail', parseVersion: 2, attempt: 1, state: 'reserved', billingSource: 'local' },
    ]);
  });

  it('库层 CHECK 挡得住 (managed, period_anchor NULL) 这种自相矛盾的账行', async () => {
    const userId = await makeAccount(PERIOD_END);
    await expect(db.query(
      `INSERT INTO automation_ai_attempts (user_id, rule_id, event_id, parse_version, attempt, period_anchor, billing_source, state, created_at, updated_at)
       VALUES ($1, $2, 'ev-check', 1, 1, NULL, 'managed', 'reserved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [userId, RULE],
    )).rejects.toThrow(/automation_ai_attempts_billing_source_known|check|constraint/i);
  });
});
