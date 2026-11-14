/**
 * 快速捕获输入框（Web 壳）
 * ==========================
 *
 * 🔴 M3 第八刀之后，这个文件**只剩接线**。
 *
 * 输入行、识别芯片（原文 → 解析结果 → 取消/恢复/「未采用」）、实际标题预览，
 * 全部由 `@heyta/ui` 的 `CaptureComposer` 渲染 —— 与移动端将是**同一份实现**。
 * 这里只回答 web 自己的两个问题：
 *
 *   1. **文案**从哪来 → `@heyta/i18n` 的 `web.capture.*`；
 *      芯片的剩余天数由共享层算，措辞在这里说成当前语言；
 *   2. **提交**到哪去 → `useTaskStore#addTask`（op-log 的唯一写入口，AGENTS.md §3.4），
 *      落点由 `destination` 决定 —— **当下面板停在哪个清单，新任务就留在哪个清单**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 2026-11：这里**不再有任何 AI**（第 3 个问题被删掉了）
 *
 * 「一句话捕获」连同图片附件一起搬进了右侧助手
 * （见 `apps/web/src/features/ai/AssistantPanel.tsx` 的 `captureTarget` 那段，
 * 那里写了搬家的理由、判据，以及"为什么它不能顺手删掉"）。
 * 于是这个输入框回到滴答那种形状：**你写什么，规则就当场读什么**。
 *
 * 解析一行都不在这里：它仍然是 `@heyta/domain#parseCapture`。判据还是
 * AGENTS.md §3.5 那句：这里有没有任何一行在决定"业务上该怎么做"？
 * 没有 —— 判断（芯片三态 / 忽略清单 / 提交换算）在
 * `packages/ui/src/capture/model.ts`，写库在 app-host 的 action 层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `HeytaUiProvider` 必须包在**这一处**
 *
 * 共享 `CaptureComposer` 透过 `useHeytaTokens` / `useHeytaText` 取 token，
 * 而 `App.tsx` 里 `CaptureComposer` 挂在内容区，**不在** `tasks` 那棵树内
 * （那个 Provider 只包了一棵子树）。所以这里自己内联挂一层 ——
 * 这正是 M3 第二刀（focus）在运行时抛
 * 「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」的形状。
 *
 * ✅ 本轮**同时**把 `CaptureComposer` 登记进了 `scripts/check-ui-provider.mjs`
 * 的 `PROVIDER_DEPENDENT`（那个缺口此前连续出现过五次，见
 * `apps/web/src/features/settings/HelpPanel.tsx` 文件头）。别把下面这层删掉：
 * 删了门禁会红。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本刀真实丢掉的东西（登记，不是修复）
 *
 * 1. **`.ht-input` 的悬停态**：迁移前输入框走 `styles/app.css` 的 `.ht-input`
 *    （`:hover` / `:focus-visible` 换边框色），共享层是 RN `TextInput`，
 *    RN 没有 hover。**桌面鼠标用户在这一处少了一个反馈** —— 这不是实现细节。
 *    最小一步：共享层加 `onFocus`/`onBlur` 状态 + 边框色，需要产品先定焦点环。
 * 2. ✅ **`.ht-compose-wrap` / `.ht-capture*` 是死规则**（`grep` 实测 TSX 里
 *    0 处引用）。⚠️ `.ht-compose` **不是**死的 —— `features/tasks/NoteEditor.tsx`
 *    还在用它当"输入行"容器（实测）。
 *    **已在 2026-09-28 由父 agent 删除**（`app.css` 不在本刀白名单）：
 *    顶层 `ht-*` 选择器 205 → 190（删 15 条：`.ht-compose-wrap` 2 + `.ht-capture*` 13），
 *    `.ht-compose` 已保留；`HT_FAMILY_BASELINE` **29 → 28**（P1 棘轮）。
 *    ⚠️ 删除前特意核过"我扫到的那处引用是不是真代码" —— 结果是**本文件自己这段注释**。
 *    **在这个仓库里，`grep` 的命中必须先区分"代码"与"描述代码的文字"。**
 */

import { useCallback, useMemo } from 'react';

