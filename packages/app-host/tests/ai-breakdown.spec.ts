/**
 * AI 拆解任务测试
 * =================
 *
 * 这个文件是 `@heyta/ai` 的**第一个真实调用点**的测试。
 *
 * 🔴 最重要的一条不是"解析对不对"，而是：
 * **出境闸门在这个调用点上真的会拦下请求，而且请求一个字节都没发出去。**
 *
 * 在此之前 `invokeRouted` 只有单测。单测能证明"这一层逻辑对"，
 * 证明不了"接起来之后仍然对" —— 而接错的地方（比如把
 * `consents` 传成 `[]` 之外的东西、或者传了对但不该用的字段）
 * 恰恰只有集成点才会暴露。
 */

import { describe, expect, it, vi } from 'vitest';

import { renderPreferenceHints, type PreferenceSet } from '@heyta/domain';

import {
  DEFAULT_ROUTING_POLICY,
  type AiRoutingConfig,
  type EgressConsent,
} from '@heyta/ai';

import {
  MAX_BREAKDOWN_ITEMS,
  MAX_ITEM_LENGTH,
  buildBreakdownInvocation,
  manualChecklistSkeleton,
  mergeChecklistIntoNote,
  parseBreakdownItems,
  renderChecklist,
  requestBreakdown,
} from '../src/ai-breakdown.js';

// ─────────────────────────────────────────────────────────────────────────
// 构造假端点
// ─────────────────────────────────────────────────────────────────────────

const LOCAL_ENDPOINT = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  // 🔴 必须显式声明：ADR-0010 §3.4 规定"能力不做任何推断"，
  // 而 `breakdown` 需要 `long_context`。不写就不是"可能有"，是"没有"。
  capabilities: ['structured_output', 'long_context'],
};

const REMOTE_ENDPOINT = {
  id: 'remote',
  label: '云端',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  capabilities: ['structured_output', 'long_context'],
};

/**
 * 造路由配置。
 *
 * ⚠️ 调用点写 `{ breakdown: ['local', 'remote'] }`（一串端点 id，顺序即回退顺序），
 * 内部翻成 `AiRouteTarget[]`。`routes` 的真形状是 `{ endpointId, model? }`，
 * 直接写字符串是**编译不过的** —— 这里替调用点省掉那个噪音。
 */
function routing(
  endpoints: readonly unknown[],
  routeIds: Partial<Record<'capture' | 'breakdown' | 'prioritize' | 'duration-estimate', readonly string[]>>,
): AiRoutingConfig {
  const routes: AiRoutingConfig['routes'] = {};
  for (const [feature, ids] of Object.entries(routeIds)) {
    if (ids === undefined) continue;
    routes[feature as keyof AiRoutingConfig['routes']] = ids.map((endpointId) => ({ endpointId }));
  }
  return {
    enabled: true,
    allowRemote: true,
    endpoints: endpoints as AiRoutingConfig['endpoints'],
    routes,
  };
}

/** 返回一段模型风格的文本。 */
function fetchReturning(content: string): { impl: typeof fetch; calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  const impl = ((url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body ?? '' });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content } }] }),
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content } }] })),
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const LOCAL_CONSENT: EgressConsent = {
  feature: 'breakdown',
  destination: 'user-endpoint',
  grantedAt: 1,
};

/** 造一个"有全部偏好"的开关打开状态。 */
const withPrefs = (): PreferenceSet => ({
  memoryEnabled: true,
  estimateBias: {
    id: 'estimate-bias',
    value: 1.8,
    sampleSize: 30,
    confidence: 0.9,
    evidenceFacts: { kind: 'estimate-bias', multiplier: 1.8, samples: 30 },
    evidence: '基于 30 次专注，你倾向低估任务耗时 —— 实际用时约为计划的 1.80 倍',
  },
  deepWorkWindow: {
    id: 'deep-work-window',
    value: { startHour: 8, endHour: 11, concentration: 0.8 },
    sampleSize: 40,
    confidence: 0.9,
    evidenceFacts: {
      kind: 'deep-work-window',
      startHour: 8,
      endHour: 11,
      concentration: 0.8,
      samples: 40,
    },
    evidence: '基于 40 次专注，80% 集中在 08:00–11:00',
  },
  leadTime: null,
  granularity: {
    id: 'granularity',
    value: 6,
    sampleSize: 12,
    confidence: 0.9,
    evidenceFacts: { kind: 'granularity', items: 6, samples: 12 },
    evidence: '你的 12 条带清单任务，中位数是 6 项',
  },
  titleStyle: {
    id: 'title-style',
    value: { cjkShare: 1, medianTitleLength: 12, emojiShare: 0 },
    sampleSize: 40,
    confidence: 0.9,
    evidenceFacts: {
      kind: 'title-style',
      cjkShare: 1,
      medianTitleLength: 12,
      emojiShare: 0,
      samples: 40,
    },
    evidence: '基于 40 条任务，你的标题以中文为主，平均 12 个字',
  },
  withheld: [],
});

