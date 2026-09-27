#!/usr/bin/env node
/**
 * 价格一致性门禁：**同一笔钱，四个地方说的必须是同一个数**。
 * ==========================================================
 *
 * 为什么需要这一道 —— 价格在这套代码里天然住在四个不同的层，
 * 而它们之间**没有任何类型关系**：
 *
 *   1. **实际收多少** —— `server/src/billing/price-book.ts` 的 `DEFAULT_PRICE_BOOK`
 *      （服务端下单用它；adapter 的默认价目表是它的**投影**，自 ADR-0018 起已不再持有自己的字面量）
 *   2. **对外怎么说** —— `packages/i18n` 的 `landing.pricing.*.price*`（落地页渲染它）
 *   3. **对外怎么承诺** —— `server/legal/terms-of-service.heyta.md`（同步服务）
 *      与 `server/legal/terms-of-service.ai.heyta.md`（AI 订阅）
 *   4. **人看的那一份** —— `docs/reference/pricing-and-entitlements.md` 的 `pricing-ssot` 块
 *
 * 这几处不一致会产生两类**都真实**的事故：
 *
 *   - 落地页写 ¥5 而价目表是 ¥39 → **虚假宣传**：用户看到的价格不是他要付的价格；
 *   - 价目表改了而落地页没改 → 同一个后果，只是方向相反。
 *
 * 而且它**不会自己暴露**：类型系统看不见字符串里的数字，测试也各测各的模块。
 *
 * 🔴 **本脚本刻意不"找不到就跳过"**。模式匹配不到时直接报错 ——
 * 因为"匹配不到"的表现如果只是"断言被跳过"，门禁就会在重构改名之后
 * **永远通过**，而那正是最需要它红的时候。这条纪律在本仓库已经吃过一次
 * （见 `apps/landing/tests/seo-head.spec.ts` 文件头对同一类陷阱的说明）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ADR-0020 之后的第二条职责：**收费清单上不许出现功能**
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 从「唯一付费档」变成「两个付费项」时，只数数量是不够的：真正要守的产品承诺是
 * **「非 AI 能力永久免费」**。所以每个 SKU 必须显式声明它**授予**什么，
 * 而允许出现的授予**只有两个**：
 *
 *   - `hosting` —— 我们替你运维那台同步服务器（买的是运维，不是功能）
 *   - `ai`      —— 我们的云端 AI（唯一一个我们**卡得住**的能力，见 ADR-0020 §1.3）
 *
 * 任何功能名（`labels` / `focus` / `four-quadrant` / …）出现在这里都必须报错。
 * 这条不是风格检查，它是那个产品承诺在代码里**唯一**的可执行形式。
 *
 * 判据与理由：`docs/adr/0020-ai-subscription-two-tiers.md` §3.2、§3.4；
 * 历史背景见 `docs/adr/0017-single-paid-tier-and-payment-channel.md` §3.2。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 仓库根。默认是脚本所在目录的上一级。
 *
 * 🔴 `HEYTA_CHECK_ROOT` 只为**故障注入探针**（`scripts/verify-i18n-failures.mjs`）存在：
 * 它要把这道门禁跑在一份**副本**上，这样"故意改坏一处"就落在副本里，
 * 而不是落在共享工作区的真实文件上（见那份脚本的 `prepareProbe`）。
 *
 * ⚠️ 这不是给生产用的开关：本脚本读的所有文件必须仍然来自**同一个**根，
 * 否则"几处一致"这件事就无从谈起。别在别的场合设它。
 */
const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    : path.resolve(process.env.HEYTA_CHECK_ROOT);

const PRICING_DOC = 'docs/reference/pricing-and-entitlements.md';
/** 🔴 **实际收多少**的唯一事实源（代码侧）。自 ADR-0018 起，这是唯一写着这个数字的 TS 文件。 */
const PRICE_BOOK = 'server/src/billing/price-book.ts';
/** 只是"不许把数字抄回来"这条检查的扫描对象，**不再**是价格的来源。 */
const ADAPTER = 'server/src/billing/wechat.adapter.ts';
const CATALOG_ZH = 'packages/i18n/src/locales/zh-CN.ts';
const CATALOG_EN = 'packages/i18n/src/locales/en.ts';
/** 对外承诺的两份文本。AI 那一份是 ADR-0020 §4.2 决定**新增**的。 */
const LEGAL_FILES = ['server/legal/terms-of-service.heyta.md', 'server/legal/terms-of-service.ai.heyta.md'];

