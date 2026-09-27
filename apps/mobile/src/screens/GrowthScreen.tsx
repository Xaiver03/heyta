/**
 * 「我的成长」—— 移动端的激励与成长体系
 * ========================================
 *
 * 这一屏把文档 `docs/plans/motivation-and-progression.md` 里的三层搬到手机上：
 *
 *   - **L1 即时反馈**：今天做了几件、进度条。
 *   - **L2 连续性**：每个习惯的当前连续 / 最长 / 累计，外加"昨天还能补回来"
 *     与"重新开始"两种衔接提示。
 *   - **L3 叙事**：本周复盘、里程碑、身份标签。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 这一屏一行判断都没有
 *
 * 今天该做几件、连续怎么数、里程碑阈值、身份判据、周窗口 —— 全在
 * `@heyta/domain`；把物化状态摊平、滤墓碑、注入 `now` 全在
 * `@heyta/app-host#motivation`。这个文件只做两件事：
 *
 *   1. 决定用哪一句文案（`GrowthHint` 那种分支，已提到 `lib/growth-display.ts` 并单测）；
 *   2. 把数字摆到屏幕上。
 *
 * 与 Web 端成长视图**共用同一份计算**，所以"手机显示连续 5 天、网页显示 4 天"
 * 这种安静的分歧在结构上不可能发生。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 四条产品红线（写在这里，因为这是最容易在改 UI 时丢掉的东西）
 *
 * 1. **不发行货币。** 没有金币、积分、商店、可兑换物。身份与里程碑是**描述**
 *    用户已经做过的事，不是可消费的奖励。这一屏没有任何"兑换 / 领取"入口。
 * 2. **不卖后悔。** 没有"补签卡""复活券""限时挽回"。补回来只有一种形态：
 *    昨天那条链本来就是断的，补上它（`repair`），且**不收费**。
 * 3. **只与自己比。** 没有排行榜、没有百分比排名、没有"超过了 80% 的人"。
 *    连里程碑各维度的顺序都**不按达成数重排** —— 那是排行榜的形状。
 * 4. **从不制造愧疚。** 中断之后屏幕上**一定**有没变小的数字（最长 / 累计），
 *    并且它们就在当前连续旁边。没有任何一处用红色表达"下降"——
 *    周复盘的差值只用中性色，因为"这周比上周少"不是错误。
 *
 * 另外两条工程约束：
 *   - 颜色是**用户给活动/清单分配的意义**，这一屏不判断某个习惯是否"健康"，
 *     也不自动上色（见 `check:ui-language` 与分类屏的文件头）。
 *   - 数字一律走带 `tabular-nums` 的语义样式（`numeric-display` /
 *     `numeric-body`），否则 9→10 时整行会跳。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 为什么返回是**这一屏自带顶栏按钮**，而不是多一个 tab
 *
 * 底部标签**必须保持 5 个**（任务 / 日历 / 专注 / 分类 / 我的）。成长不是
 * 第五个平级目的地 —— 它是"关于我"的第二层，入口在「我的」里，返回靠顶栏。
 * 加第 6 个 tab 会把标签栏挤到每个标签都读不清，而且让"我的"这一类
 * 设置/回顾内容分居两处。
 *
 * ⚠️ 本屏**不做完成动效**（L1 的那一段是独立的一件事）：没有 Animated、
 * 没有 LayoutAnimation、没有庆祝动画。这条工单只做"能把成长数据读对、读全"。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import type { AppHost, MotivationTables } from '@heyta/app-host';
import {
  habitGrowthFromState,
  identityTagsFromState,
  milestonesFromState,
  todayProgressFromState,
  weeklyReviewFromState,
} from '@heyta/app-host';
import type { IdentityTagProgress, MilestoneKind, WeeklyReview } from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { openTaskHost } from '../db/open-host';
import {
  growthHint,
  milestoneGroups,
  nearMissTags,
  progressPercent,
  ratioText,
  reachedTagIds,
  weekHeadlineCount,
} from '../lib/growth-display';
import { useToday } from '../lib/use-today';
import { useMobileSync } from '../sync/store';
import { useTokens } from '../theme';
import { Card, SectionHeader, Screen, Text, ProgressBar } from '../ui/kit';

/**
 * 里程碑维度 → 文案 key。
 *
 * 🔴 类型是 `Record<MilestoneKind, MessageKey>`：领域层将来多一个维度，
 * 这里**编译不过**；词条表里少一条，也在 `@heyta/i18n` 的类型上就红。
 * 两处都不需要靠人记得同步。
 */
