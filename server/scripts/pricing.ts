#!/usr/bin/env tsx
/**
 * 运营 CLI：价目表与券。
 *
 * ## 它是什么，不是什么
 *
 * 这是**人工低频操作**的工具：改价、发券、停券。它不是给程序调用的 API ——
 * 程序侧的价格来源是 `price-book.ts` 的基线 + `price_versions` 表，
 * 券的来源是 `coupons` 表，都不经过这里。
 *
 * 所有写操作都**只走 `pricing-store.ts` 的写入口**（`publishPriceVersion` /
 * `upsertCoupon`），因为那三个入口做了两件本文件绝不能绕过的事：
 *   ① 在**同一个事务**里收口旧版 + 插入新版（否则会出现"旧版已收口、新版还没插入"
 *      的一瞬间，那一刻任何报价都抛 `PriceNotEffectiveError` —— 改价把收银台弄挂）；
 *   ② 写 `pricing_audit_log`（谁、什么时候、把哪个数改成了哪个数）。
 *
 * ## 用法
 *
 *   tsx scripts/pricing.ts show
 *   tsx scripts/pricing.ts set-price --price-id annual --currency CNY \
 *       --amount-minor 9900 --actor ops@heyta --note "2026 秋季调价"
 *   tsx scripts/pricing.ts set-price … --effective-from 2026-10-01T00:00:00Z
 *   tsx scripts/pricing.ts coupon-upsert --file ./coupon.json --actor ops@heyta --note "上线推广"
 *   tsx scripts/pricing.ts coupon-disable --coupon-id launch-2026 --actor ops@heyta --note "活动结束"
 *
 * ⚠️ 生产用编译产物：`node dist/scripts/pricing.js …`（`tsconfig` 的 `include`
 * 覆盖 `scripts/**`，与 `monitor` / `analyze-storage` 一致）。
 *
 * ## 验证边界（诚实说明）
 *
 * 参数解析是**可测的纯函数**（`parsePricingCommand`，见
 * `tests/pricing-cli.spec.ts`）。写库调用走的是已经有真库覆盖的
 * `pricing-store.ts`（含 `tests/integration/coupon-quota-race.integration.spec.ts`）。
 * 但**支付通道未接线**：本 CLI 改完价目表之后，"用户真的能按新价付钱"这件事
 * 没有端到端验证过 —— 那需要真商户号。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { prisma, disconnectDb } from '../src/db';
import { DEFAULT_PRICE_BOOK, resolveEffectivePrice, type PriceBookEntry } from '../src/billing/price-book';
import {
  CURRENCIES,
  MIN_CHARGEABLE_AMOUNT_MINOR,
  formatMinor,
  isCurrency,
  isMinorAmount,
  type Currency,
} from '../src/billing/money';
import { normalizeCouponCode, type CouponDefinition } from '../src/billing/coupon';
import {
  createPrismaSqlExecutor,
  loadCoupons,
  loadPriceOverrides,
  publishPriceVersion,
  upsertCoupon,
  type SqlExecutor,
} from '../src/billing/pricing-store';

// ─────────────────────────────────────────────────────────────────────────────
// 参数解析：**纯函数**，在 tests/pricing-cli.spec.ts 里被测
// ─────────────────────────────────────────────────────────────────────────────

/** 解析出来的一条命令。`now` 只影响 `--effective-from` 的默认值。 */
export type PricingCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'show' }
  | {
      readonly kind: 'set-price';
      readonly priceId: string;
      readonly currency: Currency;
      readonly amountMinor: number;
      readonly effectiveFrom: number;
      readonly actor: string;
      readonly note: string;
    }
  | { readonly kind: 'coupon-upsert'; readonly file: string; readonly actor: string; readonly note: string }
  | { readonly kind: 'coupon-disable'; readonly couponId: string; readonly actor: string; readonly note: string };

