#!/usr/bin/env node
/**
 * 价格一致性门禁：**同一笔钱，三个地方说的必须是同一个数**。
 * ==========================================================
 *
 * 为什么需要这一道 —— 价格在这套代码里天然住在三个不同的层，
 * 而它们之间**没有任何类型关系**：
 *
 *   1. **实际收多少** —— `server/src/billing/price-book.ts` 的 `DEFAULT_PRICE_BOOK`
 *      （服务端下单用它；adapter 的 `WECHAT_DEFAULT_PRICES` 是它的**投影**，
 *      自 ADR-0018 起已不再持有自己的字面量）
 *   2. **对外怎么说** —— `packages/i18n` 的 `landing.pricing.hosted.price*`（落地页渲染它）
 *   3. **对外怎么承诺** —— `server/legal/terms-of-service.heyta.md`（用户与服务方之间的文本）
 *
 * 这三处不一致会产生两类**都真实**的事故：
 *
 *   - 落地页写 ¥99 而价目表是 ¥139 → **虚假宣传**：用户看到的价格不是他要付的价格；
 *   - 价目表改了而落地页没改 → 同一个后果，只是方向相反。
 *
 * 而且它**不会自己暴露**：类型系统看不见字符串里的数字，测试也各测各的模块。
 *
 * 🔴 **本脚本刻意不"找不到就跳过"**。模式匹配不到时直接报错 ——
 * 因为"匹配不到"的表现如果只是"断言被跳过"，门禁就会在重构改名之后
 * **永远通过**，而那正是最需要它红的时候。这条纪律在本仓库已经吃过一次
 * （见 `apps/landing/tests/seo-head.spec.ts` 文件头对同一类陷阱的说明）。
 *
 * 判据与理由见 `docs/adr/0017-single-paid-tier-and-payment-channel.md` §3.2。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PRICING_DOC = 'docs/reference/pricing-and-entitlements.md';
/** 🔴 **实际收多少**的唯一事实源（代码侧）。自 ADR-0018 起，这是唯一写着这个数字的 TS 文件。 */
const PRICE_BOOK = 'server/src/billing/price-book.ts';
/** 只是"不许把数字抄回来"这条检查的扫描对象，**不再**是价格的来源。 */
const ADAPTER = 'server/src/billing/wechat.adapter.ts';
const CATALOG_ZH = 'packages/i18n/src/locales/zh-CN.ts';
const CATALOG_EN = 'packages/i18n/src/locales/en.ts';
const LEGAL = 'server/legal/terms-of-service.heyta.md';

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
        '      请更新本脚本的锚点，而不是把这条检查删掉：价格三处不一致是真事故。',
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

