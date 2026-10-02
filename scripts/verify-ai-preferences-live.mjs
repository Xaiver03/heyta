#!/usr/bin/env node
/**
 * 偏好层真实端到端验证
 * ======================
 *
 * 与 `verify-ai-breakdown-live.mjs` 的分工：那个验**功能链路**（能不能拆出来），
 * 本脚本验**记忆层**（偏好有没有被用上、有没有被复述、关掉时有没有真的不发）。
 *
 * 🔴 为什么这三件事必须用真端点验。
 *
 * 集成测试用的是假 fetch。假 fetch 能证明"我们**发**了正确的东西"，
 * 证明不了**真模型收到之后会不会照着做**。而这一层里有两条指令是
 * 纯靠提示词约束的、没有任何程序性保障：
 *
 *   1. 「请对齐这个粒度」 —— 模型可以完全无视
 *   2. 「不要复述」       —— 模型可以把偏好原文抄进清单里
 *
 * 第 2 条尤其危险：提示词里**明确给了**一份关于用户的描述，
 * 而模型的默认行为之一就是"把上下文里有用的信息说出来"。
 * 一旦它把「你倾向低估工时」写进任务清单，用户看到的就是
 * 自己的画像被打印在待办事项里 —— 这比不发偏好糟糕得多。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 配置：`/tmp/heyta-ai-live/provider.json`（mode 600，**绝不入库**）
 *   { "mode":"own", "endpoint":"...", "apiKey":"...", "model":"..." }
 *
 * 没配置时**退出 2（"这一轮根本没跑"）**，只有显式 `--skip` /
 * `HEYTA_AI_LIVE_ALLOW_SKIP=1` 才允许跳过（判据在 `scripts/lib/live-provider-config.mjs`）。
 * ⚠️ 本脚本自己已经有"第三态：没能验证"的纪律（见下面的 `unverified`），
 * 那条治理的是**跑起来了但前提不成立**；配置缺失是**没跑起来**，两态要分开。
 */

import { buildBreakdownInvocation, parseBreakdownItems, requestBreakdown } from '../packages/app-host/dist/index.js';
import { classifyDestination } from '../packages/ai/dist/index.js';
import { renderHintBlock, renderPreferenceHints } from '../packages/domain/dist/index.js';
import { requireLiveProviderConfig } from './lib/live-provider-config.mjs';

let pass = 0;
let fail = 0;
/**
 * 🔴 **第三态：没能验证。**
 *
 * 不能把"检查没跑成"算成通过 —— 那正是这个脚本第一版犯的错：
 * 端点抖了一下、清单为空，于是「模型没有复述偏好」这条**空过**并报 ✅。
 * 一个在失败时更绿的检查，比没有检查更危险。
 */
let unverified = 0;
const ok = (l, d = '') => {
  pass += 1;
  console.log(`  ✅ ${l}${d === '' ? '' : `  ${d}`}`);
};
const bad = (l, d = '') => {
  fail += 1;
  console.log(`  ❌ ${l}${d === '' ? '' : `  ${d}`}`);
};
const check = (l, c, d = '') => (c ? ok(l, d) : bad(l, d));
/** 检查的前提没满足 —— 显式记成"未能验证"，不进 pass。 */
const skip = (l, why) => {
  unverified += 1;
  console.log(`  ⚠️  ${l} —— 未能验证：${why}`);
};

/**
 * 有界重试：只用来吸收端点抖动，不用来掩盖确定性失败。
 *
 * 重试过会**打出来**（`第 2 次才成功`）—— 悄悄重试等于把
 * "这个端点不稳"这条信息藏掉，而它本身是有价值的信号。
 */
async function attempt(times, label, run) {
  let last;
  for (let i = 1; i <= times; i += 1) {
    last = await run();
    if (last.ok) {
      if (i > 1) console.log(`     · ${label} 第 ${String(i)} 次才成功（端点抖动）`);
      return last;
    }
  }
  return last;
}

const config = requireLiveProviderConfig('pnpm verify:ai-preferences-live');

/**
 * 🔴 故意用**极其好认**的取值，这样"复述"是逐字可查的。
 *
 * 如果用普通数字（比如 6 项、12 字），清单里天然可能出现这些数字，
 * 于是断言会变成噪声。7 / 23 / 2.40 配上下面的短语，只要出现就是复述。
 */
const PLANTED = {
  granularity: 7,
  titleLength: 23,
  bias: 2.4,
};

const prefs = {
  memoryEnabled: true,
  estimateBias: {
    id: 'estimate-bias',
    value: PLANTED.bias,
    sampleSize: 30,
    confidence: 0.9,
    evidence: '基于 30 次专注，你倾向低估任务耗时',
  },
  deepWorkWindow: null,
  leadTime: null,
  granularity: {
    id: 'granularity',
    value: PLANTED.granularity,
    sampleSize: 20,
    confidence: 1,
    evidence: '你的 12 条带清单任务，中位数是 7 项',
  },
  titleStyle: {
    id: 'title-style',
    value: { cjkShare: 1, medianTitleLength: PLANTED.titleLength, emojiShare: 0 },
    sampleSize: 40,
    confidence: 0.9,
    evidence: '你的任务标题平均 23 个字',
  },
  withheld: [],
};

