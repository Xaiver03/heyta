/**
 * AI 耗时估计测试
 * =================
 *
 * 🔴 这个文件里最重要的三条：
 *
 *   1. **`fields` 与实际请求体逐字段一致** —— 出境披露的依据不能只在单测里成立，
 *      要一路断言到 wire 上。
 *   2. **未授权时一个字节都不发** —— 出境闸门在真实调用点上真的会拦。
 *   3. **解析的边界**：`约两小时` 判失败、`1e9` 夹住、负数拒绝 ——
 *      一个错误的分钟数看起来和正确的一模一样，只能靠测试钉住。
 *
 * ⚠️ 还有一条容易被忽略的：**历史条数必须封顶**。
 * 出境面随时间无限增长是隐私问题，而不是性能问题。
 */

import { describe, expect, it } from 'vitest';

import { renderPreferenceHints, type PreferenceSet } from '@heyta/domain';

import {
  DEFAULT_ROUTING_POLICY,
  type AiRoutingConfig,
  type EgressConsent,
} from '@heyta/ai';

import {
  MAX_DURATION_MINUTES,
  MAX_HISTORY_ROWS,
  MIN_DURATION_MINUTES,
  buildDurationInvocation,
  clampDurationMinutes,
  countUsableDurationHistory,
  parseDurationMinutes,
  parseDurationResult,
  requestDuration,
  selectDurationHistory,
  type DurationHistoryRow,
} from '../src/ai-duration.js';

// ─────────────────────────────────────────────────────────────────────────
// 构造假端点
// ─────────────────────────────────────────────────────────────────────────

/** `duration-estimate` 只需要 `structured_output`（见 `packages/ai/src/routing.ts`）。 */
const LOCAL_ENDPOINT = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output'],
};

const REMOTE_ENDPOINT = {
  id: 'remote',
  label: '云端',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  capabilities: ['structured_output'],
};

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

/** 返回一段模型风格的文本，并记下请求体。 */
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

const CONSENT: EgressConsent = {
  feature: 'duration-estimate',
  destination: 'user-endpoint',
  grantedAt: 1,
};

/** 有全部偏好的记忆开关打开状态（形状同 ai-breakdown.spec.ts）。 */
const withPrefs = (): PreferenceSet => ({
  memoryEnabled: true,
  estimateBias: {
    id: 'estimate-bias',
    value: 1.8,
    sampleSize: 30,
    confidence: 0.9,
    evidence: '基于 30 次专注，你倾向低估任务耗时 —— 实际用时约为计划的 1.80 倍',
  },
  deepWorkWindow: {
    id: 'deep-work-window',
    value: { startHour: 8, endHour: 11, concentration: 0.8 },
    sampleSize: 40,
    confidence: 0.9,
    evidence: '基于 40 次专注，80% 集中在 08:00–11:00',
  },
  leadTime: null,
  granularity: null,
  titleStyle: null,
  withheld: [],
});

/** 一条可用的历史记录：计划 `p` 分钟，实际 `a` 分钟。 */
function row(plannedMinutes: number, actualMinutes: number): DurationHistoryRow {
  return { plannedMs: plannedMinutes * 60_000, actualMs: actualMinutes * 60_000 };
}

// ─────────────────────────────────────────────────────────────────────────
// 构造调用
// ─────────────────────────────────────────────────────────────────────────

