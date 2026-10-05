import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AI_USAGE_RETENTION_DAYS,
  MANAGED_AI_REQUESTS_PER_PERIOD,
  consumeManagedAiRequest,
  managedAiPeriodAnchor,
  purgeExpiredAiUsageCounters,
  type AiMeteringResult,
} from '../src/ai/metering';
import type { SqlExecutor, SqlRunner } from '../src/billing/pricing-store';
import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

/**
 * 托管 AI 计量的**数据库层证据**（PGlite = 真的 PostgreSQL，只是跑在进程里）。
 *
 * ## 为什么这一层必须是真库，而不是注入一个假 store
 *
 * 本文件要证明的四件事**全部是数据库语义**，内存假 store 一条都证不了：
 *
 * | 要证的性质 | 只有真库能给的东西 |
 * |---|---|
 * | 列集合**等于**那四个（保留承诺的形状） | `information_schema.columns` 里的真实结果 |
 * | 同一 `(user_id, period_anchor)` 只能有一行 | 唯一索引 + 冲突时 `ON CONFLICT` 的**推断**行为 |
 * | 超额那一次**什么都没写** | `WHERE requests < N` 让语句匹配零行（不是我们少写了一次 UPDATE） |
 * | 删账号 ⇒ 计数跟着消失 | `ON DELETE CASCADE` 是库在执行，不是代码记得删 |
 *
 * SQL 一律**从发布中的迁移文件读出来**，不手抄（`pricing-ddl.helper.ts` /
 * `activity-ddl.helper.ts` 同一口径）：抄一份的测试只能证明"抄本是对的"，
 * 而迁移漂移时它会安静地继续通过。
 *
 * ## 🔴 PGlite 证不了的那一半：**真并发**
 *
 * PGlite 是**单连接**的，两个 `BEGIN` 无法并存（与
 * `billing-pricing-store.pglite.spec.ts` 文件头记的是同一件事）。所以
 * "两个请求同时看见 299"这个形状在这里**跑不出真交错**。本文件因此分两层给证据：
 *
 * 1. **顺序语义**（下面的用例）：把额度用满 ⇒ 下一次真的被拒、`requests` 一字未动。
 * 2. **机制形状**（`机制形状` 那一组）：用一个记录语句的执行器断言
 *    "读占用 + 裁决 + 写占用"**只有一条语句**，且守卫在语句内部。
 *    把守卫挪到 JS 里做 check-then-increment，这一组会红。
 *
 * 剩下的那一小块 —— "PostgreSQL 的行锁真的会把另一个事务挡在 `WHERE` 之前" ——
 * 由真库用例负责：`tests/integration/ai-metering-race.integration.spec.ts`。
 * ⚠️ 那个文件**需要 `DATABASE_URL`**，没库时整组 skip，**本文件的任何一条都不算替它通过**。
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

// 🔴 目录名**从盘上推导，不写死**（`holiday-adjustment-migration.pglite.spec.ts`
// 那条事故：迁移合流时重新编了号，写死的锚点让 ENOENT 红在探针自己身上，
// 于是全部库层断言一条都没跑过，而输出看起来是"这个测试文件有问题"）。
const MIGRATION_SUFFIX = '_add_ai_usage_counters';
const migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(MIGRATION_SUFFIX))
  .map((entry) => entry.name)
  .sort();
if (migrationDirs.length !== 1) {
  throw new Error(
    `期望恰好一笔 *${MIGRATION_SUFFIX} 迁移，实际 ${String(migrationDirs.length)} 笔：` +
      `${migrationDirs.join(', ') || '（一笔都没有）'}\n` +
      '   🔴 0 笔 = 那笔迁移不在了，本文件的断言全部失去对象；多笔 = 出现了第二份同名结构。\n' +
      '      两种都请更新这里的锚点，而不是删断言 —— 列集合就是 ADR-0054 §2 那条承诺的载体。',
  );
}
const MIGRATION_DIR = String(migrationDirs[0]);

const migrationSqlFromFile = (): string => {
  const sql = readFileSync(join(migrationsDir, MIGRATION_DIR, 'migration.sql'), 'utf8');
  // 锚点：迁移被改名/重构时在这里就炸，而不是变成一组测着不存在结构的东西的绿灯。
  for (const anchor of [
    'CREATE TABLE "ai_usage_counters"',
    '"user_id" INTEGER NOT NULL',
    '"period_anchor" BIGINT NOT NULL',
    '"requests" INTEGER NOT NULL',
    '"updated_at" BIGINT NOT NULL',
  ]) {
    if (!sql.includes(anchor)) {
      throw new Error(
        `${MIGRATION_DIR}/migration.sql 里找不到 \`${anchor}\`。\n` +
          '   🔴 迁移被改名/重构时请更新本文件的锚点，而不是把断言删掉 ——\n' +
          '      "列集合等于那四个"是保留承诺唯一能被机器核对的形式。',
      );
    }
  }
  return sql;
};

const MIGRATION_SQL = migrationSqlFromFile();

/**
 * `subscriptions` 的**最小替身**：只留计量这条路读到的那几列（准入判定 + 锚点）。
 *
 * ⚠️ 它是替身而不是抄本 —— 与 `MINIMAL_USERS_DDL` 同一条理由：
 * 只保留本主题需要的列，所以它**不可能**与真实 `subscriptions` 漂移。
 * 真实表里那三十来列（`provider` / `price_id` / `external_subscription_id` …）
 * 与"用了几次"无关，抄过来只会让下一次加列时这里跟着红一次无关的错。
 */
