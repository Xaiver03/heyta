/**
 * AI 工具执行测试
 * ==================
 *
 * 🔴🔴 本文件最重要的一条**不是断言返回值，而是数 `submit` 被调了几次**：
 * 跑完所有只读与提案路径之后必须是 **0**。一个"报告说没写、其实写了"的实现，
 * 只看返回值是抓不到的。确认之后才允许是 1。
 *
 * 其余三条：
 *   1. 🔴 受保护条目在 **AI 路径上**同样只出元数据（与 MCP 侧逐字相同）。
 *   2. 🔴 "选择到执行之间被撤销授权"要被执行前复查拦住（两闸不是冗余）。
 *   3. 🔴 参数不合法就失败，不拿空参数去调宿主。
 */

import { describe, expect, it } from 'vitest';

import type {
  LocalApiEventItem,
  LocalApiHabit,
  LocalApiHost,
  LocalApiItem,
  LocalApiProject,
} from '@heyta/local-api';

import {
  aiToolProposalRequiresConfirmation,
  confirmAiToolProposal,
  executeAiToolProposal,
  runSelectedTool,
  type AiToolProposal,
} from '../src/ai-tool-run.js';
import {
  resolveToolSelection,
  type ToolSelectionRule,
} from '../src/ai-tool-selection.js';

const authorization = (tool: string) => ({ getGrants: () => ({ [tool]: true }) });

/** 会记账的假宿主。`submits` 就是本文件的核心断言对象。 */
function fakeHost(items: readonly LocalApiItem[] = []): LocalApiHost & { submits: number } {
  const host = {
    submits: 0,
    listTasks: (): Promise<readonly LocalApiItem[]> => Promise.resolve(items),
    getTask: (taskId: string): Promise<LocalApiItem | undefined> =>
      Promise.resolve(items.find((x) => x.id === taskId)),
    listProjects: (): Promise<readonly LocalApiProject[]> =>
      Promise.resolve([{ id: 'p1', name: '工作', taskCount: 2 }]),
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

const READ_GRANTS = { list_tasks: true, get_task: true, list_projects: true } as const;

const CREATE_RULE: ToolSelectionRule = {
  id: 'create.basic',
  tool: 'create_task',
  pattern: /^记一下\s*(.+)$/,
  args: (m) => {
    const title = m[1]?.trim();
    return title === undefined || title === '' ? undefined : { title };
  },
};

/**
 * 测试本地的"规则 → 执行"组合。
 *
 * 🔴 它**不是**产品里的一个前门 —— `packages/app-host` 里原来有一个
 * （`runAiTool()`），零生产调用点，界面走的是 `requestToolCall`（模型前门）与
 * `resolveToolSelection`（规则前门）那两条。2026-10-03 把那个冗余前门删掉了
 * （工单 W7），本文件对它的 8 处调用改成这个**局部**组合：
 * 断言一条没动，只是不再经由一个产品里不该存在的名字。
 *
 * ⚠️ 放在测试文件里而不是再抽回产品层，是因为"text → 执行一步"这件事在**产品**里
 * 已经有两份实现了（`requestToolCall` 的规则分支就是它）。再来第三份就是下一个漂移。
 */
async function runThroughRules(
  text: string,
  deps: { host: LocalApiHost; grants: Record<string, boolean>; rules?: readonly ToolSelectionRule[] },
) {
  const selection = resolveToolSelection(text, {
    grants: deps.grants,
    ...(deps.rules === undefined ? {} : { rules: deps.rules }),
  });
  return runSelectedTool(selection, deps);
}

describe('规则 → 执行（只读）', () => {
  it('列出任务 → observation，且**一次都没写**', async () => {
    const host = fakeHost([{ id: 't1', title: '买牛奶', readable: true }]);
    const outcome = await runThroughRules('列出所有任务', { host, grants: READ_GRANTS });
    expect(outcome.kind).toBe('observation');
    if (outcome.kind !== 'observation') return;
    expect(outcome.tool).toBe('list_tasks');
    expect(host.submits).toBe(0);
  });

  it('🔴 受保护条目在 AI 路径上也只出元数据', async () => {
    const host = fakeHost([
      { id: 't1', title: '公开的', body: '正文', readable: true },
      { id: 't2', title: '受保护的', body: '机密正文', readable: false },
    ]);
    const outcome = await runThroughRules('列出所有任务', { host, grants: READ_GRANTS });
    expect(outcome.kind).toBe('observation');
    if (outcome.kind !== 'observation') return;
    const rows = outcome.data as readonly LocalApiItem[];
    const protectedRow = rows.find((r) => r.id === 't2');
    expect(protectedRow?.title).toBe('受保护的');
    // 白名单重建：正文**不出现**，元数据保留。
    expect(protectedRow?.body).toBeUndefined();
    expect(host.submits).toBe(0);
  });

  it('get_task 读受保护条目 → not-readable（不是空结果）', async () => {
    const host = fakeHost([{ id: 't2', title: '受保护的', body: '机密', readable: false }]);
    const rule: ToolSelectionRule = {
      id: 'get.byId',
      tool: 'get_task',
      pattern: /^任务\s+(\S+)$/,
      args: (m) => (m[1] === undefined ? undefined : { taskId: m[1] }),
    };
    const outcome = await runThroughRules('任务 t2', { host, grants: READ_GRANTS, rules: [rule] });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.reason).toBe('not-readable');
    expect(host.submits).toBe(0);
  });

  it('参数不合法 → invalid-args，不拿空参数去调宿主', async () => {
    const host = fakeHost([{ id: 't1', title: 'x', readable: true }]);
    const emptyArgs: ToolSelectionRule = {
      id: 'get.empty',
      tool: 'get_task',
      pattern: /^随便读一个$/,
      args: () => ({}),
    };
    const outcome = await runThroughRules('随便读一个', {
      host,
      grants: READ_GRANTS,
      rules: [emptyArgs],
    });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.reason).toBe('invalid-args');
  });
});

