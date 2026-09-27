/**
 * 「分类时长」—— 移动端的分类视图
 * ==================================
 *
 * 用户问的是"我这段时间到底把力气花在哪些事上了"。这一屏用一个**泳道**回答它：
 * 一行一个来源（清单 / 习惯），行首是色块 + 槽位号 + 名字 + 来源 + 总时长，
 * 下面一行十二格（十二周，深浅 = 那一周做了多少）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 三条必须活着的约束（与 Web 端同源）
 *
 * 1. 🔴 **不做排行、不做评价。** 行序按总时长降序 —— 那是**读数**顺序，
 *    不是"第一名"。界面上没有"最多 / 最少 / 最差 / 失衡"，没有奖牌、
 *    没有百分号占比、没有把某一行标红。颜色是**身份**，App 永远不知道
 *    红色代表什么。
 * 2. 🔴 **不许只用颜色表达信息。** 每一行都有：位置、槽位号、名字、
 *    来源、总时长（数字）。格子是装饰（`accessibilityElementsHidden`），
 *    屏幕阅读器只念一次"深度工作（清单），共 5 小时 20 分"。
 * 3. 🔴 **口径只有一份。** 归因链、窗口、软删除、缺省 `actualMs` 全在
 *    `@heyta/domain` 的 `computeCategoryReport` 里，摊平的动作在
 *    `@heyta/app-host` 的 `categoryReportFromState` 里。这一屏**一行判断都没有** ——
 *    如果这里再算一次"这周多少分钟"，它迟早和 Web 端、和周复盘对不上账。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 为什么取色放在这一屏（而不是照搬 Web 的清单编辑器）
 *
 * Web 端把调色板放在清单/习惯旁边。移动端放在**看得见归类结果的地方**：
 * 用户是在"这一行是什么颜色"的语境里做选择的，而这一屏此刻就是那个语境。
 * 两侧调的是**同一个共享动作**（`ProjectActions.setProjectColor` /
 * `HabitActions.setHabitColor`），语义没有第二份。
 *
 * ## 移动端刻意**没有**的东西
 *
 * - **不做那个堆叠柱状图**（Web 有）。手机上 12 根柱子和 12 格泳道抢同一块宽度，
 *   而泳道是主、柱子是辅 —— 宁可只留主视图，也不要两张都看不清的图。
 * - **不做分钟制的习惯打卡**：移动端到现在没有习惯界面。状态里同步过来的
 *   习惯照样会出现在这一屏（数据是真的），但"给习惯记时长"要靠 Web 或
 *   以后的移动端习惯屏。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { AppHost } from '@heyta/app-host';
import { categoryReportFromState, createHabitActions, createProjectActions } from '@heyta/app-host';
import type { CategoryReport, CategorySeries } from '@heyta/domain';
import { CATEGORY_SLOTS, intensityLevel, type CategorySlot } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { openTaskHost } from '../db/open-host';
import { formatDuration, laneLabel, slotText } from '../lib/category-display';
import { heatColor, slotColor, unsetColor } from '../lib/category-colors';
import { useToday } from '../lib/use-today';
import { useMobileSync } from '../sync/store';
import { Screen, Text } from '../ui/kit';
import { useTokens } from '../theme';

/** 泳道格子数 = 领域层的默认窗口（不在这里写字面量）。 */
export function CategoriesScreen(): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();
  const { now } = useToday();
  /**
   * 🔴 `dataRevision` 是**同步完成**的信号。少了它，这一屏在整个应用生命周期里
   * 都不会重读：冷启动落在本屏（空的）→ 去「我的」同步 → 切回来仍是空的，
   * 而数据库里那条远端记录**已经应用了**（重启 App 就能看见）。
   * 用户据此会认为"多端同步没成功"，而真相是数据到了、界面没去看。
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [report, setReport] = useState<CategoryReport | null>(null);
  /** 当前展开着色槽的那一行（key）。同时只展开一行：一屏里全是色板会盖住读数。 */
  const [openKey, setOpenKey] = useState<string | null>(null);

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

  const projectActions = useMemo(() => (host ? createProjectActions(host) : null), [host]);
  const habitActions = useMemo(() => (host ? createHabitActions(host) : null), [host]);

  const refresh = useCallback(() => {
    if (!host) return;
    // ⚠️ `getState()` 是**同步**的（读的是已物化的内存状态）。
    // 摊平与 `now` 的注入都在共享实现里，见文件头。
    setReport(categoryReportFromState(host.getState(), now));
  }, [host, now]);

  useEffect(() => {
    refresh();
  }, [refresh, dataRevision]);

  /** 挑一个色槽（`undefined` = 不用颜色）。一次点击 = 一个用户意图 = 一条 op。 */
  const chooseColor = useCallback(
    (row: CategorySeries, slot: CategorySlot | undefined) => {
      const run =
        row.kind === 'project'
          ? projectActions?.setProjectColor(row.id, slot)
          : habitActions?.setHabitColor(row.id, slot);
      if (run === undefined) return;
      void run
        .then(() => {
          setError(undefined);
          refresh();
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        });
    },
    [habitActions, projectActions, refresh],
  );

  return (
    // 🔴 `Screen` 负责顶栏标题、安全区与滚动 —— 这一屏只出内容。
    // 自己拼 ScrollView 的话，标题、较深的安全区、以及"键盘弹起时的
    // 可点击区域"都要重写一遍，而且会和别的屏幕长得不一样。
    <Screen title={t('mobile.categories.title')}>
      <View style={{ gap: tokens['space.3'] }}>
        <Text variant="row-meta" tone="subtle">
          {t('mobile.categories.note')}
        </Text>

        {/* ⚠️ 移动端的 `Text` 不收 `accessibilityRole`（见 `ui/kit.tsx` 的
            `TextProps`）。错误行只靠颜色 + 文案区分，不假装自己是 alert ——
            写一个不存在的 prop 会被 TS 抓住，这比静默忽略强。 */}
        {error !== undefined ? (
          <Text variant="row-meta" tone="danger">
            {error}
          </Text>
        ) : null}

        {report === null ? null : report.series.length === 0 && report.unassignedMs === 0 ? (
          <Text variant="row-meta" tone="subtle">
            {t('mobile.categories.empty')}
          </Text>
        ) : (
          <>
            <Text variant="row-meta" tone="subtle">
              {t('mobile.categories.range', {
                start: report.weeks[0]?.start ?? '',
                end: report.weeks.at(-1)?.end ?? '',
              })}
            </Text>

            {report.series.map((row) => (
              <Lane
                key={row.key}
                row={row}
                report={report}
                open={openKey === row.key}
                onToggle={() => {
                  setOpenKey((current) => (current === row.key ? null : row.key));
                }}
                onChoose={(slot) => {
                  chooseColor(row, slot);
                }}
              />
            ))}

            {/* 没归到任何类别的时间**如实说出来**。它的正确归宿是
                "给这条任务选个清单"，而不是消失在总数里。 */}
            {report.unassignedMs > 0 ? (
              <Text variant="row-meta" tone="subtle">
                {t('mobile.categories.unassigned', {
                  duration: formatDuration(report.unassignedMs, t),
                })}
              </Text>
            ) : null}

            {/* 有行但一行都没设色：这是**可发现的入口**，不是错误。
                ⚠️ 不许写成"你还没给清单分色"式的追责语气。 */}
            {report.series.some((row) => row.slot === undefined) ? (
              <Text variant="row-meta" tone="subtle">
                {t('mobile.categories.hint.unset')}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}

/**
 * 一行：色块 + 槽位号 + 名字 + 来源 + 总时长，下面十二格。
 *
 * 色块本身是**按钮**（44 触控区），点开这一行的色槽选择。
 */
function Lane({
  row,
  report,
  open,
  onToggle,
  onChoose,
}: {
  row: CategorySeries;
  report: CategoryReport;
  open: boolean;
  onToggle: () => void;
  onChoose: (slot: CategorySlot | undefined) => void;
}): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();
  const color = row.slot === undefined ? unsetColor(tokens) : slotColor(row.slot, tokens);

  return (
    <View
      style={{
        borderWidth: tokens['border-width.thin'],
        borderColor: tokens['color.border'],
        borderRadius: tokens['radius.md'],
        backgroundColor: tokens['color.surface'],
        padding: tokens['space.3'],
        gap: tokens['space.2'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] }}>
        {/* 🔴 色块是按钮，所以它是**可点、可聚焦、有名字**的；
            而槽位号是**文字**（下一行），不是颜色 —— 色觉障碍用户靠它认行。 */}
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={t('mobile.categories.picker.toggle', { name: row.name })}
          style={({ pressed }) => ({
            minWidth: tokens['touch-target.min'],
            minHeight: tokens['touch-target.min'],
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: tokens['radius.md'],
            backgroundColor: pressed ? tokens['color.surface-sunken'] : 'transparent',
          })}
        >
          <View
            style={{
              width: tokens['space.4'],
              height: tokens['space.4'],
              borderRadius: tokens['radius.sm'],
              backgroundColor: color,
            }}
          />
        </Pressable>

        <Text variant="row-meta" tone="subtle" style={{ minWidth: tokens['space.4'] }}>
          {slotText(row.slot, t)}
        </Text>
        <Text variant="row-title" numberOfLines={1} style={{ flex: 1 }}>
          {row.name}
        </Text>
        <Text variant="row-meta" tone="subtle">
          {row.kind === 'project'
            ? t('mobile.categories.kind.project')
            : t('mobile.categories.kind.habit')}
        </Text>
        <Text variant="numeric-body">{formatDuration(row.totalMs, t)}</Text>
      </View>

      {/* 整行的文字事实（屏幕阅读器只念一次，念的是这一句）。 */}
      <View accessible accessibilityLabel={laneLabel(row, t)}>
        {/* 格子是**装饰**：深浅只能看个大概，确切数字在上面那句里。 */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', gap: tokens['space.1'] }}
        >
          {row.weeklyMs.map((ms, index) => (
            <View
              key={report.weeks[index]?.start ?? String(index)}
              style={{
                flex: 1,
                height: tokens['space.2'],
                borderRadius: tokens['radius.sm'],
                backgroundColor: heatColor(
                  intensityLevel(ms, report.peakWeeklyMs),
                  tokens,
                ),
              }}
            />
          ))}
        </View>
      </View>

      {open ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('mobile.categories.picker.group', { name: row.name })}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.1'] }}
        >
          {CATEGORY_SLOTS.map((slot) => (
            <Pressable
              key={slot}
              onPress={() => {
                // 再点一次同一个槽位 = 取消（与 Web 端一致：不需要第 10 个按钮
                // 去表达"取消"，那会让色板变成 9+1 个选项）。
                onChoose(row.slot === slot ? undefined : slot);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: row.slot === slot }}
              accessibilityLabel={t('mobile.categories.picker.slot', { slot })}
              style={({ pressed }) => ({
                minWidth: tokens['touch-target.min'],
                minHeight: tokens['touch-target.min'],
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: tokens['space.1'],
                borderRadius: tokens['radius.md'],
                borderWidth:
                  row.slot === slot ? tokens['border-width.thick'] : tokens['border-width.thin'],
                borderColor: row.slot === slot ? tokens['color.primary'] : tokens['color.border'],
                backgroundColor: pressed ? tokens['color.surface-sunken'] : tokens['color.surface'],
              })}
            >
              <View
                style={{
                  width: tokens['space.3'],
                  height: tokens['space.3'],
                  borderRadius: tokens['radius.sm'],
                  backgroundColor: slotColor(slot, tokens),
                }}
              />
              <Text variant="row-meta">{String(slot)}</Text>
            </Pressable>
          ))}

          {/* 「不用颜色」也是**一个选项**，放在最后：它不该看起来像"错误状态"。 */}
          <Pressable
            onPress={() => {
              onChoose(undefined);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: row.slot === undefined }}
            accessibilityLabel={t('mobile.categories.slot.none')}
            style={({ pressed }) => ({
              minWidth: tokens['touch-target.min'],
              minHeight: tokens['touch-target.min'],
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: tokens['space.2'],
              borderRadius: tokens['radius.md'],
              borderWidth:
                row.slot === undefined ? tokens['border-width.thick'] : tokens['border-width.thin'],
              borderColor:
                row.slot === undefined ? tokens['color.primary'] : tokens['color.border'],
              backgroundColor: pressed ? tokens['color.surface-sunken'] : tokens['color.surface'],
            })}
          >
            <Text variant="row-meta">{t('mobile.categories.slot.none')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}