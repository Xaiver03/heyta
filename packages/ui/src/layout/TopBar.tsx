/**
 * 顶部栏（共享 · 产品组件）
 * ==========================
 *
 * 一屏的顶部导航由同一套**槽位**拼成，不再各屏各写一份：
 *   `leading`（返回 / 汉堡）｜ `title`（可点，常规或大标题）｜ `titleAccessory`（如展开箭头）
 *   ｜ `actions`（最高频的图标动作）｜ `overflow`（⋮ 溢出菜单）
 *
 * 🔴 只管**摆位**，不管**放什么**：图标按钮、菜单都以**节点**从宿主传入。
 *   这样移动端（lucide 图标集）、Web（DOM 控件）各用自己的控件，
 *   而"标题占多少、动作排在哪、溢出在哪"这份**摆位契约**只有一份。
 *   安全区（inset）、底色这些**平台差异**留在宿主外壳 —— 见 `apps/mobile` 的 `AppBar` 包装。
 *
 * 规范出处：`docs/agents/screen-chrome.md`（一屏顶栏 ≤3 枚动作）与
 * `docs/plans/ticktick-layout-parity.md` §1（顶栏职能：大标题 + 视图切换 + 动作 + ⋮）。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useHeytaText, useHeytaTokens } from '../theme.js';

export interface TopBarProps {
  /** 前导槽：返回箭头 / 汉堡菜单。 */
  readonly leading?: React.ReactNode;
  /** 标题文字。`titleSize='large'` 时用 `screen-title` 档（页面锚点），否则 `headline`。 */
  readonly title: string;
  /** 给定时标题变成可点控件（切换视图 / 展开菜单）。 */
  readonly onTitlePress?: () => void;
  /** 标题后的装饰/提示节点，例如展开箭头。不参与无障碍名。 */
  readonly titleAccessory?: React.ReactNode;
  /** 可点标题的 testID（验收钩子）。 */
  readonly titleTestID?: string;
  /** 标题字号档。默认 `compact`（与既有 AppBar 一致）；`large` 用于根页大标题。 */
  readonly titleSize?: 'large' | 'compact';
  /** 高频图标动作（节点）。 */
  readonly actions?: React.ReactNode;
  /** 溢出「⋮」动作（节点）。 */
  readonly overflow?: React.ReactNode;
  /**
   * 分段 tab 槽（节点），渲染在标题行**下一行**。
   * 供需要「视图切换/模式切换」的屏幕复用（如日历视图档、专注计时模式）；
   * 专注页按产品口径把模式切换放页面中部，因此当前不在这里用。
   */
  readonly tabs?: React.ReactNode;
  /** 内容页在大屏上把标题行收窄到与内容同一列并居中；不传则铺满。 */
  readonly contentMaxWidth?: number;
  readonly testID?: string;
}

export function TopBar({
  leading,
  title,
  onTitlePress,
  titleAccessory,
  titleTestID = 'app-bar-title-press',
  titleSize = 'compact',
  actions,
  overflow,
  tabs,
  contentMaxWidth,
  testID,
}: TopBarProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const titleStyle = titleSize === 'large' ? text['screen-title'] : text['headline'];
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.2'],
          paddingHorizontal: tokens['screen.gutter'],
          height: tokens['nav.app-bar-height'],
        },
        titleWrap: { flex: 1, minWidth: 0 },
        titleButton: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.1'] },
        tabRow: { paddingHorizontal: tokens['screen.gutter'], paddingBottom: tokens['space.2'] },
      }),
    [tokens],
  );

  const maxWidthStyle =
    contentMaxWidth === undefined
      ? null
      : { width: '100%' as const, maxWidth: contentMaxWidth, alignSelf: 'center' as const };

  return (
    <View style={maxWidthStyle} testID={testID}>
      <View style={styles.row}>
        {leading}
        <View style={styles.titleWrap}>
          {onTitlePress === undefined ? (
            <Text style={[titleStyle, { color: tokens['color.foreground'] }]} numberOfLines={1}>
              {title}
            </Text>
          ) : (
            <Pressable
              onPress={onTitlePress}
              accessibilityRole="button"
              accessibilityLabel={title}
              testID={titleTestID}
              style={styles.titleButton}
            >
              <Text
                style={[titleStyle, { color: tokens['color.foreground'] }]}
                numberOfLines={1}
              >
                {title}
              </Text>
              {titleAccessory}
            </Pressable>
          )}
        </View>
        {actions}
        {overflow}
      </View>
      {tabs === undefined ? null : <View style={styles.tabRow}>{tabs}</View>}
    </View>
  );
}
