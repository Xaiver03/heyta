/**
 * 写入提案 → 一句人话（移动端）
 * ============================
 *
 * 🔴 这是**确认机制唯一起作用的那张卡**：用户按「确认执行」之前必须看得见
 * 将要落下什么。少一句，症状不是崩溃而是"卡片上一片空白，而确认键就在旁边"。
 *
 * ## 为什么本端有一份、而不是 import web 那一份
 *
 * `apps/web/src/features/ai/AiToolRun.tsx` 的 `intentText` 是同一件事的实现，
 * 跨 app 不能直接 import（`check:module-boundaries` 不许壳之间互相引）。
 * 共享层（`@heyta/ui`）装不下它，因为要**逐条插值**（`{title}` / `{count}` /
 * 两种 `log-focus` 说法），而共享层刻意不 import `@heyta/i18n`
 * （第二份 React 会把 Android 产物打坏，`check:mobile-bundle` 盯着）。
 *
 * 所以这里是一句**登记过的重复**，而不是假装不存在的那一份：
 * `apps/mobile/tests/ai-copy-parity.spec.ts` 会逐条比较本文件与 web 那份的
 * `intent.action → 词条 key` 映射，**两边不一致就红**。
 * 这条表必须逐字同口径的理由写在 web 那份的注释里：
 * "同一个提案在两个入口长得不一样"正是本仓库反复付学费的那一类。
 *
 * ## 没有 `default` 分支
 *
 * 与 web 同一条纪律：`LocalApiWriteIntent.action` 是封闭词表，
 * 新增一种写入动作而这里没跟上 ⇒ **编译不过**（函数缺返回值）。
 * 这是要的效果：漏一条的话，那个新动作的提案卡会对着用户显示空白。
 */

import type { LocalApiWriteIntent } from '@heyta/local-api';
import type { Locale, MessageKey } from '@heyta/i18n';
import { LIST_SEPARATOR } from '../lib/recurrence-display';

/** `t` 的最小形状（与 web 那份同一个签名，避免把 `I18nValue` 整块拖进来）。 */
type Translate = (key: MessageKey, vars?: Readonly<Record<string, string | number>>) => string;

/**
 * 专注类型的说法。
 *
 * ⚠️ 认不出来时**原样显示那个机器词**而不是兜到「工作」：
 * 卡片上写"工作"而实际落的是别的字符串，那张卡就在撒谎；
 * 看见一个陌生词至少会让人停下来看一眼。
 */
const FOCUS_KIND_KEY = {
  work: 'web.ai.tools.focusKindWork',
  shortBreak: 'web.ai.tools.focusKindShortBreak',
  longBreak: 'web.ai.tools.focusKindLongBreak',
} satisfies Record<string, MessageKey>;

function focusKindLabel(kind: string, t: Translate): string {
  const key = (FOCUS_KIND_KEY as Readonly<Record<string, MessageKey | undefined>>)[kind];
  return key === undefined ? kind : t(key);
}