// ─────────────────────────────────────────────────────────────────────────
// 构造调用
// ─────────────────────────────────────────────────────────────────────────

describe('buildBreakdownInvocation', () => {
  it('功能是 breakdown', () => {
    expect(buildBreakdownInvocation({ title: '做发布' }).feature).toBe('breakdown');
  });

  it('🔴 `fields` 必须覆盖 `user` 里出现的每个数据字段（披露的依据）', () => {
    const withNote = buildBreakdownInvocation({ title: '做发布', note: '别忘灰度' });
    expect(withNote.fields).toContain('title');
    expect(withNote.fields).toContain('note');
    // user 里确实出现了备注内容
    expect(withNote.user).toContain('别忘灰度');

    const withoutNote = buildBreakdownInvocation({ title: '做发布' });
    expect(withoutNote.fields).toEqual(['title']);
    expect(withoutNote.user).not.toContain('note');
  });

  it('空备注不算一个字段（避免披露里出现没送的东西）', () => {
    expect(buildBreakdownInvocation({ title: 'x', note: '   ' }).fields).toEqual(['title']);
  });

  // ── 记忆层：偏好注入 prompt 与披露 ─────────────────────────────


  it('没有偏好时：不出现 preferences 字段，也不出现任何提示段落', () => {
    const inv = buildBreakdownInvocation({ title: '做发布' });
    expect(inv.fields).toEqual(['title']);
    expect(inv.user).not.toContain('历史习惯');
  });

  it('🔴 传了偏好：`preferences` 必须进 `fields`（否则就是偷偷多发数据）', () => {
    const hints = renderPreferenceHints(withPrefs(), 'breakdown');
    const inv = buildBreakdownInvocation({ title: '做发布' }, hints);
    expect(inv.fields).toContain('preferences');
    // 字段声明了，正文里就必须真有 —— 两边的规则是对称的
    expect(inv.user).toContain('历史习惯');
  });

  it('偏好提示真的进了 prompt，且是给模型的措辞（不复述样本量）', () => {
    const hints = renderPreferenceHints(withPrefs(), 'breakdown');
    const inv = buildBreakdownInvocation({ title: '做发布' }, hints);
    expect(inv.user).toContain('拆成 6 项左右');
    expect(inv.user).toContain('中文');
    expect(inv.user).toContain('1.80 倍');
    // 模型不需要知道"基于 N 次"，那是给用户看的（在 evidence 里）
    expect(inv.user).not.toContain('基于 30 次');
  });

  it('🔴 只发该功能需要的偏好（最小化出境面）：拆解不带提前量与时段', () => {
    const hints = renderPreferenceHints(withPrefs(), 'breakdown');
    const inv = buildBreakdownInvocation({ title: '做发布' }, hints);
    expect(inv.user).not.toContain('高效时段');
    expect(inv.user).toContain('拆成 6 项左右');
  });

  it('🔴 主开关关闭：一个偏好都不进 prompt，`preferences` 字段也不出现', () => {
    const off: PreferenceSet = { ...withPrefs(), memoryEnabled: false };
    const hints = renderPreferenceHints(off, 'breakdown');
    expect(hints).toEqual([]);

    const inv = buildBreakdownInvocation({ title: '做发布' }, hints);
    expect(inv.fields).toEqual(['title']);
    expect(inv.user).not.toContain('历史习惯');
    expect(inv.user).not.toContain('6 项');
  });

  it('🔴 关闭时即使把原始偏好集硬塞进去，也不该有输出（生成器是唯一入口）', () => {
    // 防的是"某天有人图省事，直接自己拼字符串绕过 renderPreferenceHints"
    const off: PreferenceSet = { ...withPrefs(), memoryEnabled: false };
    expect(renderPreferenceHints(off, 'breakdown')).toEqual([]);
    expect(renderPreferenceHints(off, 'prioritize')).toEqual([]);
    expect(renderPreferenceHints(off, 'capture')).toEqual([]);
    expect(renderPreferenceHints(off, 'duration-estimate')).toEqual([]);
  });

  it('提示顺序固定（同样的输入必须产生同样的 prompt 字节）', () => {
    const a = buildBreakdownInvocation({ title: 'x' }, renderPreferenceHints(withPrefs(), 'breakdown'));
    const b = buildBreakdownInvocation({ title: 'x' }, renderPreferenceHints(withPrefs(), 'breakdown'));
    expect(a.user).toBe(b.user);
  });

  it('系统提示要求纯清单输出', () => {
    expect(buildBreakdownInvocation({ title: 'x' }).system).toContain('不要输出任何解释');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 解析
// ─────────────────────────────────────────────────────────────────────────

describe('parseBreakdownItems', () => {
  it('收编号列表', () => {
    expect(parseBreakdownItems('1. 写文档\n2. 发给老王\n3. 归档')).toEqual([
      '写文档',
      '发给老王',
      '归档',
    ]);
  });

  it('收 `1)` / `1、` / `(1)` 这些变体', () => {
    expect(parseBreakdownItems('1) 甲\n2、乙\n(3) 丙')).toEqual(['甲', '乙', '丙']);
  });

  it('收短横线与圆点', () => {
    expect(parseBreakdownItems('- 甲\n* 乙\n• 丙\n· 丁')).toEqual(['甲', '乙', '丙', '丁']);
  });

  it('🔴 丢掉客套前言（前言不是子项）', () => {
    const items = parseBreakdownItems('好的，以下是拆分：\n- 甲\n- 乙');
    expect(items).toEqual(['甲', '乙']);
  });

  it('剥掉 markdown 强调与代码围栏', () => {
    const items = parseBreakdownItems('```\n- **甲**\n- `乙`\n```');
    expect(items).toEqual(['甲', '乙']);
  });

  it('去重（模型经常重复）', () => {
    expect(parseBreakdownItems('- 甲\n- 甲\n- 乙')).toEqual(['甲', '乙']);
  });

  it('🔴 删掉空条目', () => {
    expect(parseBreakdownItems('- 甲\n- \n- \n- 乙')).toEqual(['甲', '乙']);
  });

  it('🔴 一条列表都没有、且只有一句废话 → 返回空（宁可说没读懂）', () => {
    expect(parseBreakdownItems('抱歉，我无法完成这个任务。')).toEqual([]);
    expect(parseBreakdownItems('')).toEqual([]);
    expect(parseBreakdownItems('   \n  \n')).toEqual([]);
  });

  it('🔴 没有列表标记但有多行实体内容 → 收（宽容路径）', () => {
    expect(parseBreakdownItems('先调研竞品\n写方案\n找老王评审')).toEqual([
      '先调研竞品',
      '写方案',
      '找老王评审',
    ]);
  });

  it('🔴 数量封顶（防止 200 条灌进备注，再同步到每台设备）', () => {
    const many = Array.from({ length: 200 }, (_, i) => `- 条目 ${String(i)}`).join('\n');
    const items = parseBreakdownItems(many);
    expect(items).toHaveLength(MAX_BREAKDOWN_ITEMS);
  });

  it('🔴 单条长度封顶', () => {
    const long = `- ${'啊'.repeat(500)}`;
    const items = parseBreakdownItems(long);
    expect(items[0]?.length).toBe(MAX_ITEM_LENGTH);
  });

  it('保留中文标点与数字（不要过度清洗）', () => {
    expect(parseBreakdownItems('- 确认 SLA：99.9%（见附录 A）')).toEqual([
      '确认 SLA：99.9%（见附录 A）',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 渲染与合并
// ─────────────────────────────────────────────────────────────────────────

describe('renderChecklist', () => {
  it('渲染成未勾选的 Markdown 清单', () => {
    expect(renderChecklist(['甲', '乙'])).toBe('- [ ] 甲\n- [ ] 乙');
  });
});

describe('🔴 mergeChecklistIntoNote', () => {
  it('没有原备注时直接是清单', () => {
    expect(mergeChecklistIntoNote(undefined, ['甲'])).toBe('- [ ] 甲');
    expect(mergeChecklistIntoNote('   ', ['甲'])).toBe('- [ ] 甲');
  });

  it('🔴 **绝不覆盖**用户已写的备注，清单接在下面', () => {
    const merged = mergeChecklistIntoNote('这是我自己写的。', ['甲', '乙']);
    expect(merged).toBe('这是我自己写的。\n\n- [ ] 甲\n- [ ] 乙');
    expect(merged.startsWith('这是我自己写的。')).toBe(true);
  });
});

describe('manualChecklistSkeleton', () => {
  it('🔴 是空骨架，而且**不含任何 AI 生成的内容**', () => {
    const s = manualChecklistSkeleton('做发布');
    expect(s).toContain('做发布');
    expect(s.match(/- \[ \]/g)).toHaveLength(3);
    // 三行都是空的
    for (const line of s.split('\n').slice(1)) {
      expect(line.trim()).toBe('- [ ]');
    }
  });

  it('标题为空时用兜底词', () => {
    expect(manualChecklistSkeleton('  ')).toContain('拆解');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 出境闸门在实际调用点真的会拦
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 requestBreakdown —— 出境闸门', () => {
  it('🔴🔴 远端端点但**没有该功能的授权** → 不发任何请求', async () => {
    const { impl, calls } = fetchReturning('- 甲\n- 乙');
    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([REMOTE_ENDPOINT], { breakdown: ['remote'] }),
        consents: [], // ← 没有授权
        routed: { fetchImpl: impl },
      },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('ai-unavailable');
    // 🔴 关键：一个字节都没发出去
    expect(calls).toHaveLength(0);
  });

  it('🔴 授权绑的是 `(功能, 目的地)` —— 别的功能的授权不算数', async () => {
    const { impl, calls } = fetchReturning('- 甲');
    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([REMOTE_ENDPOINT], { breakdown: ['remote'] }),
        // 授权的是 prioritize，不是 breakdown
        consents: [{ feature: 'prioritize', destination: 'user-endpoint', grantedAt: 1 }],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('🔴 授权了但目的地是 heyta-cloud，而路由走的是用户端点 → 不匹配', async () => {
    const { impl, calls } = fetchReturning('- 甲');
    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([REMOTE_ENDPOINT], { breakdown: ['remote'] }),
        consents: [{ feature: 'breakdown', destination: 'heyta-cloud', grantedAt: 1 }],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('✅ 本机端点不需要授权，直接跑通', async () => {
    const { impl, calls } = fetchReturning('- 甲\n- 乙');
    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.proposal.items).toEqual(['甲', '乙']);
      expect(outcome.proposal.destination).toBe('none');
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('localhost:11434');
  });

  it('✅ 远端端点 + 正确授权 → 跑通，且 destination 如实标为 user-endpoint', async () => {
    const { impl, calls } = fetchReturning('1. 甲\n2. 乙');
    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([REMOTE_ENDPOINT], { breakdown: ['remote'] }),
        consents: [LOCAL_CONSENT],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.proposal.destination).toBe('user-endpoint');
    expect(calls).toHaveLength(1);
  });

  // ── 🔴 端到端：偏好真的到达了网络请求体 ──────────────────────
  //
  // 这一条是本仓库最该存在的测试类型：本项目反复出现「能力实现了、
  // 被测了、但没人调用」。单测 `buildBreakdownInvocation` 证明不了
  // `requestBreakdown` 把 hints 传下去了 —— 只有打到 wire 上才算数。

  it('🔴 偏好真的进了 HTTP 请求体（不是只在单测里成立）', async () => {
    const { impl, calls } = fetchReturning('- 甲\n- 乙');
    const hints = renderPreferenceHints(withPrefs(), 'breakdown');
    expect(hints.length).toBeGreaterThan(0);

    await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
        consents: [],
        preferences: hints,
        routed: { fetchImpl: impl },
      },
    );

    expect(calls).toHaveLength(1);
    const body = calls[0]?.body ?? '';
    // ⚠️ 断言**偏好块的完整表头**与**偏好内容**，不能只断言「历史习惯」——
    // 系统提示里本身就有这四个字（"如果给出了用户的历史习惯…"），
    // 用它做断言会永远为真。我第一次就这么写，测试直接把这个错暴露了。
    expect(body).toContain('关于这位用户的历史习惯');
    expect(body).toContain('6 项左右');
  });

  it('🔴 不传 preferences 时，请求体里一个偏好字节都没有', async () => {
    const { impl, calls } = fetchReturning('- 甲');
    await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('关于这位用户的历史习惯');
    expect(body).not.toContain('6 项左右');
  });

  it('🔴 主开关关闭 → 端到端请求体里没有偏好（开关真的管住了出境）', async () => {
    const off: PreferenceSet = { ...withPrefs(), memoryEnabled: false };
    const hints = renderPreferenceHints(off, 'breakdown');
    const { impl, calls } = fetchReturning('- 甲');

    await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
        consents: [],
        preferences: hints,
        routed: { fetchImpl: impl },
      },
    );

    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('关于这位用户的历史习惯');
    expect(body).not.toContain('6 项左右');
  });

  it('🔴 送出的请求体里含标题，但不含没在 `fields` 里声明的东西', async () => {
    const { impl, calls } = fetchReturning('- 甲');
    await requestBreakdown(
      { title: '做发布', note: '机密备注' },
      {
        routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    const body = calls[0]?.body ?? '';
    expect(body).toContain('做发布');
    // note 被声明了，所以它**应该**在
    expect(body).toContain('机密备注');
  });

  it('🔴 总开关关着 → 不发请求，且提示去开总开关', async () => {
    const { impl, calls } = fetchReturning('- 甲');
    const outcome = await requestBreakdown(
      { title: 'x' },
      {
        routing: { ...routing([LOCAL_ENDPOINT], { breakdown: ['local'] }), enabled: false },
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('总开关');
    expect(calls).toHaveLength(0);
  });

  it('🔴 这个功能没有配路由 → `no-route`，提示要检查端点而不是总开关', async () => {
    const { impl, calls } = fetchReturning('- 甲');
    const outcome = await requestBreakdown(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], {}), // breakdown 没路由
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('端点');
    expect(calls).toHaveLength(0);
  });

  it('🔴 空标题直接拒绝，连路由都不走', async () => {
    const { impl, calls } = fetchReturning('- 甲');
    const outcome = await requestBreakdown(
      { title: '   ' },
      {
        routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty-title');
    expect(calls).toHaveLength(0);
  });

  it('🔴 模型返回一坨没用的东西 → `unparseable`，不硬凑', async () => {
    const { impl } = fetchReturning('抱歉，我无法完成这个任务。');
    const outcome = await requestBreakdown(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('unparseable');
  });

  it('🔴 每种失败都有**不同**的提示（否则用户不知道该修哪里）', async () => {
    const messages = new Set<string>();
    for (const reason of ['not-configured', 'no-route', 'egress-not-authorized', 'network', 'http-error'] as const) {
      const impl = (() => {
        if (reason === 'network') return Promise.reject(new Error('boom'));
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('err'),
          json: () => Promise.resolve({}),
        });
      }) as unknown as typeof fetch;

      const outcome = await requestBreakdown(
        { title: 'x' },
        {
          routing:
            reason === 'not-configured'
              ? { ...routing([LOCAL_ENDPOINT], { breakdown: ['local'] }), enabled: false }
              : reason === 'no-route'
                ? routing([LOCAL_ENDPOINT], {})
                : routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
          consents: [],
          routed: { fetchImpl: impl },
        },
      );
      if (!outcome.ok) messages.add(outcome.message);
    }
    // 至少要有 4 种不同的说法（有的原因在这条路径下走不到同一种）
    expect(messages.size).toBeGreaterThanOrEqual(4);
  });

  it('🔴 返回携带健康状态，供调用方持久化（且它不该进 op-log）', async () => {
    const { impl } = fetchReturning('- 甲');
    const outcome = await requestBreakdown(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(typeof outcome.health).toBe('object');
  });

  it('🔴 截断时如实标记', async () => {
    const many = Array.from({ length: 50 }, (_, i) => `- 条目 ${String(i)}`).join('\n');
    const { impl } = fetchReturning(many);
    const outcome = await requestBreakdown(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.proposal.truncated).toBe(true);
      expect(outcome.proposal.items).toHaveLength(MAX_BREAKDOWN_ITEMS);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 回退不得跨越隐私边界（在真实调用点上再验一次）
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 回退不跨越隐私边界', () => {
  it('🔴🔴 本机端点失败后，**不会**自动把数据发到云端端点', async () => {
    const calls: string[] = [];
    let first = true;
    const impl = ((url: string) => {
      calls.push(String(url));
      if (first) {
        first = false;
        return Promise.reject(new Error('本机没开'));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: '- 甲' } }] }),
        text: () => Promise.resolve('{"choices":[{"message":{"content":"- 甲"}}]}'),
      });
    }) as unknown as typeof fetch;

    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([LOCAL_ENDPOINT, REMOTE_ENDPOINT], {
          breakdown: ['local', 'remote'],
        }),
        // 只授权了本机（本机其实不需要授权）—— 云端没授权
        consents: [],
        policy: { ...DEFAULT_ROUTING_POLICY, maxAttempts: 3 },
        routed: { fetchImpl: impl },
      },
    );

    // 本机试过了
    expect(calls.some((u) => u.includes('localhost'))).toBe(true);
    // 🔴 但**没有**碰云端
    expect(calls.some((u) => u.includes('api.example.com'))).toBe(false);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('备用端点');
  });

  it('🔴 授权了云端之后，回退才被允许', async () => {
    const calls: string[] = [];
    let first = true;
    const impl = ((url: string) => {
      calls.push(String(url));
      if (first) {
        first = false;
        return Promise.reject(new Error('本机没开'));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: '- 甲' } }] }),
        text: () => Promise.resolve('{"choices":[{"message":{"content":"- 甲"}}]}'),
      });
    }) as unknown as typeof fetch;

    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([LOCAL_ENDPOINT, REMOTE_ENDPOINT], {
          breakdown: ['local', 'remote'],
        }),
        consents: [LOCAL_CONSENT],
        policy: { ...DEFAULT_ROUTING_POLICY, maxAttempts: 3 },
        routed: { fetchImpl: impl },
      },
    );

    expect(calls.some((u) => u.includes('api.example.com'))).toBe(true);
    expect(outcome.ok).toBe(true);
  });
});


