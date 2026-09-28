/**
 * 任务行上的「提醒」面板
 * ========================
 *
 * 形状与 `features/tasks/NoteEditor.tsx` / `TaskOrganizer.tsx` 同族：
 * **`<details>` + `<summary>` chip**，有提醒时 chip 常驻（显示条数），
 * 展开才是真正的操作面板。
 *
 * 🔴 列表本身（一行提醒是什么状态、能对它做什么、按钮给哪几档提前量）
 * 全部由 `@heyta/ui` 的 `ReminderList` 渲染 —— 与 mobile 是**同一份实现**。
 * 本文件只做三件事：
 *
 *   1. 从 `useReminderStore` 取这一条任务的提醒；
 *   2. 把 `ReminderListLabels` 填成中文/英文（共享层不 import i18n）；
 *   3. 把六个回调接到动作层，并把动作抛出的错误显示出来。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 绝对时刻入口为什么是"正好 1 小时"
 *
 * 没有截止时间的任务算不出相对提前量，共享层只渲染 `labels.absolute`
 * 一个按钮。它的文案 key 是 `reminder.absolute.1h`（「1 小时后提醒」），
 * 所以宿主**必须**用 `now + 1h` 建提醒 —— 文案与默认值分居两处，
 * 键名里的 `1h` 是唯一能把它们绑在一起的地方。写别的时长就是
 * "按钮说 1 小时、实际建 3 天"那类静默错位。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 错误必须显示
 *
 * 动作层对"任务没有截止时间"（`createReminderBeforeDue`）与
 * "超过每任务上限"（`MAX_REMINDERS_PER_TASK`）都是**抛错**。
 * store 把它接进 `error`，这里渲染出来 —— 否则用户点第六个预设得到的
 * 是一个点了没反应的按钮，而没有任何地方会告诉他为什么。
 */

import { useMemo } from 'react';
import { useI18n, type I18nValue, type Locale } from '@heyta/i18n';
import type { Task } from '@heyta/domain';
import { HeytaUiProvider, ReminderList, type ReminderListLabels } from '@heyta/ui';
import { Bell } from 'lucide-react';

import { useTaskStore } from '../tasks/store.js';
import { useReminderStore } from './store.js';

/** chip 图标尺寸。**不许在 JSX 里散落字面量。** */
const CHIP_ICON_SIZE = 12;

/** 「1 小时后提醒」的那一小时。改它就必须同时改 `reminder.absolute.1h` 的文案。 */
const ABSOLUTE_LEAD_MS = 60 * 60 * 1000;

/**
 * 提前量预设文案的 key，**顺序必须与 `REMINDER_OFFSET_PRESETS_MS` 完全一致**。
 *
 * 🔴 共享组件按**下标**取文案（`labels.offsets[i]` ↔ `offsetPresets()[i]`）。
 * 这里与领域层的数组对不上时，界面会画出"提前 30 分钟"的按钮、
 * 点下去建的却是"提前 1 天"的提醒 —— 那种错**没有任何类型或渲染断言能抓到**，
 * 所以 `apps/web/tests/reminders-panel.spec.tsx` 用
 * `REMINDER_OFFSET_PRESETS_MS.length` 把这条对应关系钉死。
 */
export const REMINDER_OFFSET_KEYS = [
  'reminder.offset.0',
  'reminder.offset.5m',
  'reminder.offset.15m',
  'reminder.offset.30m',
  'reminder.offset.1h',
  'reminder.offset.1d',
] as const;

/**
 * 触发时刻 → 人读的字符串。
 *
 * 与 `TrashView.formatDeletedAt` 同一条理由：写死 `'zh-CN'` 会让英文界面
 * 用中文习惯排日期 —— 这是最容易被漏掉的一类"看不见的文案"。
 */
