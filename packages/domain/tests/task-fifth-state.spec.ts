/**
 * 第五态「放弃」在**领域层**的隐藏（ADR-0083 §3.1 / ADR-0048 I5）
 * ==============================================================
 *
 * 这一族钉的不是"过滤对不对"，而是 ADR-0048 的 I5 那句话：
 * **「隐藏由层负责，不由调用点负责」**。
 *
 * 所以每条用例都把**含已放弃任务的原始表整个递进去**，然后要求它不出现 ——
 * 这正是 `isLive` 文件头记着的那类失效的形状：判据散在六处各写一遍时，
 * 漏掉的那一半**不会报错**，只会让某些视图显示、某些不显示。
 *
 * ⚠️ `aliveTasks` 那一问**仍然要含已放弃**（回收站、"已放弃"出口、统计都要问它），
 *    所以这里同时钉反方向：把 `visibleTasks` 的过滤误加到 `aliveTasks` 上也会红。
 */

import { describe, expect, it } from 'vitest';

import {
  aliveTasks,
  bucketByQuadrant,
  byCreatedAtOrder,
  byPinnedFirst,
  filterTasks,
  groupTasksByDate,
  isAbandoned,
  sectionTasks,
  visibleTasks,
  type Task,
  type TaskFilter,
} from '../src/index.js';
import { searchTasks } from '../src/search.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '任务',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/** 三态各一条：普通、已放弃、已软删。所有用例都喂这一整张表。 */
const MIXED: Task[] = [
  makeTask({ id: 'plain', title: '还在做' }),
  makeTask({ id: 'dropped', title: '放弃了', abandonedAt: NOW }),
  makeTask({ id: 'trashed', title: '删掉了', deletedAt: NOW }),
];

const ids = (tasks: readonly Task[]): string[] => tasks.map((t) => t.id);

describe('visibleTasks / aliveTasks 是两个不同的问题', () => {
  it('visibleTasks：未删除且未放弃', () => {
    expect(ids(visibleTasks(MIXED))).toEqual(['plain']);
  });

  it('🔴 aliveTasks：**仍然含**已放弃（回收站与统计要问这一问）', () => {
    expect(ids(aliveTasks(MIXED))).toEqual(['plain', 'dropped']);
  });

  it('isAbandoned 只认 `abandonedAt` 有值', () => {
    expect(isAbandoned(makeTask({ abandonedAt: 0 }))).toBe(true);
    expect(isAbandoned(makeTask())).toBe(false);
  });
});

describe('每一个显示路径都先过这一道', () => {
  const filters: readonly TaskFilter[] = [
    { kind: 'all' },
    { kind: 'completed' },
    { kind: 'today' },
    { kind: 'next7Days' },
  ];

  for (const filter of filters) {
    it(`filterTasks(${filter.kind}) 不出现已放弃`, () => {
      expect(ids(filterTasks(MIXED, filter, { now: NOW }))).not.toContain('dropped');
    });
  }

  it('sectionTasks 不出现已放弃', () => {
    // `TaskSections` 是**四个具名数组**（overdue/dueToday/inbox/completed），不是 section 列表。
    const seen = Object.values(sectionTasks(MIXED, { now: NOW })).flatMap(ids);
    expect(seen).not.toContain('dropped');
    expect(seen).toContain('plain');
  });

  it('groupTasksByDate 不出现已放弃（日历/分组那一族）', () => {
    const groups = groupTasksByDate(
      [
        makeTask({ id: 'plain', dueDate: NOW }),
        makeTask({ id: 'dropped', dueDate: NOW, abandonedAt: NOW }),
      ],
      { now: NOW },
    );
    expect(groups.flatMap((group) => ids(group.tasks))).toEqual(['plain']);
  });

  it('searchTasks 不出现已放弃', () => {
    expect(ids(searchTasks(MIXED, '放弃'))).not.toContain('dropped');
  });

  it('🔴 **空查询那条分支也要滤** —— 它是"返回全部"，不是"返回整张表"', () => {
    // 这一条单独钉，因为"空查询直接返回入参"是最容易顺手写出来的形状，
    // 而它的症状是"搜一下才消失，不搜还在"。
    expect(ids(searchTasks(MIXED, '   '))).not.toContain('dropped');
  });

  it('bucketByQuadrant 不出现已放弃，也不出现已软删', () => {
    const buckets = bucketByQuadrant(MIXED, { now: NOW });
    const seen = Object.values(buckets).flatMap(ids);
    expect(seen).not.toContain('dropped');
    expect(seen).not.toContain('trashed');
    expect(seen).toEqual(['plain']);
  });
});

describe('置顶只在组内前置，不跨组搬运', () => {
  it('日期分组由到期日决定，置顶改不了它落在哪一组', () => {
    const tomorrow = NOW + DAY;
    // 🔴 先按出口的排法排一次 —— `groupTasksByDate` 刻意**保持入参顺序**，
    //    所以"组内置顶在前"是出口（`listTasks()` 用 `byPinnedFirst`）给的，
    //    不是分组给的。把排序写进分组会变成第二处顺序裁决，而两处的次级判据
    //    迟早对不上。
    const sorted = [
      makeTask({ id: 'today-a', dueDate: NOW }),
      makeTask({ id: 'today-b', dueDate: NOW, pinnedAt: NOW }),
      makeTask({ id: 'tomorrow-c', dueDate: tomorrow }),
    ].sort(byPinnedFirst<Task>(byCreatedAtOrder));

    const groups = groupTasksByDate(sorted, { now: NOW });
    const today = groups.find((g) => ids(g.tasks).includes('today-a'));
    expect(today).toBeDefined();
    // 置顶的 today-b 排在同组最前，而 tomorrow-c **没有**因为没置顶就掉出它的组。
    expect(ids(today!.tasks)).toEqual(['today-b', 'today-a']);
    // ⚠️ 这里不能用 `toContain(['tomorrow-c'])`：`toContain` 走 SameValueZero，
    //    数组元素永远不相等，那条断言会**永远红**（写它的时候先确认它能绿）。
    expect(groups.some((g) => ids(g.tasks).join() === 'tomorrow-c')).toBe(true);
  });
});
