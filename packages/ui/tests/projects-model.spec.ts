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
 *   5. `listNameFor`：**什么算"这条任务的归属"**（命中给名字、收集箱给宿主传的
 *      那个词、悬空 id 与空名字给 `null`，而归档清单**照旧显示**）。这一条原先
 *      在两个端上各判一次，结果 web 的行上有归属、移动端的行上没有 ——
 *      同一件信息两种常驻度。
 */

import { describe, expect, it } from 'vitest';
import type { Project, Tag, Task } from '@heyta/domain';

import {
  aliveProjects,
  childProjects,
  listNameFor,
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

  it('toOrganizerTree 的每一层都是**白名单投影** —— 不把整个实体漏出去', () => {
    // 🔴 这条判据钉的是"只有这几列"，不是"这几列的名字"。
    // `archived` 在 2026-10-03 的 `192a516d` 里进来了，而且**是承重的**：
    // `OrganizerList.tsx:411-424` 按它决定画哪个归档图标、往 `onArchive` 传哪个**目标状态**
    // （`apps/web/src/features/projects/ProjectsPanel.tsx:254` 就是那个消费者）。
    // 那笔提交加了字段没同步这条期望 ⇒ 门禁从那天起是红的。这里把清单补齐，
    // 判据的强度不变：再多一列（比如有人把 `color` 或整个 `Project` 漏出去）照样红。
    const first = toOrganizerTree(projects)[0]!;
    expect(Object.keys(first).sort()).toEqual(['archived', 'children', 'id', 'name']);
    expect(Object.keys(first.children[0]!).sort()).toEqual(['archived', 'id', 'name']);
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

describe('listNameFor：什么才算"这条任务的归属"', () => {
  const projects = [
    project({ id: 'p1', name: '工作' }),
    project({ id: 'p1a', name: '汇报', parentId: 'p1' }),
    project({ id: 'p9', name: '旧项目', archived: true }),
    project({ id: 'px', name: '' }),
  ];
  const INBOX = '收集箱';

  it('命中就返回那条清单自己的名字（不拼父级）', () => {
    expect(listNameFor(projects, 'p1', INBOX)).toBe('工作');
    expect(listNameFor(projects, 'p1a', INBOX)).toBe('汇报');
  });

  /**
   * 🔴 这一条**改过一轮**，改的理由值得留着。
   * 原先这里断言的是 `null`（"收集箱不是一条清单，不该显示归属"），
   * 而参照图那一行的归属位写的正是「收集箱 · 昨天」—— 归属位回答的是
   * "这条在哪"，收集箱也是一个答案。
   */
  it('没有 projectId（收集箱）→ 显示宿主给的那个词', () => {
    expect(listNameFor(projects, undefined, INBOX)).toBe(INBOX);
  });

  /**
   * 上面那条反转的**前提**在这条里：收集箱与悬空 id 仍然是两种状态 ——
   * 一个有徽章、一个没有。少了这条，"收集箱也显示"就等于把两种状态合并。
   */
  it('悬空 id → null（不编名字），且**不等于**收集箱那条分支', () => {
    expect(listNameFor(projects, 'gone', INBOX)).toBeNull();
    expect(listNameFor(projects, 'gone', INBOX)).not.toBe(listNameFor(projects, undefined, INBOX));
  });

  it('清单名是空串 → null：只剩一个图标等于噪音', () => {
    expect(listNameFor(projects, 'px', INBOX)).toBeNull();
  });

  /**
   * 🔴 这条**故意与 `aliveProjects` 相反**，别"顺手统一"。
   * `aliveProjects` 管的是"清单列表里要不要出现这一行"，
   * `listNameFor` 管的是"这条任务属于哪条清单"。归档不改变归属事实，
   * 把归属徽章一起藏掉会让用户以为任务掉进了收集箱。
   */
  it('归档清单仍然显示归属', () => {
    expect(listNameFor(projects, 'p9', INBOX)).toBe('旧项目');
  });

  it('空清单表（还没有任何清单）→ null 而不是抛', () => {
    expect(listNameFor([], 'p1', INBOX)).toBeNull();
  });

  /**
   * `@heyta/ui` 的依赖里没有 `@heyta/i18n`（见本包 `package.json`），所以"收集箱"这个
   * **词**由宿主传。这一条钉住这个边界：换个词就显示那个词，
   * 而不是共享层里藏了一份中文。（英文端传 `Inbox` 就得到 `Inbox`。）
   */
  it('收集箱那个词是传进来的，不是共享层里写死的', () => {
    expect(listNameFor(projects, undefined, 'Inbox')).toBe('Inbox');
  });
});
