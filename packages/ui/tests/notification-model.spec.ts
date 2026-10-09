import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_PREFS,
  shouldAutoAcceptInvitation,
  shouldNotifyActivity,
  shouldNotifyTaskReminder,
} from '../src/sync/notification-model';

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

describe('任务提醒四档', () => {
  const myTask = { taskId: 't1', assigneeUserId: '42', actorUserId: 2 };
  const otherTask = { taskId: 't2', assigneeUserId: '99', actorUserId: 2 };
  const unassigned = { taskId: 't3', actorUserId: 2 };

  it('assignedToMe：指派给我的响，未指派/别人的不响', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, taskScope: 'assignedToMe' as const };
    expect(shouldNotifyTaskReminder(prefs, myTask, 42)).toBe(true);
    expect(shouldNotifyTaskReminder(prefs, otherTask, 42)).toBe(false);
    expect(shouldNotifyTaskReminder(prefs, unassigned, 42)).toBe(false);
  });

  it('自己改自己的任务：任何档位都不响（自我操作零打扰）', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, taskScope: 'all' as const };
    expect(shouldNotifyTaskReminder(prefs, { ...myTask, actorUserId: 42 }, 42)).toBe(false);
  });

  it('all 档：未指派也响；none 档：全静默', () => {
    const all = { ...DEFAULT_NOTIFICATION_PREFS, taskScope: 'all' as const };
    expect(shouldNotifyTaskReminder(all, unassigned, 42)).toBe(true);
    const none = { ...DEFAULT_NOTIFICATION_PREFS, taskScope: 'none' as const };
    expect(shouldNotifyTaskReminder(none, myTask, 42)).toBe(false);
  });

  it('allExceptAssignedToOthers：未指派与指派给我的响，指派给他人的不响', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, taskScope: 'allExceptAssignedToOthers' as const };
    expect(shouldNotifyTaskReminder(prefs, unassigned, 42)).toBe(true);
    expect(shouldNotifyTaskReminder(prefs, myTask, 42)).toBe(true);
    expect(shouldNotifyTaskReminder(prefs, otherTask, 42)).toBe(false);
  });
});

describe('自动接受已知合作者', () => {
  it('默认关：名单命中也不自动接受', () => {
    expect(shouldAutoAcceptInvitation(DEFAULT_NOTIFICATION_PREFS, 7, [7, 8])).toBe(false);
  });

  it('开了：名单内的邀请人自动接受，名单外的拒绝', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, autoAcceptKnownCollaborators: true };
    expect(shouldAutoAcceptInvitation(prefs, 7, [7, 8])).toBe(true);
    expect(shouldAutoAcceptInvitation(prefs, 99, [7, 8])).toBe(false);
  });
});
