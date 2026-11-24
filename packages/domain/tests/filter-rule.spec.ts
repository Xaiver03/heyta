/**
 * 保存筛选的规则编译器（`FILTER.rule`）
 * ======================================
 *
 * ADR-0092 把"保存的筛选"落成实体 `FILTER`，规则是**结构化判别联合 JSON**。
 * 这份测试钉三件事：
 *
 *   1. **每种 `kind` 的语义**（复用 `task-filter.ts` 的今天/明天/7 天/标签别名语义）；
 *   2. 🔴 **未知 `kind` 必须显式降级**（`compileFilterRule` / `applyFilterRule` 返回
 *      `ok:false` / `undefined`，**不是**静默丢掉未知条件继续筛 —— ADR §3.6，ADR-0048 §1）；
 *   3. 写侧校验（名字 / 结构 / 未知 kind 拒绝），把"存得进去"与"读得出来"钉在一起。
 */

import { describe, expect, it } from 'vitest';

import { Priority, type Tag, type Task } from '../src/entities.js';
import { toLocalDate, addDays } from '../src/date.js';
import {
  applyFilterRule,
  compileFilterRule,
  filterNameRejection,
  filterRuleRejection,
  filterRuleSupport,
  filterRuleUnknownKinds,
  parseFilterRule,
  type FilterRule,
} from '../src/filter-rule.js';
import type { FilterContext } from '../src/task-filter.js';

const LOCAL_NOON = new Date(2026, 8, 28, 12, 0, 0).getTime();
const TODAY = toLocalDate(LOCAL_NOON);

function task(over: Partial<Task> & { id: string }): Task {
  return { title: over.id, createdAt: 0, updatedAt: 0, ...over } as Task;
}

const ctx: FilterContext = { now: LOCAL_NOON };

function ids(tasks: readonly Task[]): string[] {
  return tasks.map((t) => t.id).sort();
}

function run(tasks: readonly Task[], rule: FilterRule, context = ctx): string[] {
  const result = applyFilterRule(tasks, rule, context);
  expect(result).toBeDefined();
  return ids(result!);
}

describe('compileFilterRule / applyFilterRule', () => {
  it('match:all 全部满足才命中；match:any 任一满足即命中', () => {
    const tasks = [
      task({ id: 'p-high-tag', priority: Priority.High, tagIds: ['t1'] }),
      task({ id: 'p-high', priority: Priority.High }),
      task({ id: 'p-low-tag', priority: Priority.Low, tagIds: ['t1'] }),
      task({ id: 'p-low', priority: Priority.Low }),
    ];
    const conditions = [
      { kind: 'priority', values: [Priority.High] },
      { kind: 'tag', tagIds: ['t1'] },
    ] as const;
    const tags: Record<string, Tag> = { t1: { id: 't1', name: 'x', createdAt: 0, updatedAt: 0 } } as Record<string, Tag>;
    expect(run(tasks, { match: 'all', conditions: [...conditions] }, { ...ctx, tags })).toEqual(['p-high-tag']);
    expect(run(tasks, { match: 'any', conditions: [...conditions] }, { ...ctx, tags })).toEqual([
      'p-high',
      'p-high-tag',
      'p-low-tag',
    ]);
  });

  it('today / tomorrow / next7Days 用本地日历日，与内置视图同一条判据', () => {
    const tasks = [
      task({ id: 'today', dueDateLocal: TODAY }),
      task({ id: 'tomorrow', dueDateLocal: addDays(TODAY, 1) }),
      task({ id: 'plus6', dueDateLocal: addDays(TODAY, 6) }),
      task({ id: 'plus7', dueDateLocal: addDays(TODAY, 7) }),
      task({ id: 'none' }),
    ];
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'today' }] })).toEqual(['today']);
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'tomorrow' }] })).toEqual(['tomorrow']);
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'next7Days' }] })).toEqual([
      'plus6',
      'today',
      'tomorrow',
    ]);
  });

  it('project 等值匹配；tag 走 resolveTagIds（合并别名筛得到只挂旧 id 的任务）', () => {
    const tasks = [
      task({ id: 'in-p', projectId: 'p1' }),
      task({ id: 'other', projectId: 'p2' }),
      task({ id: 'alias', tagIds: ['old'] }),
      task({ id: 'plain', tagIds: ['b'] }),
    ];
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'project', projectIds: ['p1'] }] })).toEqual(['in-p']);
    // old → b（合并别名）；按 b 筛要能筛到只挂着 old 的任务。
    const tags: Record<string, Tag> = {
      old: { id: 'old', name: 'old', createdAt: 0, updatedAt: 0, mergedInto: 'b' } as Tag,
      b: { id: 'b', name: 'b', createdAt: 0, updatedAt: 0 } as Tag,
    };
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'tag', tagIds: ['b'] }] }, { ...ctx, tags })).toEqual([
      'alias',
      'plain',
    ]);
  });

  it('due 范围：withinDays / after / before / hasNone（按本地日历日）', () => {
    const tasks = [
      task({ id: 'today', dueDateLocal: TODAY }),
      task({ id: 'plus2', dueDateLocal: addDays(TODAY, 2) }),
      task({ id: 'none' }),
    ];
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'due', withinDays: 3 }] })).toEqual([
      'plus2',
      'today',
    ]);
    expect(
      run(tasks, { match: 'all', conditions: [{ kind: 'due', after: addDays(TODAY, 1), before: addDays(TODAY, 2) }] }),
    ).toEqual(['plus2']);
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'due', hasNone: true }] })).toEqual(['none']);
  });

  it('status：open / completed', () => {
    const tasks = [
      task({ id: 'open' }),
      task({ id: 'done', completedAt: LOCAL_NOON }),
    ];
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'status', value: 'open' }] })).toEqual(['open']);
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'status', value: 'completed' }] })).toEqual(['done']);
  });

  it('keyword 匹配标题与备注，大小写不敏感', () => {
    const tasks = [
      task({ id: 't', title: 'Write REPORT' }),
      task({ id: 'n', title: 'x', note: 'draft report here' }),
      task({ id: 'no', title: 'other' }),
    ];
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'keyword', contains: 'report' }] })).toEqual(['n', 't']);
  });

  it('all 条件恒真；空条件集按 match 分别恒真 / 恒假', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', completedAt: LOCAL_NOON })];
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'all' }] })).toEqual(['a', 'b']);
    expect(run(tasks, { match: 'all', conditions: [] })).toEqual(['a', 'b']);
    expect(run(tasks, { match: 'any', conditions: [] })).toEqual([]);
  });

  it('基础集合排除已删除与已放弃的任务（与 visibleTasks 同一条纪律）', () => {
    const tasks = [
      task({ id: 'live' }),
      task({ id: 'deleted', deletedAt: 1 }),
      task({ id: 'abandoned', abandonedAt: 1 }),
    ];
    expect(run(tasks, { match: 'all', conditions: [{ kind: 'all' }] })).toEqual(['live']);
  });
});

