import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_PREFS,
  shouldNotifyActivity,
} from '../src/sync/notification-model';

describe('偏好形状：只登记有消费者的那一档', () => {
  // 🔴 这一档是"界面不许谎称有能力"的钉子。曾经的 `taskScope`（四档）与
  //    `autoAcceptKnownCollaborators` 被删，不是因为设计变了，是因为**它们没有输入**：
  //    前者判 `Task.assigneeUserId`（全仓零写点），后者要一份还不存在的合作者名单。
  //    往这个形状里加一档而不带消费者，这里就该红。
  it('默认偏好里只有 activities 一个键', () => {
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFS)).toEqual(['activities']);
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFS.activities).sort()).toEqual([
      'onAdded',
      'onCompleted',
      'onDeleted',
    ]);
  });
});

describe('活动通知三类（默认全关）', () => {
  it('默认偏好：三类都不响', () => {
    expect(shouldNotifyActivity(DEFAULT_NOTIFICATION_PREFS, 'completed')).toBe(false);
    expect(shouldNotifyActivity(DEFAULT_NOTIFICATION_PREFS, 'added')).toBe(false);
    expect(shouldNotifyActivity(DEFAULT_NOTIFICATION_PREFS, 'deleted')).toBe(false);
  });

  it('开一类只响一类（其余仍静默）', () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { onCompleted: true, onAdded: false, onDeleted: false },
    };
    expect(shouldNotifyActivity(prefs, 'completed')).toBe(true);
    expect(shouldNotifyActivity(prefs, 'added')).toBe(false);
    expect(shouldNotifyActivity(prefs, 'deleted')).toBe(false);
  });
});
