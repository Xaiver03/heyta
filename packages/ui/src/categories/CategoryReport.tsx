/**
 * 分类时长（共享视图）
 * ======================
 *
 * M3 第三刀的主角：**"一行一个来源、一行十二格"这件事只有这一个实现。**
 * 泳道（色块 + 槽位号 + 名字 + 来源 + 总时长 + 强度格子）、可选的周柱状图、
 * 空态 / 窗口区间 / 未归类 / 未设色提示，全部由这里渲染；
 * web 与 mobile 只决定"把它放在页面的哪里"、注入文案，以及挂哪些各端特有的东西。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 迁之前两端各有一份（web `CategoryBreakdown.tsx` 220 行 + `copy.ts`；
 * mobile `CategoriesScreen.tsx` 的 `Lane`）。它们读的是**同一份**
 * `CategoryReport`，却各自回答"什么算空""未设色用什么颜色""格子几档"——
 * 而两份答案之间的差异**不会让任何测试变红**，只会让同一个 5400000ms
 * 在一端说「1 小时 30 分」、另一端说「90 分钟」。
 * 这正是 §1.4「一个列表 + 类型化 cell」在分类这一项上的对应物。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList.tsx` / `FocusPanel.tsx` 同一个理由（见那两处的文件头）：
 * i18n 包曾自己带一份 React，让 Android 产物出现两个 React 实例，
 * 仓库里因此有 `check:mobile-bundle` 盯着。共享层是四端共用的，
 * 它一旦拖进 React，四个端会同时中招。所以 `labels` 里的每一项都是函数
 * （文案依赖行内容），模板留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `Pressable` 在 `react-native-web` 上都有等价实现；
 * `<div>` 在 iOS 上不存在。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 格子 / 柱子的悬停提示：**搬过来了，但换了一条路**（`cellTooltip`）
 *
 * 迁之前 web 的每一格与每一根柱子都有 `title=…`（悬停给出**确切数字**：
 * 深浅只能看个大概，精确值只有那里能看到）。第一版迁移把它丢了，
 * 当时的结论是"共享层装不下"。**那个结论只对了一半**，这里记下完整路径，
 * 免得下一个人再走一遍弯路。
 *
 * 实测（2026-09-28，`react-dom/server.renderToStaticMarkup` + 真 RNW）：
 *   · `react-native-web` 的 `View` / `Text` 用**白名单**
 *     （`modules/forwardedProps`）挑属性，`title` **不在名单里** —— 透传被丢弃。
 *     ✅ 但 `dataSet` **在**名单里：`dataSet={{ cellTitle: '1 小时 30 分' }}`
 *     实测产出 `data-cell-title="1 小时 30 分"`（探针输出见 PR 说明）。
 *   · 第一版的判断"`dataSet` 只产出 `data-*`，浏览器不当它是提示"——
 *     **这半句是对的，但结论下早了**：`data-*` 本身不是提示，
 *     **`data-*` + 宿主 CSS 的 `::after { content: attr(…) }` 才是**。
 *     提示是**外观**，归宿主外壳（L3）；共享层只负责**把确切数字放进 DOM**。
 *
 * 所以接口是 `cellTooltip?: (ms) => string`：给了就写进 `data-cell-title`，
 * 不给（mobile —— 没有鼠标）就**完全不产出这个属性**。
 * web 侧的 CSS 在 `apps/web/src/styles/app.css` 的 `[data-cell-title]` 规则里。
 *
 * 为什么不用另外两条路：
 *   · **改 RNW 白名单加 `title`** —— 要 patch 第三方依赖（`pnpm patch`），
 *     为了一个提示不值得，而且依赖门禁要跟着动；
 *   · **`renderCell` 插槽让 web 自己画一格** —— 把"一行十二格"的骨架交回 L4，
 *     与本次迁移的方向相反。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 允许端差异的地方（逐条列出，别默默加）
 *
 *   · `showWeeklyBars` —— web 有堆叠柱状图，mobile 刻意没有（12 根柱子和
 *     12 格泳道抢同一块宽度，宁可只留主视图）。理由在 mobile 屏的文件头。
 *   · `laneCard` —— mobile 的每一行是带边框的卡片（一屏里靠边框分段），
 *     web 靠间距分段。这是**容器差异**，不是外观偏好。
 *   · `onSwatchPress` / `renderLaneExtra` —— mobile 的取色入口在这一屏
 *     每一行里（点色块展开色板）；web 的取色在清单/习惯编辑器旁
 *     （`ColorSlotPicker`，那是另一个独立控件，没有第二份实现）。
 *
 * 这些都由**宿主**给，共享层不替它们判断。
 */

