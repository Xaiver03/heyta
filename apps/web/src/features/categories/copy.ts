/**
 * 分类时长的文案与格式化（Web 壳）
 * ==================================
 *
 * 与 `features/motivation/copy.ts` 同一个理由：把**用户会看到的话**集中在一处，
 * 才审得动。这里尤其需要一个集中点 —— 分类这块最容易长出"你怎么又…"式的
 * 隐性评判，而一句一句散在组件里是查不出来的。
 *
 * 🔴 本文件里**没有**、也不许出现：
 *   - 任何"太多 / 太少 / 失衡 / 超标"的说法
 *   - 任何把某个分类和其他分类比较的说法（"最多的是…"也不行 ——
 *     它把用户的一次记录变成了一次排名）
 *   - 任何颜色好坏判断（颜色只是身份，见 `lib/category-colors.ts`）
 *
 * 界面上只有两种事实句子：**"某类做了多久"** 和 **"这些时间是怎么算出来的"**。
 */

import type { I18nValue, MessageKey } from '@heyta/i18n';

import { durationParts, type CategoryKind, type CategorySeries } from '@heyta/domain';

/** 一行是清单还是习惯 ── 两种归因链的来源，界面上要能分辨。 */
export const KIND_COPY: Record<CategoryKind, MessageKey> = {
  project: 'web.categories.kind.project',
  habit: 'web.categories.kind.habit',
};

/**
 * 把毫秒说成人话（走 `t()`，所以两种语言各说各的）。
 *
 * ⚠️ 不用 `@heyta/domain` 的 `formatFocusDuration`：它返回的是**写死的中文**
 * （`"1 小时 20 分钟"`）。领域层产出中文，等于让中文表达变成同步契约的一部分，
 * 而且英文界面会冒出汉字。
 *
 * 🔴 但**分档口径**（"多长算一小时""先四舍五入到分钟"）是**语义**，
 * 已经上移到 `@heyta/domain#durationParts` —— 移动端的分类屏要用同一套阈值，
 * 各写一遍就会让同一个 5400000ms 在一端说「1 小时 30 分」、另一端说「90 分钟」。
 * 这一层只负责把档位映射成名下的词条。
 */
export function formatDuration(ms: number, t: I18nValue['t']): string {
  const parts = durationParts(ms);
  switch (parts.kind) {
    case 'minutes':
      return t('web.categories.duration.minutes', { minutes: parts.minutes });
    case 'hours':
      return t('web.categories.duration.hours', { hours: parts.hours });
    case 'hoursMinutes':
      return t('web.categories.duration.hoursMinutes', {
        hours: parts.hours,
        minutes: parts.minutes,
      });
  }
}

/**
 * 泳道图每一行给屏幕阅读器/无颜色用户的**文字事实**。
 *
 * 🔴 「不许只用颜色表达信息」在这里的落点是：每行都有名字、都有数字，
 * 而格子本身是 `aria-hidden` 的装饰。所以**这句是被读出来的那一份**，
 * 它必须自己说清"这一行是多少"，不能依赖格子。
 */
export function laneDescription(row: CategorySeries, t: I18nValue['t']): string {
  return t('web.categories.lane.aria', {
    name: row.name,
    kind: t(KIND_COPY[row.kind]),
    duration: formatDuration(row.totalMs, t),
  });
}

/**
 * 堆叠条里一段的说明（悬停提示 + 无障碍名）。
 *
 * 数字与泳道图**共用同一个 `formatDuration`** —— 两处各写一次是漂移的开始，
 * 而这两处的数字在同一个屏幕上，用户一眼就能看出不一样。
 */
export function segmentLabel(row: CategorySeries, t: I18nValue['t']): string {
  return t('web.categories.segment.aria', {
    name: row.name,
    duration: formatDuration(row.totalMs, t),
  });
}
