/**
 * 英文单复数词条对
 * ==================
 *
 * 🔴 词条表**刻意不支持复数/ICU**（理由见 `packages/i18n/src/types.ts`：
 * 加一套复数规则会把"零运行时依赖的可替换词条表"变成一个语言运行时）。
 * 于是做法是**调用方按数量分支到单数兄弟词条**：
 *
 *     t(count === 1 ? 'x.oneKey' : 'x.manyKey', { count })
 *
 * 这个文件钉住的是词条**内容**：单数词条里不能再出现复数的名词
 * （"1 items" 这种句子看起来仍然通顺，所以只有显式断住坏形状才有用），
 * 以及中文的单数兄弟词条与复数版**刻意逐字相同**（中文本来就不分单复数，
 * 不相同才是漏翻）。
 *
 * ⚠️ **已知边界**：这里测不到"调用点有没有真的分支"。`badge.count` /
 * `pending.count` / `dayWithTasks` / `conflict.title` 四个调用点在 React 组件里，
 * 而本仓库的移动端测试**刻意不 import `react-native`**（在 node 里加载它直接
 * 解析失败），所以那四处只有 `tsc` + `check-ui-language` 兜着。
 * 两个纯函数调用点（`remainingText`、`describeSyncStatus`）的分支
 * 在各自的 spec 里真的跑了 1 与 N 两种输入。
 */

import { describe, expect, it } from 'vitest';
import { translate } from '@heyta/i18n';

const zh = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

describe('单数兄弟词条', () => {
  it('badge.count：1 个是 `1 item`，不是 `1 items`', () => {
    expect(en('mobile.common.badge.countOne', { count: 1 })).toBe('1 item');
    expect(en('mobile.common.badge.count', { count: 3 })).toBe('3 items');
    expect(en('mobile.common.badge.countOne', { count: 1 })).not.toContain('1 items');
    // 中文两条刻意相同。
    expect(zh('mobile.common.badge.countOne', { count: 1 })).toBe('1 项');
    expect(zh('mobile.common.badge.count', { count: 1 })).toBe('1 项');
  });

  it('profile.pending.count：`待上传` 为 1 时同上', () => {
    expect(en('mobile.profile.pending.countOne', { count: 1 })).toBe('1 item');
    expect(en('mobile.profile.pending.count', { count: 3 })).toBe('3 items');
    expect(en('mobile.profile.pending.countOne', { count: 1 })).not.toContain('1 items');
    expect(zh('mobile.profile.pending.countOne', { count: 1 })).toBe(
      zh('mobile.profile.pending.count', { count: 1 }),
    );
  });

  it('due.overdue：逾期 1 天是 `1 day overdue`', () => {
    expect(en('mobile.due.overdueOne', { days: 1 })).toBe('1 day overdue');
    expect(en('mobile.due.overdue', { days: 3 })).toBe('3 days overdue');
    expect(en('mobile.due.overdueOne', { days: 1 })).not.toContain('1 days');
    expect(zh('mobile.due.overdueOne', { days: 1 })).toBe('已逾期 1 天');
  });

  it('calendar.a11y.dayWithTasks：某天恰好 1 个任务是 `1 task`', () => {
    expect(en('mobile.calendar.a11y.dayWithTasksOne', { date: '9/25', count: 1 })).toBe(
      '9/25, 1 task',
    );
    expect(en('mobile.calendar.a11y.dayWithTasks', { date: '9/25', count: 3 })).toBe(
      '9/25, 3 tasks',
    );
    expect(en('mobile.calendar.a11y.dayWithTasksOne', { date: '9/25', count: 1 })).not.toContain(
      '1 tasks',
    );
    expect(zh('mobile.calendar.a11y.dayWithTasksOne', { date: '9月25日', count: 1 })).toBe(
      '9月25日，1 个任务',
    );
  });

  it('conflict.title：只有 1 处冲突时不说 `these 1 places`', () => {
    // 这条英文的单数版**不用数字**（"this one place"），所以
    // 断言不能只写 `not.toContain('1 places')` —— 直接钉住整句。
    expect(en('mobile.conflict.titleOne')).toBe('Both sides changed this one place');
    expect(en('mobile.conflict.title', { count: 3 })).toBe('Both sides changed these 3 places');
    expect(en('mobile.conflict.titleOne')).not.toContain('places');
    expect(zh('mobile.conflict.titleOne', { count: 1 })).toBe('这 1 处改动两边都改过');
  });

  it('sync.conflict：1 处冲突是 `1 conflict`', () => {
    // 调用点的分支在 `sync-status-text.spec.ts` 里用真实输入跑过；
    // 这里只钉词条内容。
    expect(en('mobile.sync.conflictOne', { count: 1 })).toBe('You have 1 conflict to resolve');
    expect(en('mobile.sync.conflict', { count: 3 })).toBe('You have 3 conflicts to resolve');
    expect(en('mobile.sync.conflictOne', { count: 1 })).not.toContain('1 conflicts');
    expect(zh('mobile.sync.conflictOne', { count: 1 })).toBe('有 1 处冲突待你选择');
  });
});