import React, { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
  type ViewProps,
} from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import {
  intensityLevel,
  type CategoryKind,
  type CategoryReport,
  type CategorySeries,
  type CategorySlot,
} from '@heyta/domain';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  categoryBarSegments,
  categoryHeatToken,
  categorySlotToken,
  hasUnsetCategorySlot,
  isEmptyCategoryReport,
} from './model.js';

/**
 * 面板全部文案，**每一项都由宿主注入**（见文件头）。
 *
 * 函数而不是字符串的那几项：文案依赖行内容（名字、时长、来源），
 * 模板必须留在有 i18n 的那一侧。
 */
export interface CategoryReportLabels {
  /** 顶部说明（这一页在统计什么）。 */
  readonly note: string;
  /** 完全没有记录时的一句话。 */
  readonly empty: string;
  /** 窗口区间，例如「2026-07-06 至 2026-09-27」。 */
  readonly range: (start: string, end: string) => string;
  /** 未归类时长那一句（`duration` 已格式化）。 */
  readonly unassigned: (duration: string) => string;
  /** 有行没设色时的那句可发现提示（不是追责）。 */
  readonly hintUnset: string;
  /** 来源（清单 / 习惯）。 */
  readonly kind: (kind: CategoryKind) => string;
  /** 槽位号的**文字**（`undefined` → 「无」）。色觉障碍用户靠它认行。 */
  readonly slot: (slot: CategorySlot | undefined) => string;
  /** 把毫秒说成人话（走 `t()`，所以两种语言各说各的）。 */
  readonly duration: (ms: number) => string;
  /** 整行给屏幕阅读器的那句**文字事实**。 */
  readonly laneA11y: (row: CategorySeries) => string;
  /** 色块按钮的无障碍名。**只在 `onSwatchPress` 给了时才用得到**。 */
  readonly swatchA11y?: (row: CategorySeries) => string;
  /** 柱状图的无障碍总说明。`showWeeklyBars` 时应给（`role="img"` 要名字）。 */
  readonly barsA11y?: string;
  /** 落盘失败（mobile 有；web 没有）。 */
  readonly error?: string;
}

export interface CategoryReportViewProps {
  /** 报告。`null` = 宿主还没读出来（mobile 冷启动时会有这一态），此时只出说明文字。 */
  readonly report: CategoryReport | null;
  readonly labels: CategoryReportLabels;
  /** 是否画堆叠柱状图（web 有，mobile 刻意没有）。 */
  readonly showWeeklyBars?: boolean;
  /** 每行画成带边框的卡片（mobile；web 靠间距分段）。 */
  readonly laneCard?: boolean;
  /** 行首色块可点（mobile 展开色板）。给了就渲染成 44 触控按钮。 */
  readonly onSwatchPress?: (row: CategorySeries) => void;
  /** 该行的色板是否展开（只在 `onSwatchPress` 给了时才有意义）。 */
  readonly isSwatchExpanded?: (row: CategorySeries) => boolean;
  /** 每行下方的宿主特有内容（mobile 的色板）。 */
  readonly renderLaneExtra?: (row: CategorySeries) => React.ReactNode;
  /**
   * 每格 / 每段柱子的**悬停提示**（web 给，mobile 不给 —— 没有鼠标）。
   *
   * 给了就把 `cellTooltip(ms)` 写进 DOM 的 `data-cell-title`，由**宿主 CSS**
   * 渲染成提示泡；不给就完全不产出这个属性。完整理由与实测见文件头。
   *
   * ⚠️ 它**不是**无障碍名：读屏读的是整行那一句 `laneA11y`（只念一次）。
   * 这个属性只给**鼠标**，两者刻意不同 —— 把确切数字塞进无障碍名会把
   * "念一次"变成"念十三次"（与 `dida-view-unification.md` §1.6 的取向冲突）。
   */
  readonly cellTooltip?: (ms: number) => string;
  readonly testID?: string;
}

