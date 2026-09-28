/**
 * 分类时长（共享模型）
 * ======================
 *
 * M3 第三刀（categories）的**判断层**：颜色 token 的映射、报告是不是"空"、
 * 行上有没有"没设色"、一周堆叠条的段怎么切。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这些判断要从两端收上来
 *
 * 迁之前两端各写一套（web `features/categories/CategoryBreakdown.tsx` +
 * `lib/category-colors.ts`；mobile `screens/CategoriesScreen.tsx` +
 * `lib/category-colors.ts`）。它们读的是**同一份** `CategoryReport`，
 * 却各自回答"什么算空""哪一段先堆""未设色用什么颜色"——
 * 而两份答案之间的差异**不会让任何测试变红**，只会在屏幕上呈现成两张
 * 对不上的图（见 `docs/research/dida-view-unification.md` §1.4 / §4.2）。
 *
 * 所以判据和颜色映射都放在这里，`CategoryReport.tsx` 只负责把它们摆到
 * RN 原语上 —— 组件里因此没有分支，不需要靠快照测试兜。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件**不 import `react-native`，也不 import `@heyta/i18n`**
 *
 * 前者：`packages/ui/vitest.config.ts` 跑在 **node** 环境，`react-native`
 * 在 node 下解析不了（Flow 源码）。这条约束顺带钉住了"model 必须宿主无关"。
 * 后者：i18n 包自己带过一份 React，四端会同时中招（见 `TaskList.tsx` 文件头）。
 * 文案一律由宿主注入。
 */

import {
  CATEGORY_SLOT_TOKEN_BY_SLOT,
  HEAT_TOKENS,
  UNSET_CATEGORY_TOKEN,
} from '@heyta/design-system';
import type { CategoryReport, CategorySeries, CategorySlot } from '@heyta/domain';

/** 强度档位。与 `@heyta/domain#intensityLevel` 的返回类型同源（0 = 这周没记录）。 */
export type CategoryHeatLevel = 0 | 1 | 2 | 3 | 4;

/**
 * 分类界面会用到的**颜色 token 名**。
 *
 * 🔴 刻意不是 `TokenName`（那是全部 token 的联合，含间距/圆角等数字 token）。
 * 标成 `TokenName` 会让 `tokens[token]` 的类型变成 `string | number`，
 * 喂给 `backgroundColor` 直接编译不过 —— 而这个联合每一项都是**颜色**，
 * `tokens[token]` 因此能窄化成 `string`。
 */
export type CategoryColorToken =
  | (typeof CATEGORY_SLOT_TOKEN_BY_SLOT)[CategorySlot]
  | typeof UNSET_CATEGORY_TOKEN
  | (typeof HEAT_TOKENS)[number];

/**
 * 槽位（或"没设过色"）→ 颜色 token 名。
 *
 * 🔴 **取值只有一处**（`@heyta/design-system`），这里只把"未设色"这一种
 * 特殊输入归一掉。`undefined` 不能落到某个分类色上 —— 那会让"没设过色"
 * 看起来像是用户选过的某个类别（`UNSET_CATEGORY_TOKEN` 的注释里写了理由）。
 */
export function categorySlotToken(slot: CategorySlot | undefined): CategoryColorToken {
  return slot === undefined ? UNSET_CATEGORY_TOKEN : CATEGORY_SLOT_TOKEN_BY_SLOT[slot];
}

/** 强度档位 → heat token 名。0 档是"没有记录"的中性色，不是"没有颜色"。 */
export function categoryHeatToken(level: CategoryHeatLevel): CategoryColorToken {
  return HEAT_TOKENS[level];
}

/**
 * 报告是不是"空"。
 *
 * 🔴 「没有分类行」**且**「没有未归类时间」才算空。只看行数会把
 * "有 3 小时但一条都没归类"判成空 —— 而那一刻界面该说的是
 * "这些时间没归到任何清单"，不是"还没有记录"。两端此前各判了一次。
 */
export function isEmptyCategoryReport(report: CategoryReport): boolean {
  return report.series.length === 0 && report.unassignedMs === 0;
}

/**
 * 有没有哪一行没设色 —— 决定要不要给那句"去哪儿设色"的可发现提示。
 *
 * ⚠️ 它是**入口提示**，不是错误；文案不许写成"你还没分色"（见 `copy.ts`）。
 */
export function hasUnsetCategorySlot(report: CategoryReport): boolean {
  return report.series.some((row) => row.slot === undefined);
}

/** 一周柱状图里的一段。 */
export interface CategoryBarSegment {
  /** 稳定 key（= 行 key）。 */
  readonly key: string;
  /** 这一段的来源行（宿主用它取无障碍说明）。 */
  readonly row: CategorySeries;
  readonly ms: number;
  readonly token: CategoryColorToken;
  /**
   * 段高占 track 的比例 0–1。
   *
   * 🔴 分母是**窗口内最高的一周**（`peakWeeklyMs`），与泳道图格子的强度分档
   * **共用同一个峰值** —— 否则两处会出现两种"最深"，用户没法横向读趋势。
   */
  readonly ratio: number;
}

/**
 * 取某一周柱子里要画的段。
 *
 * 🔴 **段序 = `report.series` 的序**（总时长降序），而且是跨周固定的：
 * 同一类别在每一根柱子里都落在同一层，用户才能顺着颜色横向读
 * "这一类这周比上周多还是少"。按当周数值临时排序会毁掉这件事 ——
 * 而它**看起来只是"柱子更好看"**，不会报错。
 *
 * 时长为 0 的行**不产生段**（0 高的段画出来是一条看不见的线，只会让 DOM 变长）。
 */
export function categoryBarSegments(
  report: CategoryReport,
  weekIndex: number,
): CategoryBarSegment[] {
  const peak = report.peakWeeklyMs;
  const out: CategoryBarSegment[] = [];
  for (const row of report.series) {
    const ms = row.weeklyMs[weekIndex] ?? 0;
    if (ms <= 0) continue;
    out.push({
      key: row.key,
      row,
      ms,
      token: categorySlotToken(row.slot),
      // `peakWeeklyMs` 为 0 时不可能有 `ms > 0` 的段（峰值是单格最大值），
      // 但这里仍然显式判一次：分母为 0 会得到 `Infinity`，
      // 而 `Infinity%` 在 RN/CSS 里是**静默无效**，柱子直接消失。
      ratio: peak > 0 ? ms / peak : 0,
    });
  }
  return out;
}
