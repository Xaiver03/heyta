/**
 * 成长视图（Web 壳）
 * ===================
 *
 * M3 第十一刀（motivation）之后，这个文件**只剩接线**。
 *
 * 区块顺序、开关、插槽全部由 `@heyta/ui` 的 `GrowthBoard` 决定 ——
 * 与 mobile 是**同一份实现**（"成长这一屏从上到下是什么"只有一处答案，
 * 逐条理由见那个文件的文件头）。这里只回答 web 自己的四个问题：
 *
 *   1. **投影从哪来** → `@heyta/app-host#motivation`，经 `./selectors.js` 的
 *      薄转发（调用点与迁移前逐字相同）+ 年视图事实直接取
 *      `dailyActivityCountsFromState`（分档不在这里做，见下）；
 *   2. **「现在」从哪来** → `useTaskStore(s => s.now)`。跨午夜由 `App.tsx`
 *      的定时器刷新 —— 本文件绝不读 `Date.now()`，否则同一次渲染里不同区块
 *      可能落在不同日期上；
 *   3. **分类时长插槽** → `renderCategoryBreakdown` 交 `CategoryBreakdown`
 *      （它自己是共享 `CategoryReportView` 的接线层，位置与迁移前一致）；
 *   4. **排版** → `renderSectionHeader` 给 `<h2 style={text('section-title')}>`
 *      与各区块的说明句。共享层**不画标题**（标题是宿主的界面文案：web 是
 *      `<h2>`、mobile 是 kit 的 `SectionHeader`），它只给区块 id。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `showToday={false}` / `showStreaks={false}` 是"裁"，不是漏接线
 *
 * 迁移前 web 的成长页是「周复盘 → 年度热力 → 分类时长 → 里程碑 → 身份 → 分享」：
 * 它**没有**今日进度，也**没有** L2 连续性（那是 mobile 的）。
 *
 * ⚠️ 但**理由在 2026-10-01 换过一次**，别照旧注释理解：
 * 原先这里写"那张卡常驻在另外四个做事视图上，所以成长页故意排除它"——
 * 那次裁的是**重复**。现在做事视图的卡整个删了（台账 R6：产品负责人看图后
 * 拍板"0/0 今天还没有安排"不该是一屏的开头，数字属于侧栏每行右侧 / 分组头 /
 * 行元信息），所以这个 `false` 现在守的是另一件事：**web 整端不提供今日进度块**。
 * 想恢复它是一次产品决定（要恢复先读 R6），不是把 `false` 改成 `true` 那么轻。
 *
 * `GrowthBoard` 的顺序是两端的**并集**（两端各自缺对方一块），所以两端都用
 * boolean 开关裁出自己那一份。把顺序留成一个共享答案，正是这一刀的目的。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 年视图分档（0/1/2/3/4+）**不在本文件**
 *
 * 它曾经在 `selectors.ts#levelOf` 里有一份，与共享层新造的 `activityLevel`
 * 逐字同口径 —— 那是这一刀**新产生**的第二份实现。现在只传**事实**
 * （`dailyActivityCountsFromState` 的 `{ date, count }`），分档发生在
 * `ActivityHeatmap` 内部（`model.ts#toActivityHeatmapDays`）。
 *
 * ⚠️ 文案（含 `mobile.growth.*` 的借用）全部在 `./labels.js` —— 那里解释
 * 为什么单独一个文件、以及该补哪些 `web.*` 词条。
 */

import { useCallback, useMemo, type ReactNode } from 'react';

import { dailyActivityCountsFromState, habitGrowth } from '@heyta/app-host';
import type { IdentityTagKind } from '@heyta/domain';
import { useI18n, type I18nValue, type MessageKey } from '@heyta/i18n';
import {
  GrowthBoard,
  HEATMAP_MONTH_KEYS,
  HeytaUiProvider,
  type ActivityHeatmapLabels,
  type GrowthBoardLabels,
  type HabitStreakLabels,
  type IdentityTagListLabels,
  type MilestoneMapLabels,
  type MotivationSectionId,
  type ShareSummaryLabels,
  type WeekStatId,
  type WeeklyReviewLabels,
} from '@heyta/ui';

