/**
 * 清单 / 标签的**判断层**测试（跑在 node）
 * ==========================================
 *
 * M3 第九刀（projects）。这里测的**不是"渲染得对不对"**（那由三个端的真实
 * 渲染负责），而是那些"写错不会让界面报错、只会静默错"的判断：
 *
 *   1. **层级只有一层**（顶层 / 子级 / 孤儿）；归档清单一律隐藏；
 *   2. **计数口径**：未完成 + 未删除 + 属于这条清单，三条缺一不可 ——
 *      数错一个，用户会看到"清单里有 3 条但打开是 2 条"；
 *   3. **计数两条实现口径一致**（`openTaskCount` 与 `openTaskCounts`）——
 *      这是最容易漂的一处：一个 for 一个 filter，改了其中一个而另一个没改，
 *      界面上一个数字对、另一个字体不一样（而且只有"四处都显示计数"才看得出来）。
 *   4. `toTagItems` **不**因直觉给它加 `archived` 过滤（`Tag` 没有这个字段）。
 */

import { describe, expect, it } from 'vitest';
import type { Project, Tag, Task } from '@heyta/domain';

import {
  aliveProjects,
  childProjects,
  openTagCounts,
  openTaskCount,
  openTaskCounts,
  organizerRowKey,
  toOrganizerNodes,
  toOrganizerTree,
  toTagItems,
  topLevelProjects,
} from '../src/projects/model.js';

const NOW = 1_700_000_000_000;

/** 造一条清单。默认未归档、无父。 */
function project(partial: Partial<Project> & { id: string; name: string }): Project {
  return { createdAt: NOW, updatedAt: NOW, ...partial };
}

/** 造一条标签。 */
function tag(id: string, name: string): Tag {
  return { id, name, createdAt: NOW, updatedAt: NOW };
}

/** 造一条任务。默认未删除、未完成、无清单。 */
function task(partial: Partial<Task> & { id: string }): Task {
  return { createdAt: NOW, updatedAt: NOW, title: partial.id, ...partial };
}

