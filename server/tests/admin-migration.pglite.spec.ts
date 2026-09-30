import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

/**
 * `users.is_admin` 迁移的**数据库层证据**。
 *
 * ## 为什么这条必须单独测（而不是"读了 SQL 觉得对"）
 *
 * 这条迁移只加一列，看起来"读过就没问题"。但它有一个**只在生产才暴露**的
 * 性质：它是对**已有数据的表**做 ALTER。写错了有两种安静的死法：
 *
 * | 写错成 | 症状 |
 * |---|---|
 * | `DEFAULT true` | **全部存量用户一夜之间变成管理员** —— 没有任何报错 |
 * | 漏掉 `NOT NULL` | 存量行为 NULL，而 `isAdmin` 在 TS 里是 `boolean` ⇒ `null` 会被当成 falsy 通过，直到某处 `=== false` 比较出错 |
 *
 * 两者都不会让 `prisma migrate deploy` 失败。所以必须在真实数据库里
 * **插入一行存量数据 → 跑迁移 → 再读回来**。
 *
 * ## 纪律
 *
 * SQL 从**发布中的迁移文件**读出来（不手抄）。锚点检查在 setup 阶段就炸，
 * 而不是变成一组测着不存在结构的绿灯 —— 与 `activity-ddl.helper.ts` /
 * `pricing-ddl.helper.ts` 同一口径。
 */

const MIGRATION_DIR = '20261003000000_add_admin_flag';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

const migrationSqlFromFile = (): string => {
  const sql = readFileSync(join(migrationsDir, MIGRATION_DIR, 'migration.sql'), 'utf8');
  // 锚点：迁移被改名/重构时在这里就炸，而不是静默测不到东西。
  if (!sql.includes('ADD COLUMN') || !sql.includes('"is_admin"')) {
    throw new Error(
      `${MIGRATION_DIR}/migration.sql 里找不到 \`ADD COLUMN "is_admin"\`。\n` +
        '   🔴 迁移被改名/重构时请更新本文件的锚点，而不是把断言删掉 ——\n' +
        '      这一列是后台能不能安全开放的唯一开关。',
    );
  }
  return sql;
};

const MIGRATION_SQL = migrationSqlFromFile();

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // 先建"迁移前"的 users 表，**并插入一行存量用户** —— 这是被测性质的前提。
  await db.exec(MINIMAL_USERS_DDL);
  await db.query('INSERT INTO users (email) VALUES ($1)', ['existing@example.test']);
});

afterAll(async () => {
  await db.close();
});

describe(`🔴 迁移 ${MIGRATION_DIR}：存量用户不许变成管理员`, () => {
  it('迁移能真实执行（不是"读起来对"）', async () => {
    await expect(db.exec(MIGRATION_SQL)).resolves.not.toThrow();
  });

  it('列存在、类型是 boolean、NOT NULL', async () => {
    const res = await db.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'is_admin'`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.data_type).toBe('boolean');
    expect(res.rows[0]!.is_nullable, 'is_admin 允许 NULL ⇒ TS 里的 boolean 类型是假的').toBe('NO');
  });

  it('🔴 存量行拿到 false，不是 true 也不是 NULL', async () => {
    // 这条是本次迁移唯一真正危险的性质。`DEFAULT true` 会让它转红。
    const res = await db.query<{ is_admin: boolean | null }>(
      'SELECT is_admin FROM users WHERE email = $1',
      ['existing@example.test'],
    );
    expect(res.rows[0]!.is_admin).toBe(false);
  });

  it('新插入的行默认也是 false（没有人生来是管理员）', async () => {
    const res = await db.query<{ is_admin: boolean }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING is_admin',
      ['fresh@example.test'],
    );
    expect(res.rows[0]!.is_admin).toBe(false);
  });

  it('可以被显式置为 true（CLI 的授权路径真的能写进去）', async () => {
    await db.query('UPDATE users SET is_admin = true WHERE email = $1', ['existing@example.test']);
    const res = await db.query<{ is_admin: boolean }>(
      'SELECT is_admin FROM users WHERE email = $1',
      ['existing@example.test'],
    );
    expect(res.rows[0]!.is_admin).toBe(true);
  });
});
