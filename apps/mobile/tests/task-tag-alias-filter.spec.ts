/**
 * 移动端「按标签筛」的**合并别名**接线
 * =====================================
 *
 * 读点只有一处：`apps/mobile/src/screens/TasksScreen.tsx` 的 `groups` useMemo 里那一发
 * `filterTasks(tasks, { kind: 'tag', tagId: tagFilter }, { now, tags: … })`。
 *
 * 🔴 缺口长什么样：标签合并只写标签那一行（`{deletedAt, mergedInto}`），**不重写
 * 任务的 `tagIds`**（见 `packages/domain/src/tags.ts` 文件头）。于是"这条任务有哪些
 * 标签"只有 `resolveTagIds` 能回答。不传 `tags` ⇒ 那一支退回"按 id 精确匹配" ⇒
 * **按 B 筛不到只挂着 A 的任务**，不报错，用户只看到"合并之后我的任务不见了"。
 *
 * 🔴 还有一层坑，这条 spec 专门盯它：解析表**不能**用 `projectActions.listTags()`
 * 那份**存活投影**（`aliveOf`）—— 合并把 A 写成墓碑，它已经不在里面了。
 * `followTagAlias('tag-a', 存活表)` 找不到 `tags['tag-a']` ⇒ 返回 `undefined`
 * ⇒ 任务的有效标签**变成空数组**。这时"传了 tags"和"没传"读数一样（都是旧语义），
 * 也就是**接了线却空转**。屏里必须用物化状态原表（`host.engine.getState().tags`）。
 *
 * ## 为什么这里是"源码断言 + 真实数据读数"两段
 *
 * 本仓移动端测试跑在 node 环境，`@heyta/ui` 会拖进 `react-native`（Flow 源码，
 * node 解析不了），所以整屏**无法渲染** —— 同 `projects-sections.spec.ts` 的既有做法。
 * 因此分工是：
 *
 *   · **语义与读数** 用真实数据在共享判据（`filterTasks`）上跑，调用形状与屏里逐字相同；
 *   · **接线** 断言屏里到底把哪张表递了进去（换成存活投影 ⇒ 红）。
 *
 * 两条都验过会红（见交付说明的"注掉/换表前后读数"）：
 *   · 去掉屏里的 `tags:` ⇒ 第 2 段红；
 *   · 把 `tagEntities` 换成 `indexTags(tags)`（存活投影）⇒ 第 1 段的"带表"读数退化成
 *     "不传"那一行的读数（3 而不是 6）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filterTasks, resolveTags, type Tag, type Task } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREEN = resolve(HERE, '../src/screens/TasksScreen.tsx');

const NOW = Date.UTC(2026, 10, 7, 4, 0, 0);

function task(id: string, tagIds: string[] | undefined, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    createdAt: NOW,
    updatedAt: NOW,
    ...(tagIds === undefined ? {} : { tagIds }),
    ...over,
  };
}

function tag(id: string, name: string, over: Partial<Tag> = {}): Tag {
  return { id, name, createdAt: NOW, updatedAt: NOW, ...over };
}

/**
 * 合并完成之后的两张表。**两张都要**，因为它们正是屏里那两个状态：
 *   · `aliasTable` = `engine.getState().tags`（全量，含墓碑）—— 正确的那张；
 *   · `aliveTable` = `listTags()` 的存活投影 —— 错的那张（空转的来源）。
 */
const aliasTable: Record<string, Tag> = {
  // 合并：A 被写进 B（`{deletedAt, mergedInto}`），任务上的 tagIds **没变**。
  'tag-a': tag('tag-a', '旧标签', { deletedAt: NOW, mergedInto: 'tag-b' }),
  'tag-b': tag('tag-b', '新标签'),
};
const aliveTable: Record<string, Tag> = {
  'tag-b': tag('tag-b', '新标签'),
};

/**
 * 三组任务，读数刻意不相等：
 *   · 只挂 A（合并掉的那条）= **3 条** ← 判据里的 N
 *   · 原本就挂 B = 2 条
 *   · A+B 混合 = 1 条（去重后仍是 B 一次）
 *   · 已完成且只挂 A = 1 条（标签视图**只看未完成**，不给任何一行加数）
 */
const tasks: Task[] = [
  task('onlyA-1', ['tag-a']),
  task('onlyA-2', ['tag-a']),
  task('onlyA-3', ['tag-a']),
  task('onlyB-1', ['tag-b']),
  task('onlyB-2', ['tag-b']),
  task('mixed', ['tag-a', 'tag-b']),
  task('doneOnlyA', ['tag-a'], { completedAt: NOW }),
];

