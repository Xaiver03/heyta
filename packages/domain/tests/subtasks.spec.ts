/**
 * 子任务语义（B1-3 的领域层）
 * ====================
 *
 * 这里钉的是**最不能出错的两条**：
 *
 *   1. 🔴 **循环防护**：把 A 的父设成 A 的后代必须被拒绝，且原因必须是
 *      `cycle`。断言只写 `ok === false` 是**不够的** —— 一个把环误判成
 *      `depth_exceeded` 的实现也会让它绿，而那是两件不同的产品行为
 *      （前者永远不该发生，后者用户可以通过拆浅一层解决）。
 *   2. 🔴 **上限不静默截断**：超限的数据要**留在树里**并出现在
 *      `limitViolations` 里。一个"到上限就 `break`"的实现会让任务凭空
 *      消失且不报错 —— 本仓库反复吃过这个形状（见 AGENTS.md §3.2 的
 *      `other` 档、§3.2 的许可证门禁）。
 *
 * 另外两条读时兜底也在这里钉住：**磁盘上已有的环**不能让树构建挂掉，
 * **父已删除**的子任务要被提到顶级并如实上报。
 */

import { describe, expect, it } from 'vitest';

import type { Task } from '../src/entities.js';
import {
  MAX_SUBTASK_CHILDREN,
  MAX_SUBTASK_DEPTH,
  buildTaskTree,
  canSetParent,
  compareTaskSiblings,
  descendantIds,
  isDescendantOf,
  isTopLevel,
  parentIdOf,
  validateParentChange,
  type TaskTreeNode,
} from '../src/subtasks.js';

let clock = 0;
/** 每调用一次 `createdAt` 前进 1ms —— 让"同刻决胜"的测试可以显式构造。 */
function task(over: Partial<Task> & { id: string }): Task {
  clock += 1;
  return { title: over.id, createdAt: clock, updatedAt: clock, ...over } as Task;
}

/** 同刻任务：显式给相同的 createdAt，专门测 id 决胜。 */
function sameInstant(id: string): Task {
  return { title: id, createdAt: 1000, updatedAt: 1000, id } as Task;
}

describe('parentId 的运行时默认值', () => {
  it('没有 parentId = 顶级任务（老数据不加迁移就落进这个默认）', () => {
    const legacy = task({ id: 'a' });
    expect(parentIdOf(legacy)).toBeUndefined();
    expect(isTopLevel(legacy)).toBe(true);
  });

  it('parentId 是普通可选字段：有值时不是顶级', () => {
    expect(isTopLevel(task({ id: 'b', parentId: 'a' }))).toBe(false);
  });
});

