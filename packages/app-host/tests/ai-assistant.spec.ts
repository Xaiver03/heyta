/**
 * 对话式助手的循环测试
 * =======================
 *
 * 🔴🔴 本文件最要紧的**不是**"循环能不能跑"，而是四条只能靠**数请求**证明的约束：
 *
 *   1. 写提案之后**不再发第二次请求**（一次确认的根据）。
 *   2. 披露集合外的字段 ⇒ **那一步一个字节都没发出去**（不是"发了再报错"）。
 *   3. 触顶时请求数恰好等于上界，不多一次。
 *   4. 未授权时**出境被拒的那句话里必须列出工具结果的字段名** ——
 *      这一条证明"循环前一次性并集披露"是真的在披露，
 *      而不是只在代码注释里写着。
 *
 * 四条都是"看返回值看不出来"的那种：一个"报告说没发、其实发了"的实现，
 * 只在请求计数上现形（§7 第 46 条的同一形状）。所以每个用例都包一层
 * **只记录不拦截**的 fetch，收尾数出来。
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_ASSISTANT_MESSAGES,
  MAX_ASSISTANT_TOOL_STEPS,
  type AiEndpointConfig,
  type AiRoutingConfig,
  type EgressConsent,
} from '@heyta/ai';
import { LOCAL_API_TOOLS, type LocalApiHabit, type LocalApiHost, type LocalApiItem, type LocalApiProject } from '@heyta/local-api';

import {
  LOCAL_ANSWER_MAX_ITEMS,
  assistantEgressFields,
  assistantGrants,
  assistantSystemPrompt,
  type LocalObservationKey,
  type LocalObservationTranslate,
  localObservationText,
  observedFieldNames,
  planAssistantEgress,
  requestAssistantTurn,
} from '../src/ai-assistant.js';

// ─────────────────────────────────────────────────────────────────────────
// 台架
// ─────────────────────────────────────────────────────────────────────────

/** 会记账的假宿主。`submits` 是"确认之前不许写"那条的观测点。 */
function fakeHost(items: readonly LocalApiItem[] = [], projects: readonly LocalApiProject[] = []) {
  const host = {
    submits: 0,
    listTasks: (): Promise<readonly LocalApiItem[]> => Promise.resolve(items),
    getTask: (taskId: string): Promise<LocalApiItem | undefined> =>
      Promise.resolve(items.find((x) => x.id === taskId)),
    listProjects: (): Promise<readonly LocalApiProject[]> => Promise.resolve(projects),
    listHabits: (): Promise<readonly LocalApiHabit[]> =>
      Promise.resolve([{ id: 'h1', name: '喝水', target: 8 }]),
    listTags: () => Promise.resolve([]),
    listNotes: () => Promise.resolve([]),
    getNote: () => Promise.resolve(undefined),
    listHabitLogs: () => Promise.resolve([]),
    listFocusSessions: () => Promise.resolve([]),
    listReminders: () => Promise.resolve([]),
    listEvents: () => Promise.resolve([]),
    getEvent: () => Promise.resolve(undefined),
    submit: (): Promise<{ ok: true; taskId: string }> => {
      host.submits += 1;
      return Promise.resolve({ ok: true, taskId: 'created-1' });
    },
  };
  return host;
}

/**
 * ⚠️ 形状**照 `LocalApiItem` 来**：`dueDate` / `priority` 都是字符串。
 * 这里原来写的是 `dueDate: 1, priority: 5` —— vitest 走 esbuild **只转译不类型检查**，
 * 所以它一路跑绿，直到 `pnpm -r typecheck`（`tsconfig.spec.json` 才把 tests 纳进来）才红。
 * 一个类型上非法的夹具，测出来的"观察结果键集合"也可能是非法形状。
 */
const TASKS: readonly LocalApiItem[] = [
  { id: 't1', title: '买牛奶', dueDate: '2026-03-14T09:00:00', priority: 'high', readable: true },
];
const PROJECTS: readonly LocalApiProject[] = [{ id: 'p1', name: '工作', taskCount: 2 }];

const LOCAL: AiEndpointConfig = {
  id: 'local',
  label: '本机',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output', 'tool_calling'],
};

const REMOTE: AiEndpointConfig = {
  id: 'remote',
  label: '云端',
  endpoint: 'https://api.example.com/v1',
  model: 'a-longer-model-name',
  capabilities: ['structured_output', 'tool_calling'],
};

const LOCAL_COPY: Record<'zh-CN' | 'en', Record<LocalObservationKey, string>> = {
  'zh-CN': {
    'web.ai.chat.local.empty': '没有符合条件的内容。',
    'web.ai.chat.local.found': '我找到 {count} 项：',
    'web.ai.chat.local.untitled': '（未命名）',
    'web.ai.chat.local.more': '还有 {count} 项未列出。',
  },
  en: {
    'web.ai.chat.local.empty': 'I found no matching items.',
    'web.ai.chat.local.found': 'Found {count}:',
    'web.ai.chat.local.untitled': '(Untitled)',
    'web.ai.chat.local.more': '{count} more not shown.',
  },
};