/** 用法错误。与"操作失败"分开：用法错误是**没执行任何写**，退出码 2。 */
export class PricingCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingCliUsageError';
  }
}

const USAGE = `用法：pricing <命令> [选项]

  show
  set-price       --price-id <id> --currency <${CURRENCIES.join('|')}> --amount-minor <整数>
                  --actor <谁> --note <为什么> [--effective-from <ISO8601|epoch-ms>]
  coupon-upsert   --file <coupon.json> --actor <谁> --note <为什么>
  coupon-disable  --coupon-id <id> --actor <谁> --note <为什么>

退出码：0 成功 / 1 操作失败 / 2 用法错误`;

/** 认识的子命令。单独列出来，这样「不认识命令」能**先于**「缺参数」报出来。 */
const KNOWN_COMMANDS = ['set-price', 'coupon-upsert', 'coupon-disable'];

const FLAGS = ['--price-id', '--currency', '--amount-minor', '--actor', '--note', '--effective-from', '--file', '--coupon-id'] as const;

/**
 * 把 `--key value` 形式的参数收成一张表。
 *
 * 🔴 严格：**未知选项直接报错**，不忽略。运营工具上"我明明传了参数它却当没看见"
 * 比报错危险得多 —— 那会让人以为改了价，其实改的是旧的默认值。
 * 重复同一个选项也报错（不猜"他想要哪一个"）。
 */
const collectFlags = (argv: readonly string[]): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      throw new PricingCliUsageError(`多余的参数「${token}」——选项都要写成 --key value 的形式。\n\n${USAGE}`);
    }
    if (!(FLAGS as readonly string[]).includes(token)) {
      throw new PricingCliUsageError(`不认识的选项「${token}」。认识的只有：${FLAGS.join(' ')}\n\n${USAGE}`);
    }
    if (out.has(token)) throw new PricingCliUsageError(`选项「${token}」出现了两次 —— 不猜你想用哪一个。`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new PricingCliUsageError(`选项「${token}」后面缺一个值。`);
    }
    out.set(token, value);
    i += 1;
  }
  return out;
};

const requireFlag = (flags: ReadonlyMap<string, string>, key: string): string => {
  const value = flags.get(key);
  if (value === undefined || value.trim() === '') {
    throw new PricingCliUsageError(`缺少必需选项「${key}」。\n\n${USAGE}`);
  }
  return value.trim();
};

/**
 * `--effective-from`：接受 epoch 毫秒或 ISO-8601。
 *
 * 缺省是"现在"，但**接受未来时刻**是刻意的：改价应当能提前排期
 * （`price_versions` 的区间模型就是为这个设计的），只是打出来的报告会**明确**
 * 提醒"这个价格现在还没生效"。
 */
const parseEffectiveFrom = (raw: string | undefined, now: number): number => {
  if (raw === undefined) return now;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (!Number.isSafeInteger(asNumber)) throw new PricingCliUsageError(`--effective-from 的 epoch 毫秒超出安全整数范围：${trimmed}`);
    return asNumber;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new PricingCliUsageError(`--effective-from 既不是 epoch 毫秒也不是可解析的时间：${trimmed}（试试 2026-10-01T00:00:00Z）`);
  }
  return parsed;
};

