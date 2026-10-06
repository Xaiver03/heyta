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
      alignSelf: 'flex-start',
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
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.sm'],
    },
    tabActive: {
      backgroundColor: tokens['color.primary'],
    },
    label: {
      color: tokens['color.foreground-muted'],
    },
    labelActive: {
      color: tokens['color.on-primary'],
    },
  });
}
