#!/usr/bin/env node
/**
 * 钉住「托管 AI 的额度」这个**承诺**与它的**实现状态**。
 *
 * 为什么需要这道门禁：`¥12 / 月 · 300 次/月` 是一个**已经写进落地页与法务**的承诺，
 * 而它依赖的东西（云端 AI 端点、计量、收银台、`deepseek` 调用）**一个都不存在**。
 * 仓库原有的门禁校验的是"**收多少钱**"（`check-pricing-consistency`）与
 * "**文案怎么说**"（`check-ui-language` / `check-docs`），
 * **没有任何一道校验"承诺的东西是否存在"** —— 于是谁照着文案接线收银台，
 * 谁就会卖出一档收了钱交付不了的服务，而所有门禁都是绿的。
 *
 * 这道门禁只做五件**可失败**的事（每一件都能被一次故意的改动弄红）：
 *
 *   1. `ai-quota-ssot` 块存在且能解析 —— 唯一数字源被删掉就是红；
 *   2. 五处承诺里的额度数字**全部等于** ssot —— 只改一处就是红；
 *   3. `enforcement` 只能是 `not-implemented` / `enforced` 两个值之一；
 *   4. 声明 `enforced` 时，**计量实现必须真的存在** —— 空喊一声就是红；
 *   5. 声明 `not-implemented` 时，决定记录（ADR）必须存在，
 *      且参考文档必须带着"不得售卖"的硬约束。
 *
 * 🔴 它**不**检查"云端 AI 该不该做"：那是 ADR-0023 的问题，不是门禁的问题。
 * 门禁只保证"说法"与"状态"不会悄悄漂开。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 仓库根。默认是脚本所在目录的上一级。
 *
 * 🔴 `HEYTA_CHECK_ROOT` 只为**故障注入探针**存在（与 `check-pricing-consistency.mjs`
 * 同一约定）：让"故意改坏一处"落在副本里，而不是共享工作区的真实文件上。
 */
const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    : path.resolve(process.env.HEYTA_CHECK_ROOT);

/** 额度数字与实现状态的**唯一事实源**。 */
const QUOTA_DOC = 'docs/reference/pricing-and-entitlements.md';
/** 决定记录。它回答"为什么现在不做"，而不是重复数字。 */
const ADR = 'docs/adr/0023-managed-ai-quota-not-implemented.md';
const LEGAL_AI = 'server/legal/terms-of-service.ai.heyta.md';
const CATALOG_ZH = 'packages/i18n/src/locales/zh-CN.ts';
const CATALOG_EN = 'packages/i18n/src/locales/en.ts';

/**
 * 声明"已实现"时，这些文件里**至少有一个**必须存在。
 *
 * 约定：计量模块的落地位置。名字可以改，但改的时候必须同时改这里 ——
 * 这正是本检查的意义：**状态与实现不能各说各话。**
 */
const METERING_SENTINELS = [
  'server/src/billing/ai-quota.ts',
  'server/src/ai/quota.ts',
  'server/src/ai/metering.ts',
];

const ENFORCEMENT_VALUES = new Set(['not-implemented', 'enforced']);

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
        '      请更新本脚本的锚点，而不是把这条检查删掉：承诺漂移是真事故。',
    );
  }
  return m[1];
}

const problems = [];

// ── 1. 唯一数字源 ────────────────────────────────────────────────────────
const quotaDocText = read(QUOTA_DOC);
const ssotJson = must(
  quotaDocText,
  /```json ai-quota-ssot\s*\n([\s\S]*?)\n```/,
  `${QUOTA_DOC} 的 \`ai-quota-ssot\` 块`,
);

let ssot;
try {
  ssot = JSON.parse(ssotJson);
} catch (e) {
  throw new Error(
    `${QUOTA_DOC} 的 \`ai-quota-ssot\` 块不是合法 JSON —— 门禁无法判定，这不是通过。\n   ${e.message}`,
  );
}
if (!Number.isSafeInteger(ssot.quota) || ssot.quota <= 0) {
  throw new Error(
    `${QUOTA_DOC} 的 \`ai-quota-ssot.quota\` 不是一个正整数：${JSON.stringify(ssot.quota)}`,
  );
}
if (typeof ssot.enforcement !== 'string' || !ENFORCEMENT_VALUES.has(ssot.enforcement)) {
  problems.push(
    `🔴 \`ai-quota-ssot.enforcement\` 只能是 ${[...ENFORCEMENT_VALUES].join(' / ')}，` +
      `实际是 ${JSON.stringify(ssot.enforcement)}。\n` +
      '     这两个值不是标签，是**开关**：门禁按它决定要不要强制"计量实现存在"。',
  );
}

