/**
 * AI 优先级排序测试
 * =====================
 *
 * 🔴 这个文件里最重要的三类断言：
 *
 *   1. **出境闸门在真实调用点上会拦下请求，且一个字节都没发出去。**
 *   2. **模型编造的 id 与非法优先级都被丢弃** —— 写库是按 id 定位的，
 *      一个幻觉 id 可能改到另一条任务上。
 *   3. **`fields` 与实际发送内容逐字段一致**，且 `note` 结构上出不去。
 */

import { describe, expect, it } from 'vitest';

import { Priority, renderPreferenceHints, type PreferenceSet } from '@heyta/domain';

import {
  DEFAULT_ROUTING_POLICY,
  type AiRoutingConfig,
  type EgressConsent,
} from '@heyta/ai';

import {
  MAX_PRIORITIZE_TASKS,
  MAX_REASON_LENGTH,
  buildPrioritizeInvocation,
  parsePrioritizeResult,
  requestPrioritize,
  type PrioritizeTaskInput,
} from '../src/ai-prioritize.js';

// ─────────────────────────────────────────────────────────────────────────
// 构造假端点
// ─────────────────────────────────────────────────────────────────────────

const LOCAL_ENDPOINT = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  // 🔴 必须显式声明：ADR-0010 §3.4 规定"能力不做任何推断"。
  // `prioritize` 需要 `structured_output`（见 DEFAULT_FEATURE_CAPABILITIES）。
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
  feature: 'prioritize',
  destination: 'user-endpoint',
  grantedAt: 1,
};

/** 两个任务。**刻意带一个 note 用来验证它出不去**（见后面的测试）。 */
const TASKS: readonly PrioritizeTaskInput[] = [
  { id: 't1', title: '做发布', dueDate: 1_700_000_000_000, priority: Priority.Medium },
  { id: 't2', title: '写周报' },
];

/** 模型返回的一条合法建议 JSON。 */
function suggestionsJson(rows: readonly { id: string; priority: string; reason?: string }[]): string {
  return JSON.stringify(rows.map((r) => ({ reason: '按截止时间排。', ...r })));
}

/** 造一个"有排序相关偏好"的开关打开状态。 */
const withPrefs = (): PreferenceSet => ({
  memoryEnabled: true,
  estimateBias: null,
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
  leadTime: {
    id: 'lead-time',
    value: 2,
    sampleSize: 20,
    confidence: 0.9,
    evidenceFacts: { kind: 'lead-time', days: 2, samples: 20 },
    evidence: '基于 20 条带截止日期的任务，你习惯提前 2 天完成',
  },
  granularity: {
    id: 'granularity',
    value: 6,
    sampleSize: 12,
    confidence: 0.9,
    evidenceFacts: { kind: 'granularity', items: 6, samples: 12 },
    evidence: '你的 12 条带清单任务，中位数是 6 项',
  },
  titleStyle: null,
  withheld: [],
});

// ─────────────────────────────────────────────────────────────────────────
// 构造调用
// ─────────────────────────────────────────────────────────────────────────

/**
 * 🔴 `fields` 与 `user` 的**对照表**（与 `ai-capture.spec.ts` 同一形状）。
 * 出境披露读 `fields`，真正出去的内容在 `user` 里 —— 双向核对，漂移就红。
 */
const FIELD_MARKER: Readonly<Record<string, string>> = {
  today: '今天是：',
  tasks: '待排序任务（JSON）：',
  preferences: '关于这位用户的历史习惯',
};

function expectFieldsMatchUser(inv: { user: string; fields: readonly string[] }): void {
  for (const field of inv.fields) {
    const marker = FIELD_MARKER[field];
    expect(marker, `字段 ${field} 没有登记对照标记`).toBeDefined();
    expect(inv.user, `字段 ${field} 声明了却没进 user`).toContain(marker as string);
  }
  for (const [field, marker] of Object.entries(FIELD_MARKER)) {
    if (inv.user.includes(marker)) {
      expect(inv.fields, `user 里有 ${field} 的内容，fields 却没声明`).toContain(field);
    }
  }
}

