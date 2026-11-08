/**
 * ⌘Z 失败说明的映射钉子（R19 / `historyNoticeFor`）
 * ==================================================
 *
 * 这枚函数只有一条职责：把 `UndoOutcome` 的四态翻译成一个 i18n key，或"什么都不说"。
 * 它值得单独测，因为**漏一档的表现是静默**：用户按 ⌘Z 没反应，也没有任何报错，
 * 谁都不会为此提 bug。
 *
 * 三条判据，每条都写了"读反了会长成什么样"：
 *
 * 1. `applied` / `empty` → `undefined`（**成功不弹、空栈不弹**）。
 *    读反了：每次 ⌘Z 都弹一句"已撤销"，或者空栈误按也弹一下 —— 后者把误按变成打扰。
 * 2. `stale` 两档必须**给出不同的 key**（"没了" vs "被别人改过"）。
 *    读反了：合成一句"撤销失败"，用户不知道该先看还是该重新建。
 * 3. `unsupported` 六档必须**两两不同且都不是 undefined**。
 *    读反了：批量与快照说同一句；或者某一档漏进 default 变成静默。
 *    🔴 这里用集合长度断言，而不是逐个比对字面量 —— 逐对比对会在加档时被顺手放宽。
 */

import { describe, expect, it } from 'vitest';
import type { HistorySkipReason, UndoOutcome } from '@heyta/op-log';

import { historyNoticeFor } from '../src/lib/feedback/history-notice.js';

const SKIP_REASONS: HistorySkipReason[] = [
  'batch',
  'snapshot',
  'multi-entity',
  'unmodeled',
  'non-object-payload',
  'unsupported-op',
];

const target = { entityType: 'TASK', entityId: 't1', opType: 'UPD', timestamp: 1 };

describe('historyNoticeFor', () => {
  it('成功什么都不说（撤销的证据是界面变回去了）', () => {
    const applied: UndoOutcome = { status: 'applied', opId: 'op-1', target };
    expect(historyNoticeFor(applied)).toBeUndefined();
  });

  it('空栈也什么都不说（误按 ⌘Z 不该被打扰）', () => {
    expect(historyNoticeFor({ status: 'empty' })).toBeUndefined();
  });

  it('🔴 stale 两档各说各的：没了 / 被别的设备改过', () => {
    const missing = historyNoticeFor({ status: 'stale', reason: 'entity-missing' });
    const changed = historyNoticeFor({ status: 'stale', reason: 'entity-changed' });
    expect(missing).toBeDefined();
    expect(changed).toBeDefined();
    expect(missing).not.toBe(changed);
  });

  it('🔴 unsupported 每一档都有话说，且六档两两不同（不许出现"什么都没说"的档）', () => {
    const keys = SKIP_REASONS.map((reason) =>
      historyNoticeFor({ status: 'unsupported', reason }),
    );
    // 没有一档是 undefined
    expect(keys.filter((k) => k === undefined)).toEqual([]);
    // 两两不同：6 个原因 → 6 个不同的 key
    expect(new Set(keys).size).toBe(SKIP_REASONS.length);
  });

  it('每一档都落在 web.feedback.history.* 命名空间（界面文案的唯一出口）', () => {
    const all: (string | undefined)[] = [
      ...SKIP_REASONS.map((reason) => historyNoticeFor({ status: 'unsupported', reason })),
      historyNoticeFor({ status: 'stale', reason: 'entity-missing' }),
      historyNoticeFor({ status: 'stale', reason: 'entity-changed' }),
    ];
    for (const key of all) {
      expect(key).toMatch(/^web\.feedback\.history\./);
    }
  });
});
