/**
 * 共享清单通知的**本地过滤模型**（ADR-0062 决策 7，W5 的模型层）。
 * =====================================================================
 *
 * 🔴 通知路由的铁律：**偏好存本地，服务端零知识**。服务端只广播
 * 「这个 share 有新 op」（`new_share_ops` 信号）；客户端拉取解密后，
 * 用本文件的纯函数决定**要不要响**。事件语义在加密 payload 里——
 * 服务端看不见，也就**不可能**替用户过滤。
 *
 * 词表与默认值照滴答（调研 §1「团队如何协作」），方案见
 * `docs/plans/collaboration-shared-lists.md` §1 D5 / §2.5：
 * - **活动三类**（完成 / 新增 / 删除）：默认全关（防通知风暴）——
 *   这是本层**今天唯一有输入的档位**，也是 `ShareNotificationPrefs` 唯一的键。
 *
 * 🔴 滴答那张表里另两档（任务提醒范围、自动接受已知合作者的邀请）**没有实现**：
 * 它们各自的输入在本仓还不存在，理由、现量命令与重新开工的条件写在下面
 * `DEFAULT_NOTIFICATION_PREFS` 那段注释里（2026-10-24 整条撤下，界面上也不再渲染）。
 *
 * ADR-0071 在这一层又加了两件事，都**不是**新的闸门：**同意**决定这条通知能不能出现，
 * **内容口径**决定响的时候说什么（清单名 + 活动种类，条目内容一律不进正文）。
 */

import type { ShareConsentStore } from './share-consent-model.js';

export type ShareActivityKind = 'completed' | 'added' | 'deleted';

export interface ShareActivityPrefs {
  onCompleted: boolean;
  onAdded: boolean;
  onDeleted: boolean;
}

export interface ShareNotificationPrefs {
  activities: ShareActivityPrefs;
}

export const DEFAULT_NOTIFICATION_PREFS: ShareNotificationPrefs = {
  activities: { onCompleted: false, onAdded: false, onDeleted: false },
};

const ACTIVITY_MATCHERS: Record<ShareActivityKind, (p: ShareNotificationPrefs) => boolean> = {
  completed: (p) => p.activities.onCompleted,
  added: (p) => p.activities.onAdded,
  deleted: (p) => p.activities.onDeleted,
};

/** 活动开关的**读法**——kind → prefs 字段名的唯一映射（组件不许自己拼键名）。 */
export const isActivityEnabled = (
  prefs: ShareNotificationPrefs,
  kind: ShareActivityKind,
): boolean => ACTIVITY_MATCHERS[kind](prefs);

/** 活动通知判定（完成/新增/删除三类，逐类开关）。 */
export const shouldNotifyActivity = (
  prefs: ShareNotificationPrefs,
  kind: ShareActivityKind,
): boolean => ACTIVITY_MATCHERS[kind](prefs);

/**
 * 一组**到达**的活动里，哪些真的该吵到人：去重 + 逐类过偏好。
 *
 * 🔴 这一格必须是纯函数而不是"壳里循环一下"：ADR-0062 决策 7 说的是
 *    服务端只发信号，**响不响由本机偏好决定** —— 那"由偏好决定"这一步就是业务判断，
 *    放进端壳就违反 AGENTS §3.5。壳里只做投递：拿到空数组就**一次都不通知**。
 *    回序按来序（`added` 在前就先响哪一条），这样一次到达多类活动时界面有确定顺序。
 */
export const selectNotifiedActivities = (
  prefs: ShareNotificationPrefs,
  kinds: readonly ShareActivityKind[],
): ShareActivityKind[] => {
  const enabled: ShareActivityKind[] = [];
  for (const kind of kinds) {
    if (enabled.includes(kind)) continue;
    if (shouldNotifyActivity(prefs, kind)) enabled.push(kind);
  }
  return enabled;
};