import { text } from '../../lib/text.js';
import { CategoryBreakdown } from '../categories/CategoryBreakdown.js';
import { useHabitStore } from '../habits/store.js';
import { useTaskStore } from '../tasks/store.js';
import { HEADLINE_COPY, IDENTITY_TAG_COPY, KIND_COPY, buildShareSummary } from './copy.js';
import { todayProgressLabels } from './labels.js';
import {
  selectIdentityTags,
  selectMilestones,
  selectTodayProgress,
  selectTotals,
  selectWeeklyReview,
} from './selectors.js';

/**
 * 每个区块的标题（+ 可选说明句）。
 *
 * ⚠️ `category` 刻意不在表里：`CategoryBreakdown` **自带**标题与说明
 * （它从"分类时长"那一刀独立出来），这里返回 `null`，不画第二个标题。
 */
const SECTION_COPY: Partial<
  Record<MotivationSectionId, { titleKey: MessageKey; noteKey?: MessageKey }>
> = {
  week: { titleKey: 'web.growth.week.title' },
  heatmap: { titleKey: 'web.growth.year.title', noteKey: 'web.growth.year.note' },
  milestones: {
    titleKey: 'web.growth.milestones.title',
    noteKey: 'web.growth.milestones.note',
  },
  tags: { titleKey: 'web.growth.tags.title' },
  share: { titleKey: 'web.growth.share.title', noteKey: 'web.growth.share.note' },
};

/** 周复盘三个维度各自的词条。顺序 = `WEEK_STAT_IDS`（**不按大小重排**）。 */
const WEEK_STAT_COPY: Record<WeekStatId, { labelKey: MessageKey; unitKey: MessageKey }> = {
  checkIns: {
    labelKey: 'web.growth.stat.checkIns',
    unitKey: 'web.growth.stat.checkIns.unit',
  },
  tasksCompleted: {
    labelKey: 'web.growth.stat.tasks',
    unitKey: 'web.growth.stat.tasks.unit',
  },
  focusMinutes: {
    labelKey: 'web.growth.stat.focus',
    unitKey: 'web.growth.stat.focus.unit',
  },
};

/*
  ─────────────────────────────────────────────────────────────────────────
  成长板的文案构造器。

  ⚠️ **为什么在视图文件里而不是抽去 `labels.ts`**：`check:empty-state` 按
  **文件**登记手写空态站点，而这几块里有 `*.empty` 词条（周复盘 / 连续性 /
  身份标签）。搬进一个新文件 = 门禁眼里**多一个新站点**（红）；留在这个已经
  登记过的视图文件里 = **同一笔债换个位置**。与 `HabitsView.tsx` 的
  `habitBoardLabels` 同一个位置，形状也一样。
  `labels.ts` 只留 `todayProgressLabels`（它没有 `*.empty` 词条），见那边的文件头。
  ───────────────────────────────────────────────────────────────────────── */

/** 周复盘（L3 短周期）。 */
function weekLabels(t: I18nValue['t']): WeeklyReviewLabels {
  return {
    range: ({ start, end }) => t('web.growth.week.range', { start, end }),
    empty: t('web.growth.week.empty'),
    headline: ({ headline, count }) => t(HEADLINE_COPY[headline], { count }),
    stat: (id) => t(WEEK_STAT_COPY[id].labelKey),
    statUnit: (id) => t(WEEK_STAT_COPY[id].unitKey),
    previous: (count) => t('web.growth.stat.previous', { count }),
    bestDay: ({ date, minutes }) => t('web.growth.week.bestDay', { date, minutes }),
  };
}