const KIND_KEY: Record<MilestoneKind, MessageKey> = {
  checkIns: 'mobile.growth.kind.checkIns',
  focusHours: 'mobile.growth.kind.focusHours',
  tasks: 'mobile.growth.kind.tasks',
  activeDays: 'mobile.growth.kind.activeDays',
};

/**
 * 身份标签 id → 文案 key。
 *
 * ⚠️ 用 `Partial` 而不是 `Record`：标签 id 由**同步过来的数据**决定，
 * 一台更新的客户端可能带来这个版本还不认识的 id。查不到时**跳过**，
 * 而不是把 `checkin-hundred` 这种内部 id 渲染给用户看。
 * 领域层的 `IDENTITY_TAG_DEFINITIONS` 是唯一事实源，这里只是一张翻译表。
 */
const TAG_KEY: Partial<Record<string, MessageKey>> = {
  started: 'mobile.growth.tag.started',
  routine: 'mobile.growth.tag.routine',
  steady: 'mobile.growth.tag.steady',
  'checkin-hundred': 'mobile.growth.tag.checkin-hundred',
  'deep-fifty': 'mobile.growth.tag.deep-fifty',
  'deep-two-hundred': 'mobile.growth.tag.deep-two-hundred',
  'finisher-five-hundred': 'mobile.growth.tag.finisher-five-hundred',
  'streak-thirty': 'mobile.growth.tag.streak-thirty',
};

/** 本周主标题的维度（`WeeklyReview['headline']` 去掉 `none`）。 */
type HeadlineKind = Exclude<WeeklyReview['headline'], 'none'>;

/** 本周主标题 → 文案 key。`none` 没有主标题，走空态文案。 */
const HEADLINE_KEY: Record<HeadlineKind, MessageKey> = {
  checkIns: 'mobile.growth.week.headline.checkIns',
  tasksCompleted: 'mobile.growth.week.headline.tasksCompleted',
  focusMinutes: 'mobile.growth.week.headline.focusMinutes',
};

