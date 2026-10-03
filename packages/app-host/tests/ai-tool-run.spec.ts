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

import type { LocalApiHabit, LocalApiHost, LocalApiItem, LocalApiProject } from '@heyta/local-api';

import { confirmAiToolProposal, runSelectedTool } from '../src/ai-tool-run.js';
import {
  resolveToolSelection,
  type ToolSelectionRule,
} from '../src/ai-tool-selection.js';

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

    const result = await confirmAiToolProposal(host, outcome.proposal);
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