describe('规则 → 执行（写工具只提案）', () => {
  it('🔴 写工具返回 proposal，**submit 次数为 0**', async () => {
    const host = fakeHost();
    const outcome = await runThroughRules('记一下 买牛奶', {
      host,
      grants: { create_task: true },
      rules: [CREATE_RULE],
    });
    expect(outcome.kind).toBe('proposal');
    if (outcome.kind !== 'proposal') return;
    expect(outcome.proposal.intent).toEqual({ action: 'create-task', title: '买牛奶' });
    expect(host.submits).toBe(0);
  });

  it('🔴 确认之后才落库：submit 次数从 0 变 1', async () => {
    const host = fakeHost();
    const outcome = await runThroughRules('记一下 买牛奶', {
      host,
      grants: { create_task: true },
      rules: [CREATE_RULE],
    });
    expect(outcome.kind).toBe('proposal');
    if (outcome.kind !== 'proposal') return;

    const result = await confirmAiToolProposal(host, outcome.proposal, authorization(outcome.proposal.tool));
    expect(result).toEqual({ ok: true, taskId: 'created-1' });
    expect(host.submits).toBe(1);
  });

  it('写工具参数不合法 → invalid-args（不落到 submit）', async () => {
    const host = fakeHost();
    const emptyTitle: ToolSelectionRule = {
      id: 'create.empty',
      tool: 'create_task',
      pattern: /^新建任务$/,
      args: () => ({ title: '   ' }),
    };
    const outcome = await runThroughRules('新建任务', {
      host,
      grants: { create_task: true },
      rules: [emptyTitle],
    });
    expect(outcome.kind).toBe('failed');
    expect(host.submits).toBe(0);
  });
});

