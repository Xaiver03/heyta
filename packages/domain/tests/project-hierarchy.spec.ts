/**
 * 清单层级守卫（领域层纯函数）的判据
 * =====================================
 *
 * 这条判据存在的理由不是"函数要测"，而是：**层级规则以前没有任何一层在守**。
 * `entities.ts` 里写着"只允许一层文件夹"，而全仓没有一处代码读它 ——
 * 于是第三层、环、悬空父 id 都能直接写进 op-log，且**不报错**。
 *
 * 每条拒绝都用**同一个数据形状**配一条"换个目标就合法"的阳性对照：
 * 否则守卫写反成"什么都不许"时，只测拒绝的那些断言会一起变绿。
 */

import { describe, expect, it } from 'vitest';

import {
  folderTargetsFor,
  validateProjectParentChange,
  type ProjectParentRejection,
} from '../src/index.js';
import type { Project } from '../src/entities.js';

function mkProject(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    createdAt: 1_700_000_000_000 + Number(idSeqForCreatedAt(id)),
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/**
 * 让 TREE 里四条的 `createdAt` **互不相同** —— 顺序判据才有意义：
 * 全部同刻的话排序只比 id，"按创建时间升序"那一半永远测不到。
 */
function idSeqForCreatedAt(id: string): number {
  const order = ['folder', 'in-folder', 'loose-a', 'loose-b'];
  const index = order.indexOf(id);
  return index === -1 ? 90 : index;
}

/**
 * 一棵合法的一层树：
 * `folder`（顶级，有子）→ `in-folder`；另有两条顶级清单 `loose-a` / `loose-b`。
 */
const TREE: Project[] = [
  mkProject('folder'),
  mkProject('in-folder', { parentId: 'folder' }),
  mkProject('loose-a'),
  mkProject('loose-b'),
];

const reject = (
  projects: readonly Project[],
  projectId: string,
  parentId: string | undefined,
): ProjectParentRejection => {
  const verdict = validateProjectParentChange(projects, projectId, parentId);
  if (verdict.ok) throw new Error(`期望被拒，实际通过：${projectId} → ${parentId ?? '顶级'}`);
  return verdict.reason;
};

describe('validateProjectParentChange：允许的两种移动', () => {
  it('提为顶级永远合法，且把 undefined 原样回传', () => {
    expect(validateProjectParentChange(TREE, 'in-folder', undefined)).toEqual({
      ok: true,
      parentId: undefined,
    });
    // 已经是顶级的，"再提一次顶级"同样合法（幂等由动作层的载荷决定，不在这里判）。
    expect(validateProjectParentChange(TREE, 'loose-a', undefined).ok).toBe(true);
  });

  it('挂进一个顶级清单合法，且把新父 id 原样回传', () => {
    expect(validateProjectParentChange(TREE, 'loose-a', 'folder')).toEqual({
      ok: true,
      parentId: 'folder',
    });
    // 阳性对照：同一条清单换到另一个顶级父也合法（不是"只有一个目标能用"）。
    expect(validateProjectParentChange(TREE, 'in-folder', 'loose-b').ok).toBe(true);
  });
});

describe('validateProjectParentChange：六种拒绝各一条，逐条点名 reason', () => {
  it('project_not_found —— 不存在的清单，以及已软删除的墓碑', () => {
    expect(reject(TREE, '不存在', 'folder')).toBe('project_not_found');
    expect(reject([...TREE, mkProject('墓碑', { deletedAt: 1 })], '墓碑', 'folder')).toBe(
      'project_not_found',
    );
  });

  it('self —— 自己当自己的父（新父一定存在，所以它必须先于 parent_not_found 判）', () => {
    expect(reject(TREE, 'loose-a', 'loose-a')).toBe('self');
  });

  it('parent_not_found —— 不存在与已删除的新父都不能收：写进去就是任何视图都查不到的清单', () => {
    expect(reject(TREE, 'loose-a', '不存在')).toBe('parent_not_found');
    expect(reject([...TREE, mkProject('父已删', { deletedAt: 1 })], 'loose-a', '父已删')).toBe(
      'parent_not_found',
    );
  });

  it('cycle —— 新父是自己的子树里（一层数据里唯一能造出环的形状）', () => {
    // `folder` 的子是 `in-folder`；把 folder 挂到自己子下面 = 环。
    // 🔴 它必须**先于** `parent_not_top_level` 判：`in-folder.parentId === 'folder'`
    //    这一条数据同时命中两个形状，报"目标在文件夹里"会把真正的问题（环）盖掉。
    expect(reject(TREE, 'folder', 'in-folder')).toBe('cycle');
  });

  it('parent_not_top_level —— 新父自己就在文件夹里，挂过去就是第三层', () => {
    expect(reject(TREE, 'loose-a', 'in-folder')).toBe('parent_not_top_level');
    // 阳性对照：把 `loose-a` 挂到那个父的父（顶级 folder）是合法的。
    expect(validateProjectParentChange(TREE, 'loose-a', 'folder').ok).toBe(true);
  });

  it('has_children —— 被移动的清单自己有子（它是文件夹），文件夹不能再进文件夹', () => {
    expect(reject(TREE, 'folder', 'loose-b')).toBe('has_children');
    // 阳性对照：同一个目标 `loose-b`，挂一条**没有子**的清单合法。
    expect(validateProjectParentChange(TREE, 'loose-a', 'loose-b').ok).toBe(true);
  });
});

describe('folderTargetsFor：两端共用的候选集', () => {
  it('候选里只有**合法**的目标：不含自己、不含别人文件夹里的清单、不含自己（文件夹不能进文件夹）', () => {
    // 🔴 `folder` **在**候选里：它虽然已经有子（它是文件夹），但"把一条普通清单
    //    移进文件夹"正是这个功能的目的 —— 被限制的是**文件夹自己**不能被别人当子。
    expect(folderTargetsFor(TREE, 'loose-a').map((p) => p.id)).toEqual(['folder', 'loose-b']);
    // 反过来：`folder` 自己有子 ⇒ 它不能挂进任何东西，候选是空集。
    expect(folderTargetsFor(TREE, 'folder').map((p) => p.id)).toEqual([]);
    // 已经在 folder 里的清单：同为顶级的 folder / loose-a / loose-b 都可以当它的父
    // （folder 那一项就是"原地不动"，界面用「（当前位置）」标出来 —— 它必须**可见**，
    //   否则用户看不出自己在哪一层）。
    expect(folderTargetsFor(TREE, 'in-folder').map((p) => p.id)).toEqual([
      'folder',
      'loose-a',
      'loose-b',
    ]);
    // 不含自己：任何一条的候选里都不该出现它自己的 id。
    for (const project of TREE) {
      expect(folderTargetsFor(TREE, project.id).map((p) => p.id)).not.toContain(project.id);
    }
  });

  it('已删除的清单不进候选（选了就是写一个任何视图都查不到的父）', () => {
    const withTomb: Project[] = [
      ...TREE,
      mkProject('已删', { deletedAt: 1 }),
      mkProject('刚删的父', { deletedAt: 2 }),
    ];
    expect(folderTargetsFor(withTomb, 'loose-a').map((p) => p.id)).not.toContain('已删');
  });

  it('顺序是**创建时间升序**（TREE 四条的 createdAt 互不相同，所以这一半测得到），且不靠输入顺序', () => {
    expect(folderTargetsFor(TREE, 'loose-a').map((p) => p.id)).toEqual(['folder', 'loose-b']);
    const shuffled = [TREE[3]!, TREE[1]!, TREE[2]!, TREE[0]!];
    expect(folderTargetsFor(shuffled, 'loose-a').map((p) => p.id)).toEqual(['folder', 'loose-b']);
  });

  it('🔴 它就是 `validateProjectParentChange` 的展开，两者不许给出不同答案', () => {
    for (const moved of TREE) {
      const allowed = new Set(folderTargetsFor(TREE, moved.id).map((p) => p.id));
      for (const candidate of TREE) {
        if (candidate.id === moved.id) continue;
        const verdict = validateProjectParentChange(TREE, moved.id, candidate.id).ok;
        expect(verdict).toBe(allowed.has(candidate.id));
      }
    }
  });
});

describe('validateProjectParentChange：坏数据不能把守卫打死', () => {
  it('数据里已经躺着一个环时，沿父链上走会停下来而不是死循环', () => {
    // 🔴 第一版这条夹具写错了、被我自己的断言照出来：原本想造"一条与本次无关的环"，
    //    实际把 target 挂成了 z 的子 —— 那种数据下 `cycle` 才是**对的**答案。
    // 现在这条：环在 a↔b 之间，而 `deep` 是环的下游。把顶级清单 z 挂到 deep 下面：
    // 父链 z→…→deep→a→b→a 会撞回已访问节点，守卫必须**停下来**并给出
    // parent_not_top_level（deep 自己有父），而不是被那条环拖进死循环。
    const corrupt: Project[] = [
      mkProject('a', { parentId: 'b' }),
      mkProject('b', { parentId: 'a' }),
      mkProject('deep', { parentId: 'a' }),
      mkProject('z'),
    ];
    expect(reject(corrupt, 'z', 'deep')).toBe('parent_not_top_level');
    // 阳性对照：同一个 z 挂进顶级、没有子的 target 是合法的（守卫不是"什么都不许"）。
    expect(validateProjectParentChange([...corrupt, mkProject('target')], 'z', 'target').ok).toBe(
      true,
    );
  });

  it('拒绝项是封闭集合：六个 reason 全部可达，一个都不多', () => {
    const reached = new Set<ProjectParentRejection>([
      reject(TREE, '不存在', 'folder'),
      reject(TREE, 'loose-a', 'loose-a'),
      reject(TREE, 'loose-a', '不存在'),
      reject(TREE, 'folder', 'in-folder'),
      reject(TREE, 'loose-a', 'in-folder'),
      reject(TREE, 'folder', 'loose-b'),
    ]);
    expect([...reached].sort()).toEqual(
      [
        'cycle',
        'has_children',
        'parent_not_found',
        'parent_not_top_level',
        'project_not_found',
        'self',
      ].sort(),
    );
  });
});
