/**
 * 任务动态的**界面语义**：事件 → 词条 key（唯一一份）
 * ===================================================
 *
 * ## 为什么在共享层
 *
 * `packages/domain/src/task-activity.ts` 把 op-log 投影成
 * `{kind, changes: [{field: 'dueDate' …}]}`，而"这条变更在界面上叫什么"是文案问题，
 * 不是数据问题。它若各端各写一份，症状与 `subtasks/model.ts` 当初一模一样：
 * **同一次 `dueDate` 改动，web 念「截止日期」、移动端念「到期日」** ——
 * 两处都不报错，用户却学不到"这是同一个东西"。
 *
 * ## 🔴 为什么这里给的是 key 而不是句子
 *
 * 与 `auth/model.ts`、`sync/model.ts`、`subtasks/model.ts` 同一取向：
 * `packages/ui` **不依赖** `@heyta/i18n`（那是文案的唯一事实源，归宿主取词）。
 * 所以本模块导出的是**字面量 key 的联合**，宿主拿到后 `t(key)`。
 * 好处是这个模块能在 node 里被单独测，不牵连 i18n 包的运行时。
 *
 * ## 🔴 映射表穷尽 `TaskActivityField`，不是 `switch` + `default`
 *
 * `TaskActivityField` 是领域层的封闭联合。用 `Record` 穷尽它，往联合里加一个字段
 * 而忘了在这儿接上词条就是**编译错误**；写 `default: '…其他字段'` 的话，
 * 新字段会**静默**念成"其他字段" —— 界面上看起来完全正常，而那正是本仓反复拦的
 * 那一类"不报错的缺陷"（AGENTS.md §3.5）。
 *
 * ## 为什么两个字段可以共用同一句
 *
 * `repeatRule` 与 `repeatDtstart` 在同一条 op 里一起改（设重复规则时领域层会
 * 顺手钉锚点），而用户语言里那叫同一件事：「重复」。
 * `startDate` 与 `durationMinutes` 同理（「排期」）。
 * ⇒ 下面导出的是 **key 的集合**（按 key 去重），一行动态里「重复」只出现一次，
 *   不会念成「重复 · 重复」。
 */

import type { TaskActivityEvent, TaskActivityField } from '@heyta/domain';

/** 本模块会说出来的词条 key（宿主取词；与 `SubtaskRejectionMessageKey` 同形）。 */
export type TaskActivityMessageKey =
  // 复用详情面板自己的段落标题：同一屏里同一件事不该有两个名字。
  | 'mobile.detail.field.title'
  | 'mobile.detail.field.note'
  | 'mobile.detail.field.dueDate'
  | 'mobile.detail.field.priority'
  | 'mobile.detail.field.project'
  | 'mobile.detail.field.tags'
  | 'mobile.detail.field.parent'
  | 'mobile.detail.field.repeat'
  | 'mobile.detail.field.schedule'
  // 这几个字段在面板上没有对应的段落（它们不是可编辑的一格），所以有自己的词条。
  | 'mobile.detail.activity.field.completedAt'
  | 'mobile.detail.activity.field.pinnedAt'
  | 'mobile.detail.activity.field.abandonedAt'
  | 'mobile.detail.activity.field.deletedAt'
  | 'mobile.detail.activity.field.other'
  | 'mobile.detail.activity.kind.created'
  | 'mobile.detail.activity.kind.updated'
  | 'mobile.detail.activity.kind.deleted'
  | 'mobile.detail.activity.kind.restored'
  | 'mobile.detail.activity.device.local'
  | 'mobile.detail.activity.device.other'
  | 'mobile.detail.activity.localOnly'
  | 'mobile.detail.activity.empty';

/** 变更字段 → 词条 key。穷尽 `TaskActivityField`。 */
const FIELD_MESSAGE_KEYS = {
  title: 'mobile.detail.field.title',
  note: 'mobile.detail.field.note',
  dueDate: 'mobile.detail.field.dueDate',
  priority: 'mobile.detail.field.priority',
  projectId: 'mobile.detail.field.project',
  tagIds: 'mobile.detail.field.tags',
  parentId: 'mobile.detail.field.parent',
  repeatRule: 'mobile.detail.field.repeat',
  repeatDtstart: 'mobile.detail.field.repeat',
  startDate: 'mobile.detail.field.schedule',
  durationMinutes: 'mobile.detail.field.schedule',
  completedAt: 'mobile.detail.activity.field.completedAt',
  pinnedAt: 'mobile.detail.activity.field.pinnedAt',
  abandonedAt: 'mobile.detail.activity.field.abandonedAt',
  deletedAt: 'mobile.detail.activity.field.deletedAt',
  other: 'mobile.detail.activity.field.other',
} as const satisfies Record<TaskActivityField, TaskActivityMessageKey>;

/** 事件类型 → 词条 key（穷尽 `TaskActivityEvent['kind']`）。 */
const KIND_MESSAGE_KEYS = {
  created: 'mobile.detail.activity.kind.created',
  updated: 'mobile.detail.activity.kind.updated',
  deleted: 'mobile.detail.activity.kind.deleted',
  restored: 'mobile.detail.activity.kind.restored',
} as const satisfies Record<TaskActivityEvent['kind'], TaskActivityMessageKey>;

/** 这条变更是谁写的：本机，还是别的设备。 */
export function taskActivityDeviceMessageKey(local: boolean): TaskActivityMessageKey {
  return local ? 'mobile.detail.activity.device.local' : 'mobile.detail.activity.device.other';
}

/**
 * 覆盖范围 → 那句**必须说出来**的话。
 *
 * `complete` 返回 `undefined` = 不需要额外声明（这时画一句"只是这台设备的"
 * 反而是错的）。另两档各有一句：把增量历史念成完整历史是不实陈述。
 */
export function taskActivityCoverageMessageKey(
  coverage: 'complete' | 'device-local-only' | 'empty',
): TaskActivityMessageKey | undefined {
  switch (coverage) {
    case 'complete':
      return undefined;
    case 'device-local-only':
      return 'mobile.detail.activity.localOnly';
    case 'empty':
      return 'mobile.detail.activity.empty';
  }
}

/**
 * 一条动态里"改了哪些字段"的词条 key，**按 key 去重、保持首次出现的顺序**。
 *
 * 去重发生在 key 上而不是字段上 —— 见文件头：`repeatRule` 与 `repeatDtstart`
 * 是两个字段、一句话。
 */
export function taskActivityFieldMessageKeys(
  event: Pick<TaskActivityEvent, 'changes'>,
): TaskActivityMessageKey[] {
  const keys: TaskActivityMessageKey[] = [];
  for (const change of event.changes) {
    const key = FIELD_MESSAGE_KEYS[change.field];
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function taskActivityKindMessageKey(kind: TaskActivityEvent['kind']): TaskActivityMessageKey {
  return KIND_MESSAGE_KEYS[kind];
}