export function GrowthScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();
  const { now } = useToday();
  /**
   * 🔴 `dataRevision` 是**同步完成**的信号。少了它，这一屏会一直显示冷启动时
   * 的读数：从「我的」进来看到 0，去同步一次再回来还是 0 —— 而库里其实已经有
   * 数据了。用户会以为"同步没成功"，真相是界面没重读（与分类屏同一条）。
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [tables, setTables] = useState<MotivationTables | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    openTaskHost()
      .then((next) => {
        if (alive) setHost(next);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (!host) return;
    // ⚠️ `getState()` 是**同步**的（读的是已物化的内存状态）。
    setTables(host.getState());
  }, [host]);

  useEffect(() => {
    refresh();
  }, [refresh, dataRevision]);

  /**
   * 五块读数一次算齐。
   *
   * 🔴 全部用**同一个 `now`**：分两次取 `Date.now()` 会在午夜前后算出
   * "今日进度是昨天、连续是今天"这种自相矛盾的一屏。
   */
  const data = useMemo(() => {
    if (tables === null) return null;
    return {
      today: todayProgressFromState(tables, now),
      week: weeklyReviewFromState(tables, now),
      groups: milestoneGroups(milestonesFromState(tables)),
      tags: identityTagsFromState(tables, now),
      habits: habitGrowthFromState(tables, now),
    };
  }, [tables, now]);

  return (
    // 返回是顶栏动作 —— 本屏是「我的」下面的第二层，没有第 6 个 tab。
    <Screen
      title={t('mobile.growth.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      {/* 🔴 这句不是装饰：用户在其他 App 里被排行榜训练过，
          到这里会下意识找"我排第几"。主动说清楚，比让人找不到而困惑好。 */}
      <Text variant="row-meta" tone="subtle">
        {t('mobile.growth.compare.note')}
      </Text>

      {error !== undefined ? (
        <Text variant="row-meta" tone="danger">
          {error}
        </Text>
      ) : null}

      {data === null ? null : (
        <>
          {/* ── L1：今日进度 ───────────────────────────────── */}
          <SectionHeader icon="group.today" title={t('mobile.growth.today.title')} />
          <Card>
            <TodaySection
              hint={growthHint(data.today)}
              ratio={ratioText(data.today)}
              percent={progressPercent(data.today.ratio)}
              done={data.today.done}
              total={data.today.total}
              habitsDone={data.today.habitsDone}
              habitsPlanned={data.today.habitsPlanned}
              tasksDone={data.today.tasksDone}
              tasksPlanned={data.today.tasksPlanned}
              bonus={data.today.bonus}
              focusMinutes={data.today.focusMinutes}
              closed={data.today.closed}
            />
          </Card>

          {/* ── L3：本周复盘 ───────────────────────────────── */}
          <SectionHeader icon="growth.week" title={t('mobile.growth.week.title')} />
          <Card>
            <Text variant="row-meta" tone="subtle">
              {t('mobile.growth.week.range', { start: data.week.weekStart, end: data.week.weekEnd })}
            </Text>

            {data.week.headline === 'none' ? (
              <Text variant="row-meta" tone="subtle">
                {t('mobile.growth.week.empty')}
              </Text>
            ) : (
              <Text variant="row-title">
                {t(HEADLINE_KEY[data.week.headline], {
                  count: weekHeadlineCount(data.week),
                })}
              </Text>
            )}

            {/* 🔴 差值只用中性色。上周更少的那个数字**不加红、不加箭头向下** ——
                "这周比上周少"是事实，不是错误。 */}
            <WeekStat
              label={t('mobile.growth.week.stat.checkIns')}
              value={data.week.checkIns}
              previous={data.week.previous.checkIns}
            />
            <WeekStat
              label={t('mobile.growth.week.stat.tasks')}
              value={data.week.tasksCompleted}
              previous={data.week.previous.tasksCompleted}
            />
            <WeekStat
              label={t('mobile.growth.week.stat.focus')}
              value={data.week.focusMinutes}
              previous={data.week.previous.focusMinutes}
            />

            {data.week.bestFocusDay === undefined ? null : (
              <Text variant="caption" tone="muted">
                {t('mobile.growth.week.bestDay', {
                  date: data.week.bestFocusDay.date,
                  minutes: data.week.bestFocusDay.minutes,
                })}
              </Text>
            )}
          </Card>

          {/* ── L2：连续性 ─────────────────────────────────── */}
          <SectionHeader icon="focus.streak" title={t('mobile.growth.streak.title')} />
          <Text variant="row-meta" tone="subtle">
            {t('mobile.growth.streak.note')}
          </Text>
          {data.habits.length === 0 ? (
            <Text variant="row-meta" tone="subtle">
              {t('mobile.growth.streak.empty')}
            </Text>
          ) : (
            data.habits.map((row) => (
              <Card
                key={row.habit.id}
                style={{ gap: tokens['space.2'] }}
              >
                <Text variant="row-title" numberOfLines={1}>
                  {row.habit.name}
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: tokens['space.2'] }}>
                  <Text variant="numeric-display">{String(row.resilience.resilience.current)}</Text>
                  <Text variant="row-meta" tone="muted" style={{ paddingBottom: tokens['space.1'] }}>
                    {t('mobile.growth.streak.current')}
                  </Text>
                </View>

                {/* 🔴 这两个数字**只增不减**，而且在当前连续的正下方 ——
                    连续归零时，屏幕上仍有没变小的东西。这是"中断不等于失去"
                    在排版上的实现方式，不是一句安慰文案。 */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: tokens['space.2'] }}>
                  <Text variant="numeric-body" tone="muted">
                    {t('mobile.growth.streak.longest', { days: row.resilience.resilience.longest })}
                  </Text>
                  <Text variant="numeric-body" tone="muted">
                    {t('mobile.growth.streak.total', { count: row.resilience.resilience.total })}
                  </Text>
                </View>

                {/* 断链**真的发生了**时才给补回来的入口 —— 不制造"你差点就断了"的紧张。 */}
                {row.resilience.repair === undefined ? null : (
                  <Text variant="caption" tone="primary">
                    {t('mobile.growth.streak.repair', { days: row.resilience.repair.streakIfRepaired })}
                  </Text>
                )}

                {/* 停下来很久了：明确说"什么都没丢"，并给一个干净起点。 */}
                {row.resilience.freshStart === undefined ? null : (
                  <Text variant="caption" tone="muted">
                    {t('mobile.growth.streak.freshStart', {
                      days: row.resilience.freshStart.daysSinceLast,
                      longest: row.resilience.freshStart.longest,
                      total: row.resilience.freshStart.total,
                    })}
                  </Text>
                )}
              </Card>
            ))
          )}

          {/* ── L3：里程碑 ─────────────────────────────────── */}
          <SectionHeader icon="growth.milestones" title={t('mobile.growth.milestones.title')} />
          <Text variant="row-meta" tone="subtle">
            {t('mobile.growth.milestones.note')}
          </Text>
          {data.groups.map((group) => (
            <Card key={group.kind} style={{ gap: tokens['space.2'] }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: tokens['space.2'] }}>
                <Text variant="row-title">
                  {t(KIND_KEY[group.kind])}
                </Text>
                {/* 数字只有值，单位由上面的维度名承担（"专注小时 12"）——
                    这样英文侧不会出现 "1 hours"。 */}
                <Text variant="numeric-body" tone="muted">
                  {String(group.current)}
                </Text>
              </View>

              <MilestoneTiers group={group} />

              <Text variant="caption" tone="subtle">
                {group.maxed
                  ? t('mobile.growth.milestones.maxed')
                  : t('mobile.growth.milestones.next', { next: group.next ?? 0 })}
              </Text>
            </Card>
          ))}

          {/* ── L3：身份 ───────────────────────────────────── */}
          <SectionHeader icon="growth.identity" title={t('mobile.growth.tags.title')} />
          <Text variant="row-meta" tone="subtle">
            {t('mobile.growth.tags.note')}
          </Text>
          <Card>
            <TagList tags={data.tags} />
          </Card>
        </>
      )}
    </Screen>
  );
}