export function formatReminderWhen(at: number, locale: Locale): string {
  return new Date(at).toLocaleString(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 构造共享 `ReminderList` 的全部文案。字段名与 `ReminderListLabels` 逐项对应，漏了编译不过。 */
export function reminderListLabels(t: I18nValue['t'], locale: Locale): ReminderListLabels {
  const when = (at: number): string => formatReminderWhen(at, locale);
  return {
    title: t('reminder.title'),
    empty: t('reminder.empty'),
    add: t('reminder.add'),
    // 🔴 顺序 = `REMINDER_OFFSET_PRESETS_MS` 的顺序（见上）。
    offsets: REMINDER_OFFSET_KEYS.map((key) => t(key)),
    snooze: t('reminder.snooze'),
    dismiss: t('reminder.dismiss'),
    remove: t('reminder.remove'),
    noDueDate: t('reminder.hint.noDueDate'),
    absolute: t('reminder.absolute.1h'),
    phase: {
      scheduled: t('reminder.phase.scheduled'),
      snoozed: t('reminder.phase.snoozed'),
      due: t('reminder.phase.due'),
      fired: t('reminder.phase.fired'),
      dismissed: t('reminder.phase.dismissed'),
    },
    // 无障碍名依赖**那一条的时刻**，所以是函数而不是句子。
    a11yRemove: (at) => t('reminder.a11y.remove', { when: when(at) }),
    a11ySnooze: (at) => t('reminder.a11y.snooze', { when: when(at) }),
    a11yDismiss: (at) => t('reminder.a11y.dismiss', { when: when(at) }),
    a11yList: (title) => t('reminder.a11y.list', { title }),
  };
}

/** 空数组必须**引用稳定**：每次渲染给一个新 `[]` 会让下游 memo 白跑。 */
const NO_REMINDERS: readonly never[] = [];

export function ReminderPanel({ task }: { task: Task }): React.JSX.Element {
  const { t, locale } = useI18n();
  // ⚠️ 取整个 `byTask` 对象，**不要**在 selector 里现算数组：
  // zustand v5 用 `useSyncExternalStore`，selector 每次返回新引用会被判成
  // "快照一直在变" → `Maximum update depth exceeded`（`App.tsx` 记过同类崩溃）。
  const byTask = useReminderStore((s) => s.byTask);
  const error = useReminderStore((s) => s.error);
  const addBeforeDue = useReminderStore((s) => s.addBeforeDue);
  const addAbsolute = useReminderStore((s) => s.addAbsolute);
  const snooze = useReminderStore((s) => s.snooze);
  const dismiss = useReminderStore((s) => s.dismiss);
  const remove = useReminderStore((s) => s.remove);
  /**
   * 「现在」取任务 store 的 `now`（每 60s 推进会重渲染），**不读 `Date.now()`**：
   * 同一次渲染里不同提醒跨过触发点会让相位显示不一致，而且没法稳定断言。
   */
  const now = useTaskStore((s) => s.now);

  const reminders = byTask[task.id] ?? NO_REMINDERS;
  const labels = useMemo(() => reminderListLabels(t, locale), [t, locale]);
  const message = error !== undefined && error.taskId === task.id ? error.message : undefined;

  return (
    /**
     * 🔴 `HeytaUiProvider` 必须包在**这一处**。
     *
     * 面板虽然是 `TaskList` 的 `renderTrailing` 渲染出来的（那棵树已经在
     * Provider 之内），但 `ReminderList` 会 `useHeytaUiTheme()`，而
     * `check:ui-provider` 的静态扫描**看不穿 render prop** —— 不在这里补一层，
     * 门禁会把它报成"落在 Provider 子树之外"（与 NotesView 同一条纪律）。
     */
    <HeytaUiProvider>
      <details className="ht-compose--popover">
      {/*
        有提醒时常驻一个**实心** chip 并显示条数 —— 扫一眼列表就知道
        哪些任务挂了提醒、各挂了几条。没有提醒时退成一个低调的入口。
        ⚠️ 无障碍名带上任务标题：读屏用户在一长串列表里听到二十个「提醒」
        无从分辨要展开哪一个。
      */}
      <summary
        className={reminders.length > 0 ? 'ht-chip ht-chip--on' : 'ht-chip'}
        aria-label={t('reminder.a11y.list', { title: task.title })}
      >
        <Bell size={CHIP_ICON_SIZE} aria-hidden="true" />
        <span>{reminders.length > 0 ? String(reminders.length) : t('reminder.title')}</span>
      </summary>

      <div className="ht-compose-panel">
        <ReminderList
          reminders={reminders}
          now={now}
          hasDueDate={task.dueDate !== undefined}
          onAdd={(offsetMs) => {
            void addBeforeDue(task.id, offsetMs);
          }}
          // 🔴 正好 1 小时 —— 与 `reminder.absolute.1h` 的文案是同一个契约（见文件头）。
          onAddAbsolute={() => {
            void addAbsolute(task.id, Date.now() + ABSOLUTE_LEAD_MS);
          }}
          // 传的是**提醒自己的 id**，不是 taskId（共享层与动作层的契约）。
          onSnooze={(entityId) => {
            void snooze(entityId);
          }}
          onDismiss={(entityId) => {
            void dismiss(entityId);
          }}
          onRemove={(entityId) => {
            void remove(entityId);
          }}
          labels={labels}
          formatWhen={(at) => formatReminderWhen(at, locale)}
          testID={`reminder-list-${task.id}`}
        />

        {message !== undefined && (
          <p className="ht-settings__hint" role="alert">
            {message}
          </p>
        )}
      </div>
      </details>
    </HeytaUiProvider>
  );
}
