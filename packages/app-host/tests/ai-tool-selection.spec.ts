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

import { today } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOOL_SELECTION_RULES,
  resolveToolSelection,
  type ToolArgs,
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

  // ─────────────────────────────────────────────────────────────────────
  // 🔴 `list.today` 必须**带日期参数**（AI-G3 / 计划 W3）
  //
  // 这条规则当初传的是 `{}` —— 于是"今天有什么任务"与"列出任务"**逐字相同**，
  // 拿到的是全量前 N 条。既有测试只断言 `tool`，从不看结果，所以它一直绿。
  //
  // ⚠️ 这里的判据是 args（选择层的产出就是 args），**结果集**的判据在
  // `local-api-host-due-filter.spec.ts`（宿主层）与 `server.spec.ts`（契约层）。
  // 判据分三层，缺任何一层都能被上面那种"参数对了、执行器没实现"的漂移绕过。
  // ─────────────────────────────────────────────────────────────────────
  describe('🔴 list.today 带的是**注入的那一天**，不是空参数', () => {
    /** 两个相隔一天的固定时钟（不读真实时间，否则过几天自己变红）。 */
    const DAY_A = 1_700_000_000_000;
    const DAY_B = DAY_A + 24 * 60 * 60 * 1000;

    function argsFor(nowValue: number): ToolArgs {
      const result = resolveToolSelection('今天有什么任务', {
        grants: ALL_READ_GRANTS,
        now: () => nowValue,
      });
      if (result.kind !== 'tool') throw new Error(`应当选中工具，实际 ${JSON.stringify(result)}`);
      expect(result.ruleId).toBe('list.today');
      expect(result.tool).toBe('list_tasks');
      return result.args;
    }

    it('🔴 传的是 `{ dueOn: <注入的今天> }`，**绝不是**空对象', () => {
      const args = argsFor(DAY_A);
      expect(args).toEqual({ dueOn: today(DAY_A) });
      // 原缺陷的形状：空参数 = 执行器只能返回全量
      expect(Object.keys(args)).not.toHaveLength(0);
    });

    it('🔴 换个时钟就换个日子 ⇒ 日期真的来自 `ctx.now`，不是 `Date.now()`', () => {
      const a = argsFor(DAY_A);
      const b = argsFor(DAY_B);
      expect(a).not.toEqual(b);
      expect(b).toEqual({ dueOn: today(DAY_B) });
    });

    it('命中"今日…安排"这类同族说法时也带日期', () => {
      for (const text of ['今天要做什么', '今天有什么任务', '今日安排', '今天有什么待办']) {
        const result = resolveToolSelection(text, { grants: ALL_READ_GRANTS, now: () => DAY_A });
        if (result.kind !== 'tool') throw new Error(`${text} 应当命中：${JSON.stringify(result)}`);
        expect(result.ruleId, text).toBe('list.today');
        expect(result.args, text).toEqual({ dueOn: today(DAY_A) });
      }
    });

    it('🔴 与 `list.tasks` 同时命中时，**今日**那条优先（否则"今天"会被全量覆盖）', () => {
      // "今天有哪些任务" 同时命中 list.today 与 list.tasks，两者同一个工具
      // ⇒ 去重保留**首次出现**的规则，而 `list.today` 排在前面。
      const result = resolveToolSelection('今天有哪些任务', {
        grants: ALL_READ_GRANTS,
        now: () => DAY_A,
      });
      if (result.kind !== 'tool') throw new Error(JSON.stringify(result));
      expect(result.ruleId).toBe('list.today');
      expect(result.args).toEqual({ dueOn: today(DAY_A) });
    });
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