/**
 * 把提示文案变成 `data-cell-title` 属性（不给就返回空对象）。
 *
 * ⚠️ **为什么必须 cast**：`dataSet` 是 **react-native-web 专有**的 prop
 * （在它的 `modules/forwardedProps` 白名单里，产出 `data-*` 属性），
 * `react-native` 自己的 `ViewProps` 里**没有**它 —— 不 cast 过不了 TS。
 *
 * 运行时为什么安全：
 *   · 原生端会把它当成**未知 prop 忽略**（`dataSet` 不在 native view config 里，
 *     不改行为、不崩）；
 *   · 而且**只有 web 宿主才传 `cellTooltip`**，原生根本走不到这一支。
 */
function dataCellTitle(value: string | undefined): ViewProps {
  return value === undefined
    ? {}
    : ({ dataSet: { cellTitle: value } } as unknown as ViewProps);
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    root: {
      gap: tokens['space.3'],
    },
    /** 泳道们。 */
    lanes: {
      gap: tokens['space.3'],
    },
    /** 一行（web 的容器形态）：色块行 + 格子行。 */
    lane: {
      gap: tokens['space.1'],
    },
    /** 一行（mobile 的卡片形态）。 */
    laneCard: {
      gap: tokens['space.2'],
      padding: tokens['space.3'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.surface'],
    },
    laneHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    /** 色块只编码"是谁"；它旁边**永远**有槽位号与名字。 */
    swatch: {
      width: tokens['space.3'],
      height: tokens['space.3'],
      borderRadius: tokens['radius.sm'],
      flexShrink: 0,
    },
    /** 可点时的 44 触控区（mobile）：色块画在它里面。 */
    swatchButton: {
      minWidth: tokens['touch-target.min'],
      minHeight: tokens['touch-target.min'],
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokens['radius.md'],
    },
    /** 不参与伸缩的槽位（号码 / 来源 / 时长）。 */
    fixed: {
      flexShrink: 0,
    },
    /** 名字吃掉所有弹性宽度，并在过长时省略。 */
    name: {
      flex: 1,
    },
    /** 十二格。跨行共享同一个峰值，所以两行同样深浅 = 同样多。 */
    cells: {
      flexDirection: 'row',
      gap: tokens['space.1'],
    },
    cell: {
      flex: 1,
      height: tokens['space.3'],
      borderRadius: tokens['radius.sm'],
    },
    bars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: tokens['space.1'],
      paddingTop: tokens['space.2'],
    },
    bar: {
      flex: 1,
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    barTrack: {
      width: '100%',
      height: tokens['space.12'],
      /**
       * `column-reverse` 下 DOM 里的第一个孩子落在**底部**。
       * 🔴 所以这里**不要**再 `reverse()` 段数组：加了它就把最小的那段
       * 放到基线，与"段序 = 行序"正好相反。段序那一半由
       * `packages/ui/tests/category-model.spec.ts` 钉住；
       * "底部"那一半是 CSS 语义，jsdom 不排版，没有自动检查。
       */
      flexDirection: 'column-reverse',
      overflow: 'hidden',
      borderRadius: tokens['radius.sm'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.surface'],
    },
    barSegment: {
      width: '100%',
      flexShrink: 0,
    },
    /** 未归类那一句：与上面的读数**划开**，因为它是另一种事实。 */
    unassigned: {
      paddingTop: tokens['space.2'],
      borderTopWidth: tokens['border-width.thin'],
      borderTopColor: tokens['color.border'],
    },
  });
}

type CategoryStyles = ReturnType<typeof makeStyles>;

