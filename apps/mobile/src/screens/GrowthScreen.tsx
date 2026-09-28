/**
 * 「我的成长」—— 移动端的激励与成长体系（M3 第十一刀换装后）
 * ============================================================
 *
 * 这一屏把文档 `docs/plans/motivation-and-progression.md` 里的三层搬到手机上：
 *
 *   - **L1 即时反馈**：今天做了几件、进度条。
 *   - **L2 连续性**：每个习惯的当前连续 / 最长 / 累计，外加"昨天还能补回来"
 *     与"重新开始"两种衔接提示。
 *   - **L3 叙事**：本周复盘、里程碑、身份标签。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 换装之后，本文件**只做两件事**
 *
 *   1. **接线**：用**同一个 `now`** 从 `@heyta/app-host#motivation` 取五块投影，
 *      再从物化状态里取连续性要的 `habits` / `logs`；
 *   2. **注入**：`labels`（`lib/growth-display.ts` 的 `growthBoardLabels`）、
 *      两个回调（`renderSectionHeader` 给移动端的 `SectionHeader` + 说明句），
 *      其余**全部**由共享 `GrowthBoard` 渲染。
 *
 * 迁移前这里是 578 行自带排版与分支的实现；那些纯展示逻辑
 * （`growthHint` / `ratioText` / `progressPercent` / `milestoneGroups` / …）已经收编进
 * `packages/ui/src/motivation/model.ts`，本文件不再有**任何**展示判断，
 * 也不再有**一个**样式字面量（`check:l4` 的移动基线因此只会降）。
 *
 * 与 Web 端成长视图**共用同一份计算与同一份区块组件**，所以
 * "手机显示连续 5 天、网页显示 4 天"这种安静的分歧在结构上不可能发生。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 四条产品红线（跟着这一屏搬家，因为这是改 UI 时最容易丢的东西）
 *
 * 1. **不发行货币。** 没有金币、积分、商店、可兑换物。身份与里程碑是**描述**
 *    用户已经做过的事，不是可消费的奖励。这一屏没有任何"兑换 / 领取"入口。
 * 2. **不卖后悔。** 没有"补签卡""复活券""限时挽回"。补回来只有一种形态：
 *    昨天那条链本来就是断的，补上它（`repair`），且**不收费**。
 * 3. **只与自己比。** 没有排行榜、没有百分比排名、没有"超过了 80% 的人"。
 *    连里程碑各维度的顺序都**不按达成数重排** —— 那是排行榜的形状。
 *    这一句显式声明由 `labels.compareNote` 承担（**mobile 有、web 没有**）。
 * 4. **从不制造愧疚。** 中断之后屏幕上**一定**有没变小的数字（最长 / 累计），
 *    并且它们就在当前连续旁边。没有任何一处用红色表达"下降" ——
 *    周复盘的差值只用中性色，因为"这周比上周少"不是错误。
 *    这条排版由共享 `HabitStreakList` 的文件头钉死。
 *
 * 另外两条工程约束：
 *   - 颜色是**用户给活动/清单分配的意义**，这一屏不判断某个习惯是否"健康"，
 *     也不自动上色（见 `check:ui-language` 与分类屏的文件头）。
 *   - 数字一律走带 `tabular-nums` 的语义样式 —— 那是共享组件的事，本文件不碰。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 为什么返回是**这一屏自带顶栏按钮**，而不是多一个 tab
 *
 * 底部标签**必须保持 5 个**（任务 / 日历 / 专注 / 分类 / 我的）。成长不是
 * 第五个平级目的地 —— 它是"关于我"的第二层，入口在「我的」里，返回靠顶栏。
 * 加第 6 个 tab 会把标签栏挤到每个标签都读不清，而且让"我的"这一类
 * 设置/回顾内容分居两处。入口**换装前后没有动**：仍是
 * `ProfileScreen` 的 `profile-entry-growth`（`growthOpen` → 本屏）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本端**刻意没做**的三件事（逐条记账，附影响 + 最小一步）
 *
 *   1. **没传 `activityDays`** ⇒ 没有年度活动热力图。
 *      两条独立的理由：① 缺一条可用词条 —— 唯一候选
 *      `web.growth.year.heatmap` 用的是库自己的 `{{count}}` 占位符，`t()`
 *      会渲染出字面的 `{5}`；② 把 web 的年度视图带进小屏需要一次真机验收，
 *      本轮拿不到真机。**影响**：移动端看不到"这一年"，其余三层都在。
 *      **最小一步**：补 `mobile.growth.year.heatmap`（含 `{total}`/`{days}`），
 *      再把 `dailyActivityCountsFromState(tables, now)` 传进去。
 *   2. **没传 `share` / `onCopySummary` 对应物（`share`）** ⇒ 没有分享块。
 *      移动端没有剪贴板接线，传了会得到一个点不动的按钮。
 *      **影响**：无法把周小结复制成纯文本。
 *      **最小一步**：接一个 RN 剪贴板实现 + `buildShareSummary` 等价物。
 *   3. **没传 `onRepair` / `onFreshStart`** ⇒ 补打卡 / 重新开始**只有文字**。
 *      这两个动作要走 action 层写 op，而本刀白名单不含习惯 action 接线。
 *      **影响**：与迁移前完全一致（迁移前也只有文字）。
 *      **最小一步**：把 `HabitsScreen` 里已有的 `createHabitActions(...)`
 *      补打卡/重新开始调法搬到本屏传进来。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppHost, MotivationTables } from '@heyta/app-host';
import {
  aliveRecords,
  habitGrowth,
  identityTagsFromState,
  milestonesFromState,
  todayProgressFromState,
  weeklyReviewFromState,
} from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';
import { GrowthBoard, type MotivationSectionId } from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import { growthBoardLabels } from '../lib/growth-display';
import { useToday } from '../lib/use-today';
import { useMobileSync } from '../sync/store';
import { Screen, SectionHeader, Text } from '../ui/kit';

export function GrowthScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
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
   * 六块读数一次取齐。
   *
   * 🔴 五块投影全部用**同一个 `now`**：分两次取 `Date.now()` 会在午夜前后算出
   * "今日进度是昨天、连续是今天"这种自相矛盾的一屏。
   *
   * 🔴 `habits` / `logs` 走 `aliveRecords`（`@heyta/app-host` 的摊平 + 滤墓碑），
   * **顺序与 `habitGrowthFromState` 内部逐字相同**（同一个 `aliveRecords`），
   * 所以连续区块的排列不会因为换装而变。这里刻意不用旧的
   * `habitGrowthFromState`：共享层的 `HabitStreakList` 要的是**原料 +
   * 注入的配对函数**（`growth`），由它自己调 `toHabitStreakRows` ——
   * 传"已经配好对的行"等于把配对实现变成两份。
   */
  const data = useMemo(() => {
    if (tables === null) return null;
    return {
      today: todayProgressFromState(tables, now),
      week: weeklyReviewFromState(tables, now),
      milestones: milestonesFromState(tables),
      tags: identityTagsFromState(tables, now),
      habits: aliveRecords(tables.habits),
      logs: aliveRecords(tables.habitLogs),
    };
  }, [tables, now]);

  const labels = useMemo(() => growthBoardLabels(t), [t]);

  /**
   * 区块标题插槽。
   *
   * 标题是**宿主的外观**（移动端用 kit 的 `SectionHeader`），共享层只给区块 id。
   * `compareNote` 自带那句文案、不要标题；`heatmap` / `category` / `share`
   * 本端不渲染（见文件头"刻意没做"），返回 null 而不是编个标题。
   *
   * ⚠️ 三个"说明句"（连续 / 里程碑 / 身份）跟着标题一起给 ——
   * 共享层没有"区块副标题"这个概念，而这三句是迁移前移动端已有的文案。
   */
  const renderSectionHeader = useCallback(
    (id: MotivationSectionId): React.ReactNode => {
      switch (id) {
        case 'compareNote':
        case 'heatmap':
        case 'category':
        case 'share':
          return null;
        case 'today':
          return <SectionHeader icon="group.today" title={t('mobile.growth.today.title')} />;
        case 'week':
          return <SectionHeader icon="growth.week" title={t('mobile.growth.week.title')} />;
        case 'streaks':
          return (
            <>
              <SectionHeader icon="focus.streak" title={t('mobile.growth.streak.title')} />
              <Text variant="row-meta" tone="subtle">
                {t('mobile.growth.streak.note')}
              </Text>
            </>
          );
        case 'milestones':
          return (
            <>
              <SectionHeader icon="growth.milestones" title={t('mobile.growth.milestones.title')} />
              <Text variant="row-meta" tone="subtle">
                {t('mobile.growth.milestones.note')}
              </Text>
            </>
          );
        case 'tags':
          return (
            <>
              <SectionHeader icon="growth.identity" title={t('mobile.growth.tags.title')} />
              <Text variant="row-meta" tone="subtle">
                {t('mobile.growth.tags.note')}
              </Text>
            </>
          );
      }
    },
    [t],
  );

  return (
    // 返回是顶栏动作 —— 本屏是「我的」下面的第二层，没有第 6 个 tab。
    <Screen
      title={t('mobile.growth.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      {error !== undefined ? (
        <Text variant="row-meta" tone="danger">
          {error}
        </Text>
      ) : null}

      {data === null ? null : (
        /*
          🔴 整屏的区块顺序、区块开关、卡片排版**全部**在共享 `GrowthBoard` 里。
          本文件不许自己画一行 —— 一旦画了，移动端与 web 的成长屏就开始漂移，
          而那件事不会有任何测试变红。
        */
        <GrowthBoard
          now={now}
          todayProgress={data.today}
          weeklyReview={data.week}
          milestones={data.milestones}
          identityTags={data.tags}
          habits={data.habits}
          logs={data.logs}
          // 🔴 连续 + 韧性必须用同一份日志、同一个 `today` 配对 ——
          // 实现只有 `@heyta/app-host#habitGrowth` 这一处，两端都注入它。
          growth={habitGrowth}
          labels={labels}
          renderSectionHeader={renderSectionHeader}
          testID="growth-board"
        />
      )}
    </Screen>
  );
}
