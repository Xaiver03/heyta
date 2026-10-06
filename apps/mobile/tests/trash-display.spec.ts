/**
 * 回收站展示逻辑 / 二次确认门禁的单测
 * =====================================
 *
 * 领域语义（`purge` 写什么、`listTrashed` 滤掉什么、恢复为什么可同步）
 * 已经在 `packages/app-host/tests/trash-actions.spec.ts` 里钉过；
 * "两路数据源怎么并、`deletedAt` 的回退、徽标用哪个实体名"在
 * `packages/ui/tests/trash-model.spec.ts` —— 这里都不重复。
 *
 * 这个文件测的是**移动端独有的那一层**，而它的错误全部是"安静"的：
 *
 *   - `pendingPurge` 的门禁失效 → 一次误触就把不可逆动作做出去了；
 *   - `notErasure` 被删掉/换成 Web 那句更短的措辞 → 界面**照样渲染**，
 *     只是对用户说了一句不实的话（"数据被物理删除了"）；
 *   - 徽标不走共享的 `entityLabelOf`（= `common.entity.*`）→ 同一行里两种叫法（P-6）。
 *
 * 🔴 每条断言都**同时覆盖中英**（与 `tests/growth-display.spec.ts` 同一纪律）：
 * 只测一种语言的话，英文词条写成中文、或 en 表漏一条 key，测试会全绿，
 * 而英文界面是坏的。
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { translate } from '@heyta/i18n';
import type { TrashItem } from '@heyta/domain';

import {
  deletedAtText,
  purgeImpactText,
  pendingPurge,
  purgeA11y,
  purgeConfirmCopy,
  restoreA11y,
} from '../src/lib/trash-display';
// 徽标那张表在共享层：`lib/` 不能值引入 `@heyta/ui`（会把 react-native 拖进
// node 环境），所以宿主里那一格与这条判据都直接问同一份表 —— 路径同 conflict-keys。
import { entityLabelOf } from '../../../packages/ui/src/sync/model';
import type { Translate } from '../src/i18n/translate';

const zhT: Translate = (key, vars) => translate('zh-CN', key, vars);
const enT: Translate = (key, vars) => translate('en', key, vars);

/** 2026-09-27 21:30 的**本地**时间戳。用本地构造，断言就与时区无关。 */
const STAMP = new Date(2026, 8, 27, 21, 30).getTime();

function item(over: Partial<TrashItem> = {}): TrashItem {
  return {
    id: 't1',
    kind: 'TASK',
    title: '买牛奶',
    deletedAt: STAMP,
    ...over,
  };
}

describe('deletedAtText', () => {
  it('渲染「删除于 9-27 21:30」，中英都对', () => {
    expect(deletedAtText(item(), zhT)).toBe('删除于 9-27 21:30');
    expect(deletedAtText(item(), enT)).toBe('Deleted 9-27 21:30');
    expect(deletedAtText(item(), zhT)).not.toContain('NaN');
  });
});

describe('徽标：回收站那一格的取值只有 common.entity.* 一个真源', () => {
  it('🔴 任务 / 便签中英都拿实体名词条（P-6 统一叫「便签」）', () => {
    expect(entityLabelOf('TASK', zhT)).toBe('任务');
    expect(entityLabelOf('NOTE', zhT)).toBe('便签');
    expect(entityLabelOf('TASK', enT)).toBe('Task');
    expect(entityLabelOf('NOTE', enT)).toBe('Note');
  });

  it('中文徽标不许是"笔记"（界面其它 25 处都叫便签，两种叫法不能同屏）', () => {
    expect(entityLabelOf('NOTE', zhT)).not.toBe('笔记');
  });
});

