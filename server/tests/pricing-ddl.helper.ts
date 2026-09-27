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
