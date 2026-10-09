/**
 * 共享清单通知的**本地过滤模型**（ADR-0062 决策 7，W5 的模型层）。
 * =====================================================================
 *
 * 🔴 通知路由的铁律：**偏好存本地，服务端零知识**。服务端只广播
 * 「这个 share 有新 op」（`new_share_ops` 信号）；客户端拉取解密后，
 * 用本文件的纯函数决定**要不要响**。`assignee` 与事件语义都在加密
 * payload 里——服务端看不见，也就**不可能**替用户过滤。
 *
 * 词表与默认值照滴答（调研 §1「团队如何协作」），方案见
 * `docs/plans/collaboration-shared-lists.md` §1 D5 / §2.5：
 * - **活动三类**（完成 / 新增 / 删除）：默认全关（防通知风暴）；
 * - **任务提醒四档**：所有 / 所有（指派给他人的除外）/ 指派给我的 / 不提醒，
 *   默认「指派给我的」；
 * - **自动接受已知合作者的共享邀请**：默认关（与滴答相反——隐私产品
 *   宁可多一次确认）。
 */

export type ShareActivityKind = 'completed' | 'added' | 'deleted';

export interface ShareActivityPrefs {
  onCompleted: boolean;
  onAdded: boolean;
  onDeleted: boolean;
}

export type TaskReminderScope =
  | 'all'
  | 'allExceptAssignedToOthers'
  | 'assignedToMe'
  | 'none';

export interface ShareNotificationPrefs {
  activities: ShareActivityPrefs;
  taskScope: TaskReminderScope;
  autoAcceptKnownCollaborators: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: ShareNotificationPrefs = {
  activities: { onCompleted: false, onAdded: false, onDeleted: false },
  taskScope: 'assignedToMe',
  autoAcceptKnownCollaborators: false,
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

export interface ShareTaskLike {
  taskId: string;
  /** 加密 payload 里的指派人；undefined = 未指派。 */
  assigneeUserId?: string;
  /** 服务端（明文）操作者的账号 id——「指派给他人的除外」用它判。 */
  actorUserId: number;
}

/**
 * 任务提醒判定（四档）。`myUserId` = 当前账号 id；
 * `actorUserId` 是做出这次变更的账号——「指派给他人的除外」挡的是
 * *"别人改了指派给他的任务也吵我"*，而**自己改自己的任务永远不响**
 * （这与 scope 无关：自己动手的事不需要通知自己）。
 */
export const shouldNotifyTaskReminder = (
  prefs: ShareNotificationPrefs,
  task: ShareTaskLike,
  myUserId: number,
): boolean => {
  if (task.actorUserId === myUserId) return false;
  const assignedToMe = task.assigneeUserId !== undefined && task.assigneeUserId === String(myUserId);
  const assignedToSomeoneElse = task.assigneeUserId !== undefined && !assignedToMe;
  switch (prefs.taskScope) {
    case 'all':
      return true;
    case 'allExceptAssignedToOthers':
      return !assignedToSomeoneElse;
    case 'assignedToMe':
      return assignedToMe;
    case 'none':
      return false;
  }
};

/**
 * 「自动接受已知合作者」：邀请人的账号 id 出现在合作者名单里才自动接受。
 * 🔴 名单匹配是**精确 id 相等**——不存在模糊的「认识」（那是社交产品的
 * 话术；隐私产品只认显式名单）。默认关：每次邀请都走手动确认。
 */
export const shouldAutoAcceptInvitation = (
  prefs: ShareNotificationPrefs,
  inviterUserId: number,
  knownCollaboratorIds: readonly number[],
): boolean =>
  prefs.autoAcceptKnownCollaborators && knownCollaboratorIds.includes(inviterUserId);
