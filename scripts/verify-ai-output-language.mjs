#!/usr/bin/env node
/**
 * 「输出语言」指令的真实生效验证（边界③的常驻复跑件）
 * ===================================================
 *
 * 与 `verify-ai-breakdown-live.mjs` 的分工：那个脚本验**链路**（闸门、目的地、
 * 格式、写回备注），本脚本验**语言**，而且带一条**对照**：
 *
 *   1. 同一个模型、同一份提示词，只切 `locale` ⇒ `en` 的条目里必须一个汉字都没有，
 *      `zh-CN` 的条目必须全是汉字。**两条方向都钉**，否则"永远中文"和"永远英文"
 *      这种实现都能骗过只测一边的判据。
 *   2. 线级变异：把**真发出去的那个请求体**里「输出语言：…」那一行删掉再发一次。
 *      如果英文输出真是那句话换来的，摘掉之后必须回到中文。
 *
 * 🔴 为什么第 2 步不能省：只跑第 1 步得到的"英文"可能是模型自己的偏好（提示词里
 * 的例子、任务标题本身就是英文），那样这条指令其实是**装饰**。
 * 变异做在**请求体**上，不碰 `packages/` —— 产品代码一个字节都不改。
 *
 * ⚠️ 前提：**得换一个有指令遵循能力的模型**。`qwen2.5:0.5b` 连"只输出 `- ` 条目"
 * 都不稳定遵守，用它跑会得到"en 也含汉字"，那是**探针不够格**，不是产品缺陷。
 * 本机实测：`ollama pull qwen2.5:3b`（1.9 GB）之后 3/3 次 en 含汉字条目 = 0。
 *
 * 配置：`HEYTA_AI_LIVE_CONFIG`，默认 `/tmp/heyta-ai-live/provider.json`（mode 600，**绝不入库**）。
 *   ⚠️ 默认路径的存在与否会打开别人那条旅程用例（`apps/web/tests/journey-ai-memory.integration.spec.tsx`）
 *   —— 复跑请用**自己的一份**：`HEYTA_AI_LIVE_CONFIG=/tmp/heyta-ai-lang/provider.json node scripts/verify-ai-output-language.mjs`
 * 没配置时明确打印"跳过"并退出 0 —— 没配端点不是失败，是"还没配"。
 */

import { readFileSync } from 'node:fs';

import {
  parseBreakdownItems,
  requestBreakdown,
} from '../packages/app-host/dist/index.js';
import { classifyDestination, requiresEgressConsent } from '../packages/ai/dist/index.js';

const CONFIG_PATH = process.env['HEYTA_AI_LIVE_CONFIG'] ?? '/tmp/heyta-ai-live/provider.json';
const EN_RUNS = 3;
const ZH_RUNS = 2;
/** 中日韩汉字 + 扩展 A + 兼容表意区。判据是"数得出个数"，不是人眼印象。 */
const CJK = /[㐀-䶿一-鿿豈-﫿]/;

let pass = 0;
let fail = 0;
function check(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ✅ ${label}${detail === '' ? '' : `  ${detail}`}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${label}${detail === '' ? '' : `  ${detail}`}`);
  }
}

let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  console.log(`⏭  没有找到真实端点配置（${CONFIG_PATH}），跳过。`);
  console.log('   这不是失败 —— 没配端点只是"还没配"。');
  process.exit(0);
}
if (typeof config.endpoint !== 'string' || typeof config.apiKey !== 'string') {
  console.log('⏭  配置里缺 endpoint 或 apiKey，跳过。');
  process.exit(0);
}

function authedFetch(url, init) {
  // ⚠️ 密钥只进 header，不进命令行、不进日志。
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${config.apiKey}` },
  });
}

const routing = {
  enabled: true,
  allowRemote: true,
  endpoints: [
    {
      id: 'language',
      label: '语言验证端点',
      endpoint: config.endpoint,
      model: config.model,
      // 🔴 必须显式声明 —— ADR-0010 §3.4，`breakdown` 需要 long_context
      capabilities: ['structured_output', 'long_context'],
    },
  ],
  routes: { breakdown: [{ endpointId: 'language' }] },
};
const destination = classifyDestination({ mode: config.mode ?? 'own', endpoint: config.endpoint });
const CONSENT = requiresEgressConsent(destination)
  ? [{ feature: 'breakdown', destination, grantedAt: Date.now() }]
  : [];

