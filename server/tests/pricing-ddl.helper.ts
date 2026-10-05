import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

/**
 * 定价/优惠券那一次迁移的目录名。
 *
 * ⚠️ 这是**唯一**允许写死这个字符串的地方。任何测试都不许把它的表结构
 * 手抄一遍 —— 抄一份就等于给自己留一个"迁移改了、测试还在测旧结构"的静默失败，
 * 与 `migration-index.helper.ts` 文件头记的是同一类事故。
 */
export const PRICING_MIGRATION_DIR = '20260928000000_add_pricing_and_coupons';

/** 这五张表缺任何一张都说明锚点失效，而不是"这次测试不需要它"。 */
const REQUIRED_TABLES = [
  'price_versions',
  'pricing_audit_log',
  'coupons',
  'checkout_orders',
  'coupon_redemptions',
] as const;

/**
 * 从**发布中的迁移文件**里读出定价/优惠券的建表 SQL。
 *
 * 与 `createIndexFromMigration` 同一条纪律：**读发布物，不要抄一份**。
 * 抄一份的测试只能证明"抄本是对的"，而发布物漂移时它会安静地继续通过。
 * 这里额外做锚点检查：五张表少一张就 `throw` —— 迁移被改名/重构时测试**在
 * setup 阶段就炸**，而不是变成一组测着不存在的东西的绿灯。
 */
export const pricingDdlFromMigration = (): string => {
  const sql = readFileSync(join(migrationsDir, PRICING_MIGRATION_DIR, 'migration.sql'), 'utf8');
  const missing = REQUIRED_TABLES.filter((t) => !sql.includes(`CREATE TABLE "${t}"`));
  if (missing.length > 0) {
    throw new Error(
      `${PRICING_MIGRATION_DIR}/migration.sql 里找不到这些表的建表语句：${missing.join(', ')}。\n` +
        '   🔴 这通常意味着迁移被改名/重构了 —— 请更新本 helper 的锚点，' +
        '而不是把检查删掉：这些表的 CHECK 约束是钱上的最后一道防线。',
    );
  }
  return sql;
};

/**
 * `checkout_orders` / `coupon_redemptions` 有指向 `users` 的外键，而真实
 * `users` 表有三十多列、与本主题无关。这里给一个**最小替身**。
 *
 * ⚠️ 它是替身而不是抄本：只保留主键（外键唯一需要的东西），所以它**不可能**
 * 与真实 `users` 漂移。
 */
export const MINIMAL_USERS_DDL = `
  CREATE TABLE users (
    id    serial PRIMARY KEY,
    email text NOT NULL UNIQUE
  );
`;

/** 在一个干净的 pglite 实例里建好定价/优惠券的全部表与约束。 */
export const PRICING_SCHEMA_DDL = `${MINIMAL_USERS_DDL}\n${pricingDdlFromMigration()}`;

/**
 * `payment_events` 的建表 SQL —— 从**发布中的迁移文件**读出来，不抄一份。
 *
 * 对账（`reconcile.ts`）必须 join `payment_events`，所以测它的 PGlite 实例
 * 需要这张表。与定价那张表同一条纪律：读发布物、加锚点检查，迁移改名时
 * 测试在 setup 阶段就炸，而不是变成一组测着不存在结构的绿灯。
 */
const PAYMENT_EVENTS_MIGRATION_DIR = '20260927000000_add_payment_events';

export const paymentEventsDdlFromMigration = (): string => {
  const sql = readFileSync(join(migrationsDir, PAYMENT_EVENTS_MIGRATION_DIR, 'migration.sql'), 'utf8');
  if (!sql.includes('CREATE TABLE "payment_events"')) {
    throw new Error(
      `${PAYMENT_EVENTS_MIGRATION_DIR}/migration.sql 里找不到 "payment_events" 的建表语句。\n` +
        '   🔴 迁移被改名/重构时请更新本 helper 的锚点，而不是删掉解析。',
    );
  }
  return sql;
};

