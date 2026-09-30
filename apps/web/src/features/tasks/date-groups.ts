/**
 * 任务日期分组头的**措辞**（滴答同款：`今天, 周一` / `9月30日, 周三`）。
 *
 * 🔴 分工：**归属规则在 `@heyta/domain` 的 `groupTasksByDate`**（哪条任务进哪组
 * 是产品语义，四端只能有一份）；本文件只做"组 → 一句人话"的映射 ——
 * 它必须住在宿主，因为共享层不许 `import '@heyta/i18n'`（会拖进第二份 React，
 * 见 `packages/ui/src/calendar/date-text.ts` 文件头）。
 *
 * 「今天 / 明天 / 绝对日期」的三分是**文案决定**，不是归属决定：
 * 领域层只给"这一组共同的本地日期"，把 `9月30日` 说成"今天"（反之亦然）
 * 属于怎么向用户措辞 —— 所以 `now` 在这里比，不在领域层比第二次。
 */

import {
  addDays,
  isoWeekday,
  parseLocalDate,
  toLocalDate,
  type LocalDate,
  type TaskDateGroup,
} from '@heyta/domain';
import { weekdayMessageKey } from '@heyta/ui';
import type { MessageKey } from '@heyta/i18n';

/** 宿主的 `t` 的最小形状（收 `MessageKey`，带变量）。 */
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * 一组的标题句。
 *
 * 🔴 `now` 显式传入 —— "今天"随时间漂移，读实时时钟会让测试与
 * 跨午夜渲染变得不确定（与领域层 `FilterContext.now` 同一条纪律）。
 */
export function taskGroupTitle(
  group: TaskDateGroup,
  now: number,
  t: Translate,
): string {
  if (group.kind === 'overdue') return t('web.tasks.group.overdue');
  if (group.kind === 'undated') return t('web.tasks.group.undated');

  const date: LocalDate = group.date;
  const weekday = t(weekdayMessageKey(isoWeekday(date)));
  const today = toLocalDate(now);
  // 今天/明天说相对的，更远说绝对的 —— 与滴答一致："亲切又不歧义"。
  if (date === today) return t('web.tasks.group.today', { weekday });
  if (date === addDays(today, 1)) return t('web.tasks.group.tomorrow', { weekday });
  const d = parseLocalDate(date);
  return t('web.tasks.group.date', { month: d.getMonth() + 1, day: d.getDate(), weekday });
}

/** 一组的稳定 DOM 键（React key / testid 后缀共用，别处不要再拼一份）。 */
export function taskGroupKey(group: TaskDateGroup): string {
  return group.kind === 'date' ? `date-${group.date}` : group.kind;
}