/**
 * 🔴 **收费清单上允许出现的授予，只有这两个。**
 *
 * 加第三个之前先想清楚：你打算收的那个东西，**用户是不是本来就有**？
 * 如果是，那它就是"功能"，而功能永久免费 —— 收了就是虚假宣传。
 */
const ALLOWED_GRANTS = new Set(['hosting', 'ai']);

/** ADR-0020 §3.1：**两个**付费项，只两个。 */
const EXPECTED_SKU_COUNT = 2;
/** ADR-0020 §2.2：月付。 */
const EXPECTED_PERIOD = 'month';
/** 两个档必须在**同一段时间单位**上比较，否则"哪个更贵"没有意义。 */
const PERIOD_LABEL = '月';

/** 读文件；读不到就抛（门禁无法运行 ≠ 门禁通过）。 */
function read(relative) {
  try {
    return readFileSync(path.join(ROOT, relative), 'utf8');
  } catch (e) {
    throw new Error(`读不到 ${relative} —— 门禁**没能运行**，这不是通过。\n   ${e.message}`);
  }
}

/** 提取一个必须存在的捕获组；找不到就抛，**不返回 undefined 让断言静默跳过**。 */
function must(text, re, what) {
  const m = re.exec(text);
  if (m === null || m[1] === undefined) {
    throw new Error(
      `在 ${what} 里找不到预期的写法。\n` +
        `   期望匹配：${String(re)}\n` +
        '   🔴 这通常意味着**文件被改名/重构了**，门禁的锚点失效 ——\n' +
        '      请更新本脚本的锚点，而不是把这条检查删掉：价格不一致是真事故。',
    );
  }
  return m[1];
}

// ── 1. 价格表（人 + 门禁共读的那一个块）──────────────────────────────────
const docText = read(PRICING_DOC);
const ssotBlock = must(
  docText,
  /```json pricing-ssot\n([\s\S]*?)```/,
  `${PRICING_DOC}（\`\`\`json pricing-ssot 代码块）`,
);

/** @type {{ skus: Array<{ priceId: string, period: string, grants: string[], catalogKey: string, cny: { amountMinor: number, display: string }, usd: { amountMinor: number, display: string } }> }} */
let ssot;
try {
  ssot = JSON.parse(ssotBlock);
} catch (e) {
  throw new Error(`${PRICING_DOC} 的 pricing-ssot 块不是合法 JSON：${e.message}`);
}

/** @type {string[]} */
const problems = [];

if (!Array.isArray(ssot.skus)) {
  throw new Error(
    `${PRICING_DOC} 的 pricing-ssot 块缺少 \`skus\` 数组。\n` +
      '   自 ADR-0020 起价格表描述的是**多个 SKU**（每个带 period 与 grants），\n' +
      '   不再是"一个价 + 两个币种"。',
  );
}

// ── 1a. SKU 的形状、数量、授予白名单 ────────────────────────────────────
if (ssot.skus.length !== EXPECTED_SKU_COUNT) {
  problems.push(
    `付费项数量 ≠ ${EXPECTED_SKU_COUNT}：价格表里有 ${ssot.skus.length} 个 ` +
      `[${ssot.skus.map((s) => s.priceId).join(', ')}]。\n` +
      `     ADR-0020 §3.1 只批准了 ${EXPECTED_SKU_COUNT} 个。` +
      '加档是产品决策，不是配置改动 —— 先改 ADR。',
  );
}

const skuIds = ssot.skus.map((s) => s.priceId);
const dupIds = skuIds.filter((id, i) => skuIds.indexOf(id) !== i);
if (dupIds.length > 0) {
  problems.push(`价格表里有重复的 priceId：${[...new Set(dupIds)].join(', ')}`);
}