/**
 * `payment_events` 有一个指向 `subscriptions` 的外键，而真实订阅表与对账主题无关。
 * 这里给一个**最小替身**（只有主键，外键唯一需要的东西）—— 它不可能与真实表漂移。
 */
export const MINIMAL_SUBSCRIPTIONS_DDL = `
  CREATE TABLE subscriptions (
    id serial PRIMARY KEY
  );
`;

export const PAYMENT_EVENTS_SCHEMA_DDL = `${MINIMAL_SUBSCRIPTIONS_DDL}\n${paymentEventsDdlFromMigration()}`;

/**
 * 退款那一次迁移的目录名。同样：**唯一**允许写死它的地方。
 *
 * 它单独成一个 export 是因为 `billing-refund-store.pglite.spec.ts` 的锚点报错信息
 * 要引用同一个名字 —— 两处各写一份就会在迁移改名那天分成两个版本。
 */
export const REFUND_MIGRATION_DIR = '20261014000000_add_refunds';

/**
 * 退款表必须存在的东西：一张表 + 三条 CHECK + 唯一索引 + 外键。
 *
 * 🔴 这里列的是**约束名**，因为退款用例的一半判据是"某个坏值必须被库拒掉"。
 * 约束被改名或删掉时，那些用例会变成"拒不掉、而断言的正则也找不到东西"——
 * 那是最贵的一种假绿，所以宁可 setup 阶段就炸。
 */
const REQUIRED_REFUND_CONSTRAINTS = [
  'CREATE TABLE "refunds"',
  'refunds_out_refund_no_key',
  'refunds_order_id_fkey',
  'refunds_amount_positive',
  'refunds_period_days_range',
  'refunds_success_needs_refunded_at',
] as const;

export const refundDdlFromMigration = (): string => {
  const sql = readFileSync(join(migrationsDir, REFUND_MIGRATION_DIR, 'migration.sql'), 'utf8');
  const missing = REQUIRED_REFUND_CONSTRAINTS.filter((t) => !sql.includes(t));
  if (missing.length > 0) {
    throw new Error(
      `${REFUND_MIGRATION_DIR}/migration.sql 里找不到这些东西：${missing.join(', ')}。\n` +
        '   🔴 这通常意味着迁移被改名/重构/删了约束 —— 请更新本 helper 的锚点，' +
        '而不是把检查删掉：这三条 CHECK 是"钱退了而权益没回"那类半真状态的最后一道防线。',
    );
  }
  return sql;
};

/**
 * `subscriptions` 的**替身**：只保留退款回收路径真的读写的七列
 * （`grants` / `price_id` / `external_subscription_id` 一概没有）。
 *
 * ⚠️ 与上面那个 `MINIMAL_SUBSCRIPTIONS_DDL` 不是同一个东西，也不该合并：
 * 那一个只为 `payment_events` 的外键提供主键，这一个要被真的 `UPDATE`。
 * 合并的结果是"对账用例莫名其妙多出一堆列"，而两边各自的"不可能漂移"依赖的
 * 正是**只带自己用到的列**这件事。
 */
export const SUBSCRIPTIONS_FOR_REFUND_STAND_IN_DDL = `
  CREATE TABLE subscriptions (
    id                 serial PRIMARY KEY,
    user_id            integer NOT NULL,
    provider           text,
    status             text,
    current_period_end bigint,
    last_event_at      bigint,
    updated_at         bigint NOT NULL DEFAULT 0
  );
`;

/**
 * 退款主题需要的两张表：`refunds`（读发布物）+ 可被回收的 `subscriptions` 替身。
 *
 * 调用方必须先建 `checkout_orders`（`refunds` 的外键指向它），
 * 所以正确用法是 `${PRICING_SCHEMA_DDL}\\n${REFUND_SCHEMA_DDL}`。
 */
export const REFUND_SCHEMA_DDL = `${refundDdlFromMigration()}\n${SUBSCRIPTIONS_FOR_REFUND_STAND_IN_DDL}`;
