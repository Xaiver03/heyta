import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

/**
 * `20261008000000_add_account_profile` 的**数据库层证据**（R10）
 * ===========================================================
 *
 * ## 为什么这条必须单独测（而不是"读了 SQL 觉得对"）
 *
 * 这条迁移加一列、一张表、一条外键，看起来读过就没问题。它有三个
 * **只在真实数据库里才会暴露**的性质，每一个写错了都不会让
 * `prisma migrate deploy` 失败：
 *
 * | 性质 | 写错成 | 症状 |
 * |---|---|---|
 * | `display_name` 必须**可空** | `NOT NULL`（或给 `DEFAULT ''`） | 存量行 ALTER 当场失败，或存量用户凭空多出一个"空昵称"，而 §8.4 承诺的"空 = 从未设置 ⇒ 回落到邮箱派生名"从此分不出来 |
 * | 外键必须 **ON DELETE CASCADE** | 漏掉，或 `SET NULL` | 「注销账号即真删除」那句政策变成假话 —— 用户行删了，**照片密文留在库里**。这是本条最重要的一个 |
 * | `user_id` 必须是**主键** | 只建普通索引 | 一个用户多行头像；`upsert` 退化成越插越多，而界面只读第一行 |
 *
 * 再加上一个 `bytea` 的真实往返（含 `0x00` 的密文经不被文本处理破坏）——
 * 头像的整个产品承诺是"存的是解不开的字节"，如果驱动层把字节改了，
 * 那句承诺和"能不能解回来"是同一件事。
 *
 * ## 纪律
 *
 * SQL 从**发布中的迁移文件**读出来，不手抄（`admin-migration.pglite.spec.ts`
 * 与 `pricing-ddl.helper.ts` 同一口径）。锚点缺失时在 setup 阶段就炸，
 * 而不是变成一组测着不存在结构的绿灯。
 */

const MIGRATION_DIR = '20261008000000_add_account_profile';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

const migrationSqlFromFile = (): string => {
  const sql = readFileSync(join(migrationsDir, MIGRATION_DIR, 'migration.sql'), 'utf8');
  const missing = [
    ['ADD COLUMN', '"display_name"'],
    ['CREATE TABLE', '"user_avatars"'],
    ['FOREIGN KEY', '"user_id"'],
  ].filter(([needle]) => !sql.includes(needle));
  if (missing.length > 0) {
    throw new Error(
      `${MIGRATION_DIR}/migration.sql 里缺：${missing.map((m) => m[0]).join(', ')}。\n` +
        '   🔴 迁移被改名/重构时请更新本文件的锚点，而不是把断言删掉 ——\n' +
        '      那三个锚点是下面每一条判据的前提。',
    );
  }
  return sql;
};

const MIGRATION_SQL = migrationSqlFromFile();

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // 先建"迁移前"的 users 表，**并插入两行存量用户** —— 存量数据是被测性质的前提。
  await db.exec(MINIMAL_USERS_DDL);
  await db.query('INSERT INTO users (email) VALUES ($1)', ['existing-a@example.test']);
  await db.query('INSERT INTO users (email) VALUES ($1)', ['existing-b@example.test']);
  await db.exec(MIGRATION_SQL);
});

afterAll(async () => {
  await db.close();
});

describe('存量数据（迁移之后不许被顺手写上一个值）', () => {
  it('两行存量用户的 display_name 都是 **NULL**，不是空串', async () => {
    const rows = await db.query<{ email: string; display_name: string | null }>(
      'SELECT email, display_name FROM users ORDER BY id',
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      // 🔴 `null` 与 `''` 是两件事：界面靠"是不是 null"决定要不要回落到
      // 邮箱派生名。给存量行填 `''` 的症状不是报错，是**每个人的昵称框凭空多一个空值**，
      // 而"从未设置过"这个信息永久丢失。
      expect(row.display_name, `${row.email} 的昵称不是 NULL ⇒ 存量行被写上了值`).toBeNull();
    }
  });

  it('新账号可以不填昵称就插入（这一列真的可选）', async () => {
    await expect(
      db.query('INSERT INTO users (email) VALUES ($1)', ['no-nickname@example.test']),
    ).resolves.toBeTruthy();
  });

  it('昵称能写、能清空（回到 NULL），且没有唯一约束', async () => {
    await db.query('UPDATE users SET display_name = $1 WHERE email = $2', [
      '小鹿',
      'existing-a@example.test',
    ]);
    const one = await db.query<{ display_name: string | null }>(
      'SELECT display_name FROM users WHERE email = $1',
      ['existing-a@example.test'],
    );
    expect(one.rows[0]?.display_name).toBe('小鹿');

    // 两个人用同一个昵称必须插得进去 —— 标识与显示名分离是这条裁决的一部分。
    await db.query('UPDATE users SET display_name = $1 WHERE email = $2', [
      '小鹿',
      'existing-b@example.test',
    ]);
    const dupes = await db.query<{ c: string }>(
      'SELECT display_name AS c FROM users WHERE display_name = $1',
      ['小鹿'],
    );
    expect(dupes.rows).toHaveLength(2);

    await db.query('UPDATE users SET display_name = NULL WHERE email = $1', [
      'existing-a@example.test',
    ]);
    const cleared = await db.query<{ display_name: string | null }>(
      'SELECT display_name FROM users WHERE email = $1',
      ['existing-a@example.test'],
    );
    expect(cleared.rows[0]?.display_name).toBeNull();
  });
});

