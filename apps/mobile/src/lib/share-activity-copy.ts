/**
 * 共享动态正文的组装（mobile 侧，M6-10）
 * =======================================
 *
 * 口径本体不在这里：**该说哪一句**由 `@heyta/ui` 的 `shareActivityNotificationBody` 决定
 * （ADR-0071：正文只许「清单名（可缺）+ 活动种类」，条目内容一律不进），**措辞**归 i18n。
 * 本文件只干壳该干的那一件事：把"这份 share 在本机对应哪条清单行、那一行叫什么名字"
 * 从现成本地状态里查出来，喂给上面那枚。
 *
 * 🔴 名字**只从本地状态取**，取不到就落不带名字那句（裁决四）：通知路径不许为了拼
 *    一句话多发一次请求 —— 它必须能在离线时如实说话。
 * ⚠️ 之所以从 `App.tsx` 里抽出来：正文的分支（三档种类 × 有名/无名）是**行为**，
 *    留在装配闭包里就只能用源码文本判，"永远不带清单名"那种改法量不到（本批变异臂实测抓出）。
 */

import { localRowIdForShare } from '@heyta/app-host';
import type { MessageKey, MessageVars } from '@heyta/i18n';
import type { MaterializedState } from '@heyta/op-log';
import type { ShareActivityKind } from '@heyta/ui';
// 与 `share/share-activity-notify.ts` 同一枚入口：`/node` 那一份在 node 判据里也跑得动。
import { shareActivityNotificationBody } from '@heyta/ui/node';

type Translate = (key: MessageKey, vars?: MessageVars) => string;

/** 不带清单名那三句（`common.share.activity.*`）。 */
const ANONYMOUS_KEYS: Record<ShareActivityKind, MessageKey> = {
  added: 'common.share.activity.added',
  deleted: 'common.share.activity.deleted',
  // 「完成」那一档今天还不会有输入（活动差集只数 added/deleted，见
  // web 的 `use-share-activity-signal.ts` 同一格的兜底理由），但闸门是三类都放的
  // ⇒ 兜底句必须留，不留白。
  completed: 'common.share.notif.activityCompleted',
};

/** 带清单名那三句（`common.share.activityNamed.*`，插值变量只有 `name`）。 */
const NAMED_KEYS: Record<ShareActivityKind, MessageKey> = {
  added: 'common.share.activityNamed.added',
  deleted: 'common.share.activityNamed.deleted',
  completed: 'common.share.activityNamed.completed',
};

/**
 * 这一条动态该说什么。
 * `state` 由调用方交进来（生产是 `currentState()`，判据是夹具）—— 本函数不读单例，
 * 所以"清单行还没绑定"那一档能在 node 里真跑，不必摆出一台设备。
 */
export function mobileShareActivityBody(
  t: Translate,
  state: MaterializedState,
  shareId: string,
  kind: ShareActivityKind,
): string {
  const rowId = localRowIdForShare(state, shareId);
  const listName = rowId === undefined ? undefined : state.projects[rowId]?.name;
  return shareActivityNotificationBody(
    {
      anonymous: (k) => t(ANONYMOUS_KEYS[k]),
      named: (name, k) => t(NAMED_KEYS[k], { name }),
    },
    listName,
    kind,
  );
}