for (const sku of ssot.skus) {
  const where = `价格表的 ${sku.priceId ?? '(缺 priceId)'}`;
  if (typeof sku.priceId !== 'string' || sku.priceId.trim() === '') {
    problems.push(`${where}：priceId 必须是非空字符串`);
  }
  if (sku.period !== EXPECTED_PERIOD) {
    problems.push(
      `${where}：period 必须是 '${EXPECTED_PERIOD}'，实际 ${JSON.stringify(sku.period)}。\n` +
        `     ADR-0020 §2.2 已经废掉了年付（¥99 / $49 那一版），` +
        '所以这里出现 year 说明有人把旧模型抄回来了。',
    );
  }
  if (typeof sku.catalogKey !== 'string' || sku.catalogKey.trim() === '') {
    problems.push(`${where}：catalogKey 必须是非空字符串（门禁靠它去词条表里取价）`);
  }

  // 🔴 授予白名单 —— 本文件存在的第二大理由。
  if (!Array.isArray(sku.grants) || sku.grants.length === 0) {
    problems.push(
      `${where}：缺少 grants。\n` +
        '     每个 SKU 必须显式声明它**授予**什么（只允许 ' +
        `${[...ALLOWED_GRANTS].join(' / ')}），因为"非 AI 能力永久免费"这条承诺\n` +
        '     唯一的可执行形式就是"收费清单上不许出现功能名"。',
    );
  } else {
    for (const g of sku.grants) {
      if (!ALLOWED_GRANTS.has(g)) {
        problems.push(
          `🔴 ${where} 的 grants 里有 ${JSON.stringify(g)}，而允许的只有 ` +
            `${[...ALLOWED_GRANTS].join(' / ')}。\n` +
            '     功能永久免费 —— 把它写进收费清单就是虚假宣传（ADR-0020 §3.4 边界 1）。',
        );
      }
    }
    if (!sku.grants.includes('hosting')) {
      problems.push(
        `${where} 的 grants 里没有 \`hosting\`。两个档**都**含托管（ADR-0020 §3.2 的表），` +
          '不含托管的档等于在单卖 AI，而那不是这里批准的模型。',
      );
    }
  }

  for (const currency of ['cny', 'usd']) {
    const slot = sku[currency];
    if (slot === undefined || typeof slot !== 'object') {
      problems.push(`${where}：缺少 ${currency} 价格`);
      continue;
    }
    if (!Number.isSafeInteger(slot.amountMinor) || slot.amountMinor <= 0) {
      problems.push(
        `${where}：${currency}.amountMinor 必须是正安全整数（分），实际 ${JSON.stringify(slot.amountMinor)}`,
      );
    }
    if (typeof slot.display !== 'string' || slot.display.trim() === '') {
      problems.push(`${where}：${currency}.display 必须是非空字符串（人读的那一份）`);
    }
  }
}

// 两个档必须**恰好**覆盖两种授权组合：纯托管，以及托管 + AI。
const grantsKey = (sku) => [...(sku.grants ?? [])].sort().join('+');
const withAi = ssot.skus.filter((s) => (s.grants ?? []).includes('ai'));
if (ssot.skus.length === EXPECTED_SKU_COUNT && withAi.length !== 1) {
  problems.push(
    `两个付费项里必须**恰好有一个**含 \`ai\`，实际有 ${withAi.length} 个 ` +
      `（组合：${ssot.skus.map(grantsKey).join(' | ')}）。\n` +
      '     两档的**唯一**差别应当就是"含不含我们的 AI"（ADR-0020 §3.2）。',
  );
}

// ── 2. 实际收多少：服务端价目表 ──────────────────────────────────────────
const priceBookText = read(PRICE_BOOK);

/**
 * 把 `DEFAULT_PRICE_BOOK` 的数组体切成一个个 `{...}` 对象再逐个取字段。
 *
 * 🔴 刻意**不**用一条大正则匹配固定字段顺序：字段换序不该让门禁失效，
 * 但**字段改名**必须让门禁失效。所以这里逐字段 `must` —— 取不到就抛。
 */
