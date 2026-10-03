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
import type { LocalApiHabit, LocalApiHost, LocalApiItem, LocalApiProject } from '@heyta/local-api';
import { LOCAL_API_TOOLS } from '@heyta/local-api';
import type { LocalApiHost, LocalApiItem, LocalApiProject } from '@heyta/local-api';

import {
  assistantEgressFields,
  assistantGrants,
  assistantSystemPrompt,
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
      { routing: routing(LOCAL), consents: [], tier: 'read-only', host, routed: { fetchImpl: impl } },
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
      { routing: routing(LOCAL), consents: [], tier: 'read-only', host, routed: { fetchImpl: impl } },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'answer') return;
    expect(outcome.steps).toEqual([{ tool: 'get_task', kind: 'read', ok: true }]);
    expect(calls[1]?.messages.some((m) => String(m['content'] ?? '').includes('没有'))).toBe(true);
    expect(host.submits).toBe(0);
  });
});

describe('🔴 写：一次一个、一次确认', () => {
  it('模型要写 ⇒ 产出提案并**停**，第二次请求根本没发', async () => {
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
        host,
        routed: { fetchImpl: impl },
      },
    );

    expect(calls.length).toBe(2);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'proposal') return;
    expect(outcome.proposal.intent).toEqual({ action: 'create-task', title: '买咖啡' });
    expect(outcome.stopsHere).toBe(true);
    // 🔴 确认之前不许写：数调用，不看返回值。
    expect(host.submits).toBe(0);
    expect(outcome.steps.map((s) => s.kind)).toEqual(['read', 'write']);
  });

  it('`read-only` 档里写工具**根本不在模型看得见的集合里**', async () => {
    const host = fakeHost();
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '我只能读' }]);
    await requestAssistantTurn(
      { text: '帮我建一条' },
      { routing: routing(LOCAL), consents: [], tier: 'read-only', host, routed: { fetchImpl: impl } },
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
      { routing: routing(LOCAL), consents: [], tier: 'read-only', host, routed: { fetchImpl: impl } },
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
    const host = fakeHost(TASKS);
    const { impl, calls } = scriptedFetch([{ kind: 'text', text: '不该走到这里' }]);
    const outcome = await requestAssistantTurn(
      { text: '列一下任务' },
      { routing: routing(REMOTE), consents: [], tier: 'read-only', host, routed: { fetchImpl: impl } },
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
    // ⚠️ 10 = 目录**当前**的读工具条数（`list_tasks` / `get_task` / `list_projects` /
    // `list_habits` / `list_tags` / `list_notes` / `get_note` / `list_checkins` /
    // `list_focuses` / `list_reminders`，2026-10-03 补齐六个实体工具之后）。
    // 写成 `LOCAL_API_TOOLS.filter(…)` 的长度就是拿被验的那份推导去当期望值 —— 一条永真判据。
    expect(plan.tools.length).toBe(10);
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
      { routing: routing(LOCAL), consents: [], tier: 'read-only', host, history, routed: { fetchImpl: impl } },
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
      { routing: routing(LOCAL), consents: [], tier: 'read-only', host, routed: { fetchImpl: impl } },
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
    const deps = { routing: routing(LOCAL), consents: [], tier: 'read-only' as const, host, routed: { fetchImpl: impl } };
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
    // ⚠️ 下面这 22 个名字是**目录当前的内容**（2026-10-03 补齐 TAG / NOTE / HABIT_LOG /
    // FOCUS_SESSION / REMINDER 之后；此前是 9 个），不是一份"允许清单"：
    // 判据是"键集合 == 目录"，所以目录扩了就必须跟着列全 ——
    // 把它换成 `LOCAL_API_TOOLS.map(...)` 会让这条断言变成自己比自己的**永真判据**。
    expect(Object.keys(grants).sort()).toEqual(
      [
        'complete_task',
        'create_habit',
        'create_note',
        'create_project',
        'create_reminder',
        'create_tag',
        'create_task',
        'get_note',
        'get_task',
        'list_checkins',
        'list_focuses',
        'list_habits',
        'list_notes',
        'list_projects',
        'list_reminders',
        'list_tags',
        'list_tasks',
        'log_focus',
        'record_checkin',
        'set_task_tags',
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
      { routing: routing(LOCAL), consents: [], tier: 'read-only', host, routed: { fetchImpl: impl } },
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
      { text: '今天有什么任务' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
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
        { routing: routing(LOCAL), consents: [], tier: 'read-only', host, routed: { fetchImpl: impl } },
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
