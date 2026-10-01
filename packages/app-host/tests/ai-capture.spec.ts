/**
 * AI 一句话捕获测试
 * ===================
 *
 * 本文件最重要的四条（其余都是它们的展开）：
 *
 *   1. 🔴 **`fields` 与 `user` 逐字段一致** —— 少写一个字段名，
 *      用户就会在不知情的情况下多送一份数据出去。
 *   2. 🔴 **未授权时一个字节都不发** —— 出境闸门必须在网络动作之前。
 *   3. 🔴 **解析是防御性的**：坏 JSON / 多余字段 / 类型不对，一律不猜。
 *   4. 🔴 **日期解析不出就留空**，绝不编一个"今天下午"。
 *
 * ⚠️ 这里**不真的发网络请求**：所有端点都用假的 `fetchImpl`。
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { Priority, renderPreferenceHints, type PreferenceSet } from '@heyta/domain';

import {
  DEFAULT_ROUTING_POLICY,
  type AiRoutingConfig,
  type EgressConsent,
} from '@heyta/ai';

import {
  MAX_CAPTURE_INPUT_LENGTH,
  MAX_CAPTURE_RESPONSE_LENGTH,
  MAX_CAPTURE_TITLE_LENGTH,
  buildCaptureInvocation,
  parseCaptureResult,
  requestCapture,
} from '../src/ai-capture.js';

// ─────────────────────────────────────────────────────────────────────────
// 夹具
// ─────────────────────────────────────────────────────────────────────────

/** 固定时钟。**不注入它，测试会过几天就变红**（AGENTS.md §7 #25）。 */
const NOW = Date.parse('2026-09-25T10:00:00');

const LOCAL_ENDPOINT = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  // 🔴 `capture` 只需要 `structured_output`（`DEFAULT_FEATURE_CAPABILITIES`）。
  // 刻意**不**声明 `long_context`：这条夹具同时证明我们没有照抄拆解的能力要求。
  capabilities: ['structured_output'],
};

const REMOTE_ENDPOINT = {
  id: 'remote',
  label: '云端',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  capabilities: ['structured_output'],
};

