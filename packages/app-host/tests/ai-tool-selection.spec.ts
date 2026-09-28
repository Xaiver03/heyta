/**
 * AI 工具选择测试
 * ==================
 *
 * 这个文件守的是四条**不许被改坏**的规矩：
 *
 *   1. 🔴 **未授权的工具不进入候选** —— 与 `listMcpTools()` 同一条立场。
 *      而且"规则命中但都没授权"必须与"没听懂"分开报（`no-tool-granted` vs `no-match`）。
 *   2. 🔴 **歧义就问，不挑** —— 多条规则命中不同工具时返回 `ambiguous`。
 *   3. 🔴 **不猜参数** —— 规则抽不出参数就丢弃候选，不用空参数硬调。
 *   4. 🔴 **正则无状态** —— 同一个 `Rule` 对象连用两次结果必须一致
 *      （`/g` 正则的 `lastIndex` 泄漏是"第一次对、第二次错"的经典形状）。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOOL_SELECTION_RULES,
  resolveToolSelection,
  type ToolSelectionRule,
} from '../src/ai-tool-selection.js';

const ALL_READ_GRANTS = {
  list_tasks: true,
  get_task: true,
  list_projects: true,
} as const;

describe('resolveToolSelection', () => {
  it('空输入 → empty，不做任何匹配', () => {
    expect(resolveToolSelection('   ', { grants: ALL_READ_GRANTS })).toEqual({
      kind: 'none',
      reason: 'empty',
    });
  });

  it('没听懂 → no-match', () => {
    expect(resolveToolSelection('把这段话翻译成英文', { grants: ALL_READ_GRANTS })).toEqual({
      kind: 'none',
      reason: 'no-match',
    });
  });

  it('命中清单 → list_projects', () => {
    const result = resolveToolSelection('看看我有哪些清单', { grants: ALL_READ_GRANTS });
    expect(result.kind).toBe('tool');
    if (result.kind !== 'tool') return;
    expect(result.tool).toBe('list_projects');
    expect(result.args).toEqual({});
  });

  it('命中今日 → list_tasks', () => {
    const result = resolveToolSelection('今天要做什么？', { grants: ALL_READ_GRANTS });
    expect(result.kind).toBe('tool');
    if (result.kind !== 'tool') return;
    expect(result.tool).toBe('list_tasks');
  });

  it('命中已完成 → list_tasks 带 completed: true', () => {
    const result = resolveToolSelection('我完成了哪些', { grants: ALL_READ_GRANTS });
    expect(result.kind).toBe('tool');
    if (result.kind !== 'tool') return;
    expect(result.args).toEqual({ completed: true });
  });

  it('🔴 多条规则命中不同工具 → ambiguous，且候选去重', () => {
    const result = resolveToolSelection('看看有哪些清单和任务', { grants: ALL_READ_GRANTS });
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    const tools = result.candidates.map((c) => c.tool).sort();
    expect(tools).toEqual(['list_projects', 'list_tasks']);
  });

  it('🔴 命中但未授权 → no-tool-granted（与 no-match 是两种失败）', () => {
    expect(resolveToolSelection('看看我有哪些清单', { grants: {} })).toEqual({
      kind: 'none',
      reason: 'no-tool-granted',
    });
  });

  it('🔴 未授权的工具不进入候选：授权其中一个即可选出', () => {
    const result = resolveToolSelection('看看我有哪些清单和任务', {
      grants: { list_tasks: true },
    });
    // list_projects 未授权被过滤，只剩 list_tasks → 不再是歧义。
    expect(result.kind).toBe('tool');
    if (result.kind !== 'tool') return;
    expect(result.tool).toBe('list_tasks');
  });

  it('🔴 规则里写了目录中没有的工具 → 该候选被丢弃（no-match）', () => {
    const bogus: ToolSelectionRule = {
      id: 'bogus',
      tool: 'nonexistent_tool',
      pattern: /随便什么/,
    };
    expect(resolveToolSelection('随便什么', { grants: { nonexistent_tool: true }, rules: [bogus] })).toEqual({
      kind: 'none',
      reason: 'no-match',
    });
  });

  it('🔴 抽不出参数就丢弃候选，不猜', () => {
    const needsArg: ToolSelectionRule = {
      id: 'needs-arg',
      tool: 'get_task',
      pattern: /任务详情/,
      args: () => undefined,
    };
    expect(
      resolveToolSelection('任务详情', { grants: { get_task: true }, rules: [needsArg] }),
    ).toEqual({ kind: 'none', reason: 'no-match' });
  });

  it('🔴 同一条规则连用两次结果一致（正则无状态）', () => {
    const rule = DEFAULT_TOOL_SELECTION_RULES.find((r) => r.id === 'list.tasks');
    expect(rule).toBeDefined();
    if (rule === undefined) return;
    const options = { grants: ALL_READ_GRANTS, rules: [rule] } as const;
    const first = resolveToolSelection('列出所有任务', options);
    const second = resolveToolSelection('列出所有任务', options);
    expect(first).toEqual(second);
    expect(first.kind).toBe('tool');
  });
});