describe('执行档的写风险与重放保护', () => {
  const proposal = (intent: AiToolProposal['intent']): AiToolProposal => ({
    ruleId: 'test',
    tool: intent.action,
    intent,
  });

  it('低风险写意图可自动提交，危险写意图仍要求确认', () => {
    expect(aiToolProposalRequiresConfirmation(proposal({ action: 'create-task', title: '买牛奶' }))).toBe(false);
    expect(aiToolProposalRequiresConfirmation(proposal({ action: 'complete-task', taskId: 't1' }))).toBe(false);
    expect(
      aiToolProposalRequiresConfirmation(
        proposal({ action: 'set-task-tags', taskId: 't1', tagIds: ['important'] }),
      ),
    ).toBe(false);
    expect(
      aiToolProposalRequiresConfirmation(
        proposal({ action: 'complete-tasks', taskIds: ['t1', 't2'] }),
      ),
    ).toBe(true);
    expect(
      aiToolProposalRequiresConfirmation(
        proposal({ action: 'append-task-checklist', taskId: 't1', items: ['准备说明'] }),
      ),
    ).toBe(true);
    expect(
      aiToolProposalRequiresConfirmation(
        proposal({
          action: 'set-task-priorities',
          entries: [{ taskId: 't1', priority: 'high' }],
        }),
      ),
    ).toBe(true);
    expect(
      aiToolProposalRequiresConfirmation(proposal({ action: 'set-task-tags', taskId: 't1', tagIds: [] })),
    ).toBe(true);
    expect(
      aiToolProposalRequiresConfirmation(proposal({ action: 'update-task', taskId: 't1', fields: { title: null } })),
    ).toBe(true);
  });

  it('低风险动作同一执行标识只提交一次，换意图则拒绝', async () => {
    const host = fakeHost();
    const first = proposal({ action: 'create-task', title: '买咖啡' });
    const second = proposal({ action: 'create-task', title: '买茶' });
    const result1 = await executeAiToolProposal(host, first, 'replay-1', authorization(first.tool));
    const result2 = await executeAiToolProposal(host, first, 'replay-1', authorization(first.tool));
    expect(result1).toEqual({ ok: true, taskId: 'created-1' });
    expect(result2).toEqual(result1);
    expect(host.submits).toBe(1);

    const mismatch = await executeAiToolProposal(host, second, 'replay-1', authorization(second.tool));
    expect(mismatch).toEqual({ ok: false, reason: 'invalid', message: '同一执行标识对应了不同的改动。' });
    expect(host.submits).toBe(1);
  });

  it('单条完成是可撤销的日常动作，可在执行档自动提交', async () => {
    const host = fakeHost();
    const result = await executeAiToolProposal(
      host,
      proposal({ action: 'complete-task', taskId: 't1' }),
      'complete-one-1',
      authorization('complete-task'),
    );
    expect(result).toEqual({ ok: true, taskId: 'created-1' });
    expect(host.submits).toBe(1);
  });

  it('高风险批量动作不会绕过确认闸门', async () => {
    const host = fakeHost();
    const result = await executeAiToolProposal(
      host,
      proposal({ action: 'complete-tasks', taskIds: ['t1', 't2'] }),
      'risky-1',
      authorization('complete-tasks'),
    );
    expect(result).toEqual({ ok: false, reason: 'invalid', message: '这项改动需要先确认。' });
    expect(host.submits).toBe(0);
  });

  it('追加清单不会绕过确认闸门', async () => {
    const host = fakeHost();
    const result = await executeAiToolProposal(
      host,
      proposal({ action: 'append-task-checklist', taskId: 't1', items: ['准备说明'] }),
      'checklist-1',
      authorization('append-task-checklist'),
    );
    expect(result).toEqual({ ok: false, reason: 'invalid', message: '这项改动需要先确认。' });
    expect(host.submits).toBe(0);
  });
});

describe('两道闸', () => {
  it('🔴 选择到执行之间撤销授权 → 执行前复查拦住（denied）', async () => {
    // 用 getter 制造"第一次读为 true、第二次读为 false"：
    // 第一次是选择时的候选过滤，第二次是执行前的复查。
    let reads = 0;
    const grants: Record<string, boolean> = {};
    Object.defineProperty(grants, 'list_tasks', {
      enumerable: true,
      configurable: true,
      get: () => {
        reads += 1;
        return reads === 1;
      },
    });

    const host = fakeHost([{ id: 't1', title: 'x', readable: true }]);
    const outcome = await runThroughRules('列出所有任务', { host, grants });
    expect(outcome.kind).toBe('denied');
    if (outcome.kind !== 'denied') return;
    expect(outcome.tool).toBe('list_tasks');
    expect(host.submits).toBe(0);
  });

  it('未授权 → 选择阶段就 no-tool-granted（不到执行）', async () => {
    const host = fakeHost();
    const outcome = await runThroughRules('列出所有任务', { host, grants: {} });
    expect(outcome).toEqual({ kind: 'none', reason: 'no-tool-granted' });
    expect(host.submits).toBe(0);
  });
});