export function CategoryReportView({
  report,
  labels,
  showWeeklyBars,
  laneCard,
  onSwatchPress,
  isSwatchExpanded,
  renderLaneExtra,
  cellTooltip,
  testID,
}: CategoryReportViewProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const muted = tokens['color.foreground-muted'];
  const subtle = tokens['color.foreground-subtle'];

  return (
    <View style={styles.root} testID={testID}>
      {/*
        🔴 `testID="category-note"` 是**判据的落点**，不是可有可无的钩子。

        e2e（`categories.spec.ts`）用这条说明文字的颜色钉住三件事：
        变量名没写错、`tokens.css` 真的被引入、暗/亮色解析出的是**真颜色**。
        迁移前它挂在 web 手写的 `.ht-categories__note` 上；换装共享组件后
        **那个类名没了、新实现也没给任何钩子** ⇒ 那条判据**失去了落点**
        （症状是 e2e 在 `locator.evaluate` 上超时，而不是"颜色不对"）。
        ⇒ 共享组件**必须**给它一个稳定的 testID，否则"换个实现"就等于"删掉判据"。
      */}
      <Text testID="category-note" style={[text.caption, { color: muted }]}>
        {labels.note}
      </Text>

      {/* 落盘失败必须看得见（mobile 有；web 没有这个态）。 */}
      {labels.error === undefined ? null : (
        <Text style={[text['row-meta'], { color: tokens['color.danger'] }]}>{labels.error}</Text>
      )}

      {report === null ? null : isEmptyCategoryReport(report) ? (
        <Text style={[text['row-meta'], { color: muted }]}>{labels.empty}</Text>
      ) : (
        <>
          <Text testID="category-range" style={[text.caption, { color: subtle }]}>
            {labels.range(report.weeks[0]?.start ?? '', report.weeks.at(-1)?.end ?? '')}
          </Text>

          <View style={styles.lanes}>
            {report.series.map((row) => (
              <CategoryLane
                key={row.key}
                row={row}
                report={report}
                labels={labels}
                styles={styles}
                card={laneCard === true}
                onSwatchPress={onSwatchPress}
                expanded={isSwatchExpanded?.(row) === true}
                renderExtra={renderLaneExtra}
                tooltip={cellTooltip}
              />
            ))}
          </View>

          {showWeeklyBars === true && report.peakWeeklyMs > 0 && (
            <WeeklyBars
              report={report}
              labels={labels}
              styles={styles}
              tooltip={cellTooltip}
            />
          )}

          {/* 没归到任何类别的时间**如实说出来**。它的正确归宿是
              "给这条清单起个名 / 用清单组织任务"，而不是消失在总数里。 */}
          {report.unassignedMs > 0 && (
            <Text testID="category-unassigned" style={[text.caption, styles.unassigned, { color: muted }]}>
              {labels.unassigned(labels.duration(report.unassignedMs))}
            </Text>
          )}

          {/* 有行但一行都没设色：这是**可发现的入口**，不是错误。 */}
          {hasUnsetCategorySlot(report) && (
            <Text style={[text.caption, { color: muted }]}>{labels.hintUnset}</Text>
          )}
        </>
      )}
    </View>
  );
}

