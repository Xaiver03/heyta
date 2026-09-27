/**
 * 回收站展示逻辑 / 二次确认门禁的单测
 * =====================================
 *
 * 领域语义（`purge` 写什么、`listTrashed` 滤掉什么、恢复为什么可同步）
 * 已经在 `packages/app-host/tests/actions.spec.ts` 里钉过 —— 这里不重复。
 *
 * 这个文件测的是**移动端独有的那一层**，而它的错误全部是"安静"的：
 *
 *   - `deletedAtText` 不兜底 `deletedAt` → 渲染出 `NaN-NaN`，看着像日期；
 *   - `pendingPurge` 的门禁失效 → 一次误触就把不可逆动作做出去了；
 *   - `notErasure` 被删掉/换成 Web 那句更短的措辞 → 界面**照样渲染**，
 *     只是对用户说了一句不实的话（"数据被物理删除了"）。
 *
 * 🔴 每条断言都**同时覆盖中英**（与 `tests/growth-display.spec.ts` 同一纪律）：
 * 只测一种语言的话，英文词条写成中文、或 en 表漏一条 key，测试会全绿，
 * 而英文界面是坏的。
 */

import { describe, expect, it } from 'vitest';

import { translate } from '@heyta/i18n';
import type { Task } from '@heyta/domain';

import {
  deletedAtText,
  pendingPurge,
  purgeA11y,
  purgeConfirmCopy,
  restoreA11y,
} from '../src/lib/trash-display';
import type { Translate } from '../src/i18n/translate';

const zhT: Translate = (key, vars) => translate('zh-CN', key, vars);
const enT: Translate = (key, vars) => translate('en', key, vars);

/** 2026-09-27 21:30 的**本地**时间戳。用本地构造，断言就与时区无关。 */
const STAMP = new Date(2026, 8, 27, 21, 30).getTime();

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '买牛奶',
    createdAt: STAMP - 60_000,
    updatedAt: STAMP,
    ...over,
  };
}

describe('deletedAtText', () => {
  it('有 deletedAt → 「删除于 9-27 21:30」，中英都对', () => {
    const item = task({ deletedAt: STAMP });
    expect(deletedAtText(item, zhT)).toBe('删除于 9-27 21:30');
    expect(deletedAtText(item, enT)).toBe('Deleted 9-27 21:30');
  });

  it('🔴 deletedAt 缺失时回退 updatedAt，而不是渲染 NaN-NaN', () => {
    const item = task({ updatedAt: STAMP });
    expect(deletedAtText(item, zhT)).toBe('删除于 9-27 21:30');
    expect(deletedAtText(item, enT)).toBe('Deleted 9-27 21:30');
    expect(deletedAtText(item, zhT)).not.toContain('NaN');
  });
});

describe('按钮无障碍名带标题（列表里重复的按钮不能都叫「恢复」）', () => {
  it('中英各自带进 title', () => {
    const zhItem = task();
    expect(restoreA11y(zhItem, zhT)).toBe('恢复：买牛奶');
    expect(purgeA11y(zhItem, zhT)).toBe('彻底删除：买牛奶');

    // 英文断言用英文标题：标题是**用户自己的字**，不会被翻译 ——
    // 拿中文标题去断言英文词条等于在断言"标题被翻译了"，那是错的。
    const enItem = task({ title: 'Buy milk' });
    expect(restoreA11y(enItem, enT)).toBe('Restore: Buy milk');
    expect(purgeA11y(enItem, enT)).toBe('Delete permanently: Buy milk');
  });
});

describe('purgeConfirmCopy', () => {
  it('五行齐全，且中英都不为空、互不相同', () => {
    const zh = purgeConfirmCopy('买牛奶', zhT);
    const en = purgeConfirmCopy('买牛奶', enT);

    for (const key of ['title', 'body', 'notErasure', 'submit', 'cancel'] as const) {
      expect(zh[key]).not.toBe('');
      expect(en[key]).not.toBe('');
      expect(zh[key]).not.toBe(en[key]);
    }
  });

  it('标题里带的是用户自己的标题', () => {
    expect(purgeConfirmCopy('买牛奶', zhT).title).toBe('彻底删除「买牛奶」？');
    expect(purgeConfirmCopy('买牛奶', enT).title).toBe('Delete “买牛奶” permanently?');
  });

  it('🔴 必须说出「不是物理擦除」—— 这是承重的一句，删掉它测试变红', () => {
    const zh = purgeConfirmCopy('买牛奶', zhT);
    const en = purgeConfirmCopy('买牛奶', enT);

    expect(zh.notErasure).toContain('不是物理擦除');
    expect(en.notErasure.toLowerCase()).toContain('not a physical erase');

    // 与「后果」那句必须是两句独立的话：合并之后这一条很容易在某次改文案时消失。
    expect(zh.notErasure).not.toBe(zh.body);
    expect(en.notErasure).not.toBe(en.body);

    // 且它要指明数据到底去哪了（op-log 里还在），不能只说"不是擦除"却不说是什么。
    expect(zh.notErasure).toContain('操作日志');
    expect(en.notErasure.toLowerCase()).toContain('operation log');
  });
});

describe('pendingPurge：不可逆动作的确认门禁', () => {
  const items = [task({ id: 'a' }), task({ id: 'b' })];

  it('🔴 没有 confirmingId → undefined（界面就没有可执行的 purge 目标）', () => {
    expect(pendingPurge(items, undefined)).toBeUndefined();
  });

  it('🔴 confirmingId 指向不存在的任务 → undefined（不删错、不静默失败）', () => {
    expect(pendingPurge(items, 'not-in-list')).toBeUndefined();
  });

  it('confirmingId 指向列表里的那一条 → 返回它本身（不是副本）', () => {
    expect(pendingPurge(items, 'b')).toBe(items[1]);
  });
});