export function intentText(intent: LocalApiWriteIntent, t: Translate, locale: Locale = 'zh-CN'): string {
  switch (intent.action) {
    case 'create-task':
      return t('web.ai.tools.intentCreate', { title: intent.title });
    case 'update-task':
      return t('web.ai.tools.intentUpdate', { id: intent.taskId });
    case 'complete-task':
      return t('web.ai.tools.intentComplete', { id: intent.taskId });
    case 'complete-tasks':
      // 说**条数**不说 id：手机上 20 串 id 根本读不动，而"这是一次批量"必须看清。
      return t('web.ai.tools.intentCompleteBatch', { count: String(intent.taskIds.length) });
    case 'append-task-checklist':
      return t('web.ai.tools.intentAppendTaskChecklist', {
        id: intent.taskId,
        items: intent.items.join(LIST_SEPARATOR[locale]),
      });
    case 'create-project':
      return t('web.ai.tools.intentCreateProject', { name: intent.name });
    case 'create-habit':
      return t('web.ai.tools.intentCreateHabit', { name: intent.name });
    case 'create-tag':
      return t('web.ai.tools.intentCreateTag', { name: intent.name });
    case 'set-task-tags':
      // 说的是**换成几个**：这一条是整组覆盖，确认那一刻必须看见"这是替换"。
      return t('web.ai.tools.intentSetTaskTags', {
        id: intent.taskId,
        count: String(intent.tagIds.length),
      });
    case 'set-task-priorities': {
      const priorityKeys: Readonly<Record<string, MessageKey | undefined>> = {
        none: 'web.ai.prioritize.priority.none',
        low: 'web.ai.prioritize.priority.low',
        medium: 'web.ai.prioritize.priority.medium',
        high: 'web.ai.prioritize.priority.high',
      };
      const items = intent.entries
        .map(({ taskId, priority }) => {
          const key = priorityKeys[priority.trim().toLowerCase()];
          return `${taskId} → ${key === undefined ? priority : t(key)}`;
        })
        .join(LIST_SEPARATOR[locale]);
      return t('web.ai.tools.intentSetTaskPriorities', { items });
    }
    case 'set-task-estimate':
      return t('web.ai.tools.intentSetTaskEstimate', { id: intent.taskId, minutes: intent.minutes });
    case 'create-note':
      return t('web.ai.tools.intentCreateNote', { content: intent.content });
    case 'update-note':
      return t('web.ai.tools.intentUpdateNote', { id: intent.noteId, content: intent.content });
    case 'record-checkin':
      return t('web.ai.tools.intentRecordCheckin', {
        habitId: intent.habitId,
        date: intent.date ?? t('web.ai.tools.todayLabel'),
      });
    case 'log-focus':
      // 两种记录（有没有实际时长）两句说法，卡片说的是将要落下的那一件。
      return intent.actualMinutes === undefined
        ? t('web.ai.tools.intentLogFocus', {
            kind: focusKindLabel(intent.kind, t),
            planned: intent.plannedMinutes,
          })
        : t('web.ai.tools.intentLogFocusWithActual', {
            kind: focusKindLabel(intent.kind, t),
            planned: intent.plannedMinutes,
            actual: intent.actualMinutes,
          });
    case 'create-reminder': {
      if (intent.minutesBeforeDue !== undefined) {
        return t('web.ai.tools.intentCreateReminderBeforeDue', {
          id: intent.taskId,
          minutes: intent.minutesBeforeDue,
        });
      }
      if (intent.date !== undefined && intent.time !== undefined) {
        return t('web.ai.tools.intentCreateReminderAt', {
          id: intent.taskId,
          when: `${intent.date} ${intent.time}`,
        });
      }
      // 两种形态都凑不齐 → 说"没说清时刻"，**不拼一句看起来正常的话**。
      return t('web.ai.tools.intentCreateReminderIncomplete', { id: intent.taskId });
    }
    case 'create-event':
      return t('web.ai.tools.intentCreateEvent', { title: intent.title, date: intent.date });
    case 'update-event':
      return t('web.ai.tools.intentUpdateEvent', { id: intent.eventId });
    // 2026-11-22 工具层补全：19 个写意图各一句人话。
    case 'trash-task':
      return t('web.ai.tools.intentTrashTask', { id: intent.taskId });
    case 'restore-task':
      return t('web.ai.tools.intentRestoreTask', { id: intent.taskId });
    case 'abandon-task':
      return t('web.ai.tools.intentAbandonTask', { id: intent.taskId });
    case 'unabandon-task':
      return t('web.ai.tools.intentUnabandonTask', { id: intent.taskId });
    case 'move-task':
      return intent.projectId === undefined
        ? t('web.ai.tools.intentMoveTaskOut', { id: intent.taskId })
        : t('web.ai.tools.intentMoveTask', { id: intent.taskId, project: intent.projectId });
    case 'uncomplete-task':
      return t('web.ai.tools.intentUncompleteTask', { id: intent.taskId });
    case 'rename-project':
      return t('web.ai.tools.intentRenameProject', { name: intent.name });
    case 'archive-project':
      return t('web.ai.tools.intentArchiveProject', { id: intent.projectId });
    case 'delete-project':
      return t('web.ai.tools.intentDeleteProject', { id: intent.projectId });
    case 'rename-tag':
      return t('web.ai.tools.intentRenameTag', { name: intent.name });
    case 'delete-tag':
      return t('web.ai.tools.intentDeleteTag', { id: intent.tagId });
    case 'delete-note':
      return t('web.ai.tools.intentDeleteNote', { id: intent.noteId });
    case 'restore-note':
      return t('web.ai.tools.intentRestoreNote', { id: intent.noteId });
    case 'move-note':
      return intent.projectId === undefined
        ? t('web.ai.tools.intentMoveNoteOut', { id: intent.noteId })
        : t('web.ai.tools.intentMoveNote', { id: intent.noteId, project: intent.projectId });
    case 'update-reminder':
      return t('web.ai.tools.intentUpdateReminder', { when: `${intent.date} ${intent.time}` });
    case 'delete-reminder':
      return t('web.ai.tools.intentDeleteReminder', { id: intent.reminderId });
    case 'delete-event':
      return t('web.ai.tools.intentDeleteEvent', { id: intent.eventId });
    case 'restore-event':
      return t('web.ai.tools.intentRestoreEvent', { id: intent.eventId });
    case 'archive-event':
      return t('web.ai.tools.intentArchiveEvent', { id: intent.eventId });
    // 批次2：层级移动 / 批量 / 排序
    case 'set-task-parent':
      return intent.parentId === undefined
        ? t('web.ai.tools.intentSetTaskParentTop', { id: intent.taskId })
        : t('web.ai.tools.intentSetTaskParent', { id: intent.taskId, parent: intent.parentId });
    case 'trash-tasks':
      return t('web.ai.tools.intentTrashTasks', { count: String(intent.taskIds.length) });
    case 'restore-tasks':
      return t('web.ai.tools.intentRestoreTasks', { count: String(intent.taskIds.length) });
    case 'reorder-task':
      return t('web.ai.tools.intentReorderTask', { id: intent.taskId });
    case 'move-project':
      return intent.parentId === undefined
        ? t('web.ai.tools.intentMoveProjectTop', { id: intent.projectId })
        : t('web.ai.tools.intentMoveProject', { id: intent.projectId, parent: intent.parentId });
    case 'restore-project':
      return t('web.ai.tools.intentRestoreProject', { id: intent.projectId });
    // 批次3：子任务 / 备注 / 重复 / 习惯
    case 'create-subtask':
      return t('web.ai.tools.intentCreateSubtask', { parent: intent.parentId, title: intent.title });
    case 'set-task-note':
      return intent.note === undefined
        ? t('web.ai.tools.intentClearTaskNote', { id: intent.taskId })
        : t('web.ai.tools.intentSetTaskNote', { id: intent.taskId });
    case 'set-task-repeat':
      return intent.rule === undefined
        ? t('web.ai.tools.intentClearTaskRepeat', { id: intent.taskId })
        : t('web.ai.tools.intentSetTaskRepeat', { id: intent.taskId, rule: intent.rule });
    case 'rename-habit':
      return t('web.ai.tools.intentRenameHabit', { name: intent.name });
    case 'delete-habit':
      return t('web.ai.tools.intentDeleteHabit', { id: intent.habitId });
    case 'restore-habit':
      return t('web.ai.tools.intentRestoreHabit', { id: intent.habitId });
    // 批次4：任务标记 / 批量移动 / 打卡撤销
    case 'set-task-important':
      return intent.important
        ? t('web.ai.tools.intentSetTaskImportant', { id: intent.taskId })
        : t('web.ai.tools.intentUnsetTaskImportant', { id: intent.taskId });
    case 'set-task-pinned':
      return intent.pinned
        ? t('web.ai.tools.intentSetTaskPinned', { id: intent.taskId })
        : t('web.ai.tools.intentUnsetTaskPinned', { id: intent.taskId });
    case 'set-task-assignee':
      return intent.assigneeUserId === undefined
        ? t('web.ai.tools.intentClearTaskAssignee', { id: intent.taskId })
        : t('web.ai.tools.intentSetTaskAssignee', { id: intent.taskId, assignee: intent.assigneeUserId });
    case 'move-tasks':
      return intent.projectId === undefined
        ? t('web.ai.tools.intentMoveTasksOut', { count: String(intent.taskIds.length) })
        : t('web.ai.tools.intentMoveTasks', { count: String(intent.taskIds.length), project: intent.projectId });
    case 'undo-checkin':
      return intent.date === undefined
        ? t('web.ai.tools.intentUndoCheckinToday', { id: intent.habitId })
        : t('web.ai.tools.intentUndoCheckin', { id: intent.habitId, date: intent.date });
    // 批次5：重复任务控制
    case 'skip-task-occurrence':
      return t('web.ai.tools.intentSkipOccurrence', { id: intent.taskId });
    case 'set-task-repeat-after-completion':
      return intent.on
        ? t('web.ai.tools.intentRepeatAfterCompletionOn', { id: intent.taskId })
        : t('web.ai.tools.intentRepeatAfterCompletionOff', { id: intent.taskId });
    // 批6：清单 / 习惯属性
    case 'set-project-color':
      return intent.color === undefined
        ? t('web.ai.tools.intentClearProjectColor', { id: intent.projectId })
        : t('web.ai.tools.intentSetProjectColor', { id: intent.projectId, color: String(intent.color) });
    case 'set-project-icon':
      return intent.icon === undefined
        ? t('web.ai.tools.intentClearProjectIcon', { id: intent.projectId })
        : t('web.ai.tools.intentSetProjectIcon', { id: intent.projectId, icon: intent.icon });
    case 'set-project-view-mode':
      return intent.viewMode === undefined
        ? t('web.ai.tools.intentClearProjectViewMode', { id: intent.projectId })
        : t('web.ai.tools.intentSetProjectViewMode', { id: intent.projectId, viewMode: intent.viewMode });
    case 'set-project-kind':
      return intent.kind === undefined
        ? t('web.ai.tools.intentClearProjectKind', { id: intent.projectId })
        : t('web.ai.tools.intentSetProjectKind', { id: intent.projectId, kind: intent.kind });
    case 'set-project-show-in-smart-list':
      return intent.showInSmartList
        ? t('web.ai.tools.intentSetProjectShowInSmartList', { id: intent.projectId })
        : t('web.ai.tools.intentHideProjectFromSmartList', { id: intent.projectId });
    case 'set-habit-color':
      return intent.color === undefined
        ? t('web.ai.tools.intentClearHabitColor', { id: intent.habitId })
        : t('web.ai.tools.intentSetHabitColor', { id: intent.habitId, color: String(intent.color) });
    case 'set-habit-icon':
      return intent.icon === undefined
        ? t('web.ai.tools.intentClearHabitIcon', { id: intent.habitId })
        : t('web.ai.tools.intentSetHabitIcon', { id: intent.habitId, icon: intent.icon });
    case 'set-habit-goal':
      return t('web.ai.tools.intentSetHabitGoal', { id: intent.habitId });
    case 'set-habit-frequency':
      return intent.frequency === undefined
        ? t('web.ai.tools.intentClearHabitFrequency', { id: intent.habitId })
        : t('web.ai.tools.intentSetHabitFrequency', { id: intent.habitId });
    // 批6-2：四象限 / 推迟今天
    case 'set-task-quadrant':
      return t('web.ai.tools.intentSetTaskQuadrant', { id: intent.taskId, quadrant: String(intent.quadrant) });
    case 'postpone-task-to-today':
      return t('web.ai.tools.intentPostponeTaskToday', { id: intent.taskId });
    case 'record-habit-checkins':
      return t('web.ai.tools.intentRecordHabitCheckins', { count: String(intent.habitIds.length) });
    // 批7：任务结构化子项
    case 'set-task-checklist':
      return t('web.ai.tools.intentSetTaskChecklist', { id: intent.taskId, count: String(intent.items.length) });
    case 'toggle-checklist-item':
      return intent.done
        ? t('web.ai.tools.intentCheckChecklistItem', { id: intent.taskId, item: intent.itemText })
        : t('web.ai.tools.intentUncheckChecklistItem', { id: intent.taskId, item: intent.itemText });
    // P4：评论（COMMENT）—— share 感知的独立通道。与 web 那份逐字同口径（无 default）。
    case 'add-task-comment':
      return t('web.ai.tools.intentAddTaskComment', { body: intent.body });
    case 'delete-task-comment':
      return t('web.ai.tools.intentDeleteTaskComment', { id: intent.commentId });
    // 批8：附件（ATTACHMENT）
    case 'rename-attachment':
      return t('web.ai.tools.intentRenameAttachment', { id: intent.attachmentId, fileName: intent.fileName });
    case 'remove-attachment':
      return t('web.ai.tools.intentRemoveAttachment', { id: intent.attachmentId });
  }
}