function localize(locale: 'zh-CN' | 'en'): LocalObservationTranslate {
  return (key, vars) =>
    (vars === undefined ? LOCAL_COPY[locale][key] : LOCAL_COPY[locale][key].replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = vars[name];
      return value === undefined ? whole : String(value);
    }));
}

const LOCALIZE_ZH = localize('zh-CN');
const LOCALIZE_EN = localize('en');

function routing(endpoint: AiEndpointConfig): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: endpoint === REMOTE,
    endpoints: [endpoint],
    routes: { 'tool-calling': [{ endpointId: endpoint.id }] },
  };
}

/** 一次模型回包：要么要求调工具，要么就是说话。 */
type Reply =
  | { kind: 'text'; text: string }
  | { kind: 'call'; id: string; name: string; args: string }
  | { kind: 'calls'; calls: readonly { id: string; name: string; args: string }[] };

function toMessage(reply: Reply): Record<string, unknown> {
  if (reply.kind === 'text') return { role: 'assistant', content: reply.text };
  const calls = reply.kind === 'call' ? [reply] : reply.calls;
  return {
    role: 'assistant',
    content: null,
    tool_calls: calls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.args },
    })),
  };
}

interface Captured {
  url: string;
  body: Record<string, unknown>;
  messages: readonly Record<string, unknown>[];
}

/**
 * 按脚本顺序回包的假端点。**记录**每一次请求，不拦截。
 *
 * ⚠️ 脚本用完还在被调用 ⇒ 抛错 —— 那正是"循环没停在它该停的地方"的哨兵。
 */
function scriptedFetch(replies: readonly Reply[]): { impl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  let index = 0;
  const impl = ((url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({
      url: String(url),
      body,
      messages: (body['messages'] ?? []) as readonly Record<string, unknown>[],
    });
    const reply = replies[index];
    index += 1;
    if (reply === undefined) {
      throw new Error(`假端点脚本只有 ${String(replies.length)} 条，第 ${String(index)} 次请求没有回包`);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      // 🔴 形状照真实帧来：`{ choices: [ { message: … } ] }`。
      // 少一层 `message` 的话 `extractToolCalls` 读不到东西，测试会以
      // "模型只回了话"收尾 —— 那是**桩的 bug**，不是产品的（本仓库有账）。
      json: () => Promise.resolve({ choices: [{ message: toMessage(reply) }] }),
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const READ_ONLY_CONSENT: readonly EgressConsent[] = [
  { feature: 'tool-calling', destination: 'user-endpoint', grantedAt: 1 },
];

// ─────────────────────────────────────────────────────────────────────────

describe('多步读循环', () => {
  it('读 → 读 → 答：三次请求，观察结果真的回送了模型', async () => {
    const host = fakeHost(TASKS, PROJECTS);
    const { impl, calls } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'list_projects', args: '{}' },
      { kind: 'call', id: 'c2', name: 'list_tasks', args: '{}' },
      { kind: 'text', text: '你有一个清单和一条任务。' },
    ]);

    const outcome = await requestAssistantTurn(
      { text: '我都有些啥？' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host,
        routed: { fetchImpl: impl },
      },
    );

    expect(calls.length).toBe(3);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'answer') return;
    expect(outcome.text).toBe('你有一个清单和一条任务。');
    expect(outcome.steps.map((s) => s.tool)).toEqual(['list_projects', 'list_tasks']);
    expect(host.submits).toBe(0);

    // 🔴 单步架构做不到的事，这一条就是它的正面证据：
    // 第二次请求里带着**第一次的观察结果**（role='tool' + 对应 id）。
    const second = calls[1];
    expect(second?.messages.map((m) => m['role'])).toEqual(['system', 'user', 'tool']);
    expect(second?.messages[2]?.['tool_call_id']).toBe('c1');
    expect(String(second?.messages[2]?.['content'])).toContain('工作');

    const third = calls[2];
    expect(third?.messages.map((m) => m['role'])).toEqual(['system', 'user', 'tool', 'tool']);
    expect(String(third?.messages[3]?.['content'])).toContain('买牛奶');

    // 第一次请求必须是**干净的**两条（没有工具结果）—— 形状不许被多轮支持带跑。
    expect(calls[0]?.messages.map((m) => m['role'])).toEqual(['system', 'user']);
  });

  it('历史带进 messages，且顺序是 system → 历史 → 本轮 → 工具结果', async () => {
    const host = fakeHost(TASKS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '收到' }]);
    await requestAssistantTurn(
      { text: '继续' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host,
        history: [
          { role: 'user', text: '第一句' },
          { role: 'assistant', text: '第一答' },
        ],
        routed: { fetchImpl: impl },
      },
    );
    expect(calls[0]?.messages.map((m) => m['role'])).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(calls[0]?.messages.map((m) => m['content'])).toEqual([
      calls[0]?.messages[0]?.['content'],
      '第一句',
      '第一答',
      '继续',
    ]);
  });

  it('🔴 工具失败也回送模型，但**仍然计入步数上界**（失败不能免费重试）', async () => {
    const host = fakeHost(TASKS);
    // `get_task` 不给 taskId ⇒ 参数不合法 ⇒ 执行层失败 ⇒ 循环把**失败本身**告诉模型。
    // ⚠️ 故意不用"id 不存在"：那种情况 local-api 回的是**观察结果**（里面带 `error`），
    //    不是失败 —— 形状另有一条测试钉。
    const replies: Reply[] = [];
    for (let i = 0; i < MAX_ASSISTANT_TOOL_STEPS; i += 1) {
      replies.push({ kind: 'call', id: `c${String(i)}`, name: 'get_task', args: '{}' });
    }
    const { impl, calls } = scriptedFetch(replies);
    const outcome = await requestAssistantTurn(
      { text: '看看那条' },
      { routing: routing(LOCAL), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } },
    );
    expect(calls.length).toBe(MAX_ASSISTANT_TOOL_STEPS);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'stopped') return;
    expect(outcome.limit).toBe('tool-steps');
    expect(outcome.steps.every((s) => !s.ok)).toBe(true);
    // 🔴 失败不是"悄悄跳过"：第 2 次请求里必须能看到第 1 步的失败说明，
    //    否则模型是在毫不知情的情况下重复同一个错误。
    expect(calls[1]?.messages.some((m) => String(m['content'] ?? '').includes('工具没有执行成功'))).toBe(
      true,
    );
    expect(host.submits).toBe(0);
  });

  it('id 不存在 ⇒ 那是**观察结果**（带 `error`），不是失败，且错误文本回送模型', async () => {
    // 这条钉的是 local-api 的真实形状：`get_task` 读不到条目时返回 `{ error: … }` 载荷。
    // 它正是 `TOOL_ENVELOPE_EGRESS_FIELDS` 存在的原因 —— 声明漏了它，
    // 循环会把一次**正常**的"没找到"误判成越界出境。
    const host = fakeHost(TASKS);
    const { impl, calls } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'get_task', args: '{"taskId":"nope"}' },
      { kind: 'text', text: '那条任务不存在。' },
    ]);
    const outcome = await requestAssistantTurn(
      { text: '看看那条' },
      { routing: routing(LOCAL), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'answer') return;
    expect(outcome.steps).toEqual([{ tool: 'get_task', kind: 'read', ok: true }]);
    expect(calls[1]?.messages.some((m) => String(m['content'] ?? '').includes('没有'))).toBe(true);
    expect(host.submits).toBe(0);
  });
});