const OFF = { ...prefs, memoryEnabled: false };

const TITLE = '把新版本发到生产环境';
// 探针所用的界面语言 —— 决定提示词末尾那条「输出语言」指令。
// 跑英文判据：HEYTA_AI_LOCALE=en pnpm verify:ai-preferences-live
const SOURCE_LOCALE = process.env['HEYTA_AI_LOCALE'] ?? 'zh-CN';


const routing = {
  enabled: true,
  allowRemote: true,
  endpoints: [
    {
      id: 'live',
      label: '真实端点',
      endpoint: config.endpoint,
      model: config.model,
      capabilities: ['structured_output', 'long_context'],
    },
  ],
  routes: { breakdown: [{ endpointId: 'live' }] },
};

// 目的地由端点推导（与 `verify-ai-breakdown-live.mjs` 同一个理由）：本机回环端点的
// 目的地是 `none`，写死 `user-endpoint` 会让这条授权记录**永远匹配不上**当前目的地。
const CONSENT = {
  feature: 'breakdown',
  destination: classifyDestination({ mode: 'own', endpoint: config.endpoint }),
  grantedAt: Date.now(),
};

function authedFetch(url, init) {
  return fetch(url, { ...init, headers: { ...(init?.headers ?? {}), authorization: `Bearer ${config.apiKey}` } });
}

/** 记录真实请求体，同时把请求转发出去。 */
function capturingFetch() {
  const bodies = [];
  return {
    bodies,
    impl: async (url, init) => {
      try {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
      } catch {
        bodies.push({});
      }
      return authedFetch(url, init);
    },
  };
}

/** 提示词里"不要复述"所针对的那些字串 —— 出现即违规。 */
const ECHO_PROBES = [
  '关于这位用户的历史习惯',
  '对齐这个粒度',
  '倾向低估',
  '2.40 倍',
  '平均 23 个字',
];
// 🔴 注意这里**不能**放裸的「历史习惯」—— 系统提示词本身就写着
// 「如果给出了用户的历史习惯……」，于是这条断言在"偏好一个字都没发"时也会红。
// 断言要针对**内容**，不要针对会在别处出现的表头。

/**
 * 元话语探针：模型在"解释自己在做什么"，而不是输出清单。
 *
 * ⚠️ 与上面不同，这些是**可疑**而非**确凿**：清单里出现"根据你的习惯"
 * 一定是违规，但"偏好"单独出现可能是正常词。所以分开报。
 */
const META_PROBES = ['根据你的习惯', '根据你的历史', '按照你的偏好', '我为你调整'];

/** 从结果里安全取清单项（`ok` 为假时没有 proposal）。 */
const itemsOf = (r) => (r.ok ? r.proposal.items : []);

console.log('=== 真实偏好层验证 ===\n');

// ── 1) 主开关关着：真端点上也不该出现任何偏好 ────────────────────────────
console.log('1) 主开关关着：真实调用里不得出现偏好');
{
  const { bodies, impl } = capturingFetch();
  const offHints = renderPreferenceHints(OFF, 'breakdown');
  check('关着时生成了 0 条提示', offHints.length === 0, `实际 ${String(offHints.length)} 条`);

  const res = await requestBreakdown(
    { title: TITLE, locale: SOURCE_LOCALE },
    { routing, consents: [CONSENT], routed: { fetchImpl: impl }, preferences: offHints },
  );
  check('真实调用成功', res.ok === true, res.ok ? '' : String(res.reason ?? ''));

  const body = JSON.stringify(bodies[0] ?? {});
  check('🔴 请求体里没有任何偏好字串', !ECHO_PROBES.some((p) => body.includes(p)));
  check('请求体里没有偏好段落表头', !body.includes('关于这位用户'));
}

