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
  loadPricingAudit,
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

/**
 * 价格文案的**全部**落点。
 *
 * 与 `pnpm check:pricing`（`scripts/check-pricing-consistency.mjs`）的校验范围
 * **必须一致** —— 那份门禁校验基线 ↔ 中英词条 ↔ 法务文本 ↔ `pricing-ssot` 块
 * 内部是否自洽，而这里的清单就是"有没有漏掉一处"的答案。
 * 两处若漂移，门禁会绿而文案会撒谎。
 */
export const PRICING_COPY_SITES = [
  { path: 'server/src/billing/price-book.ts', what: 'DEFAULT_PRICE_BOOK —— 代码基线，也是落地页与门禁的真源' },
  { path: 'packages/i18n/src/locales/zh-CN.ts', what: 'landing.pricing.* 中文文案' },
  { path: 'packages/i18n/src/locales/en.ts', what: 'landing.pricing.* 英文文案' },
  { path: 'docs/reference/pricing-and-entitlements.md', what: 'pricing-ssot 块（机器可读，门禁读它）' },
  { path: 'server/legal/terms-of-service.heyta.md', what: '服务条款正文里的金额' },
  { path: 'server/legal/terms-of-service.ai.heyta.md', what: 'AI 条款正文里的金额' },
] as const;

/**
 * 改价之后"还有哪些地方在撒谎"。
 *
 * 🔴 这是本 CLI 最重要的一条输出，因为**库里生效的价**与**落地页/法务/门禁读的价**
 * 是两个不同的东西：
 *   - 收银台按 `price_versions`（本 CLI 写的表）收钱；
 *   - 落地页文案、法务文本、`pricing-ssot` 块读的是 `price-book.ts` 的
 *     `DEFAULT_PRICE_BOOK`（代码基线），而 `pnpm check:pricing` **只校验这一侧内部自洽**。
 *
 * 于是"改完库里的价、忘了改文案"会让页面印 ¥5、收银台收 ¥139 —— 用户看到的价与
 * 实收的价不一致，而**所有门禁都是绿的**。这个缺口不是靠自觉能堵住的：
 * 它需要一个会说出来的断言点，也就是这里。
 *
 * 设计上：数据库覆盖版是**应急/试验**用的，长期真源是代码基线（因为只有基线能被
 * 门禁校验、被法务文本引用）。所以库里的价与基线不一致时，正确动作是
 * **把基线也改成新价**，让覆盖版变成冗余而不是分叉。
 *
 * 纯函数（不读库、不写日志），便于用单元测试钉住措辞与文件清单
 * （见 `tests/pricing-cli.spec.ts`）。返回 `null` 表示"库里的价与代码基线一致"。
 */
export const describeCopyFootprint = (input: {
  readonly priceId: string;
  readonly currency: Currency;
  readonly baselineMinor: number;
  readonly effectiveMinor: number;
}): string | null => {
  if (input.baselineMinor === input.effectiveMinor) return null;

  const lines = [
    `🔴 ${input.priceId}/${input.currency}：库里现在收 ${formatMinor(input.effectiveMinor, input.currency)}，` +
      `而代码基线还是 ${formatMinor(input.baselineMinor, input.currency)}。`,
    '   收银台读库（会按新价收钱），落地页 / 法务 / 门禁读基线（还在印旧价）——',
    '   也就是说**用户看到的价与实收的价不一致，而所有门禁都还是绿的**。',
    '   要么把基线也改成新价（推荐：只有基线能被门禁校验），要么撤回这次改价。',
    '   需要同步的位置：',
    ...PRICING_COPY_SITES.map((site) => `     ${site.path}   —— ${site.what}`),
    '   改完跑：pnpm check:pricing（它会指名任何一处对不上的文件与数字）',
  ];
  return lines.join('\n');
};

/**
 * `show` 打印多少条审计。
 *
 * 固定 20 条、且**不**做成选项：这是给人看的一段"最近发生过什么"，
 * 不是分页查询接口。要查更早的，直接对 `pricing_audit_log` 写 SQL ——
 * 这个上限存在的意义只是别让 `show` 刷屏刷到看不见价格本身。
 */
const AUDIT_TAIL = 20;

/**
 * `show` 的实现。**导出是为了能被测试直接驱动**：它收一个 `SqlExecutor`，
 * 所以 PGlite 上跑真 SQL 就能验证"审计打出来了、分叉告警置了退出码"，
 * 而不必先有一台 PostgreSQL（本地 Prisma Postgres dev server 常年不在跑）。
 */