describe('🔴 写：一次一个，按风险自动执行或确认', () => {
  it('模型要写低风险任务 ⇒ 自动执行并停，第二次请求根本没发', async () => {
    const host = fakeHost();
    const { impl, calls } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'list_tasks', args: '{}' },
      { kind: 'call', id: 'c2', name: 'create_task', args: '{"title":"买咖啡"}' },
      // 脚本第三条**故意**留着一个能回答的文本：如果循环没停在提案上，
      // 它会消费第三条并继续 —— 请求数会变成 3，断言立刻抓到。
      { kind: 'text', text: '我还想再问一句' },
    ]);

    const outcome = await requestAssistantTurn(
      { text: '看完再帮我建一条买咖啡' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-and-propose',
        localize: LOCALIZE_ZH,
        host,
        routed: { fetchImpl: impl },
      },
    );

    expect(calls.length).toBe(2);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'executed') return;
    expect(outcome.proposal.intent).toEqual({ action: 'create-task', title: '买咖啡' });
    expect(outcome.stopsHere).toBe(true);
    expect(outcome.result).toEqual({ ok: true, taskId: 'created-1' });
    expect(host.submits).toBe(1);
    expect(outcome.steps.map((s) => s.kind)).toEqual(['read', 'write']);
  });

  it('模型要批量完成 ⇒ 保留提案并停，不能自动写入', async () => {
    const host = fakeHost();
    const { impl, calls } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'complete_task', args: '{"taskIds":["t1","t2"]}' },
    ]);
    const outcome = await requestAssistantTurn(
      { text: '把两条任务都完成' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-and-propose',
        localize: LOCALIZE_ZH,
        host,
        executionId: 'assistant-risky-batch',
        routed: { fetchImpl: impl },
      },
    );
    expect(calls.length).toBe(1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'proposal') return;
    expect(outcome.proposal.intent).toEqual({ action: 'complete-tasks', taskIds: ['t1', 't2'] });
    expect(host.submits).toBe(0);
  });

  it('`read-only` 档里写工具**根本不在模型看得见的集合里**', async () => {
    const host = fakeHost();
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '我只能读' }]);
    await requestAssistantTurn(
      { text: '帮我建一条' },
      { routing: routing(LOCAL), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } },
    );
    const tools = (calls[0]?.body['tools'] ?? []) as readonly { function?: { name: string } }[];
    const names = tools.map((t) => t.function?.name ?? '');
    expect(names).toContain('list_tasks');
    expect(names).not.toContain('create_task');
    expect(names).not.toContain('complete_task');
  });

  it('一次要求两个工具 ⇒ 回问，不挑一个执行、更不全都执行', async () => {
    const host = fakeHost(TASKS, PROJECTS);
    const { impl, calls } = scriptedFetch([
      {
        kind: 'calls',
        calls: [
          { id: 'c1', name: 'list_tasks', args: '{}' },
          { id: 'c2', name: 'list_projects', args: '{}' },
        ],
      },
    ]);
    const outcome = await requestAssistantTurn(
      { text: '把任务与清单都列一下' },
      { routing: routing(LOCAL), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } },
    );
    expect(calls.length).toBe(1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('multiple-tool-calls');
    expect(host.submits).toBe(0);
  });
});

