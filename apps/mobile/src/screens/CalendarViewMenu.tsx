/**
 * 日历视图切换菜单
 * ================
 *
 * 出处：滴答清单日历页**顶栏第 2 枚图标**点开的就是这一层 ——
 * 6 个档位竖排（列表 / 年 / 月 / 周 / 3日 / 日），每行一枚图标 + 名称，
 * 当前档位右侧一个勾，其余留白。
 *
 * 我们照它的**形态**，但把入口从"再加一枚图标"换成**标题本身**
 *（Canonical 的日历重构就是把标题做成视图切换器）：
 * 标题本来就写着「2026年11月」，点它换档比让用户在右上角找一枚图标直。
 * 这样顶栏仍然是「标题 + ⋯」两枚，不用为了视图再加第三个。
 *
 * ⚠️ 与 `TopBarMenu` 的分工：那个是"多组入口 + 子菜单栈"的通用菜单；
 * 这一层只有一件事（选档），而且**当前项必须打勾** ——
 * `TopBarMenu` 的勾只长在子菜单选项上，顶层项没有这一档。
 *
 * 🔴 弹层贴哪一边由 `anchor` 决定，**跟着触发它的那颗按钮走**：
 *   左上角的标题 / 月胶囊 → `left`；右上角的「视图」图标 → `right`。
 *   写死任意一边都会出现"点右上角、卡片却出在左边"（或反过来）的错位。
 */

import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../ui/icons';
import { Text } from '../ui/kit';
import { useTokens } from '../theme';

export interface CalendarViewMenuProps {
  readonly visible: boolean;
  readonly current: string;
  readonly order: readonly string[];
  readonly labelOf: (kind: string) => string;
  /** 每一档配哪枚图标（宿主给，含移动端额外的 3日/课表）。 */
  readonly iconOf: (kind: string) => IconName;
  readonly onPick: (kind: string) => void;
  readonly onClose: () => void;
  /** 弹层贴左还是贴右（跟着触发按钮走）。默认贴左。 */
  readonly anchor?: 'left' | 'right';
  readonly anchorTop?: number;
}

export function CalendarViewMenu({
  visible,
  current,
  order,
  labelOf,
  iconOf,
  onPick,
  onClose,
  anchor = 'left',
  anchorTop = 0,
}: CalendarViewMenuProps): React.JSX.Element {
  const tokens = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        scrim: { flex: 1 },
        sheet: {
          position: 'absolute',
          top: anchorTop,
          // 贴边与触发按钮同一侧：左上角入口 → 左；右上角入口 → 右。
          ...(anchor === 'right'
            ? { right: tokens['screen.gutter'] }
            : { left: tokens['space.4'] }),
          minWidth: 180,
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
          overflow: 'hidden',
          paddingVertical: tokens['space.2'],
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.3'],
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.4'],
        },
        label: { flex: 1 },
      }),
    [anchor, anchorTop, tokens],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="" />
      <View style={styles.sheet} accessibilityViewIsModal>
        {order.map((kind) => {
          const selected = kind === current;
          return (
            <Pressable
              key={kind}
              style={styles.row}
              onPress={() => {
                onPick(kind);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`calendar-view-${kind}`}
            >
              <Icon
                name={iconOf(kind)}
                size="sm"
                color={selected ? tokens['color.primary'] : tokens['color.foreground-subtle']}
              />
              <Text style={styles.label}>{labelOf(kind)}</Text>
              {selected ? (
                <Icon name="action.keep" size="sm" color={tokens['color.primary']} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}