export const runShow = async (sql: SqlExecutor): Promise<void> => {
  const overrides = await loadPriceOverrides(sql);
  const { coupons, invalid } = await loadCoupons(sql);
  const now = Date.now();

  console.log('── 价格 ──');
  if (overrides.length === 0) {
    console.log('数据库里没有任何改价版本（一切走代码基线）。');
  }
  /** 有价格版本与代码基线分叉 —— 读命令也要能用退出码表达这个**错误状态**。 */
  let copyDiverged = false;
  for (const entry of DEFAULT_PRICE_BOOK) {
    const effective = currentEffective(overrides, entry.priceId, entry.currency, now);
    console.log(`  ${entry.priceId}/${entry.currency}  当前收：${describePrice(effective)}`);
    const footprint = describeCopyFootprint({
      priceId: entry.priceId,
      currency: entry.currency,
      baselineMinor: entry.amountMinor,
      effectiveMinor: effective?.amountMinor ?? entry.amountMinor,
    });
    if (footprint !== null) {
      copyDiverged = true;
      console.log(`\n${footprint}`);
    }
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

  // 🔴 审计段。这一段曾经**不存在**：`pricing_audit_log` 只写不读，于是
  // "谁在什么时候把 ¥12 改成 ¥15"在代码里没有答案，只能手写 SQL 去问库。
  // 审计写下来却读不出来，等于没有审计 —— 它的全部价值就在于事后能被查到。
  const audit = await loadPricingAudit(sql, { limit: AUDIT_TAIL });
  console.log(`\n── 最近 ${AUDIT_TAIL} 条审计（新的在前）──`);
  if (audit.length === 0) {
    console.log('  （还没有任何改价 / 改券记录）');
  }
  for (const entry of audit) {
    const when = entry.createdAt === null ? '⚠️ 时间不可读' : iso(entry.createdAt);
    console.log(`  ${when}  ${entry.action}  ${entry.target}  actor=${entry.actor ?? '（未记）'}`);
    if (entry.note !== null && entry.note !== '') console.log(`      note：${entry.note}`);
    console.log(`      before=${entry.beforeJson ?? 'null'}  after=${entry.afterJson ?? 'null'}`);
  }

  // 🔴 坏掉的券必须**打出来**，不能静默丢弃：静默丢弃正是这里要避免的事。
  if (invalid.length > 0) {
    console.log(`\n🔴 ${invalid.length} 张券的定义不合法（它们不会生效，但行还在库里）：`);
    for (const bad of invalid) console.log(`  ${bad.id}: ${bad.problems.join('；')}`);
    process.exitCode = 1;
  }

  // 🔴 与坏券同理：库里收的价与页面印的价不一致是**错误状态**，不能 exit 0。
  if (copyDiverged) {
    console.log('\n🔴 有价格版本与代码基线分叉（上面已逐条列出）。修好之前退出码是 1。');
    process.exitCode = 1;
  }
};

/** `set-price` 的实现。导出理由同 `runShow`。 */
export const runSetPrice = async (sql: SqlExecutor, command: Extract<PricingCommand, { kind: 'set-price' }>): Promise<void> => {
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

  // 🔴 最关键的一步：**改价之后必须告诉运营还有哪些地方在撒谎**。
  // 收银台按库里这一版收钱，而落地页 / 法务 / 门禁读的是代码基线 ——
  // 只改库、不改基线，页面就会印 ¥5 而实际收 ¥139，且所有门禁都是绿的。
  // 有分叉就以**非零退出码**结束：这不只是提示，是一个会失败的断言点。
  //
  // ⚠️ 比的是**改完之后此刻真正生效**的那一版，不是刚发布的那个数：
  // 排期到未来的改价还没生效，收银台现在收的仍是上一版 —— 拿未生效的价去告警
  // 会说错话（"库里现在收 ¥13"在那一刻是假的，运营会去改不该改的文案）。
  // 这也让"排期改价"这个正常操作不会被误判成分叉。
  const baselineEntry = DEFAULT_PRICE_BOOK.find(
    (entry) => entry.priceId === command.priceId && entry.currency === command.currency,
  );
  const effectiveNow = currentEffective(await loadPriceOverrides(sql), command.priceId, command.currency, now);

  // 🔴 空隙检测。`resolveEffectivePrice` 的裁决是"库里对该 key 有版本 → **只在覆盖里找**，
  // 找不到就抛 `PriceNotEffectiveError`，**绝不回落基线**"（那是刻意设计：回落会变成
  // 静默按旧价收款）。代价是：把某个 key 的**第一个**版本排到未来，就会出现一段
  // "有版本、但没有一版生效"的窗口 —— 收银台在这段时间直接拒单。
  //
  // 实测（纯函数，不经库）：基线 500 / 覆盖 1300 排到 +7 天 → `PriceNotEffectiveError`。
  // 只有**第一个**版本会这样：后续版本会把上一版收口（`effective_until = 新版起点`），
  // 所以排期本身是好的，坏的只是"第一次就排期"。
  if (baselineEntry !== undefined && effectiveNow === null) {
    console.log('\n🔴 你造出了一个**价格空隙**：这个 key 在库里已有版本，但没有一版在**此刻**生效。');
    console.log('   裁决规则是"有覆盖就不回落基线"，所以从现在到新版本生效为止，收银台会**直接拒单**');
    console.log('   （`PriceNotEffectiveError`），一张订单都报不出价。');
    console.log('   典型触发：把某个 key 的**第一个**版本排到未来（后续版本会收口上一版，不留空隙）。');
    console.log('   要么现在就先发一版立即生效的过渡价，要么把 `--effective-from` 改到当前或更早。');
    process.exitCode = 1;
  }

  const footprint =
    baselineEntry === undefined || effectiveNow === null
      ? null
      : describeCopyFootprint({
          priceId: command.priceId,
          currency: command.currency,
          baselineMinor: baselineEntry.amountMinor,
          effectiveMinor: effectiveNow.amountMinor,
        });
  if (footprint !== null) {
    console.log(`\n${footprint}`);
    console.log('\n🔴 退出码 1：价格文案与实收价分叉。这不是"改价失败/已回滚"—— 价**已经改了**，');
    console.log('   是你还需要把上面那份清单同步掉（或撤回）。改完用 `show` 复读，它会变回 0。');
    process.exitCode = 1;
  }
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