describe('🔴 出境披露：循环前一次算完，越界就停', () => {
  it('未授权时那句拒绝里**列出了工具结果的字段名**', async () => {
    // ⚠️ 这句**必须挑一条规则都不命中的**说法。原先用的是「列一下任务」，
    // 而"规则先跑、命中即零外发"落地之后，那句话在本机就答完了、**根本不会**
    // 走到出境闸门 —— 用例测的仍然是闸门（没发请求、拒绝里列出字段名），
    // 只是输入必须落在"闸门可达"的那一侧。换成 `rules: []` 也能过，但那是
    // 造假一个生产里不存在的配置（见文件尾那条对照用例）。
    const host = fakeHost(TASKS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '不该走到这里' }]);
    const outcome = await requestAssistantTurn(
      { text: '我都有些啥？' },
      { routing: routing(REMOTE), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } },
    );
    // 一次请求都不发（出境闸门在网路之前）。
    expect(calls.length).toBe(0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.cause).toBe('egress-not-authorized');
    // 🔴 这句话就是用户的同意界面。它必须说出"批准后什么会被发出去"，
    // 而多步循环里那里面**包含工具观察结果** —— 不是只有"你的那句话"。
    for (const field of ['task.title', 'task.dueDate', 'task.body', 'project.name', 'tools']) {
      expect(outcome.message).toContain(field);
    }
  });

  it('两档的**出境字段集合相同**，差别全在模型看得见哪些工具', () => {
    // 这不是"顺手放宽"，是从形状推出来的：写工具的结果**不回送模型**
    // （循环在提案那一刻就停了），所以它对 `fields` 的贡献是空集。
    // ⚠️ 如果将来写工具开始把执行结果回送（比如做多步写），这条必须变红，
    //    而那时正确的修法是在目录里给它补 `egressFields` —— 不是改这条断言。
    expect(assistantEgressFields('read-and-propose')).toEqual(assistantEgressFields('read-only'));
    expect(assistantEgressFields('read-only')).toContain('task.body');
    expect(planAssistantEgress('read-only').tools).not.toContain('create_task');
    expect(planAssistantEgress('read-and-propose').tools).toContain('create_task');
  });

  it('计划里的上界就是从常量推导的（不是另写一个数）', () => {
    const plan = planAssistantEgress('read-only');
    expect(plan.maxRequests).toBe(MAX_ASSISTANT_TOOL_STEPS + 1);
    // ⚠️ 12 = 目录**当前**的读工具条数（上面那 10 条 + W10 的 `list_events` /
    // `get_event`，2026-10-03 合流进 pack 目录之后）。
    // 写成 `LOCAL_API_TOOLS.filter(…)` 的长度就是拿被验的那份推导去当期望值 —— 一条永真判据。
    expect(plan.tools.length).toBe(13);
    // 🔴 这句以前写的是 `toBe(3)` —— 一个**手抄的**读工具数。W10 给目录加了
    // `list_events` / `get_event`，那条硬编码会红，而红的原因不是缺陷。
    // 正确形状与这条用例的标题同义：**从常量推导**，即"读-only 档 = 目录里全部读工具"。
    // 前提由下面那条 `>= 3` 兜住（目录萎缩到比已知基线还小时要有声音）。
    expect(plan.tools).toEqual(LOCAL_API_TOOLS.filter((t) => t.kind === 'read').map((t) => t.name));
    expect(plan.tools.length).toBeGreaterThanOrEqual(3);
    expect(plan.fields).toEqual(assistantEgressFields('read-only'));
  });

  it('🔴 观察结果里有**声明外**的字段 ⇒ 停，且那一步没发出去', async () => {
    // 宿主多回一个目录里没声明的字段（= 投影层将来改了、声明没跟上）。
    const leaky = {
      ...fakeHost(),
      listProjects: (): Promise<readonly LocalApiProject[]> =>
        Promise.resolve([{ id: 'p1', name: '工作', taskCount: 2, secretOwnerPhone: '13800000000' }]),
    };
    const { impl, calls } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'list_projects', args: '{}' },
      { kind: 'text', text: '如果看到这条就说明越界的数据被发出去了' },
    ]);
    const outcome = await requestAssistantTurn(
      { text: '列清单' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host: leaky as unknown as LocalApiHost,
        routed: { fetchImpl: impl },
      },
    );
    expect(calls.length).toBe(1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('egress-outside-disclosed-set');
    expect(outcome.outsideFields).toEqual(['secretOwnerPhone']);
    // 越界字段一个字节都没出去。
    expect(JSON.stringify(calls[0]?.body)).not.toContain('secretOwnerPhone');
  });

  it('observedFieldNames 一层与包装层都收（否则 `{task:{…}}` 会漏检）', () => {
    expect(observedFieldNames([{ id: 't1', title: 'x' }])).toEqual(['id', 'title']);
    expect(observedFieldNames({ task: { id: 't1', note: 'n' } })).toEqual(['id', 'note', 'task']);
    expect(observedFieldNames('不是对象')).toEqual([]);
  });
});