import { useI18n } from '@heyta/i18n';

import {
  diffDays,
  quickDuePickDates,
  today,
  type LocalDate,
} from '@heyta/domain';

import {
  CaptureComposer as SharedCaptureComposer,
  HeytaUiProvider,
  WEEKDAY_MESSAGE_KEYS,
  captureChipRemainingDays,
  captureChipTimeLabel,
  captureCapsuleShowsWord,
  capturePriorityLabelKey,
  formatMonthTitleText,
  type CaptureCapsuleKind,
  type CaptureComposerLabels,
  type CaptureDue,
  type CapturePanelSlot,
  type CaptureSubmitPlan,
  type DatePickerQuickPick,
} from '@heyta/ui';

import { formatDayTitleText } from '@heyta/ui';

import { dateWithRemaining } from '../ai/locale-punctuation.js';
import { QUICK_PICK_LABEL_KEYS } from '../tasks/DueEditor.js';
import { CaptureDuePopover } from './CaptureDuePopover.js';
import { useTaskStore } from '../tasks/store.js';
import { remainingText } from '../../lib/due-display.js';

/**
 * 这个组件现在**只有确定性捕获**，一行 AI 都没有。
 *
 * 🔴 「一句话解析」（AI）已经搬进右侧助手（2026-11 产品裁决）：
 * 它是 AI 的能力，不该占着每次新建任务的输入框。搬走的理由、以及
 * "为什么它不能被删掉"，写在 `AssistantPanel.tsx` 的 `captureTarget` 那段。
 *
 * 因此本组件的 props 也一起瘦了：`routing` / `consents` / `secrets` /
 * `healthSnapshot` / `preferenceSet` / `onHealth` / `onFeedback` 全部移除。
 * 留着它们等于留一条"配置了但没人读"的路 —— 那正是本仓库最忌讳的形状。
 */
export interface CaptureComposerProps {
  /**
   * 这一条新任务要落进哪个**清单**。没有就是收集箱（`addTask` 不带 `projectId`）。
   *
   * 🔴 它是**一个对象而不是两个可选字段**，因为这两件事必须同时成立或同时不成立：
   * 拆成 `projectId` + `projectName` 之后，调用方可以只传一半，于是
   * 「写进了清单、占位符却说不写」—— 界面说谎，而且没有任何类型会拦。
   */
  destination?: CaptureDestination | undefined;
  /**
   * **锚点日**（R11 批五）。给了它，输入里没写日期的任务就落在这一天；
   * 输入里写了「明天」仍然以输入为准（优先级在共享层 `toCaptureSubmitPlan`）。
   *
   * 🔴 传了这个就必须让 placeholder **说出落点** —— 本文件下面那条分支
   *   就是在做这件事，别把它改成通用 placeholder。
   */
  anchorDate?: LocalDate | undefined;
  /**
   * 日期面板**就地展开**（不套锚定浮层）。
   *
   * 🔴 给"已经在一个浮层里"的落点用 —— 现在只有一枚：日历那个捕获编辑器。
   * 在那里再 Portal 一层，外层编辑器的"点了外面就收"会把点月历读成点外面，
   * 于是用户点的是日子，界面弹出的是「放弃这次的修改？」。
   * 判据：`e2e/tests/capture-due-capsule.spec.ts` 的「日历落点」那一条。
   */
  inlineDuePanel?: boolean;
  /**
   * **一次性填充请求**（首启引导的示例 chip）。
   *
   * 本文件只是透传 —— 语义在共享层 `CaptureComposerProps.fillRequest`：
   * `nonce` 变化即把 `text` 灌进输入框，同一个 `nonce` 不重放。
   *
   * 🔴 为什么引导走这条路而不是直接建任务：`@heyta/domain#parseCapture`
   * 要求调用方把 `matches` 展示给用户确认，直接落库会把误报变成静默改写。
   */
  fillRequest?: { readonly text: string; readonly nonce: number } | undefined;
}

/** 落点：清单 id + 它在界面上的名字（用户自己的字，不翻译）。 */
export interface CaptureDestination {
  readonly projectId: string;
  readonly name: string;
}

