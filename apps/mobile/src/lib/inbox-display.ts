/**
 * 通知的**可渲染**过滤（mobile 侧）
 * ===================================
 *
 * 🔴 通知 kind 是**封闭词表**（服务端只存 kind + payload，措辞归 i18n），
 * 载荷解释走 `@heyta/domain` 的 `parseNotificationPayload` —— 与 web 的
 * `InboxBell.toRenderable` **同一份解析、同一条纪律**：
 * 未知 kind（服务端新加的事件、老客户端看不懂）与坏载荷都**整条丢掉**，
 * 不画一张标题正文全空的卡片。
 *
 * ⚠️ 因此**不能拿 `notifications.length` 当"有没有内容"的判据**：
 * 一个全是未知 kind 的列表长度是 3，而屏幕上一条都渲染不出来。
 * 空态只看这里的输出。
 */

import { parseNotificationPayload, type ReferralActivatedPayload } from '@heyta/domain';

import type { AccountNotificationItem } from '@heyta/app-host';

/** 一条"能渲染出来"的通知：kind 已知且载荷通过了边界校验。 */
export interface RenderableNotification {
  readonly item: AccountNotificationItem;
  readonly payload: ReferralActivatedPayload;
}

export function toRenderableNotifications(
  notifications: readonly AccountNotificationItem[],
): readonly RenderableNotification[] {
  const out: RenderableNotification[] = [];
  for (const item of notifications) {
    const payload = parseNotificationPayload(item.kind, item.payload);
    if (payload !== null) out.push({ item, payload });
  }
  return out;
}
