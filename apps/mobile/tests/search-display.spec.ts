/**
 * 移动端搜索面板的文案接线测试
 * ============================
 *
 * 🔴 防的不是"搜错了"（判据在 `@heyta/domain/search.ts`，有自己的测试），
 * 防的是**移动端对触屏用户说谎**：
 *
 *   1. **不许有 `keyHints`。** ↑↓ / ↵ / esc 是三件手机上没有的东西。
 *      共享面板对"没传"的形态不渲染那排芯片 —— 一旦有人为了"看起来完整"
 *      把它补上，界面上就会出现一排永远按不到的键。
 *   2. **`noResults` 必须是移动端那条。** web 那句写着"任务、便签或**入口**"，
 *      而这里没有「快速跳转」那一组。这条断言读的是**成品字符串**，
 *      所以将来谁把词条改回共用那句，它会红 —— 而不是等用户去找那个不存在的分组。
 *   3. **行级文案与列表页同一份。** 搜索结果里的任务行不该说另一套话。
 */

import { translate, type MessageKey } from '@heyta/i18n';
import { describe, expect, it } from 'vitest';

import { searchPanelLabels } from '../src/lib/search-display';

/** 与界面同一条路：走真的词条表（缺 key 会**抛**，不是返回空串）。 */
const zh = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

const taskRow = {
  toggleOn: (row: { title: string }): string => `完成：${row.title}`,
  toggleOff: (row: { title: string }): string => `撤销完成：${row.title}`,
  open: (row: { title: string }): string => `打开：${row.title}`,
};

describe('searchPanelLabels：映射到共享 SearchPanel 契约', () => {
  it('🔴 触屏端**没有**键位提示，所以这个字段必须整个缺席', () => {
    const labels = searchPanelLabels(zh, taskRow);
    // `'keyHints' in labels` 而不是 `labels.keyHints === undefined`：
    // 显式写成 `keyHints: undefined` 也算"传了"，共享层将来若改成
    // `keyHints !== undefined ? … : …` 之外的判据（比如 `'keyHints' in labels`）
    // 就会把芯片画出来。
    expect('keyHints' in labels).toBe(false);
  });

  it('🔴 空结果说的是"任务或便签"，不许提移动端给不出的「入口」', () => {
    expect(searchPanelLabels(zh, taskRow).noResults).toBe('没有找到匹配的任务或便签。');
    expect(searchPanelLabels(en, taskRow).noResults).toBe('No matching tasks or notes.');
    // 反向钉住"为什么不能直接用 web 那条"：web 那句确实提了入口。
    expect(zh('web.search.noResults')).toContain('入口');
    expect(en('web.search.noResults')).toMatch(/places to go/i);
  });

  it('面板本体的文案仍与 web 同源（同一块界面，不抄第二份）', () => {
    const labels = searchPanelLabels(zh, taskRow);
    expect(labels.title).toBe(zh('web.search.title'));
    expect(labels.placeholder).toBe(zh('web.search.placeholder'));
    expect(labels.prompt).toBe(zh('web.search.prompt'));
    expect(labels.tasksSection).toBe(zh('web.search.tasksSection'));
    expect(labels.notesSection).toBe(zh('web.search.notesSection'));
    expect(labels.quickSection).toBe(zh('web.search.quickSection'));
  });

  it('条数文案带得上数字，且中英各自走自己的词条', () => {
    expect(searchPanelLabels(zh, taskRow).count(3)).toBe('3 条');
    expect(searchPanelLabels(en, taskRow).count(3)).toBe('3');
  });

  it('行级文案原样转交（同一个对象，不重新构造一遍）', () => {
    const labels = searchPanelLabels(zh, taskRow);
    expect(labels.taskRow).toBe(taskRow);
    expect(labels.taskRow.toggleOn({ title: '买牛奶' })).toBe('完成：买牛奶');
  });
});