/** 固定时钟：本地中午 ⇒ 任何时区下本地日历日都是 2026-09-25（周五）。 */
const NOW = Date.parse('2026-09-25T12:00:00');
const CROSS_MIDNIGHT = Date.parse('2026-09-26T12:00:00');

describe('buildPrioritizeInvocation —— 🔴 W4 时间锚点', () => {
  it('锚点真的进了 prompt：注入的 `now` 决定「今天是」那一行', () => {
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS, now: NOW });
    expect(inv.user).toContain('今天是：2026-09-25（周五，');
  });

  it('🔴 换 `now` 就换日期（锚点不许冻在第一次调用）', () => {
    const before = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS, now: NOW });
    const after = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS, now: CROSS_MIDNIGHT });
    expect(before.user).toContain('今天是：2026-09-25');
    expect(after.user).toContain('今天是：2026-09-26');
    expect(before.user).not.toBe(after.user);
  });

  it('🔴 系统提示带日期硬规则（只给日期不给规则 = 模型仍自己算）', () => {
    const { system } = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS, now: NOW });
    expect(system).toContain('关于日期的硬规则：');
    expect(system).toContain('不许凭印象写一个日期');
  });

  it('🔴 `today` 是**真实出境字段**：在披露清单里，且不在清单外', () => {
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS, now: NOW });
    expect(inv.fields).toContain('today');
    expect(inv.fields).toEqual(['today', 'tasks']);
    expectFieldsMatchUser(inv);
  });

  it('🔴 带偏好时双向核对仍然成立（不多报也不少报）', () => {
    const hints = renderPreferenceHints(withPrefs(), 'prioritize');
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS, now: NOW }, hints);
    expect(inv.fields).toEqual(['today', 'tasks', 'preferences']);
    expectFieldsMatchUser(inv);
  });

  it('🔴🔴 授权后：锚点那行**真的在 HTTP 请求体里**（正向对照，挡"探针根本没带锚点"）', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS, now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toContain('今天是：2026-09-25');
  });

  it('🔴🔴 未授权该功能时**一个请求都不发**，连时间锚点那行都没出境', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS, now: NOW },
      {
        routing: routing([REMOTE_ENDPOINT], { prioritize: ['remote'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('buildPrioritizeInvocation', () => {
  it('功能是 prioritize', () => {
    expect(buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS }).feature).toBe('prioritize');
  });

  it('🔴 `fields` 覆盖 `user` 里出现的每个数据字段（披露的依据）', () => {
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS });
    expect(inv.fields).toEqual(['today', 'tasks']);
    // 字段声明了，正文里就必须真有
    expect(inv.user).toContain('做发布');
    expect(inv.user).toContain('t1');
  });

  it('🔴🔴 `note` 结构上出不去（即使硬塞进输入对象）', () => {
    // 防的是"某天有人图省事，把整个 Task 丢进来"。
    // `PrioritizeTaskInput` 里没有 note，但 JS 运行时多一个属性不会被拦 ——
    // 所以这里显式验证构造器只挑它认识的字段。
    const withNote = [
      { id: 't1', title: '做发布', note: '机密：客户名单' },
    ] as unknown as PrioritizeTaskInput[];
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: withNote });

    expect(inv.fields).toEqual(['today', 'tasks']);
    expect(inv.user).toContain('做发布');
    // 🔴 一个字节的备注都不许出现
    expect(inv.user).not.toContain('机密');
    expect(inv.user).not.toContain('note');
  });

  it('缺省字段不出现在 JSON 里（少发就是少泄露）', () => {
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: [{ id: 't2', title: '写周报' }] });
    expect(inv.user).not.toContain('dueDate');
    expect(inv.user).not.toContain('priority');
  });

  it('🔴 数量封顶发生在**构造调用**这一层（出境面必须在发出去之前收窄）', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `t${String(i)}`, title: `任务 ${String(i)}` }));
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: many });
    expect(inv.user).toContain('t0');
    expect(inv.user).toContain(`t${String(MAX_PRIORITIZE_TASKS - 1)}`);
    // 第 51 条不该出现
    expect(inv.user).not.toContain(`t${String(MAX_PRIORITIZE_TASKS)}"`);
  });

  // ── 记忆层：偏好注入 prompt 与披露 ─────────────────────────────

  it('没有偏好时：不出现 preferences 字段，也不出现任何提示段落', () => {
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS });
    expect(inv.fields).toEqual(['today', 'tasks']);
    expect(inv.user).not.toContain('历史习惯');
  });

  it('🔴 传了偏好：`preferences` 必须进 `fields`（否则就是偷偷多发数据）', () => {
    const hints = renderPreferenceHints(withPrefs(), 'prioritize');
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS }, hints);
    expect(inv.fields).toEqual(['today', 'tasks', 'preferences']);
    expect(inv.user).toContain('关于这位用户的历史习惯');
  });

  it('🔴 只发该功能需要的偏好（最小化出境面）：排序不带粒度与标题风格', () => {
    const hints = renderPreferenceHints(withPrefs(), 'prioritize');
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS }, hints);
    // 需要的两条在
    expect(inv.user).toContain('提前 2 天');
    expect(inv.user).toContain('高效时段');
    // 不需要的不在
    expect(inv.user).not.toContain('6 项左右');
  });

  it('🔴 主开关关闭：一个偏好都不进 prompt，`preferences` 字段也不出现', () => {
    const off: PreferenceSet = { ...withPrefs(), memoryEnabled: false };
    const hints = renderPreferenceHints(off, 'prioritize');
    expect(hints).toEqual([]);

    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS }, hints);
    expect(inv.fields).toEqual(['today', 'tasks']);
    expect(inv.user).not.toContain('历史习惯');
    expect(inv.user).not.toContain('提前 2 天');
  });

  it('提示顺序固定（同样的输入必须产生同样的 prompt 字节）', () => {
    const a = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS }, renderPreferenceHints(withPrefs(), 'prioritize'));
    const b = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS }, renderPreferenceHints(withPrefs(), 'prioritize'));
    expect(a.user).toBe(b.user);
  });

  it('系统提示要求 id 原样照抄、且只输出 JSON', () => {
    const inv = buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS });
    expect(inv.system).toContain('原样照抄');
    expect(inv.system).toContain('只输出一个 JSON 数组');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 解析