/** @type {{ cny: { priceId: string, totalFen: number, display: string }, usd: { priceId: string, totalCents: number, display: string } }} */
let ssot;
try {
  ssot = JSON.parse(ssotBlock);
} catch (e) {
  throw new Error(`${PRICING_DOC} 的 pricing-ssot 块不是合法 JSON：${e.message}`);
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

const cnyEntry = bookEntries.find((e) => e.currency === 'CNY');
const usdEntry = bookEntries.find((e) => e.currency === 'USD');
if (cnyEntry === undefined) {
  throw new Error(`${PRICE_BOOK} 的 DEFAULT_PRICE_BOOK 里没有 CNY 的基线价格项。`);
}
if (usdEntry === undefined) {
  throw new Error(`${PRICE_BOOK} 的 DEFAULT_PRICE_BOOK 里没有 USD 的基线价格项。`);
}
const adapterFen = cnyEntry.amountMinor;

// ── 3. 对外怎么说：中英词条表 ────────────────────────────────────────────
const priceKeys = {
  zhCny: ['landing.pricing.hosted.priceCny', CATALOG_ZH],
  zhUsd: ['landing.pricing.hosted.priceUsd', CATALOG_ZH],
  enCny: ['landing.pricing.hosted.priceCny', CATALOG_EN],
  enUsd: ['landing.pricing.hosted.priceUsd', CATALOG_EN],
};
/** @type {Record<string, string>} */
const priceText = {};
for (const [slot, [key, file]] of Object.entries(priceKeys)) {
  priceText[slot] = must(read(file), new RegExp(`'${key.replaceAll('.', '\\.')}':\\s*'([^']*)'`), `${file} 的 ${key}`);
}

// ── 4. 对外怎么承诺：法务文本 ────────────────────────────────────────────
const legalText = read(LEGAL);

// ── 断言 ────────────────────────────────────────────────────────────────
const yuan = ssot.cny.totalFen / 100;
const dollars = ssot.usd.totalCents / 100;
/** @type {string[]} */
const problems = [];

if (adapterFen !== ssot.cny.totalFen) {
  problems.push(
    `实际收多少 ≠ 价格表：\n` +
      `     ${PRICE_BOOK} 是 ${adapterFen} 分（¥${adapterFen / 100}）\n` +
      `     ${PRICING_DOC} 是 ${ssot.cny.totalFen} 分（¥${yuan}）`,
  );
}
if (usdEntry.amountMinor !== ssot.usd.totalCents) {
  problems.push(
    `海外的实际收多少 ≠ 价格表：\n` +
      `     ${PRICE_BOOK} 是 ${usdEntry.amountMinor} 分（$${usdEntry.amountMinor / 100}）\n` +
      `     ${PRICING_DOC} 是 ${ssot.usd.totalCents} 分（$${dollars}）`,
  );
}

/**
 * 唯一付费档：代码基线里**只允许有一个** priceId。
 *
 * ADR-0017 §3.1 只批准了一个档，ADR-0018 保留了这一条（"一档到底"是产品决策，
 * 不是还没做）。所以"多了一项"本身就是要拦的事，不只是价格对不对。
 *
 * ⚠️ 注意这里数的是 **priceId 的种类**，不是条目数：`annual` 在 CNY 与 USD
 * 各有一条基线，那是同一个档的两种货币。
 */
const bookPriceIds = [...new Set(bookEntries.map((e) => e.priceId))];
if (bookPriceIds.length !== 1 || bookPriceIds[0] !== ssot.cny.priceId) {
  problems.push(
    `付费档数量 ≠ 一个：${PRICE_BOOK} 的基线里有 [${bookPriceIds.join(', ')}]，` +
      `而价格表只批准了 ${ssot.cny.priceId}。\n` +
      `     加第二个档会同时打破「一档到底」与回调的按单校验（见 ${PRICING_DOC} §4）。`,
  );
}

/**
 * 🔴 **数字不许抄第二次。**
 *
 * 这一条是 ADR-0018 加的，也是"价格可调"这个需求的**负向**那一半：
 * 光把数字收敛到一处还不够，还得拦住后来的人"顺手"把它抄回去。
 * 抄回去之后，`pricing-store.publishPriceVersion` 改的是基线之外的覆盖版本，
 * 而 adapter 会继续按抄来的字面量下单 —— 那时两边的差额**没有任何东西会发现**。
 */
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

/** 允许出现的货币金额，**归一化成去掉空白的形式**（`CNY 99` → `CNY99`）。 */
const APPROVED = new Set([`¥${yuan}`, `$${dollars}`, `CNY${yuan}`].map((x) => x.replace(/\s/g, '')));

/**
 * 抓出所有货币金额写法：`¥99` / `$49` / `CNY 99`。
 *
 * 🔴 为什么是「**扫描全部**出现的金额」而不是「检查某一条词条含不含 ¥99」——
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
const catalogPairs = [
  ['zh catalog', CATALOG_ZH, read(CATALOG_ZH)],
  ['en catalog', CATALOG_EN, read(CATALOG_EN)],
];
for (const [label, file, text] of catalogPairs) {
  const block = must(
    text,
    /('landing\.pricing\.ariaLabel'[\s\S]*?\n\n)/,
    `${file} 的 landing.pricing.* 词条块`,
  );
  sweep(block, `${label}（${file}）的 landing.pricing.*`, problems);
}

// 层 3：对外怎么承诺
sweep(legalText, LEGAL, problems);

// 三个槽位各自的形状检查：中文必须用 ¥，英文的大陆价必须写明是 CNY
// （`¥` 在英文表里会被读成日元/人民币歧义，所以英文用 `CNY 99`）。
if (!priceText.zhCny.includes(`¥${yuan}`)) {
  problems.push(`中文落地页的大陆价必须写成 ¥${yuan}，实际是 ${JSON.stringify(priceText.zhCny)}`);
}
if (!priceText.zhUsd.includes(`$${dollars}`)) {
  problems.push(`中文落地页的海外价必须写成 $${dollars}，实际是 ${JSON.stringify(priceText.zhUsd)}`);
}
if (!priceText.enUsd.includes(`$${dollars}`)) {
  problems.push(`英文落地页的海外价必须写成 $${dollars}，实际是 ${JSON.stringify(priceText.enUsd)}`);
}
if (!/^CNY\s?\d/.test(priceText.enCny)) {
  problems.push(
    `英文落地页的大陆价必须带 \`CNY\` 前缀（否则 \`¥\` 在英文里含义不明），` +
      `实际是 ${JSON.stringify(priceText.enCny)}`,
  );
}

if (problems.length > 0) {
  console.error('');
  console.error('🔴 价格在三个地方对不上 —— 这会让「用户看到的价格」不等于「他要付的价格」：');
  console.error('');
  for (const p of problems) console.error(`   ❌ ${p}`);
  console.error('');
  console.error(`   唯一事实源：${PRICING_DOC} 的 \`\`\`json pricing-ssot 块。`);
  console.error(`   改价必须同一次改：${PRICE_BOOK} / 中英词条 / ${LEGAL} / ${PRICING_DOC}`);
  console.error('   决策与理由见 docs/adr/0017-single-paid-tier-and-payment-channel.md §3.2。');
  console.error('');
  process.exit(1);
}

console.log(
  `   ✅ 价格三处一致：¥${yuan} / 年（大陆，${adapterFen} 分）、$${dollars} / 年（海外）`,
);
