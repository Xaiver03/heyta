/**
 * 标签合并的读侧解析（R8）—— 唯一入口的行为与形状判据
 * =====================================================
 *
 * 合并**只写一行标签**（`{ deletedAt, mergedInto }`），**不重写任何任务的 `tagIds`**。
 * 所以"这条任务挂着哪些标签"只有 `resolveTagIds()` / `resolveTags()` 能回答。
 *
 * 这一组钉四件事：
 *   1. **只去掉被合并掉的那条**，其余标签原样（判据 R8-①的另一半）；
 *   2. **筛选**按目标标签能筛到"只挂着被合并 id"的任务（最致命的一格：
 *      漏了它=合并之后任务不见了，且不报错）；
 *   3. **环 / 链 / 超深**都安全终止（`A→B→C` 解析到 C；`A→B→A` 返回 `undefined`）；
 *   4. **原始数据不变** —— 一条测试把"`tagIds` 里仍然留着 A"这件事钉住，
 *      它是给下一个人看的：这是**设计**，不是漏改。
 *
 * 🔴 判据能红：把 `tags.ts` 的 `resolveTagId` 改成直接返回入参（等于关掉迁移步骤），
 * 第 2 条与"合并后 A 不再出现"那几条都会红。
 */

import { describe, expect, it } from 'vitest';

import type { Tag, Task } from '../src/entities.js';
import { filterTasks } from '../src/task-filter.js';
import { followTagAlias, indexTags, resolveTagId, resolveTagIds, resolveTags, tagUsageCount, taskHasTag } from '../src/tags.js';

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

/** A 已合并进 B（一条 op 写出来的形状）。 */
function mergedWorld(): Record<string, Tag> {
  return indexTags([
    tag('tag-a', { deletedAt: NOW, mergedInto: 'tag-b' }),
    tag('tag-b', { name: '工作' }),
    tag('tag-c', { name: '生活' }),
  ]);
}

describe('resolveTagId / resolveTagIds：合并只吃掉被合并的那一条', () => {
  it('A→B：A 解析成 B；没被合并的标签原样返回', () => {
    const tags = mergedWorld();
    expect(resolveTagId('tag-a', tags)).toBe('tag-b');
    expect(resolveTagId('tag-b', tags)).toBe('tag-b');
    expect(resolveTagId('tag-c', tags)).toBe('tag-c');
  });

  it('一条任务同时挂着 A 与 B ⇒ 有效标签只留下一个 B（不出现两个同义 chip）', () => {
    const tags = mergedWorld();
    expect(resolveTagIds(['tag-a', 'tag-b'], tags)).toEqual(['tag-b']);
    // 顺序保持"第一次出现"的顺序（用户加标签的顺序有意义）。
    expect(resolveTagIds(['tag-c', 'tag-a'], tags)).toEqual(['tag-c', 'tag-b']);
  });

  it('链要跟到底：A→B→C 解析到 C', () => {
    const tags = indexTags([
      tag('tag-a', { deletedAt: NOW, mergedInto: 'tag-b' }),
      tag('tag-b', { deletedAt: NOW, mergedInto: 'tag-c' }),
      tag('tag-c', { name: '生活' }),
    ]);
    expect(resolveTagId('tag-a', tags)).toBe('tag-c');
    expect(followTagAlias('tag-a', tags)).toBe('tag-c');
  });

  it('环要停：A→B→A 返回 undefined（不是死循环，也不是把 A 当活的）', () => {
    const tags = indexTags([
      tag('tag-a', { deletedAt: NOW, mergedInto: 'tag-b' }),
      tag('tag-b', { deletedAt: NOW, mergedInto: 'tag-a' }),
    ]);
    expect(followTagAlias('tag-a', tags)).toBeUndefined();
    expect(resolveTagId('tag-a', tags)).toBeUndefined();
    expect(resolveTagIds(['tag-a'], tags)).toEqual([]);
  });

  it('指向不存在的 id / 已彻底删除的目标 ⇒ undefined（引用不该被看见）', () => {
    const tags = indexTags([
      tag('tag-a', { deletedAt: NOW, mergedInto: 'tag-gone' }),
      tag('tag-p', { mergedInto: 'tag-q' }),
      tag('tag-q', { purgedAt: NOW }),
      tag('tag-self', { deletedAt: NOW }),
    ]);
    expect(resolveTagId('tag-a', tags)).toBeUndefined();
    expect(resolveTagId('tag-p', tags)).toBeUndefined();
    // 自己删掉但没有合并去向 ⇒ 也不可见。
    expect(resolveTagId('tag-self', tags)).toBeUndefined();
  });

  it('resolveTags 返回实体、顺序与 resolveTagIds 一致', () => {
    const tags = mergedWorld();
    expect(resolveTags(['tag-a', 'tag-c'], tags).map((item) => item.name)).toEqual(['工作', '生活']);
  });

  it('空 / 缺席 / 悬空 id 都安全', () => {
    const tags = mergedWorld();
    expect(resolveTagIds(undefined, tags)).toEqual([]);
    expect(resolveTagIds([], tags)).toEqual([]);
    expect(resolveTagIds(['tag-nope'], tags)).toEqual([]);
  });
});

