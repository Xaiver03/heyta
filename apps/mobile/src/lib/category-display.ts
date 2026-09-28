/**
 * 分类时长的展示层（移动壳）
 * ============================
 *
 * 与 `apps/web/src/features/categories/copy.ts` 对应 —— 但**语义不在这里**：
 * 归因链、窗口、分档、时长分档全是共享的（`@heyta/domain` 与
 * `packages/app-host/src/category-report.ts`），这里只做两件事：
 *
 *   1. 把**语义结果**映射到本端的词条 key；
 *   2. 拼出给屏幕阅读器/无颜色用户的那句**文字事实**。
 *
 * 🔴 为什么时长分档没有在本文件里重写一遍：Web 与移动端各写一份阈值，
 * 迟早出现同一个 5400000ms 在一端是「1 小时 30 分」、在另一端是「90 分钟」，
 * 而两端各自的测试都是绿的（本仓库 §7 第 28 条那个形状）。
 * 阈值在 `durationParts`，两个端都调它。
 *
 * 🔴 本文件里**没有**、也不许出现："最多 / 最少 / 失衡 / 超标 / 排名 / 占比"。
 * 界面上只有两种事实句子：**"某类做了多久"** 和 **"这些时间是怎么算出来的"**。
 */

import { durationParts, type CategoryKind, type CategorySeries } from '@heyta/domain';
import type { CategoryReportLabels } from '@heyta/ui';
import type { I18nValue, MessageKey } from '@heyta/i18n';

/** 一行是清单还是习惯 —— 两种归因链的来源，界面上要能分辨。 */
export const KIND_KEY: Record<CategoryKind, MessageKey> = {
  project: 'mobile.categories.kind.project',
  habit: 'mobile.categories.kind.habit',
};

/** 把毫秒说成人话（走 `t()`，所以两种语言各说各的）。 */
export function formatDuration(ms: number, t: I18nValue['t']): string {
  const parts = durationParts(ms);
  switch (parts.kind) {
    case 'minutes':
      return t('mobile.categories.duration.minutes', { minutes: parts.minutes });
    case 'hours':
      return t('mobile.categories.duration.hours', { hours: parts.hours });
    case 'hoursMinutes':
      return t('mobile.categories.duration.hoursMinutes', {
        hours: parts.hours,
        minutes: parts.minutes,
      });
  }
}

/**
 * 槽位号是**文字**，不是颜色。
 *
 * 🔴 色觉障碍用户靠这个数字把"这一行"和"别的地方同色的一块"对上；
 * 8 个色槽在模拟色盲下可能只是深浅不同的灰（见
 * `packages/design-system/tests/category-colors.spec.ts` 的实测数字）。
 * 所以界面上**每一行都必须有号码**，而且没设色时要说"无"而不是留空。
 */
export function slotText(slot: CategorySeries['slot'], t: I18nValue['t']): string {
  return slot === undefined ? t('mobile.categories.slot.none') : String(slot);
}

/**
 * 一行给屏幕阅读器的**文字事实**。
 *
 * 格子的深浅是装饰（`accessibilityElementsHidden`），所以这句话必须自己说清
 * "这一行是多少" —— 不能依赖颜色或格子。
 */
export function laneLabel(row: CategorySeries, t: I18nValue['t']): string {
  return t('mobile.categories.lane.a11y', {
    name: row.name,
    kind: t(KIND_KEY[row.kind]),
    duration: formatDuration(row.totalMs, t),
  });
}

/**
 * 构造共享 `CategoryReportView` 需要的全部文案。
 *
 * 🔴 共享层**不 import i18n**（见它的文件头），所以模板留在这里；
 * 而字段名必须与 `CategoryReportLabels` 逐项对上 —— 漏了编译不过。
 *
 * ⚠️ 这里**刻意不给** `segmentA11y` / `barsA11y` / `cellTitle`：
 * 移动端不画堆叠柱状图（12 根柱子和 12 格泳道抢同一块宽度），
 * 格子也没有悬停（没有鼠标）。共享层把这几项做成可选正是为此。
 */
export function categoryReportLabels(t: I18nValue['t']): CategoryReportLabels {
  return {
    note: t('mobile.categories.note'),
    empty: t('mobile.categories.empty'),
    range: (start, end) => t('mobile.categories.range', { start, end }),
    unassigned: (duration) => t('mobile.categories.unassigned', { duration }),
    hintUnset: t('mobile.categories.hint.unset'),
    kind: (kind) => t(KIND_KEY[kind]),
    slot: (slot) => slotText(slot, t),
    duration: (ms) => formatDuration(ms, t),
    laneA11y: (row) => laneLabel(row, t),
    swatchA11y: (row) => t('mobile.categories.picker.toggle', { name: row.name }),
  };
}