/** 屏里那一发的逐字形状（`tags` 缺席 = 未接线时的旧语义）。 */
function byTag(tagId: string, tags?: Readonly<Record<string, Tag>>): string[] {
  return filterTasks(tasks, { kind: 'tag', tagId }, tags === undefined ? { now: NOW } : { now: NOW, tags })
    .map((row) => row.id)
    .sort();
}

describe('按 B 筛：合并之后 A-only 任务必须回到 B 名下（读数，不是"函数返回了"）', () => {
  it('合并前：B 只命中原本挂 B 的 —— 3 条（onlyB-1/2 + mixed）', () => {
    // 合并前 A 还活着：`lookup` 里 A 没有 mergedInto，解析表怎么给都一样。
    const before: Record<string, Tag> = {
      'tag-a': tag('tag-a', '旧标签'),
      'tag-b': tag('tag-b', '新标签'),
    };
    const hit = byTag('tag-b', before);
    expect(hit).toEqual(['mixed', 'onlyB-1', 'onlyB-2']);
    expect(hit).toHaveLength(3);
  });

  it('合并后（全量别名表）：B = 6 条 = 原有 3 + 只挂 A 的 3（N=3）', () => {
    const hit = byTag('tag-b', aliasTable);
    expect(hit).toEqual(['mixed', 'onlyA-1', 'onlyA-2', 'onlyA-3', 'onlyB-1', 'onlyB-2']);
    // 判据原句：合并后 B 的计数 = N + 原有。
    expect(hit).toHaveLength(3 + 3);
    // 已完成的那条不进来（标签视图只看未完成，与 Web 侧栏一致）。
    expect(hit).not.toContain('doneOnlyA');
  });

  it('🔴 换回存活投影（= 拿 `listTags()` 当解析表）：读数退回 3 —— 接了线却空转', () => {
    /**
     * 这一条是**反面对照**，不是"另一个合法实现"：
     * 存活表里没有 `tag-a`（它被合并写成了墓碑）⇒ `followTagAlias` 找不到它 ⇒
     * 有效标签变成空数组 ⇒ A-only 那三条既不显示 A 也不显示 B。
     * 所以屏里必须传 `tagEntities`（物化状态原表）。判据见第 2 段。
     */
    expect(byTag('tag-b', aliveTable)).toEqual(['mixed', 'onlyB-1', 'onlyB-2']);
    expect(byTag('tag-b', aliveTable)).toHaveLength(3);
  });

  it('不传 tags = 旧语义（未接线时的那条分支），读数同样是 3', () => {
    /*
      这条钉住的是 `packages/domain/src/tags.spec.ts` 里那条"不传 = 精确匹配"在
      **移动端这一份数据**上的读数：一旦有人把 `filterTasks` 的退化分支删掉，
      这里与域层那两条会一起红。
    */
    expect(byTag('tag-b')).toEqual(['mixed', 'onlyB-1', 'onlyB-2']);
  });
});

describe('合并之后这条任务的标签 chip 不能是空的', () => {
  it('`resolveTags([A], 全量表)` ⇒ B 的名字（不是空、也不是 A 的旧名字）', () => {
    const names = resolveTags(['tag-a'], aliasTable).map((item) => item.name);
    expect(names).toEqual(['新标签']);
    // 对照：存活表把它解析成空（这就是"传了等于没传"的样子）。
    expect(resolveTags(['tag-a'], aliveTable)).toEqual([]);
  });
});

describe('接线：屏里递进去的必须是"物化状态原表"，不是存活投影', () => {
  // 归一化空白，断言跨行的调用形状（改格式不会假红，改表/删参数会真红）。
  const source = readFileSync(SCREEN, 'utf8').replace(/\s+/g, ' ');

  it('`filterTasks` 的标签那一支带上了 `tags`，且用的是 `tagEntities`', () => {
    expect(
      source,
      'TasksScreen 的标签筛选没把解析表递进去（`tags: …`）—— 合并后按 B 筛不到只挂 A 的任务。',
    ).toContain("filterTasks(tasks, { kind: 'tag', tagId: tagFilter }, { now, tags: tagEntities })");
  });

  it('解析表取自 `engine.getState().tags`（全量），**不是** `listTags()`（存活投影）', () => {
    expect(
      source,
      '解析表必须来自物化状态原表：存活投影里没有被合并掉的那一行，传了等于没传。',
    ).toContain('host.engine.getState().tags');
    // 选择器仍然用存活投影（那是"能勾的选项"），两条通道各司其职。
    expect(source).toContain('setTags(projectActions.listTags())');
    // 显式反向断言：不许把那个数组当解析表（`tags: tags` 是这一处的经典写法错误）。
    expect(source).not.toContain('tags: tags');
  });
});