/**
 * 造路由配置。
 *
 * ⚠️ `routes` 的真形状是 `{ endpointId, model? }`，直接写字符串是**编译不过的** ——
 * 这里替调用点省掉那个噪音。
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

/** 返回一段模型风格的文本，并记录实际打出去的请求。 */
function fetchReturning(content: string): {
  impl: typeof fetch;
  calls: { url: string; body: string }[];
} {
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

const CAPTURE_CONSENT: EgressConsent = {
  feature: 'capture',
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

/**
 * 🔴 `fields` 与 `user` 的**对照表**。
 *
 * 出境披露读的是 `fields`，而真正出去的内容在 `user` 里。
 * 两者一旦漂移，披露就是假的 —— 所以这里用一张表把
 * "字段名 ↔ 正文里的标记"钉在一起，**双向**核对。
 */
const FIELD_MARKER: Readonly<Record<string, string>> = {
  today: '今天是：',
  text: '要捕获的一句话：',
  preferences: '关于这位用户的历史习惯',
};

/** 双向核对：fields 里每一项都在 user 里有标记，且 user 里没有未声明的标记。 */
function expectFieldsMatchUser(inv: { user: string; fields: readonly string[] }): void {
  for (const field of inv.fields) {
    const marker = FIELD_MARKER[field];
    expect(marker, `字段 ${field} 没有登记对照标记`).toBeDefined();
    expect(inv.user, `字段 ${field} 声明了却没进 user`).toContain(marker);
  }
  for (const [field, marker] of Object.entries(FIELD_MARKER)) {
    if (inv.user.includes(marker)) {
      expect(inv.fields, `user 里有 ${field} 的内容，fields 却没声明`).toContain(field);
    }
  }
}

describe('buildCaptureInvocation', () => {
  it('功能是 capture', () => {
    expect(buildCaptureInvocation({ locale: 'zh-CN', text: '明天下午三点和张总开周会', now: NOW }).feature).toBe(
      'capture',
    );
  });

  it('🔴🔴 `fields` 必须覆盖 `user` 里出现的每个数据字段（披露的依据）', () => {
    expectFieldsMatchUser(buildCaptureInvocation({ locale: 'zh-CN', text: '明天下午三点和张总开周会', now: NOW }));
  });

  it('🔴 `fields` 里不许有 user 里没有的字段（披露不能虚报）', () => {
    const inv = buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: NOW });
    expect([...inv.fields].sort()).toEqual(['text', 'today']);
    // user 里确实有那句话
    expect(inv.user).toContain('买牛奶');
  });

  it('🔴 `today` 是一个**真实出境字段**，必须被披露', () => {
    const inv = buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: NOW });
    expect(inv.fields).toContain('today');
    // 固定时钟 → 固定日期（这条同时证明时钟可注入）
    expect(inv.user).toContain('2026-09-25');
    // 星期是从同一个时钟推出来的，不是另一次 Date.now()
    expect(inv.user).toContain('周五');
  });

  it('同样的输入产生同样的 prompt 字节（可复现）', () => {
    const a = buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: NOW });
    const b = buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: NOW });
    expect(a.user).toBe(b.user);
    expect(a.system).toBe(b.system);
  });

  it('系统提示要求**严格 JSON** 且明确禁止猜日期', () => {
    const { system } = buildCaptureInvocation({ locale: 'zh-CN', text: 'x', now: NOW });
    expect(system).toContain('JSON');
    expect(system).toContain('dueDate');
    // 这条是硬约束：宁可省略，也不要编
    expect(system).toContain('省略');
    expect(system).toContain('不确定');
  });

  it('🔴 输入过长时在 prompt 层也截断（纵深防御）', () => {
    const inv = buildCaptureInvocation({
      locale: 'zh-CN',
      text: '啊'.repeat(MAX_CAPTURE_INPUT_LENGTH + 200),
      now: NOW,
    });
    const sent = inv.user.slice(inv.user.indexOf('要捕获的一句话：'));
    expect(sent.length).toBeLessThan(MAX_CAPTURE_INPUT_LENGTH + 40);
  });

  // ── 记忆层：偏好注入 prompt 与披露 ─────────────────────────────

  it('没有偏好时：不出现 preferences 字段，也不出现任何提示段落', () => {
    const inv = buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: NOW });
    expect(inv.fields).not.toContain('preferences');
    expect(inv.user).not.toContain('关于这位用户的历史习惯');
  });

  it('🔴 传了偏好：`preferences` 必须进 `fields`（否则就是偷偷多发数据）', () => {
    const hints = renderPreferenceHints(withPrefs(), 'capture');
    expect(hints.length).toBeGreaterThan(0);
    const inv = buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: NOW }, hints);
    expect(inv.fields).toContain('preferences');
    expectFieldsMatchUser(inv);
  });

  it('🔴 只发该功能需要的偏好（最小化出境面）：捕获不带粒度/估时/时段', () => {
    const hints = renderPreferenceHints(withPrefs(), 'capture');
    const inv = buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: NOW }, hints);
    // 捕获只关心标题风格
    expect(inv.user).toContain('任务标题以中文为主');
    expect(inv.user).not.toContain('拆成 6 项');
    expect(inv.user).not.toContain('1.80 倍');
    expect(inv.user).not.toContain('高效时段');
  });

  it('🔴 主开关关闭：一个偏好都不进 prompt，`preferences` 字段也不出现', () => {
    const off: PreferenceSet = { ...withPrefs(), memoryEnabled: false };
    const hints = renderPreferenceHints(off, 'capture');
    expect(hints).toEqual([]);

    const inv = buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: NOW }, hints);
    expect([...inv.fields].sort()).toEqual(['text', 'today']);
    expect(inv.user).not.toContain('关于这位用户的历史习惯');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 解析：不信任响应形状