describe('taskHasTag / tagUsageCount：界面与计数都走解析', () => {
  it('只挂着 A 的任务**算挂着 B**（否则合并之后它就从 B 的列表里消失）', () => {
    const tags = mergedWorld();
    const onlyA = task('t1', ['tag-a']);
    expect(taskHasTag(onlyA, 'tag-b', tags)).toBe(true);
    expect(taskHasTag(onlyA, 'tag-a', tags), 'A 已经不存在了，问它等于问一个死引用').toBe(false);
  });

  it('tagUsageCount：目标标签把别名指过来的任务也算进去；墓碑任务不算', () => {
    const tags = mergedWorld();
    const tasks = [
      task('t1', ['tag-a']),
      task('t2', ['tag-b']),
      task('t3', ['tag-a', 'tag-b']),
      task('t4', ['tag-a'], { deletedAt: NOW }),
    ];
    expect(tagUsageCount(tasks, 'tag-b', tags)).toBe(3);
  });
});

describe('筛选：按 B 能筛到"只挂着 A"的任务（最致命的那一格）', () => {
  const tags = mergedWorld();
  const tasks = [
    task('onlyA', ['tag-a']),
    task('onlyB', ['tag-b']),
    task('onlyC', ['tag-c']),
  ];

  it('给了 tags ⇒ 解析（按 B 命中 onlyA 与 onlyB）', () => {
    const hit = filterTasks(tasks, { kind: 'tag', tagId: 'tag-b' }, { now: NOW, tags });
    expect(hit.map((item) => item.id).sort()).toEqual(['onlyA', 'onlyB']);
  });

  it('不给 tags ⇒ 退回按 id 精确匹配（桌面/移动端**今天**的行为，登记为缺口）', () => {
    /**
     * 🔴 这条把"未接线的那两端"钉在它们**当前**的行为上，而不是容忍一个模糊的中间态：
     * 哪天有人给 `apps/mobile` / `apps/desktop` 补上 `context.tags`，这条不会红，
     * 但他一旦**改掉**这条退化分支（比如直接删掉 `context.tags === undefined` 那一支），
     * 这条会红 —— 那时他必须回来看这一段并同步移动端。
     */
    const hit = filterTasks(tasks, { kind: 'tag', tagId: 'tag-b' }, { now: NOW });
    expect(hit.map((item) => item.id)).toEqual(['onlyB']);
  });
});

describe('🔴 原始数据不变：这是设计，不是漏改', () => {
  it('合并之后 `task.tagIds` 里**仍然**留着被合并掉的 id', () => {
    /**
     * 合并是一条 op（写标签那一行），所以任务上的旧引用**不会被清掉**。
     * 这条断言的存在只有一个目的：**让下一个人看见这件事是刻意的**。
     * 如果哪天有人"顺手把 tagIds 也重写一遍"，这条会红，
     * 而他必须先回答一个问题：那是一次合并 = N 条 op，还是不是？
     *（N 条 op 的做法与 §3.4 冲突，取舍写在 `packages/domain/src/tags.ts` 文件头。）
     */
    const onlyA = task('t1', ['tag-a', 'tag-c']);
    expect(onlyA.tagIds).toEqual(['tag-a', 'tag-c']);
    // 而"有效"标签里已经没有 A 了。
    expect(resolveTagIds(onlyA.tagIds, mergedWorld())).toEqual(['tag-b', 'tag-c']);
  });
});
