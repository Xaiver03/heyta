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
 *
 * ⚠️ M3 第三刀之后，**结构**已经搬进 `@heyta/ui` 的 `CategoryReportView`
 * （与 mobile 同一份），这里只剩"把语义结果映射到本端词条"这一层 ——
 * 所以它现在是 `CategoryReportLabels` 的一个构造器。字段与共享层一一对应，
 * 少给一个编译期就会报（共享层的 `labels` 是必填的）。
 */

import type { CategoryReportLabels } from '@heyta/ui';
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
 * 而格子本身是装饰。所以**这句是被读出来的那一份**，
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
 * 构造共享 `CategoryReportView` 需要的全部文案。
 *
 * 🔴 共享层**不 import i18n**（见它的文件头），所以模板留在这里；
 * 而字段名必须与 `CategoryReportLabels` 逐项对上 —— 漏了编译不过。
 *
 * ⚠️ **没有** `cellTitle` / `weekTitle` / `segmentA11y` 三项：格子与柱子的
 * 悬停提示在共享层装不下（`react-native-web` 的 `View`/`Text` 会丢弃 `title`），
 * 详见 `packages/ui/src/categories/CategoryReport.tsx` 文件头的"一处没有搬过来的行为"。
 * `web.categories.cell.none` 这个词条因此暂时没有调用点。
 */
export function categoryReportLabels(t: I18nValue['t']): CategoryReportLabels {
  return {
    note: t('web.categories.note'),
    empty: t('web.categories.empty'),
    range: (start, end) => t('web.categories.range', { start, end }),
    unassigned: (duration) => t('web.categories.unassigned', { duration }),
    hintUnset: t('web.categories.hint.unset'),
    kind: (kind) => t(KIND_COPY[kind]),
    slot: (slot) => (slot === undefined ? t('web.categories.slot.none') : String(slot)),
    duration: (ms) => formatDuration(ms, t),
    laneA11y: (row) => laneDescription(row, t),
    barsA11y: t('web.categories.bars.aria'),
  };
}
