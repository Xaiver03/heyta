/**
 * 成长屏的**展示**逻辑（纯函数）
 * ==============================
 *
 * 🔴 这个文件里**没有一行"该怎么算"**。今天该做几件、连续怎么数、里程碑阈值
 * 是多少、身份标签的判据 —— 全部在 `@heyta/domain`，摊平与滤墓碑在
 * `@heyta/app-host#motivation`。这里只做两件事，而这两件事都是**界面形状**：
 *
 *   1. 把领域结果压成"这一屏要画几个块、每块的下一档是哪个数"；
 *   2. 决定该用哪一句文案（`GrowthHint` 那种**分支选择**）。
 *
 * ## 为什么它值得单独一个文件、还值得测
 *
 * 分支选择是"安静出错"的重灾区：`total === 0` 时到底算"今天没事"还是
 * "今天全做完了"，反过来写界面照样渲染，只是说了一句**相反的话**。
 * 而进度条的百分数不夹紧，一个负数或 >1 的 ratio 会让条子画出容器外 ——
 * RN 不报错，只是看起来"没画"。
 *
 * ⚠️ 本文件**绝不 import `react-native`**：移动端测试在 node 里跑，
 * 加载 react-native 会直接解析失败（见 `tests/plural-keys.spec.ts` 的说明）。
 * 它只依赖类型，所以能被单测直接调用。
 */

import type {
  IdentityTagProgress,
  MilestoneKind,
  MilestoneProgress,
  TodayProgress,
  WeeklyReview,
} from '@heyta/domain';

/**
 * 今日进度该说哪句话。
 *
 * 四种状态是**互斥且穷尽**的，顺序即优先级：
 *   - `idle`：今天什么都没做、也没有计划 —— 不安慰也不指责，只陈述；
 *   - `unplanned`：没有计划但做了事 —— 这正是小胜原则要的那种反馈，
 *     **不能**因为"计划是 0"就说成 0%；
 *   - `allDone`：有计划且做完了 —— 闭环态；
 *   - `remaining`：还有没做的 —— 只报数量，不催。
 */
export type GrowthHint = 'idle' | 'unplanned' | 'allDone' | 'remaining';

export function growthHint(progress: TodayProgress): GrowthHint {
  if (progress.total === 0) {
    return progress.done > 0 ? 'unplanned' : 'idle';
  }
  return progress.done >= progress.total ? 'allDone' : 'remaining';
}

/** 进度数字 `已完成/计划`（纯数字与斜杠，不含语言）。 */
export function ratioText(progress: TodayProgress): string {
  return `${String(progress.done)}/${String(progress.total)}`;
}

/**
 * 进度条宽度百分比，夹在 0–100。
 *
 * 🔴 必须夹紧：`ratio` 由领域层给出时理论上已在 0–1，但进度条是**渲染**层，
 * 一个越界的值在这里表现为"条子不见了"或"条子盖住整行"，而没有任何报错。
 * 夹紧是一次廉价的防御，测试能证明它在。
 */
export function progressPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio)) * 100;
}

/** 里程碑里的一个档位。 */
export interface MilestoneTier {
  threshold: number;
  reached: boolean;
}

/** 里程碑里一个维度压成的一块。 */
export interface MilestoneGroup {
  kind: MilestoneKind;
  /** 当前值（`focusHours` 已是小时数，与领域层一致）。 */
  current: number;
  /** 已达成档数 / 总档数。 */
  reached: number;
  total: number;
  /** 下一档阈值；该维度全部达成时为 undefined。 */
  next?: number;
  /** 距离下一档的进度 0–1；全部达成时为 1。 */
  ratio: number;
  maxed: boolean;
  /** 全部档位（阈值升序，含各自是否达成）—— 界面据此画那一排档位。 */
  tiers: MilestoneTier[];
}

/**
 * 把领域层"每一档一条"的列表压成"每个维度一块"。
 *
 * 维度顺序 = 输入里首次出现的顺序（即 `MILESTONE_DEFINITIONS` 的顺序），
 * **刻意不按达成数重排** —— 那是排行榜的形状，而本设计的红线是"只与自己比"。
 */
export function milestoneGroups(milestones: readonly MilestoneProgress[]): MilestoneGroup[] {
  const order: MilestoneKind[] = [];
  const byKind = new Map<MilestoneKind, MilestoneProgress[]>();

  for (const item of milestones) {
    let bucket = byKind.get(item.kind);
    if (bucket === undefined) {
      bucket = [];
      byKind.set(item.kind, bucket);
      order.push(item.kind);
    }
    bucket.push(item);
  }

  return order.map((kind) => {
    const items = byKind.get(kind)!;
    // 同一个维度的每一档共享同一个 `value`，取第一条即可（领域层保证）。
    const current = items[0]?.value ?? 0;
    const reached = items.filter((i) => i.reached).length;
    const next = items.find((i) => !i.reached)?.threshold;
    return {
      kind,
      current,
      reached,
      total: items.length,
      ...(next === undefined ? {} : { next }),
      ratio: next === undefined ? 1 : Math.max(0, Math.min(1, current / next)),
      maxed: next === undefined,
      // 领域层的顺序即定义表顺序；**不在这里重排**（重排就是排行榜的形状）。
      tiers: items.map((i) => ({ threshold: i.threshold, reached: i.reached })),
    };
  });
}

/** 已达成的身份标签 id（顺序与定义表一致，不重排）。 */
export function reachedTagIds(tags: readonly IdentityTagProgress[]): string[] {
  return tags.filter((tag) => tag.reached).map((tag) => tag.id);
}

/**
 * 本周主标题要讲的那个数字。
 *
 * `headline` 由领域层选出"本周最活跃的维度"，这里的映射必须**穷尽**它 ——
 * 否则会出现"标题在讲打卡，数字却是专注分钟"。用 `switch` 而不是查表，
 * 是为了让领域层将来多一个维度时这里**编译报错**，而不是默默取到 0。
 */
export function weekHeadlineCount(review: WeeklyReview): number {
  switch (review.headline) {
    case 'checkIns':
      return review.checkIns;
    case 'tasksCompleted':
      return review.tasksCompleted;
    case 'focusMinutes':
      return review.focusMinutes;
    case 'none':
      return 0;
  }
}

/** 一个"还差多少"的标签。 */
export interface TagNearMiss {
  id: string;
  gap: number;
}

/**
 * 最接近达成的未获得标签（最多 `limit` 个）。
 *
 * 排序用**距达标的比例**从近到远，并列时按 id 保证确定 —— 随机顺序会让
 * 每次渲染的列表跳动，而"目标梯度"要的恰恰是"下一个就在眼前"的稳定感。
 */
export function nearMissTags(
  tags: readonly IdentityTagProgress[],
  limit: number,
): TagNearMiss[] {
  return tags
    .filter((tag) => !tag.reached)
    .slice()
    .sort((a, b) => b.ratio - a.ratio || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((tag) => ({ id: tag.id, gap: tag.threshold - tag.value }));
}
