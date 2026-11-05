/**
 * 移动端的捕获文案装配（`capture` 整刀的尾巴）
 * ================================================
 *
 * 与 web 的 `features/capture/CaptureComposer.tsx` 同形：把词条表装成共享层
 * `CaptureComposer` 要的 `CaptureComposerLabels`。共享组件**不 import
 * `@heyta/i18n`**（会拖进第二份 React，见 `TaskList.tsx` 文件头），所以
 * 每一句文案都必须由宿主注入 —— 这正是"两端共用一份组件、只有措辞不同"的落点。
 *
 * ## 🔴 优先级那四条**刻意复用 `web.capture.priority.*`**
 *
 * `@heyta/ui` 的 `capturePriorityLabelKey()` 返回的是 web 前缀的 key，而本文件
 * 直接用它 —— 这不是笔误，是照抄那条已经写下的裁决（见
 * `packages/ui/src/capture/model.ts` 的 `CapturePriorityLabelKey` 注释：
 * 加同义键要动 `packages/i18n` 那一条 lane，当时判为不值得）。
 *
 * ⚠️ 它是**一笔如实的债**：词条表里 `web.*` 被移动端借用，收口方式与
 * `mobile.growth.*` 那次一样 —— 等真有第三端要同一句话时再统一改名。
 *
 * ## 日期那条为什么只拼 `chip.dueDate`
 *
 * `chip.dueDate` 是领域层给的 `LocalDate`（`2026-09-26`），web 也是原样显示它、
 * 只把"还有几天"说成人话。两端因此**逐字一致** —— 这正是
 * `captureChipRemainingDays()` 被放进共享层的原因（天数由共享层算，
 * 宿主只负责措辞，否则同一个日期在两端可以差一天）。
 */

import { useMemo } from 'react';

import { useI18n } from '@heyta/i18n';
import { diffDays, today } from '@heyta/domain';
import {
  captureChipRemainingDays,
  captureChipTimeLabel,
  captureCapsuleShowsWord,
  capturePriorityLabelKey,
  type CaptureCapsuleKind,
  type CaptureComposerLabels,
  type CaptureDue,
  type CaptureProjectPicker,
} from '@heyta/ui';

import type { Translate } from '../i18n/translate';
import { datePickerLabels } from './date-picker-labels';
import { remainingText } from './due-display';

/**
 * 纯函数版：给一个 `t` 就能建出全部文案。
 *
 * 与 `lib/` 里其它 `*-display.ts` 同一形状 —— 于是它**能被单测直接调用**，
 * 不必挂 React。
 */
export function captureLabels(t: Translate): CaptureComposerLabels {
  return {
    placeholder: t('mobile.capture.placeholder'),
    addLabel: t('mobile.capture.addLabel'),
    add: t('mobile.capture.add'),
    matchesAria: t('mobile.capture.matchesAria'),
    rejected: t('mobile.capture.rejected'),
    unused: t('mobile.capture.unused'),
    restoreAria: (raw) => t('mobile.capture.restoreAria', { raw }),
    ignoreAria: (raw) => t('mobile.capture.ignoreAria', { raw }),
    valueLabel: (chip, now) => {
      // 🔴 与 web 同一处判定：时刻芯片念归一化后的 `HH:MM`（共享层给串），
      //   掉进下面的优先级兜底会念成「不设置」。
      const timeLabel = captureChipTimeLabel(chip);
      if (timeLabel !== undefined) {
        // 自带日期的时刻芯片念「今天 15:00」—— 与 web 逐字同规则。
        // 只念时刻的话，用户看不出认的是哪一天，而"哪一天"是这里唯一致命的错法。
        const timeDays = captureChipRemainingDays(chip, now);
        if (chip.dueDate !== undefined && timeDays !== undefined) {
          return t('mobile.capture.value.dayTime', {
            day: remainingText(timeDays, t),
            time: timeLabel,
          });
        }
        return timeLabel;
      }
      const days = captureChipRemainingDays(chip, now);
      if (chip.dueDate !== undefined && days !== undefined) {
        return t('mobile.capture.valueWithRemaining', {
          date: chip.dueDate,
          remaining: remainingText(days, t),
        });
      }
      return t(capturePriorityLabelKey(chip.priority));
    },
    /**
     * 胶囊上的字。三档由共享层判（`captureCapsuleKind`），这里只说话。
     *
     * 🔴 `empty` 返回**空串**（那时只画图标），与 web 那一份逐字同规则 ——
     * 两端在这里分叉的话，"没选日期"在两台设备上会长成两种样子。
     */
    capsule: (due: CaptureDue, kind: CaptureCapsuleKind, now: number) => {
      if (kind === 'empty' || due.date === undefined) return '';
      const days = diffDays(today(now), due.date);
      // 🔴 与 web 同一处分档（`captureCapsuleShowsWord` 在共享层）：近三天说相对词，
      // 更远必须说哪一天。日期那句复用详情面那一份 `mobile.datePicker.dayLabel`，
      // 不在这里另造一种"月日"的说法。
      const day = captureCapsuleShowsWord(days)
        ? remainingText(days, t)
        : t('mobile.datePicker.dayLabel', {
            month: Number(due.date.slice(5, 7)),
            day: Number(due.date.slice(8, 10)),
          });
      return kind === 'day-time' && due.time !== undefined
        ? t('mobile.capture.value.dayTime', { day, time: due.time })
        : day;
    },
    capsuleAria: (text) =>
      text === ''
        ? t('mobile.capture.capsule.aria.unset')
        : t('mobile.capture.capsule.aria.value', { value: text }),
    panel: {
      title: t('mobile.capture.panel.title'),
      dueItems: t('mobile.capture.panel.dueItems'),
      // 🔴 月历那份措辞复用详情面那一份 `datePickerLabels`（同一个 `DatePicker`、
      // 同一套说法），不是再抄一遍。
      datePicker: datePickerLabels(t),
      time: {
        timeLabel: t('common.due.timeLabel'),
        allDay: t('common.due.allDay'),
        placeholder: t('common.due.timePlaceholder'),
        aria: t('mobile.capture.panel.timeAria'),
        otherTime: t('mobile.capture.panel.time.otherTime'),
        backToList: t('mobile.capture.panel.time.backToList'),
        backToDay: t('mobile.capture.panel.time.backToDay'),
        rowAria: t('mobile.capture.panel.time.rowAria'),
      },
    },
  };
}

/** 组件里用。`useMemo` 依赖只有 `t`，所以同一次渲染里它是稳定引用。 */
export function useCaptureLabels(): CaptureComposerLabels {
  const { t } = useI18n();
  return useMemo(() => captureLabels(t), [t]);
}

/**
 * 「新建落进哪一份清单」那一行的文案（任务面板与便签板共用）。
 *
 * 🔴 芯片上的字是裸清单名，无障碍名与那一行的标题各是**一整句** ——
 * 不拿前缀拼名字（拼出来的句子在词表里查不到，换语言就散架）。
 */
export function captureProjectLabels(t: Translate): CaptureProjectPicker['labels'] {
  return {
    title: t('mobile.capture.project.title'),
    inbox: t('mobile.capture.project.inbox'),
    current: (name) => t('mobile.capture.project.current', { name }),
    currentInbox: t('mobile.capture.project.currentInbox'),
    inboxAria: t('mobile.capture.project.inboxAria'),
    optionAria: (name) => t('mobile.capture.project.optionAria', { name }),
  };
}

/** 组件里用。 */
export function useCaptureProjectLabels(): CaptureProjectPicker['labels'] {
  const { t } = useI18n();
  return useMemo(() => captureProjectLabels(t), [t]);
}
