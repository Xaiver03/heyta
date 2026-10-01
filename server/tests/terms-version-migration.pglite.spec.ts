import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';
import { LEGAL_SET_VERSION } from '../src/legal.generated';

/**
 * `users.terms_document_version` 迁移的**数据库层证据**。
 * ======================================================
 *
 * 这一列只加一个可空字段，看起来"读过 SQL 就没问题"。但它有一个**只在真实库上
 * 才暴露**的性质，而且它的两种写错方式都恰好是本项目对外文本承诺过的红线：
 *
 * | 写错成 | 症状 |
 * |---|---|
 * | `DEFAULT '1.0'`（或任何非空默认值） | **全部存量账号一夜之间带上一个版本号** —— 而这些人从没同意过那个版本。这是"发明同意"的数据库版本，比 NULL 严重得多，因为查起来像证据 |
 * | 迁移里顺手 `UPDATE users SET terms_document_version = …` | 同上，且更隐蔽：新写入路径是对的，历史行被回填成假的 |
 *
 * 两者都不会让 `prisma migrate deploy` 失败。所以必须**先插入存量行 → 跑真迁移 → 读回来**。
 *
 * 🔴 与 `admin-migration.pglite.spec.ts` 的分工：那一列的危险方向是"默认 true 会让
 * 所有人变成管理员"，这一列的危险方向是"默认非空会让所有人同意过一套没给他们看过的文本"。
 * 形状相似、判据不同，所以两份都要存在，不能合成一份。
 *
 * ## 纪律
 *
 * SQL 从**发布中的迁移文件**读出来（不手抄）。锚点检查在 setup 阶段就炸，
 * 而不是变成一组测着不存在结构的绿灯。
 */

const MIGRATION_DIR = '20261006000000_add_terms_document_version';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

const migrationSqlFromFile = (): string => {
  const sql = readFileSync(join(migrationsDir, MIGRATION_DIR, 'migration.sql'), 'utf8');
  // 锚点：迁移被改名/重构时在这里就炸，而不是静默测不到东西。
  if (!sql.includes('ADD COLUMN') || !sql.includes('"terms_document_version"')) {
    throw new Error(
      `${MIGRATION_DIR}/migration.sql 里找不到 \`ADD COLUMN "terms_document_version"\`。\n` +
        '   🔴 迁移被改名/重构时请更新本文件的锚点，而不是把断言删掉 ——\n' +
        '      这一列是"用户同意的是哪一版文本"唯一的数据库侧答案。',
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
  await db.query('INSERT INTO users (email) VALUES ($1)', ['legacy@example.test']);
});

afterAll(async () => {
  await db.close();
});

describe(`🔴 迁移 ${MIGRATION_DIR}：存量账号不许带上版本号`, () => {
  it('迁移能在**有数据的表**上真实执行', async () => {
    await expect(db.exec(MIGRATION_SQL)).resolves.not.toThrow();
  });

  it('列存在、类型是 text、可空', async () => {
    const res = await db.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'terms_document_version'`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.data_type).toBe('text');
    // 🔴 这里**必须**是可空：NOT NULL 会逼出一个默认值，而默认值就是"发明同意"。
    // 与 `is_admin` 那条相反 —— 那列要 NOT NULL DEFAULT false（布尔的"没人天生是管理员"），
    // 这列没有任何合法默认值（没人天生同意过某个版本）。
    expect(res.rows[0]!.is_nullable).toBe('YES');
  });

  it('🔴 存量行拿到 NULL，不是版本号也不是空串', async () => {
    // 这条是本迁移唯一真正危险的性质。加 `DEFAULT` 或顺手 UPDATE 回填都会让它转红。
    const res = await db.query<{ terms_document_version: string | null }>(
      'SELECT terms_document_version FROM users WHERE email = $1',
      ['legacy@example.test'],
    );
    expect(res.rows[0]!.terms_document_version).toBeNull();
  });

  it('空串也不算"没同意过某版"：列没有 DEFAULT，新行不写就是 NULL', async () => {
    const res = await db.query<{ terms_document_version: string | null }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING terms_document_version',
      ['fresh@example.test'],
    );
    expect(res.rows[0]!.terms_document_version).toBeNull();
  });

  it('整套版本指纹装得下、读得回来（text 不是 varchar(n)）', async () => {
    // 指纹是**九份文档的整套**拼接，长度会随文本增加而增长。写成 varchar(n) 的
    // 话，将来加一份文档就会在写入时炸 —— 而那正是"同意留痕"最不该坏的地方。
    expect(LEGAL_SET_VERSION.length).toBeGreaterThan(64);
    await db.query('UPDATE users SET terms_document_version = $1 WHERE email = $2', [
      LEGAL_SET_VERSION,
      'fresh@example.test',
    ]);
    const res = await db.query<{ terms_document_version: string }>(
      'SELECT terms_document_version FROM users WHERE email = $1',
      ['fresh@example.test'],
    );
    expect(res.rows[0]!.terms_document_version).toBe(LEGAL_SET_VERSION);
  });
});
