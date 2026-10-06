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
 * 🔴 本端**没做**的三件事（逐条记账，附影响 + 卡在哪 + 最小一步）
 *
 *   1. **没传 `activityDays`** ⇒ 没有年度活动热力图。
 *      ~~理由 ①：缺一条可用词条。~~ ✅ **那条已清**：`web.growth.year.heatmap`
 *      的 `{{count}}` 双花括号（react-activity-calendar 的语法）已在 2026-10-03
 *      统一成 i18n 的单层 `{count}`，中英两侧同形，`t(key, { count })` 直接可用。
 *      🔴 现在**只剩一条**，而且不是我能动的那类：判卷文件
 *      `apps/mobile/tests/growth-display.spec.ts:365` 断言
 *      `labels.heatmap.grid({ total: 42, days: 365 })` 必须**等于空串**，而它自己
 *      第 364 行写着「一旦有人传了 activityDays，这条会先红」。本轮判卷冻结
 *      （唯一豁免是 `reminders-notes-display.spec.ts:261`）。
 *      ⚠️ **不能绕**：传了 `activityDays` 而让 `grid` 继续回空串，等于渲染一块
 *      **没有无障碍名**的热力图 —— 屏幕阅读器念不出"这一年共多少次"，而没有任何
 *      一层会报错。那正是那条判据要拦的事，不是它拦我要做的事。→ BLOCKED.md
 *      **影响**：移动端看不到"这一年"，其余三层都在。
 *      **最小一步**：把 `:365` 的极性翻成"必须是非空、含数字"，同时本屏
 *      `activityDays={dailyActivityCountsFromState(tables, now, 365)}` +
 *      `grid: ({ total }) => t('web.growth.year.heatmap', { count: total })`，
 *      再补一次真机验收（横向滚动/尺寸）。
 *   2. ~~**没传 `share`** ⇒ 没有分享块。~~
 *      ✅ **已做完（2026-10-03，任务 4）**：复制走 **RN 核心的 `Clipboard.setString`**
 *      （实测 0.84.1 两端都还注册着 —— Android `MainReactPackage.kt` 四处、
 *      iOS `React/CoreModules/RCTClipboard.mm` 带 `RCT_EXPORT_MODULE`），
 *      零新依赖、零手搓原生模块；小结文本来自 `@heyta/app-host#buildShareSummary`
 *      （原来只有 web 一份实现，搬进共享层是为了不逼出第二份 —— AGENTS §3.5）。
 *      ⚠️ **一条诚实边界**：RN 的 `setString` 是 fire-and-forget（返回 `void`，
 *      读不回），所以移动端的"已复制"说的是"已经交给系统剪贴板"，**不是**
 *      "验证过里面就是这段"。设备级读回判据（点完去粘贴框贴一次）本轮没做 → BLOCKED.md
 *   3. **没传 `onRepair` / `onFreshStart`** ⇒ 补打卡 / 重新开始**只有文字**。
 *      `onRepair` 的接法本来就现成（`createHabitActions(host).checkIn(habitId, date)`，
 *      `HabitsScreen.tsx:401` 已在用），但共享层的按钮渲染条件是
 *      `onRepair !== undefined && labels.repairAction !== undefined`
 *      （`HabitStreakList.tsx:269`），而判卷文件
 *      `apps/mobile/tests/growth-display.spec.ts:302` 断言
 *      `labels.streaks.repairAction` 必须**是 undefined**（同一批"刻意没做"的 tripwire，
 *      本轮判卷冻结）⇒ 与第 1 条同一个阻塞，见 BLOCKED.md。
 *      🔴 `onFreshStart` **不只是没接**：action 层**没有"重新开始"这个动作**
 *      （它语义上是"把这条连续的锚点挪到今天"，要么建新习惯、要么改历史，
 *      两者都不是一个 op 能表达的事）⇒ 不许顺手编一个，缺口登记在 BLOCKED.md。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clipboard } from 'react-native';
import type { AppHost, MotivationTables } from '@heyta/app-host';
import {
  activityTotalsFromState,
  aliveRecords,
  buildShareSummary,
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
      totals: activityTotalsFromState(tables),
      milestones: milestonesFromState(tables),
      tags: identityTagsFromState(tables, now),
      habits: aliveRecords(tables.habits),
      logs: aliveRecords(tables.habitLogs),
    };
  }, [tables, now]);

  /**
   * 分享块（L3 出口）。文本来自 `@heyta/app-host`（与 web 同一份实现，理由见
   * 那边的文件头），复制走 **RN 核心的 `Clipboard`**。
   *
   * 🔴 契约是"**成功 = resolve，失败 = reject**"（`ShareSummarySection` 靠它区分
   * `copied` / `failed`）。RN 的 `setString` 返回 `void`、读不回，所以这里不吞异常：
   * 原生模块缺失或写入抛错就让它 reject，界面显示"当前环境不允许复制"。
   */
  const summary = useMemo(
    () => (data === null ? '' : buildShareSummary(data.week, data.totals, t)),
    [data, t],
  );
  const share = useMemo(
    () =>
      data === null
        ? undefined
        : {
            summary,
            onCopy: async (): Promise<void> => {
              Clipboard.setString(summary);
            },
          },
    [data, summary],
  );

  const labels = useMemo(() => growthBoardLabels(t), [t]);

  /**
   * 区块标题插槽。
   *
   * 标题是**宿主的外观**（移动端用 kit 的 `SectionHeader`），共享层只给区块 id。
   * `compareNote` 自带那句文案、不要标题；`heatmap` / `category` 本端不渲染
   * （理由见文件头"没做的三件事"），返回 null 而不是编个标题。
   * `share` **现在渲染**：分享块没有标题会读成"一个孤零零的按钮"，而那两句
   * （"带走这一周" / "复制成一段纯文字，粘到哪都行。它不含你的账号、设备或任何
   * 标识。"）是这套设计的立场声明 —— 尤其"E2EE 下分享出去的文本不带标识"这条，
   * 不写出来用户不会知道。词条复用 web 那两条（本端 `growth-display.ts` 已经在
   * 借 `web.growth.*` 的既有词条，不复制第三份句子）。
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
          return null;
        case 'share':
          return (
            <>
              <SectionHeader icon="growth.share" title={t('web.growth.share.title')} />
              <Text variant="row-meta" tone="subtle">
                {t('web.growth.share.note')}
              </Text>
            </>
          );
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
          /*
            🔴 这一份文本 + 这条复制路径就是本端"周小结"的出口。
            `activityDays`（年度热力图）与 `onRepair`（补打卡按钮）**仍然没传** ——
            不是忘了，是被两条冻结判据钉在"刻意没做"上，接线会让那块变成
            没有无障碍名的热力图 / 让那条"按钮必须不出现"的断言红。
            逐条取证与最小一步见本文件头"没做的三件事"第 1、3 条与 BLOCKED.md。
          */
          share={share}
          labels={labels}
          renderSectionHeader={renderSectionHeader}
          testID="growth-board"
        />
      )}
    </Screen>
  );
}
