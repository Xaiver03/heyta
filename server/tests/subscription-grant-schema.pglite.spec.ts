/**
 * `subscription_grants` 迁移的**数据库层证据**（ADR-0076 §2 四）。
 *
 * ## 为什么这一组必须在真实库里跑
 *
 * 后台那三条写路由的判据在 `admin-subscription-grant.spec.ts`，那份用假 prisma ——
 * 它测的是"发出去的查询长什么样"。但这张表有四个性质**只有库能给答案**，
 * 而那四个都是"错了不会报错、只会永远对不上"的形状：
 *
 * | 写错成 | 症状 | 假 prisma 能发现吗 |
 * |---|---|---|
 * | `reason` 可空 | 强制理由变成一句注释：历史行里会出现一片空白，而追溯时没人知道当时为什么发 | ❌（桩会照收） |
 * | 给 `user_id` 加外键 | 注销账号时报 `violates foreign key constraint` —— 第一现场是一次**删号**，不是发放 | ❌ |
 * | 给 `action` 加 CHECK | 词表外的历史行让**读列表**整个 500（A2 那条 CHECK 报错到不了界面的老问题） | ❌ |
 * | 漏掉 `created_at DESC` 那枚索引 | 后台翻页在数据长了之后突然变慢，而本地数据少的时候看不出来 | ❌ |
 *
 * ## 纪律
 *
 * SQL 从**发布中的迁移文件**读出来（不手抄）。锚点检查在 `beforeAll` 里就炸，
 * 而不是变成一组测着不存在结构的绿灯 —— 与 `admin-migration.pglite.spec.ts` 同一口径。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

const MIGRATION_DIR = '20261025000000_add_subscription_grants';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

const migrationSqlFromFile = (): string => {
  const sql = readFileSync(join(migrationsDir, MIGRATION_DIR, 'migration.sql'), 'utf8');
  // 锚点：迁移被改名/重构时在这里就炸，而不是静默测不到东西。
  if (!sql.includes('CREATE TABLE IF NOT EXISTS "subscription_grants"')) {
    throw new Error(
      `${MIGRATION_DIR}/migration.sql 里找不到 \`CREATE TABLE "subscription_grants"\`。\n` +
        '   🔴 迁移被改名/重构时请更新本文件的锚点，而不是把断言删掉 ——\n' +
        '      这张表是后台三种发放唯一能追溯的地方。',
    );
  }
  return sql;
};

const MIGRATION_SQL = migrationSqlFromFile();

let db: PGlite;

const columns = async (): Promise<
  Map<string, { data_type: string; is_nullable: string; column_default: string | null }>
> => {
  const res = await db.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'subscription_grants'`
  );
  return new Map(
    res.rows.map((r) => [
      r.column_name,
      { data_type: r.data_type, is_nullable: r.is_nullable, column_default: r.column_default },
    ]),
  );
};

beforeAll(async () => {
  db = new PGlite();
  // 一张最小的 `users` 表：**故意**建出来，好让"删账号"这一步有东西可删。
  // 被测性质恰恰是这张表跟它**没有关系**。
  await db.exec(MINIMAL_USERS_DDL);
  await db.query('INSERT INTO users (email) VALUES ($1)', ['grantme@example.test']);
  await db.exec(MIGRATION_SQL);
});

afterAll(async () => {
  await db.close();
});

describe(`🔴 迁移 ${MIGRATION_DIR}：表能建、列是对的`, () => {
  it('迁移真实执行（不是"读起来对"）', async () => {
    await expect(db.exec(MIGRATION_SQL)).resolves.not.toThrow();
  });

  it('五个必填列 NOT NULL：user_id / actor_user_id / action / reason / created_at', async () => {
    const cols = await columns();
    for (const name of ['user_id', 'actor_user_id', 'action', 'reason', 'created_at']) {
      expect(cols.get(name)?.is_nullable, `${name} 可空 = 这一格将来会是空的`).toBe('NO');
    }
  });

  it('🔴 `reason` 是 NOT NULL —— "强制写一句人话"落在库上，不是落在注释上', async () => {
    await expect(
      db.query(
        `INSERT INTO subscription_grants (user_id, actor_user_id, action, reason, created_at)
         VALUES (1, 1, 'grant', '', 1)`
      )
    ).resolves.not.toThrow();
    // 空串**进得来**（库拦不住空句子），所以那条强制必须在代码里 ——
    // 这一格断言的不是"库里会拦"，而是"库里拦不住"这个事实本身：
    // 读到这条的人不该以为库已经管住了。真正的闸门在 store 的 `assertGrantReason`。
    await expect(
      db.query(
        `INSERT INTO subscription_grants (user_id, actor_user_id, action, created_at)
         VALUES (1, 1, 'grant', 1)`
      )
    ).rejects.toThrow(/not-null/iu);
  });

  it('三个可空列的语义是"这次动作没有这一维"：sku / days / 前后到期日', async () => {
    const cols = await columns();
    for (const name of ['sku', 'days', 'before_period_end', 'after_period_end']) {
      expect(cols.get(name)?.is_nullable, `${name} 必填会在 revoke 那一条上炸`).toBe('YES');
    }
    // revoke 一行了得（它没有档位、没有天数、没有 before）。
    await expect(
      db.query(
        `INSERT INTO subscription_grants (user_id, actor_user_id, action, reason, after_period_end, created_at)
         VALUES (1, 1, 'revoke', '内测结束', 1793520000000, 1793520000000)`
      )
    ).resolves.not.toThrow();
  });

  it('`grants` 默认空数组 —— 不是 NULL（"这一档不给能力"与"不知道"必须分得开）', async () => {
    const res = await db.query<{ grants: string[] }>(
      `INSERT INTO subscription_grants (user_id, actor_user_id, action, reason, created_at)
       VALUES (1, 1, 'revoke', '收回', 1)
       RETURNING grants`
    );
    expect(res.rows[0]?.grants).toEqual([]);
  });
});

describe(`🔴 迁移 ${MIGRATION_DIR}：这张表与账号之间**没有关系**`, () => {
  it('库层面：一个外键都没有', async () => {
    const res = await db.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name = 'subscription_grants' AND constraint_type = 'FOREIGN KEY'`
    );
    expect(res.rows).toHaveLength(0);
  });

  it('🔴 删掉那个账号，发放史留下来（注销不许改写审计）', async () => {
    // 用一个**这一条专属**的 user_id：前面几条各自往表里塞过 user_id=1 的行，
    // 拿 count(*) WHERE user_id = 1 断言 1 会在"跑次序变了"时假红 —— 那不是判据，是巧合。
    const userId = (await db.query<{ id: number }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      ['dropout@example.test']
    )).rows[0]!.id;

    await db.query(
      `INSERT INTO subscription_grants (user_id, actor_user_id, action, sku, days, reason, created_at)
       VALUES ($1, 1, 'grant', 'hosted-monthly', 30, '内测授权', 1)`,
      [userId]
    );
    await db.query('DELETE FROM users WHERE id = $1', [userId]);

    const res = await db.query<{ n: bigint }>(
      'SELECT count(*) AS n FROM subscription_grants WHERE user_id = $1',
      [userId]
    );
    expect(Number(res.rows[0]?.n ?? 0)).toBe(1);
  });

  it('反方向也成立：给一个不存在的 user_id 发放**写得进去**（所以发放不会被删号卡住）', async () => {
    await expect(
      db.query(
        `INSERT INTO subscription_grants (user_id, actor_user_id, action, reason, created_at)
         VALUES (4242, 1, 'grant', '历史账号补发', 2)`
      )
    ).resolves.not.toThrow();
  });
});

describe(`🔴 迁移 ${MIGRATION_DIR}：词表由代码守，不由 CHECK 守`, () => {
  it('`action` 上没有 CHECK —— 词表外的历史行不许让"读列表"整个 500', async () => {
    // 走 `pg_constraint` 而不是 `information_schema.check_constraints`：
    // 后者按 SQL 标准把每条 `NOT NULL` 也算成一枚 check（实测 7 条），
    // 那种读数**断不出"没有词表 CHECK"** —— 它只会一直红。
    const res = await db.query<{ conname: string; contype: string }>(
      `SELECT conname, contype FROM pg_constraint
        WHERE conrelid = 'subscription_grants'::regclass AND contype = 'c'`
    );
    expect(res.rows).toHaveLength(0);
  });

  it('所以 `gift` 这种词表外的值**进得来**，而读出时由 `toAuditRow` 抛（那份判据在路由测试里）', async () => {
    await expect(
      db.query(
        `INSERT INTO subscription_grants (user_id, actor_user_id, action, reason, created_at)
         VALUES (1, 1, 'gift', '历史脏数据', 3)`
      )
    ).resolves.not.toThrow();
  });
});

describe(`🔴 迁移 ${MIGRATION_DIR}：两个读面各有自己的索引`, () => {
  it('按账号翻发放史、按时间翻全站 —— 两枚都在', async () => {
    const res = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'subscription_grants'`
    );
    const names = res.rows.map((r) => r.indexname);
    expect(names).toContain('subscription_grants_user_id_created_at_idx');
    expect(names).toContain('subscription_grants_created_at_idx');
  });

  it('🔴 两枚索引的**列序与方向**就是那两个读面的形状', async () => {
    const res = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'subscription_grants' ORDER BY indexname`
    );
    const defs = res.rows.map((r) => r.indexdef.toLowerCase().replace(/"/g, ''));

    expect(defs.some((d) => d.includes('(user_id, created_at desc)'))).toBe(true);
    expect(defs.some((d) => d.includes('(created_at desc)'))).toBe(true);
  });

  it('列序反过来（created_at, user_id）会让"按账号翻史"那一页退回全表扫 —— 所以它不是等价写法', async () => {
    // ⚠️ 这一条**故意不断言执行计划**。`EXPLAIN` 在 PGlite 的小表上会选顺序扫，
    // 那是规划器当前成本模型的正确决定，不是这里的缺陷；把它写成断言会得到一条
    // "数据多了就红"的判据。真正的形状证据是上面那条：复合索引的前缀必须是 `user_id`。
    const res = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'subscription_grants'`
    );
    const defs = res.rows.map((r) => r.indexdef.toLowerCase().replace(/"/g, ''));
    expect(defs.some((d) => d.includes('(created_at, user_id'))).toBe(false);
  });
});
