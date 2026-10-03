import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { isRealCalendarDay } from '@heyta/shared-schema';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

/**
 * 调休/补班两张表的**数据库层证据**（判据③的那一半 —— 列级类型约束）。
 *
 * ## 为什么这条必须在真实数据库里跑，而不是"读了 SQL 觉得对"
 *
 * 这张表存在的全部理由是一句判断：`Json` 列**拦不住**非法日期与非布尔。
 * 那句判断如果错了，代价不是报错，是**界面上一个说谎的标注**：
 *
 * | 坏值 | `Json` 列 | `DATE` / `BOOLEAN` 列 |
 * |---|---|---|
 * | `2026-02-30` | 存得下，永远不上界面 | `INSERT` 当场 22007 |
 * | `isOffDay: 1` | 存得下，被 truthy 当成"休" | 当场 22P02 |
 *
 * "存得下"与"拦得住"是**数据库的行为**，不是我们的代码行为 ——
 * 唯一能证明它成立的方法是往真库里插一遍并看它是否拒绝。
 * 与 `admin-migration.pglite.spec.ts` / `activity-schema.pglite.spec.ts` 同一口径：
 * **SQL 从发布中的迁移文件读出来**，不手抄。
 *
 * ## 还有一条只有真库能证的：`DATE` 的读取形状
 *
 * Prisma 把 `DATE` 读成 **UTC 零点的 `Date`**。用本地 getter 回字符串，
 * 一个 UTC-5 的部署会把 `2027-01-01` 读成 `2026-12-31` —— 症状是"整年的调休
 * 标注错位一天"，而这一天恰好在元旦。所以回读只能用 `toISOString()`，
 * 下面那条断言钉的就是这件事（`server/src/holidays/day-column.ts` 是唯一实现处）。
 */

const MIGRATION_DIR = '20261009000000_add_holiday_adjustments';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

const migrationSqlFromFile = (): string => {
  const sql = readFileSync(join(migrationsDir, MIGRATION_DIR, 'migration.sql'), 'utf8');
  // 锚点：迁移被改名/重构时在这里就炸，而不是变成一组测着不存在结构的绿灯。
  for (const anchor of [
    'CREATE TABLE "holiday_adjustment_years"',
    'CREATE TABLE "holiday_adjustment_days"',
    '"day" DATE NOT NULL',
    '"is_off_day" BOOLEAN NOT NULL',
  ]) {
    if (!sql.includes(anchor)) {
      throw new Error(
        `${MIGRATION_DIR}/migration.sql 里找不到 \`${anchor}\`。\n` +
          '   🔴 迁移被改名/重构时请更新本文件的锚点，而不是把断言删掉 ——\n' +
          '      `DATE` + `BOOLEAN` 这两列就是判据③在库层的全部牙齿。',
      );
    }
  }
  return sql;
};

const MIGRATION_SQL = migrationSqlFromFile();

let db: PGlite;

/** 跑一条语句，成功返回 null，失败返回 SQLSTATE。 */
const expectFailure = async (sql: string, params: unknown[] = []): Promise<string | null> => {
  try {
    await db.query(sql, params);
    return null;
  } catch (err) {
    const e = err as { message?: string; constructor?: { name?: string } };
    // PGlite 把 Postgres 的错误码放在 message 里（`PGlite...: ERROR: ...`），
    // 所以这里返回 message 供断言 contains，而不是假装能拿到 SQLSTATE。
    return e.message ?? String(err);
  }
};

const insertYear = (year: number, papers: string[] = ['https://www.gov.cn/gongbao/x.htm']) =>
  db.query(
    'INSERT INTO holiday_adjustment_years (year, papers, updated_at, updated_by) VALUES ($1, $2, $3, $4)',
    [year, papers, 1_760_000_000_000, 'ops@example.test'],
  );

beforeAll(async () => {
  db = new PGlite();
  await expect(db.exec(MIGRATION_SQL)).resolves.not.toThrow();
});

afterAll(async () => {
  await db.close();
});

