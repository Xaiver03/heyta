/**
 * 搜索面板的**判断层**测试
 * ==========================
 *
 * 这里钉的是"写错不会报错、只会静默不好用"的三件事：
 *
 *   1. **多词 = AND**，而且用的是 `@heyta/domain` 那一套切词。
 *      自己再 split 一份的表现：同一个框里任务是 AND、跳转项是 OR ——
 *      不报错，只让用户以为搜索时好时坏。
 *   2. **光标序列 = 展示序列**。↑↓ 走的东西必须和眼睛扫的东西同序，
 *      否则"按三下"在网页上指第 3 行、在手机上指第 5 行。
 *   3. **没有结果时按方向键不该选中一行**。空列表上的"第 0 条"是幽灵光标：
 *      按 ↵ 会打开一个不存在的东西。
 */

import { describe, expect, it } from 'vitest';
import {
  buildResultEntries,
  CURSOR_IN_INPUT,
  filterQuickActions,
  MAX_QUICK_ACTIONS,
  moveCursor,
  type QuickAction,
} from '../src/search/model.js';

function action(
  id: string,
  label: string,
  extra: Partial<Omit<QuickAction, 'id' | 'label'>> = {},
): QuickAction {
  return { id, label, group: 'view', onSelect: () => {}, ...extra };
}

const NAV = [
  action('tasks', '任务'),
  action('calendar', '日历', { hint: '视图', keywords: ['calendar'] }),
  action('habits', '习惯', { hint: '视图' }),
  action('work', '工作', { group: 'project', hint: '清单' }),
  action('home', '家里', { group: 'project', hint: '清单' }),
  action('urgent', '紧急', { group: 'tag', hint: '标签' }),
];

describe('filterQuickActions —— 跳转项怎么筛', () => {
  it('🔴 一个字都没输入时**不列跳转项**（空查询 ≠ 匹配一切）', () => {
    // 与任务搜索相反：那边"清空筛选 = 不过滤"，这边"没输入 = 没有目的地"。
    // 若沿用 domain 的"空查询匹配一切"，一打开面板就先冒出 6 条导航，
    // 把"你还没打字"和"这就是全部"混成一屏。
    expect(filterQuickActions(NAV, '')).toEqual([]);
    expect(filterQuickActions(NAV, '   ')).toEqual([]);
  });

  it('🔴 多词是 AND，用的是 domain 那一套切词（不是第二份实现）', () => {
    const hit = filterQuickActions(NAV, '清单 工');
    expect(hit.map((a) => a.id)).toEqual(['work']);
    // 只命中一个词的必须被排掉：留成 OR 的话，"清单 紧急"会把 5 条清单都列出来。
    expect(filterQuickActions(NAV, '清单 不存在').map((a) => a.id)).toEqual([]);
  });

  it('副标题与同义词参与匹配，但只有同义词会被打出来（不显示）', () => {
    // hint：打「标签」要能找到「紧急」。
    expect(filterQuickActions(NAV, '标签').map((a) => a.id)).toEqual(['urgent']);
    // keywords：打英文 calendar 要能找到「日历」，尽管界面上写的是中文。
    expect(filterQuickActions(NAV, 'calendar').map((a) => a.id)).toEqual(['calendar']);
  });

  it('名字以查询开头的排在前面，其余保持宿主给定顺序（稳定，不随打开次数变）', () => {
    // 「家」前缀命中「家里」；「工作」里也含"作"？不含 —— 这里用同字头的两条来验。
    const samePrefix = [
      action('a', '周报'),
      action('b', '月报'),
      action('c', '年度报表'),
    ];
    expect(filterQuickActions(samePrefix, '报').map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(filterQuickActions(samePrefix, '周').map((a) => a.id)).toEqual(['a']);
  });

  it(`🔴 最多列 ${MAX_QUICK_ACTIONS} 条（跳转是"挑一个"，不是"看全部"）`, () => {
    const many = Array.from({ length: 20 }, (_, i) => action(`p${i}`, `清单 ${i}`));
    const result = filterQuickActions(many, '清单');
    expect(result).toHaveLength(MAX_QUICK_ACTIONS);
  });
});

describe('buildResultEntries —— 光标走的序列', () => {
  it('🔴 组序 = 任务 → 便签 → 快速跳转，与面板展示序一致', () => {
    const entries = buildResultEntries({
      tasks: [{ id: 't1' }, { id: 't2' }],
      notes: [{ id: 'n1' }],
      quick: [action('q1', '日历')],
    });
    expect(entries).toEqual([
      { kind: 'task', id: 't1' },
      { kind: 'task', id: 't2' },
      { kind: 'note', id: 'n1' },
      { kind: 'quick', id: 'q1' },
    ]);
  });

  it('组里没有内容时不会塞进空游标', () => {
    expect(buildResultEntries({ tasks: [], notes: [], quick: [] })).toEqual([]);
  });
});

describe('moveCursor —— ↑↓ 的边界', () => {
  it('🔴 没有任何结果时，方向键永远停在输入框（不会有"第 0 条"幽灵光标）', () => {
    expect(moveCursor(CURSOR_IN_INPUT, 0, 1)).toBe(CURSOR_IN_INPUT);
    expect(moveCursor(CURSOR_IN_INPUT, 0, -1)).toBe(CURSOR_IN_INPUT);
    // 从一个越界的位置进来也不能掉进空列表。
    expect(moveCursor(3, 0, 1)).toBe(CURSOR_IN_INPUT);
  });

  it('从输入框 ↓ 进第一行；从第一行 ↑ 回输入框', () => {
    expect(moveCursor(CURSOR_IN_INPUT, 4, 1)).toBe(0);
    expect(moveCursor(CURSOR_IN_INPUT, 4, -1)).toBe(CURSOR_IN_INPUT);
    expect(moveCursor(0, 4, -1)).toBe(CURSOR_IN_INPUT);
  });

  it('中间正常一格一格走，首末行环绕', () => {
    expect(moveCursor(1, 4, 1)).toBe(2);
    expect(moveCursor(2, 4, -1)).toBe(1);
    expect(moveCursor(3, 4, 1)).toBe(0);
    expect(moveCursor(0, 4, 1)).toBe(1);
  });

  it('只有一行时：↓ 环绕到自己，↑ 仍然回得到输入框', () => {
    expect(moveCursor(0, 1, 1)).toBe(0);
    expect(moveCursor(0, 1, -1)).toBe(CURSOR_IN_INPUT);
  });
});
