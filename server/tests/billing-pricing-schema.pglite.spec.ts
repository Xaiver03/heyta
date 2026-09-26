import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRICING_SCHEMA_DDL, pricingDdlFromMigration } from './pricing-ddl.helper';

/**
 * 定价/优惠券的**数据库层**不变量证据。
 *
 * 为什么这一层必须单独有测试：`money.ts` / `coupon.ts` 里的不变量只在
 * **应用层算得对**的时候成立。而"折扣算错"这件事的最后一道防线应该是
 * **写不进库**，不是"TS 类型上说不会发生"。
 *
 * 本文件跑的是**发布中的迁移 SQL**（`pricing-ddl.helper.ts` 从
 * `prisma/migrations/.../migration.sql` 读出来），不是手抄的表结构 ——
 * 抄一份测试只能证明抄本是对的。
 *
 * 🔴 每个断言都配一个**合法的**对照行：只测"非法被拒"的话，一个把所有插入都
 * 拒绝的迁移（比如列名写错）会全绿。所以每一条都是
 * 「合法的能进去 + 非法的进不去」成对出现。
 */

const MIGRATION_DDL = pricingDdlFromMigration();

/**
 * 剥掉**整行** `--` 注释后的 SQL。
 *
 * 🔴 这一步是必需的，而且仓库里已经吃过同一个亏：`scripts/check-migrations.mjs`
 * 的文件头记着，迁移文件经常在注释里**提到** CONCURRENTLY 来解释自己，
 * 不剥注释就会把这类文件误判成"多语句 CONCURRENTLY 迁移"而报假错
 * （实测数错过一次 10 vs 3）。本文件的第一个断言正好踩进了同一个坑 ——
 * 本迁移的表头注释里就写着"不需要 CONCURRENTLY"。
 *
 * 只剥整行注释：与迁移解析器的前提一致（行内 `--` 会被 `check-migrations.mjs`
 * 报成 warning，所以本仓迁移里不该出现行内注释）。
 */
const stripLineComments = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const MIGRATION_SQL_ONLY = stripLineComments(MIGRATION_DDL);

/** 按 `;` 切出语句，用于"有没有某类语句"，而不是"文本里有没有这个词"。 */
const statementsOf = (sql: string): string[] =>
  sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '');

let db: PGlite;

/** 插入一个用户，返回 id。 */
const insertUser = async (email: string): Promise<number> => {
  const res = await db.query<{ id: number }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [email],
  );
  return res.rows[0]!.id;
};

/** 插一笔合法订单所需的全部前置，返回 userId。 */
let userSeq = 0;
const freshUser = async (): Promise<number> => {
  userSeq += 1;
  return insertUser(`u${userSeq}@example.test`);
};