/** 跑一次真实拆解，返回条目数组（失败返回 null 并把原因打出来）。 */
async function breakdownItems(locale, onRequestBody) {
  const outcome = await requestBreakdown(
    { title: '上线新版本', note: '别忘灰度发布和回滚预案', locale },
    {
      routing,
      consents: CONSENT,
      routed: {
        fetchImpl: async (url, init) => {
          onRequestBody?.({ url, init });
          return authedFetch(url, init);
        },
      },
    },
  );
  if (!outcome.ok) {
    console.log(`     ↳ 调用失败：${outcome.reason} —— ${outcome.message}`);
    return null;
  }
  return outcome.proposal.items;
}

console.log('=== AI 输出语言：真实生效验证 ===\n');
console.log(`端点 = ${config.endpoint}，模型 = ${String(config.model)}，目的地 = ${destination}\n`);

// ── 1) 只切界面语言 ──────────────────────────────────────────────────────
console.log('1) 同一份提示词，只切 locale');
let lastEnRequest = null;
for (let i = 0; i < EN_RUNS; i += 1) {
  const items = await breakdownItems('en', (r) => (lastEnRequest = r));
  const cjk = items?.filter((x) => CJK.test(x)).length ?? -1;
  check(
    `en 第 ${i + 1} 次：条目非空且**含汉字 = 0**`,
    items !== null && items.length > 0 && cjk === 0,
    `条目=${String(items?.length ?? 0)} 含汉字=${String(cjk)} 首条="${String(items?.[0] ?? '').slice(0, 48)}"`,
  );
}
for (let i = 0; i < ZH_RUNS; i += 1) {
  const items = await breakdownItems('zh-CN');
  const latin = items?.filter((x) => !CJK.test(x)).length ?? -1;
  check(
    `zh-CN 第 ${i + 1} 次：条目非空且**全是汉字**`,
    items !== null && items.length > 0 && latin === 0,
    `条目=${String(items?.length ?? 0)} 非汉字=${String(latin)} 首条="${String(items?.[0] ?? '').slice(0, 48)}"`,
  );
}

// ── 2) 线级变异：摘掉「输出语言」那一行 ─────────────────────────────────
console.log('\n2) 变异：把真请求体里「输出语言：…」那一行删掉，其余一个字节不动');
if (lastEnRequest === null) {
  check('拿到了 baseline 请求体', false, '第 1 步没跑成，对照无法进行');
} else {
  const body = JSON.parse(String(lastEnRequest.init.body));
  const before = JSON.stringify(body);
  let removed = 0;
  for (const m of body.messages) {
    if (typeof m.content !== 'string' || !m.content.includes('输出语言：')) continue;
    m.content = m.content
      .split('\n')
      .filter((line) => {
        if (!line.startsWith('输出语言：')) return true;
        removed += 1;
        return false;
      })
      .join('\n');
  }
  check('变异确实生效（删掉 1 行，且这是唯一的改动）', removed === 1 && before !== JSON.stringify(body), `删掉行数=${String(removed)}`);

  const res = await authedFetch(lastEnRequest.url, { ...lastEnRequest.init, body: JSON.stringify(body) });
  const json = await res.json();
  const items = parseBreakdownItems(json?.choices?.[0]?.message?.content ?? '');
  const cjk = items.filter((x) => CJK.test(x)).length;
  check(
    '摘掉指令后**回到中文**（⇒ 英文是那句话换来的，不是模型自己选的）',
    items.length > 0 && cjk > 0,
    `条目=${String(items.length)} 含汉字=${String(cjk)} 首条="${String(items[0] ?? '').slice(0, 48)}"`,
  );
}

console.log('');
if (fail === 0) {
  console.log(`✅ 输出语言在真模型上生效（${String(pass)} 项）`);
  process.exit(0);
}
console.log(`❌ ${String(fail)} 项失败（通过 ${String(pass)} 项）`);
console.log('   ⚠️ 先确认模型有指令遵循能力（`qwen2.5:0.5b` 这种规模的"失败"是探针问题）。');
process.exit(1);
