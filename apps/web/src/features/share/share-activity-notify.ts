/**
 * 共享清单活动的系统通知投递（M5）。
 *
 * 形状照 `features/reminders/notify.ts` 那一条：**选哪几条是纯的，只有
 * `new Notification(...)` 那一下不纯**，所以 ctor 可注入、测试能全断言。
 *
 * 🔴 这里**不判**"该不该响" —— 那是 `@heyta/ui` 的 `selectNotifiedActivities(prefs, kinds)`
 *    （ADR-0062 决策 7：偏好是本机的判断，判断只许有一份）。这一层收到的就是**已经过了闸门**的
 *    类别，它只负责：支不支持、有没有权限、以及投出去几条。
 * ⚠️ 正文**不含清单名与内容**：端到端加密下那些当然能在本机解出来，
 *    但把明文写进系统通知中心等于交给操作系统与它的同步去保管；
 *    要带名字得先定"通知里允许出现什么"这条口径（登记在计划 §9.10）。
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