describe('🔴 未知 kind 的显式降级（ADR §3.6 / ADR-0048 §1）', () => {
  // 模拟"更新的版本写下的条件"，老构建读到它。
  const futureRule = {
    match: 'all',
    conditions: [{ kind: 'all' }, { kind: 'geoFence', lat: 1, lng: 2 }],
  } as unknown as FilterRule;

  it('compileFilterRule 返回 ok:false，而不是丢掉未知条件继续筛', () => {
    const compiled = compileFilterRule(futureRule);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.reason).toBe('unsupported-kind');
      expect(compiled.unknownKinds).toContain('geoFence');
    }
  });

  it('applyFilterRule 返回 undefined（"打不开"），而不是一个筛出结果/空列表的数组', () => {
    const tasks = [task({ id: 'a' })];
    expect(applyFilterRule(tasks, futureRule, ctx)).toBeUndefined();
    // 反证：若静默丢条件，这条会得到 ['a'] —— 那正是要禁止的形状。
  });

  it('filterRuleUnknownKinds / filterRuleSupport 是读侧的同一条判据', () => {
    expect(filterRuleUnknownKinds(futureRule)).toEqual(['geoFence']);
    expect(filterRuleSupport(futureRule)).toEqual({ supported: false, unknownKinds: ['geoFence'] });
    expect(filterRuleSupport({ match: 'all', conditions: [{ kind: 'today' }] })).toEqual({ supported: true });
  });
});

describe('写侧校验：filterRuleRejection / filterNameRejection', () => {
  it('合法规则返回 undefined；parseFilterRule 窄化成功', () => {
    const rule: FilterRule = { match: 'any', conditions: [{ kind: 'priority', values: [Priority.High] }] };
    expect(filterRuleRejection(rule)).toBeUndefined();
    expect(parseFilterRule(rule)).toEqual(rule);
  });

  it('🔴 写侧拒绝未知 kind（本版本造不出来 ⇒ 不让它落库）', () => {
    expect(filterRuleRejection({ match: 'all', conditions: [{ kind: 'geoFence' }] })).toBe('unknown-kind');
  });

  it('拒绝各种畸形形状', () => {
    expect(filterRuleRejection(null)).toBe('not-an-object');
    expect(filterRuleRejection({ match: 'sometimes', conditions: [] })).toBe('bad-match');
    expect(filterRuleRejection({ match: 'all' })).toBe('conditions-not-array');
    expect(filterRuleRejection({ match: 'all', conditions: [{ kind: 'project', projectIds: [] }] })).toBe(
      'malformed-condition',
    );
    expect(filterRuleRejection({ match: 'all', conditions: [{ kind: 'due' }] })).toBe('malformed-condition');
    expect(filterRuleRejection({ match: 'all', conditions: [{ kind: 'status', value: 'abandoned' }] })).toBe(
      'malformed-condition',
    );
    expect(filterRuleRejection({ match: 'all', conditions: [{ kind: 'keyword', contains: 'x'.repeat(101) }] })).toBe(
      'keyword-too-long',
    );
  });

  it('名字：空 / 过长被拒，正常名字通过', () => {
    expect(filterNameRejection('   ')).toBe('empty');
    expect(filterNameRejection('x'.repeat(81))).toBe('too-long');
    expect(filterNameRejection('我的工作')).toBeUndefined();
  });
});