/** 今日进度那一块。分支文案在 `growthHint` 里定，这里只挑 key。 */
function TodaySection({
  hint,
  ratio,
  percent,
  done,
  total,
  habitsDone,
  habitsPlanned,
  tasksDone,
  tasksPlanned,
  bonus,
  focusMinutes,
  closed,
}: {
  hint: ReturnType<typeof growthHint>;
  ratio: string;
  percent: number;
  done: number;
  total: number;
  habitsDone: number;
  habitsPlanned: number;
  tasksDone: number;
  tasksPlanned: number;
  bonus: number;
  focusMinutes: number;
  closed: boolean;
}): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();

  const hintText =
    hint === 'idle'
      ? t('mobile.growth.today.hint.idle')
      : hint === 'unplanned'
        ? t('mobile.growth.today.hint.unplanned', { count: done })
        : hint === 'allDone'
          ? t('mobile.growth.today.hint.allDone')
          : t('mobile.growth.today.hint.remaining', { count: total - done });

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: tokens['space.2'] }}>
        <Text variant="numeric-display">{ratio}</Text>
        <Text variant="row-meta" tone="muted" style={{ paddingBottom: tokens['space.1'], flexShrink: 1 }}>
          {hintText}
        </Text>
      </View>

      {/* 🔴 进度条是纯信息：读屏靠 `label`，所以它必须是一句完整的话。 */}
      <ProgressBar
        percent={percent}
        label={t('mobile.growth.today.a11y', { done, total })}
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.3'] }}>
        <Text variant="caption" tone="muted">
          {t('mobile.growth.today.habits', { done: habitsDone, planned: habitsPlanned })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('mobile.growth.today.tasks', { done: tasksDone, planned: tasksPlanned })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('mobile.growth.today.focus', { minutes: focusMinutes })}
        </Text>
        {/* 计划外也做了事 → 说出来。这正是"小胜"该被看见的地方。 */}
        {bonus > 0 ? (
          <Text variant="caption" tone="primary">
            {t('mobile.growth.today.bonus', { count: bonus })}
          </Text>
        ) : null}
      </View>

      {closed ? (
        <Text variant="caption" tone="success">
          {t('mobile.growth.today.closed')}
        </Text>
      ) : null}
    </>
  );
}