describe('user_avatars：一人一行、二进制原样往返', () => {
  const userId = async (email: string): Promise<number> => {
    const r = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    return Number(r.rows[0]?.id);
  };

  it('cipher 是 bytea：含 0x00 的字节序列存进去能**逐字节**取回来', async () => {
    const id = await userId('existing-a@example.test');
    // 真 Argon2id 密文的头两个字节是盐，里面**必然**可能出现 0x00；
    // 用 text 存就会在那里截断，而"解不开头像"是用户侧唯一症状。
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 0, 65, 66, 0]);
    await db.query(
      'INSERT INTO user_avatars (user_id, cipher, hash, updated_at) VALUES ($1, $2, $3, $4)',
      [id, Buffer.from(bytes), 'hash-a', BigInt(1) as unknown as string],
    );
    const back = await db.query<{ cipher: Uint8Array }>(
      'SELECT cipher FROM user_avatars WHERE user_id = $1',
      [id],
    );
    expect(Array.from(back.rows[0]?.cipher ?? [])).toEqual(Array.from(bytes));
  });

  it('user_id 是主键 ⇒ 同一个人插第二行会被拒', async () => {
    const id = await userId('existing-b@example.test');
    const insert = (hash: string): Promise<unknown> =>
      db.query(
        'INSERT INTO user_avatars (user_id, cipher, hash, updated_at) VALUES ($1, $2, $3, $4)',
        [id, Buffer.from([1, 2, 3]), hash, BigInt(1) as unknown as string],
      );
    await insert('hash-first');
    // 🔴 这条不是洁癖：`upsert({where:{userId}})` 的前提就是"一人一行"。
    // 如果它只是普通索引，重复上传会越插越多，而读侧只取一行 ——
    // 症状是"另一台设备上的头像永远停在某一天的旧图"，且不报错。
    await expect(insert('hash-second')).rejects.toThrow();
    const count = await db.query<{ c: string }>(
      'SELECT count(*) AS c FROM user_avatars WHERE user_id = $1',
      [id],
    );
    // ⚠️ `count(*)` 在 pglite 里回的是**数字** 1 而不是字符串（真实 node-pg 回字符串），
    // 所以这里归一化再比 —— 判据不该依赖驱动怎么序列化一个聚合值。
    expect(Number(count.rows[0]?.c)).toBe(1);
  });

  it('不是孤儿：给不存在的人插头像会被外键挡住', async () => {
    await expect(
      db.query(
        'INSERT INTO user_avatars (user_id, cipher, hash, updated_at) VALUES ($1, $2, $3, $4)',
        [999_999, Buffer.from([9]), 'ghost', BigInt(1) as unknown as string],
      ),
    ).rejects.toThrow();
  });
});

describe('🔴 注销账号即真删除：照片密文必须跟着走', () => {
  it('删掉 users 那行，user_avatars 里那一行**同一次**就没了', async () => {
    const id = Number(
      (
        await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
          'existing-b@example.test',
        ])
      ).rows[0]?.id,
    );
    const before = await db.query<{ c: string }>(
      'SELECT count(*) AS c FROM user_avatars WHERE user_id = $1',
      [id],
    );
    expect(Number(before.rows[0]?.c)).toBeGreaterThan(0);

    await db.query('DELETE FROM users WHERE id = $1', [id]);

    const after = await db.query<{ c: string }>(
      'SELECT count(*) AS c FROM user_avatars WHERE user_id = $1',
      [id],
    );
    // 这一条兜的是**对外承诺**：`privacy.ts` 那句"注销是**真删除**：账号行连同名下的
    // ……昵称与头像按数据库级联删除（共 19 处级联）"。
    // 漏了 CASCADE 的后果不是报错，是**用户的照片密文留在库里**而没人知道，
    // 而那句话就成了假话 —— 这正是 `structure.spec.ts` 里那条 19 的数对账
    // 只数得出"有没有这条级联"，数不出"它是不是 CASCADE"。
    expect(Number(after.rows[0]?.c)).toBe(0);
  });
});
