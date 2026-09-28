/**
 * 「分类时长」—— 移动端的分类视图
 * ==================================
 *
 * 🔴 M3 第三刀之后，这一屏**只剩接线**。
 *
 * 泳道（色块 + 槽位号 + 名字 + 来源 + 总时长 + 十二格）、空态 / 区间 /
 * 未归类 / 未设色提示，全部由 `@heyta/ui` 的 `CategoryReportView` 渲染 ——
 * 与 Web 端是**同一份实现**。这一屏只回答移动端自己的三个问题：
 *
 *   1. 报告从哪来 → `@heyta/app-host` 的 `categoryReportFromState`
 *      （归因链、窗口、软删除、缺省 `actualMs` 全在 `@heyta/domain` 的
 *      `computeCategoryReport` 里）；
 *   2. 取色放在哪 → 本屏每一行的色块（见下）；
 *   3. 周边挂什么 → 顶栏标题（`Screen` 给）与色板（`renderLaneExtra`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 三条必须活着的约束（与 Web 端同源，现在由共享层落实）
 *
 * 1. 🔴 **不做排行、不做评价。** 行序按总时长降序 —— 那是**读数**顺序，
 *    不是"第一名"。界面上没有"最多 / 最少 / 最差 / 失衡"，颜色是**身份**。
 * 2. 🔴 **不许只用颜色表达信息。** 每一行都有槽位号、名字、来源、总时长；
 *    格子是装饰。
 * 3. 🔴 **口径只有一份。** 这一屏**一行判断都没有** —— 如果这里再算一次
 *    "这周多少分钟"，它迟早和 Web 端、和周复盘对不上账。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 为什么取色放在这一屏（而不是照搬 Web 的清单编辑器）
 *
 * Web 端把调色板放在清单/习惯旁边（`ColorSlotPicker`）。移动端放在
 * **看得见归类结果的地方**：用户是在"这一行是什么颜色"的语境里做选择的，
 * 而这一屏此刻就是那个语境。两侧调的是**同一个共享动作**
 * （`ProjectActions.setProjectColor` / `HabitActions.setHabitColor`），
 * 语义没有第二份。
 *
 * ⚠️ 色板因此是移动端**特有**的一段（web 的取色控件是另一个独立控件），
 * 它通过共享层的 `renderLaneExtra` 插槽挂进每一行 —— 而不是把共享的
 * 泳道复制一份。
 *
 * ## 移动端刻意**没有**的东西
 *
 * - **不做那个堆叠柱状图**（Web 有）：手机上 12 根柱子和 12 格泳道抢同一块
 *   宽度，而泳道是主、柱子是辅 —— 宁可只留主视图。共享层用
 *   `showWeeklyBars` 表达这件事，不替宿主判断。
 * ⚠️ 这里原先写着"移动端到现在没有习惯界面，'给习惯记时长'要靠 Web"——
 * **那句已经过期**：M3 第七刀（habits）给移动端加上了习惯屏
 *（`screens/HabitsScreen.tsx`，入口在「我的」的第二层，**不加 tab**）。
 * 状态里同步过来的习惯照样出现在这一屏，现在也能在手机上看连续、打卡、设色。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppHost } from '@heyta/app-host';
import { categoryReportFromState, createHabitActions, createProjectActions } from '@heyta/app-host';
import type { CategoryReport, CategorySeries } from '@heyta/domain';
import type { CategorySlot } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { CategoryReportView } from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import { categoryReportLabels } from '../lib/category-display';
import { useToday } from '../lib/use-today';
import { useMobileSync } from '../sync/store';
import { Screen } from '../ui/kit';
import { SlotPicker } from '../ui/slot-picker';

export function CategoriesScreen(): React.JSX.Element {
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

  const labels = useMemo(
    () => ({
      ...categoryReportLabels(t),
      // 错误由共享层渲染成"落盘失败必须看得见"的那一行（旧值见文件头）。
      ...(error === undefined ? {} : { error }),
    }),
    [error, t],
  );

  return (
    // 🔴 `Screen` 负责顶栏标题、安全区与滚动 —— 这一屏只出内容。
    // 自己拼 ScrollView 的话，标题、较深的安全区、以及"键盘弹起时的
    // 可点击区域"都要重写一遍，而且会和别的屏幕长得不一样。
    <Screen title={t('mobile.categories.title')}>
      <CategoryReportView
        report={report}
        labels={labels}
        laneCard
        onSwatchPress={(row) => {
          setOpenKey((current) => (current === row.key ? null : row.key));
        }}
        isSwatchExpanded={(row) => openKey === row.key}
        renderLaneExtra={(row) =>
          openKey === row.key ? (
            <SlotPicker
              name={row.name}
              value={row.slot}
              onChange={(slot) => {
                chooseColor(row, slot);
              }}
            />
          ) : null
        }
        testID="category-report"
      />
    </Screen>
  );
}