describe('🔴 三个硬上界：触顶要明说，不许静默截断', () => {
  it('消息数超上界 ⇒ 停，且**一次请求都没发**', async () => {
    const host = fakeHost(TASKS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '不该发' }]);
    const history = Array.from({ length: MAX_ASSISTANT_MESSAGES }, (_unused, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `第 ${String(i)} 条`,
    }));
    const outcome = await requestAssistantTurn(
      { text: '继续' },
      { routing: routing(LOCAL), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, history, routed: { fetchImpl: impl } },
    );
    expect(calls.length).toBe(0);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'stopped') return;
    expect(outcome.limit).toBe('messages');
    expect(outcome.text).toContain(String(MAX_ASSISTANT_MESSAGES));
  });

  it('单步出境字节超上界 ⇒ 停，且越界那段没发出去', async () => {
    // ⚠️ 必须走 `get_task`：`list_tasks` 的投影**不返回备注正文**，
    // 拿它做超字节实验会"根本没超"而被当成判据通过（探针空转的老形状）。
    const huge = 'x'.repeat(300_000);
    // ⚠️ 正文字段叫 `body`（`LocalApiItem.body`），不叫 `note` ——
    // 写错字段名的话这条会变成"观察结果里根本没有大段内容"，判据空转而全绿。
    const host = fakeHost([{ id: 't1', title: '大', body: huge, readable: true }]);
    const { impl, calls } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'get_task', args: '{"taskId":"t1"}' },
      { kind: 'text', text: '不该发' },
    ]);
    const outcome = await requestAssistantTurn(
      { text: '看看那条大任务' },
      { routing: routing(LOCAL), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'stopped') return;
    expect(outcome.limit).toBe('egress-bytes');
    // 第一次请求发了（它没超），超界的那一次**没发**。
    expect(calls.length).toBe(1);
    expect(JSON.stringify(calls[0]?.body)).not.toContain(huge);
  });

  it('空输入 / 超长输入在出境之前就被拒', async () => {
    const host = fakeHost();
    const { impl, calls } = scriptedFetch([]);
    const deps = { routing: routing(LOCAL), consents: [], tier: 'read-only' as const, localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } };
    const empty = await requestAssistantTurn({ text: '   ' }, deps);
    expect(empty.ok).toBe(false);
    const long = await requestAssistantTurn({ text: '字'.repeat(600) }, deps);
    expect(long.ok).toBe(false);
    if (long.ok) return;
    expect(long.reason).toBe('text-too-long');
    expect(calls.length).toBe(0);
  });
});

