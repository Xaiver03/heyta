/**
 * 清单内分组的领域规则（ADR-0091）
 * ==================================
 *
 * 盯的是三类**静默失效**（本地看起来都对，用户看到的却不对）：
 *   1. 分组排序不确定 → 同一份数据在两台设备上顺序不同（`createdAt` 同毫秒很常见）。
 *   2. 悬空 `sectionId` 不归「未分组」→ 删了分组之后，其下任务既不在原组也不在未分组，直接消失。
 *   3. 标题校验写两处 / 上限写两个数 → 界面允许提交、动作层拒绝（或反过来）。
 *
 * 这三条判定必须住在领域层且只有一份 —— 动作层、本机 API、UI 都从这里取，
 * 谁再抄一份，就是"删掉的分组在手机上让任务消失"那类没有报错的 bug 的来源。
 */

import { describe, expect, it } from 'vitest';

import {
  SECTION_NAME_MAX_LENGTH,
  bySectionOrder,
  groupTasksBySection,
  nextSectionOrder,
  normalizeSectionName,
  resolveTaskSectionId,
  sectionRejection,
  sectionsOfProject,
  type SectionLike,
  type SectionTaskLike,
} from '../src/index.js';

const section = (id: string, over: Partial<SectionLike> = {}): SectionLike => ({
  id,
  projectId: 'p-1',
  name: `分组 ${id}`,
  createdAt: 1_000,
  ...over,
});

const task = (id: string, over: Partial<SectionTaskLike> = {}): SectionTaskLike => ({
  id,
  projectId: 'p-1',
  ...over,
});

describe('标题校验（闸门不是玩法）', () => {
  it.each(['', '   ', '\n', '\t \n'])('空白标题 %j 被拒绝（trim 后判断）', (name) => {
    expect(sectionRejection(name)).toBe('empty');
  });

  it('上限边界：恰好 60 字合法，61 字拒绝', () => {
    expect(sectionRejection('好'.repeat(SECTION_NAME_MAX_LENGTH))).toBeUndefined();
    expect(sectionRejection('好'.repeat(SECTION_NAME_MAX_LENGTH + 1))).toBe('too-long');
  });

  it('普通标题通过', () => {
    expect(sectionRejection('新手入门')).toBeUndefined();
  });

  it('🔴 上限是 60 —— 这个数字只有一份定义', () => {
    expect(SECTION_NAME_MAX_LENGTH).toBe(60);
  });

  it('归一化去掉首尾空白（写载荷用它；校验仍走 sectionRejection）', () => {
    expect(normalizeSectionName('  新手入门  ')).toBe('新手入门');
  });
});

