/**
 * 成长屏展示逻辑 + 文案接线的单测
 * ================================
 *
 * 领域算法（今天该做几件、连续怎么数、里程碑阈值）已经在
 * `packages/domain/tests` 里钉过；共享的摊平/滤墓碑在
 * `packages/app-host/tests/motivation.spec.ts` 里钉过。
 *
 * M3 第十一刀换装后，本文件管两件事：
 *
 *   1. **纯展示函数的既有断言**（分支选择 / 夹紧 / 顺序 / 取前 N 条）。
 *      那七条函数已经收编进 `packages/ui/src/motivation/model.ts`，
 *      所以这里改为**直接 import 共享源码**继续断言同样的行为。
 *      🔴 为什么不 import `@heyta/ui`：它的 dist 顶层 import `react-native`
 *      （Flow 源码），node 解析不了 —— 与 `tests/habits-display.spec.ts`
 *      记的是同一个坑。共享 `motivation/model.ts` 自己不 import react-native
 *      （那个文件头把这条写成硬约束），所以指源码是安全的。
 *      🔴 为什么不改成"读源码文本断言函数还在"：那只能证明代码没被删，
 *      证明不了行为还对 —— 而这七条的错误全是**安静**的
 *      （说相反的话、条子画出容器外、里程碑按达成数重排）。
 *
 *   2. **`growthBoardLabels` 这个唯一接缝**（换装后移动壳只剩它）。
 *      少给一项编译会红，但给**错 key** 不会 —— 界面只会安静地少一句话
 *      或说一句别的话。所以字段级断言在这里。
 *
 * 🔴 每条断言都**同时覆盖中英**（与 `tests/date.spec.ts` 同一纪律）：
 * 只测一种语言的话，把英文词条写成中文、或 en 表漏一个 key，测试会全绿，
 * 而英文界面是坏的。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { translate, type MessageKey } from '@heyta/i18n';
import {
  deriveIdentityTags,
  deriveMilestones,
  type ActivityTotals,
  type TodayProgress,
  type WeeklyReview,
} from '@heyta/domain';
import { describe, expect, it } from 'vitest';

// 🔴 共享源码直连（理由见文件头）。路径：apps/mobile/tests → 仓库根 → packages/ui。
import {
  growthHint,
  milestoneGroups,
  nearMissTags,
  progressPercent,
  ratioText,
  reachedTagIds,
  weekHeadlineCount,
} from '../../../packages/ui/src/motivation/model';

import { growthBoardLabels } from '../src/lib/growth-display';

/** 与界面同一条路：走真的词条表（缺 key 会**抛**，不是返回空串）。 */
const zh = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

function progress(over: Partial<TodayProgress> = {}): TodayProgress {
  return {
    habitsPlanned: 0,
    habitsDone: 0,
    tasksPlanned: 0,
    tasksDone: 0,
    focusMinutes: 0,
    total: 0,
    done: 0,
    bonus: 0,
    ratio: 0,
    closed: false,
    ...over,
  };
}

function totals(over: Partial<ActivityTotals> = {}): ActivityTotals {
  return { checkIns: 0, focusMs: 0, tasksCompleted: 0, activeDays: 0, ...over };
}

/** 本周复盘的最小底：用例只声明它关心的字段。 */
function review(over: Partial<WeeklyReview> = {}): WeeklyReview {
  const zero = { checkIns: 0, tasksCompleted: 0, focusMinutes: 0 };
  return {
    weekStart: '2026-09-21',
    weekEnd: '2026-09-27',
    ...zero,
    previous: { ...zero },
    deltas: { ...zero },
    headline: 'none',
    ...over,
  };
}

describe('growthHint：四种状态互斥且穷尽', () => {
  it('什么都没做也没有计划 → idle', () => {
    expect(growthHint(progress())).toBe('idle');
  });

  it('🔴 没有计划但做了事 → unplanned（不是 idle，也不是 0%）', () => {
    expect(growthHint(progress({ done: 3 }))).toBe('unplanned');
  });

  it('有计划且做完 → allDone；计划外多做也算做完', () => {
    expect(growthHint(progress({ total: 3, done: 3 }))).toBe('allDone');
    expect(growthHint(progress({ total: 3, done: 5, bonus: 2 }))).toBe('allDone');
  });

  it('还有没做的 → remaining', () => {
    expect(growthHint(progress({ total: 3, done: 1 }))).toBe('remaining');
  });
});