const bookBody = must(
  priceBookText,
  /DEFAULT_PRICE_BOOK[^=]*=\s*\[([\s\S]*?)\n\];/,
  `${PRICE_BOOK} 的 \`DEFAULT_PRICE_BOOK\` 数组`,
);
const bookEntries = [...bookBody.matchAll(/\{[^{}]*\}/g)].map((m) => {
  const body = m[0];
  const priceId = must(body, /priceId:\s*'([^']+)'/, `${PRICE_BOOK} 某个基线价格项的 priceId`);
  const currency = must(body, /currency:\s*'([^']+)'/, `${PRICE_BOOK} 某个基线价格项的 currency`);
  const rawAmount = must(body, /amountMinor:\s*([0-9_]+)/, `${PRICE_BOOK} 某个基线价格项的 amountMinor`);
  const amountMinor = Number(rawAmount.replaceAll('_', ''));
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error(`${PRICE_BOOK} 的 amountMinor 不是一个整数：${rawAmount}`);
  }
  return { priceId, currency, amountMinor };
});
if (bookEntries.length === 0) {
  throw new Error(`${PRICE_BOOK} 的 DEFAULT_PRICE_BOOK 一项都解析不出来 —— 锚点失效，不是"没有价格"。`);
}

/**
 * 逐 SKU、逐币种核对"实际收多少"。
 *
 * ⚠️ 这里数的是 **(priceId, currency)**，因为同一个 SKU 在 CNY 与 USD
 * 各有一条基线 —— 那是同一个档的两种货币，不是两个档。
 */
for (const sku of ssot.skus) {
  for (const [currency, field] of [
    ['CNY', 'cny'],
    ['USD', 'usd'],
  ]) {
    const expected = sku[field]?.amountMinor;
    if (!Number.isSafeInteger(expected)) continue; // 形状问题上面已经报过了
    const matched = bookEntries.filter((e) => e.priceId === sku.priceId && e.currency === currency);
    if (matched.length === 0) {
      problems.push(
        `${PRICE_BOOK} 里没有 ${sku.priceId}/${currency} 的基线 —— ` +
          `价格表批准了它，但下单时 resolveEffectivePrice 会抛 UnknownPriceError。`,
      );
      continue;
    }
    for (const entry of matched) {
      if (entry.amountMinor !== expected) {
        problems.push(
          `实际收多少 ≠ 价格表（${sku.priceId}/${currency}）：\n` +
            `     ${PRICE_BOOK} 是 ${entry.amountMinor} 分（${currency === 'CNY' ? '¥' : '$'}${entry.amountMinor / 100}）\n` +
            `     ${PRICING_DOC} 是 ${expected} 分（${currency === 'CNY' ? '¥' : '$'}${expected / 100}）`,
        );
      }
    }
  }
}

/**
 * 🔴 **反向也要查**：价目表里**不许有**价格表没批准的 SKU。
 *
 * 只查"批准的都在"会漏掉最坏的一种漂移：有人在基线里**多加一个档**，
 * 而落地页与法务都没提它 —— 那是一个真实存在、但没人对外说过的收费项。
 */
const approvedIds = new Set(skuIds);
const extraIds = [...new Set(bookEntries.map((e) => e.priceId))].filter((id) => !approvedIds.has(id));
if (extraIds.length > 0) {
  problems.push(
    `🔴 ${PRICE_BOOK} 里有价格表**没批准**的付费档：[${extraIds.join(', ')}]。\n` +
      `     批准的只有 [${skuIds.join(', ')}]。` +
      '多的那一档会真实存在，但落地页与法务都不会提到它。',
  );
}

// ── 3. 对外怎么说：中英词条表 ────────────────────────────────────────────
/**
 * 词条槽位由**价格表**推导，不在这里再手写一遍路径 ——
 * 加档时只改 `pricing-ssot` 块，门禁自动开始要求新档的四个槽位都写全。
 */
