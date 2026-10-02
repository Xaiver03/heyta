/**
 * `toRenderableNotifications` 的钉子
 * ====================================
 *
 * 与 web `InboxBell` 的 `toRenderable` 同一条纪律（批二）：
 * 未知 kind / 坏载荷**整条丢掉**，好行保留、已读未读原样带过。
 */

import { describe, expect, it } from 'vitest';

import { toRenderableNotifications } from '../src/lib/inbox-display';

const referralItem = (overrides: Partial<Parameters<typeof String>[0]> = {}): never => {
  throw new Error('use literals below');
};
void referralItem;

describe('toRenderableNotifications：封闭词表消费', () => {
  it('referral-activated 且载荷合法 ⇒ 保留，payload 已解析', () => {
    const rows = toRenderableNotifications([
      {
        id: 1,
        kind: 'referral-activated',
        payload: { displayName: 'star', days: 5 },
        createdAt: 1_700_000_000_000,
        readAt: null,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ displayName: 'star', days: 5 });
    expect(rows[0]!.item.readAt).toBeNull();
  });

  it('🔴 未知 kind（服务端新事件）⇒ 整条丢掉，不让界面画出空卡', () => {
    const rows = toRenderableNotifications([
      {
        id: 2,
        kind: 'some-future-event',
        payload: { anything: true },
        createdAt: 1_700_000_000_000,
        readAt: null,
      },
    ]);
    expect(rows).toEqual([]);
  });

  it('🔴 坏载荷（缺字段）⇒ 丢这一条，不影响其余', () => {
    const rows = toRenderableNotifications([
      {
        id: 3,
        kind: 'referral-activated',
        payload: { displayName: 42 },
        createdAt: 1_700_000_000_000,
        readAt: 1_700_000_001_000,
      },
      {
        id: 4,
        kind: 'referral-activated',
        payload: { displayName: null, days: 3 },
        createdAt: 1_700_000_000_000,
        readAt: null,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.item.id).toBe(4);
    expect(rows[0]!.payload.displayName).toBeNull();
  });

  it('空列表 ⇒ 空（空态判据看这里，不看原始长度）', () => {
    expect(toRenderableNotifications([])).toEqual([]);
  });
});