describe('确认闸门的授权与并发', () => {
  const writeProposal = (): AiToolProposal => ({
    ruleId: 'confirm',
    tool: 'create_task',
    intent: { action: 'create-task', title: '买牛奶' },
  });

  it('确认时重新读取 grants，撤销后不提交', async () => {
    const host = fakeHost();
    let grants: Record<string, boolean> = { create_task: true };
    const proposal = writeProposal();
    const result = await confirmAiToolProposal(host, proposal, { getGrants: () => grants });
    expect(result.ok).toBe(true);

    const revokedProposal = writeProposal();
    grants = {};
    const revoked = await confirmAiToolProposal(host, revokedProposal, { getGrants: () => grants });
    expect(revoked).toEqual({ ok: false, reason: 'rejected', message: '工具「create_task」的授权已撤销。' });
    expect(host.submits).toBe(1);
  });

  it('同一个提案并发确认只提交一次，失败后可重试', async () => {
    const base = fakeHost();
    let attempts = 0;
    const host = {
      ...base,
      submit: async () => {
        attempts += 1;
        if (attempts === 1) return { ok: false as const, reason: 'rejected' as const, message: '暂时拒绝' };
        return { ok: true as const, taskId: 'created-2' };
      },
    } satisfies LocalApiHost;
    const proposal = writeProposal();
    const auth = authorization(proposal.tool);
    const [first, second] = await Promise.all([
      confirmAiToolProposal(host, proposal, auth),
      confirmAiToolProposal(host, proposal, auth),
    ]);
    expect(first).toEqual(second);
    expect(attempts).toBe(1);
    const retried = await confirmAiToolProposal(host, proposal, auth);
    expect(retried).toEqual({ ok: true, taskId: 'created-2' });
    expect(attempts).toBe(2);
  });
});

