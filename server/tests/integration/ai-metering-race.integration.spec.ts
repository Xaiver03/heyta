/**
 * 🔴 **真库上的行锁并发**：多个请求同时抢**最后一个**名额。
 *
 * ## 为什么必须是真 PostgreSQL
 *
 * `tests/ai-metering.pglite.spec.ts` 给的是**顺序**语义 + **机制形状**：
 * PGlite 是**单连接**，两个 `BEGIN` 无法并存，所以它证不了这两件事——
 *
 * 1. 两个事务真的能**同时**看见 `requests = 4`（竞态的前提）；
 * 2. `INSERT … ON CONFLICT DO UPDATE … WHERE requests < N` 里那条 `WHERE`
 *    在**别的先提交之后**会被重新求值（PostgreSQL 对 `DO UPDATE` 的语义：
 *    冲突行的新版本会被重读一次，`WHERE` 不成立 ⇒ 匹配零行、一个字都不写）。
 *
 * 第 2 条是整套额度唯一的牙齿，而它**只存在于真库的行为里**。
 * 本文件因此带一条**阳性对照**：用同一个会合栏跑一份**故意写错**的
 * check-then-increment，它**必须**超发。
 * 如果对照那条也"恰好只放行一个"，说明这个测试**根本没造出并发**，
 * 那它给主用例的绿灯同样是假的 —— 这正是 `coupon-quota-race.integration.spec.ts`
 * 文件头记的那个形状（"只断言恰好一个成功是可以空转的"）。
 *
 * ## 运行
 *
 * 需要真库；`DATABASE_URL` 缺失时整组 skip（与仓库里其余 integration spec 一致）。
 *
 *   DATABASE_URL=postgresql://… npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/ai-metering-race.integration.spec.ts
 *
 * ⚠️ 与 `coupon-quota-race` 不同，这一条**还要** `JWT_SECRET`（缺了整个文件在 import 期就炸）。
 * 原因不在计量这层：`metering.ts` 复用的是 `entitlement.ts` 的判定函数，而那个模块的
 * `createEntitlementGuard` 会 import `middleware.ts` → `auth.ts`，后者在**模块求值时**
 * 就要求 `JWT_SECRET`。集成档没有 `setupFiles`（那里 mock 了 `src/db` 与 `src/auth`），
 * 所以这一条只能靠环境变量满足它。生产路径本来带着这个变量，不构成额外约束。
 *
 * ⚠️ **本文件的注册状态**：它**尚未**列进 `server/package.json` 的
 * `test:integration:postgres`（那一条不在本轮的写入范围里）。
 * 没注册 = CI 不跑它 = 这条判据只可能被手动跑出来。
 * `coupon-quota-race` 的文件头写的就是同一件事：**"注册"这一步本身就是修复的一半。**
 *
 * ## 本机怎么把它跑起来的（2026-10-05 实测，照着做可复现）
 *
 * ```bash
 * createdb -h 127.0.0.1 -U "$USER" heyta_ai_metering_race
 * cd server
 * DATABASE_URL="postgresql://$USER@127.0.0.1:5432/heyta_ai_metering_race" npx prisma db push --skip-generate
 * # 把计数器表删掉，让下面 beforeAll 走"执行发布中的迁移文件"那一条路（而不是 db push 的版本）
 * psql -h 127.0.0.1 -U "$USER" -d heyta_ai_metering_race -c 'DROP TABLE IF EXISTS "ai_usage_counters";'
 * DATABASE_URL="postgresql://$USER@127.0.0.1:5432/heyta_ai_metering_race" JWT_SECRET=<64 位 hex> \
 *   npx vitest run --config vitest.integration.config.ts tests/integration/ai-metering-race.integration.spec.ts
 * ```
 *
 * ⚠️ 用**独立库名**而不是复用别人的库：本机那个 Postgres 上同时有别的验收在用
 * （实测到 `heyta_mobile_smoke` 的活跃连接），共享一个库就是共享一份状态。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  MANAGED_AI_REQUESTS_PER_PERIOD,
  consumeManagedAiRequest,
  type AiMeteringResult,
} from '../../src/ai/metering';
import {
  createPrismaSqlExecutor,
  type SqlExecutor,
  type SqlRunner,
} from '../../src/billing/pricing-store';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const RUN_ID = `${Date.now()}-${process.pid}`;
const EMAIL = `ai-metering-race-${RUN_ID}@test.local`;
/**
 * 用例用小限额，不去跑 300 次往返。
 *
 * 🔴 这个 5 **不是**被测的那个数字，只是"一个已经用掉的额度状态"。
 * 300 与唯一事实源的对账在 pglite 那份里（`ai-quota-ssot` 块 ↔ `MANAGED_AI_REQUESTS_PER_PERIOD`）。
 */
const LIMIT = 5;
/** 竞态前提：灌到**只剩一个**名额，然后同时发 N 发。 */
const SEEDED_REQUESTS = LIMIT - 1;
const ATTEMPTS = 4;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');
const migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith('_add_ai_usage_counters'))
  .map((entry) => entry.name)
  .sort();