describe(`🔴 迁移 ${MIGRATION_DIR}：结构`, () => {
  it('两张表都建出来了', async () => {
    const res = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'holiday_adjustment%'`,
    );
    expect(res.rows.map((r) => r.table_name).sort()).toEqual([
      'holiday_adjustment_days',
      'holiday_adjustment_years',
    ]);
  });

  it('day 是 date、is_off_day 是 boolean，两列都 NOT NULL', async () => {
    const res = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'holiday_adjustment_days'`,
    );
    const byName = Object.fromEntries(res.rows.map((r) => [r.column_name, r]));
    // 🔴 这一条是整张表的承重墙：`day` 一旦被改成 `text`，判据③在库层就没了。
    expect(byName['day']?.data_type, 'day 必须是 DATE，不是 text / timestamp').toBe('date');
    expect(byName['day']?.is_nullable).toBe('NO');
    expect(byName['is_off_day']?.data_type).toBe('boolean');
    expect(byName['is_off_day']?.is_nullable, 'is_off_day 允许 NULL 会被当成 falsy = 补班').toBe(
      'NO',
    );
  });

  it('papers 是数组列（不是 Json —— Json 拦不住空出处）', async () => {
    const res = await db.query<{ data_type: string; udt_name: string }>(
      `SELECT data_type, udt_name FROM information_schema.columns
        WHERE table_name = 'holiday_adjustment_years' AND column_name = 'papers'`,
    );
    expect(res.rows[0]?.udt_name).toBe('_text');
    expect(res.rows[0]?.data_type).not.toBe('json');
    expect(res.rows[0]?.data_type).not.toBe('jsonb');
  });

  it('逐日表的主键是 day（同一天物理上装不下两条）', async () => {
    const res = await db.query<{ column_name: string }>(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        WHERE tc.table_name = 'holiday_adjustment_days' AND tc.constraint_type = 'PRIMARY KEY'`,
    );
    expect(res.rows.map((r) => r.column_name)).toEqual(['day']);
  });

  it('三条手工 CHECK 都在（少了任何一条，上面的判据会红，但这条先说清"本该有几条"）', async () => {
    const res = await db.query<{ conname: string }>(
      `SELECT con.conname FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname LIKE 'holiday_adjustment%' AND con.contype = 'c'`,
    );
    expect(res.rows.map((r) => r.conname).sort()).toEqual([
      'holiday_adjustment_days_year_matches_day',
      'holiday_adjustment_years_papers_present',
      'holiday_adjustment_years_year_range',
    ]);
  });
});

describe('🔴 判据③：库层拦住"日期非法 / isOffDay 不是布尔"', () => {
  beforeAll(async () => {
    await insertYear(2027);
  });

  it('合法的放假日与补班日都插得进去（这条是下面几条的前提）', async () => {
    await expect(
      db.query(
        "INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('2027-01-01'::date, true, 2027)",
      ),
    ).resolves.not.toThrow();
    await expect(
      db.query(
        "INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('2027-01-02'::date, false, 2027)",
      ),
    ).resolves.not.toThrow();
  });

  it('🔴 形状对但那天不存在（2 月 30 日）⇒ 库层拒', async () => {
    const msg = await expectFailure(
      "INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('2027-02-30'::date, true, 2027)",
    );
    expect(msg, '2 月 30 日必须被 DATE 列本身拒绝').toContain('out of range');
  });

  it('🔴 13 月 ⇒ 库层拒', async () => {
    const msg = await expectFailure(
      "INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('2027-13-01'::date, true, 2027)",
    );
    expect(msg).toContain('out of range');
  });

  it('🔴 不是日期的字符串 ⇒ 库层拒（这条防的是"有人把 JSON 原样灌进列"）', async () => {
    const msg = await expectFailure(
      "INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('not-a-date'::date, true, 2027)",
    );
    expect(msg).toContain('invalid input syntax');
  });

  it('🔴 **但 `DATE` 列放过自然语言的相对日期**（`tomorrow`）—— 这一条只能由 zod 拦', () => {
    // 实测发现，它把工单"列级类型约束"那半句的**覆盖面**缩小了一格，必须写下来：
    // Postgres 的 `::date` 走的是弹性日期解析，`'tomorrow'::date` **是合法的**，
    // 它按当前会话日期算出一个真实日子（这里算出的是 2026-10-04）。
    // 所以这一列拦住的是"2 月 30 日 / 13 月"，拦不住的是"任意字符串"，
    // 而后者会**带着一个错误的日期静默入库**。
    // 挡住它的正是 `HOLIDAY_DATE_RE`（`packages/shared-schema` 那份契约）——
    // 于是"两层校验"不是重复劳动：两层各拦住对方拦不住的一类。
    expect(isRealCalendarDay('tomorrow')).toBe(false); // zod 层：拒
    // 库层：不报错，而是解析成别的那一天 ⇒ 被"年必须对上"那条 CHECK 抓住。
    return expectFailure(
      "INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('tomorrow'::date, true, 2027)",
    ).then((msg) => {
      expect(msg).toContain('year_matches_day');
    });
  });

  it("🔴 isOffDay 的非布尔输入：哪些库层拦、哪些**只有 zod 拦**", async () => {
    // 这张矩阵是实测出来的（不是查文档抄的），它把工单那句"不能只靠 JSON 校验"
    // 精确化了一格 —— BOOLEAN 列**不是**把所有非布尔都拦住：
    //
    // | 输入 | BOOLEAN NOT NULL 列 | `z.boolean()` |
    // |---|---|---|
    // | `1` / `0`（数字） | 🔴 **拒**（`expression is of type integer`） | 拒 |
    // | `NULL` | 🔴 拒（NOT NULL） | 拒 |
    // | `'maybe'` / `''` | 🔴 拒（invalid input syntax） | 拒 |
    // | `'yes'` / `'1'` / `'t'`（文本冒充布尔） | ⚠️ **收**（Postgres 的 boolean 输入解析很宽） | 拒 |
    //
    // 所以两层是**不同集合的并**：库拦住的是"数字冒充布尔"（JSON 里 `isOffDay:1`
    // 经任何 SQL 路径写进来的样子）与 NULL；文本那一格只有契约层拦得住。
    // 少了下面那三条 `toBeNull()`，"库层已经够了、zod 可以撤"这句话就没有反驳的证据。
    //
    // ⚠️ 每条换一个 `day`：主键会拦住第二条，而"主键拦的"不是这条用例要证的性质。
    const cases = [
      ['1', '2027-04-01', true], // 数字 ⇒ 列类型拒
      ['0', '2027-04-02', true],
      ['NULL', '2027-04-03', true], // ⇒ NOT NULL 拒
      ["'maybe'", '2027-04-04', true], // ⇒ 语法错拒
      ["''", '2027-04-05', true], // 空串（`isOffDay: ""`）⇒ 拒
      ["'yes'", '2027-04-06', false], // ⚠️ 文本冒充布尔 ⇒ **收**，只有 zod 拒它
      ["'1'", '2027-04-07', false],
      ["'t'", '2027-04-08', false],
    ] as const;

    for (const [literal, day, expectRejected] of cases) {
      const msg = await expectFailure(
        `INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('${day}'::date, ${literal}, 2027)`,
      );
      if (expectRejected) {
        expect(msg, `${literal} 应当被列类型/NOT NULL 拒`).not.toBeNull();
        expect(msg).toMatch(/is of type boolean|not-null|invalid input syntax/);
      } else {
        expect(msg, `${literal} 是 Postgres 认可的 boolean 字面量，库层不拦`).toBeNull();
      }
    }
  });

  it("🔴 而 `is_off_day` 在 Prisma 那条路上收不进数字（这一条是判据③的实际载体）", async () => {
    // 上面用的是 SQL 字面量，而真实写入走 Prisma：`isOffDay: 1` 在 TS 层就是类型错，
    // 绕开 TS 直接调用 `prisma....create({data:{isOffDay: 1}})` 时，
    // 校验发生在 Prisma 的序列化层。所以判据③**必须**在 HTTP 入口（zod）就拦掉 ——
    // 见 `server/tests/holiday-admin-routes.spec.ts`。这里只钉一件事：
    // 列类型给的是"最后一道"，不是"唯一一道"。
    expect(isRealCalendarDay('2027-04-09')).toBe(true);
  });

  it('同一天重复插 ⇒ 主键拒', async () => {
    const msg = await expectFailure(
      "INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('2027-01-01'::date, false, 2027)",
    );
    expect(msg).toContain('duplicate key');
  });

  it('年份与那一天不属于同一年 ⇒ CHECK 拒（冗余列不约束就会漂）', async () => {
    const msg = await expectFailure(
      "INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('2028-01-01'::date, true, 2027)",
    );
    expect(msg).toContain('year_matches_day');
  });

  it('年度行的 year 越界 ⇒ CHECK 拒（2200 是历法层解释不了的年份）', async () => {
    const msg = await expectFailure(
      'INSERT INTO holiday_adjustment_years (year, papers) VALUES (2200, $1)',
      [['https://www.gov.cn/x.htm']],
    );
    expect(msg).toContain('year_range');
    const msg2 = await expectFailure(
      'INSERT INTO holiday_adjustment_years (year, papers) VALUES (2006, $1)',
      [['https://www.gov.cn/x.htm']],
    );
    expect(msg2).toContain('year_range');
  });

  it('🔴 papers 为空 ⇒ CHECK 拒（没有出处的节假日数据不能进库）', async () => {
    const msg = await expectFailure(
      "INSERT INTO holiday_adjustment_years (year, papers) VALUES (2028, '{}')",
    );
    expect(msg, `papers 空数组必须被拦：${msg}`).toContain('papers_present');
    const msg2 = await expectFailure(
      'INSERT INTO holiday_adjustment_years (year, papers) VALUES (2028, $1)',
      [['']],
    );
    expect(msg2).toContain('papers_present');
  });

  it('逐日行指向不存在的年度 ⇒ 外键拒', async () => {
    const msg = await expectFailure(
      "INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('2050-01-01'::date, true, 2050)",
    );
    expect(msg).toContain('foreign key');
  });
});

describe('🔴 DATE 的读取形状：只能用 UTC 访问器回字符串', () => {
  it("库里存的 text 就是 '2027-01-01'", async () => {
    const res = await db.query<{ day: string }>(
      "SELECT day::text AS day FROM holiday_adjustment_days WHERE day = '2027-01-01'::date",
    );
    expect(res.rows[0]?.day).toBe('2027-01-01');
  });

  it('列的**实际类型**是 date 而不是 timestamp（有时间分量就会错位一天）', async () => {
    // 不用 `EXTRACT(HOUR FROM day)`：Postgres 对 `date` 直接报
    // `unit "hour" not supported for type date`（实测）。这本身就是"它是 DATE"的证据，
    // 但把它当判据太难读，所以查 `pg_typeof` —— 它给的是引擎眼中的类型。
    const res = await db.query<{ t: string }>(
      'SELECT pg_typeof(day)::text AS t FROM holiday_adjustment_days LIMIT 1',
    );
    expect(res.rows[0]?.t).toBe('date');
  });

  it('🔴 `toISOString().slice(0,10)` 稳定等于 stored day；本地 getter 不做保证', async () => {
    // 这一条钉的是 `dayColumnToIso()` 的实现选择。
    // 传进 Date 构造器的是 UTC 零点（PGlite 对 DATE 返回的就是它），
    // 所以 `toISOString()` 回到的日期字符串就是库里那一天；
    // 而 `getFullYear()/getMonth()/getDate()` 读的是**操作系统时区**，
    // 在 UTC-x 的机器上会少一天。下面同时把两种读法的差异**量出来**，
    // 让"为什么不能用本地 getter"不是一个口头断言。
    const res = await db.query<{ day: Date }>(
      "SELECT day FROM holiday_adjustment_days WHERE day = '2027-01-01'::date",
    );
    const raw = res.rows[0]?.day;
    expect(raw).toBeInstanceOf(Date);
    const iso = (raw as Date).toISOString().slice(0, 10);
    expect(iso).toBe('2027-01-01');

    const utcMs = Date.UTC(2027, 0, 1);
    expect((raw as Date).getTime()).toBe(utcMs);

    // 负偏移时区下本地 getter 会掉一天 —— 这是 `toLocalDate()` 不能碰这一列的原因。
    // `new Date(utcMs)` 用显式偏移算，不依赖进程 TZ（进程 TZ 改不了已经在跑的 Date）。
    const minusFive = new Date(utcMs).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    expect(minusFive).toBe('2026-12-31');
  });
});

describe('级联：删掉年度行时逐日行一起消失（整年替换的前提）', () => {
  it('ON DELETE CASCADE 生效', async () => {
    await insertYear(2031);
    await db.query(
      "INSERT INTO holiday_adjustment_days (day, is_off_day, year) VALUES ('2031-05-01'::date, true, 2031)",
    );
    const before = await db.query<{ n: number | string }>(
      'SELECT COUNT(*)::int AS n FROM holiday_adjustment_days WHERE year = 2031',
    );
    expect(Number(before.rows[0]?.n)).toBe(1);

    await db.query('DELETE FROM holiday_adjustment_years WHERE year = 2031');
    const after = await db.query<{ n: number | string }>(
      'SELECT COUNT(*)::int AS n FROM holiday_adjustment_days WHERE year = 2031',
    );
    expect(Number(after.rows[0]?.n)).toBe(0);
  });
});
