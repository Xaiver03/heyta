import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';
import { LEGAL_SET_VERSION } from '../src/legal.generated';

/**
 * `user_consents` 迁移的**数据库层证据**（台账 G-27）。
 * ==================================================
 *
 * 这张表看起来是"新建一张空表，读过 SQL 就没问题"。它有两条**只在真实库上暴露**的性质，
 * 而两条的写错方向都恰好落在本项目对外文本已经承诺过的红线上：
 *
 * | 写错成 | 症状 |
 * |---|---|
 * | 迁移里顺手给存量账号 `INSERT` 一行历史 | **凭空造出 N 条同意记录**。查起来像证据，实际是发明同意 —— 与 `20261006000000` 那笔的 `DEFAULT '1.0'` 是同一种错，只是这次一次造整行而不是一列 |
 * | 把 `@@unique` 写成普通索引 | "重新确认"会长出第二行同一版的记录 ⇒ 取"最新一条"时按 `accepted_at` 排，客户端时钟一慢就挑到旧版 ⇒ 已经补签的人**又被拦一次**，而且没有任何一层报错 |
 *
 * 两者都不会让部署脚本失败。所以这里**先插存量用户 → 跑真迁移 → 读回来**，
 * 并且真的往表里塞两次同版本的记录去看它拦不拦。
 *
 * 🔴 第三类判据是这张表自己的边界：**列集合必须恰好是这六个**。
 * 研究文档层 3 的草稿里还有 `document_hash` 与 `surface`（来源端）两列，本轮**故意不收** ——
 * 对外文本承诺记录的是"同意时刻 + 版本号"（`privacy.ts` 第 12 条），多收一项就是先采集后告知
 *（G-28 裁决过那个顺序）。把这两列写进断言，是为了让"有人照草稿顺手补回来"当场变红，
 * 而不是三年后在库里发现一批从未宣告过的采集。
 *
 * ## 纪律
 *
 * SQL 从**发布中的迁移文件**读出来（不手抄）。锚点检查在 setup 阶段就炸，
 * 而不是变成一组测着不存在结构的绿灯。
 */

const MIGRATION_DIR = '20261007000000_add_user_consent_history';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

const migrationSqlFromFile = (): string => {
  const sql = readFileSync(join(migrationsDir, MIGRATION_DIR, 'migration.sql'), 'utf8');
  // 锚点：迁移被改名/重构时在这里就炸，而不是静默测不到东西。
  if (!sql.includes('CREATE TABLE "user_consents"')) {
    throw new Error(
      `${MIGRATION_DIR}/migration.sql 里找不到 \`CREATE TABLE "user_consents"\`。\n` +
        '   🔴 迁移被改名/重构时请更新本文件的锚点，而不是把断言删掉 ——\n' +
        '      这张表是"一个人先后同意过哪几版文本"唯一的数据库侧答案。',
    );
  }
  return sql;
};

const MIGRATION_SQL = migrationSqlFromFile();

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // 先建"迁移前"的 users 表，**并插入存量用户** —— 这是"不许造历史行"那条判据的前提。
  await db.exec(MINIMAL_USERS_DDL);
  await db.query('INSERT INTO users (email) VALUES ($1)', ['legacy@example.test']);
});

afterAll(async () => {
  await db.close();
});