describe('清单层级：顶层 / 一层子级 / 归档隐藏', () => {
  const projects = [
    project({ id: 'p1', name: '工作' }),
    project({ id: 'p1a', name: '汇报', parentId: 'p1' }),
    project({ id: 'p1b', name: '招聘', parentId: 'p1' }),
    project({ id: 'p2', name: '生活' }),
    project({ id: 'p2a', name: '家务', parentId: 'p2' }),
    project({ id: 'p9', name: '旧项目', archived: true }),
    project({ id: 'p9a', name: '旧项目子', parentId: 'p9' }),
  ];

  it('顶层 = 无 parentId 且未归档（顺序保持输入顺序）', () => {
    expect(topLevelProjects(projects).map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('子级只取一层，且不含归档父级下的孤儿', () => {
    expect(childProjects(projects, 'p1').map((p) => p.id)).toEqual(['p1a', 'p1b']);
    // 🔴 父级归档之后，子级**不再作为顶层出现** —— 它从界面上消失。
    // 这是迁移前 web 选择器的既有语义（`parentId === undefined` 只从顶层算起），
    // 本刀原样保留，并在 model 文件头登记为已知取舍。
    const tree = toOrganizerTree(projects);
    expect(tree.map((n) => n.id)).toEqual(['p1', 'p2']);
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['p1a', 'p1b']);
    expect(tree[1]!.children.map((c) => c.id)).toEqual(['p2a']);
  });

  it('aliveProjects 只按 archived 过滤，不碰别的字段', () => {
    // `p9a`（归档父级下的子清单）**仍然 alive** —— 这一层不管层级，
    // 只管 archived。它从界面上消失是 `toOrganizerTree` 的效果，不是这里。
    expect(aliveProjects(projects).map((p) => p.id)).toEqual([
      'p1',
      'p1a',
      'p1b',
      'p2',
      'p2a',
      'p9a',
    ]);
  });

  it('toOrganizerTree 的每一层都只有 id / name / children —— 不把整个实体漏出去', () => {
    const first = toOrganizerTree(projects)[0]!;
    expect(Object.keys(first).sort()).toEqual(['children', 'id', 'name']);
    expect(Object.keys(first.children[0]!).sort()).toEqual(['id', 'name']);
  });
});

describe('未完成任务计数：三条条件缺一不可', () => {
  const tasks = [
    task({ id: 't1', projectId: 'p1' }),
    task({ id: 't2', projectId: 'p1', completedAt: NOW }),
    task({ id: 't3', projectId: 'p1', deletedAt: NOW }),
    task({ id: 't4', projectId: 'p1' }),
    task({ id: 't5', projectId: 'p2' }),
    task({ id: 't6' }),
  ];

  it('未完成 + 未删除 + 属于这条清单', () => {
    expect(openTaskCount(tasks, 'p1')).toBe(2);
    expect(openTaskCount(tasks, 'p2')).toBe(1);
    // 不存在的清单是 0，不是抛错。
    expect(openTaskCount(tasks, 'nope')).toBe(0);
  });

  it('一次遍历的表与单条版**逐条一致**（这两条是最容易漂的一处）', () => {
    const table = openTaskCounts(tasks);
    expect(table).toEqual({ p1: 2, p2: 1 });
    for (const id of ['p1', 'p2', 'p3', 'nope']) {
      expect(table[id] ?? 0).toBe(openTaskCount(tasks, id));
    }
  });

  it('没有 projectId 的任务不计入任何清单（收集箱不冒充清单）', () => {
    // `t6` 无清单。表里不该出现任何以 `undefined` 为键的项。
    expect(Object.keys(openTaskCounts(tasks))).toEqual(['p1', 'p2']);
  });

  it('空输入返回空表（不是 `undefined`）', () => {
    expect(openTaskCounts([])).toEqual({});
  });
});

describe('标签计数：口径与清单那节必须一致，一条任务给它的每个标签各加一', () => {
  const tasks = [
    task({ id: 't1', tagIds: ['g1'] }),
    task({ id: 't2', tagIds: ['g1', 'g2'] }),
    task({ id: 't3', tagIds: ['g1'], completedAt: NOW }),
    task({ id: 't4', tagIds: ['g1'], deletedAt: NOW }),
    task({ id: 't5', tagIds: [] }),
    task({ id: 't6' }),
  ];

  it('未完成 + 未删除；一条任务挂两个标签 ⇒ 两个标签各 +1（不是给某一个 +2）', () => {
    expect(openTagCounts(tasks)).toEqual({ g1: 2, g2: 1 });
  });

  it('没有 tagIds 的任务不进表（收集箱不冒充某个标签）', () => {
    expect(Object.keys(openTagCounts(tasks)).sort()).toEqual(['g1', 'g2']);
  });

  it('空输入返回空表', () => {
    expect(openTagCounts([])).toEqual({});
  });

  /**
   * 🔴 这条钉的是**跨节一致性**：侧栏的清单与标签两节画的是同一个组件，
   * 若两边的"算不算一条"条件漂开，用户只会看出"这两个数对不上"，
   * 说不出哪一层错 —— 所以判据不能各测各的。
   */
  it('与 `countsTowardProject` 同口径：同一批任务，完成/删除的两节都不计', () => {
    const both = [task({ id: 'x1', projectId: 'p1', tagIds: ['g1'] }), task({ id: 'x2', projectId: 'p1', tagIds: ['g1'], completedAt: NOW })];
    expect(openTaskCounts(both)).toEqual({ p1: 1 });
    expect(openTagCounts(both)).toEqual({ g1: 1 });
  });
});

describe('标签：不因直觉加 archived 过滤', () => {
  it('toTagItems 原样投影 id / name', () => {
    expect(toTagItems([tag('g1', '紧急'), tag('g2', '等回复')])).toEqual([
      { id: 'g1', name: '紧急' },
      { id: 'g2', name: '等回复' },
    ]);
  });

  it('一个标签都没有时是空数组', () => {
    expect(toTagItems([])).toEqual([]);
  });

  it('toOrganizerNodes 把平表包成没有子级的树', () => {
    const nodes = toOrganizerNodes(toTagItems([tag('g1', '紧急')]));
    expect(nodes).toEqual([{ id: 'g1', name: '紧急', children: [] }]);
  });
});

describe('行 key：清单与标签不共用同一命名空间', () => {
  it('同 id 的两类实体 key 不同', () => {
    expect(organizerRowKey('project', 'x')).toBe('project-x');
    expect(organizerRowKey('tag', 'x')).toBe('tag-x');
    expect(organizerRowKey('project', 'x')).not.toBe(organizerRowKey('tag', 'x'));
  });
});