describe('ratioText / progressPercent', () => {
  it('进度数字是 已完成/计划', () => {
    expect(ratioText(progress({ done: 0, total: 3 }))).toBe('0/3');
    expect(ratioText(progress({ done: 3, total: 3 }))).toBe('3/3');
  });

  it('🔴 百分比夹在 0–100：越界值不该把条子画到容器外', () => {
    expect(progressPercent(0)).toBe(0);
    expect(progressPercent(0.5)).toBe(50);
    expect(progressPercent(1)).toBe(100);
    expect(progressPercent(-3)).toBe(0);
    expect(progressPercent(42)).toBe(100);
    expect(progressPercent(Number.NaN)).toBe(0);
  });
});

describe('milestoneGroups：每维度一块，顺序不按达成数重排', () => {
  it('只达成第一档时，下一档与进度都对', () => {
    const groups = milestoneGroups(deriveMilestones(totals({ checkIns: 12 })));

    expect(groups.map((g) => g.kind)).toEqual(['checkIns', 'focusHours', 'tasks', 'activeDays']);
    const checkIns = groups[0]!;
    expect(checkIns.current).toBe(12);
    expect(checkIns.reached).toBe(1);
    expect(checkIns.total).toBe(5);
    expect(checkIns.next).toBe(50);
    expect(checkIns.ratio).toBeCloseTo(12 / 50);
    expect(checkIns.maxed).toBe(false);

    // 一个都没达成的维度：下一档就是第一档，进度 0。
    const activeDays = groups[3]!;
    expect(activeDays.reached).toBe(0);
    expect(activeDays.next).toBe(7);
    expect(activeDays.ratio).toBe(0);
  });

  it('🔴 维度顺序由定义表决定，不随达成数变化', () => {
    const few = milestoneGroups(deriveMilestones(totals({ checkIns: 12 })));
    // 反过来：让最后一个维度（activeDays）达成最多。
    const many = milestoneGroups(
      deriveMilestones(totals({ checkIns: 0, focusMs: 0, tasksCompleted: 0, activeDays: 400 })),
    );
    expect(many.map((g) => g.kind)).toEqual(few.map((g) => g.kind));
    expect(many[3]!.maxed).toBe(true);
  });

  it('全部达成时 maxed 为真、next 消失、进度封顶', () => {
    const groups = milestoneGroups(
      deriveMilestones(
        totals({
          checkIns: 5000,
          focusMs: 2000 * 3_600_000,
          tasksCompleted: 9000,
          activeDays: 400,
        }),
      ),
    );
    for (const group of groups) {
      expect(group.maxed).toBe(true);
      expect(group.next).toBeUndefined();
      expect(group.ratio).toBe(1);
    }
  });

  it('空输入回空数组（不造假的一块）', () => {
    expect(milestoneGroups([])).toEqual([]);
  });
});

describe('weekHeadlineCount：标题讲哪个维度，数字就取哪个', () => {
  const counts = { checkIns: 5, tasksCompleted: 2, focusMinutes: 30 };

  it('三个维度各自取自己的数字，不串台', () => {
    expect(weekHeadlineCount(review({ ...counts, headline: 'checkIns' }))).toBe(5);
    expect(weekHeadlineCount(review({ ...counts, headline: 'tasksCompleted' }))).toBe(2);
    expect(weekHeadlineCount(review({ ...counts, headline: 'focusMinutes' }))).toBe(30);
  });

  it('none 取 0 —— 不能"随便挑一个"', () => {
    expect(weekHeadlineCount(review({ ...counts, headline: 'none' }))).toBe(0);
  });
});

describe('身份标签：已达成的与最近的未达成', () => {
  const tags = deriveIdentityTags({ totals: totals({ activeDays: 30, checkIns: 12 }), bestCurrentStreak: 5 });

  it('已达成的 id 按定义表顺序', () => {
    expect(reachedTagIds(tags)).toEqual(['started', 'routine']);
  });

  it('最近的未达成按距达标比例排序，并给出还差多少', () => {
    // activeDays 30 → steady(100) 还差 70，最近；streak 5 → streak-thirty(30) 还差 25。
    // ⚠️ 共享层在换装时**多带了一个 `kind`**（`IdentityTagList` 要用它取单位）——
    // 这是契约变化，断言跟着更新，不是删断言。
    expect(nearMissTags(tags, 2)).toEqual([
      { id: 'steady', kind: 'activeDays', gap: 70 },
      { id: 'streak-thirty', kind: 'streakDays', gap: 25 },
    ]);
  });

  it('全部达成时没有"还差多少"', () => {
    const all = deriveIdentityTags({
      totals: totals({ activeDays: 400, checkIns: 500, tasksCompleted: 9000, focusMs: 300 * 3_600_000 }),
      bestCurrentStreak: 40,
    });
    expect(nearMissTags(all, 2)).toEqual([]);
  });
});