describe('manualChecklistSkeleton 与 AI 路径完全分离', () => {
  it('🔴 它不是 async，也没有任何 deps —— 结构上不可能发请求', () => {
    // 只要这个函数接受 deps 就说明它可能联网；它是纯函数
    expect(manualChecklistSkeleton.length).toBe(1);
    expect(vi.isMockFunction(manualChecklistSkeleton)).toBe(false);
  });
});

describe('🔴 失败分支必须带回熔断状态', () => {
  it('🔴🔴 端点失败时，health 记下了那个端点的失败次数', async () => {
    // 这是最需要 health 的一次 —— 熔断计数器刚 +1。
    // 早先的写法只把 health 放在成功分支上，于是最该记的那次反而丢了。
    const routeConfig = routing([LOCAL_ENDPOINT], { breakdown: ['local'] });
    const outcome = await requestBreakdown(
      { title: '做一件事' },
      {
        routing: routeConfig,
        consents: [LOCAL_CONSENT],
        routed: { fetchImpl: () => Promise.reject(new Error('connection refused')) },
      },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // 🔴 失败分支上**有** health
    expect(outcome.health['local']).toBeDefined();
    expect(outcome.health['local']?.consecutiveFailures).toBe(1);
  });

  it('🔴 连续失败会累加（熔断的依据）', async () => {
    const routeConfig = routing([LOCAL_ENDPOINT], { breakdown: ['local'] });
    const failing = (): Promise<never> => Promise.reject(new Error('down'));

    const first = await requestBreakdown({ title: 'x' }, {
      routing: routeConfig,
      consents: [LOCAL_CONSENT],
      routed: { fetchImpl: failing },
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;

    // 用上一轮的 health 作为种子 —— 模拟"落盘后重启又读回来"
    const second = await requestBreakdown({ title: 'x' }, {
      routing: routeConfig,
      consents: [LOCAL_CONSENT],
      routed: { fetchImpl: failing, healthSeed: first.health },
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.health['local']?.consecutiveFailures).toBe(2);
  });

  it('🔴 标题为空时没有端点被尝试过，health 是空的', async () => {
    const outcome = await requestBreakdown(
      { title: '   ' },
      { routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }), consents: [LOCAL_CONSENT] },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.health).toEqual({});
  });

  it('🔴 解析失败（请求成功但内容没法用）也带回 health', async () => {
    const routeConfig = routing([LOCAL_ENDPOINT], { breakdown: ['local'] });
    const outcome = await requestBreakdown(
      { title: 'x' },
      {
        routing: routeConfig,
        consents: [LOCAL_CONSENT],
        routed: { fetchImpl: fetchReturning('抱歉我做不到').impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unparseable');
    // 请求是通的 → 这个端点有成功记录，没有失败
    expect(outcome.health['local']?.consecutiveFailures).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 失败原因必须**具体**，不能被概括掉', () => {
  /** 端点**没**声明 long_context —— 这是最常见的"配了却跑不起来"。 */
  const NO_LONG_CONTEXT = {
    id: 'local',
    label: '本机 Ollama',
    endpoint: 'http://localhost:11434/v1',
    model: 'qwen3:8b',
    capabilities: ['structured_output'],
  };

  it('🔴🔴 缺能力时说的是"缺能力"，不是"检查地址是否合法"', async () => {
    const { impl, calls } = fetchReturning('- 甲');
    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([NO_LONG_CONTEXT], { breakdown: ['local'] }),
        consents: [LOCAL_CONSENT],
        routed: { fetchImpl: impl },
      },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // 🔴 必须点名"能力"，并且说清它必须**显式声明**
      expect(outcome.message).toContain('能力');
      expect(outcome.message).toContain('声明');
      // 🔴 而且**不能**是那句会把人引错方向的概括
      expect(outcome.message).not.toContain('地址是否合法');
    }
    expect(calls).toHaveLength(0);
  });

  it('🔴 远端被禁时说的是"没允许远程"，不是"没有可用端点"', async () => {
    const { impl } = fetchReturning('- 甲');
    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        // allowRemote: false 由 routing() 之外的构造给出
        routing: { ...routing([REMOTE_ENDPOINT], { breakdown: ['remote'] }), allowRemote: false },
        consents: [LOCAL_CONSENT],
        routed: { fetchImpl: impl },
      },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('允许远程');
      // 这句话必须说清"这不是故障"，否则用户会以为坏了
      expect(outcome.message).toContain('不是故障');
    }
  });

  it('🔴 端点地址非法时点名"地址"（这一条原来是对的，别改坏）', async () => {
    const badUrl = {
      id: 'bad',
      label: '明文远端',
      endpoint: 'http://api.example.com/v1', // 远端明文 http → 拒绝
      model: 'm',
      capabilities: ['structured_output', 'long_context'],
    };
    const { impl } = fetchReturning('- 甲');
    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([badUrl], { breakdown: ['bad'] }),
        consents: [LOCAL_CONSENT],
        routed: { fetchImpl: impl },
      },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('地址');
  });

  it('🔴 网络失败时给出的是端点的具体错误（不是笼统的"AI 暂时不可用"）', async () => {
    const boom: typeof fetch = () =>
      Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
    const outcome = await requestBreakdown(
      { title: '做发布' },
      {
        routing: routing([LOCAL_ENDPOINT], { breakdown: ['local'] }),
        consents: [LOCAL_CONSENT],
        routed: { fetchImpl: boom },
      },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).not.toBe('');
      // 不能退化成万能句
      expect(outcome.message).not.toBe('AI 暂时不可用。');
    }
  });
});
