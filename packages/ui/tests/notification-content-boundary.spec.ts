/**
 * ADR-0071 的**内容口径**模型层判据：同意决定这条通知能不能出现，
 * 口径决定响的时候说什么（清单名 + 活动种类，没有第三个口子）。
 *
 * 🔴 判据的形状与 `notification-prefs-gate.spec.ts` 同一型：
 * 「不该响的时候一次都不响」「不该说的时候那句压根没被组装」。
 * 条目内容（任务标题、评论正文、便签内容）不许进正文那一条，牙齿在
 * `apps/web/tests/share-notification-content.spec.tsx` —— 那里才有真夹具把内容喂进来。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_NOTIFICATION_PREFS,
  hasShareConsent,
  selectNotifiedActivities,
  selectShareActivitiesToNotify,
  shareActivityNotificationBody,
  type ShareActivityBodyCopy,
  type ShareActivityKind,
  type ShareNotificationPrefs,
} from '../src/sync/notification-model.js';

const CONSENTED = { consentAcceptedAt: 1_700_000_000_000, dontAskAgain: true };
const ALL_ON: ShareNotificationPrefs = {
  ...DEFAULT_NOTIFICATION_PREFS,
  activities: { onCompleted: true, onAdded: true, onDeleted: true },
};

/** 两句都记账：谁被叫了、拿到的是什么，断言"该说哪一句"不用靠措辞。 */
const makeCopy = (): { copy: ShareActivityBodyCopy; anonymous: ReturnType<typeof vi.fn>; named: ReturnType<typeof vi.fn> } => {
  const anonymous = vi.fn((kind: ShareActivityKind) => `无名:${kind}`);
  const named = vi.fn((listName: string, kind: ShareActivityKind) => `有名:${listName}:${kind}`);
  return { copy: { anonymous, named }, anonymous, named };
};

describe('同意闸门（ADR-0071 裁决三）', () => {
  it('🔴 从没同意过 ⇒ 空数组，哪怕三档偏好全开', () => {
    expect(selectShareActivitiesToNotify(ALL_ON, ['added', 'deleted'], {})).toEqual([]);
    expect(hasShareConsent({})).toBe(false);
  });

  it('这台设备连同意记录都没有（undefined）⇒ 同样零打扰，不许抛', () => {
    expect(selectShareActivitiesToNotify(ALL_ON, ['added'], undefined)).toEqual([]);
    expect(hasShareConsent(undefined)).toBe(false);
  });

  it('同意只免弹、不等于没同意（勾了不再提示那一支仍算已同意）', () => {
    expect(hasShareConsent(CONSENTED)).toBe(true);
    expect(selectShareActivitiesToNotify(ALL_ON, ['added'], CONSENTED)).toEqual(['added']);
  });

  it('🔴 已同意时，偏好那道闸门还是原来那一枚 —— 这里没有第二套判断', () => {
    const arrived: ShareActivityKind[] = ['deleted', 'added'];
    expect(selectShareActivitiesToNotify(DEFAULT_NOTIFICATION_PREFS, arrived, CONSENTED)).toEqual(
      selectNotifiedActivities(DEFAULT_NOTIFICATION_PREFS, arrived),
    );
    const onlyAdded: ShareNotificationPrefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { ...DEFAULT_NOTIFICATION_PREFS.activities, onAdded: true },
    };
    expect(selectShareActivitiesToNotify(onlyAdded, arrived, CONSENTED)).toEqual(['added']);
  });
});

describe('正文组装（ADR-0071 裁决一 / 二 / 四）', () => {
  it('拿得到清单名 ⇒ 说带名字那句，名字原样进去', () => {
    const { copy, anonymous, named } = makeCopy();
    expect(shareActivityNotificationBody(copy, '家庭采购', 'added')).toBe('有名:家庭采购:added');
    expect(named).toHaveBeenCalledTimes(1);
    expect(anonymous, '有名字的时候不许回落').not.toHaveBeenCalled();
  });

  it('🔴 名字周围多余空白不算"有名字"以外的东西 —— 句子只拿到 trim 后的名字', () => {
    const { copy } = makeCopy();
    expect(shareActivityNotificationBody(copy, '  家庭采购  ', 'deleted')).toBe(
      '有名:家庭采购:deleted',
    );
  });

  it('🔴 名字拿不到（未绑定 / 详情还没读回来）⇒ 回落不带名字那句，且带名字那句一次都没被叫', () => {
    for (const missing of [undefined, '', '   ']) {
      const { copy, anonymous, named } = makeCopy();
      expect(shareActivityNotificationBody(copy, missing, 'completed')).toBe('无名:completed');
      expect(anonymous).toHaveBeenCalledTimes(1);
      expect(named, '不许为了拼这句话去别处够名字').not.toHaveBeenCalled();
    }
  });

  it('三类各有自己那句（词表是封闭的，组装不许把三类并成一句）', () => {
    const { copy } = makeCopy();
    const kinds: ShareActivityKind[] = ['added', 'deleted', 'completed'];
    expect(kinds.map((kind) => shareActivityNotificationBody(copy, '家庭采购', kind))).toEqual([
      '有名:家庭采购:added',
      '有名:家庭采购:deleted',
      '有名:家庭采购:completed',
    ]);
  });
});