if (migrationDirs.length !== 1) {
  throw new Error(
    `期望恰好一笔 *_add_ai_usage_counters 迁移，实际 ${String(migrationDirs.length)} 笔：` +
      `${migrationDirs.join(', ') || '（一笔都没有）'}。` +
      '\n   🔴 0 笔 = 那笔迁移不在了；多笔 = 出现了第二份同名结构。两种都要更新锚点，不是删用例。',
  );
}
const MIGRATION_DIR = String(migrationDirs[0]);
const MIGRATION_PATH = join(migrationsDir, MIGRATION_DIR, 'migration.sql');

/** 剥掉整行注释，按"行尾分号"切语句（与 `scripts/migrate-deploy.sh` 同一解析前提）。 */
const statementsFrom = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

/** 会合栏：前 `expected` 个到达者一起等，最后一个到达时放行全部。 */
const makeBarrier = (
  expected: number,
): { readonly wait: () => Promise<void>; readonly arrived: () => number } => {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    wait: async () => {
      arrived += 1;
      if (arrived >= expected) release();
      await gate;
    },
    arrived: () => arrived,
  };
};

describeWithDb('Managed AI metering race (PostgreSQL)', () => {
  let observer: PrismaClient;
  /** 每发并发**自己的连接** —— 同一个连接里没有两条事务。 */
  const extraClients: PrismaClient[] = [];

  const newClient = (): PrismaClient => {
    const client = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
    extraClients.push(client);
    return client;
  };

  /**
   * 在**第一条语句之前**过会合栏。
   *
   * 计量这条路的第一条语句是准入选读（`SELECT … FROM subscriptions`）——
   * 四条同时越过它，四条就几乎同时撞上那条 `INSERT … DO UPDATE`。
   * 于是"真的有两个请求在争同一个名额"是被**构造**出来的，不是碰上的。
   */
  const withRendezvous = (inner: SqlExecutor, wait: () => Promise<void>): SqlExecutor => {
    let tripped = false;
    const gate = async (): Promise<void> => {
      if (tripped) return;
      tripped = true;
      await wait();
    };
    return {
      query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
        await gate();
        return inner.query<T>(sql, params);
      },
      execute: async (sql: string, params: readonly unknown[] = []): Promise<number> => {
        await gate();
        return inner.execute(sql, params);
      },
      // 主路径不开事务（裁决就是一条语句），这里只是把端口补全。
      transaction: <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> => inner.transaction(fn),
    };
  };

  let userId = 0;
  let periodAnchor = 0;

  const requestsNow = async (): Promise<number> => {
    const rows = await observer.$queryRawUnsafe<{ requests: number }[]>(
      `SELECT "requests" FROM "ai_usage_counters" WHERE "user_id" = $1 AND "period_anchor" = $2`,
      userId,
      BigInt(periodAnchor),
    );
    if (rows.length === 0) throw new Error('计数行不存在 —— 前面的用例没有建立前提');
    return Number(rows[0]!.requests);
  };

  const resetCounter = async (): Promise<void> => {
    await observer.$executeRawUnsafe(
      `INSERT INTO "ai_usage_counters" ("user_id", "period_anchor", "requests", "updated_at")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("user_id", "period_anchor")
       DO UPDATE SET "requests" = $3, "updated_at" = $4`,
      userId,
      BigInt(periodAnchor),
      SEEDED_REQUESTS,
      BigInt(Date.now()),
    );
  };

  beforeAll(async () => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required for integration tests');
    observer = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

    // 建表：只在**表还不存在**时执行发布中的迁移文件。
    // ⚠️ 读发布物而不是抄一份 —— 顺带证明那份 SQL 在真库上执行得下去。
    // `::text` 不是随手加的：Prisma **解不出 `regclass` 这个类型**（实测报
    // "Failed to deserialize column of type 'regclass'"），而这条判据要的只是"有没有"。
    const existing = await observer.$queryRawUnsafe<{ regclass: string | null }[]>(
      `SELECT to_regclass('public.ai_usage_counters')::text AS regclass`,
    );
    if (existing[0]?.regclass === null || existing[0]?.regclass === undefined) {
      for (const statement of statementsFrom(MIGRATION_PATH)) {
        await observer.$executeRawUnsafe(statement);
      }
    }

    periodAnchor = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const user = await observer.user.create({ data: { email: EMAIL } });
    userId = user.id;
    await observer.subscription.create({
      data: {
        userId,
        status: 'active',
        grants: ['hosting', 'ai'],
        currentPeriodEnd: BigInt(periodAnchor),
      },
    });
  });

  afterAll(async () => {
    if (!observer) return;
    // 🔴 清理必须**容忍表不存在**：`beforeAll` 失败（建表没跑成）之后，
    // 这里再抛一次 42P01 会把真正的第一个错误盖掉，症状变成"清理也失败了"，
    // 排查时会去查错的那一段。
    const exists = await observer.$queryRawUnsafe<{ regclass: string | null }[]>(
      `SELECT to_regclass('public.ai_usage_counters')::text AS regclass`,
    );
    if (exists[0]?.regclass !== null && exists[0]?.regclass !== undefined) {
      await observer.$executeRawUnsafe(
        `DELETE FROM "ai_usage_counters" WHERE "user_id" = $1`,
        userId,
      );
    }
    await observer.subscription.deleteMany({ where: { userId } });
    await observer.user.deleteMany({ where: { email: EMAIL } });
    await observer.$disconnect();
    for (const client of extraClients) await client.$disconnect();
  });

  it('🔴 前置条件成立：额度已被灌到只剩一个名额', async () => {
    await resetCounter();
    // 没有这条前提，后面"恰好一个成功"可以靠"库里本来就没名额"空转出来。
    expect(await requestsNow()).toBe(SEEDED_REQUESTS);
    expect(LIMIT).toBeLessThan(MANAGED_AI_REQUESTS_PER_PERIOD);
  });

  it('🔴 四发同时抢**最后一个**名额：恰好一个成功，库里停在 5', async () => {
    await resetCounter();
    const barrier = makeBarrier(ATTEMPTS);
    const attempts: Array<Promise<AiMeteringResult>> = Array.from(
      { length: ATTEMPTS },
      () =>
        consumeManagedAiRequest({
          userId,
          sql: withRendezvous(createPrismaSqlExecutor(newClient()), barrier.wait),
          limit: LIMIT,
        }),
    );
    const settled = await Promise.allSettled(attempts);

    // 前提断言：会合栏真的被 N 发同时撞上（否则"恰好一个"可能只是顺序跑出来的）。
    expect(barrier.arrived()).toBe(ATTEMPTS);

    // 任何一发**失败**（抛异常）都算红：超额必须是"明确拒绝"，不是 500。
    // ADR-0023 §5 第 3 条写的就是这个：第 301 次返回明确的"额度用尽"而不是 500。
    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(rejected.map((r) => (r as PromiseRejectedResult).reason?.message ?? String(r))).toEqual(
      [],
    );

    const results = settled.map((r) => (r as PromiseFulfilledResult<AiMeteringResult>).value);
    const allowed = results.filter((r) => r.allowed);
    const denied = results.filter((r) => !r.allowed);
    expect(allowed).toHaveLength(1);
    expect(denied).toHaveLength(ATTEMPTS - 1);
    for (const denial of denied) {
      expect(denial.allowed === false && denial.reason).toBe('QUOTA_EXCEEDED');
      // 🔴 拒绝报的 `used` 必须**等于上限**，而且这个值在并发下也只能是 5。
      // 如果实现是"读回来是几就报几"，并发里会报出 4 —— 界面就会说"还剩 1 次但被拒"。
      expect(denial.allowed === false && denial.used).toBe(LIMIT);
    }

    // 落库事实，不看返回值：名额只被消耗了一次。
    expect(await requestsNow()).toBe(LIMIT);
  });

  it('🔴 阳性对照：**同一套并发载体**下的 check-then-increment 必须超发', async () => {
    // 这一条测的**不是**被测代码，是**探针**：证明上面那个"恰好一个"不是空转出来的。
    // 实现是刻意的错形状（先读、在事务里比、再写），跑在真事务、真行锁上。
    await resetCounter();
    const barrier = makeBarrier(ATTEMPTS);
    const naiveAttempt = async (): Promise<boolean> => {
      const client = newClient();
      return client.$transaction(async (tx) => {
        await barrier.wait();
        const rows = await tx.$queryRawUnsafe<{ requests: number }[]>(
          `SELECT "requests" FROM "ai_usage_counters"
            WHERE "user_id" = $1 AND "period_anchor" = $2`,
          userId,
          BigInt(periodAnchor),
        );
        if (Number(rows[0]!.requests) >= LIMIT) return false;
        await tx.$executeRawUnsafe(
          `UPDATE "ai_usage_counters" SET "requests" = "requests" + 1
            WHERE "user_id" = $1 AND "period_anchor" = $2`,
          userId,
          BigInt(periodAnchor),
        );
        return true;
      });
    };

    const settled = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, () => naiveAttempt()),
    );
    const allowed = settled.filter(
      (r) => r.status === 'fulfilled' && r.value === true,
    ).length;
    const requests = await requestsNow();

    // 🔴 超发的两种表现：放行了不止一发，或者库里冲过上限。
    // 两者都**没有**发生 ⇒ 并发没建立，上一条的绿灯不作数 ——
    // 这条红是在报"探针坏了"，不是"测试写坏了"（AGENTS §7 元规则第 1 条）。
    expect(
      allowed > 1 || requests > LIMIT,
      `探针失效：check-then-increment 也没有超发（allowed=${String(
        allowed,
      )}, requests=${String(requests)}）⇒ 这一组并发没有真的交错，主用例的绿灯不作数`,
    ).toBe(true);
  });
});