const MINIMAL_SUBSCRIPTIONS_DDL = `
  CREATE TABLE subscriptions (
    id                  serial PRIMARY KEY,
    user_id             integer NOT NULL,
    status              text,
    grants              text[] NOT NULL DEFAULT ARRAY[]::text[],
    current_period_end  bigint
  );
`;

/** ADR-0054 §2：这张表的列集合**等于**这四列。多一列就是改承诺。 */
const PROMISED_COLUMNS = ['user_id', 'period_anchor', 'requests', 'updated_at'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** 固定的"现在"。可注入时钟在这里是**必需**的，不是便利：跨周期那两条要能算准。 */
const NOW = 1_760_000_000_000;
/** 当前计费周期的结束时刻（锚点取的就是它）。 */
const PERIOD_END = NOW + 30 * DAY_MS;
/** 续费之后的下一周期（`extendSubscriptionPeriod` 的 `max(now, 已有) + 30 天`）。 */
const NEXT_PERIOD_END = PERIOD_END + 30 * DAY_MS;

let db: PGlite;
let base: SqlExecutor;

const createPgliteExecutor = (pglite: PGlite): SqlExecutor => {
  const executor: SqlExecutor = {
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
        const result = await fn(executor);
        await pglite.exec('COMMIT');
        return result;
      } catch (error) {
        await pglite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return executor;
};

/** 语句日志包装器：用来断言**机制形状**（读+判+写是不是一条语句）。 */
const withStatementLog = (inner: SqlExecutor, log: string[]): SqlExecutor => {
  const wrapRunner = (exec: SqlRunner): SqlRunner => ({
    query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
      log.push(sql.replace(/\s+/g, ' ').trim());
      return inner.query<T>(sql, params);
    },
    execute: (sql: string, params: readonly unknown[] = []): Promise<number> => {
      log.push(sql.replace(/\s+/g, ' ').trim());
      return inner.execute(sql, params);
    },
  });
  return {
    ...wrapRunner(inner),
    transaction: <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> =>
      inner.transaction((tx) => fn(wrapRunner(tx))),
  };
};

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => {
  const res = await db.query<T>(sql, params);
  if (res.rows.length === 0) throw new Error(`查询没有返回行：${sql}`);
  return res.rows[0]!;
};

let userSeq = 0;
/**
 * 建一个账号，并可选地建一条订阅行。
 *
 * ⚠️ 返回的是**库里的 id**，不是自增序号：外键与级联那两条用例要按真实 id 删。
 */
const makeAccount = async (
  subscription: {
    status?: string | null;
    grants?: readonly string[];
    currentPeriodEnd?: number | null;
  } | null = { grants: ['hosting', 'ai'], currentPeriodEnd: PERIOD_END },
): Promise<number> => {
  userSeq += 1;
  const user = await one<{ id: number }>(
    "INSERT INTO users (email) VALUES ($1) RETURNING id",
    [`metering-${userSeq}@example.test`],
  );
  const id = Number(user.id);
  if (subscription !== null) {
    await db.query(
      `INSERT INTO subscriptions (user_id, status, grants, current_period_end)
       VALUES ($1, $2, $3::text[], $4)`,
      [
        id,
        subscription.status === undefined ? 'active' : subscription.status,
        [...(subscription.grants ?? [])],
        subscription.currentPeriodEnd === undefined
          ? BigInt(PERIOD_END)
          : subscription.currentPeriodEnd === null
            ? null
            : BigInt(subscription.currentPeriodEnd),
      ],
    );
  }
  return id;
};

const countersFor = async (userId: number): Promise<Array<{ period_anchor: string; requests: number }>> => {
  const res = await db.query<{ period_anchor: string; requests: number }>(
    'SELECT period_anchor::text AS period_anchor, requests FROM ai_usage_counters WHERE user_id = $1 ORDER BY period_anchor',
    [userId],
  );
  return res.rows;
};

/** 直接把某一周期的计数灌到某个值（"用满额度"不需要真的跑 300 次往返）。 */
const seedRequests = async (
  userId: number,
  anchor: number,
  requests: number,
): Promise<void> => {
  await db.query(
    `INSERT INTO ai_usage_counters (user_id, period_anchor, requests, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, period_anchor) DO UPDATE SET requests = $3, updated_at = $4`,
    [userId, BigInt(anchor), requests, BigInt(NOW)],
  );
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(MINIMAL_USERS_DDL);
  await db.exec(MINIMAL_SUBSCRIPTIONS_DDL);
  await db.exec(MIGRATION_SQL);
  base = createPgliteExecutor(db);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('DELETE FROM ai_usage_counters; DELETE FROM subscriptions; DELETE FROM users;');
});