const insertOrder = async (
  userId: number,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<number> => {
  const row = {
    out_trade_no: `hy${userSeq}x${Math.random().toString(36).slice(2, 8)}xdeadbeef`,
    user_id: userId,
    provider: 'wechat',
    price_id: 'annual',
    currency: 'CNY',
    region: 'CN',
    original_amount_minor: 9_900,
    discount_minor: 0,
    final_amount_minor: 9_900,
    coupon_id: null,
    status: 'pending',
    quoted_at: 1_800_000_000_000n,
    expires_at: 1_800_007_200_000n,
    ...overrides,
  };
  const cols = Object.keys(row);
  const values = Object.values(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const res = await db.query<{ id: number }>(
    `INSERT INTO checkout_orders (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values,
  );
  return res.rows[0]!.id;
};

const insertCoupon = async (
  overrides: Partial<Record<string, unknown>> = {},
): Promise<string> => {
  const id = `c${Math.random().toString(36).slice(2, 10)}`;
  const row = {
    id,
    code: null,
    name: '测试券',
    kind: 'fixed',
    percent_off_bp: null,
    amount_off_minor: 2_000,
    currency: 'CNY',
    valid_from: 0n,
    valid_until: null,
    ...overrides,
  };
  const cols = Object.keys(row);
  const values = Object.values(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(`INSERT INTO coupons (${cols.join(', ')}) VALUES (${placeholders})`, values);
  return id;
};

const insertRedemption = async (
  couponId: string,
  userId: number,
  orderId: number,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<void> => {
  const row = {
    coupon_id: couponId,
    user_id: userId,
    order_id: orderId,
    state: 'reserved',
    original_amount_minor: 9_900,
    discount_minor: 2_000,
    final_amount_minor: 7_900,
    currency: 'CNY',
    reserved_until: 1_800_007_200_000n,
    created_at: 1_800_000_000_000n,
    ...overrides,
  };
  const cols = Object.keys(row);
  const values = Object.values(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(
    `INSERT INTO coupon_redemptions (${cols.join(', ')}) VALUES (${placeholders})`,
    values,
  );
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(PRICING_SCHEMA_DDL);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('迁移 SQL：形状', () => {
  it('五张表都建出来了', async () => {
    const res = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
    );
    const names = res.rows.map((r) => r.table_name);
    for (const t of [
      'coupons',
      'checkout_orders',
      'coupon_redemptions',
      'price_versions',
      'pricing_audit_log',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('迁移里没有 CONCURRENTLY —— 新表不该走并发建索引（AGENTS.md §4 优先级 1）', () => {
    // 有的话这个迁移在 `prisma migrate deploy` 上会走恢复路径，那是给已有大表用的。
    // 判据必须用**剥注释后的 SQL**：表头注释里正好写着"不需要 CONCURRENTLY"。
    expect(MIGRATION_SQL_ONLY).not.toContain('CONCURRENTLY');
  });

  it('迁移里没有删表、没有回填、没有删数据（逐条语句判断，不是文本匹配）', () => {
    // 文本匹配会误伤 FK 的 `ON UPDATE CASCADE` —— 那是"级联行为"，不是一条 UPDATE 语句。
    const forbidden = /^(DROP\s+TABLE|UPDATE|DELETE|TRUNCATE|ALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN)/i;
    for (const stmt of statementsOf(MIGRATION_SQL_ONLY)) {
      expect(stmt).not.toMatch(forbidden);
    }
  });

  it('`coupon_redemptions.order_id` 是唯一的 —— 一单一券的数据库层保证', async () => {
    const res = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'coupon_redemptions' AND indexname = 'coupon_redemptions_order_id_key'",
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.indexdef).toMatch(/UNIQUE/);
  });
});

describe('price_versions 的 CHECK', () => {
  it('合法的正数金额能进去', async () => {
    await db.exec(
      `INSERT INTO price_versions (price_id, currency, amount_minor, effective_from, effective_until)
       VALUES ('annual', 'CNY', 9900, 0, NULL)`,
    );
    const res = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM price_versions');
    expect(res.rows[0]!.n).toBe(1);
  });

  it('金额 0 或负数被数据库拒绝（0 元不是免费档，是这个 SKU 不该存在）', async () => {
    for (const amount of [0, -1]) {
      await expect(
        db.exec(
          `INSERT INTO price_versions (price_id, currency, amount_minor, effective_from)
           VALUES ('annual', 'CNY', ${amount}, 0)`,
        ),
      ).rejects.toThrow();
    }
  });

  it('未知币种被拒绝', async () => {
    await expect(
      db.exec(
        `INSERT INTO price_versions (price_id, currency, amount_minor, effective_from)
         VALUES ('annual', 'JPY', 9900, 0)`,
      ),
    ).rejects.toThrow();
  });

  it('空区间（until ≤ from）被拒绝', async () => {
    await expect(
      db.exec(
        `INSERT INTO price_versions (price_id, currency, amount_minor, effective_from, effective_until)
         VALUES ('annual', 'CNY', 9900, 1000, 1000)`,
      ),
    ).rejects.toThrow();
  });

  it('空 priceId 被拒绝', async () => {
    await expect(
      db.exec(
        `INSERT INTO price_versions (price_id, currency, amount_minor, effective_from)
         VALUES ('   ', 'CNY', 9900, 0)`,
      ),
    ).rejects.toThrow();
  });
});

describe('coupons 的判别联合 CHECK', () => {
  it('合法的 percent 券能进去', async () => {
    await insertCoupon({ kind: 'percent', percent_off_bp: 5_000, amount_off_minor: null });
  });

  it('合法的 fixed 券能进去', async () => {
    await insertCoupon({ kind: 'fixed', amount_off_minor: 2_000, percent_off_bp: null });
  });

  it('🔴 非法状态在数据库层就构造不出来（kind 与金额列不匹配的全部组合）', async () => {
    const illegal: Array<Partial<Record<string, unknown>>> = [
      // percent 却没有基点
      { kind: 'percent', percent_off_bp: null, amount_off_minor: 2_000 },
      // percent 却带了金额
      { kind: 'percent', percent_off_bp: 5_000, amount_off_minor: 2_000 },
      // fixed 却没有金额
      { kind: 'fixed', amount_off_minor: null, percent_off_bp: 5_000 },
      // fixed 却带了基点
      { kind: 'fixed', amount_off_minor: 2_000, percent_off_bp: 5_000 },
      // 两个都空
      { kind: 'fixed', amount_off_minor: null, percent_off_bp: null },
      // 认不出的 kind
      { kind: 'bogo', amount_off_minor: 2_000, percent_off_bp: null },
    ];
    for (const override of illegal) {
      await expect(insertCoupon(override)).rejects.toThrow();
    }
  });

  it('🔴 0% 与 100% 都被拒绝（0 什么也不减；100% 把订单打到 0 元而 0 元单收不了钱）', async () => {
    for (const bp of [0, 10_000, -1, 10_001]) {
      await expect(
        insertCoupon({ kind: 'percent', percent_off_bp: bp, amount_off_minor: null }),
      ).rejects.toThrow();
    }
  });

  it('没归一化的码被拒绝（小写 / 带空白都进不去）', async () => {
    for (const code of ['launch', 'LAUNCH ', ' Launch', 'launch-2026']) {
      await expect(insertCoupon({ code })).rejects.toThrow();
    }
    await insertCoupon({ code: 'LAUNCH-2026' });
  });

  it('限额 0 被拒绝（0 次等于停用，该用 enabled=false 表达）', async () => {
    for (const field of ['max_redemptions', 'max_redemptions_per_user']) {
      await expect(insertCoupon({ [field]: 0 })).rejects.toThrow();
      await expect(insertCoupon({ [field]: -3 })).rejects.toThrow();
    }
  });

  it('valid_until 早于 valid_from 被拒绝', async () => {
    await expect(insertCoupon({ valid_from: 5_000n, valid_until: 4_999n })).rejects.toThrow();
    await insertCoupon({ valid_from: 5_000n, valid_until: 5_000n });
  });

  it('"限定价格"却没有给 price_ids 被拒绝（避免 NULL 数组被当成"全部"）', async () => {
    await expect(
      insertCoupon({ applies_to_all_prices: false, price_ids: null }),
    ).rejects.toThrow();
  });

  it('空 id 被拒绝', async () => {
    await expect(insertCoupon({ id: '  ' })).rejects.toThrow();
  });
});

describe('checkout_orders 的 CHECK', () => {
  it('合法的 0 折扣订单能进去', async () => {
    const uid = await freshUser();
    await insertOrder(uid);
  });

  it('合法的带折扣订单能进去', async () => {
    const uid = await freshUser();
    const cid = await insertCoupon({ code: 'OK-A' });
    await insertOrder(uid, {
      discount_minor: 2_000,
      final_amount_minor: 7_900,
      coupon_id: cid,
      out_trade_no: `hy${uid}xaaa0001xdeadbeef`,
    });
  });

  it('🔴 报价三元组不自洽一律被拒绝（这是"算错钱"的最后一道防线）', async () => {
    const uid = await freshUser();
    const bad = [
      // final 不等于 original − discount
      { discount_minor: 2_000, final_amount_minor: 9_900 },
      // 折扣超过原价
      { discount_minor: 9_901, final_amount_minor: 0 },
      // 负折扣
      { discount_minor: -1, final_amount_minor: 9_901 },
      // 0 元单
      { discount_minor: 9_900, final_amount_minor: 0 },
      // 原价为 0
      { original_amount_minor: 0, discount_minor: 0, final_amount_minor: 0 },
    ];
    for (const [i, override] of bad.entries()) {
      await expect(
        insertOrder(uid, { ...override, out_trade_no: `hy${uid}bad${i}xdeadbeef` }),
      ).rejects.toThrow();
    }
  });

  it('未知币种 / 区域 / 状态被拒绝', async () => {
    const uid = await freshUser();
    const bad = [
      { currency: 'EUR', out_trade_no: `hy${uid}c1xdeadbeef` },
      { region: 'US', out_trade_no: `hy${uid}c2xdeadbeef` },
      { status: 'wat', out_trade_no: `hy${uid}c3xdeadbeef` },
      { provider: '  ', out_trade_no: `hy${uid}c4xdeadbeef` },
      { out_trade_no: '  ' },
    ];
    for (const override of bad) {
      await expect(insertOrder(uid, override)).rejects.toThrow();
    }
  });

  it('支付窗口必须为正（expires_at 必须晚于 quoted_at）', async () => {
    const uid = await freshUser();
    await expect(
      insertOrder(uid, {
        quoted_at: 1_800_000_000_000n,
        expires_at: 1_800_000_000_000n,
        out_trade_no: `hy${uid}c5xdeadbeef`,
      }),
    ).rejects.toThrow();
  });

  it('status=paid 必须有 paid_at（否则"已付但没有付款时刻"无法对账）', async () => {
    const uid = await freshUser();
    await expect(
      insertOrder(uid, { status: 'paid', out_trade_no: `hy${uid}c6xdeadbeef` }),
    ).rejects.toThrow();
    await insertOrder(uid, {
      status: 'paid',
      paid_at: 1_800_000_100_000n,
      out_trade_no: `hy${uid}c7xdeadbeef`,
    });
  });

  it('`out_trade_no` 唯一 —— 同一订单号不可能有两行', async () => {
    const uid = await freshUser();
    await insertOrder(uid, { out_trade_no: `hy${uid}dup0xdeadbeef` });
    await expect(insertOrder(uid, { out_trade_no: `hy${uid}dup0xdeadbeef` })).rejects.toThrow();
  });
});

describe('coupon_redemptions 的 CHECK 与唯一约束', () => {
  it('合法的预留行能进去', async () => {
    const uid = await freshUser();
    const oid = await insertOrder(uid, { out_trade_no: `hy${uid}r000xdeadbeef` });
    const cid = await insertCoupon({ code: 'R-OK' });
    await insertRedemption(cid, uid, oid);
  });

  it('🔴 同一订单不能被核销两次（order_id 唯一）', async () => {
    const uid = await freshUser();
    const oid = await insertOrder(uid, { out_trade_no: `hy${uid}r001xdeadbeef` });
    const a = await insertCoupon({ code: 'R-DUP-A' });
    const b = await insertCoupon({ code: 'R-DUP-B' });
    await insertRedemption(a, uid, oid);
    await expect(insertRedemption(b, uid, oid)).rejects.toThrow();
  });

  it('未知状态被拒绝，四种合法状态都能落库', async () => {
    const uid = await freshUser();
    let i = 0;
    for (const state of ['reserved', 'applied', 'expired', 'reversed'] as const) {
      i += 1;
      const oid = await insertOrder(uid, { out_trade_no: `hy${uid}s${i}xdeadbeef` });
      const cid = await insertCoupon({ code: `R-ST-${i}` });
      await insertRedemption(cid, uid, oid, {
        state,
        applied_at: state === 'applied' ? 1_800_000_100_000n : null,
      });
    }
    const oid = await insertOrder(uid, { out_trade_no: `hy${uid}s9xdeadbeef` });
    const cid = await insertCoupon({ code: 'R-ST-BAD' });
    await expect(insertRedemption(cid, uid, oid, { state: 'using' })).rejects.toThrow();
  });

  it('state=applied 必须有 applied_at', async () => {
    const uid = await freshUser();
    const oid = await insertOrder(uid, { out_trade_no: `hy${uid}r002xdeadbeef` });
    const cid = await insertCoupon({ code: 'R-APPLIED' });
    await expect(insertRedemption(cid, uid, oid, { state: 'applied' })).rejects.toThrow();
  });

  it('🔴 "减 0 元"的核销记录被拒绝 —— 一条核销必须真的减了钱', async () => {
    const uid = await freshUser();
    const oid = await insertOrder(uid, { out_trade_no: `hy${uid}r003xdeadbeef` });
    const cid = await insertCoupon({ code: 'R-ZERO' });
    await expect(
      insertRedemption(cid, uid, oid, { discount_minor: 0, final_amount_minor: 9_900 }),
    ).rejects.toThrow();
  });

  it('预留到期必须晚于创建时刻', async () => {
    const uid = await freshUser();
    const oid = await insertOrder(uid, { out_trade_no: `hy${uid}r004xdeadbeef` });
    const cid = await insertCoupon({ code: 'R-EXP' });
    await expect(
      insertRedemption(cid, uid, oid, {
        created_at: 1_000n,
        reserved_until: 1_000n,
      }),
    ).rejects.toThrow();
  });

  it('删券被外键拒绝（onDelete: Restrict）—— 历史订单永远查得到它的券', async () => {
    const uid = await freshUser();
    const oid = await insertOrder(uid, { out_trade_no: `hy${uid}r005xdeadbeef` });
    const cid = await insertCoupon({ code: 'R-KEEP' });
    await insertRedemption(cid, uid, oid);
    await expect(db.query('DELETE FROM coupons WHERE id = $1', [cid])).rejects.toThrow();
  });
});
