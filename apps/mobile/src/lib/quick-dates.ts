/**
 * 截止日期的快捷选择（mobile 侧的文案包装）
 * ===========================================
 *
 * 🔴 **日期数学已上移到 `@heyta/domain` 的 `quickDuePickDates`**（批一，
 * 多端入口覆盖 goal §2）—— web 补 due 编辑时两端要同一组按钮，
 * 按本文件当初的预言（"如果将来 Web 也要这套按钮，本文件应当整体提到
 * packages/domain"）整体上提了。这里只剩"key → 中文措辞"的映射：
 * 共享层不 import i18n（理由见 `packages/ui` 的 `TaskList.tsx` 文件头），
 * 所以文案留在各端。
 *
 * 语义（周日的「本周末」= 今天等边界）与测试都在 domain 那边钉着；
 * 本文件的职责是**措辞不能漂**。
 */

import { quickDuePickDates, type LocalDate } from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';

import type { Translate } from '../i18n/translate';

export interface QuickDatePick {
  /** 稳定 key，UI 用它做 `key` 与"当前选中"判定。 */
  key: string;
  label: string;
  date: LocalDate;
}

/**
 * 顺序固定：今天 → 明天 → 本周末 → 下周一。
 *
 * ⚠️ `t` 由调用方传入：本函数是纯函数，**不能**从 context 取。
 */
export function quickDatePicks(now: LocalDate, t: Translate): QuickDatePick[] {
  const labelKeys: Record<string, MessageKey> = {
    today: 'mobile.common.today',
    tomorrow: 'mobile.quickDate.tomorrow',
    weekend: 'mobile.quickDate.weekend',
    'next-week': 'mobile.quickDate.nextWeek',
  };
  return quickDuePickDates(now).map((pick) => ({
    key: pick.key,
    label: t(labelKeys[pick.key]!),
    date: pick.date,
  }));
}