describe('授权前端有两个，判断只有一个', () => {
  it('`assistantGrants` 由**目录**推导，不是一份手写的名单', () => {
    const grants = assistantGrants('read-only');
    // ⚠️ 下面这 27 个名字是**目录当前的内容**（W11 补齐任务清单工具 + W10 的 EVENT
    // 四条进 pack 目录），不是一份"允许清单"：
    // 判据是"键集合 == 目录"，所以目录扩了就必须跟着列全 ——
    // 把它换成 `LOCAL_API_TOOLS.map(...)` 会让这条断言变成自己比自己的**永真判据**。
    expect(Object.keys(grants).sort()).toEqual(
      [
        'append_task_checklist',
        'complete_task',
        'create_habit',
        'create_note',
        'create_project',
        'create_event',
        'create_reminder',
        'create_tag',
        'create_task',
        'get_event',
        'get_note',
        'get_task',
        'get_task_estimate_context',
        'list_checkins',
        'list_events',
        'list_focuses',
        'list_habits',
        'list_notes',
        'list_projects',
        'list_reminders',
        'list_tags',
        'list_tasks',
        'log_focus',
        'record_checkin',
        'set_task_estimate',
        'set_task_tags',
        'set_task_priorities',
        'update_event',
        'update_note',
        'update_task',
      ].sort(),
    );
    // 🔴 判据与这条用例的标题对齐：名单**由目录推导**，不是手抄一份工具名。
    // 手抄的那版在 W10 目录扩到 10 条时红了 —— 而那一次红没有任何信息量。
    expect(Object.keys(grants).sort()).toEqual(LOCAL_API_TOOLS.map((t) => t.name).sort());
    expect(LOCAL_API_TOOLS.length).toBeGreaterThanOrEqual(10);
    expect(grants['list_tasks']).toBe(true);
    expect(grants['create_task']).toBe(false);
    expect(assistantGrants('read-and-propose')['create_task']).toBe(true);
  });

  it('🔴 授权检查仍然只有 `@heyta/local-api` 那一份：越权工具走 denied 分支', async () => {
    // 助手两档都不产生"未授权"（档位就是全开），所以这里直接验循环**没有**自己写判断：
    // 用一个不在档位集合里的工具名，`runSelectedTool` 里的 `isToolGranted` 必须拦住。
    const host = fakeHost();
    // 脚本按上界给满：每次越权调用都走 `denied` 分支回送模型，
    // 循环必须一直走到上界才停 —— 少一步就说明有某处"自己决定不再问了"。
    const replies: Reply[] = Array.from({ length: MAX_ASSISTANT_TOOL_STEPS }, (_unused, i) => ({
      kind: 'call' as const,
      id: `c${String(i)}`,
      name: 'create_task',
      args: '{"title":"越权"}',
    }));
    const { impl, calls } = scriptedFetch(replies);
    const outcome = await requestAssistantTurn(
      { text: '建一条' },
      { routing: routing(LOCAL), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } },
    );
    expect(calls.length).toBe(MAX_ASSISTANT_TOOL_STEPS);
    // 🔴 核心那条：越权调用**一次都没落成库**。
    expect(host.submits).toBe(0);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'stopped') return;
    expect(outcome.limit).toBe('tool-steps');
    expect(outcome.steps.every((step) => !step.ok)).toBe(true);
    expect(outcome.steps.every((step) => step.tool === 'create_task')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// W4：日历锚点。判据本体在 `calendar-anchor.spec.ts`（时区表驱动），
// 这一节只管**接线**：锚点真进了发出去的请求体，且它在出境声明里。
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 助手知道"今天"是哪天，而且这件事说过', () => {
  const NOW = Date.parse('2026-03-14T23:30:00Z');

  it('两档的出境字段都含 `today`（注入进提示词的东西必须披露）', () => {
    for (const tier of ['read-only', 'read-and-propose'] as const) {
      expect(assistantEgressFields(tier), `${tier} 档没声明 today`).toContain('today');
      expect(planAssistantEgress(tier).fields, `${tier} 档的披露计划里没有 today`).toContain('today');
    }
  });

  it('实际发出去的请求体里，`system` 那条**逐字等于** `assistantSystemPrompt(now)`', async () => {
    const host = fakeHost(TASKS, PROJECTS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '一条：买牛奶' }]);
    await requestAssistantTurn(
      // ⚠️ 用「我都有些啥？」而不是「今天有什么任务」：后者从 2026-10-05 起
      // **在本机就答完了**（规则短路，零请求），而这条用例要盯的是"真发出去的那段
      // 请求体里锚点在不在"。句子必须落在会出境的那一侧，否则这条断言会退化成
      // `calls[0]` 不存在时的一句空话（`?.` 链拿到 undefined，`toBe` 照样比得过）。
      { text: '我都有些啥？' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host,
        routed: { fetchImpl: impl },
        now: NOW,
      },
    );
    const system = calls[0]?.messages[0]?.['content'];
    expect(system, 'messages[0] 不是系统提示').toBe(assistantSystemPrompt(NOW));
    // 不依赖进程时区的两条：锚点在，且带偏移（模型要靠它把"今晚八点"写成对的时刻）。
    expect(String(system)).toContain('今天是：');
    expect(String(system)).toMatch(/UTC[+-]\d{2}:\d{2}/u);
  });

  it('🔴 锚点**一轮算一次**：时钟每被读一次就走一天，两步循环的两次请求仍带着同一个锚点', async () => {
    // 实现若在每一步重算锚点，这两次请求的 `system` 就会差一天 —— 而那是
    // "同一条消息数组里并存两种今天"，模型看到的上下文自相矛盾。
    // 注入 `now` 的写法测不到这件事（它本来就只有一个值），所以这里**故意不注入**，
    // 改把 `Date.now` 换成"每读一次跨一天"的桩。
    const realNow = Date.now;
    let reads = 0;
    Date.now = () => realNow() + (reads += 1) * 86_400_000;
    try {
      const host = fakeHost(TASKS, PROJECTS);
      const { impl, calls } = scriptedFetch([
        { kind: 'call', id: 'c1', name: 'list_projects', args: '{}' },
        { kind: 'text', text: '一个清单。' },
      ]);
      await requestAssistantTurn(
        { text: '我都有些啥？' },
        { routing: routing(LOCAL), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } },
      );
      expect(calls.length).toBe(2);
      const first = String(calls[0]?.messages[0]?.['content'] ?? '');
      const second = String(calls[1]?.messages[0]?.['content'] ?? '');
      expect(first).not.toBe('');
      expect(second, '第二步的系统提示与第一步不同 ⇒ 锚点是逐步重算的').toBe(first);
    } finally {
      Date.now = realNow;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 规则先跑：命中即**零外发**（2026-10-05）
//
// 这一组的全部价值在**数请求**上：一个"报告说没发、其实发了"的实现，
// 看返回值看不出来（文件头那条老纪律）。所以每条都把 `calls.length` 钉成 0，
// 并把 `rules: []` 的对照臂放在旁边 —— 没有对照臂，"0 次请求"可能只是因为
// 闸门把请求拦下了（那也是 0），而不是因为根本没打算发。
// ─────────────────────────────────────────────────────────────────────────

describe('规则先跑、命中即零外发', () => {
  it('「列一下任务」本机就答得出 ⇒ 一次请求都不发，答的是本机读到的内容', async () => {
    const host = fakeHost(TASKS, PROJECTS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '端点不该被用到' }]);

    const outcome = await requestAssistantTurn(
      { text: '列一下任务' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host,
        routed: { fetchImpl: impl },
      },
    );

    expect(calls.length, '规则命中了却还是给端点发了请求').toBe(0);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    if (outcome.kind !== 'answer') throw new Error('本机短路期望 answer，实得 ' + outcome.kind);
    expect(outcome.destination).toBe('none');
    expect(outcome.steps).toEqual([{ tool: 'list_tasks', kind: 'read', ok: true }]);
    // 答的是**真读到的东西**，不是"我帮你查了"这种空话。
    expect(outcome.text).toContain('买牛奶');
    expect(host.submits).toBe(0);
  });

  it('🔴 本机查到**空集合**时也要零出境：空是一个真答案', async () => {
    // 夹具里一台空的宿主：`list_projects` 查到 0 条。这时如果退回模型，
    // 就是"为一句『你还没有清单』花一次请求"，而模型手里唯一的真信息
    // 还是我们自己刚查出来的那个 0。
    const host = fakeHost([], []);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '端点不该被用到' }]);
    const outcome = await requestAssistantTurn(
      { text: '列一下清单' },
      { routing: routing(LOCAL), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } },
    );
    expect(calls.length).toBe(0);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.text).toBe('没有符合条件的内容。');
  });

  it('🔴 同一句话连**出境授权都没有**时也不再拦用户：本机能答的就不需要批准', async () => {
    // 这条是产品意义上的差别：以前"未授权 ⇒ 拒绝"，现在"未授权 ⇒ 照样能答，
    // 因为一个字都没出去"。少这一条，实现可以退回"先要授权再说话"而全绿。
    const host = fakeHost(TASKS, PROJECTS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '不该走到这里' }]);
    const outcome = await requestAssistantTurn(
      { text: '列一下任务' },
      { routing: routing(REMOTE), consents: [], tier: 'read-only', localize: LOCALIZE_ZH, host, routed: { fetchImpl: impl } },
    );
    expect(calls.length).toBe(0);
    expect(outcome.ok).toBe(true);
  });

  it('对照臂：把规则集清空（`rules: []`）⇒ 同一句话照旧出境', async () => {
    // 🔴 这条断言的是**上面四条为什么是 0**。没有它，"0 次请求"和"闸门拦住了"
    // 在测试里长得一模一样 —— 而那正是本仓库反复踩过的"一条永远通过的判据"。
    // ⚠️ 目的地这一半**必须用远端端点 + 已授权**来比：本机端点的目的地本来就是
    // `none`（明文没离开设备），拿它当"出境了"的证据会得到一个恒假的比较。
    const host = fakeHost(TASKS, PROJECTS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '端点替我答' }]);
    const outcome = await requestAssistantTurn(
      { text: '列一下任务' },
      {
        routing: routing(REMOTE),
        consents: READ_ONLY_CONSENT,
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host,
        routed: { fetchImpl: impl },
        rules: [],
      },
    );
    expect(calls.length).toBe(1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    if (outcome.kind !== 'answer') throw new Error('对照臂期望 answer，实得 ' + outcome.kind);
    expect(outcome.destination).toBe('user-endpoint');
  });

  it('对照臂的另一半：同一句远端出境的话，规则命中时是 0 次、目的地是 none', async () => {
    // 与上一条**只差 `rules` 一项**，其余逐字相同 —— 这才是"短路"二字的对照，
    // 而不是"本机 vs 远端"两个变量混在一起。
    const host = fakeHost(TASKS, PROJECTS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '端点替我答' }]);
    const outcome = await requestAssistantTurn(
      { text: '列一下任务' },
      {
        routing: routing(REMOTE),
        consents: READ_ONLY_CONSENT,
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host,
        routed: { fetchImpl: impl },
      },
    );
    expect(calls.length).toBe(0);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    if (outcome.kind !== 'answer') throw new Error('短路那一半期望 answer，实得 ' + outcome.kind);
    expect(outcome.destination).toBe('none');
  });

  it('低风险写意图的规则命中 ⇒ 自动执行 + 零请求 + 只提交一次', async () => {
    const host = fakeHost(TASKS, PROJECTS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '端点不该被用到' }]);
    const outcome = await requestAssistantTurn(
      { text: '新建任务「买咖啡」' },
      {
        routing: routing(REMOTE),
        consents: [],
        tier: 'read-and-propose',
        localize: LOCALIZE_ZH,
        host,
        routed: { fetchImpl: impl },
        rules: [
          {
            id: 'test.create-task',
            tool: 'create_task',
            pattern: /新建任务「(.+)」/,
            args: (match) => ({ title: match[1] }),
          },
        ],
      },
    );
    expect(calls.length).toBe(0);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;
    expect(outcome.destination).toBe('none');
    expect(outcome.stopsHere).toBe(true);
    expect(host.submits).toBe(1);
  });

  it('低档（read-only）下写规则**不该**命中：授权范围先于规则', async () => {
    // 规则命中了 `create_task`，但这个档位没授权它 ⇒ 走模型（它会看到空写工具集）。
    // 这条钉的是"短路不许绕过第二授权前端"。
    const host = fakeHost(TASKS, PROJECTS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '这个我做不了' }]);
    const outcome = await requestAssistantTurn(
      { text: '新建任务「买咖啡」' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host,
        routed: { fetchImpl: impl },
        rules: [
          {
            id: 'test.create-task',
            tool: 'create_task',
            pattern: /新建任务「(.+)」/,
            args: (match) => ({ title: match[1] }),
          },
        ],
      },
    );
    expect(host.submits).toBe(0);
    expect(outcome.ok).toBe(true);
    // 请求发出去了（= 没被短路成写提案），而且没有落库。
    expect(calls.length).toBe(1);
  });

  it('🔴 观察结果渲染不出人话时**不硬编**，退回模型那一步', async () => {
    // `get_task` 的观察结果是一个**单对象**（没有数组），`localObservationText`
    // 按形状拿不到"若干项"，于是必须 fall through —— 而不是编一句"我查到了"。
    const host = fakeHost(TASKS, PROJECTS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '那条是买牛奶' }]);
    const outcome = await requestAssistantTurn(
      { text: '看那条' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host,
        routed: { fetchImpl: impl },
        rules: [
          {
            id: 'test.get-one',
            tool: 'get_task',
            pattern: /看那条/,
            args: () => ({ taskId: 't1' }),
          },
        ],
      },
    );
    expect(calls.length, '单对象观察结果被硬编成了一句本机回答').toBe(1);
    expect(outcome.ok).toBe(true);
  });
});

