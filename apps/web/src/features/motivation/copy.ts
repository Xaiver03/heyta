/**
 * 激励体系的文案表
 * ==================
 *
 * 🔴 为什么文案要集中在一个文件里：计划 §4 给温和干预列了一张**禁用清单**
 * （"你失去了…""别人都…""断了就白费了"…）。分散在各组件里的字符串没法审，
 * 集中在一处才能一眼扫完，也才能在测试里对整份表做断言。
 *
 * ⚠️ 文案**不在领域层**：`packages/domain` 只产出 id、kind、threshold 这些事实，
 * 一个 ID 该叫"习惯养成者"还是"起步的人"会随产品反复改，
 * 把它写进领域层等于让中文表达变成同步契约的一部分。
 *
 * ⚠️ 这不是 `@heyta/i18n` 的词条表。Web 壳目前的界面文案契约仍是**中文**
 * （见 `scripts/check-ui-language.mjs` 的 `MIGRATED_ROOTS`：`apps/web` 尚未迁移）。
 * 迁移那天，这个文件是唯一的改动点 —— 这本身就是把它单独拎出来的理由。
 */

import type { ActivityTotals, MilestoneKind, WeeklyReview } from '@heyta/domain';

export interface KindCopy {
  /** 维度名。 */
  name: string;
  /** 计量单位。 */
  unit: string;
}

/** 四个累计维度的说法。 */
export const KIND_COPY: Record<MilestoneKind, KindCopy> = {
  checkIns: { name: '打卡', unit: '次' },
  focusHours: { name: '专注', unit: '小时' },
  tasks: { name: '完成任务', unit: '件' },
  activeDays: { name: '活跃天数', unit: '天' },
};

/**
 * 身份标签的措辞。
 *
 * 🔴 全部用**中性描述做过什么**，不用人格评价。
 * "你是一个自律的人"在断掉的那天会变成一把刀（"所以我到底是不是？"），
 * 而"连续 30 天"永远是事实 —— 它断掉时也不会变成谎言。
 */
export const IDENTITY_TAG_COPY: Record<string, string> = {
  started: '起步的人',
  routine: '有节奏的人',
  steady: '长期主义',
  'checkin-hundred': '百次打卡',
  'deep-fifty': '深度工作 50 小时',
  'deep-two-hundred': '深度工作 200 小时',
  'finisher-five-hundred': '完成 500 件',
  'streak-thirty': '连续 30 天',
};

/** 周复盘的三种主标题。`none` 不在这里 —— 它对应的是"这一周还没有记录"。 */
export const HEADLINE_COPY: Record<Exclude<WeeklyReview['headline'], 'none'>, string> = {
  checkIns: '这周打卡最多',
  tasksCompleted: '这周完成最多',
  focusMinutes: '这周专注最多',
};

/** 取一个维度的展示数值与单位（复用于周复盘的三块数字）。 */
export function headlineValue(review: WeeklyReview): { value: number; unit: string } {
  switch (review.headline) {
    case 'checkIns':
      return { value: review.checkIns, unit: '次' };
    case 'tasksCompleted':
      return { value: review.tasksCompleted, unit: '件' };
    case 'focusMinutes':
      return { value: review.focusMinutes, unit: '分钟' };
    default:
      return { value: 0, unit: '' };
  }
}

/**
 * 生成一份**纯文本**的本周小结，用于复制到任何地方。
 *
 * 🔴 刻意不做成图片分享卡：出图要引 canvas/字体/排版三套东西，
 * 而它换来的传播收益在这个阶段无法验证（E2EE 下我们也拿不到任何回传数据）。
 * 纯文本能被粘进任意对话、笔记、待办 —— 而且它**不携带任何标识符**，
 * 用户不会因为分享一次就泄露自己在用哪个应用、哪台设备。
 */
export function buildShareSummary(review: WeeklyReview, totals: ActivityTotals): string {
  const lines: string[] = [];
  lines.push(`本周小结（${review.weekStart} 至 ${review.weekEnd}）`);
  lines.push(
    `打卡 ${String(review.checkIns)} 次 · 完成 ${String(review.tasksCompleted)} 件 · 专注 ${String(review.focusMinutes)} 分钟`,
  );

  if (review.bestFocusDay !== undefined) {
    lines.push(
      `最专注的一天：${review.bestFocusDay.date}（${String(review.bestFocusDay.minutes)} 分钟）`,
    );
  }

  lines.push(
    `累计：打卡 ${String(totals.checkIns)} 次 · 专注 ${String(Math.floor(totals.focusMs / 3_600_000))} 小时 · 完成 ${String(totals.tasksCompleted)} 件 · 活跃 ${String(totals.activeDays)} 天`,
  );

  return lines.join('\n');
}