describe('按清单取分组：归属过滤 + 存活过滤 + 顺序', () => {
  it('只给该清单的分组', () => {
    const all = [section('a'), section('b', { projectId: 'p-2' })];
    expect(sectionsOfProject(all, 'p-1').map((s) => s.id)).toEqual(['a']);
  });

  it('软删的分组不出现（四态语义 ADR-0048：deletedAt = 墓碑）', () => {
    const all = [section('a'), section('gone', { deletedAt: 2_000 })];
    expect(sectionsOfProject(all, 'p-1').map((s) => s.id)).toEqual(['a']);
  });

  it('🔴 已彻底删除（purgedAt）的也不出现（purge 只作用在软删实体上，isLive 一并滤掉）', () => {
    const purged = section('purged', { deletedAt: 2_000, purgedAt: 3_000 });
    const all = [section('a'), purged];
    expect(sectionsOfProject(all, 'p-1').map((s) => s.id)).toEqual(['a']);
  });

  it('空分组**保留**（用户建完组还没拖任务进去，组不能消失）', () => {
    const all = [section('empty')];
    expect(sectionsOfProject(all, 'p-1').map((s) => s.id)).toEqual(['empty']);
  });

  it('order 升序；缺席 order 的排在显式值之后', () => {
    const all = [
      section('none'),
      section('two', { order: 2 }),
      section('zero', { order: 0 }),
    ];
    expect(sectionsOfProject(all, 'p-1').map((s) => s.id)).toEqual(['zero', 'two', 'none']);
  });

  it('🔴 同 order / 同 createdAt 时按 id 字典序兜底 —— 少了这一段两端会换位', () => {
    const all = [
      section('c', { order: 0, createdAt: 2_000 }),
      section('b', { order: 0, createdAt: 2_000 }),
      section('a', { order: 0, createdAt: 2_000 }),
    ];
    expect(sectionsOfProject(all, 'p-1').map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('比较器单独可用，且与 sectionsOfProject 同一份（不是第二份实现）', () => {
    const all = [section('b', { order: 1 }), section('a', { order: 0 })];
    const viaComparator = [...all].sort(bySectionOrder).map((s) => s.id);
    expect(viaComparator).toEqual(sectionsOfProject(all, 'p-1').map((s) => s.id));
  });
});

describe('下一个 order：现有显式最大值 + 1（不看个数）', () => {
  it('全都没设过 order ⇒ 0', () => {
    expect(nextSectionOrder([section('a'), section('b')], 'p-1')).toBe(0);
  });

  it('显式最大值 + 1（删掉中间一个不会让新旧分组撞序）', () => {
    const all = [section('a', { order: 0 }), section('b', { order: 4 }), section('c', { order: 2 })];
    expect(nextSectionOrder(all, 'p-1')).toBe(5);
  });

  it('只看本清单（别的清单的更大 order 不参与）', () => {
    const all = [section('a', { order: 1 }), section('x', { projectId: 'p-2', order: 99 })];
    expect(nextSectionOrder(all, 'p-1')).toBe(2);
  });
});

describe('任务归组：悬空 sectionId 归「未分组」，不丢', () => {
  it('指向存活且同清单的分组 ⇒ 归那一组', () => {
    const sections = [section('s-1')];
    expect(resolveTaskSectionId(task('t', { sectionId: 's-1' }), sections)).toBe('s-1');
  });

  it('没有 sectionId ⇒ 未分组（undefined）', () => {
    expect(resolveTaskSectionId(task('t'), [section('s-1')])).toBeUndefined();
  });

  it('🔴 指向已软删的分组 ⇒ 未分组（删组之后任务不能消失）', () => {
    const sections = [section('s-gone', { deletedAt: 2_000 })];
    expect(resolveTaskSectionId(task('t', { sectionId: 's-gone' }), sections)).toBeUndefined();
  });

  it('🔴 指向不存在的分组 ⇒ 未分组', () => {
    expect(resolveTaskSectionId(task('t', { sectionId: 'nope' }), [section('s-1')])).toBeUndefined();
  });

  it('🔴 分组属于**别的清单** ⇒ 未分组（同一字段不能同时表达"这条清单的分组"与"另一条清单的分组"）', () => {
    const sections = [section('s-other', { projectId: 'p-2' })];
    expect(resolveTaskSectionId(task('t', { sectionId: 's-other' }), sections)).toBeUndefined();
  });

  it('groupTasksBySection：每存活分组一组（含空组），悬空归未分组且未分组在最后', () => {
    const sections = [section('s-1', { order: 0 }), section('s-empty', { order: 1 })];
    const tasks = [
      task('t-in', { sectionId: 's-1' }),
      task('t-dangling', { sectionId: 'gone' }),
      task('t-none'),
      task('t-other-list', { projectId: 'p-2', sectionId: 's-1' }),
    ];
    const groups = groupTasksBySection(tasks, sections, 'p-1');
    expect(groups.map((g) => g.sectionId)).toEqual(['s-1', 's-empty', undefined]);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(['t-in']);
    expect(groups[1]?.tasks).toEqual([]); // 空分组保留
    expect(groups[2]?.tasks.map((t) => t.id).sort()).toEqual(['t-dangling', 't-none']);
    // 别的清单的任务不串进来
    expect(groups.flatMap((g) => g.tasks.map((t) => t.id))).not.toContain('t-other-list');
  });

  it('一条任务都没有时不画「未分组 0」（纯噪音）', () => {
    const groups = groupTasksBySection([], [section('s-1')], 'p-1');
    expect(groups.map((g) => g.sectionId)).toEqual(['s-1']);
  });

  it('软删的任务不进任何组', () => {
    const sections = [section('s-1')];
    const tasks = [task('t-gone', { sectionId: 's-1', deletedAt: 2_000 }), task('t-live', { sectionId: 's-1' })];
    const groups = groupTasksBySection(tasks, sections, 'p-1');
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(['t-live']);
  });

  it('不修改入参（排序发生在过滤出来的新数组上）', () => {
    const sections = [section('b', { order: 1 }), section('a', { order: 0 })];
    const before = sections.map((s) => s.id);
    sectionsOfProject(sections, 'p-1');
    expect(sections.map((s) => s.id)).toEqual(before);
  });

  it('没有分组 / 没有任务时返回空数组（读不是门，不抛错）', () => {
    expect(groupTasksBySection([], [], 'p-1')).toEqual([]);
    expect(sectionsOfProject([], 'p-1')).toEqual([]);
  });
});