describe(`🔴 迁移 ${MIGRATION_DIR}：列集合就是保留承诺（ADR-0054 §2）`, () => {
  it('列集合**等于**那四个（多一列 = 改承诺，少一列 = 承诺没了载体）', async () => {
    const res = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage_counters'`,
    );
    const actual = res.rows.map((r) => r.column_name).sort();
    // 🔴 **集合相等**，不是"包含这四列"。写成包含的话，加一列 `last_prompt` 照样全绿 ——
    // 而 ADR-0054 §2 那份承诺的失败形状**恰好就是**多一列。
    expect(actual).toEqual([...PROMISED_COLUMNS].sort());
    // 反向再钉一次：不许出现"内容类"的列名。**这条不能替代上一条**（黑名单永远漏掉
    // 下一个想加的名字，比如 `ctx`），它存在只是为了让失败信息一眼可读。
    for (const forbidden of ['prompt', 'completion', 'payload', 'content', 'metadata']) {
      expect(actual, `出现了内容列 ${forbidden} ⇒ "服务端不保留内容"变成假话`).not.toContain(
        forbidden,
      );
    }
  });

  it('四列的类型与 NOT NULL 与承诺一致（计数是整数，不是 Json）', async () => {
    const res = await db.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'ai_usage_counters'`,
    );
    const byName = new Map(res.rows.map((r) => [r.column_name, r]));
    expect(byName.get('user_id')!.data_type).toBe('integer');
    expect(byName.get('period_anchor')!.data_type).toBe('bigint');
    expect(byName.get('requests')!.data_type, 'requests 必须是整数：原子 +1 与比较都依赖它').toBe(
      'integer',
    );
    expect(byName.get('updated_at')!.data_type).toBe('bigint');
    for (const column of PROMISED_COLUMNS) {
      expect(byName.get(column)!.is_nullable, `${column} 可空 ⇒ 裁决要替 null 猜一个含义`).toBe(
        'NO',
      );
    }
  });

  it('存在一条覆盖 (user_id, period_anchor) 的**唯一**索引', async () => {
    const row = await one<{ index_name: string }>(
      `SELECT c.relname AS index_name
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_class t ON t.oid = i.indrelid
        WHERE t.relname = 'ai_usage_counters'
          AND i.indisunique
          AND i.indnatts = 2
          AND (SELECT array_agg(att.attname::text ORDER BY u.ordinality)
                 FROM unnest(i.indkey) WITH ORDINALITY AS u(attnum, ordinality)
                 JOIN pg_attribute att
                   ON att.attrelid = t.oid AND att.attnum = u.attnum) =
               ARRAY['user_id', 'period_anchor']::text[]`,
    );
    // 按**列与唯一性**认，不按索引名认：Prisma 出成 `CREATE UNIQUE INDEX`，
    // 手写迁移里改成 `ADD CONSTRAINT … UNIQUE` 是同一件事 —— 断言名字只会造出一次无关的红。
    expect(row.index_name).toContain('ai_usage_counters');
  });

  it('同一 (user_id, period_anchor) 插第二条会被拒（唯一性不是注释）', async () => {
    const userId = await makeAccount();
    await seedRequests(userId, PERIOD_END, 1);
    await expect(
      db.query(
        `INSERT INTO ai_usage_counters (user_id, period_anchor, requests, updated_at)
         VALUES ($1, $2, 1, $3)`,
        [userId, BigInt(PERIOD_END), BigInt(NOW)],
      ),
    ).rejects.toThrow(/duplicate key value|ai_usage_counters_user_id_period_anchor_key/i);
  });

  it('🔴 负数计数被库层拒绝（否则那一周期凭空多一次额度）', async () => {
    const userId = await makeAccount();
    await expect(
      db.query(
        `INSERT INTO ai_usage_counters (user_id, period_anchor, requests, updated_at)
         VALUES ($1, $2, -1, $3)`,
        [userId, BigInt(PERIOD_END), BigInt(NOW)],
      ),
    ).rejects.toThrow(/ai_usage_counters_requests_non_negative|check constraint/i);
  });

  it('🔴 删账号 ⇒ 计数行跟着消失（ADR-0054 §2 与"删账号即删"同一条路径）', async () => {
    const userId = await makeAccount();
    await seedRequests(userId, PERIOD_END, 7);
    await seedRequests(userId, NEXT_PERIOD_END, 2);
    expect((await countersFor(userId)).length).toBe(2);

    await db.query('DELETE FROM users WHERE id = $1', [userId]);

    const left = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM ai_usage_counters',
    );
    expect(Number(left.rows[0]!.n), '残留的计数行没有任何界面读得到、没有任何任务知道该删谁').toBe(0);
  });
});

describe('🔴 额度数字 ↔ 唯一事实源（改一边必须红）', () => {
  it('`MANAGED_AI_REQUESTS_PER_PERIOD` 等于 `ai-quota-ssot` 块里那个数字', async () => {
    const doc = readFileSync(
      join(repoRoot, 'docs/reference/pricing-and-entitlements.md'),
      'utf8',
    );
    // 与 scripts/check-ai-quota-consistency.mjs **同一个正则**：
    // 换一个"更宽松"的解析方式，就等于让这条判据比门禁自己更容易满足。
    const block = /```json ai-quota-ssot\s*\n([\s\S]*?)\n```/.exec(doc)?.[1];
    if (block === undefined) {
      throw new Error(
        '读不到 `ai-quota-ssot` 块 —— 唯一数字源被删掉/改名了。' +
          '   🔴 请更新本文件与门禁的锚点，而不是把这条断言删掉。',
      );
    }
    const ssot = JSON.parse(block) as { quota?: unknown };
    expect(typeof ssot.quota).toBe('number');
    expect(MANAGED_AI_REQUESTS_PER_PERIOD).toBe(ssot.quota);
  });

  it('限额配错当场抛，不退化成"全拒"或"不限"', async () => {
    const userId = await makeAccount();
    for (const bad of [0, -1, Number.NaN, 1.5]) {
      await expect(
        consumeManagedAiRequest({ userId, sql: base, now: NOW, limit: bad }),
      ).rejects.toThrow(RangeError);
    }
    expect(await countersFor(userId)).toEqual([]);
  });
});

describe('🔴 超额裁决：到点即停，而且一次都不多消耗', () => {
  it('灌满到上限再一次 ⇒ 拒绝，且 `requests` 一字未动', async () => {
    const userId = await makeAccount();
    await seedRequests(userId, PERIOD_END, MANAGED_AI_REQUESTS_PER_PERIOD);

    const result = await consumeManagedAiRequest({ userId, sql: base, now: NOW });

    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({
      reason: 'QUOTA_EXCEEDED',
      used: MANAGED_AI_REQUESTS_PER_PERIOD,
      limit: MANAGED_AI_REQUESTS_PER_PERIOD,
      periodAnchor: PERIOD_END,
    });
    // 落库事实，不看返回值：被拒的那一次**没有**把计数推上去。
    const counters = await countersFor(userId);
    expect(counters).toHaveLength(1);
    expect(Number(counters[0]!.requests), '被拒的请求消耗了额度 ⇒ "到点即停"变成"到点还能用"').toBe(
      MANAGED_AI_REQUESTS_PER_PERIOD,
    );
  });

  it('小限额整条路：1 → 2 放行，第 3 次拒且 used 仍是 2', async () => {
    const userId = await makeAccount();
    const first = await consumeManagedAiRequest({ userId, sql: base, now: NOW, limit: 2 });
    expect(first).toMatchObject({ allowed: true, used: 1, limit: 2 });
    const second = await consumeManagedAiRequest({ userId, sql: base, now: NOW + 1, limit: 2 });
    expect(second).toMatchObject({ allowed: true, used: 2, limit: 2 });
    const third: AiMeteringResult = await consumeManagedAiRequest({
      userId,
      sql: base,
      now: NOW + 2,
      limit: 2,
    });
    expect(third).toMatchObject({ allowed: false, used: 2, reason: 'QUOTA_EXCEEDED' });
    expect(Number((await countersFor(userId))[0]!.requests)).toBe(2);
  });
});

describe('🔴 锚点 = 计费周期，不是自然月', () => {
  const subscriptionRow = (currentPeriodEnd: number | null, grants = ['hosting', 'ai']) => ({
    status: 'active',
    grants,
    currentPeriodEnd,
  });

  it('同一周期内的两次请求落在**同一行**（锚点相同）', async () => {
    const anchorA = managedAiPeriodAnchor([subscriptionRow(PERIOD_END)], NOW);
    const anchorB = managedAiPeriodAnchor([subscriptionRow(PERIOD_END)], NOW + 20 * DAY_MS);
    expect(anchorA).toBe(PERIOD_END);
    expect(anchorB).toBe(PERIOD_END);

    const userId = await makeAccount();
    await consumeManagedAiRequest({ userId, sql: base, now: NOW, limit: 5 });
    await consumeManagedAiRequest({ userId, sql: base, now: NOW + 20 * DAY_MS, limit: 5 });
    const counters = await countersFor(userId);
    expect(counters).toHaveLength(1);
    expect(counters[0]!.period_anchor).toBe(String(PERIOD_END));
    expect(Number(counters[0]!.requests)).toBe(2);
  });

  it('跨过周期边界 ⇒ **新锚、新行、从 0 开始**，旧行的数字不动', async () => {
    // 边界之后必须**先有一条覆盖了新一期的订阅**才可能放行：到期时刻往前推的唯一
    // 正当来源是"又付了一次"（`extendSubscriptionPeriod`）。所以这里模拟续费之后的形状，
    // 而不是把 `now` 推到边界外却仍让旧行有效 —— 那在权益层就是 `PERIOD_ENDED`（下一条测）。
    const userId = await makeAccount();
    await consumeManagedAiRequest({ userId, sql: base, now: NOW, limit: 5 });
    await consumeManagedAiRequest({ userId, sql: base, now: NOW + 1, limit: 5 });
    const before = await countersFor(userId);
    expect(before).toHaveLength(1);
    expect(Number(before[0]!.requests)).toBe(2);

    // 续费：一行新周期（库里是**加一行**还是**改到期时刻**都可能，两种都走同一个判定）。
    await db.query(
      `INSERT INTO subscriptions (user_id, status, grants, current_period_end)
       VALUES ($1, 'active', $2::text[], $3)`,
      [userId, ['hosting', 'ai'], BigInt(NEXT_PERIOD_END)],
    );
    const afterBoundary = PERIOD_END + DAY_MS;
    const result = await consumeManagedAiRequest({
      userId,
      sql: base,
      now: afterBoundary,
      limit: 5,
    });

    expect(result).toMatchObject({ allowed: true, used: 1, periodAnchor: NEXT_PERIOD_END });
    const counters = await countersFor(userId);
    expect(counters.map((c) => c.period_anchor)).toEqual([
      String(PERIOD_END),
      String(NEXT_PERIOD_END),
    ]);
    // 🔴 新周期的那一行**从 1 开始**（= 之前是 0），而旧行停在 2 ——
    // 这两件事一起成立才叫"换锚即换一行"，任何"就地清零"的实现都会在这里红。
    expect(counters.map((c) => Number(c.requests))).toEqual([2, 1]);
  });

  it('到期时刻**没有**被推后 ⇒ 边界之后一律 `PERIOD_ENDED`，不猜新周期', async () => {
    const userId = await makeAccount();
    const result = await consumeManagedAiRequest({
      userId,
      sql: base,
      now: PERIOD_END,
      limit: 5,
    });
    // 半开区间 `[start, currentPeriodEnd)`：等于边界的那一刻已经过期（`entitlement.ts` 的口径）。
    expect(result).toMatchObject({ allowed: false, reason: 'PERIOD_ENDED', periodAnchor: null });
    expect(await countersFor(userId)).toEqual([]);
  });

  it('🔴 锚点取**最晚**那个有效周期，不是"最新那一行"', async () => {
    // `evaluateCapabilityAcross` 那条事故的锚点版本：付费行到期得晚、邀请行晚建但到期得早。
    // 按"最新一行"取 ⇒ 锚点从 P2 漂到 P1 ⇒ 同一周期被算成两个锚，计数器凭空清零。
    const rows = [
      subscriptionRow(PERIOD_END),
      subscriptionRow(NEXT_PERIOD_END),
      subscriptionRow(PERIOD_END - DAY_MS, ['hosting', 'ai']),
    ];
    expect(managedAiPeriodAnchor(rows, NOW)).toBe(NEXT_PERIOD_END);
  });

  it('锚点只认**授予该能力且此刻有效**的行', () => {
    expect(managedAiPeriodAnchor([subscriptionRow(PERIOD_END, ['hosting'])], NOW)).toBeNull();
    expect(managedAiPeriodAnchor([{ ...subscriptionRow(PERIOD_END), status: 'canceled' }], NOW)).toBeNull();
    expect(managedAiPeriodAnchor([subscriptionRow(null)], NOW)).toBeNull();
  });
});

describe('🔴 权益闸门：没买这一档的人一次都不消耗', () => {
  it('只有 `hosting` ⇒ `GRANT_NOT_INCLUDED`，且**连计数行都不创建**', async () => {
    const userId = await makeAccount({ grants: ['hosting'], currentPeriodEnd: PERIOD_END });
    const result = await consumeManagedAiRequest({ userId, sql: base, now: NOW });

    expect(result).toMatchObject({
      allowed: false,
      reason: 'GRANT_NOT_INCLUDED',
      used: 0,
      periodAnchor: null,
    });
    // 一个没买这一档的人在库里留下计数行 = 我们替他记了一份他没有的账。
    expect(await countersFor(userId)).toEqual([]);
  });

  it('完全没有订阅行 ⇒ `NO_SUBSCRIPTION`，零次数据库写', async () => {
    const userId = await makeAccount(null);
    const result = await consumeManagedAiRequest({ userId, sql: base, now: NOW });
    expect(result).toMatchObject({ allowed: false, reason: 'NO_SUBSCRIPTION', used: 0 });
    expect(await countersFor(userId)).toEqual([]);
  });

  it('`grants` 不是数组 ⇒ 这一行**不参与**锚点（子串匹配会让字符串形式的词表放行）', () => {
    // 替身表把 `grants` 声明成 `text[]`，所以库层造不出"数组被序列化成了字符串"那一行；
    // 这条判据本来就在**判定层**，用纯函数直接钉住它的输入形状。
    const asString = {
      status: 'active',
      currentPeriodEnd: PERIOD_END,
      grants: 'hosting,ai' as unknown as readonly string[],
    };
    expect(managedAiPeriodAnchor([asString], NOW)).toBeNull();
    // 同一份数据换成真数组就放行 —— 证明上一条红的是"不是数组"，不是别的东西。
    expect(managedAiPeriodAnchor([{ ...asString, grants: ['hosting', 'ai'] }], NOW)).toBe(
      PERIOD_END,
    );
  });
});

describe('机制形状：读占用 + 裁决 + 写占用必须是**一条语句**', () => {
  const statementsTouching = (log: string[], table: string): string[] =>
    log.filter((s) => s.includes(`"${table}"`) || s.includes(` ${table} `));

  it('计数表上只有一条语句，且守卫与自增在它**内部**', async () => {
    const userId = await makeAccount();
    const log: string[] = [];
    const result = await consumeManagedAiRequest({
      userId,
      sql: withStatementLog(base, log),
      now: NOW,
      limit: 2,
    });
    expect(result.allowed).toBe(true);

    const counterStatements = statementsTouching(log, 'ai_usage_counters');
    expect(counterStatements).toHaveLength(1);
    const [statement] = counterStatements;
    expect(statement).toContain('INSERT INTO "ai_usage_counters"');
    expect(statement).toContain('ON CONFLICT ("user_id", "period_anchor") DO UPDATE');
    // 🔴 守卫在语句里（`WHERE … requests < $n`），不是在 JS 里比完再决定要不要写。
    // 把 `requests < $4` 拿掉 ⇒ 这一条红；改成先 SELECT 再 UPDATE ⇒ 上面那条长度红。
    expect(statement).toMatch(/DO UPDATE SET[\s\S]*?WHERE\s+"ai_usage_counters"\."requests" < \$/);
    expect(statement).toContain('RETURNING "requests"');
  });

  it('被拒的那一次**不产生任何对计数表的写**（超额那一路也一样只读）', async () => {
    const userId = await makeAccount();
    await seedRequests(userId, PERIOD_END, 3);
    const log: string[] = [];
    const result = await consumeManagedAiRequest({
      userId,
      sql: withStatementLog(base, log),
      now: NOW,
      limit: 3,
    });
    expect(result.allowed).toBe(false);

    const counterStatements = statementsTouching(log, 'ai_usage_counters');
    expect(counterStatements).toHaveLength(2);
    expect(counterStatements[0]).toContain('INSERT INTO "ai_usage_counters"');
    expect(counterStatements[1], '超额之后只能**读**当前值来填那两个数').toContain(
      'SELECT "requests"',
    );
    expect(counterStatements[1]).not.toMatch(/UPDATE|INSERT/);
  });

  it('准入判定读的是订阅表，**没有**读计数表（读占用只发生在裁决那条语句里）', async () => {
    const userId = await makeAccount();
    const log: string[] = [];
    await consumeManagedAiRequest({ userId, sql: withStatementLog(base, log), now: NOW, limit: 5 });
    expect(statementsTouching(log, 'subscriptions')).toHaveLength(1);
    expect(log[0]).toContain('FROM "subscriptions"');
    expect(log[0]).not.toContain('ai_usage_counters');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 「保留 45 天」的**机械那一半**：purge
// ───────────────────────────────────────────────────────────────────────────
/**
 * 上面那些用例钉的是"记什么"；这一组钉的是"说过期就删，就得真有人删"。
 *
 * 🔴 为什么值得单独一层：ADR-0054 §4 写下的那句"45 天后删除"，在只有列集合断言的
 * 情况下**可以长期是假的** —— 表形状对、数字对、界面对，而没有任何一条 SQL 在执行。
 * 那正是 §8 点名的洞，所以这里的判据必须是**行为**（跑一次 purge，行数变成什么），
 * 不是"文件里存在一个叫 purge 的函数"。
 *
 * 变异怎么跑（`tmp/verify-purge.sh`，2026-10-05 现量，基线 28 passed / 还原 28 passed）：
 * | 变异 | 实测红几条 · 红在哪 |
 * |---|---|
 * | 拿掉 `AND "period_anchor" < $2::bigint` | **5**：过期且已结束那条、"还在生效的那一期不许删"、"45 天内留着"、混合那组、以及"删除是一条语句"（它比的是 WHERE 的形状） |
 * | 把 `updated_at < $1` 变成恒真 | **5**：同一组五条 —— 与上一行同集是**预期的**：两个条件少任一个，"只删该删的那几条"就不成立 |
 * | `retentionDays <= 0` 改成 `< 0` | **恰好 1**：那条"配错必须响亮拒绝"（0 会退化成每天删光全表） |
 * | `AI_USAGE_RETENTION_DAYS` 45 → 44 | **恰好 1**：那条"与 `packages/ai` 里的常量相等" |
 *
 * ⚠️ 上面这一度写成"每臂恰好红一条"，那是**我猜的**，第一次真跑就被推翻：前两臂各红 5 条。
 *    而第一次跑根本没跑 —— 脚本用的过滤器是 `@heyta/server`（真名 `@heyta/sync-server`），
 *    pnpm 匹配不到工程时打一行 `No projects matched the filters` 然后**退 0**，
 *    于是四条臂齐刷刷"RC=0"。判据没牙和探针没跑，在输出上长得一模一样。
 */
describe('🔴 过期清理：两个条件是"与"，缺一个就不是清理而是白送额度（ADR-0054 §4/§8）', () => {
  /** 灌一行并**自己决定 `updated_at`**（`seedRequests` 把它钉死在 NOW，这里要的是时间轴）。 */
  const seedRow = async (
    userId: number,
    anchor: number,
    requests: number,
    updatedAt: number,
  ): Promise<void> => {
    await db.query(
      `INSERT INTO ai_usage_counters (user_id, period_anchor, requests, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, BigInt(anchor), requests, BigInt(updatedAt)],
    );
  };

  const rowsOf = async (userId: number): Promise<Array<{ period_anchor: string; updated_at: string }>> => {
    const res = await db.query<{ period_anchor: string; updated_at: string }>(
      'SELECT period_anchor::text AS period_anchor, updated_at::text AS updated_at FROM ai_usage_counters WHERE user_id = $1 ORDER BY period_anchor',
      [userId],
    );
    return res.rows;
  };

  it('过期**且**周期已结束的行删掉，并如实报数', async () => {
    const userId = await makeAccount();
    const closedPeriod = NOW - 10 * DAY_MS; // 周期早已结束
    await seedRow(userId, closedPeriod, 7, NOW - 46 * DAY_MS); // 也超过了 45 天
    const result = await purgeExpiredAiUsageCounters({ now: NOW, sql: base });
    expect(result.deleted).toBe(1);
    expect(result.cutoffTime).toBe(NOW - AI_USAGE_RETENTION_DAYS * DAY_MS);
    expect(await rowsOf(userId)).toHaveLength(0);
  });

  it('🔴 还在生效的那一期**不许**删，哪怕它 50 天没动过（删了就是白送额度）', async () => {
    const userId = await makeAccount();
    // 用户付费、用了 1 次、之后再没碰：updated_at 很旧，但周期还没结束。
    await seedRow(userId, PERIOD_END, 1, NOW - 50 * DAY_MS);
    const result = await purgeExpiredAiUsageCounters({ now: NOW, sql: base });
    expect(result.deleted).toBe(0);
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(1);
    // 而且额度仍是"已用 1"，不是被清回满格 —— 这条才是"白送额度"的可观察形式。
    const again = await consumeManagedAiRequest({
      userId,
      sql: base,
      now: NOW,
      limit: MANAGED_AI_REQUESTS_PER_PERIOD,
    });
    expect(again.used).toBe(2);
  });

  it('周期已结束但仍在 45 天内 —— 留着（对账窗口就是这段）', async () => {
    const userId = await makeAccount();
    await seedRow(userId, NOW - 3 * DAY_MS, 40, NOW - 20 * DAY_MS);
    expect((await purgeExpiredAiUsageCounters({ now: NOW, sql: base })).deleted).toBe(0);
    expect(await rowsOf(userId)).toHaveLength(1);
  });

  it('混合一批行时只删该删的那几条（挡"WHERE 少写一个条件"）', async () => {
    const userId = await makeAccount();
    await seedRow(userId, NOW - 60 * DAY_MS, 3, NOW - 60 * DAY_MS); // 该删
    await seedRow(userId, NOW - 60 * DAY_MS - DAY_MS, 9, NOW - 46 * DAY_MS); // 该删
    await seedRow(userId, PERIOD_END, 2, NOW - 46 * DAY_MS); // 不该删（周期还开着）
    await seedRow(userId, NOW - 50 * DAY_MS, 5, NOW - 5 * DAY_MS); // 不该删（没过期）
    const result = await purgeExpiredAiUsageCounters({ now: NOW, sql: base });
    expect(result.deleted).toBe(2);
    const left = await rowsOf(userId);
    expect(left).toHaveLength(2);
    expect(left.map((r) => r.period_anchor)).toEqual([String(NOW - 50 * DAY_MS), String(PERIOD_END)]);
  });

  it('删除是**一条语句**，不读回来再逐行删', async () => {
    const userId = await makeAccount();
    await seedRow(userId, NOW - 60 * DAY_MS, 3, NOW - 60 * DAY_MS);
    const log: string[] = [];
    await purgeExpiredAiUsageCounters({ now: NOW, sql: withStatementLog(base, log) });
    const counterStatements = log.filter((s) => s.includes('ai_usage_counters'));
    expect(counterStatements).toHaveLength(1);
    expect(counterStatements[0]).toContain('DELETE FROM "ai_usage_counters"');
    expect(counterStatements[0]).toContain('RETURNING');
  });

  it('🔴 保留天数配错必须响亮拒绝 —— 0 在 SQL 里等于"每天删光全表"', async () => {
    await expect(purgeExpiredAiUsageCounters({ retentionDays: 0, sql: base })).rejects.toThrow(
      RangeError,
    );
    await expect(purgeExpiredAiUsageCounters({ retentionDays: -45, sql: base })).rejects.toThrow(
      RangeError,
    );
    await expect(
      purgeExpiredAiUsageCounters({ retentionDays: 45.5, sql: base }),
    ).rejects.toThrow(RangeError);
  });

  it('这个数字与 `packages/ai` 里那一处**必须相等**（两处各写一遍就是两套承诺）', () => {
    const supplyText = readFileSync(
      join(repoRoot, 'packages/ai/src/supply.ts'),
      'utf8',
    );
    const parsed = /MANAGED_AI_METADATA_RETENTION_DAYS\s*=\s*(\d+)/.exec(supplyText)?.[1];
    if (parsed === undefined) {
      throw new Error(
        'purge 用例解析不到 packages/ai 的 MANAGED_AI_METADATA_RETENTION_DAYS —— ' +
          '常量改名了。服务端不依赖 @heyta/ai（Dockerfile 不打包 packages/），' +
          '所以这里的 45 是**第二处**，它只能靠这条解析对账；改形状请连这条一起改。',
      );
    }
    expect(AI_USAGE_RETENTION_DAYS).toBe(Number(parsed));
  });
});