describe('本机回答的渲染形状', () => {
  it('数组直接渲染', () => {
    const text = localObservationText('list_tasks', [{ title: '买牛奶' }, { title: '写周报' }], LOCALIZE_ZH);
    expect(text).toContain('我找到 2 项：');
    expect(text).toContain('- 买牛奶');
    expect(text).toContain('- 写周报');
  });

  it('投影常见的包装形状（`{ tasks: [...] }`）也认', () => {
    expect(localObservationText('list_tasks', { tasks: [{ title: '买牛奶' }] }, LOCALIZE_ZH)).toContain('- 买牛奶');
  });

  it('再往里一层（`{ task: { title } }` 的每一项）认得出来', () => {
    expect(localObservationText('list_tasks', [{ task: { title: '买牛奶' } }], LOCALIZE_ZH)).toContain('- 买牛奶');
  });

  it('空集合答"0 项"；拿不到数组的才返回 undefined（不硬编一句回答）', () => {
    expect(localObservationText('list_tasks', [], LOCALIZE_ZH)).toBe('没有符合条件的内容。');
    expect(localObservationText('list_tasks', { tasks: [] }, LOCALIZE_ZH)).toBe('没有符合条件的内容。');
    expect(localObservationText('get_task', { task: { title: '买牛奶' } }, LOCALIZE_ZH)).toBeUndefined();
    expect(localObservationText('list_tasks', [{ dueDate: 'x', priority: 'high' }], LOCALIZE_ZH)).toBeUndefined();
    expect(localObservationText('list_tasks', '一串字', LOCALIZE_ZH)).toBeUndefined();
    // 🔴 这条是"部分可渲染也不许装作全渲染完了"：缺字的那一项明说没标题，
    // 而不是被 filter 掉（那样条数就和内容对不上了）。
    const partial = localObservationText('list_tasks', [{ title: '买牛奶' }, { dueDate: 'x' }], LOCALIZE_ZH);
    expect(partial).toContain('我找到 2 项：');
    expect(partial).toContain('（未命名）');
  });

  it('超过上界要**明说**还剩几条没列出', () => {
    const many = Array.from({ length: LOCAL_ANSWER_MAX_ITEMS + 3 }, (_unused, i) => ({
      title: `任务 ${String(i + 1)}`,
    }));
    const text = localObservationText('list_tasks', many, LOCALIZE_ZH);
    expect(text).toContain(`我找到 ${String(many.length)} 项：`);
    expect(text).toContain('还有 3 项未列出。');
    // 列出的行数就是上界那一个数（`split` 的第一段是"共 N 项："那一行）。
    expect(text?.split('\n- ').length).toBe(LOCAL_ANSWER_MAX_ITEMS + 1);
  });

  it('英文界面使用英文词条，且不把工具名或本机链路塞进正文', () => {
    const text = localObservationText('list_tasks', [{ title: 'Buy milk' }], LOCALIZE_EN);
    expect(text).toBe('Found 1:\n- Buy milk');
    expect(localObservationText('list_tasks', [], LOCALIZE_EN)).toBe('I found no matching items.');
    expect(text).not.toContain('list_tasks');
    expect(text).not.toContain('device');
    expect(text).not.toContain('request');
  });
});
