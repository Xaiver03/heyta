#!/usr/bin/env node
/**
 * 真实端到端拆解验证
 * ====================
 *
 * 与 `verify-ai-live.mjs` 的分工：
 * - `verify-ai-live.mjs` 验的是**路由层**（闸门、目的地推导、请求体、失败分类）
 * - 本脚本验的是**整条功能链路**：`requestBreakdown` —— 从一句任务描述
 *   到一份可写进备注的 Markdown 清单
 *
 * 🔴 为什么这条链必须单独用真实端点验一次。
 *
 * `requestBreakdown` 的集成测试用的是假 fetch。假 fetch 能证明"我们发出的请求
 * 形状对"，但证明不了**真模型会不会按我们要求的格式回话**。
 * 提示词里写了"每行用「- 」开头，不要前言"，这件事只有真跑才知道。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 配置：`/tmp/heyta-ai-live/provider.json`（mode 600，**绝不入库**）
 *   { "mode":"own", "endpoint":"...", "apiKey":"...", "model":"..." }
 *
 * 没配置时**退出 2（"这一轮根本没跑"）**，只有显式 `--skip` /
 * `HEYTA_AI_LIVE_ALLOW_SKIP=1` 才允许跳过。判据在 `scripts/lib/live-provider-config.mjs`。
 * 以前这里写的是"跳过并退出 0"，于是它可以在一次都没碰过真模型的情况下报绿。
 */

import {
  mergeChecklistIntoNote,
  parseBreakdownItems,
  requestBreakdown,
} from '../packages/app-host/dist/index.js';
// 🔴 目的地与"要不要出境授权"由**端点**推导（ADR-0006 / ADR-0010），不许在本脚本里写死：
// 本机 Ollama（回环）的目的地是 `none`、**不需要**逐功能授权；非回环的用户自建服务才是
// `user-endpoint` + 必须授权。以前这两条在本脚本里被硬编码成后者的形状，
// 于是拿本机端点跑会得到「❌ 被拒绝了 / ❌ 网络请求数 = 0 / ❌ 目的地如实标注」——
// **读起来像出境闸门漏了**，而闸门的行为完全正确。
import { classifyDestination, requiresEgressConsent } from '../packages/ai/dist/index.js';
import { requireLiveProviderConfig } from './lib/live-provider-config.mjs';

let pass = 0;
let fail = 0;

function ok(label, detail = '') {
  pass += 1;
  console.log(`  ✅ ${label}${detail === '' ? '' : `  ${detail}`}`);
}
function bad(label, detail = '') {
  fail += 1;
  console.log(`  ❌ ${label}${detail === '' ? '' : `  ${detail}`}`);
}
function check(label, condition, detail = '') {
  if (condition) ok(label, detail);
  else bad(label, detail);
}

const config = requireLiveProviderConfig('pnpm verify:ai-breakdown-live');

const TITLE = '上线新版本';
// 探针所用的界面语言 —— 决定提示词末尾那条「输出语言」指令。
// 跑英文判据：HEYTA_AI_LOCALE=en pnpm verify:ai-breakdown-live
const SOURCE_LOCALE = process.env['HEYTA_AI_LOCALE'] ?? 'zh-CN';

const EXISTING_NOTE = '我自己写的备注。';

/**
 * 带上密钥的 fetch。
 *
 * ⚠️ 密钥只进 header，**不进命令行、不进日志**。
 */