// ─────────────────────────────────────────────────────────────────────────

describe('parseCaptureResult —— 正常形状', () => {
  it('收标准 JSON', () => {
    const parsed = parseCaptureResult(
      '{"title":"和张总开周会","dueDate":"2026-09-26T15:00:00","priority":"high"}',
    );
    expect(parsed).toBeDefined();
    expect(parsed?.title).toBe('和张总开周会');
    expect(parsed?.dueDate).toBe('2026-09-26T15:00:00');
    expect(parsed?.priority).toBe(Priority.High);
    expect(parsed?.dropped).toEqual([]);
  });

  it('收包在代码围栏里的 JSON', () => {
    const parsed = parseCaptureResult('```json\n{"title":"买牛奶"}\n```');
    expect(parsed?.title).toBe('买牛奶');
  });

  it('收带前言的 JSON（模型爱写"好的，结果如下："）', () => {
    const parsed = parseCaptureResult('好的，结果如下：\n{"title":"买牛奶","priority":"low"}\n希望有帮助。');
    expect(parsed?.title).toBe('买牛奶');
    expect(parsed?.priority).toBe(Priority.Low);
  });

  it('只有日期时原样保留（**不补一个时间**）', () => {
    const parsed = parseCaptureResult('{"title":"交周报","dueDate":"2026-09-26"}');
    expect(parsed?.dueDate).toBe('2026-09-26');
  });

  it('日期不补零也收（宽容输入、严格校验）', () => {
    const parsed = parseCaptureResult('{"title":"交周报","dueDate":"2026-9-6T9:05:07"}');
    expect(parsed?.dueDate).toBe('2026-09-06T09:05:07');
  });

  it('优先级大小写不敏感，四个取值都能认', () => {
    expect(parseCaptureResult('{"title":"x","priority":"HIGH"}')?.priority).toBe(Priority.High);
    expect(parseCaptureResult('{"title":"x","priority":"Medium"}')?.priority).toBe(Priority.Medium);
    expect(parseCaptureResult('{"title":"x","priority":"low"}')?.priority).toBe(Priority.Low);
    expect(parseCaptureResult('{"title":"x","priority":"none"}')?.priority).toBe(Priority.None);
  });

  it('🔴 多余字段被忽略，不报错（模型总会多写几个键）', () => {
    const parsed = parseCaptureResult(
      '{"title":"买牛奶","reasoning":"用户在买东西","tags":["a","b"],"confidence":0.9}',
    );
    expect(parsed?.title).toBe('买牛奶');
    expect(parsed?.dropped).toEqual([]);
  });
});

