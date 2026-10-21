/**
 * M5 的偏好闸门：一组**到达**的活动里，哪些真的该吵到人。
 *
 * 🔴 判据的形状是"关着的那一档绝不能出现在结果里"，不是"开着的那档在"——
 * 后者对"谓词恒 `true`"这种坏法是瞎的（计划 §9.3 给 M5 写的那条红形就是这个）。
 * 两组都有，才对得起那条。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_PREFS,
  selectNotifiedActivities,
  type ShareActivityKind,
  type ShareNotificationPrefs,
} from '../src/sync/notification-model.js';

const withActivities = (over: Partial<ShareNotificationPrefs['activities']>): ShareNotificationPrefs => ({
  ...DEFAULT_NOTIFICATION_PREFS,
  activities: { ...DEFAULT_NOTIFICATION_PREFS.activities, ...over },
});

describe('selectNotifiedActivities · 偏好决定响不响（ADR-0062 决策 7）', () => {
  it('🔴 默认偏好（三档全关）⇒ 空数组：一次通知都不该发出去', () => {
    const arrived: ShareActivityKind[] = ['added', 'deleted', 'completed'];
    expect(selectNotifiedActivities(DEFAULT_NOTIFICATION_PREFS, arrived)).toEqual([]);
  });

  it('🔴 只开"新增" ⇒ 到达里有"删除"也不能混进来（恒 true 那种坏法在这一格红）', () => {
    const prefs = withActivities({ onAdded: true });
    expect(selectNotifiedActivities(prefs, ['added', 'deleted'])).toEqual(['added']);
    expect(selectNotifiedActivities(prefs, ['deleted'])).toEqual([]);
  });

  it('开两档 ⇒ 去重且按来序（一次到达多类时界面有确定顺序）', () => {
    const prefs = withActivities({ onAdded: true, onDeleted: true });
    expect(selectNotifiedActivities(prefs, ['deleted', 'deleted', 'added', 'deleted'])).toEqual([
      'deleted',
      'added',
    ]);
  });

  it('空到达 ⇒ 空结果（没有新内容就没有活动，而不是"响一条空的"）', () => {
    const prefs = withActivities({ onAdded: true, onDeleted: true, onCompleted: true });
    expect(selectNotifiedActivities(prefs, [])).toEqual([]);
  });

  it('“完成”那一档单独开也不能替另外两档说话（逐类开关，不是一个总闸）', () => {
    const prefs = withActivities({ onCompleted: true });
    expect(selectNotifiedActivities(prefs, ['completed', 'added'])).toEqual(['completed']);
  });
});