export function CaptureComposer(props: CaptureComposerProps): React.JSX.Element {
  const addTask = useTaskStore((s) => s.addTask);
  const { t, locale } = useI18n();
  const destination = props.destination;
  const anchorDate = props.anchorDate;

  /**
   * 文案全部由宿主注入（共享层不 import `@heyta/i18n`）。
   *
   * `valueLabel` 里**天数是共享层算的**（`captureChipRemainingDays` ←
   * `@heyta/domain#diffDays` + `today`），这里只负责说成当前语言 ——
   * 迁移前这一步在 web 组件里，那就是"同一个日期在两端可以差一天"的种子。
   */
  const labels = useMemo<CaptureComposerLabels>(
    () => ({
      placeholder:
        anchorDate === undefined
          ? destination === undefined
            ? t('web.capture.placeholder')
            : t('web.capture.placeholderTo', { list: destination.name })
          // 锚点那一档必须**自己说一句**，不能复用清单那句：
          // "添加到 10月8日"与"添加到「工作」"是两件不同的事，
          // 合成一句就会有一边说不清。
          : t('web.capture.placeholderToDay', { day: formatDayTitleText(anchorDate, t) }),
      addLabel: t('web.capture.addLabel'),
      add: t('web.capture.add'),
      matchesAria: t('web.capture.matches.aria'),
      rejected: t('web.capture.rejected'),
      unused: t('web.capture.unused'),
      restoreAria: (raw) => t('web.capture.restoreAria', { raw }),
      ignoreAria: (raw) => t('web.capture.ignoreAria', { raw }),
      valueLabel: (chip, now) => {
        // 🔴 时刻芯片先走共享层那句（否则它会掉进下面的优先级兜底、念成「不设置」）。
        const timeLabel = captureChipTimeLabel(chip);
        if (timeLabel !== undefined) {
          /**
           * 自带日期的时刻芯片要**把哪一天一起念出来**。
           *
           * 「下午3点」在领域层是一条匹配（日期与时刻同时成立，落在今天），
           * 所以芯片只有一条。只念「15:00」的话，用户看不出解析器认的是
           * 今天还是明天 —— 而"猜错了哪一天"正是这个字段唯一致命的错法。
           * 念成「今天 15:00」一次说清（滴答清单同款）。
           */
          const timeDays = captureChipRemainingDays(chip, now);
          if (chip.dueDate !== undefined && timeDays !== undefined) {
            return t('web.capture.value.dayTime', {
              day: remainingText(timeDays, t),
              time: timeLabel,
            });
          }
          return timeLabel;
        }
        const days = captureChipRemainingDays(chip, now);
        if (chip.dueDate !== undefined && days !== undefined) {
          return dateWithRemaining(chip.dueDate, remainingText(days, t), locale);
        }
        return t(capturePriorityLabelKey(chip.priority));
      },
      /**
       * 胶囊上的字。**三档由共享层判**（`captureCapsuleKind`），这里只说话。
       *
       * 🔴 `empty` 那一档返回**空串** —— 那时只画图标。写「未设置」是本仓明令
       * 禁止的审计腔（`web.tasks.detail.unset` 那一键不许流到这里）。
       * 「今天 / 明天 / 还剩 N 天」这套说法复用 `remainingText`，
       * 与列表行右侧那枚日期徽标**同一个出处** —— 同一件事在同一个屏幕上不许有两种叫法。
       */
      capsule: (due: CaptureDue, kind: CaptureCapsuleKind, now: number) => {
        if (kind === 'empty' || due.date === undefined) return '';
        const days = diffDays(today(now), due.date);
        // 🔴 近三天说相对词，更远必须说**哪一天**：「还剩 5 天」省掉的正是这里
        // 唯一不能错的信息（分档判断在共享层 `captureCapsuleShowsWord`）。
        const day = captureCapsuleShowsWord(days)
          ? remainingText(days, t)
          : t('web.due.dayLabel', {
              month: Number(due.date.slice(5, 7)),
              day: Number(due.date.slice(8, 10)),
            });
        return kind === 'day-time' && due.time !== undefined
          ? t('web.capture.value.dayTime', { day, time: due.time })
          : day;
      },
      capsuleAria: (text) =>
        text === '' ? t('web.capture.capsule.aria.unset') : t('web.capture.capsule.aria.value', { value: text }),
      panel: {
        title: t('web.capture.panel.title'),
        dueItems: t('web.capture.panel.dueItems'),
        // 🔴 月历那一份措辞**复用 `web.due.*`**，与详情面/行尾编辑器同一出处：
        // 同一个 `DatePicker` 在两个落点说两种话，界面上就是两个不同的产品。
        datePicker: {
          weekdays: WEEKDAY_MESSAGE_KEYS.map((key) => t(key)),
          monthTitle: (month) => formatMonthTitleText(month, t),
          clear: t('web.due.clear'),
          prevMonth: t('web.due.prevMonth'),
          nextMonth: t('web.due.nextMonth'),
          dayLabel: (month, day) => t('web.due.dayLabel', { month, day }),
        },
        time: {
          timeLabel: t('common.due.timeLabel'),
          allDay: t('common.due.allDay'),
          placeholder: t('common.due.timePlaceholder'),
          // 这里没有"哪一条任务"可指名（任务还没建），所以不能用带 {title} 的 `common.due.timeAria`。
          aria: t('web.capture.panel.timeAria'),
          otherTime: t('web.capture.panel.time.otherTime'),
          backToList: t('web.capture.panel.time.backToList'),
          backToDay: t('web.capture.panel.time.backToDay'),
          rowAria: t('web.capture.panel.time.rowAria'),
        },
      },
    }),
    [t, locale, destination, props.anchorDate],
  );

  /** 快捷四档：数学在 `@heyta/domain`，措辞与行尾那个编辑器共用同一张映射表。 */
  const quickPicks = useMemo<readonly DatePickerQuickPick[]>(
    () =>
      quickDuePickDates(today(Date.now())).map((pick) => ({
        key: pick.key,
        label: t(QUICK_PICK_LABEL_KEYS[pick.key]!),
        date: pick.date,
      })),
    [t],
  );

  /** 外壳：锚定浮层（Portal + fixed）。面板本体是共享的，这里只决定它画在哪儿。 */
  const renderDuePanel = useCallback(
    (slot: CapturePanelSlot) => (
      <CaptureDuePopover content={slot.content} onClose={slot.onClose} title={t('web.capture.panel.title')} />
    ),
    [t],
  );

  /**
   * 提交。`plan.dueDate` 已经是 epoch ms（共享层换算完），这里只把它交给
   * op-log 的唯一写入口 —— **不再做第二次时区换算**。
   *
   * 🔴 `projectId` 也在这里交：**打开某个清单时新建的任务必须留在清单里**。
   * 不传的话它会落进收集箱，从这条刚显示过的列表里消失，
   * 而界面从头到尾没说过"这条不会出现在这里"。
   */
  const onSubmit = useCallback(
    (plan: CaptureSubmitPlan) =>
      addTask(plan.title, {
        ...(plan.dueDate !== undefined ? { dueDate: plan.dueDate } : {}),
        ...(plan.priority !== undefined ? { priority: plan.priority } : {}),
        ...(destination !== undefined ? { projectId: destination.projectId } : {}),
      }),
    [addTask, destination],
  );

  return (
    <HeytaUiProvider>
      {/*
        🔴 `data-heyta-capture-root` **跟着图片附件一起走了**。

        它原来是粘贴归属判据：文档级 paste 监听靠它区分"在捕获框里粘贴"与
        "在搜索框里粘贴"。现在捕获框不再收图（截图转任务搬进了右侧助手，
        那里有自己的 `data-heyta-chat-root`），留着一个没有任何监听方的
        作用域属性只会让下一个读代码的人以为这里还在收图。
      */}
      <SharedCaptureComposer
        labels={labels}
        onSubmit={onSubmit}
        anchorDate={anchorDate}
        quickPicks={quickPicks}
        fillRequest={props.fillRequest}
        renderDuePanel={props.inlineDuePanel === true ? undefined : renderDuePanel}
      />
    </HeytaUiProvider>
  );
}
