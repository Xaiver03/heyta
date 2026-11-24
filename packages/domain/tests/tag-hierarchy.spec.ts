/**
 * 两级标签层级（ADR-0090）—— 结构守卫 + 汇总筛选的判据
 * =====================================================
 *
 * 钉三件事：
 *   1. `validateTagParentChange` 的六种拒绝与一条通过路径（每拒绝都能被触发）；
 *   2. `descendantTagIds` / `expandTagIdsWithDescendants` 的展开（含环防护）；
 *   3. **roll-up**：按父标签筛选把子标签下的任务一并带出，按子筛不带父。
 *
 * 🔴 判据能红：把 `task-filter.ts` 的 `case 'tag'` 改回"只按 id 精确匹配"，
 *    第 3 组里"按父筛带出子"的用例会红。
 */

import { describe, expect, it } from 'vitest';

import type { Tag, Task } from '../src/entities.js';
import { filterTasks, scopeTasks } from '../src/task-filter.js';
import {
  childTagIdsOf,
  descendantTagIds,
  expandTagIdsWithDescendants,
  validateTagParentChange,
} from '../src/tag-hierarchy.js';
import { indexTags } from '../src/tags.js';

const NOW = 1_790_000_000_000;

function tag(id: string, extra: Partial<Tag> = {}): Tag {
  return { id, name: id, createdAt: 1, updatedAt: 1, ...extra };
}

function task(id: string, tagIds: string[] | undefined, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    ...(tagIds === undefined ? {} : { tagIds }),
    ...extra,
  };
}

/** 工作（父）→ 工作/客户A、工作/客户B（子）；生活（顶层）。 */
function hierarchy(): Tag[] {
  return [
    tag('work', { name: '工作' }),
    tag('work-a', { name: '客户A', parentId: 'work' }),
    tag('work-b', { name: '客户B', parentId: 'work' }),
    tag('life', { name: '生活' }),
  ];
}

describe('validateTagParentChange：结构守卫', () => {
  it('标签不存在 ⇒ tag_not_found', () => {
    expect(validateTagParentChange(hierarchy(), 'nope', 'work')).toEqual({
      ok: false,
      reason: 'tag_not_found',
    });
  });

  it('提为顶层（undefined）永远合法', () => {
    expect(validateTagParentChange(hierarchy(), 'work-a', undefined)).toEqual({
      ok: true,
      parentId: undefined,
    });
  });

  it('自己当自己的父 ⇒ self', () => {
    expect(validateTagParentChange(hierarchy(), 'work', 'work')).toEqual({ ok: false, reason: 'self' });
  });

  it('新父不存在 ⇒ parent_not_found', () => {
    expect(validateTagParentChange(hierarchy(), 'life', 'ghost')).toEqual({
      ok: false,
      reason: 'parent_not_found',
    });
  });

  it('新父自己就有父 ⇒ parent_not_top_level（不能造第三层）', () => {
    expect(validateTagParentChange(hierarchy(), 'life', 'work-a')).toEqual({
      ok: false,
      reason: 'parent_not_top_level',
    });
  });

  it('被移动的标签自己有子 ⇒ has_children（父标签不能再进父）', () => {
    expect(validateTagParentChange(hierarchy(), 'work', 'life')).toEqual({
      ok: false,
      reason: 'has_children',
    });
  });

  it('把自己挂到自己的子标签下 ⇒ cycle', () => {
    // work 是父，work-a 是它的子；把 work 挂到 work-a 下会成环。
    expect(validateTagParentChange(hierarchy(), 'work', 'work-a')).toEqual({
      ok: false,
      reason: 'cycle',
    });
  });

  it('合法：把一个顶层标签挂进另一个顶层标签下', () => {
    expect(validateTagParentChange(hierarchy(), 'life', 'work')).toEqual({
      ok: true,
      parentId: 'work',
    });
  });

  it('环防护：数据里已有一条无关的环时不死循环', () => {
    const cyclic = [
      tag('x', { parentId: 'y' }),
      tag('y', { parentId: 'x' }),
      tag('target'),
      tag('moving'),
    ];
    // moving 挂到 target 下：合法，且遍历 target 的父链时遇到既有环能停。
    expect(validateTagParentChange(cyclic, 'moving', 'target')).toEqual({
      ok: true,
      parentId: 'target',
    });
  });
});

describe('descendantTagIds / expandTagIdsWithDescendants：展开', () => {
  it('父展开出全部子；子没有后代替', () => {
    const tags = hierarchy();
    expect(descendantTagIds(tags, 'work').sort()).toEqual(['work-a', 'work-b']);
    expect(descendantTagIds(tags, 'work-a')).toEqual([]);
    expect(expandTagIdsWithDescendants(['work'], tags).sort()).toEqual(['work', 'work-a', 'work-b']);
  });

  it('childTagIdsOf 只给直接子', () => {
    expect(childTagIdsOf(hierarchy(), 'work').sort()).toEqual(['work-a', 'work-b']);
  });

  it('环防护：盘上数据有环时展开能终止，不会无限循环', () => {
    const cyclic = [tag('a', { parentId: 'b' }), tag('b', { parentId: 'a' })];
    const out = expandTagIdsWithDescendants(['a'], cyclic);
    expect(out).toContain('a');
    expect(out.length).toBeLessThanOrEqual(2);
  });
});

describe('筛选 roll-up（ADR-0090）：按父带出子', () => {
  const tags = indexTags(hierarchy());
  const tasks = [
    task('onParent', ['work']),
    task('onChildA', ['work-a']),
    task('onChildB', ['work-b']),
    task('onLife', ['life']),
  ];

  it('按父标签「工作」筛 ⇒ 父自己的任务 + 所有子标签的任务', () => {
    const hit = filterTasks(tasks, { kind: 'tag', tagId: 'work' }, { now: NOW, tags });
    expect(hit.map((t) => t.id).sort()).toEqual(['onChildA', 'onChildB', 'onParent']);
  });

  it('按子标签「客户A」筛 ⇒ 只带自己（不带父、不带兄弟）', () => {
    const hit = filterTasks(tasks, { kind: 'tag', tagId: 'work-a' }, { now: NOW, tags });
    expect(hit.map((t) => t.id)).toEqual(['onChildA']);
  });

  it('scopeTasks：范围写父标签 ⇒ 子标签任务也进范围', () => {
    const hit = scopeTasks(tasks, { projectIds: [], tagIds: ['work'] }, tags);
    expect(hit.map((t) => t.id).sort()).toEqual(['onChildA', 'onChildB', 'onParent']);
  });
});