describe('growthBoardLabels：移动壳与共享 GrowthBoard 的**唯一接缝**', () => {
  it('compareNote 必须给 —— 它是 mobile 有、web 没有的那一句反排行榜声明', () => {
    const labels = growthBoardLabels(zh);
    expect(labels.compareNote).toContain('只和过去的自己比');
    // 英文侧两句话都在：只与自己比 + 没有排行榜。
    expect(growthBoardLabels(en).compareNote).toContain('past self');
    expect(growthBoardLabels(en).compareNote).toContain('No leaderboards');
  });

  it('今日提示四种分支各自成句：unplanned 用 done；remaining 用**剩余数**', () => {
    const labels = growthBoardLabels(zh);
    expect(labels.today.hint({ hint: 'idle', done: 0, remaining: 0 })).toBe('今天还没有记录');
    expect(labels.today.hint({ hint: 'unplanned', done: 3, remaining: -3 })).toBe(
      '计划之外还完成了 3 件',
    );
    expect(labels.today.hint({ hint: 'allDone', done: 2, remaining: 0 })).toBe('今天的都完成了');
    // 🔴 total=3、done=1 ⇒ remaining=2。这一支**绝不能**把 -1 那种负数渲染出来。
    expect(labels.today.hint({ hint: 'remaining', done: 1, remaining: 2 })).toBe('还剩 2 件');
    const enLabels = growthBoardLabels(en);
    expect(enLabels.today.hint({ hint: 'remaining', done: 1, remaining: 2 })).toBe(
      'Still 2 to go today',
    );
  });

  it('今日明细四条与闭环句都带上该有的变量', () => {
    const labels = growthBoardLabels(zh);
    expect(labels.today.habits({ done: 2, planned: 4 })).toBe('习惯 2/4');
    expect(labels.today.tasks({ done: 1, planned: 3 })).toBe('任务 1/3');
    expect(labels.today.focus(45)).toBe('专注 45 分钟');
    expect(labels.today.bonus(2)).toBe('计划外 2 件');
    expect(labels.today.closed).not.toBe('');
    // 进度条无障碍名两个数字都进句子（bonus 刻意不进 —— 见 growth-display 注释）。
    const bar = labels.today.barA11y({ done: 2, total: 4, bonus: 1 });
    expect(bar).toContain('2');
    expect(bar).toContain('4');
  });

  it('周复盘的标题按 headline 取各自那一句，不串台', () => {
    const labels = growthBoardLabels(zh);
    expect(labels.week.headline({ headline: 'checkIns', count: 5 })).toBe('这周打卡 5 次');
    expect(labels.week.headline({ headline: 'tasksCompleted', count: 2 })).toBe('这周完成 2 件');
    expect(labels.week.headline({ headline: 'focusMinutes', count: 30 })).toBe('这周专注 30 分钟');
    expect(labels.week.stat('checkIns')).toBe('打卡');
    expect(labels.week.stat('tasksCompleted')).toBe('完成');
    expect(labels.week.stat('focusMinutes')).toBe('专注');
    expect(labels.week.previous(7)).toBe('上周 7');
    expect(labels.week.range({ start: '2026-09-21', end: '2026-09-27' })).toBe(
      '2026-09-21 至 2026-09-27',
    );
    expect(labels.week.empty).not.toBe('');
    expect(labels.week.bestDay({ date: '2026-09-23', minutes: 90 })).toContain('90');
  });

  it('🔴 移动端刻意不给 `statUnit`：共享层据此不渲染单位（与迁移前一致）', () => {
    expect(growthBoardLabels(zh).week.statUnit).toBeUndefined();
  });

  it('连续性：三个数字进句子 + 补打卡/重新开始的提示都带上变量', () => {
    const labels = growthBoardLabels(zh);
    expect(labels.streaks.empty).not.toBe('');
    expect(labels.streaks.current).toBe('当前连续（天）');
    expect(labels.streaks.longest(21)).toBe('最长 21 天');
    expect(labels.streaks.total(40)).toBe('累计 40 天');
    const repair = labels.streaks.repair({ date: '2026-09-26', count: 5 });
    expect(repair).toContain('5');
    const fresh = labels.streaks.freshStart({ days: 9, longest: 21, total: 40 });
    expect(fresh).toContain('9');
    expect(fresh).toContain('21');
    expect(fresh).toContain('40');
    // 🔴 "最短 / 累计都还在"是那句文案的全部意义，不许被改掉。
    expect(fresh).toContain('都还在');
  });

  it('🔴 移动端刻意不给 `freeze` / 两个 Action 按钮：退回纯文字（与迁移前一致）', () => {
    const labels = growthBoardLabels(zh);
    expect(labels.streaks.freeze).toBeUndefined();
    expect(labels.streaks.repairAction).toBeUndefined();
    expect(labels.streaks.freshStartAction).toBeUndefined();
  });

  it('🔴 `a11yHabit` 只拿得到 name（共享层只给这个）—— 与 RN 默认行为等价', () => {
    expect(growthBoardLabels(zh).streaks.a11yHabit('喝水')).toBe('喝水');
  });

  it('里程碑：维度名穷尽四个、下一档用 threshold、单档位念出"已达成"', () => {
    const labels = growthBoardLabels(zh);
    expect(labels.milestones.kindName('checkIns')).toBe('打卡');
    expect(labels.milestones.kindName('focusHours')).toBe('专注小时');
    expect(labels.milestones.kindName('tasks')).toBe('完成任务');
    expect(labels.milestones.kindName('activeDays')).toBe('活跃天数');
    expect(labels.milestones.maxed).not.toBe('');
    // 移动端模板只有 {next}，共享层给的 unit / gap 被忽略（与迁移前一致）。
    expect(labels.milestones.next({ threshold: 50, unit: '', gap: 38 })).toBe('下一档 50');
    expect(labels.milestones.tierA11y({ threshold: 50, reached: true })).toContain('50');
    expect(labels.milestones.tierA11y({ threshold: 50, reached: true })).toContain('已达成');
    expect(labels.milestones.tierA11y({ threshold: 50, reached: false })).toBe('50');
    // 🔴 移动端刻意不给 kindUnit：共享层不渲染单位（与迁移前一致）。
    expect(labels.milestones.kindUnit).toBeUndefined();
    // ⚠️ 死字段：`deriveMilestones` 恒返回四个维度，空的里程碑画不出来。
    expect(labels.milestones.empty).toBe('');
  });

  it('身份标签：已知 id 有词、未知 id 回 undefined（不泄漏内部 id）', () => {
    const labels = growthBoardLabels(zh);
    expect(labels.tags.tagName('started')).toBe('坚持一周');
    expect(labels.tags.tagName('streak-thirty')).toBe('连续三十天');
    // 🔴 一台更新的客户端可能带来这个版本不认识的 id —— 必须回 undefined，
    // 让共享层跳过，而不是把 `unknown-tag` 渲染给用户看。
    expect(labels.tags.tagName('unknown-tag')).toBeUndefined();
    expect(labels.tags.empty).not.toBe('');
    expect(labels.tags.near({ name: '坚持一周', gap: 3, unit: '天' })).toContain('坚持一周');
    expect(labels.tags.near({ name: '坚持一周', gap: 3, unit: '天' })).toContain('3');
    expect(labels.tags.reachedA11y('坚持一周')).toContain('坚持一周');
    expect(labels.tags.nearNote).not.toBe('');
  });

  it('🔴 `nearUnit` 保住 `streakDays` 的例外（"天"不属于里程碑那四个维度）', () => {
    const labels = growthBoardLabels(zh);
    expect(labels.tags.nearUnit('checkIns')).toBe('次');
    expect(labels.tags.nearUnit('focusHours')).toBe('小时');
    expect(labels.tags.nearUnit('tasks')).toBe('件');
    expect(labels.tags.nearUnit('activeDays')).toBe('天');
    expect(labels.tags.nearUnit('streakDays')).toBe('天连续');
  });

  it('月份复用与习惯热力图同一批 key；中文 1/12 月都对', () => {
    const labels = growthBoardLabels(zh);
    const enLabels = growthBoardLabels(en);
    expect(labels.heatmap.month(1)).toBe('1月');
    expect(labels.heatmap.month(12)).toBe('12月');
    expect(enLabels.heatmap.month(1)).toBe('Jan');
    expect(enLabels.heatmap.month(12)).toBe('Dec');
    // 越界（理论上不会发生）必须兜到 1 月，而不是渲染 `undefined`。
    expect(labels.heatmap.month(0)).toBe('1月');
  });

  it('🔴 热力图 / 分享块是类型要求的**死字段**：本轮不传 activityDays / share', () => {
    const labels = growthBoardLabels(zh);
    // 空串而不是编一句错的话；一旦有人传了 activityDays，这条会先红。
    expect(labels.heatmap.grid({ total: 42, days: 365 })).toBe('');
    // 分享块借的是 web 的真词条（本端不渲染，但文案不能是假的）。
    expect(labels.share.copy).not.toBe('');
    expect(labels.share.copied).not.toBe('');
    expect(labels.share.failed).not.toBe('');
  });
});