// ── 2) 开着：真实调用带上偏好，且模型**不复述** ──────────────────────────
console.log('\n2) 开着：真实调用带上偏好，且模型不得复述');
let withHintsItems = 0;
let withoutHintsItems = 0;
{
  const hints = renderPreferenceHints(prefs, 'breakdown');
  check('生成了 3 条提示（粒度/风格/估算）', hints.length === 3, `实际 ${String(hints.length)} 条`);
  check('提示段落非空', renderHintBlock(hints).length > 0);

  const { bodies, impl } = capturingFetch();
  const res = await attempt(3, '带偏好的调用', () =>
    requestBreakdown(
      { title: TITLE, locale: SOURCE_LOCALE },
      { routing, consents: [CONSENT], routed: { fetchImpl: impl }, preferences: hints },
    ),
  );

  // 先把"发出去了"钉住 —— 否则下面的"没复述"可能只是因为压根没发。
  const body = JSON.stringify(bodies[0] ?? {});
  check('🔴 请求体**确实**带上了偏好（不然下面那条是空过）', body.includes('关于这位用户的历史习惯'));
  check('请求体带上了种下的粒度', body.includes(String(PLANTED.granularity)));
  check('请求体带上了种下的倍数', body.includes(PLANTED.bias.toFixed(2)));

  if (!res.ok) {
    bad('真实调用成功', `${res.reason} —— ${res.message}`);
    skip('模型没有复述偏好原文', '调用没成功，这条判不了');
    skip('没有输出元话语', '调用没成功，这条判不了');
    skip('拆出了至少 3 项', '调用没成功，这条判不了');
  } else {
    ok('真实调用成功');
    const items = res.proposal.items;
    withHintsItems = items.length;
    check('拆出了至少 3 项', items.length >= 3, `实际 ${String(items.length)} 项`);

    if (items.length === 0) {
      // 🔴 这一支必须显式存在：清单为空时，"没复述"必然成立 ——
      // 报 ✅ 就是空过。宁可说"没能验证"。
      skip('模型没有复述偏好原文', '本轮没有产出清单，复述与否无从判断');
      skip('没有输出元话语', '本轮没有产出清单，无从判断');
    } else {
      const out = items.join('\n');
      const echoed = ECHO_PROBES.filter((p) => out.includes(p));
      check('🔴 模型**没有复述**偏好原文', echoed.length === 0, echoed.length === 0 ? '' : `复述了：${echoed.join('、')}`);

      const meta = META_PROBES.filter((p) => out.includes(p));
      check('模型没有输出元话语（在解释自己怎么想的）', meta.length === 0, meta.length === 0 ? '' : `出现：${meta.join('、')}`);

      console.log(`  清单（${String(items.length)} 项）：`);
      for (const it of items) console.log(`    - ${it}`);
    }
  }
}

// ── 3) 同一任务、不带偏好：粒度差异（informational） ──────────────────────
console.log('\n3) 同一任务、不带偏好：对比粒度');
{
  const { impl } = capturingFetch();
  const res = await attempt(3, '不带偏好的调用', () =>
    requestBreakdown(
      { title: TITLE, locale: SOURCE_LOCALE },
      { routing, consents: [CONSENT], routed: { fetchImpl: impl }, preferences: [] },
    ),
  );
  withoutHintsItems = itemsOf(res).length;
  check('真实调用成功', res.ok === true, res.ok ? '' : `${res.reason} —— ${res.message}`);
  console.log(`   不带偏好：${String(withoutHintsItems)} 项；带偏好（种了 ${String(PLANTED.granularity)} 项）：${String(withHintsItems)} 项`);
  console.log('   ℹ️  这一条**只报告不断言** —— 单次采样说服不了统计结论，');
  console.log('      而且模型的输出长度本来就会波动。要拿它下结论得跑一批。');
}

// ── 4) 提示词装配：不给偏好时，段落一个字都不该进去 ────────────────────────
console.log('\n4) 装配层（不发网络请求）');
{
  const noPrefs = buildBreakdownInvocation({ title: TITLE, locale: SOURCE_LOCALE }, []);
  const withPrefs = buildBreakdownInvocation({ title: TITLE, locale: SOURCE_LOCALE }, renderPreferenceHints(prefs, 'breakdown'));
  check('不给偏好时，prompt 里没有偏好段落', !noPrefs.user.includes('关于这位用户'));
  check('给偏好时，prompt 里有偏好段落', withPrefs.user.includes('关于这位用户'));
  check('系统提示里写了「不要复述」', withPrefs.system.includes('不要复述'));
  check(
    '两次调用的 user 段落不同（偏好确实改变了输入）',
    noPrefs.user !== withPrefs.user,
  );
}

// ── 5) 解析是确定的 ───────────────────────────────────────────────────────
console.log('\n5) 解析确定性');
{
  const raw = '- 甲\n- 乙\n- 丙';
  check('两次解析结果一致', JSON.stringify(parseBreakdownItems(raw)) === JSON.stringify(parseBreakdownItems(raw)));
}

console.log('');
if (fail === 0 && unverified === 0) {
  console.log(`✅ 真实偏好层验证全部通过（${String(pass)} 项）`);
  process.exit(0);
}
if (unverified > 0) {
  console.log(`⚠️  通过 ${String(pass)} / 失败 ${String(fail)} / **未能验证 ${String(unverified)}**`);
  console.log('   "未能验证"不算通过 —— 前提没满足时，检查没有跑成。');
} else {
  console.log(`❌ 失败 ${String(fail)} 项 / 通过 ${String(pass)} 项`);
}
process.exit(1);