/** @type {Array<{ sku: any, slot: string, key: string, file: string, currency: 'CNY'|'USD' }>} */
const priceSlots = [];
for (const sku of ssot.skus) {
  if (typeof sku.catalogKey !== 'string' || sku.catalogKey === '') continue;
  for (const [file, suffix] of [
    [CATALOG_ZH, 'zh'],
    [CATALOG_EN, 'en'],
  ]) {
    priceSlots.push({ sku, slot: `${suffix}Cny`, key: `${sku.catalogKey}.priceCny`, file, currency: 'CNY' });
    priceSlots.push({ sku, slot: `${suffix}Usd`, key: `${sku.catalogKey}.priceUsd`, file, currency: 'USD' });
  }
}
/** @type {Map<string, string>} */
const priceText = new Map();
for (const s of priceSlots) {
  const value = must(
    read(s.file),
    new RegExp(`'${s.key.replaceAll('.', '\\.')}':\\s*'([^']*)'`),
    `${s.file} 的 ${s.key}`,
  );
  priceText.set(`${s.sku.priceId}|${s.slot}`, value);
}

// ── 4. 对外怎么承诺：法务文本 ────────────────────────────────────────────
const legalTexts = LEGAL_FILES.map((f) => [f, read(f)]);

// ── 断言 ────────────────────────────────────────────────────────────────
/**
 * 允许出现的货币金额，**归一化成去掉空白的形式**（`CNY 5` → `CNY5`）。
 *
 * 由价格表推导，不是手写的：这样"批准了哪些金额"与"实际收多少"**不可能**漂移。
 */
const APPROVED = new Set();
for (const sku of ssot.skus) {
  for (const [currency, field] of [
    ['CNY', 'cny'],
    ['USD', 'usd'],
  ]) {
    const amount = sku[field]?.amountMinor;
    if (!Number.isSafeInteger(amount)) continue;
    const major = amount / 100;
    APPROVED.add(`¥${major}`.replace(/\s/g, ''));
    APPROVED.add(`$${major}`.replace(/\s/g, ''));
    if (currency === 'CNY') APPROVED.add(`CNY${major}`.replace(/\s/g, ''));
  }
}

/**
 * 抓出所有货币金额写法：`¥5` / `$5` / `CNY 5`。
 *
 * 🔴 为什么是「**扫描全部**出现的金额」而不是「检查某一条词条含不含 ¥5」——
 * 后者只要求那个数字**在文档里出现过**，所以把同一份文档里的**另一处**价格
 * 改成别的数字，检查仍然通过（实测：把法务文本 §4 的 ¥99 改成 ¥139 时
 * 门禁照绿，因为 §2 那张表里还留着一个 ¥99）。而"同一份对外文本里出现两个
 * 不同的价格"恰恰就是最坏的那种事故。所以这里扫全量、逐个比对。
 */
function currencyTokens(text) {
  return [...text.matchAll(/[¥$]\s?\d[\d,]*|CNY\s?\d[\d,]*/g)].map((m) => m[0].replace(/\s/g, ''));
}

/** 对一个"对外文本"层做全量金额校验。返回发现的金额列表（已归一化）。 */
function sweep(text, where, found) {
  const tokens = currencyTokens(text);
  if (tokens.length === 0) {
    found.push(`对外文本里一个价格都没有：${where} —— 要么漏写了，要么锚点失效。`);
    return;
  }
  for (const t of tokens) {
    if (!APPROVED.has(t)) {
      found.push(
        `出现了不被批准的价格：${where} 里有 ${t}，` +
          `而价格表只批准 ${[...APPROVED].join(' / ')}`,
      );
    }
  }
}

// 层 2：对外怎么说（只扫落地页价格区的词条，别处的数字不是价格）
for (const [label, file] of [
  ['zh catalog', CATALOG_ZH],
  ['en catalog', CATALOG_EN],
]) {
  const block = must(
    read(file),
    /('landing\.pricing\.ariaLabel'[\s\S]*?\n\n)/,
    `${file} 的 landing.pricing.* 词条块`,
  );
  sweep(block, `${label}（${file}）的 landing.pricing.*`, problems);
}

// 层 3：对外怎么承诺（两份都扫）
for (const [file, text] of legalTexts) {
  sweep(text, file, problems);
}