/**
 * ADR-0071 裁决三：这台设备**有没有对共享同意过**，决定这条通知能不能出现。
 * 同意缺席 = 从没同意过 ⇒ fail-closed（与 `shouldShowConsent` 同向）。
 * ⚠️ 现量的同意态是**设备级一条记录**（写点在「共享此清单」那一步），不是每份清单一条。
 */
export const hasShareConsent = (consent: ShareConsentStore | undefined): boolean =>
  consent?.consentAcceptedAt !== undefined;

/**
 * 内容口径的入口：**先过同意，再过偏好**。
 * 🔴 偏好那道闸门仍是 `selectNotifiedActivities` 这一枚，这里不重写它 ——
 *    同意只是在它前面多出来的一道：没同意过 ⇒ 空数组，一条都不许响。
 */
export const selectShareActivitiesToNotify = (
  prefs: ShareNotificationPrefs,
  kinds: readonly ShareActivityKind[],
  consent: ShareConsentStore | undefined,
): ShareActivityKind[] =>
  hasShareConsent(consent) ? selectNotifiedActivities(prefs, kinds) : [];

/**
 * 通知正文的两句现成措辞（措辞本身归 i18n，由壳注入；这里只决定**该说哪一句**）。
 * `named` 只拿得到清单名与活动种类 —— 没有第三个口子，也就塞不进条目内容。
 */
export interface ShareActivityBodyCopy {
  readonly anonymous: (kind: ShareActivityKind) => string;
  readonly named: (listName: string, kind: ShareActivityKind) => string;
}

/**
 * ADR-0071 裁决一 / 二 / 四：正文 = **清单名（可缺）+ 活动种类**，别的不许出现。
 * 名字拿不到（本机没有那条清单行绑定）就回落不带名字那句 ——
 * 🔴 不许为了拼这一句话去发一次请求，通知路径必须能在离线时如实说话。
 */
export const shareActivityNotificationBody = (
  copy: ShareActivityBodyCopy,
  listName: string | undefined,
  kind: ShareActivityKind,
): string => {
  const name = listName?.trim() ?? '';
  return name === '' ? copy.anonymous(kind) : copy.named(name, kind);
};

/*
 * 🔴 这里曾有另外两档偏好（任务提醒范围 `taskScope` 四档、`autoAcceptKnownCollaborators`）
 *    和它们的两个谓词，2026-10-24 整条删掉。删的理由不是"没写完"，是**它们没有输入**：
 *    · `taskScope` 判的是 `Task.assigneeUserId`，而这个字段**全仓零写点**（现量：
 *      `grep -rn "assigneeUserId" packages apps server --include='*.ts*' | grep -v tests` 只剩实体声明与本文件）
 *      ⇒ 四档选择摆在一起时行为逐字相同，面板等于在撒谎；
 *    · 自动接受需要一份"合作者名单"，那一档产品面还不存在（谁算已知合作者是个真问题）。
 *    界面上一律不再渲染它们。**判据不许靠夹具点亮**：等指派或合作者名单落地时，
 *    连同它的输入来源一起重来（见计划 §9.10 那格与交接书）。
 *    🔴 2026-10-27 起这句"没有输入"**由双向判据看着**，不再只靠人记着：
 *       `packages/ui/tests/notification-model.spec.ts` 那一组既钉"加档位没输入会红"，
 *       也钉"输入出现了（`assigneeUserId` 有了写点）而档位没回来会红"，
 *       分母由 `packages/*`、`apps/*`、`server/src` 现取（枚数由它自己打印）。
 *    ⚠️ 反向那一半只覆盖**指派**这一族。`autoAcceptKnownCollaborators` 的前提是"合作者名单"，
 *       它今天仍不存在，而且它一旦落地要先过 ADR-0071 那面同意闸 —— **自动加入 = 绕过同意面**，
 *       属于要先新立一份 ADR 的口径变更，不是接线工作。
 */
