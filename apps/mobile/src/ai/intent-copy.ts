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
import type { MessageKey } from '@heyta/i18n';

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

export function intentText(intent: LocalApiWriteIntent, t: Translate): string {
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
  }
}