// 各槽位的形状检查：中文必须用 ¥，英文的大陆价必须写明是 CNY
// （`¥` 在英文表里会被读成日元/人民币歧义，所以英文用 `CNY 5`）。
for (const sku of ssot.skus) {
  const cny = sku.cny?.amountMinor;
  const usd = sku.usd?.amountMinor;
  if (!Number.isSafeInteger(cny) || !Number.isSafeInteger(usd)) continue;
  const get = (slot) => priceText.get(`${sku.priceId}|${slot}`);

  if (!get('zhCny')?.includes(`¥${cny / 100}`)) {
    problems.push(
      `中文落地页的 ${sku.priceId} 大陆价必须写成 ¥${cny / 100}，实际是 ${JSON.stringify(get('zhCny'))}`,
    );
  }
  if (!get('zhUsd')?.includes(`$${usd / 100}`)) {
    problems.push(
      `中文落地页的 ${sku.priceId} 海外价必须写成 $${usd / 100}，实际是 ${JSON.stringify(get('zhUsd'))}`,
    );
  }
  if (!get('enUsd')?.includes(`$${usd / 100}`)) {
    problems.push(
      `英文落地页的 ${sku.priceId} 海外价必须写成 $${usd / 100}，实际是 ${JSON.stringify(get('enUsd'))}`,
    );
  }
  if (!/^CNY\s?\d/.test(get('enCny') ?? '')) {
    problems.push(
      `英文落地页的 ${sku.priceId} 大陆价必须带 \`CNY\` 前缀（否则 \`¥\` 在英文里含义不明），` +
        `实际是 ${JSON.stringify(get('enCny'))}`,
    );
  }
  // 周期必须写在对外文案里 —— 「¥5」而不说"每月"，用户没法判断这是多久的钱。
  for (const slot of ['zhCny', 'zhUsd', 'enCny', 'enUsd']) {
    const value = get(slot) ?? '';
    const hasPeriod = /月|month/i.test(value);
    if (!hasPeriod) {
      problems.push(
        `落地页词条 ${sku.priceId}.${slot} 没有写周期：${JSON.stringify(value)}\n` +
          `     价格表说的是 \`period: '${EXPECTED_PERIOD}'\`，对外就必须写成「¥X / ${PERIOD_LABEL}」` +
          '（英文 `/ month`）—— 只写金额会让人以为是买断。',
      );
    }
  }
}

// ── 5. 数字不许抄第二次 ─────────────────────────────────────────────────
const adapterText = read(ADAPTER);
/**
 * 扫描前先去掉注释：注释里出现 `totalFen: 9_900` 是在**解释**这件事，
 * 不是在复制价格；而注释不参与执行。
 * （同一条教训见 `server/tests/` 里 pglite 规格对"注释里的 CONCURRENTLY"的处理。）
 */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
if (/totalFen:\s*[0-9_]/.test(stripComments(adapterText))) {
  problems.push(
    `${ADAPTER} 里又出现了 \`totalFen: <数字>\` 字面量。\n` +
      `     价目表必须只写一次（${PRICE_BOOK} 的 DEFAULT_PRICE_BOOK），` +
      'adapter 只能通过 projectPrices 投影它。\n' +
      '     抄回来的那份不会跟着改价动 —— 那正是最坏的一类不一致。',
  );
}

if (problems.length > 0) {
  console.error('');
  console.error('🔴 价格对不上 —— 这会让「用户看到的价格」不等于「他要付的价格」：');
  console.error('');
  for (const p of problems) console.error(`   ❌ ${p}`);
  console.error('');
  console.error(`   唯一事实源：${PRICING_DOC} 的 \`\`\`json pricing-ssot 块。`);
  console.error(
    `   改价必须同一次改：${PRICE_BOOK} / 中英词条 / ${LEGAL_FILES.join(' / ')} / ${PRICING_DOC}`,
  );
  console.error('   决策与理由见 docs/adr/0020-ai-subscription-two-tiers.md §3。');
  console.error('');
  process.exit(1);
}

const summary = ssot.skus
  .map((s) => `${s.priceId} ¥${s.cny.amountMinor / 100}/${PERIOD_LABEL}·$${s.usd.amountMinor / 100}/${PERIOD_LABEL}`)
  .join('、');
console.log(`   ✅ 价格四处一致：${summary}（授予只含 ${[...ALLOWED_GRANTS].join(' / ')}）`);