// ─────────────────────────────────────────────────────────────────────────

describe('parsePrioritizeResult', () => {
  it('收标准 JSON 数组', () => {
    const out = parsePrioritizeResult(
      suggestionsJson([
        { id: 't1', priority: 'high', reason: '截止最近' },
        { id: 't2', priority: 'low', reason: '不急' },
      ]),
    );
    expect(out).toEqual([
      { id: 't1', priority: Priority.High, reason: '截止最近' },
      { id: 't2', priority: Priority.Low, reason: '不急' },
    ]);
  });

  it('剥掉代码围栏与前言（模型很爱加）', () => {
    const text = '好的，以下是建议：\n```json\n[{"id":"t1","priority":"medium","reason":"还行"}]\n```';
    expect(parsePrioritizeResult(text)).toEqual([
      { id: 't1', priority: Priority.Medium, reason: '还行' },
    ]);
  });

  it('容忍包着数组的对象', () => {
    const text = '{"suggestions":[{"id":"t1","priority":"none","reason":"不重要"}]}';
    expect(parsePrioritizeResult(text)).toEqual([
      { id: 't1', priority: Priority.None, reason: '不重要' },
    ]);
  });

  it('收中文与数值写法', () => {
    const out = parsePrioritizeResult(
      JSON.stringify([
        { id: 'a', priority: '高', reason: 'r' },
        { id: 'b', priority: 2, reason: 'r' },
        { id: 'c', priority: '低优先级', reason: 'r' },
        { id: 'd', priority: 0, reason: 'r' },
      ]),
    );
    expect(out.map((s) => s.priority)).toEqual([
      Priority.High,
      Priority.Medium,
      Priority.Low,
      Priority.None,
    ]);
  });

  it('🔴🔴 白名单：模型编造的 id 被丢弃', () => {
    const out = parsePrioritizeResult(
      JSON.stringify([
        { id: 't1', priority: 'high', reason: 'r' },
        { id: 'ghost', priority: 'high', reason: '编的' },
      ]),
      ['t1', 't2'],
    );
    expect(out).toEqual([{ id: 't1', priority: Priority.High, reason: 'r' }]);
  });

  it('🔴 id 原样保留（不改大小写、不做任何"帮忙修正"）', () => {
    const out = parsePrioritizeResult(
      JSON.stringify([{ id: 'T-1_A', priority: 'high', reason: 'r' }]),
      ['T-1_A'],
    );
    expect(out[0]?.id).toBe('T-1_A');
  });

  it('🔴🔴 非法优先级被拒（整条丢弃，不退回默认值）', () => {
    const out = parsePrioritizeResult(
      JSON.stringify([
        { id: 'a', priority: 'urgent', reason: 'r' },
        { id: 'b', priority: 'P1', reason: 'r' },
        { id: 'c', priority: 99, reason: 'r' },
        { id: 'd', priority: null, reason: 'r' },
        { id: 'e', priority: 'medium', reason: 'r' },
      ]),
    );
    expect(out).toEqual([{ id: 'e', priority: Priority.Medium, reason: 'r' }]);
  });

  it('丢掉缺 id / 空 id 的条目', () => {
    const out = parsePrioritizeResult(
      JSON.stringify([
        { priority: 'high', reason: 'r' },
        { id: '', priority: 'high', reason: 'r' },
        { id: 'ok', priority: 'high', reason: 'r' },
      ]),
    );
    expect(out.map((s) => s.id)).toEqual(['ok']);
  });

  it('去重（模型经常把同一条列两遍）', () => {
    const out = parsePrioritizeResult(
      JSON.stringify([
        { id: 't1', priority: 'high', reason: '第一次' },
        { id: 't1', priority: 'low', reason: '第二次' },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toBe('第一次');
  });

  it('🔴 数量封顶', () => {
    const many = JSON.stringify(
      Array.from({ length: 200 }, (_, i) => ({ id: `t${String(i)}`, priority: 'low', reason: 'r' })),
    );
    expect(parsePrioritizeResult(many)).toHaveLength(MAX_PRIORITIZE_TASKS);
  });

  it('🔴 理由长度封顶', () => {
    const out = parsePrioritizeResult(
      JSON.stringify([{ id: 't1', priority: 'high', reason: '啊'.repeat(500) }]),
    );
    expect(out[0]?.reason.length).toBe(MAX_REASON_LENGTH);
  });

  it('🔴 一坨非 JSON → 返回空（宁可说没读懂，不硬凑）', () => {
    expect(parsePrioritizeResult('抱歉，我无法完成这个任务。')).toEqual([]);
    expect(parsePrioritizeResult('')).toEqual([]);
    expect(parsePrioritizeResult('[{"id":')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 出境闸门在实际调用点真的会拦
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 requestPrioritize —— 出境闸门', () => {
  it('🔴🔴 远端端点但没有该功能的授权 → 不发任何请求', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([REMOTE_ENDPOINT], { prioritize: ['remote'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('ai-unavailable');
    // 🔴 关键：一个字节都没发出去
    expect(calls).toHaveLength(0);
  });

  it('🔴 授权绑的是 `(功能, 目的地)` —— 别的功能的授权不算数', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([REMOTE_ENDPOINT], { prioritize: ['remote'] }),
        consents: [{ feature: 'breakdown', destination: 'user-endpoint', grantedAt: 1 }],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('✅ 本机端点不需要授权，直接跑通', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.proposal.destination).toBe('none');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('localhost:11434');
  });

  it('✅ 远端端点 + 正确授权 → 跑通，destination 如实标为 user-endpoint', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([REMOTE_ENDPOINT], { prioritize: ['remote'] }),
        consents: [LOCAL_CONSENT],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.proposal.destination).toBe('user-endpoint');
    expect(calls).toHaveLength(1);
  });

  it('🔴 请求体里含任务标题与 id，且**不含 note**', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const withNote = [
      { id: 't1', title: '做发布', note: '机密：客户名单' },
    ] as unknown as PrioritizeTaskInput[];

    await requestPrioritize(
      { locale: 'zh-CN', tasks: withNote },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );

    const body = calls[0]?.body ?? '';
    expect(body).toContain('做发布');
    expect(body).not.toContain('机密');
  });

  it('🔴 偏好真的进了 HTTP 请求体（不是只在单测里成立）', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const hints = renderPreferenceHints(withPrefs(), 'prioritize');
    expect(hints.length).toBeGreaterThan(0);

    await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        preferences: hints,
        routed: { fetchImpl: impl },
      },
    );

    const body = calls[0]?.body ?? '';
    // ⚠️ 断言偏好块的完整表头 —— 系统提示里也提到"历史习惯"，
    // 只断言那四个字会永远为真（`ai-breakdown` 的测试踩过这个坑）。
    expect(body).toContain('关于这位用户的历史习惯');
    expect(body).toContain('提前 2 天');
  });

  it('🔴 不传 preferences 时，请求体里一个偏好字节都没有', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('关于这位用户的历史习惯');
  });

  it('🔴🔴 模型返回不存在的 id → 端到端被丢弃', async () => {
    const { impl } = fetchReturning(
      JSON.stringify([
        { id: 't1', priority: 'high', reason: '真实任务' },
        { id: 'ghost', priority: 'high', reason: '幻觉' },
      ]),
    );
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.proposal.suggestions.map((s) => s.id)).toEqual(['t1']);
    }
  });

  it('🔴 全部 id 都是幻觉 → `unparseable`，不返回一份空提议', async () => {
    const { impl } = fetchReturning(suggestionsJson([{ id: 'ghost', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('unparseable');
  });

  it('🔴 非法优先级端到端被拒', async () => {
    const { impl } = fetchReturning(
      JSON.stringify([
        { id: 't1', priority: 'urgent', reason: 'r' },
        { id: 't2', priority: 'low', reason: 'r' },
      ]),
    );
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.proposal.suggestions).toEqual([
        { id: 't2', priority: Priority.Low, reason: 'r' },
      ]);
    }
  });

  it('🔴 一条任务都没有 → 连路由都不走', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: [] },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('empty-tasks');
      expect(outcome.health).toEqual({});
    }
    expect(calls).toHaveLength(0);
  });

  it('🔴 总开关关着 → 不发请求，且提示去开总开关', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: { ...routing([LOCAL_ENDPOINT], { prioritize: ['local'] }), enabled: false },
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('总开关');
    expect(calls).toHaveLength(0);
  });

  it('🔴 这个功能没有配路由 → 提示要检查端点', async () => {
    const { impl, calls } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
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

  it('🔴 模型返回一坨没用的东西 → `unparseable`，不硬凑', async () => {
    const { impl } = fetchReturning('抱歉，我无法完成这个任务。');
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('unparseable');
  });

  it('🔴 输入超过上限时如实标记 truncated', async () => {
    const many = Array.from({ length: MAX_PRIORITIZE_TASKS + 5 }, (_, i) => ({
      id: `t${String(i)}`,
      title: `任务 ${String(i)}`,
    }));
    const { impl } = fetchReturning(
      JSON.stringify(many.map((t) => ({ id: t.id, priority: 'low', reason: 'r' }))),
    );
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: many },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.proposal.truncated).toBe(true);
  });

  it('🔴 没超上限时不标记 truncated（不制造噪音）', async () => {
    const { impl } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.proposal.truncated).toBe(false);
  });

  it('🔴 成功分支携带健康状态，供调用方持久化', async () => {
    const { impl } = fetchReturning(suggestionsJson([{ id: 't1', priority: 'high' }]));
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(typeof outcome.health).toBe('object');
  });

  it('🔴🔴 失败分支也要带回熔断状态（最该记的那一次）', async () => {
    const routeConfig = routing([LOCAL_ENDPOINT], { prioritize: ['local'] });
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routeConfig,
        consents: [LOCAL_CONSENT],
        routed: { fetchImpl: () => Promise.reject(new Error('connection refused')) },
      },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.health['local']).toBeDefined();
    expect(outcome.health['local']?.consecutiveFailures).toBe(1);
  });

  it('🔴 解析失败（请求成功但内容没法用）也带回 health', async () => {
    const routeConfig = routing([LOCAL_ENDPOINT], { prioritize: ['local'] });
    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routeConfig,
        consents: [LOCAL_CONSENT],
        routed: { fetchImpl: fetchReturning('抱歉我做不到').impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unparseable');
    expect(outcome.health['local']?.consecutiveFailures).toBe(0);
  });

  it('🔴 每种失败都有**不同**的提示（否则用户不知道该修哪里）', async () => {
    const messages = new Set<string>();
    for (const reason of ['not-configured', 'no-route', 'egress-not-authorized', 'network'] as const) {
      const impl = (() => {
        if (reason === 'network') return Promise.reject(new Error('boom'));
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('err'),
          json: () => Promise.resolve({}),
        });
      }) as unknown as typeof fetch;

      const outcome = await requestPrioritize(
        { locale: 'zh-CN', tasks: TASKS },
        {
          routing:
            reason === 'not-configured'
              ? { ...routing([LOCAL_ENDPOINT], { prioritize: ['local'] }), enabled: false }
              : reason === 'no-route'
                ? routing([LOCAL_ENDPOINT], {})
                : routing([LOCAL_ENDPOINT], { prioritize: ['local'] }),
          consents: [],
          routed: { fetchImpl: impl },
        },
      );
      if (!outcome.ok) messages.add(outcome.message);
    }
    expect(messages.size).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 回退不得跨越隐私边界（在真实调用点上再验一次）
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 回退不跨越隐私边界', () => {
  it('🔴🔴 本机端点失败后，不会自动把任务明文发到云端端点', async () => {
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
        json: () => Promise.resolve({ choices: [{ message: { content: suggestionsJson([{ id: 't1', priority: 'high' }]) } }] }),
        text: () => Promise.resolve('{}'),
      });
    }) as unknown as typeof fetch;

    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT, REMOTE_ENDPOINT], { prioritize: ['local', 'remote'] }),
        consents: [],
        policy: { ...DEFAULT_ROUTING_POLICY, maxAttempts: 3 },
        routed: { fetchImpl: impl },
      },
    );

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
        json: () => Promise.resolve({ choices: [{ message: { content: suggestionsJson([{ id: 't1', priority: 'high' }]) } }] }),
        text: () => Promise.resolve('{}'),
      });
    }) as unknown as typeof fetch;

    const outcome = await requestPrioritize(
      { locale: 'zh-CN', tasks: TASKS },
      {
        routing: routing([LOCAL_ENDPOINT, REMOTE_ENDPOINT], { prioritize: ['local', 'remote'] }),
        consents: [LOCAL_CONSENT],
        policy: { ...DEFAULT_ROUTING_POLICY, maxAttempts: 3 },
        routed: { fetchImpl: impl },
      },
    );

    expect(calls.some((u) => u.includes('api.example.com'))).toBe(true);
    expect(outcome.ok).toBe(true);
  });
});