describe('runSelectedTool（直接传入选择结果）', () => {
  it('目录外的工具 → unknown-tool，不猜', async () => {
    const host = fakeHost();
    const outcome = await runSelectedTool(
      { kind: 'tool', ruleId: 'x', tool: 'nonexistent_tool', args: {} },
      { host, grants: { nonexistent_tool: true } },
    );
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.reason).toBe('unknown-tool');
    expect(host.submits).toBe(0);
  });

  it('有歧义的选择直接透传，不执行', async () => {
    const host = fakeHost();
    const outcome = await runSelectedTool(
      { kind: 'ambiguous', candidates: [{ ruleId: 'a', tool: 'list_tasks' }] },
      { host, grants: READ_GRANTS },
    );
    expect(outcome.kind).toBe('ambiguous');
    expect(host.submits).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// W10：倒数日走同一条执行链（**不新增任何执行代码**，只证明它接得上）
// ─────────────────────────────────────────────────────────────────────────

const EVENT_ITEMS: readonly LocalApiEventItem[] = [
  {
    id: 'e1',
    title: '妈妈生日',
    date: '1968-04-12',
    kind: 'birthday',
    nextOccurrence: '2027-04-12',
    daysFromToday: 190,
    repeating: true,
    isLunar: false,
    pinned: false,
    notes: '记得订蛋糕',
    readable: true,
  },
  {
    id: 'e2',
    title: '体检报告',
    date: '2026-11-01',
    kind: 'countdown',
    nextOccurrence: '2026-11-01',
    daysFromToday: 28,
    repeating: false,
    isLunar: false,
    pinned: false,
    notes: '身份证号 110101...',
    readable: false,
  },
];

/**
 * 带倒数日的假宿主。
 *
 * ⚠️ 它**不是** `{ ...fakeHost(), listEvents }`：展开会**复制** `submits` 这个数，
 * 而 `submit` 的闭包仍然去 +1 那个**原对象**上的字段 —— 于是本文件最重的那条
 * 判据（提案阶段 `submits` 必须是 0、确认之后必须是 1）会**永远读到 0**，
 * 一条"根本没写库"的假绿。与 `fakeHost` 一样自引用地建，计数器才在同一个对象上。
 */
function eventHost(): LocalApiHost & { submits: number } {
  const host = {
    submits: 0,
    listTasks: (): Promise<readonly LocalApiItem[]> => Promise.resolve([]),
    getTask: (taskId: string): Promise<LocalApiItem | undefined> =>
      Promise.resolve(UNRELATED_TASKS.find((x) => x.id === taskId)),
    listProjects: (): Promise<readonly LocalApiProject[]> =>
      Promise.resolve([{ id: 'p1', name: '工作', taskCount: 2 }]),
    listHabits: (): Promise<readonly never[]> => Promise.resolve([]),
    listTags: (): Promise<readonly never[]> => Promise.resolve([]),
    listNotes: (): Promise<readonly never[]> => Promise.resolve([]),
    getNote: (): Promise<undefined> => Promise.resolve(undefined),
    listHabitLogs: (): Promise<readonly never[]> => Promise.resolve([]),
    listFocusSessions: (): Promise<readonly never[]> => Promise.resolve([]),
    listReminders: (): Promise<readonly never[]> => Promise.resolve([]),
    listEvents: (): Promise<readonly LocalApiEventItem[]> => Promise.resolve(EVENT_ITEMS),
    getEvent: (eventId: string): Promise<LocalApiEventItem | undefined> =>
      Promise.resolve(EVENT_ITEMS.find((e) => e.id === eventId)),
    submit: (): Promise<{ ok: true; taskId: string }> => {
      host.submits += 1;
      return Promise.resolve({ ok: true, taskId: 'created-1' });
    },
  };
  return host;
}

const UNRELATED_TASKS: readonly LocalApiItem[] = [];

const EVENT_READ_GRANTS = { list_events: true, get_event: true } as const;

describe('倒数日走 AI 执行链（W10）', () => {
  it('规则命中 list_events ⇒ 观察结果，且**一个字节都没写**', async () => {
    const host = eventHost();
    const run = await runThroughRules('看看有哪些倒数日', {
      host,
      grants: { ...EVENT_READ_GRANTS },
    });
    expect(run.kind).toBe('observation');
    if (run.kind !== 'observation') return;
    expect(run.tool).toBe('list_events');
    expect(host.submits).toBe(0);
    // 🔴 与 MCP 侧**逐字相同**的投影：受保护那条只剩元数据、列表里连可读的备注也没有
    const json = JSON.stringify(run.data);
    expect(json).not.toContain('记得订蛋糕');
    expect(json).not.toContain('110101');
    const items = run.data as readonly { id: string; readable: boolean }[];
    expect(items.map((i) => i.id)).toEqual(['e1', 'e2']);
    expect(items[1]?.readable).toBe(false);
  });

  it('get_event 读受保护那条 ⇒ failed/not-readable（与 get_task 同一档处理）', async () => {
    const rule: ToolSelectionRule = { id: 'get.event', tool: 'get_event', pattern: /体检/, args: () => ({ eventId: 'e2' }) };
    const run = await runThroughRules('打开体检那条倒数日', {
      host: eventHost(),
      grants: { get_event: true },
      rules: [rule],
    });
    expect(run.kind).toBe('failed');
    if (run.kind !== 'failed') return;
    expect(run.reason).toBe('not-readable');
    expect(run.message).toContain('受保护');
  });

  it('🔴🔴 create_event 只产出**提案**：`submit` 计数必须是 0，确认之后才是 1', async () => {
    const host = eventHost();
    const rule: ToolSelectionRule = {
      id: 'create.event',
      tool: 'create_event',
      pattern: /倒数日\s*(.+)$/,
      args: () => ({ title: '结婚纪念日', date: '2016-05-01', kind: 'anniversary' }),
    };
    const run = await runThroughRules('倒数日 结婚纪念日', {
      host,
      grants: { create_event: true },
      rules: [rule],
    });
    expect(run.kind).toBe('proposal');
    if (run.kind !== 'proposal') return;
    expect(host.submits).toBe(0);
    expect(run.proposal.intent).toEqual({
      action: 'create-event',
      title: '结婚纪念日',
      date: '2016-05-01',
      kind: 'anniversary',
    });

    // 确认之后才落地，而且**只落一次**
    await confirmAiToolProposal(host, run.proposal, authorization(run.proposal.tool));
    expect(host.submits).toBe(1);
  });

  it('执行前复查对倒数日同样成立：选择之后撤销授权 ⇒ denied', async () => {
    const host = eventHost();
    const selection = resolveToolSelection('看看有哪些倒数日', { grants: EVENT_READ_GRANTS });
    expect(selection.kind).toBe('tool');
    const run = await runSelectedTool(selection, { host, grants: {} });
    expect(run.kind).toBe('denied');
    expect(host.submits).toBe(0);
  });

  it('参数缺 date ⇒ failed/invalid-args，**不拿空参数去调宿主**', async () => {
    const host = eventHost();
    const rule: ToolSelectionRule = {
      id: 'create.event.broken',
      tool: 'create_event',
      pattern: /建个倒数日/,
      args: () => ({ title: '只有标题' }),
    };
    const run = await runThroughRules('建个倒数日', { host, grants: { create_event: true }, rules: [rule] });
    expect(run.kind).toBe('failed');
    if (run.kind !== 'failed') return;
    expect(run.reason).toBe('invalid-args');
    expect(run.message).toContain('date');
    expect(host.submits).toBe(0);
  });
});