describe('按钮无障碍名带标题（列表里重复的按钮不能都叫「恢复」）', () => {
  it('中英各自带进 title', () => {
    const zhItem = item();
    expect(restoreA11y(zhItem, zhT)).toBe('恢复：买牛奶');
    expect(purgeA11y(zhItem, zhT)).toBe('彻底删除：买牛奶');

    // 英文断言用英文标题：标题是**用户自己的字**，不会被翻译 ——
    // 拿中文标题去断言英文词条等于在断言"标题被翻译了"，那是错的。
    const enItem = item({ title: 'Buy milk' });
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
  const items = [item({ id: 'a' }), item({ id: 'b', kind: 'NOTE', title: '买菜' })];

  it('🔴 没有 confirmingId → undefined（界面就没有可执行的 purge 目标）', () => {
    expect(pendingPurge(items, undefined)).toBeUndefined();
  });

  it('🔴 confirmingId 指向不存在的条目 → undefined（不删错、不静默失败）', () => {
    expect(pendingPurge(items, 'not-in-list')).toBeUndefined();
  });

  it('confirmingId 指向列表里的那一条 → 返回它本身（不是副本）', () => {
    expect(pendingPurge(items, 'b')).toBe(items[1]);
  });

  it('便签那条也在同一张列表里，确认框拿到的就是便签（不是任务）', () => {
    const pending = pendingPurge(items, 'b');
    expect(pending?.kind).toBe('NOTE');
    expect(pending?.title).toBe('买菜');
  });
});

describe('W4 影响面那一句（删容器不删内容，界面上要说得出）', () => {
  const row = (over: Partial<TrashItem>): TrashItem => ({
    id: 'x-1',
    kind: 'PROJECT',
    title: '搬家',
    deletedAt: 1_700_000_000_000,
    ...over,
  });

  it('🔴 清单：说出**几条**任务，中英文都把数字带进去', () => {
    const zh = purgeImpactText(row({ kind: 'PROJECT' }), zhT, 2);
    const en = purgeImpactText(row({ kind: 'PROJECT' }), enT, 2);

    expect(zh).toContain('里面还有 2 条任务');
    expect(en?.toLowerCase()).toContain('2 task');
    // 那句必须同时说"不会被删除"，否则它只是报了个数、没回答用户真正怕的事。
    expect(zh).toContain('不会被删除');
  });

  it('🔴 习惯：说打卡记录不会被删', () => {
    expect(purgeImpactText(row({ kind: 'HABIT' }), zhT, 0)).toContain('打卡记录');
    expect(purgeImpactText(row({ kind: 'HABIT' }), enT, 0)?.toLowerCase()).toContain(
      'check-in records',
    );
  });

  it('🔴 任务与便签**没有**这一句 ⇒ undefined，而不是空串', () => {
    // 空串会渲染成一行空白 —— 于是"这一类本来没有影响面"与"文案丢了"
    // 在界面上长得一模一样，而下一种坏法没人会去找。
    expect(purgeImpactText(row({ kind: 'TASK' }), zhT, 3)).toBeUndefined();
    expect(purgeImpactText(row({ kind: 'NOTE' }), zhT, 3)).toBeUndefined();
    // 正向对照：同一趟里清单那条必须在（不然上面两条只是"整个函数坏了"）。
    expect(purgeImpactText(row({ kind: 'PROJECT' }), zhT, 3)).toBeDefined();
  });

  it('purgeConfirmCopy：传了 impact 才有那个键（不传 ⇒ 键不存在）', () => {
    expect(purgeConfirmCopy('搬家', zhT, '里面还有 2 条任务，它们不会被删除。').impact).toBe(
      '里面还有 2 条任务，它们不会被删除。',
    );
    const plain = purgeConfirmCopy('买牛奶', zhT);
    expect(plain.impact).toBeUndefined();
    expect('impact' in plain).toBe(false);
  });
});

describe('W4 接线：四路都真的连着，且界面用到了影响面那一句', () => {
  const screen = readFileSync(new URL('../src/screens/TrashScreen.tsx', import.meta.url), 'utf8');

  it('🔴 路由表必须四路齐（加一类忘接线在这里是编译错误，也要有一条判据）', () => {
    for (const kind of ['TASK:', 'NOTE:', 'PROJECT:', 'HABIT:']) {
      expect(screen).toContain(kind);
    }
    // 穷尽表的形式本身：少了 `Record<TrashKind, …>`，"少一路"就退回成不报错。
    expect(screen).toContain('satisfies Record<');
    expect(screen).toContain('byKind[item.kind][action](item.id)');
  });

  it('🔴 数据源四路都递进 toTrashItems，且清单那句的 N 由共享层算', () => {
    for (const call of [
      'taskActions.listTrashed()',
      'noteActions.listTrashed()',
      'projectActions.listTrashedProjects()',
      'habitActions.listTrashedHabits()',
    ]) {
      expect(screen).toContain(call);
    }
    expect(screen).toContain('liveTaskCountOfProject(taskActions.listTasks()');
    expect(screen).toContain('purgeImpactText(');
    // 界面上**用**到了它（只算不画 = 用户什么都看不见）。
    expect(screen).toContain('copy.impact === undefined ? null');
    expect(screen).toContain('{copy.impact}');
  });
});
