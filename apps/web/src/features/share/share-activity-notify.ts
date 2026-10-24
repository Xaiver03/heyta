/**
 * 共享清单活动的系统通知投递（M5）。
 *
 * 形状照 `features/reminders/notify.ts` 那一条：**选哪几条是纯的，只有
 * `new Notification(...)` 那一下不纯**，所以 ctor 可注入、测试能全断言。
 *
 * 🔴 这里**不判**"该不该响" —— 那是 `@heyta/ui` 的 `selectShareActivitiesToNotify`
 *    （同意 + 本机偏好；偏好闸门仍是 `selectNotifiedActivities` 那一枚，ADR-0062 决策 7）。
 *    这一层收到的就是**已经过了闸门**的类别，它只负责：支不支持、有没有权限、以及投出去几条。
 * ⚠️ 正文里允许出现什么由 **ADR-0071** 定：清单名 + 活动种类，条目内容（任务标题、评论正文、
 *    便签内容）一律不进 —— 那句话由 `shareActivityNotificationBody` 组装，`labels.body`
 *    只是把组装好的句子交给系统。这一层拿不到、也不许去要任何条目内容。
 */

import type { ShareActivityKind } from '@heyta/ui';

import { notificationsSupported, type NotificationCtor } from '../reminders/notify.js';

export interface ShareActivityNotifyLabels {
  readonly title: string;
  readonly body: (kind: ShareActivityKind) => string;
}

export interface ShareActivityDelivery {
  readonly delivered: number;
  readonly reason?: 'unsupported' | 'permission' | 'empty';
}

export function deliverShareActivityNotifications(
  kinds: readonly ShareActivityKind[],
  shareId: string,
  latestSeq: number,
  labels: ShareActivityNotifyLabels,
  ctor: NotificationCtor | undefined = globalThis.Notification as NotificationCtor | undefined,
): ShareActivityDelivery {
  if (kinds.length === 0) return { delivered: 0, reason: 'empty' };
  if (!notificationsSupported(ctor)) return { delivered: 0, reason: 'unsupported' };
  if (ctor!.permission !== 'granted') return { delivered: 0, reason: 'permission' };

  let delivered = 0;
  for (const kind of kinds) {
    try {
      new ctor!(labels.title, {
        body: labels.body(kind),
        // `tag` 带到 `latestSeq`：同一次信号在通知中心里合并，
        // 而**下一条新评论**（seq 变了）必须是一条新的，不能被合并掉。
        tag: `share:${shareId}:${kind}:${String(latestSeq)}`,
      });
      delivered += 1;
    } catch {
      // 权限在两次检查之间被撤销、系统级静默……不中断其余几类，也不假装投出去了。
    }
  }
  return delivered > 0 ? { delivered } : { delivered: 0, reason: 'permission' };
}