describe(`🔴 迁移 ${MIGRATION_DIR}：同意历史表`, () => {
  it('迁移能在**已有用户**的库上真实执行', async () => {
    await expect(db.exec(MIGRATION_SQL)).resolves.not.toThrow();
  });

  it('表建出来了，且列集合**恰好**是这六个 —— 没有 document_hash、没有 surface', async () => {
    const res = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'user_consents' ORDER BY column_name`,
    );
    expect(res.rows.map((r) => r.column_name)).toEqual([
      'accepted_at',
      'document_version',
      'id',
      'kind',
      'server_received_at',
      'user_id',
    ]);
    // 上面那条按名排序做逐元素比较已经能抓住"多一列"，这里再点名一次失败原因：
    // 断言写成"恰好六个"而不是"至少这六个"，是为了让照草稿补列的行为必须改这条判据才能过。
    expect(res.rows).toHaveLength(6);
  });

  it('🔴 存量用户**一行历史都没有**（迁移不许回填同意记录）', async () => {
    // 这条是本迁移最危险的性质：给老账号造历史行 = 发明同意。
    // 在迁移里加一句 INSERT INTO user_consents SELECT … FROM users 就会让它转红。
    const res = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM user_consents
        WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      ['legacy@example.test'],
    );
    expect(res.rows[0]!.n).toBe('0');
  });

  it('`accepted_at` 没有默认值：没有时间戳的同意记录根本插不进去', async () => {
    const nullable = await db.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'user_consents' AND column_name = 'accepted_at'`,
    );
    expect(nullable.rows[0]!.is_nullable).toBe('NO');

    // "非空 + 无默认"才是真判据：光看 NOT NULL 会漏掉 `DEFAULT 0` 那种形状 ——
    // 它插得进去，但记下的是一条同意时刻为 epoch 0 的假证据。
    const hasDefault = await db.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'user_consents' AND column_name = 'accepted_at'`,
    );
    expect(hasDefault.rows[0]!.column_default).toBeNull();

    await expect(
      db.query(
        `INSERT INTO user_consents (user_id, kind, document_version)
         VALUES ((SELECT id FROM users WHERE email = $1), 'legal_set', 'x@1.0')`,
        ['legacy@example.test'],
      ),
    ).rejects.toThrow(/not-null/i);
  });

  it('`server_received_at` 有默认 0 —— 内部补写路径不逼调用方伪造客户端时刻', async () => {
    const res = await db.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'user_consents' AND column_name = 'server_received_at'`,
    );
    expect(res.rows[0]!.column_default).toContain('0');
  });

  it('🔴 同一人对同一版**只有一条**：重复确认被唯一索引当场拒掉', async () => {
    // 这条是"补签过一次之后不会被同一版反复拦"的地基。写成普通索引它就失效，
    // 而失效的症状不是报错，是"取最新一条"时按客户端时钟挑到旧版本。
    const userId = '(SELECT id FROM users WHERE email = $1)';
    await db.query(
      `INSERT INTO user_consents (user_id, kind, document_version, accepted_at)
       VALUES (${userId}, 'legal_set', $2, $3)`,
      ['legacy@example.test', LEGAL_SET_VERSION, 1_700_000_000_000],
    );
    await expect(
      db.query(
        `INSERT INTO user_consents (user_id, kind, document_version, accepted_at)
         VALUES (${userId}, 'legal_set', $2, $3)`,
        ['legacy@example.test', LEGAL_SET_VERSION, 1_700_000_000_999],
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('✅ 新旧两个版本号**能并存**：这正是这张表存在的理由', async () => {
    // 一列指针存不下"先同意过 1.0、改版后又同意过 1.1"。这里就是那条性质的正面证据，
    // 也是它与上一条（同版本被拒）配对的意义：唯一性按 (人, 事项, **版本**) 生效，不是按 (人, 事项)。
    const userId = '(SELECT id FROM users WHERE email = $1)';
    const res = await db.query(
      `INSERT INTO user_consents (user_id, kind, document_version, accepted_at)
       VALUES (${userId}, 'legal_set', 'terms@1.0;privacy@1.0', $2)
       RETURNING id`,
      ['legacy@example.test', 1_600_000_000_000],
    );
    expect(res.rows).toHaveLength(1);
    const count = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM user_consents
        WHERE user_id = (SELECT id FROM users WHERE email = 'legacy@example.test')`,
    );
    // 上一条被拒（同一版），这一条进来（不同版）⇒ 总数恰好 2。
    expect(count.rows[0]!.n).toBe('2');
  });

  it('整套版本指纹装得下、读得回来（text 不是 varchar(n)）', async () => {
    // 指纹是九份文档的整套拼接，长度随文本增加而增长。写成 varchar(n) 的话，
    // 将来加一份文档就在**写同意记录**的那一刻炸 —— 那是最不该坏的写入路径。
    expect(LEGAL_SET_VERSION.length).toBeGreaterThan(64);
    const res = await db.query<{ document_version: string }>(
      `SELECT document_version FROM user_consents
        WHERE user_id = (SELECT id FROM users WHERE email = $1) AND document_version = $2`,
      ['legacy@example.test', LEGAL_SET_VERSION],
    );
    expect(res.rows[0]!.document_version).toBe(LEGAL_SET_VERSION);
  });

  it('外键是 `ON DELETE CASCADE`：注销账号时历史行随账号消失', async () => {
    const constraint = await db.query<{ delete_rule: string }>(
      `SELECT delete_rule FROM information_schema.referential_constraints
        WHERE constraint_name = 'user_consents_user_id_fkey'`,
    );
    expect(constraint.rows[0]!.delete_rule).toBe('CASCADE');

    await db.query('DELETE FROM users WHERE email = $1', ['legacy@example.test']);
    const left = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM user_consents');
    expect(left.rows[0]!.n).toBe('0');
  });
});