/** L2 连续性。⚠️ web 的成长页 `showStreaks={false}` 不渲染它，但接口要求在场。 */
function streakLabels(t: I18nValue['t']): HabitStreakLabels {
  return {
    empty: t('web.habits.empty'),
    // `current` 是**纯标签**（数字由共享组件单独画），而 web 的
    // `web.habits.streak.current`（"连续 {count} 天"）是整句，不能当标签用 ——
    // 借 mobile 的纯标签词条（同理由见 `labels.ts` 文件头）。
    current: t('mobile.growth.streak.current'),
    longest: (count) =>
      count === 1
        ? t('web.habits.streak.longestOne', { count })
        : t('web.habits.streak.longest', { count }),
    total: (count) =>
      count === 1
        ? t('web.habits.streak.totalOne', { count })
        : t('web.habits.streak.total', { count }),
    freeze: (count) => t('web.habits.freeze', { count }),
    repair: ({ date, count }) => t('web.habits.repair', { date, count }),
    repairAction: t('web.habits.repairAction'),
    repairA11y: ({ date, name }) => t('web.habits.a11y.repair', { date, name }),
    freshStart: ({ days, longest, total }) =>
      t('web.habits.freshStart', { days, longest, total }),
    freshStartAction: t('web.habits.freshStartAction'),
    freshStartA11y: (name) => t('web.habits.a11y.freshStart', { name }),
    // 习惯名是**用户自己的字**，不翻译 —— 原样作可访问名。
    a11yHabit: (name) => name,
  };
}

/** 里程碑（L3 长周期）。 */
function milestoneLabels(t: I18nValue['t']): MilestoneMapLabels {
  return {
    kindName: (kind) => t(KIND_COPY[kind].nameKey),
    kindUnit: (kind) => t(KIND_COPY[kind].unitKey),
    maxed: t('web.growth.milestone.dimensionDone'),
    next: ({ threshold, unit, gap }) =>
      t('web.growth.milestone.next', { threshold, unit, gap }),
    allReachedA11y: (name) => t('web.growth.milestone.allReached', { name }),
    nextA11y: ({ name, threshold, unit, gap }) =>
      t('web.growth.milestone.nextLabel', { name, threshold, unit, gap }),
    /* 每档都把阈值与完成状态说出来；对勾仍是视觉线索，文案是读屏用户的完整事实。 */
    tierA11y: ({ threshold, reached, unit = '' }) =>
      t(
        reached ? 'web.growth.milestone.tierReached' : 'web.growth.milestone.tierPending',
        { threshold: String(threshold), unit },
      ),
    // 领域层理论上不会返回空列表（`MILESTONE_DEFINITIONS` 非空）；
    // 真为空时给一句最接近的事实说明，不抛错。
    empty: t('web.growth.milestones.note'),
  };
}

/** 身份标签（L3 长周期）。 */
function tagLabels(t: I18nValue['t']): IdentityTagListLabels {
  return {
    /**
     * 表里没有的 id **返回 undefined 让共享层跳过**（它据此不渲染这一项），
     * 不原样显示 id：id 是内部标识符，渲染给用户就是把"漏翻"伪装成"已翻"。
     */
    tagName: (id) => {
      const key = IDENTITY_TAG_COPY[id];
      return key === undefined ? undefined : t(key);
    },
    near: ({ name, gap, unit }) => t('web.growth.tags.near', { name, gap, unit }),
    nearUnit: (kind: IdentityTagKind) =>
      kind === 'streakDays'
        ? // ⚠️ `streakDays` **不是**里程碑那四个维度之一，单位单独一条词条
          // （"天连续"）。这条例外从迁移前就在，不能并进 `KIND_COPY`。
          t('web.growth.unit.streakDays')
        : t(KIND_COPY[kind].unitKey),
    empty: t('web.growth.tags.empty'),
    nearNote: t('web.growth.tags.nearNote'),
    // 借 mobile 的"已达成：{name}"（web 无孪生词条）。
    reachedA11y: (name) => t('mobile.growth.tags.reachedA11y', { name }),
  };
}