// ── 2. 五处承诺的数字必须全部与 ssot 相等 ────────────────────────────────
/**
 * 每一处给出：可读的名字、文件、以及**该文件里所有出现**的抽取正则。
 *
 * 🔴 用 `matchAll` 而不是 `exec`：同一个文件里出现两次而两次不同，
 * 也必须被抓到 —— 只取第一处会让"第二处写错"永远看不见。
 */
const claimSites = [
  ['中词条（落地页）', CATALOG_ZH, /'landing\.pricing\.hostedAi\.feature2':\s*'[^']*?(\d+)\s*次/g],
  ['英词条（落地页）', CATALOG_EN, /'landing\.pricing\.hostedAi\.feature2':\s*'[^']*?(\d+)\s*actions?/g],
  ['法务（AI 服务条款）', LEGAL_AI, /每个计费周期\s*\*{0,2}\s*(\d+)\s*次/g],
  ['参考文档正文', QUOTA_DOC, /(\d+)\s*次\s*\/\s*月/g],
];

for (const [label, file, re] of claimSites) {
  const text = read(file);
  const found = [...text.matchAll(re)].map((m) => Number(m[1]));
  if (found.length === 0) {
    problems.push(
      `🔴 ${label}（${file}）里一个额度数字都找不到 —— 要么承诺被删了（那要改 ADR），` +
        '要么门禁锚点失效（那要改本脚本）。两者都不该静默通过。',
    );
    continue;
  }
  for (const value of found) {
    if (value !== ssot.quota) {
      problems.push(
        `🔴 ${label}（${file}）写的是 ${value} 次，而唯一数字源是 ${ssot.quota} 次。\n` +
          `     改额度必须同一次改：${CATALOG_ZH} / ${CATALOG_EN} / ${LEGAL_AI} / ${QUOTA_DOC}`,
      );
    }
  }
}

// ── 3. 状态 ↔ 实现：**两边都在**，而且执行点还在原地 ─────────────────────
//
// §3/§3b 一起读。§3 检查"决定记录与文档在不在"，§3b 检查"**代码有没有照做**"。
// 一条只存在于文档里的约束等于没有约束 —— 而且这里的失败形状特别隐蔽：
// 文档写着"不得售卖"，收银台照样卖得出去，两边的测试都是绿的。
//
// ⚠️ 收银台那份解析**必须在 §3 之前**：两段的判据现在共用 `callsBlock`
// （`enforced` 要它**在**、`not-implemented` 要它**在被调用**），
// 定义放在后面会踩 TDZ —— 症状是整个门禁在启动时抛 ReferenceError，
// 而不是"某一条臂红"，那会被读成"环境坏了"。
const PRICE_BOOK = 'server/src/billing/price-book.ts';
const CHECKOUT_ROUTE = 'server/src/billing/checkout.routes.ts';

const priceBookText = read(PRICE_BOOK);
// 🔴 必须**先解析对象体、再在体内查键**。第一版这里写的是
// `/NOT_YET_DELIVERABLE_SKUS[\s\S]*?hosted-ai-monthly/` —— 那个形状**永远为真**：
// 常量上下的注释里、以及同文件的 `SKU_GRANTS` 里都含有同一个 SKU 字符串，
// 于是把实际那一条目删掉之后门照样绿。故障注入当场把它证伪了，这就是它的价值。
const blockBody =
  /NOT_YET_DELIVERABLE_SKUS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(priceBookText)?.[1] ?? '';