/** 一行：色块 + 槽位号 + 名字 + 来源 + 总时长，下面十二格。 */
function CategoryLane({
  row,
  report,
  labels,
  styles,
  card,
  onSwatchPress,
  expanded,
  renderExtra,
  tooltip,
}: {
  readonly row: CategorySeries;
  readonly report: CategoryReport;
  readonly labels: CategoryReportLabels;
  readonly styles: CategoryStyles;
  readonly card: boolean;
  readonly onSwatchPress?: ((row: CategorySeries) => void) | undefined;
  readonly expanded: boolean;
  readonly renderExtra?: ((row: CategorySeries) => React.ReactNode) | undefined;
  readonly tooltip?: ((ms: number) => string) | undefined;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const color = tokens[categorySlotToken(row.slot)];

  const swatch = (
    <View testID="category-swatch" aria-hidden style={[styles.swatch, { backgroundColor: color }]} />
  );

  return (
    // 🔴 整行的**文字事实**（名字 / 来源 / 总时长）挂在**格子那一段**上，
    // 并且显式 `accessible`：原生端只有 `accessible` 的节点才会被读屏当成
    // 一个元素（光有 `aria-label` 会被忽略），而格子本身是装饰。
    // web 侧 `role="group"` + `aria-label` 给出同一个语义。
    <View testID="category-lane" style={card ? styles.laneCard : styles.lane}>
      <View style={styles.laneHead}>
        {/* 🔴 色块是按钮时它是**可点、可聚焦、有名字**的；
            而槽位号是**文字**（下一个），不是颜色 —— 色觉障碍用户靠它认行。 */}
        {onSwatchPress === undefined ? (
          swatch
        ) : (
          <Pressable
            onPress={() => {
              onSwatchPress(row);
            }}
            role="button"
            aria-expanded={expanded}
            aria-label={labels.swatchA11y?.(row)}
            style={({ pressed }) => [
              styles.swatchButton,
              { backgroundColor: pressed ? tokens['color.surface-sunken'] : 'transparent' },
            ]}
          >
            {swatch}
          </Pressable>
        )}

        <Text
          testID="category-lane-slot"
          style={[text.caption, styles.fixed, { color: tokens['color.foreground-subtle'] }]}
        >
          {labels.slot(row.slot)}
        </Text>
        <Text
          testID="category-lane-name"
          numberOfLines={1}
          style={[text['row-title'], styles.name, { color: tokens['color.foreground'] }]}
        >
          {row.name}
        </Text>
        <Text style={[text.caption, styles.fixed, { color: tokens['color.foreground-subtle'] }]}>
          {labels.kind(row.kind)}
        </Text>
        <Text style={[text['numeric-body'], styles.fixed, { color: tokens['color.foreground'] }]}>
          {labels.duration(row.totalMs)}
        </Text>
      </View>

      {/*
        格子是**装饰**（外侧 `aria-hidden`）：深浅只能看个大概。
        读到的那句话在外层这一格上 —— `accessible` 让原生端把它当成**一个**
        元素、只念一次"深度工作（清单），共 5 小时 20 分"，而不是念十二个格子。
      */}
      <View
        testID="category-cells"
        accessible
        role="group"
        aria-label={labels.laneA11y(row)}
      >
        <View
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.cells}
        >
          {row.weeklyMs.map((ms, index) => {
            // 强度分档是**跨行共享**的（同一个 peak）—— 两行同样深浅就代表
            // 同样多，这正是"行与行可以比一比节奏"的前提。
            const level = intensityLevel(ms, report.peakWeeklyMs);
            return (
              <View
                key={report.weeks[index]?.start ?? String(index)}
                testID={`category-cell-${String(level)}`}
                {...dataCellTitle(tooltip?.(ms))}
                style={[styles.cell, { backgroundColor: tokens[categoryHeatToken(level)] }]}
              />
            );
          })}
        </View>
      </View>

      {renderExtra?.(row)}
    </View>
  );
}

/**
 * 一周一根柱，按类别堆叠（辅形状）。
 *
 * 它比泳道图**快**（一眼看出"最近几周整体在动"），但看不出趋势的细节 ——
 * 所以它是辅，泳道图是主。柱子高度按**窗口内最高的一周**归一，
 * 与格子的强度分档共用同一个峰值，两处不会出现两种"最深"。
 */
function WeeklyBars({
  report,
  labels,
  styles,
  tooltip,
}: {
  readonly report: CategoryReport;
  readonly labels: CategoryReportLabels;
  readonly styles: CategoryStyles;
  readonly tooltip?: ((ms: number) => string) | undefined;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  return (
    // `role="img"` + 一个总说明：柱状图对屏幕阅读器是**一张图**，不是一堆节点。
    // 每一段的确切数字由上面的泳道图负责（那里是文字）。
    <View style={styles.bars} role="img" aria-label={labels.barsA11y}>
      {report.weeks.map((week, index) => (
        <View key={week.start} style={styles.bar}>
          <View testID="category-bar-track" style={styles.barTrack}>
            {/* 段序 = 行序，跨周固定（见 `categoryBarSegments`）。 */}
            {categoryBarSegments(report, index).map((segment) => {
              // ⚠️ 先算成 number 再插值：RN 的 `DimensionValue` 接受的是
              // `` `${number}%` ``，`String(x)` 会把它拓宽成 `` `${string}%` ``
              // 而被类型拒绝（`check:design` 不管这个，是 TS 本身拦下的）。
              const height: DimensionValue = `${segment.ratio * 100}%`;
              return (
                <View
                  key={segment.key}
                  testID="category-bar-segment"
                  {...dataCellTitle(tooltip?.(segment.ms))}
                  style={[styles.barSegment, { backgroundColor: tokens[segment.token], height }]}
                />
              );
            })}
          </View>
          <Text style={[text.caption, { color: tokens['color.foreground-subtle'] }]}>
            {week.start.slice(5)}
          </Text>
        </View>
      ))}
    </View>
  );
}
