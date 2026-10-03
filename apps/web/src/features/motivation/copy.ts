/**
 * 激励体系的文案**键**表
 * ========================
 *
 * 🔴 为什么文案要集中在一个文件里：计划 §4 给温和干预列了一张**禁用清单**
 * （"你失去了…""别人都…""断了就白费了"…）。分散在各组件里的字符串没法审，
 * 集中在一处才能一眼扫完，也才能在测试里对整份表做断言。
 *
 * ⚠️ 这里存的是**词条 key**，不是句子本身。
 *
 * 原来它存的是一张中文字符串表，理由是"Web 壳的界面文案契约仍是中文"。
 * 那个前提在 `@heyta/i18n` 落地之后就不成立了 —— `apps/web/src` 已整体迁移，
 * 门禁要求用户可见的字面量一律走 `t()`。于是这个文件按原设计**只改一处**
 * （它的文件头就是这么写的："迁移那天，这个文件是唯一的改动点"）：
 * 表里换成 key，句子进 `packages/i18n/src/locales/`。
 *
 * ⚠️ 文案**仍然不在领域层**：`packages/domain` 只产出 id、kind、threshold 这些事实，
 * 一个 ID 该叫"习惯养成者"还是"起步的人"会随产品反复改，
 * 把它写进领域层等于让中文表达变成同步契约的一部分。
 */

import type { I18nValue, MessageKey } from '@heyta/i18n';

import { buildShareSummary as buildShareSummaryShared } from '@heyta/app-host';
import type { ActivityTotals, MilestoneKind, WeeklyReview } from '@heyta/domain';

export interface KindCopy {
  /** 维度名的词条 key。 */
  nameKey: MessageKey;
  /** 计量单位的词条 key。 */
  unitKey: MessageKey;
}

/**
 * 四个累计维度的说法。
 *
 * ⚠️ 这一组的"专注"按**小时**计（里程碑是 50 / 200 小时量级），
 * 而周复盘那三块数字按**分钟**计 —— 两套单位各有各的词条，不要合并。
 */
export const KIND_COPY: Record<MilestoneKind, KindCopy> = {
  checkIns: { nameKey: 'web.growth.kind.checkIns', unitKey: 'web.growth.kind.checkIns.unit' },
  focusHours: {
    nameKey: 'web.growth.kind.focusHours',
    unitKey: 'web.growth.kind.focusHours.unit',
  },
  tasks: { nameKey: 'web.growth.kind.tasks', unitKey: 'web.growth.kind.tasks.unit' },
  activeDays: {
    nameKey: 'web.growth.kind.activeDays',
    unitKey: 'web.growth.kind.activeDays.unit',
  },
};

/**
 * 身份标签的措辞。
 *
 * 🔴 全部用**中性描述做过什么**，不用人格评价。
 * "你是一个自律的人"在断掉的那天会变成一把刀（"所以我到底是不是？"），
 * 而"连续 30 天"永远是事实 —— 它断掉时也不会变成谎言。
 *
 * ⚠️ 领域层给的是 **id**。表里没有的 id 由调用方**原样显示 id**：
 * 编一个不存在的中文名会让"漏翻"看起来像"已经翻了"。
 */
export const IDENTITY_TAG_COPY: Record<string, MessageKey> = {
  started: 'web.growth.tag.started',
  routine: 'web.growth.tag.routine',
  steady: 'web.growth.tag.steady',
  'checkin-hundred': 'web.growth.tag.checkin-hundred',
  'deep-fifty': 'web.growth.tag.deep-fifty',
  'deep-two-hundred': 'web.growth.tag.deep-two-hundred',
  'finisher-five-hundred': 'web.growth.tag.finisher-five-hundred',
  'streak-thirty': 'web.growth.tag.streak-thirty',
};

/** 周复盘的三种主标题。`none` 不在这里 —— 它对应的是"这一周还没有记录"。 */
export const HEADLINE_COPY: Record<Exclude<WeeklyReview['headline'], 'none'>, MessageKey> = {
  checkIns: 'web.growth.headline.checkIns',
  tasksCompleted: 'web.growth.headline.tasksCompleted',
  focusMinutes: 'web.growth.headline.focusMinutes',
};

/**
 * 主标题那条数字。
 *
 * 🔴 句子（含量词）在词条里，这里只给数字 —— 英文的语序与量词都在句子里，
 * 拿"数字 + 单位"两段拼是拼不出正确英文的。
 */
export function headlineCount(review: WeeklyReview): number {
  switch (review.headline) {
    case 'checkIns':
      return review.checkIns;
    case 'tasksCompleted':
      return review.tasksCompleted;
    case 'focusMinutes':
      return review.focusMinutes;
    default:
      return 0;
  }
}

/**
 * 生成一份**纯文本**的本周小结，用于复制到任何地方。
 *
 * 🔴 实现搬到了 `@heyta/app-host#buildShareSummary`（理由见那边的文件头：移动端要接
 * 分享块，而壳与壳之间不许互相 import —— 再写一份就是 AGENTS §3.5 记过两次的那个形状）。
 * **这一层转发是承重的**：`apps/web/tests/motivation.spec.ts` 从这个路径 import 它，
 * 而那个文件不在本轮可改范围内 —— 删掉这层转发会红一条与本次改动无关的判据。
 *
 * ⚠️ 输出与搬家前逐字节相同（四条 `t()` 调用、同样的顺序、同样的 `join('\n')`）。
 */
export function buildShareSummary(
  review: WeeklyReview,
  totals: ActivityTotals,
  t: I18nValue['t'],
): string {
  return buildShareSummaryShared(review, totals, t);
}