const declaresBlock = /['"]hosted-ai-monthly['"]\s*:/.test(blockBody);
const routeText = existsSync(path.join(ROOT, CHECKOUT_ROUTE)) ? read(CHECKOUT_ROUTE) : '';
// 要求"被赋值调用"，而不是"被提到"：注释里写一句"这里应该调用 notSellableReason()"
// 不该算作执行点存在。
const callsBlock = /=\s*notSellableReason\s*\(/.test(routeText);

const meteringFiles = METERING_SENTINELS.filter((f) => existsSync(path.join(ROOT, f)));

if (ssot.enforcement === 'enforced') {
  if (meteringFiles.length === 0) {
    problems.push(
      '🔴 `enforcement = enforced`，但计量实现不存在。\n' +
        `     找过这些位置：${METERING_SENTINELS.join(' / ')}\n` +
        '     后果：这一档会被当成"已经能交付"而卖出去，而实际没有任何计数器 ——\n' +
        '     用户付 ¥12 得到的是不限次，或者一个 500。',
    );
  }
  // 🔴 执行点**必须留在原地**。清空清单不等于拆掉闸门：下一档"已定价但暂不可交付"
  // 的服务靠的还是同一个调用点。把它一起删掉，症状是"以后加限制档时没人记得再装回去"，
  // 而那正是本门禁要挡的那类"文档写着不许、收银台照样卖"。
  if (!callsBlock) {
    problems.push(
      `🔴 \`enforcement = enforced\`，但 ${CHECKOUT_ROUTE} 已经不再调用 \`notSellableReason(...)\`。\n` +
        '     这一档可以卖了，**这道门不该跟着拆** —— 它是机制，不是这一档的状态。',
    );
  }
} else {
  // `not-implemented`：决定记录与"不得售卖"的硬约束都必须在场。
  if (!existsSync(path.join(ROOT, ADR))) {
    problems.push(
      `🔴 \`enforcement = not-implemented\`，但决定记录不存在：${ADR}。\n` +
        '     状态必须**被声明**，而且要有地方解释"为什么现在不做、什么时候做"。',
    );
  }
  if (!quotaDocText.includes('不得被售卖')) {
    problems.push(
      `🔴 \`enforcement = not-implemented\`，但 ${QUOTA_DOC} 里没有"不得被售卖"这条硬约束。\n` +
        '     这是这个状态唯一有约束力的推论：计量不存在 → 不许收这一档的钱。',
    );
  }
}

// ── 3b. 状态 ↔ **执行点**：收银台必须真的照这个状态办事 ──────────────────
//
// 解析在 §3 之前（`PRICE_BOOK` / `declaresBlock` / `callsBlock`），这里只用。

if (ssot.enforcement === 'not-implemented') {
  if (!declaresBlock) {
    problems.push(
      `🔴 \`enforcement = not-implemented\`，但 ${PRICE_BOOK} 没有把 hosted-ai-monthly\n` +
        '     列入 `NOT_YET_DELIVERABLE_SKUS`。那是这条约束**唯一的执行点**：\n' +
        '     没有它，收银台今天就能把一档"收了钱交付不了"的服务卖出去。',
    );
  }
  if (!callsBlock) {
    problems.push(
      `🔴 \`enforcement = not-implemented\`，但 ${CHECKOUT_ROUTE} 没有调用 \`notSellableReason(...)\`。\n` +
        '     声明了常量却不查它 = 一个好看的常量。约束要在**下单那一刻**被问一次，\n' +
        '     而不是在文件里躺着。对应测试：server/tests/billing-checkout.routes.spec.ts。',
    );
  }
} else if (declaresBlock) {
  // ⚠️ 这里**只看条目在不在**，不看调用点在不在 —— 第一版把 `callsBlock` 也算成
  // "仍然挡着"，于是出现一个说不通的二难：计量上线后要么删掉调用点（拆掉机制，
  // §3 那条新臂就红），要么留着（这条臂红）。挡这一档的是**清单里那条 entry**，
  // 调用点本身是中立的机制，它对任何 entry 都不返回理由。
  problems.push(
    '🔴 `enforcement = enforced`，但收银台仍然把 hosted-ai-monthly 列为不可交付。\n' +
      '     这会让计量上线之后这一档**继续卖不出去** —— 做完了却交付不到用户手上。\n' +
      '     清空 `NOT_YET_DELIVERABLE_SKUS` 里那一条是接上计量的同一个提交里该做的事\n' +
      '     （**只删那一条 entry**，调用点与机制留着）。',
  );
}

// ── 4. 决定记录必须自带最小实现清单 ──────────────────────────────────────
if (existsSync(path.join(ROOT, ADR))) {
  const adrText = read(ADR);
  if (!adrText.includes('最小清单')) {
    problems.push(
      `🔴 ${ADR} 里没有"最小清单"。\n` +
        '     "不做"必须是一个**有终点**的决定：清单清空之日就是它被取代之日。\n' +
        '     否则"以后再说"会把这一档永久留在"承诺了但交付不了"的状态。',
    );
  }
}

// ── 收尾 ────────────────────────────────────────────────────────────────
if (problems.length > 0) {
  console.error('');
  console.error('🔴 托管 AI 额度的「承诺 ↔ 状态」不一致：');
  console.error('');
  for (const p of problems) console.error(`   ❌ ${p}`);
  console.error('');
  console.error(`   唯一数字源：${QUOTA_DOC} 的 \`\`\`json ai-quota-ssot 块。`);
  console.error(`   决定记录：${ADR}（含最小实现清单）。`);
  console.error('   见 docs/adr/0023-managed-ai-quota-not-implemented.md。');
  console.error('');
  process.exit(1);
}

const statusLabel =
  ssot.enforcement === 'enforced'
    ? `已实现（${meteringFiles[0]}）`
    : '已声明、未实现（且已约束为「不得售卖」）';
console.log(`   ✅ 托管 AI 额度五处一致：${ssot.quota} ${ssot.unit}；状态 ${statusLabel}`);