function authedFetch(url, init) {
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${config.apiKey}` },
  });
}

/** 数请求次数，用来证明"未授权时一个字节都没发"。 */
function countingFetch(inner) {
  let count = 0;
  const impl = (url, init) => {
    count += 1;
    return inner(url, init);
  };
  return { impl, count: () => count };
}

const routing = {
  enabled: true,
  allowRemote: true,
  endpoints: [
    {
      id: 'live',
      label: '真实端点',
      endpoint: config.endpoint,
      model: config.model,
      // 🔴 必须显式声明 —— ADR-0010 §3.4，`breakdown` 需要 long_context
      capabilities: ['structured_output', 'long_context'],
    },
  ],
  routes: { breakdown: [{ endpointId: 'live' }] },
};

/** 目的地由端点推导 —— 与产品代码走的是同一个函数，不是本脚本自己的一套判断。 */
const DESTINATION = classifyDestination({ mode: 'own', endpoint: config.endpoint });

const CONSENT = {
  feature: 'breakdown',
  destination: DESTINATION,
  grantedAt: Date.now(),
};

/** 本机端点不需要授权，这一步在该形状下**测的是另一件事**（见 1) 里的分支）。 */
const NEEDS_CONSENT = requiresEgressConsent(DESTINATION);

console.log('=== 真实端到端拆解验证 ===\n');
console.log(`端点形状：目的地 = ${DESTINATION}，需要出境授权 = ${NEEDS_CONSENT ? '是' : '否'}\n`);

// ── 1) 闸门 ──────────────────────────────────────────────────────────────
{
  const { impl, count } = countingFetch(authedFetch);
  if (NEEDS_CONSENT) {
    console.log('1) 未授权时：不发请求');
    const outcome = await requestBreakdown(
      { title: TITLE, locale: SOURCE_LOCALE },
      { routing, consents: [], routed: { fetchImpl: impl } },
    );
    check('被拒绝了', !outcome.ok);
    check('网络请求数 = 0', count() === 0, `实际 ${String(count())} 次`);
    if (!outcome.ok) {
      check('提示指向"逐功能授权"', outcome.message.includes('授权'), outcome.message);
    }
  } else {
    // 本机（回环）端点：明文没离开这台机器 ⇒ ADR-0010 的逐功能出境授权**不适用**。
    // 这一支不是"跳过"，它钉的是这条规则的另一半：形状判错（把本机当成出境）会当场红，
    // 而那种错的实际后果是"用户对着自己的 Ollama 被反复要授权"。
    console.log('1) 本机端点：出境授权不适用（目的地 = none），请求照发');
    const outcome = await requestBreakdown(
      { title: TITLE, locale: SOURCE_LOCALE },
      { routing, consents: [], routed: { fetchImpl: impl } },
    );
    check('没有被"缺授权"挡住', outcome.ok || outcome.reason !== 'consent-missing', String(outcome.reason));
    check('请求数 = 1', count() === 1, `实际 ${String(count())} 次`);
  }
}

// ── 2) 总开关 ────────────────────────────────────────────────────────────
console.log('\n2) 总开关关着时：不发请求');
{
  const { impl, count } = countingFetch(authedFetch);
  const outcome = await requestBreakdown(
    { title: TITLE, locale: SOURCE_LOCALE },
    { routing: { ...routing, enabled: false }, consents: [CONSENT], routed: { fetchImpl: impl } },
  );
  check('被拒绝了', !outcome.ok);
  check('网络请求数 = 0', count() === 0, `实际 ${String(count())} 次`);
}

// ── 3) 真实拆解 ──────────────────────────────────────────────────────────
console.log('\n3) 授权后：真实拆解');
const started = Date.now();
const outcome = await requestBreakdown(
  { title: TITLE, note: '别忘灰度发布和回滚预案', locale: SOURCE_LOCALE },
  { routing, consents: [CONSENT], routed: { fetchImpl: authedFetch } },
);
const elapsed = Date.now() - started;

if (!outcome.ok) {
  bad('真实调用失败', `${outcome.reason} —— ${outcome.message}`);
} else {
  const { proposal } = outcome;
  ok('真实调用成功', `用时 ${String(elapsed)} ms`);
  check('目的地如实标注', proposal.destination === DESTINATION, proposal.destination);
  check(
    '解析出至少 3 项',
    proposal.items.length >= 3,
    `实际 ${String(proposal.items.length)} 项`,
  );

  // 🔴 这一条只有真跑才能验：模型到底有没有按格式回话
  check(
    '每一项都不是空的、也不带列表标记残留',
    proposal.items.every((i) => i.trim() !== '' && !/^[-*•·]/.test(i)),
  );
  check(
    '每一项都不是前言/客套（没有被误当成条目）',
    proposal.items.every((i) => !/^(好的|以下是|当然|没问题)/.test(i)),
  );

  console.log('  拆出的清单：');
  for (const item of proposal.items) console.log(`    - ${item}`);

  // ── 4) 写回备注 ────────────────────────────────────────────────────────
  console.log('\n4) 渲染成 Markdown 并合并进备注');
  const merged = mergeChecklistIntoNote(EXISTING_NOTE, proposal.items);
  check('原备注被保留', merged.startsWith(EXISTING_NOTE));
  check('清单是未勾选格式', merged.includes('- [ ] '));
  check(
    '清单项数与解析结果一致',
    (merged.match(/- \[ \] /g) ?? []).length === proposal.items.length,
  );

  // ── 5) 幂等性：同一份文本再解析一次结果不变 ───────────────────────────
  console.log('\n5) 解析是确定的（同一输入两次结果相同）');
  const again = parseBreakdownItems(proposal.items.map((i) => `- ${i}`).join('\n'));
  check('再解析一次结果一致', JSON.stringify(again) === JSON.stringify(proposal.items));
}

console.log('');
if (fail === 0) {
  console.log(`✅ 端到端拆解链路全部通过（${String(pass)} 项）`);
  process.exit(0);
}
console.log(`❌ ${String(fail)} 项失败（通过 ${String(pass)} 项）`);
process.exit(1);