/** 把命令行解析成一条命令。抛 `PricingCliUsageError` 表示用法有问题。 */
export const parsePricingCommand = (argv: readonly string[], now: number = Date.now()): PricingCommand => {
  const [head, ...rest] = argv;
  if (head === undefined || head === 'help' || head === '--help' || head === '-h') return { kind: 'help' };
  if (head === 'show') {
    if (rest.length > 0) throw new PricingCliUsageError(`show 不接受任何选项，却收到了：${rest.join(' ')}`);
    return { kind: 'show' };
  }

  const flags = collectFlags(rest);
  // 🔴 "不认识命令"必须**先于**"缺参数"报出来：否则 `pricing refund-everything --actor x`
  // 会说"缺 --note"，让人以为命令是对的、只是参数没给全。
  if (!KNOWN_COMMANDS.includes(head)) {
    throw new PricingCliUsageError(`不认识命令「${head}」。\n\n${USAGE}`);
  }
  const actor = requireFlag(flags, '--actor');
  const note = requireFlag(flags, '--note');

  switch (head) {
    case 'set-price': {
      const priceId = requireFlag(flags, '--price-id');
      const rawCurrency = requireFlag(flags, '--currency').toUpperCase();
      if (!isCurrency(rawCurrency)) {
        throw new PricingCliUsageError(`--currency 只能是 ${CURRENCIES.join(' 或 ')}，收到「${rawCurrency}」。`);
      }
      const rawAmount = requireFlag(flags, '--amount-minor');
      if (!/^\d+$/.test(rawAmount)) {
        throw new PricingCliUsageError(
          `--amount-minor 必须是**最小单位的整数**（分 / 美分），收到「${rawAmount}」。` +
            `\n   ¥99 要写成 9900 —— 不是 99，也不是 99.00。`,
        );
      }
      const amountMinor = Number(rawAmount);
      if (!isMinorAmount(amountMinor) || amountMinor < MIN_CHARGEABLE_AMOUNT_MINOR) {
        throw new PricingCliUsageError(`--amount-minor 必须是 ≥ ${MIN_CHARGEABLE_AMOUNT_MINOR} 的整数，收到「${rawAmount}」。`);
      }
      return {
        kind: 'set-price',
        priceId,
        currency: rawCurrency,
        amountMinor,
        effectiveFrom: parseEffectiveFrom(flags.get('--effective-from'), now),
        actor,
        note,
      };
    }
    case 'coupon-upsert':
      return { kind: 'coupon-upsert', file: requireFlag(flags, '--file'), actor, note };
    case 'coupon-disable':
      return { kind: 'coupon-disable', couponId: requireFlag(flags, '--coupon-id'), actor, note };
    default:
      throw new PricingCliUsageError(`不认识命令「${head}」。\n\n${USAGE}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 执行
// ─────────────────────────────────────────────────────────────────────────────

const iso = (epochMs: number): string => new Date(epochMs).toISOString();

const describePrice = (entry: PriceBookEntry | null): string =>
  entry === null
    ? '（当前没有生效版本）'
    : `${formatMinor(entry.amountMinor, entry.currency)}（${entry.amountMinor} 最小单位）` +
      ` 区间 [${iso(entry.effectiveFrom)}, ${entry.effectiveUntil === null ? '∞' : iso(entry.effectiveUntil)}）` +
      (entry.note === undefined ? '' : ` 备注：${entry.note}`);

/** 读**当前生效**的一版；读不到不算错误（可能是第一次改价前的空库）。 */
const currentEffective = (
  overrides: readonly PriceBookEntry[],
  priceId: string,
  currency: Currency,
  now: number,
): PriceBookEntry | null => {
  try {
    return resolveEffectivePrice(DEFAULT_PRICE_BOOK, overrides, { priceId, currency, now });
  } catch {
    return null;
  }
};

const runShow = async (sql: SqlExecutor): Promise<void> => {
  const overrides = await loadPriceOverrides(sql);
  const { coupons, invalid } = await loadCoupons(sql);
  const now = Date.now();

  console.log('── 价格 ──');
  if (overrides.length === 0) {
    console.log('数据库里没有任何改价版本（一切走代码基线）。');
  }
  for (const entry of DEFAULT_PRICE_BOOK) {
    const effective = currentEffective(overrides, entry.priceId, entry.currency, now);
    console.log(`  ${entry.priceId}/${entry.currency}  当前收：${describePrice(effective)}`);
  }
  if (overrides.length > 0) {
    console.log(`  历史/排期版本（${overrides.length} 条）：`);
    for (const entry of overrides) {
      console.log(`    ${entry.priceId}/${entry.currency} ${describePrice(entry)}`);
    }
  }

  console.log(`\n── 券（${coupons.length} 张）──`);
  for (const coupon of coupons) {
    const benefit =
      coupon.benefit.kind === 'percent'
        ? `${coupon.benefit.percentOffBp / 100}% off`
        : `减 ${formatMinor(coupon.benefit.amountOffMinor, coupon.currency)}`;
    console.log(
      `  ${coupon.id}  码=${coupon.code ?? '(仅自动)'}  ${benefit}` +
        `  总名额=${coupon.maxRedemptions ?? '∞'}  每人=${coupon.maxRedemptionsPerUser ?? '∞'}` +
        `  ${coupon.enabled ? '启用' : '🔴 已停用'}`,
    );
    if (coupon.validUntil !== null && coupon.validUntil < now) console.log(`    ⚠️ 已过期（${iso(coupon.validUntil)}）`);
  }

  // 🔴 坏掉的券必须**打出来**，不能静默丢弃：静默丢弃正是这里要避免的事。
  if (invalid.length > 0) {
    console.log(`\n🔴 ${invalid.length} 张券的定义不合法（它们不会生效，但行还在库里）：`);
    for (const bad of invalid) console.log(`  ${bad.id}: ${bad.problems.join('；')}`);
    process.exitCode = 1;
  }
};

const runSetPrice = async (sql: SqlExecutor, command: Extract<PricingCommand, { kind: 'set-price' }>): Promise<void> => {
  const overrides = await loadPriceOverrides(sql);
  const now = Date.now();
  const before = currentEffective(overrides, command.priceId, command.currency, now);

  const { closedVersionId, newVersionId } = await publishPriceVersion(sql, {
    entry: {
      priceId: command.priceId,
      currency: command.currency,
      amountMinor: command.amountMinor,
      effectiveFrom: command.effectiveFrom,
      effectiveUntil: null,
    },
    effectiveFrom: command.effectiveFrom,
    actor: command.actor,
    note: command.note,
  });

  // 改价必须打**前后对照**：只打"已改成 X"的话，没人能回答"之前收多少"。
  console.log(`✅ 已发布 ${command.priceId}/${command.currency} 的新价格（版本 #${newVersionId}）`);
  console.log(`  改前：${describePrice(before)}`);
  console.log(`  改后：${formatMinor(command.amountMinor, command.currency)}（${command.amountMinor} 最小单位）`);
  console.log(`  收口版本：${closedVersionId === null ? '（没有旧版被收口）' : `#${closedVersionId}`}`);
  console.log(`  生效时刻：${iso(command.effectiveFrom)}  （epoch ${command.effectiveFrom}）`);
  if (command.effectiveFrom > now) {
    console.log(`  ⚠️ 这是**未来**时刻：在 ${iso(command.effectiveFrom)} 之前，收银台仍然按上一版收钱。`);
  }
  console.log(`  审计：actor=${command.actor} note=${command.note}`);
};

/** 读券定义 JSON。**不**在这里做语义校验 —— 那是 `validateCouponDefinition` 的活。 */
const readCouponFile = (file: string): CouponDefinition => {
  const resolved = path.resolve(file);
  let raw: string;
  try {
    raw = readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new Error(`读不到券定义文件 ${resolved}：${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${resolved} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${resolved} 的顶层必须是一个券定义对象（不是数组、不是 null）。`);
  }
  return parsed as CouponDefinition;
};

const runCouponUpsert = async (sql: SqlExecutor, command: Extract<PricingCommand, { kind: 'coupon-upsert' }>): Promise<void> => {
  const definition = readCouponFile(command.file);
  const now = Date.now();
  const { created } = await upsertCoupon(sql, { definition, actor: command.actor, note: command.note, now });
  console.log(
    `✅ ${created ? '新建' : '更新'}了券 ${definition.id}` +
      `（码=${definition.code ?? '(仅自动)'}, ${definition.enabled ? '启用' : '已停用'}）`,
  );
  console.log(`  审计：actor=${command.actor} note=${command.note}`);
};

const runCouponDisable = async (sql: SqlExecutor, command: Extract<PricingCommand, { kind: 'coupon-disable' }>): Promise<void> => {
  const { coupons } = await loadCoupons(sql);
  const existing = coupons.find((coupon) => coupon.id === command.couponId);
  if (existing === undefined) {
    throw new Error(
      `库里没有 id 为「${command.couponId}」的**定义合法**的券。` +
        `（如果它定义不合法，用 \`pricing show\` 看，它会列在"定义不合法"那一段里。）`,
    );
  }
  if (!existing.enabled) {
    console.log(`券 ${existing.id} 本来就是停用状态，没有改动。`);
    return;
  }
  // 🔴 停用 = 改写 `enabled`，**不是删除**：删掉会让历史订单查不到自己用了哪张券。
  const now = Date.now();
  await upsertCoupon(sql, {
    definition: { ...existing, enabled: false },
    actor: command.actor,
    note: command.note,
    now,
  });
  console.log(`✅ 已停用券 ${existing.id}（码=${existing.code === null ? '(仅自动)' : normalizeCouponCode(existing.code)}）`);
  console.log(`  改前：启用  →  改后：🔴 已停用`);
  console.log(`  审计：actor=${command.actor} note=${command.note}`);
  console.log(`  ⚠️ 停用只挡住**新的**预留；已经预留/已支付的历史订单不受影响。`);
};

async function main(): Promise<void> {
  const command = parsePricingCommand(process.argv.slice(2));
  if (command.kind === 'help') {
    console.log(USAGE);
    return;
  }

  // ✅ 这里原先有一处 `prisma as unknown as PrismaLikeClient` 的**绕行断言**，
  // 因为 `createPrismaSqlExecutor(prisma)` 在 strict 下必然报 TS2345：
  // `PrismaLikeClient` 要求 `$transaction(fn: (tx: PrismaLikeClient) => …)`，
  // 而 `PrismaClient.$transaction` 的回调给的是
  // `Omit<PrismaClient, ITXClientDenyList>` —— 那个 tx client **故意没有**
  // `$transaction`（它就在 Prisma 的 deny list 里），于是"回调参数"这一向永远不兼容。
  //
  // 缺口已修：`PrismaLikeClient` 拆成"根 / 事务"两个接口（见 `pricing-store.ts`
  // 末尾与 `docs/reference/pricing-and-coupons.md` §7 第 12 条）。
  //
  // 🔴 下面这一行**没有断言**，所以它本身就是那条修复的回归证据：
  // 谁把两个接口合回去，`pnpm typecheck` 就会红在这行。
  const sql = createPrismaSqlExecutor(prisma);
  switch (command.kind) {
    case 'show':
      await runShow(sql);
      return;
    case 'set-price':
      await runSetPrice(sql, command);
      return;
    case 'coupon-upsert':
      await runCouponUpsert(sql, command);
      return;
    case 'coupon-disable':
      await runCouponDisable(sql, command);
      return;
  }
}

/** 只有**直接执行**时才连库：被测试 import 时不该产生任何副作用。 */
const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const normalize = (p: string): string => path.resolve(p).replace(/\.(ts|js)$/, '');
  return normalize(entry) === normalize(__filename);
};

if (isDirectRun()) {
  main()
    .catch((error: unknown) => {
      if (error instanceof PricingCliUsageError) {
        console.error(`\n🔴 用法错误：${error.message}`);
        process.exitCode = 2;
        return;
      }
      console.error(`\n🔴 操作失败：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    })
    .finally(() => {
      void disconnectDb();
    });
}

export { USAGE };