describe('词条：中英各有一条，不是硬编码', () => {
  it('成长屏的标题与四种提示在两种语言下都不同', () => {
    const keys = [
      'mobile.growth.title',
      'mobile.growth.today.hint.idle',
      'mobile.growth.today.hint.unplanned',
      'mobile.growth.today.hint.allDone',
      'mobile.growth.today.hint.remaining',
      'mobile.growth.streak.current',
      'mobile.growth.milestones.note',
      'mobile.growth.tags.note',
    ] as const;

    for (const key of keys) {
      const zhText = translate('zh-CN', key);
      const enText = translate('en', key);
      expect(zhText).not.toBe('');
      expect(enText).not.toBe('');
      expect(zhText).not.toBe(enText);
    }
  });

  it('带数字的词条会替换占位符，而不是渲染成 {count}', () => {
    expect(translate('zh-CN', 'mobile.growth.today.hint.remaining', { count: 2 })).toBe('还剩 2 件');
    expect(translate('en', 'mobile.growth.today.hint.remaining', { count: 2 })).toBe(
      'Still 2 to go today',
    );
    expect(translate('zh-CN', 'mobile.growth.streak.repair', { days: 4 })).toBe(
      '昨天还能补回来——补完是 4 天',
    );
  });
});

/**
 * 结构断言：**第二份实现不许回来**
 * ================================
 *
 * 这一刀的全部意义是"成长屏的展示逻辑只有一份实现"。上面那些行为断言
 * 现在打的是共享源码，所以如果有人日后又在移动壳里长出一份
 * `growthHint` / `milestoneGroups`，行为断言**照样全绿**（它们测的不是壳），
 * 而漂移会重新开始。这条断言就是钉住"壳里没有第二份"。
 *
 * ⚠️ 判据读的是**源码文本**，所以它会在改注释时假红 —— 这里查的是
 * `export function xxx` 这种定义形状，注释里不会出现，因此是稳的。
 */
