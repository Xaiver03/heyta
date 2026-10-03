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
import {
  captureChipRemainingDays,
  captureChipTimeLabel,
  capturePriorityLabelKey,
  type CaptureComposerLabels,
} from '@heyta/ui';

import type { Translate } from '../i18n/translate';
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
    previewLead: t('mobile.capture.previewLead'),
    previewEmpty: t('mobile.capture.previewEmpty'),
    restoreAria: (raw) => t('mobile.capture.restoreAria', { raw }),
    ignoreAria: (raw) => t('mobile.capture.ignoreAria', { raw }),
    valueLabel: (chip, now) => {
      // 🔴 与 web 同一处判定：时刻芯片念归一化后的 `HH:MM`（共享层给串），
      //   掉进下面的优先级兜底会念成「不设置」。
      const timeLabel = captureChipTimeLabel(chip);
      if (timeLabel !== undefined) return timeLabel;
      const days = captureChipRemainingDays(chip, now);
      if (chip.dueDate !== undefined && days !== undefined) {
        return t('mobile.capture.valueWithRemaining', {
          date: chip.dueDate,
          remaining: remainingText(days, t),
        });
      }
      return t(capturePriorityLabelKey(chip.priority));
    },
  };
}

/** 组件里用。`useMemo` 依赖只有 `t`，所以同一次渲染里它是稳定引用。 */
export function useCaptureLabels(): CaptureComposerLabels {
  const { t } = useI18n();
  return useMemo(() => captureLabels(t), [t]);
}