/** 年度活动热力图（L3 中周期）。 */
function heatmapLabels(t: I18nValue['t']): ActivityHeatmapLabels {
  return {
    // ⚠️ 月份 key 表在共享层（`HEATMAP_MONTH_KEYS`）—— 两端各写一份 12 项列表
    // 就是漂移的起点。索引越界理论上不可能（由日期串切出 1–12），兜底写字面量。
    month: (month) => t(HEATMAP_MONTH_KEYS[month - 1] ?? 'web.heatmap.month.1'),
    /*
      🔴 这条词条**以前**写的是 `{{count}}` —— 那是 **react-activity-calendar** 的
      占位符语法（它认双花括号），而 i18n 的插值器只认单层 `{count}`，直接
      `t(key, { count })` 会得到字面的 `{2}`（习惯热力图那边踩过一次，见
      `HabitsView.tsx` 文件头）。旧代码因此在本行手工 `.replace('{{count}}', …)`。

      自绘热力图之后那个库已经不在依赖里，这条词条现在是**普通插值词条**
      （中英两侧都是 `{count}`，2026-10-03 统一），手工 replace 一并删掉。
      ⚠️ 字形统一前不要把 key 改回双花括号：`apps/mobile/tests/growth-display.spec.ts`
      的对偶用例会把两种字形当成两份事实源。
    */
    grid: ({ total }) => t('web.growth.year.heatmap', { count: total }),
    scrollHint: t('web.growth.year.scrollHint'),
    // `web.habits.heatmap.cell` 是 "{date}：{count} 次"，**不含"打卡"字样**，
    // 对"打卡 + 完成任务 + 专注轮次"的年度总览同样成立。
    cellTooltip: ({ date, count }) => t('web.habits.heatmap.cell', { date, count }),
    less: t('web.heatmap.less'),
    more: t('web.heatmap.more'),
  };
}

/** 分享块（L3 出口）。`summary` 由 `copy.ts` 用 `t()` 拼好，共享层不认识 i18n。 */
function shareLabels(t: I18nValue['t']): ShareSummaryLabels {
  return {
    copy: t('web.growth.share.copy'),
    copied: t('web.growth.share.copied'),
    failed: t('web.growth.share.failed'),
  };
}

/**
 * 构造共享 `GrowthBoard` 需要的全部文案。
 *
 * 导出给测试直接对账（`tests/growth-board.spec.tsx`）—— 字段名必须与
 * `GrowthBoardLabels` 逐项对上，漏了编译不过（类型即判据）。
 */
export function growthBoardLabels(t: I18nValue['t']): GrowthBoardLabels {
  return {
    // web 没有"只与自己比"那条说明（它是 mobile 的），省略 = 不渲染。
    today: todayProgressLabels(t),
    week: weekLabels(t),
    streaks: streakLabels(t),
    milestones: milestoneLabels(t),
    tags: tagLabels(t),
    heatmap: heatmapLabels(t),
    share: shareLabels(t),
  };
}