describe('移动壳里不许再有第二份展示实现', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it('`lib/growth-display.ts` 只剩文案构造，七条纯函数一条都不在', () => {
    const source = readFileSync(resolve(here, '../src/lib/growth-display.ts'), 'utf8');
    for (const name of [
      'growthHint',
      'ratioText',
      'progressPercent',
      'milestoneGroups',
      'reachedTagIds',
      'nearMissTags',
      'weekHeadlineCount',
    ]) {
      expect(source, `${name} 又回到了移动壳 —— 它只该在 packages/ui 里`).not.toContain(
        `export function ${name}`,
      );
      expect(source).not.toContain(`export const ${name}`);
    }
    // 反面：本文件确实还在导出那个唯一的接缝。
    expect(source).toContain('export function growthBoardLabels');
  });

  it('那七条仍然在共享层（不是被静默删掉、断言跟着消失）', () => {
    const source = readFileSync(
      resolve(here, '../../../packages/ui/src/motivation/model.ts'),
      'utf8',
    );
    for (const name of [
      'growthHint',
      'ratioText',
      'progressPercent',
      'milestoneGroups',
      'reachedTagIds',
      'nearMissTags',
      'weekHeadlineCount',
    ]) {
      expect(source, `共享层找不到 ${name} —— 判据锚点已失效`).toContain(`export function ${name}`);
    }
  });
});

/**
 * 变异验证记录（真的跑过，不是声明）
 * ==================================
 *
 * | 编号 | 把实现改成 | 结果 |
 * |---|---|---|
 * | MV4 | `progressPercent` 去掉 0–1 夹紧（`ratio * 100`） | 1 red / 209 passed |
 * | MV5 | `growthHint` 的 `total === 0` 分支恒返回 `idle` | 1 red / 209 passed |
 * | MV6 | `growthBoardLabels.today.hint` 的 `remaining` 支改用 `done` | 见本轮汇报 |
 * | MV7 | `growthBoardLabels.tags.tagName` 未知 id 回 `id` 而不是 `undefined` | 见本轮汇报 |
 *
 * 前两条是换装前的记录（那时函数还在本仓 `lib/growth-display.ts`），
 * 保留在这里是为了说明"断言不是靠整片红掩盖的"；MV6 / MV7 是换装后
 * 对**新接缝**做的注入，原文见本刀汇报。
 */