describe('buildDurationInvocation', () => {
  it('功能是 duration-estimate', () => {
    expect(buildDurationInvocation({ title: '写周报' }).feature).toBe('duration-estimate');
  });

  it('🔴 只给标题时，`fields` 恰好是 [title]（不声明没送的东西）', () => {
    const inv = buildDurationInvocation({ title: '写周报' });
    expect(inv.fields).toEqual(['title']);
    expect(inv.user).toContain('写周报');
  });

  it('🔴 `fields` 必须覆盖 `user` 里出现的每个数据字段（披露的依据）', () => {
    const inv = buildDurationInvocation(
      { title: '写周报', note: '别忘附数据', history: [row(30, 54)] },
      renderPreferenceHints(withPrefs(), 'duration-estimate'),
    );
    expect(inv.fields).toEqual(['title', 'note', 'history', 'preferences']);
    // 声明了就必须真有 —— 两边的规则是对称的
    expect(inv.user).toContain('别忘附数据');
    expect(inv.user).toContain('这个任务的历史专注记录');
    expect(inv.user).toContain('关于这位用户的历史习惯');
  });

  it('空备注不算一个字段（避免披露里出现没送的东西）', () => {
    expect(buildDurationInvocation({ title: 'x', note: '   ' }).fields).toEqual(['title']);
  });

  it('🔴 没有历史时不出现 history 字段，也不出现历史段落', () => {
    const inv = buildDurationInvocation({ title: 'x' });
    expect(inv.fields).not.toContain('history');
    expect(inv.user).not.toContain('这个任务的历史专注记录');
  });

  it('🔴 历史全是脏数据（0 / 负数 / NaN）时，history 字段也不该出现', () => {
    const inv = buildDurationInvocation({
      title: 'x',
      history: [
        { plannedMs: 0, actualMs: 60_000 },
        { plannedMs: -1, actualMs: 60_000 },
        { plannedMs: 60_000, actualMs: Number.NaN },
      ],
    });
    expect(inv.fields).toEqual(['title']);
    expect(inv.user).not.toContain('这个任务的历史专注记录');
  });

  it('🔴 历史单位在正文里写死是分钟（模型不会记住系统提示里的单位）', () => {
    const inv = buildDurationInvocation({ title: 'x', history: [row(30, 54)] });
    expect(inv.user).toContain('单位一律是分钟');
    expect(inv.user).toContain('当时估 30 分钟，实际花了 54 分钟');
  });

  it('🔴 系统提示显式说明单位与整数要求', () => {
    const system = buildDurationInvocation({ title: 'x' }).system;
    expect(system).toContain('分钟');
    expect(system).toContain('整数');
    // 范围也要写进提示词，否则模型没有理由不返回 1e9
    expect(system).toContain(String(MIN_DURATION_MINUTES));
    expect(system).toContain(String(MAX_DURATION_MINUTES));
  });

  it('🔴 传了偏好：`preferences` 必须进 `fields`（否则就是偷偷多发数据）', () => {
    const hints = renderPreferenceHints(withPrefs(), 'duration-estimate');
    const inv = buildDurationInvocation({ title: 'x' }, hints);
    expect(inv.fields).toContain('preferences');
    expect(inv.user).toContain('关于这位用户的历史习惯');
  });

  it('🔴 只发该功能需要的偏好（最小化出境面）：估时不带粒度/风格/提前量', () => {
    const inv = buildDurationInvocation(
      { title: 'x' },
      renderPreferenceHints(withPrefs(), 'duration-estimate'),
    );
    expect(inv.user).toContain('1.80 倍');
    expect(inv.user).toContain('高效时段');
    expect(inv.user).not.toContain('拆成');
    expect(inv.user).not.toContain('提前');
  });

  it('🔴 主开关关闭：一个偏好都不进 prompt，`preferences` 字段也不出现', () => {
    const off: PreferenceSet = { ...withPrefs(), memoryEnabled: false };
    const hints = renderPreferenceHints(off, 'duration-estimate');
    expect(hints).toEqual([]);
    const inv = buildDurationInvocation({ title: 'x' }, hints);
    expect(inv.fields).toEqual(['title']);
    expect(inv.user).not.toContain('关于这位用户的历史习惯');
  });

  it('同样的输入必须产生同样的 prompt 字节', () => {
    const a = buildDurationInvocation({ title: 'x' }, renderPreferenceHints(withPrefs(), 'duration-estimate'));
    const b = buildDurationInvocation({ title: 'x' }, renderPreferenceHints(withPrefs(), 'duration-estimate'));
    expect(a.user).toBe(b.user);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 历史封顶（出境面不随时间增长）
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 selectDurationHistory —— 历史必须封顶', () => {
  it('undefined → 空数组', () => {
    expect(selectDurationHistory(undefined)).toEqual([]);
    expect(countUsableDurationHistory(undefined)).toBe(0);
  });

  it('🔴 超过上限时只留**最近** MAX_HISTORY_ROWS 条', () => {
    const many = Array.from({ length: 50 }, (_, i) => row(1000 + i, 1800 + i));
    const kept = selectDurationHistory(many);
    expect(kept).toHaveLength(MAX_HISTORY_ROWS);
    // 保留的是尾部：最后一条在，最前面那些不在
    expect(kept[kept.length - 1]).toEqual(row(1049, 1849));
    expect(kept[0]).toEqual(row(1030, 1830));
  });

  it('🔴 先过滤再截断 —— 尾部的脏数据不该挤掉可用的额度', () => {
    const usable = Array.from({ length: MAX_HISTORY_ROWS }, (_, i) => row(100 + i, 200 + i));
    const withGarbage = [...usable, { plannedMs: 0, actualMs: 0 }, { plannedMs: Number.NaN, actualMs: 1 }];
    expect(selectDurationHistory(withGarbage)).toHaveLength(MAX_HISTORY_ROWS);
    expect(countUsableDurationHistory(withGarbage)).toBe(MAX_HISTORY_ROWS);
  });

  it('脏数据被丢掉（比值不成立就没意义）', () => {
    const kept = selectDurationHistory([
      row(30, 54),
      { plannedMs: 0, actualMs: 60_000 },
      { plannedMs: 60_000, actualMs: 0 },
      { plannedMs: -5, actualMs: 60_000 },
      { plannedMs: Number.POSITIVE_INFINITY, actualMs: 60_000 },
      row(10, 12),
    ]);
    expect(kept).toEqual([row(30, 54), row(10, 12)]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 解析：一个错误的分钟数看起来和正确的一模一样
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 parseDurationMinutes / parseDurationResult', () => {
  it('收裸整数', () => {
    expect(parseDurationResult('90')).toBe(90);
    expect(parseDurationResult('  90\n')).toBe(90);
  });

  it('收带分钟单位的写法', () => {
    expect(parseDurationResult('90 分钟')).toBe(90);
    expect(parseDurationResult('90分钟')).toBe(90);
    expect(parseDurationResult('约 90min')).toBe(90);
    expect(parseDurationResult('90 minutes')).toBe(90);
  });

  it('剥掉代码围栏', () => {
    expect(parseDurationResult('```\n90\n```')).toBe(90);
  });

  it('🔴🔴 「约两小时」这类非数字返回 → 判失败，**不猜**', () => {
    expect(parseDurationResult('约两小时')).toBeUndefined();
    expect(parseDurationResult('两个小时')).toBeUndefined();
    expect(parseDurationResult('一整天')).toBeUndefined();
    expect(parseDurationResult('')).toBeUndefined();
    expect(parseDurationResult('   ')).toBeUndefined();
    expect(parseDurationResult('抱歉，我无法估计。')).toBeUndefined();
    expect(parseDurationResult('NaN')).toBeUndefined();
    expect(parseDurationResult('不知道')).toBeUndefined();
  });

  it('🔴🔴 单位错成小时时**不许把小时的数当分钟用**', () => {
    // 这是最危险的一种：它有数字，任何"取第一个数字"的实现都会读成 1.5 分钟
    expect(parseDurationResult('1.5 小时')).toBeUndefined();
    expect(parseDurationResult('2 hours')).toBeUndefined();
  });

  it('🔴 同时出现小时与分钟时，优先用**贴着分钟单位**的那个数', () => {
    expect(parseDurationResult('120 分钟（约两小时）')).toBe(120);
    expect(parseDurationResult('1.5小时（90分钟）')).toBe(90);
  });

  it('🔴 负数被**拒绝**，不是夹到下限', () => {
    expect(parseDurationMinutes('-30')).toBeUndefined();
    expect(parseDurationResult('-30')).toBeUndefined();
    expect(parseDurationResult('-30 分钟')).toBeUndefined();
  });

  it('🔴 超上限被夹到 MAX（1e9 这种写法真的会出现）', () => {
    expect(parseDurationResult('1e9')).toBe(MAX_DURATION_MINUTES);
    expect(parseDurationResult('99999')).toBe(MAX_DURATION_MINUTES);
    expect(parseDurationResult('99999 分钟')).toBe(MAX_DURATION_MINUTES);
  });

  it('🔴 低于下限被夹到 MIN（0 是"太短"，不是"不是数字"）', () => {
    expect(parseDurationResult('0')).toBe(MIN_DURATION_MINUTES);
    expect(parseDurationResult('3')).toBe(MIN_DURATION_MINUTES);
  });

  it('🔴 返回值一定是 [MIN, MAX] 内的整数', () => {
    for (const text of ['90', '90.5', '0.4', '1e9', '7 分钟', '59.6分钟']) {
      const v = parseDurationResult(text);
      expect(v).toBeDefined();
      expect(Number.isInteger(v as number)).toBe(true);
      expect(v as number).toBeGreaterThanOrEqual(MIN_DURATION_MINUTES);
      expect(v as number).toBeLessThanOrEqual(MAX_DURATION_MINUTES);
    }
    // 小数四舍五入成整数分钟
    expect(parseDurationResult('90.5')).toBe(91);
  });

  it('未夹取的那一层保留原始值（供调用方判断"夹过没有"）', () => {
    expect(parseDurationMinutes('1e9')).toBe(1_000_000_000);
    expect(parseDurationMinutes('90')).toBe(90);
  });

  it('clampDurationMinutes 是唯一的夹取处，非有限数退回下限', () => {
    expect(clampDurationMinutes(0)).toBe(MIN_DURATION_MINUTES);
    expect(clampDurationMinutes(1e9)).toBe(MAX_DURATION_MINUTES);
    expect(clampDurationMinutes(Number.NaN)).toBe(MIN_DURATION_MINUTES);
    expect(clampDurationMinutes(Number.POSITIVE_INFINITY)).toBe(MIN_DURATION_MINUTES);
    expect(clampDurationMinutes(90)).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 出境闸门在实际调用点真的会拦
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 requestDuration —— 出境闸门', () => {
  it('🔴🔴 远端端点但**没有该功能的授权** → 不发任何请求', async () => {
    const { impl, calls } = fetchReturning('90');
    const outcome = await requestDuration(
      { title: '写周报' },
      {
        routing: routing([REMOTE_ENDPOINT], { 'duration-estimate': ['remote'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('ai-unavailable');
    expect(calls).toHaveLength(0);
  });

  it('🔴 授权绑的是 `(功能, 目的地)` —— 别的功能的授权不算数', async () => {
    const { impl, calls } = fetchReturning('90');
    const outcome = await requestDuration(
      { title: '写周报' },
      {
        routing: routing([REMOTE_ENDPOINT], { 'duration-estimate': ['remote'] }),
        // 授权的是 breakdown，不是 duration-estimate
        consents: [{ feature: 'breakdown', destination: 'user-endpoint', grantedAt: 1 }],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('✅ 本机端点不需要授权，直接跑通，且带回「标题 → 工期」', async () => {
    const { impl, calls } = fetchReturning('90');
    const outcome = await requestDuration(
      { title: '写周报' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      // 🔴 交付形状：标题 + 工期，时间线视图直接消费
      expect(outcome.proposal.title).toBe('写周报');
      expect(outcome.proposal.minutes).toBe(90);
      expect(outcome.proposal.destination).toBe('none');
      expect(outcome.proposal.clamped).toBe(false);
      expect(outcome.proposal.historyRows).toBe(0);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('localhost:11434');
  });

  it('✅ 远端端点 + 正确授权 → 跑通，destination 如实标为 user-endpoint', async () => {
    const { impl } = fetchReturning('45 分钟');
    const outcome = await requestDuration(
      { title: '写周报' },
      {
        routing: routing([REMOTE_ENDPOINT], { 'duration-estimate': ['remote'] }),
        consents: [CONSENT],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.proposal.destination).toBe('user-endpoint');
  });

  it('🔴 模型回「约两小时」→ `unparseable`，不硬凑', async () => {
    const { impl } = fetchReturning('约两小时');
    const outcome = await requestDuration(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('unparseable');
      expect(outcome.message).toContain('分钟数');
    }
  });

  it('🔴 模型回 1e9 → 夹住，并且**如实标记** clamped', async () => {
    const { impl } = fetchReturning('1e9');
    const outcome = await requestDuration(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.proposal.minutes).toBe(MAX_DURATION_MINUTES);
      expect(outcome.proposal.clamped).toBe(true);
    }
  });

  it('🔴 模型回负数 → 判失败（不夹成 MIN）', async () => {
    const { impl } = fetchReturning('-30');
    const outcome = await requestDuration(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('unparseable');
  });

  it('🔴 空标题直接拒绝，连路由都不走', async () => {
    const { impl, calls } = fetchReturning('90');
    const outcome = await requestDuration(
      { title: '   ' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('empty-title');
      // 没有任何端点被尝试过 → 空 health
      expect(outcome.health).toEqual({});
    }
    expect(calls).toHaveLength(0);
  });

  it('🔴 总开关关着 → 不发请求，且提示去开总开关', async () => {
    const { impl, calls } = fetchReturning('90');
    const outcome = await requestDuration(
      { title: 'x' },
      {
        routing: { ...routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }), enabled: false },
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('总开关');
    expect(calls).toHaveLength(0);
  });

  it('🔴 这个功能没有配路由 → `no-route`，提示检查端点而不是总开关', async () => {
    const { impl, calls } = fetchReturning('90');
    const outcome = await requestDuration(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], {}),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('端点');
    expect(calls).toHaveLength(0);
  });

  it('🔴 缺能力时说的是"缺能力"，不是"检查地址是否合法"（沿用 ai 包的具体原因）', async () => {
    const noStructuredOutput = {
      id: 'local',
      label: '本机',
      endpoint: 'http://localhost:11434/v1',
      model: 'm',
      capabilities: [],
    };
    const { impl, calls } = fetchReturning('90');
    const outcome = await requestDuration(
      { title: 'x' },
      {
        routing: routing([noStructuredOutput], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('能力');
      expect(outcome.message).not.toContain('地址是否合法');
    }
    expect(calls).toHaveLength(0);
  });

  it('🔴 网络失败时给出端点的具体错误（不是笼统的"AI 暂时不可用"）', async () => {
    const boom: typeof fetch = () =>
      Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
    const outcome = await requestDuration(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: boom },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).not.toBe('');
      expect(outcome.message).not.toBe('AI 暂时不可用。');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 出境面：fields 与请求体逐字段一致
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 出境面：`fields` 必须与实际发送逐字段一致', () => {
  it('🔴🔴 每个声明出去的字段，正文里都必须真有', async () => {
    const { impl, calls } = fetchReturning('90');
    const source = { title: '写周报', note: '别忘附数据', history: [row(30, 54)] };
    const hints = renderPreferenceHints(withPrefs(), 'duration-estimate');
    const inv = buildDurationInvocation(source, hints);

    await requestDuration(source, {
      routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
      consents: [],
      preferences: hints,
      routed: { fetchImpl: impl },
    });

    const body = calls[0]?.body ?? '';
    // 逐字段核对：字段名 → 正文里的标记
    const markers: Record<string, string> = {
      title: '写周报',
      note: '别忘附数据',
      history: '这个任务的历史专注记录',
      preferences: '关于这位用户的历史习惯',
    };
    for (const field of inv.fields) {
      const marker = markers[field];
      expect(marker, `字段 ${field} 没有对应的断言标记`).toBeDefined();
      expect(body).toContain(marker as string);
    }
    expect(inv.fields).toEqual(Object.keys(markers));
  });

  it('🔴🔴 没声明的字段，正文里一个字节都不该有', async () => {
    const { impl, calls } = fetchReturning('90');
    await requestDuration(
      { title: '写周报' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    const body = calls[0]?.body ?? '';
    expect(body).toContain('写周报');
    expect(body).not.toContain('已有备注：');
    expect(body).not.toContain('这个任务的历史专注记录');
    expect(body).not.toContain('关于这位用户的历史习惯');
  });

  it('🔴 偏好真的进了 HTTP 请求体（不是只在单测里成立）', async () => {
    const hints = renderPreferenceHints(withPrefs(), 'duration-estimate');
    expect(hints.length).toBeGreaterThan(0);
    const { impl, calls } = fetchReturning('90');

    await requestDuration(
      { title: '写周报' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        preferences: hints,
        routed: { fetchImpl: impl },
      },
    );

    const body = calls[0]?.body ?? '';
    // ⚠️ 断言偏好块的**完整表头**，不能只断言「历史习惯」——
    // 系统提示里可能也有类似的字眼，那样断言会永远为真。
    expect(body).toContain('关于这位用户的历史习惯');
    expect(body).toContain('1.80 倍');
  });

  it('🔴🔴 历史封顶在**请求体**上真的生效（出境面不随时间增长）', async () => {
    const many = Array.from({ length: 50 }, (_, i) => row(1000 + i, 1800 + i));
    const { impl, calls } = fetchReturning('90');

    const outcome = await requestDuration(
      { title: '写周报', history: many },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );

    const body = calls[0]?.body ?? '';
    // 最近一条在
    expect(body).toContain('1049');
    // 最早的几条不在（它们被截掉了）
    expect(body).not.toContain('1000');
    expect(body).not.toContain('1029');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.proposal.historyRows).toBe(MAX_HISTORY_ROWS);
  });

  it('🔴 主开关关闭 → 端到端请求体里没有偏好', async () => {
    const off: PreferenceSet = { ...withPrefs(), memoryEnabled: false };
    const hints = renderPreferenceHints(off, 'duration-estimate');
    const { impl, calls } = fetchReturning('90');

    await requestDuration(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        preferences: hints,
        routed: { fetchImpl: impl },
      },
    );

    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('关于这位用户的历史习惯');
    expect(body).not.toContain('1.80 倍');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 熔断状态
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 失败分支必须带回熔断状态', () => {
  it('🔴🔴 端点失败时，health 记下了那个端点的失败次数', async () => {
    const outcome = await requestDuration(
      { title: '写周报' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: () => Promise.reject(new Error('connection refused')) },
      },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.health['local']).toBeDefined();
    expect(outcome.health['local']?.consecutiveFailures).toBe(1);
  });

  it('🔴 解析失败（请求成功但内容没法用）也带回 health', async () => {
    const outcome = await requestDuration(
      { title: 'x' },
      {
        routing: routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] }),
        consents: [],
        routed: { fetchImpl: fetchReturning('约两小时').impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unparseable');
    // 请求是通的 → 这个端点有成功记录，没有失败
    expect(outcome.health['local']?.consecutiveFailures).toBe(0);
  });

  it('🔴 连续失败会累加（熔断的依据）', async () => {
    const routeConfig = routing([LOCAL_ENDPOINT], { 'duration-estimate': ['local'] });
    const failing = (): Promise<never> => Promise.reject(new Error('down'));

    const first = await requestDuration(
      { title: 'x' },
      { routing: routeConfig, consents: [], routed: { fetchImpl: failing } },
    );
    expect(first.ok).toBe(false);
    if (first.ok) return;

    const second = await requestDuration(
      { title: 'x' },
      { routing: routeConfig, consents: [], routed: { fetchImpl: failing, healthSeed: first.health } },
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.health['local']?.consecutiveFailures).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 回退不得跨越隐私边界
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
        json: () => Promise.resolve({ choices: [{ message: { content: '90' } }] }),
        text: () => Promise.resolve('{"choices":[{"message":{"content":"90"}}]}'),
      });
    }) as unknown as typeof fetch;

    const outcome = await requestDuration(
      { title: '写周报' },
      {
        routing: routing([LOCAL_ENDPOINT, REMOTE_ENDPOINT], {
          'duration-estimate': ['local', 'remote'],
        }),
        consents: [],
        policy: { ...DEFAULT_ROUTING_POLICY, maxAttempts: 3 },
        routed: { fetchImpl: impl },
      },
    );

    expect(calls.some((u) => u.includes('localhost'))).toBe(true);
    expect(calls.some((u) => u.includes('api.example.com'))).toBe(false);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('备用端点');
  });
});