describe('🔴 parseCaptureResult —— 防御性', () => {
  it('🔴 坏 JSON 一律判 unparseable（返回 undefined）', () => {
    expect(parseCaptureResult('')).toBeUndefined();
    expect(parseCaptureResult('   \n ')).toBeUndefined();
    expect(parseCaptureResult('这不是 JSON')).toBeUndefined();
    expect(parseCaptureResult('{title: 买牛奶}')).toBeUndefined();
    expect(parseCaptureResult('{"title": "买牛奶"')).toBeUndefined();
  });

  it('🔴 数组 / 原始值 / null **不是**对象，一律失败', () => {
    expect(parseCaptureResult('[]')).toBeUndefined();
    expect(parseCaptureResult('[{"title":"x"}]')).toBeUndefined();
    expect(parseCaptureResult('"买牛奶"')).toBeUndefined();
    expect(parseCaptureResult('3')).toBeUndefined();
    expect(parseCaptureResult('null')).toBeUndefined();
  });

  it('🔴 title 类型不对或为空 → 整条失败（标题是骨架，没有它就没有任务）', () => {
    expect(parseCaptureResult('{"title":123}')).toBeUndefined();
    expect(parseCaptureResult('{"title":""}')).toBeUndefined();
    expect(parseCaptureResult('{"title":"   "}')).toBeUndefined();
    expect(parseCaptureResult('{"title":null}')).toBeUndefined();
    expect(parseCaptureResult('{"dueDate":"2026-09-26"}')).toBeUndefined();
    expect(parseCaptureResult('{}')).toBeUndefined();
  });

  it('🔴 dueDate 类型不对 → 丢弃该字段，但**不拖垮整条**', () => {
    const parsed = parseCaptureResult('{"title":"买牛奶","dueDate":123}');
    expect(parsed?.title).toBe('买牛奶');
    expect(parsed?.dueDate).toBeUndefined();
    // 丢字段必须是**可见的**
    expect(parsed?.dropped).toContain('dueDate');
  });

  it('🔴 模型把相对说法塞进 dueDate → 丢弃，绝不当成日期', () => {
    for (const bad of ['明天下午三点', '下周三', '今天', '下个月', 'soon', '2026/09/26']) {
      const parsed = parseCaptureResult(`{"title":"开会","dueDate":"${bad}"}`);
      expect(parsed?.dueDate, `${bad} 不该被当成日期`).toBeUndefined();
      expect(parsed?.dropped).toContain('dueDate');
    }
  });

  it('🔴 不存在的日期（2 月 30 日）→ 丢弃，**不静默进位**', () => {
    const parsed = parseCaptureResult('{"title":"开会","dueDate":"2026-02-30"}');
    expect(parsed?.dueDate).toBeUndefined();
    expect(parsed?.dropped).toContain('dueDate');
  });

  it('🔴 越界时间 → 丢弃', () => {
    expect(parseCaptureResult('{"title":"开会","dueDate":"2026-09-26T25:00:00"}')?.dueDate).toBeUndefined();
    expect(parseCaptureResult('{"title":"开会","dueDate":"2026-09-26T10:61:00"}')?.dueDate).toBeUndefined();
  });

  it('🔴 日期解析不出时**不编造**：整条结果里没有任何日期', () => {
    const parsed = parseCaptureResult('{"title":"开会","dueDate":"明天"}');
    expect(parsed?.dueDate).toBeUndefined();
    // 也不许出现"今天"（模型/代码都不许替用户决定）
    expect(JSON.stringify(parsed)).not.toContain('2026');
  });

  it('🔴 模型没给日期 → 结果里就没有日期（不是"今天"）', () => {
    const parsed = parseCaptureResult('{"title":"买牛奶"}');
    expect(parsed?.dueDate).toBeUndefined();
    expect(parsed?.dropped).toEqual([]);
  });

  it('dueDate 为 null 视同"没给"，不记成丢弃', () => {
    const parsed = parseCaptureResult('{"title":"买牛奶","dueDate":null,"priority":null}');
    expect(parsed?.dueDate).toBeUndefined();
    expect(parsed?.priority).toBeUndefined();
    expect(parsed?.dropped).toEqual([]);
  });

  it('🔴 未知优先级词 → 丢弃（不做同义词猜测）', () => {
    for (const bad of ['urgent', '重要', 'P1', '1', '高']) {
      const parsed = parseCaptureResult(`{"title":"开会","priority":"${bad}"}`);
      expect(parsed?.priority, `${bad} 不该被映射成优先级`).toBeUndefined();
      expect(parsed?.dropped).toContain('priority');
    }
  });

  it('🔴 标题长度封顶（它会进 op、会同步到每台设备）', () => {
    const long = '啊'.repeat(MAX_CAPTURE_TITLE_LENGTH + 500);
    const parsed = parseCaptureResult(JSON.stringify({ title: long }));
    expect(parsed?.title.length).toBe(MAX_CAPTURE_TITLE_LENGTH);
  });

  it('🔴 响应过长 → 直接判失败（解析器自保）', () => {
    const huge = JSON.stringify({ title: 'x'.repeat(MAX_CAPTURE_RESPONSE_LENGTH + 10) });
    expect(parseCaptureResult(huge)).toBeUndefined();
  });

  it('多个 JSON 对象时取**第一个**（后面的解释不算）', () => {
    const parsed = parseCaptureResult('{"title":"甲"}\n{"title":"乙"}');
    expect(parsed?.title).toBe('甲');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 出境闸门在实际调用点真的会拦
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 requestCapture —— 出境闸门', () => {
  it('🔴🔴 远端端点但**没有该功能的授权** → 不发任何请求', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '明天开会', now: NOW },
      {
        routing: routing([REMOTE_ENDPOINT], { capture: ['remote'] }),
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
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '明天开会', now: NOW },
      {
        routing: routing([REMOTE_ENDPOINT], { capture: ['remote'] }),
        // 授权的是 breakdown，不是 capture
        consents: [{ feature: 'breakdown', destination: 'user-endpoint', grantedAt: 1 }],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('🔴 授权了但目的地是 heyta-cloud，而路由走的是用户端点 → 不匹配', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '明天开会', now: NOW },
      {
        routing: routing([REMOTE_ENDPOINT], { capture: ['remote'] }),
        consents: [{ feature: 'capture', destination: 'heyta-cloud', grantedAt: 1 }],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('✅ 本机端点不需要授权，直接跑通', async () => {
    const { impl, calls } = fetchReturning('{"title":"和张总开周会","priority":"high"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '明天下午三点和张总开周会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.proposal.title).toBe('和张总开周会');
      expect(outcome.proposal.priority).toBe(Priority.High);
      expect(outcome.proposal.destination).toBe('none');
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('localhost:11434');
  });

  it('✅ 远端端点 + 正确授权 → 跑通，且 destination 如实标为 user-endpoint', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([REMOTE_ENDPOINT], { capture: ['remote'] }),
        consents: [CAPTURE_CONSENT],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.proposal.destination).toBe('user-endpoint');
    expect(calls).toHaveLength(1);
  });

  it('🔴 总开关关着 → 不发请求，且提示去开总开关', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: { ...routing([LOCAL_ENDPOINT], { capture: ['local'] }), enabled: false },
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('总开关');
    expect(calls).toHaveLength(0);
  });

  it('🔴 这个功能没有配路由 → 提示要检查端点而不是总开关', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], {}), // capture 没路由
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('端点');
    expect(calls).toHaveLength(0);
  });

  it('🔴 空文本直接拒绝，连路由都不走', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '   ', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('empty-text');
      // 没有端点被尝试过 → 空 health
      expect(outcome.health).toEqual({});
    }
    expect(calls).toHaveLength(0);
  });

  it('🔴 超长输入直接拒绝（**不截断**，也不发请求）', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '啊'.repeat(MAX_CAPTURE_INPUT_LENGTH + 1), now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('text-too-long');
      expect(outcome.health).toEqual({});
    }
    expect(calls).toHaveLength(0);
  });

  it('🔴 模型返回一坨没用的东西 → `unparseable`，不硬凑', async () => {
    const { impl } = fetchReturning('抱歉，我无法完成这个任务。');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('unparseable');
  });

  it('🔴 `capture` 只需要 structured_output —— 不声明 long_context 也能跑', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    // 夹具的 LOCAL_ENDPOINT 只有 structured_output；这条要是红了，
    // 说明有人把拆解的能力要求抄到了捕获上。
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('🔴 缺能力时说"能力"和"声明"，不是"检查地址是否合法"', async () => {
    const noStructured = {
      id: 'local',
      label: '本机',
      endpoint: 'http://localhost:11434/v1',
      model: 'm',
      capabilities: ['vision'],
    };
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([noStructured], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('能力');
      expect(outcome.message).toContain('声明');
      expect(outcome.message).not.toContain('地址是否合法');
    }
    expect(calls).toHaveLength(0);
  });

  // ── 🔴 端到端：偏好真的到达了网络请求体 ──────────────────────
  //
  // 本项目反复出现「能力实现了、被测了、但没人调用」。单测
  // `buildCaptureInvocation` 证明不了 `requestCapture` 把 hints 传下去了 ——
  // 只有打到 wire 上才算数。

  it('🔴 偏好真的进了 HTTP 请求体（不是只在单测里成立）', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    const hints = renderPreferenceHints(withPrefs(), 'capture');
    expect(hints.length).toBeGreaterThan(0);

    await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        preferences: hints,
        routed: { fetchImpl: impl },
      },
    );

    expect(calls).toHaveLength(1);
    const body = calls[0]?.body ?? '';
    // ⚠️ 断言**偏好块的完整表头**与偏好内容，不能只断言「历史习惯」——
    // 系统提示里本身就有这几个字，用它做断言会永远为真。
    expect(body).toContain('关于这位用户的历史习惯');
    expect(body).toContain('任务标题以中文为主');
  });

  it('🔴 不传 preferences 时，请求体里一个偏好字节都没有', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('关于这位用户的历史习惯');
    expect(body).not.toContain('任务标题以中文为主');
  });

  it('🔴 主开关关闭 → 端到端请求体里没有偏好（开关真的管住了出境）', async () => {
    const off: PreferenceSet = { ...withPrefs(), memoryEnabled: false };
    const hints = renderPreferenceHints(off, 'capture');
    const { impl, calls } = fetchReturning('{"title":"甲"}');

    await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        preferences: hints,
        routed: { fetchImpl: impl },
      },
    );

    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('关于这位用户的历史习惯');
  });

  it('🔴 请求体里只有被披露的字段：那句话 + 今天', async () => {
    const { impl, calls } = fetchReturning('{"title":"甲"}');
    await requestCapture(
      { locale: 'zh-CN', text: '明天下午三点和张总开周会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    const body = calls[0]?.body ?? '';
    expect(body).toContain('明天下午三点和张总开周会');
    expect(body).toContain('2026-09-25');
    // 没有备注、没有截止时间这些**这个功能不该碰**的字段
    expect(body).not.toContain('已有备注');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 日期是候选，不是事实
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 模型给的日期只是候选', () => {
  it('🔴 请求层：坏日期被丢弃并如实标记，整条仍然可用', async () => {
    const { impl } = fetchReturning('{"title":"开会","dueDate":"明天下午三点"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '明天下午三点开会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.title).toBe('开会');
    // 🔴 没有日期就是没有日期
    expect(outcome.proposal.dueDate).toBeUndefined();
    expect(outcome.proposal.dropped).toContain('dueDate');
  });

  it('🔴 请求层：模型没提日期时，结果里绝不出现日期', async () => {
    const { impl } = fetchReturning('{"title":"买牛奶"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '买牛奶', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.dueDate).toBeUndefined();
    // 连"今天"都不许冒出来
    expect(JSON.stringify(outcome.proposal)).not.toContain('2026');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 模型输出不会直接写库
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 模型输出不会直接写库', () => {
  const source = readFileSync(new URL('../src/ai-capture.ts', import.meta.url), 'utf8');

  it('🔴🔴 模块**结构上**不可能写库：不 import 动作层 / op-log，也不构造 op', () => {
    // 这是"类型上做不到"的源码级版本：只要没人把写入口 import 进来，
    // 这个模块就不可能绕过用户确认去改数据。
    expect(source).not.toContain("from './actions.js'");
    expect(source).not.toContain('@heyta/op-log');
    expect(source).not.toContain('entityType');
    expect(source).not.toContain('OpIntent');
    expect(source).not.toContain('dispatch(');
  });

  it('🔴 返回值只有候选值，没有任何"已应用"语义', async () => {
    const { impl } = fetchReturning('{"title":"甲","dueDate":"2026-09-26","priority":"high"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '甲', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Object.keys(outcome.proposal).sort()).toEqual([
      'destination',
      'dropped',
      'dueDate',
      'priority',
      'title',
    ]);
  });

  it('🔴 `requestCapture` 的依赖里**没有**任何写入口', () => {
    // 类型层面：`RequestCaptureDeps` 的键只可能是这几项。
    // 有人加一个 `store` / `apply` 进来，这条会红。
    const deps = {
      routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
      consents: [],
    } satisfies Parameters<typeof requestCapture>[1];
    expect(Object.keys(deps).sort()).toEqual(['consents', 'routing']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 熔断状态
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 两个分支都必须带回熔断状态', () => {
  it('🔴🔴 端点失败时，health 记下了那个端点的失败次数', async () => {
    const routeConfig = routing([LOCAL_ENDPOINT], { capture: ['local'] });
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routeConfig,
        consents: [],
        routed: { fetchImpl: () => Promise.reject(new Error('connection refused')) },
      },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.health['local']).toBeDefined();
    expect(outcome.health['local']?.consecutiveFailures).toBe(1);
  });

  it('🔴 连续失败会累加（熔断的依据）', async () => {
    const routeConfig = routing([LOCAL_ENDPOINT], { capture: ['local'] });
    const failing = (): Promise<never> => Promise.reject(new Error('down'));

    const first = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      { routing: routeConfig, consents: [], routed: { fetchImpl: failing } },
    );
    expect(first.ok).toBe(false);
    if (first.ok) return;

    // 用上一轮的 health 作为种子 —— 模拟"落盘后重启又读回来"
    const second = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      { routing: routeConfig, consents: [], routed: { fetchImpl: failing, healthSeed: first.health } },
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.health['local']?.consecutiveFailures).toBe(2);
  });

  it('🔴 解析失败（请求成功但内容没法用）也带回 health', async () => {
    const routeConfig = routing([LOCAL_ENDPOINT], { capture: ['local'] });
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routeConfig,
        consents: [],
        routed: { fetchImpl: fetchReturning('抱歉我做不到').impl },
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unparseable');
    // 请求是通的 → 这个端点有成功记录，没有失败
    expect(outcome.health['local']?.consecutiveFailures).toBe(0);
  });

  it('🔴 成功分支也带 health（形状与失败分支一致）', async () => {
    const { impl } = fetchReturning('{"title":"甲"}');
    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT], { capture: ['local'] }),
        consents: [],
        routed: { fetchImpl: impl },
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(typeof outcome.health).toBe('object');
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
        json: () => Promise.resolve({ choices: [{ message: { content: '{"title":"甲"}' } }] }),
        text: () => Promise.resolve('{"choices":[{"message":{"content":"{\\"title\\":\\"甲\\"}"}}]}'),
      });
    }) as unknown as typeof fetch;

    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT, REMOTE_ENDPOINT], { capture: ['local', 'remote'] }),
        // 只授权了本机（本机其实不需要授权）—— 云端没授权
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
        json: () => Promise.resolve({ choices: [{ message: { content: '{"title":"甲"}' } }] }),
        text: () => Promise.resolve('{"choices":[{"message":{"content":"{\\"title\\":\\"甲\\"}"}}]}'),
      });
    }) as unknown as typeof fetch;

    const outcome = await requestCapture(
      { locale: 'zh-CN', text: '开会', now: NOW },
      {
        routing: routing([LOCAL_ENDPOINT, REMOTE_ENDPOINT], { capture: ['local', 'remote'] }),
        consents: [CAPTURE_CONSENT],
        policy: { ...DEFAULT_ROUTING_POLICY, maxAttempts: 3 },
        routed: { fetchImpl: impl },
      },
    );

    expect(calls.some((u) => u.includes('api.example.com'))).toBe(true);
    expect(outcome.ok).toBe(true);
  });
});
