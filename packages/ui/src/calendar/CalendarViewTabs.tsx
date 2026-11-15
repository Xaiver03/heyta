/**
 * `CalendarViewTabs` —— 日历档位入口（月 / 周 / 日）
 * ==================================================
 *
 * 为什么要有这个组件：**移动端进不去周档和日档。**
 * 共享板 `CalendarBoard` 两端是同一份实现，可档位入口只有 Web 有（那里是页头一个
 * `<select>`）。`apps/mobile` 连 `view` 都不传 ⇒ 手机上永远只有月档 ——
 * 于是"批三/批四已交付"这句话在移动端其实只兑现了一半。
 * 登记在 `docs/plans/ui-review-fill-zh-timeline.md` §9.4「批三·补」。
 *
 * ## 🔴 为什么是**一排按钮**而不是弹层
 *
 * RN 侧没有 `<select>`。要做下拉就得自绘弹层，而弹层要一并处理三件本仓为它记过账的事：
 * 焦点与 Esc（§7 #80：RN-web 的 `TextInput` 在 keydown 里无条件 `stopPropagation()`，
 * 冒泡阶段的全局键盘监听在焦点落进输入框时永远收不到）、暗色（必须实际切换查看）、
 * 以及"面板整块在视口里"那类定位判据（§9.11 的臂 S）。
 * 三个档位一排放得下，**分段控件因此是更小的正确解**，不是偷懒的近似。
 *
 * ## 🔴 只放"真的能用"的档位
 *
 * `options` 由宿主给，而这里**照它渲染、不自己补全**。理由与 Web 那个下拉同一条
 * （§9.3 拒绝摆"点了没反应的菜单项"）：不许把没有实现的档位提前画出来。
 * 这一条后来被两处按顺序兑现了 —— 日历那一侧先写出 `CalendarYearBoard` 才把 `year`
 * 放进 `CALENDAR_VIEW_ORDER`，习惯那一侧先有 `HabitYearBoard` 才由 `HabitTrendBoard`
 * 给出 `['month','year']`。**先有实现再进 `options`**，反过来就是那条死胡同。
 * 同理，`options` 少于一项时整组**不渲染** —— 一个只有一个选项的切换器
 * 不是导航，是噪音。
 *
 * ## 无障碍属性为什么写成平铺 `aria-*`
 *
 * 共享层是四个端共用的那一份，而 react-native-web 0.21 会把**对象形态**的
 * `accessibilityState` 整个丢掉（`check:rn-aria` 断言 B 拦的就是这个）。
 * 所以选中态走 `aria-selected`，与 `CalendarBoard` 的月格同一写法。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HeytaNativeTokens } from '@heyta/design-system';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import type { CalendarViewKind } from './model.js';

export interface CalendarViewTabsLabels {
  /** 整组的名字（读屏用户先听到"视图"，再听到三个选项）。 */
  group: string;
  /** 档位名。由宿主从 i18n 取 —— 共享层不许 `import '@heyta/i18n'`。 */
  name: (view: CalendarViewKind) => string;
}

export interface CalendarViewTabsProps {
  view: CalendarViewKind;
  /** 这个宿主**真的能切过去**的档位。顺序就是渲染顺序。 */
  options: readonly CalendarViewKind[];
  onViewChange: (view: CalendarViewKind) => void;
  labels: CalendarViewTabsLabels;
  testID?: string;
}

export function CalendarViewTabs({
  view,
  options,
  onViewChange,
  labels,
  testID = 'calendar-view-tabs',
}: CalendarViewTabsProps): React.JSX.Element | null {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  if (options.length < 2) return null;

  return (
    <View
      style={styles.row}
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={labels.group}
    >
      {options.map((kind) => {
        const isSelected = kind === view;
        return (
          <Pressable
            key={kind}
            onPress={() => onViewChange(kind)}
            accessibilityRole="tab"
            testID={`${testID}-${kind}`}
            /* 🔴 平铺 `aria-selected`，不用对象形态（见文件头）。 */
            aria-selected={isSelected}
            style={[styles.tab, isSelected ? styles.tabActive : null]}
          >
            {/* 文本节点就是可及名 —— 不再叠 `accessibilityLabel`，
                否则读屏念的是一套、眼睛看的是另一套。 */}
            <Text
              style={[
                text['tab-label'],
                isSelected ? styles.labelActive : styles.label,
              ]}
            >
              {labels.name(kind)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      /** 四个 tab 均分宽度但**不**拉伸高度（`flex: 1` 会让选中块撑满整条）。 */
      alignItems: 'center',
      /*
       * 🔴 2026-11-15：`flex-start` → `stretch`，并让四个 tab 均分整行。
       *
       * 原来是 `alignSelf: 'flex-start'` —— 整组只占内容宽，挤在左边，
       * 右边留出一大片空白（真机截图里四个 tab 只占屏宽的一半）。
       * 而它下面紧跟着的月历网格是**整宽**的，两个块的左边界一样、右边界差半屏，
       * 视觉上像"上面那块没画完"。
       */
      alignSelf: 'stretch',
      gap: tokens['space.1'],
      padding: tokens['space.1'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border-subtle'],
    },
    tab: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['touch-target.min'],
      /**
       * 🔴 `minWidth` 不是可选项。这里只有 `paddingHorizontal`（12dp）+ 单字（14dp）
       * ⇒ 实测每个 tab 只有 **105px = 35dp 宽**（真机 bounds `[63,375][168,507]`），
       * 低于 `touch-target.min` 的 44dp。四个 tab 并排时，"月/周/日/年"里最容易点错。
       * 高度一直是对的（132px = 44dp），只有宽度被漏掉了 —— 一条只写了一半的判据。
       */
      minWidth: tokens['touch-target.min'],
      /** 四个 tab 均分整行（`row` 已 `stretch`），与下面的月历网格同宽。 */
      flex: 1,
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.sm'],
    },
    /**
     * 🔴 2026-11-15：选中态从**实心主色块**改成浅底 + 主色字。
     *
     * 真机截图（日历档位）：四个 tab 各占 1/4 屏宽、44dp 高，选中那一格是一整块
     * `color.primary` 深蓝，看起来像一枚 270×44 的主按钮，而不是"当前看的是月视图"。
     * 实心主色在本仓的语义是**主操作**（`Button tone="primary"`）—— 档位切换是状态，
     * 不是操作。同屏因此出现"一个巨大的主按钮 + 三个灰字"，主次读反了。
     *
     * 浅底（`primary-subtle`）＋主色字把"选中"表达成**状态**：
     * 与 `TaskChoice` 的选中行、`Chip` 的选中态同一条规则。
     */
    tabActive: {
      backgroundColor: tokens['color.primary-subtle'],
    },
    label: {
      color: tokens['color.foreground-muted'],
    },
    labelActive: {
      color: tokens['color.primary'],
    },
  });
}
