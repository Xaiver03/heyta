/**
 * 底部标签栏
 * ==========
 *
 * 这是应用之前**完全缺失**的东西 —— 在此之前每个屏幕各自摆元素，没有导航框架。
 *
 * 🔴 设计依据（三条来自 Apple《Designing Fluid Interfaces》/《Materials》）：
 *
 *   1. **按下即反馈，不是松开才反馈。** 用 `Pressable` 的 `pressed` 状态在
 *      onPressIn 阶段就变样式。等 onPress 才变会让界面"发木" —— 反馈延迟
 *      超过 ~100ms 就直接读成卡顿。因此用 `duration.press` 而不是 `normal`。
 *
 *   2. **选中态不用实心图标。** Lucide 是线性图标集，把它描边加粗/填充
 *      会得到与未选中的**另一种字形风格**。所以选中态由
 *      **颜色 + 顶部指示条**两件事共同表达，字形始终一致。
 *
 *   3. **标签栏是"结构区"不是"内容区"。** 它不随内容滚动，且必须有上边框
 *      把自己和内容分开 —— 扁平风格里边界靠边框而非阴影。
 *
 * ⚠️ **没有做半透明材质（material.chrome-tint）。**
 * 真材质需要真正的模糊（`backdrop-filter` / `UIVisualEffectView`），
 * 而 RN 没有内建模糊。用 72% 白**不模糊**地盖在滚动文字上 = 文字糊成一片，
 * 比不透明更糟。所以这里用不透明的 `color.surface`：
 * **宁可诚实地不透明，不要假装半透明而牺牲可读性。**
 * 要上真材质，需先引入模糊库并过完两道门（可维护性 + 许可证）。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MessageKey } from '@heyta/i18n';
import { useI18n } from '@heyta/i18n';
import { useText, useTheme, useTokens } from '../theme';
import { Badge, Text } from '../ui/kit';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';

/**
 * 四个 tab。顺序即显示顺序，也是产品结构。
 *
 * ⚠️ 这里存的是**词条 key 不是文案**：模块级拿不到 `t`，而把中文写在这里
 * 就是硬编码 —— 迁移模式下门禁会直接判红（这正是"数据数组里的文案"那个盲区，
 * 本仓库明确不许利用它）。
 */
export const TABS = [
  { key: 'tasks', labelKey: 'mobile.tab.tasks', icon: 'tab.tasks' },
  { key: 'calendar', labelKey: 'mobile.tab.calendar', icon: 'tab.calendar' },
  { key: 'focus', labelKey: 'mobile.tab.focus', icon: 'tab.focus' },
  { key: 'profile', labelKey: 'mobile.tab.profile', icon: 'tab.profile' },
] as const satisfies ReadonlyArray<{ key: string; labelKey: MessageKey; icon: IconName }>;

export type TabKey = (typeof TABS)[number]['key'];

export interface TabBarProps {
  active: TabKey;
  onChange: (key: TabKey) => void;
  /**
   * 各 tab 的角标计数。
   *
   * 🔴 **不传就等于没有角标**，而不是"传 0" —— 把"没有待办"也渲染成一个
   * 写着 0 的红点，会让所有 tab 常年顶着装饰性噪音，真正的数字反而看不见了。
   * `Badge` 自己也把 `0` 当作不渲染。
   */
  badges?: Partial<Record<TabKey, number>>;
}

export function TabBar({ active, onChange, badges }: TabBarProps): React.JSX.Element {
  const tokens = useTokens();
  const text = useText();
  const { reducedMotion } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        barOuter: {
          // 🔴 安全区 padding 放在**外层**，不放进内容高度里。
          // 放进去的后果是内容在"扣掉底部之后"的区域里垂直居中，
          // 图标被顶到最上面 —— 实测 52 − 8 = 44 的内容区装 42 的内容，
          // 上下各剩 1px，看着像完全没有留白。
          paddingBottom: Math.max(insets.bottom, tokens['nav.safe-bottom-min']),
          backgroundColor: tokens['color.surface'],
          borderTopWidth: tokens['border-width.thin'],
          borderTopColor: tokens['color.border'],
        },
        barRow: {
          flexDirection: 'row',
          // 这一层才是"标签栏高度"，内容在其中居中。
          height: tokens['nav.tab-bar-height'],
        },
        item: {
          flex: 1,
          minWidth: tokens['nav.tab-item-min-width'],
          // 🔴 触控下限 44：标签栏是最高频的交互面，
          // 这一条不是"最好满足"，是不可妥协（WCAG 2.5.5）。
          minHeight: tokens['touch-target.min'],
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens['space.1'],
        },
        indicator: {
          position: 'absolute',
          // 🔴 不能让出 0：贴到顶边会与标签栏的**上边框线重叠**，
          // 两者糊成一条，看起来像渲染错位。
          top: tokens['nav.tab-indicator-inset'],
          width: tokens['nav.tab-indicator-width'],
          height: tokens['nav.tab-indicator-height'],
          borderBottomLeftRadius: tokens['radius.full'],
          borderBottomRightRadius: tokens['radius.full'],
          backgroundColor: tokens['color.primary'],
        },
        // 指示条只在选中时占位，未选中时用同尺寸的透明占位 ——
        // 否则选中切换时整个标签会上下跳动（布局位移）。
        indicatorSpacer: {
          position: 'absolute',
          top: tokens['nav.tab-indicator-inset'],
          width: tokens['nav.tab-indicator-width'],
          height: tokens['nav.tab-indicator-height'],
          backgroundColor: 'transparent',
        },
        // 图标容器：角标靠它定位。RN 里 position 默认就是 relative，
        // 但这个 View 是角标能压在图标右上角的**唯一**锚点。
        iconWrap: {
          width: tokens['nav.tab-icon-size'],
          height: tokens['nav.tab-icon-size'],
          alignItems: 'center',
          justifyContent: 'center',
        },
        badge: {
          position: 'absolute',
          // 角标中心压在图标右上角的**顶点**上（Apple HIG 的角标位置），
          // 而不是完全在图标外面 —— 后者会让标签栏显得拥挤。
          top: -tokens['space.1'],
          right: -tokens['space.2'],
        },
      }),
    [tokens, insets.bottom],
  );

  return (
    <View style={styles.barOuter} accessibilityRole="tablist">
      <View style={styles.barRow}>
        {TABS.map((tab) => {
          const selected = tab.key === active;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={t(tab.labelKey)}
              style={({ pressed }) => [
                styles.item,
                // 按下反馈：整块变暗，用叠加色而不是改每个 children 的颜色 ——
                // 后者要动图标和文字两处，迟早只改一处。
                pressed && !reducedMotion
                  ? { backgroundColor: tokens['color.hover'] }
                  : null,
              ]}
            >
              <View style={selected ? styles.indicator : styles.indicatorSpacer} />
              <View style={styles.iconWrap}>
                <Icon
                  name={tab.icon}
                  size="tab"
                  color={selected ? tokens['color.primary'] : tokens['color.foreground-muted']}
                />
                {badges?.[tab.key] !== undefined ? (
                  <View style={styles.badge}>
                    <Badge count={badges[tab.key]} />
                  </View>
                ) : null}
              </View>
              <Text
                style={[
                  text['tab-label'],
                  { color: selected ? tokens['color.primary'] : tokens['color.foreground-muted'] },
                ]}
              >
                {t(tab.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}