export function GrowthView() {
  const { t } = useI18n();
  const entities = useTaskStore((s) => s.entities);
  const now = useTaskStore((s) => s.now);
  // 习惯与打卡记录来自它们自己的 store（与 `HabitsView` 同一个来源）——
  // 连续性区块消费它们，但**配对**走 `habitGrowth`（配对的唯一实现）。
  const habits = useHabitStore((s) => s.habits);
  const logs = useHabitStore((s) => s.logs);

  const labels = useMemo(() => growthBoardLabels(t), [t]);

  /**
   * 🔴 六次投影全部**记忆化**（P0-6 的 web 半）。
   *
   * 投影**只取一次**，四块共用同一个 `now` —— 分两次取就可能落在不同日期上。
   *
   * 为什么要收进 `useMemo`：这个视图挂在整个 App 树上，而 App 的重渲染源很多
   * （同步状态、语言、`store` 的任意字段）。不记忆化时**每一轮重渲染**都要把
   * 五张表重摊一遍 —— 移动端 `GrowthScreen.tsx:173/194/198/211` 早就是这个写法。
   *
   * ⚠️ 这一刀**不**解决"每 60 秒那一轮"：那个 60 秒是 `now` 这个**输入**在变，
   *   记忆化按定义就该重算。要止住它得先把"这些投影到底吃不吃一天以内的精度"
   *   审清楚（或按 `§8` 第 14 步把 `habit-streak` 改成按记录数走），
   *   那是行为变更、不是缓存。这一句写在这里是为了不让下一个读代码的人
   *   把"加了 useMemo"当成"每分钟那一轮已经没了"。
   */
  const todayProgress = useMemo(() => selectTodayProgress(entities, now), [entities, now]);
  const review = useMemo(() => selectWeeklyReview(entities, now), [entities, now]);
  const totals = useMemo(() => selectTotals(entities), [entities]);
  const milestones = useMemo(() => selectMilestones(entities), [entities]);
  const tags = useMemo(() => selectIdentityTags(entities, now), [entities, now]);

  /**
   * 年视图的**事实**序列（旧 → 新、窗口内每天补齐）。
   * ⚠️ 只传事实，分档由 `ActivityHeatmap` 内部做（见文件头）。
   */
  const activityDays = useMemo(
    () => dailyActivityCountsFromState(entities, now, 365),
    [entities, now],
  );

  const summary = buildShareSummary(review, totals, t);

  const renderSectionHeader = useCallback(
    (id: MotivationSectionId): ReactNode => {
      const entry = SECTION_COPY[id];
      // `category` 与未列出的区块（today / streaks / compareNote，web 本就不渲染）
      // 都不给标题。
      if (entry === undefined) return null;
      return (
        <>
          {/* ⚠️ section-title 而不是 screen-title：页面大标题在顶栏（视图 tab），
              一屏两个大标题等于没有大标题。 */}
          <h2 style={text('section-title')}>{t(entry.titleKey)}</h2>
          {entry.noteKey === undefined ? null : (
            <p style={text('caption')}>{t(entry.noteKey)}</p>
          )}
        </>
      );
    },
    [t],
  );

  const renderCategoryBreakdown = useCallback(() => <CategoryBreakdown />, []);

  /**
   * 复制本周小结。纯文本（理由见 `copy.ts`），剪贴板 API 由宿主注入 ——
   * `navigator.clipboard` 在非安全上下文（http 访问局域网地址）里是 `undefined`，
   * **必须 reject 而不是吞掉**：共享组件靠它区分 `copied` / `failed`，
   * 而"点了没反应"会被读成"按钮坏了"。
   */
  const share = {
    summary,
    onCopy: async (): Promise<void> => {
      if (navigator.clipboard === undefined) throw new Error('no-clipboard');
      await navigator.clipboard.writeText(summary);
    },
  };

  return (
    /*
      🔴 `HeytaUiProvider` 必须包在**这一处**：`GrowthView` 是 `App.tsx` 里
      `tasks` / `focus` 那两棵树的**兄弟节点**，那两处的 Provider 不覆盖这里。
      同理 `HabitsView` / `NotesView` 各自包了一层。`check:ui-provider` 会
      指名道姓说 `GrowthBoard` 落在 Provider 之外 —— 别把这一层删掉。
    */
    <HeytaUiProvider>
      <GrowthBoard
        now={now}
        todayProgress={todayProgress}
        weeklyReview={review}
        milestones={milestones}
        identityTags={tags}
        habits={habits}
        logs={logs}
        growth={habitGrowth}
        activityDays={activityDays}
        labels={labels}
        /*
          「裁」出 web 那一份：不加今日进度（R6 之后 web 整端没有这块，理由见文件头）、
          不加 L2 连续性（迁移前 web 就没有）。
        */
        showToday={false}
        showStreaks={false}
        renderSectionHeader={renderSectionHeader}
        renderCategoryBreakdown={renderCategoryBreakdown}
        share={share}
        testID="growth-board"
      />
    </HeytaUiProvider>
  );
}