describe('compareTaskSiblings（同级排序的单点定义）', () => {
  it('order 优先于 createdAt', () => {
    const later = task({ id: 'later', order: 2 });
    const earlier = task({ id: 'earlier', order: 1 });
    expect([later, earlier].sort(compareTaskSiblings).map((t) => t.id)).toEqual([
      'earlier',
      'later',
    ]);
  });

  it('🔴 order 为 undefined 的排在已排序的之后（不当成 0 —— 否则新任务会插队）', () => {
    const ordered = task({ id: 'ordered', order: 9 });
    const unordered = task({ id: 'unordered' });
    expect([unordered, ordered].sort(compareTaskSiblings).map((t) => t.id)).toEqual([
      'ordered',
      'unordered',
    ]);
  });

  it('🔴 同一毫秒的三条任务按 id 字典序 —— 去掉 id 决胜就会退化成各端不同的枚举顺序', () => {
    const c = sameInstant('c');
    const a = sameInstant('a');
    const b = sameInstant('b');
    expect([c, a, b].sort(compareTaskSiblings).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildTaskTree', () => {
  it('把扁平列表组装成父子结构并算出深度', () => {
    const tasks = [
      task({ id: 'root' }),
      task({ id: 'child', parentId: 'root' }),
      task({ id: 'grand', parentId: 'child' }),
    ];
    const tree = buildTaskTree(tasks);

    expect(tree.roots.map((n) => n.task.id)).toEqual(['root']);
    expect(tree.roots[0]?.depth).toBe(0);
    expect(tree.roots[0]?.children.map((n) => n.task.id)).toEqual(['child']);
    expect(tree.roots[0]?.children[0]?.depth).toBe(1);
    expect(tree.roots[0]?.children[0]?.children[0]?.task.id).toBe('grand');
    expect(tree.roots[0]?.children[0]?.children[0]?.depth).toBe(2);
    expect(tree.detached).toEqual([]);
    expect(tree.brokenCycles).toEqual([]);
    expect(tree.limitViolations).toEqual([]);
  });

  it('同级按 compareTaskSiblings 稳定排序', () => {
    const tasks = [
      task({ id: 'p' }),
      task({ id: 'second', parentId: 'p', order: 2 }),
      task({ id: 'first', parentId: 'p', order: 1 }),
      task({ id: 'no-order', parentId: 'p' }),
    ];
    expect(buildTaskTree(tasks).roots[0]?.children.map((n) => n.task.id)).toEqual([
      'first',
      'second',
      'no-order',
    ]);
  });

  it('已软删除的任务自身不进树（墓碑不是给用户看的）', () => {
    const tasks = [
      task({ id: 'alive' }),
      task({ id: 'dead', deletedAt: 5 }),
      task({ id: 'dead-child', parentId: 'alive', deletedAt: 5 }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree.roots.map((n) => n.task.id)).toEqual(['alive']);
    expect(tree.nodeById.has('dead')).toBe(false);
    // 活着但被删掉的子任务同样不出现。
    expect(tree.nodeById.get('alive')?.children).toEqual([]);
    expect(tree.detached).toEqual([]);
    expect(tree.promotedFromDeletedParent).toEqual([]);
  });

  it('🔴 父已删除 → 子任务被提到顶级，并**单独**记进 promotedFromDeletedParent', () => {
    const tasks = [
      task({ id: 'dead', deletedAt: 5 }),
      task({ id: 'survivor', parentId: 'dead' }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree.roots.map((n) => n.task.id)).toEqual(['survivor']);
    // 与"父根本不存在"分开报告 —— 两者在数据上不是一回事。
    expect(tree.promotedFromDeletedParent).toEqual(['survivor']);
    expect(tree.detached).toEqual([]);
  });

  it('parentId 指向不存在的任务 → 同样提到顶级并记进 detached', () => {
    const tree = buildTaskTree([task({ id: 'x', parentId: 'ghost' })]);
    expect(tree.roots.map((n) => n.task.id)).toEqual(['x']);
    expect(tree.detached).toEqual(['x']);
  });

  it('🔴 数据里已有环（绕过校验写进去的）不能让构建挂掉，要打断并上报', () => {
    // a → b → c → a 的环。构建若不做读时兜底，这里会无限递归。
    const tasks = [
      task({ id: 'a', parentId: 'c' }),
      task({ id: 'b', parentId: 'a' }),
      task({ id: 'c', parentId: 'b' }),
    ];
    const tree = buildTaskTree(tasks);

    // 三条都在树里，一条都没丢。
    expect([...tree.nodeById.keys()].sort()).toEqual(['a', 'b', 'c']);
    // 打断了恰好一个环入口。
    expect(tree.brokenCycles).toHaveLength(1);
    expect(['a', 'b', 'c']).toContain(tree.brokenCycles[0]);
    // 树的节点总数守恒（没被截断）。
    const count = (nodes: readonly TaskTreeNode[]): number =>
      nodes.reduce((sum, n) => sum + 1 + count(n.children), 0);
    expect(count(tree.roots)).toBe(3);
  });

  it('自指（parentId === 自己）也算环，被提到顶级', () => {
    const tree = buildTaskTree([task({ id: 'self', parentId: 'self' })]);
    expect(tree.roots.map((n) => n.task.id)).toEqual(['self']);
    expect(tree.brokenCycles).toEqual(['self']);
  });

  it('🔴 超深数据：子树**保留**在树里，只上报 limitViolations（不静默截断）', () => {
    // 深度 0..4（比上限 3 多一层）。
    const tasks = [
      task({ id: 'd0' }),
      task({ id: 'd1', parentId: 'd0' }),
      task({ id: 'd2', parentId: 'd1' }),
      task({ id: 'd3', parentId: 'd2' }),
      task({ id: 'd4', parentId: 'd3' }),
    ];
    const tree = buildTaskTree(tasks);

    // 最深那层必须还在树里 —— "到上限就 break"会在这里红。
    expect(tree.nodeById.has('d4')).toBe(true);
    expect(tree.nodeById.get('d4')?.depth).toBe(4);
    expect(tree.limitViolations).toEqual([
      { kind: 'depth', taskId: 'd4', actual: 4, limit: MAX_SUBTASK_DEPTH },
    ]);
  });

  it('🔴 直接子数超限：101 个子任务一个不少，且上报 children 违规', () => {
    const tasks: Task[] = [task({ id: 'p' })];
    for (let i = 0; i < MAX_SUBTASK_CHILDREN + 1; i += 1) {
      tasks.push(task({ id: `c${i}`, parentId: 'p' }));
    }
    const tree = buildTaskTree(tasks);
    expect(tree.roots[0]?.children).toHaveLength(MAX_SUBTASK_CHILDREN + 1);
    expect(tree.limitViolations).toEqual([
      { kind: 'children', taskId: 'p', actual: MAX_SUBTASK_CHILDREN + 1, limit: MAX_SUBTASK_CHILDREN },
    ]);
  });
});

describe('descendantIds / isDescendantOf', () => {
  const tasks = [
    task({ id: 'root' }),
    task({ id: 'a', parentId: 'root' }),
    task({ id: 'b', parentId: 'a' }),
    task({ id: 'unrelated' }),
  ];

  it('descendantIds 含自己，且父先于子', () => {
    const ids = descendantIds(tasks, 'root');
    expect(ids[0]).toBe('root');
    expect(ids).toHaveLength(3);
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
  });

  it('不存在的根返回空', () => {
    expect(descendantIds(tasks, 'ghost')).toEqual([]);
  });

  it('isDescendantOf 不含自己', () => {
    expect(isDescendantOf(tasks, 'b', 'root')).toBe(true);
    expect(isDescendantOf(tasks, 'root', 'root')).toBe(false);
    expect(isDescendantOf(tasks, 'unrelated', 'root')).toBe(false);
    expect(isDescendantOf(tasks, 'root', 'b')).toBe(false);
  });
});

describe('validateParentChange：循环防护', () => {
  // root → mid → leaf
  const tasks = [
    task({ id: 'root' }),
    task({ id: 'mid', parentId: 'root' }),
    task({ id: 'leaf', parentId: 'mid' }),
    task({ id: 'other' }),
  ];

  it('🔴 把祖先挂到自己的直接后代下 → 必须 `cycle`（不是别的失败原因）', () => {
    const result = validateParentChange(tasks, 'root', 'mid');
    expect(result).toEqual({ ok: false, reason: 'cycle' });
  });

  it('🔴 把祖先挂到自己的孙子下 → 同样 `cycle`', () => {
    expect(validateParentChange(tasks, 'root', 'leaf')).toEqual({ ok: false, reason: 'cycle' });
  });

  it('🔴 cycle 判据的前提成立：leaf 确实是 root 的后代', () => {
    // 这条防的是"测试夹具本身坏了"：如果 isDescendantOf 恒为 false，
    // 上面两条断言会改成看到别的 reason 而红，但前提也要单独钉住。
    expect(isDescendantOf(tasks, 'leaf', 'root')).toBe(true);
  });

  it('把子任务挂到无关任务下 → 允许', () => {
    expect(validateParentChange(tasks, 'leaf', 'other')).toEqual({ ok: true, parentId: 'other' });
  });

  it('提为顶级永远允许', () => {
    expect(validateParentChange(tasks, 'leaf', undefined)).toEqual({
      ok: true,
      parentId: undefined,
    });
  });

  it('自己当自己的父 → `self`', () => {
    expect(validateParentChange(tasks, 'root', 'root')).toEqual({ ok: false, reason: 'self' });
  });

  it('任务不存在 → `task_not_found`（删除态同样算不存在）', () => {
    expect(validateParentChange(tasks, 'ghost', 'root')).toEqual({
      ok: false,
      reason: 'task_not_found',
    });
    const withDead = [...tasks, task({ id: 'dead', deletedAt: 1 })];
    expect(validateParentChange(withDead, 'dead', 'root')).toEqual({
      ok: false,
      reason: 'task_not_found',
    });
  });

  it('新父不存在 / 已删除 → `parent_not_found`', () => {
    expect(validateParentChange(tasks, 'root', 'ghost')).toEqual({
      ok: false,
      reason: 'parent_not_found',
    });
    const withDead = [...tasks, task({ id: 'dead', deletedAt: 1 })];
    expect(validateParentChange(withDead, 'root', 'dead')).toEqual({
      ok: false,
      reason: 'parent_not_found',
    });
  });

  it('🔴 数据里已有环时校验不能死循环，也要给出 `cycle`', () => {
    const cyclic = [
      task({ id: 'x', parentId: 'z' }),
      task({ id: 'y', parentId: 'x' }),
      task({ id: 'z', parentId: 'y' }),
    ];
    // z 在 x 的祖先链上（因为数据里有环），把 x 的父设成 z 仍然是环。
    expect(validateParentChange(cyclic, 'x', 'z')).toEqual({ ok: false, reason: 'cycle' });
  });
});

describe('validateParentChange：深度与数量上限', () => {
  it('🔴 新父只到深度 1，但被移动的子树高度 2 → `depth_exceeded`（必须看整棵子树）', () => {
    // ⚠️ 这条用例的形状是刻意选的：新父的深度必须**离上限还有余量**，
    // 否则"只看被移动节点的高度"也能靠父的深度蒙对，用例就测不到东西了。
    // 实测：把判据里的 `+ movedHeight` 去掉，只有这条会红。
    const tasks = [
      task({ id: 'h0' }),
      task({ id: 'h1', parentId: 'h0' }), // 深度 1
      // 高度 2 的独立子树：u0 → u1 → u2
      task({ id: 'u0' }),
      task({ id: 'u1', parentId: 'u0' }),
      task({ id: 'u2', parentId: 'u1' }),
    ];
    // 1(新父深度) + 1(边) + 2(子树高度) = 4 > 3。
    expect(validateParentChange(tasks, 'u0', 'h1')).toEqual({
      ok: false,
      reason: 'depth_exceeded',
    });
  });

  it('把单个叶任务挂到深度 3 的父下 → 也 `depth_exceeded`（4 > 3）', () => {
    const tasks = [
      task({ id: 'h0' }),
      task({ id: 'h1', parentId: 'h0' }),
      task({ id: 'h2', parentId: 'h1' }),
      task({ id: 'h3', parentId: 'h2' }),
      task({ id: 'leaf' }),
    ];
    expect(validateParentChange(tasks, 'leaf', 'h3')).toEqual({
      ok: false,
      reason: 'depth_exceeded',
    });
  });

  it('恰好到上限的移动被允许（边界不能多拦一层）', () => {
    const tasks = [
      task({ id: 'h0' }),
      task({ id: 'h1', parentId: 'h0' }),
      // x 原本是空中的独立任务，带一个子任务 y；把它挂到 h1 下后
      // y 的深度 = 1(新父深度) + 1(边) + 1(子树高度) = 3 = 上限。
      task({ id: 'x' }),
      task({ id: 'y', parentId: 'x' }),
    ];
    expect(validateParentChange(tasks, 'x', 'h1')).toEqual({ ok: true, parentId: 'h1' });
  });

  it('🔴 直接子数达到上限 → `children_exceeded`；已经是它的子任务时重设不报错', () => {
    const tasks: Task[] = [task({ id: 'p' })];
    for (let i = 0; i < MAX_SUBTASK_CHILDREN; i += 1) {
      tasks.push(task({ id: `c${i}`, parentId: 'p' }));
    }
    tasks.push(task({ id: 'newcomer' }));
    expect(validateParentChange(tasks, 'newcomer', 'p')).toEqual({
      ok: false,
      reason: 'children_exceeded',
    });
    // 已经是 p 的第 1 个孩子：重设同一个父不是"新增"，不该被数量上限拦。
    expect(validateParentChange(tasks, 'c0', 'p')).toEqual({ ok: true, parentId: 'p' });
    expect(canSetParent(tasks, 'newcomer', 'p')).toBe(false);
    expect(canSetParent(tasks, 'newcomer', undefined)).toBe(true);
  });
});