/** 本周某一维度的"本周 / 上周"。两个数字都是中性色 —— 下降不是错误。 */
function WeekStat({
  label,
  value,
  previous,
}: {
  label: string;
  value: number;
  previous: number;
}): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: tokens['space.2'] }}>
      <Text variant="row-meta" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', gap: tokens['space.2'] }}>
        <Text variant="numeric-body">{String(value)}</Text>
        <Text variant="numeric-body" tone="subtle">
          {t('mobile.growth.week.stat.previous', { count: previous })}
        </Text>
      </View>
    </View>
  );
}

/**
 * 里程碑的四档阈值。
 *
 * 已达成的档用主色（**不是金色**，也不是徽章图标）；未达成的档用中性底。
 * 阈值本身是文字（`10` / `50` / …），所以**不靠颜色单独传达状态** ——
 * 顺序 + 数字 + 底色三者一起说同一件事。
 */
function MilestoneTiers({
  group,
}: {
  group: ReturnType<typeof milestoneGroups>[number];
}): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.1'] }}>
      {group.tiers.map((tier) => (
        <View
          key={tier.threshold}
          style={{
            paddingHorizontal: tokens['space.2'],
            minHeight: tokens['size.chip-height'],
            justifyContent: 'center',
            borderRadius: tokens['radius.full'],
            backgroundColor: tier.reached
              ? tokens['color.primary-subtle']
              : tokens['color.surface-sunken'],
          }}
        >
          <Text variant="caption" tone={tier.reached ? 'primary' : 'subtle'}>
            {String(tier.threshold)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * 身份标签：已达成的排前面（主色），最近的未达成排后面（中性）。
 *
 * ⚠️ 已达成的顺序**固定按定义表**，不按达成时间或"稀有度"排序 ——
 * 那会变成一种排位。未达成的只取最近的两个，作为目标梯度。
 */
function TagList({ tags }: { tags: readonly IdentityTagProgress[] }): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();
  const reached = reachedTagIds(tags);
  const near = nearMissTags(tags, 2);

  if (reached.length === 0 && near.length === 0) {
    return (
      <Text variant="row-meta" tone="subtle">
        {t('mobile.growth.tags.empty')}
      </Text>
    );
  }

  return (
    <View style={{ gap: tokens['space.2'] }}>
      {reached.length === 0 ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.1'] }}>
          {reached.map((id) => {
            const key = TAG_KEY[id];
            if (key === undefined) return null;
            const name = t(key);
            return (
              <View
                key={id}
                // 标签是**信息**不是按钮。读屏念"已达成：坚持一周"。
                accessible
                accessibilityLabel={t('mobile.growth.tags.reachedA11y', { name })}
                style={{
                  paddingHorizontal: tokens['space.3'],
                  minHeight: tokens['size.chip-height'],
                  justifyContent: 'center',
                  borderRadius: tokens['radius.full'],
                  backgroundColor: tokens['color.primary-subtle'],
                }}
              >
                <Text variant="caption" tone="primary">
                  {name}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {near.map((miss) => {
        const key = TAG_KEY[miss.id];
        if (key === undefined) return null;
        return (
          <Text key={miss.id} variant="caption" tone="muted">
            {t('mobile.growth.tags.near', { name: t(key), gap: miss.gap })}
          </Text>
        );
      })}
    </View>
  );
}
