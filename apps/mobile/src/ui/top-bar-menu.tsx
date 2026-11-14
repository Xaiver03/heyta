/**
 * 顶栏溢出菜单（`⋯`）—— 一层看全，进去同一形态
 * ================================================
 *
 * ## 事故（2026-11-14，第一版做错了）
 *
 * 第一版把「视图选项」当成一个菜单项，点开**又弹出另一个底部面板**
 * （`TaskViewOptions`）。结果是：
 *
 *   1. **两层菜单、两种形态** —— 右上角浮层 → 底下冒出 sheet。同一屏里
 *      "选一个东西" 有两种容器，正是 `docs/agents/ux-principles.md` §6b 要禁止的形状；
 *   2. **看不见全貌** —— 排序、日期显示藏在第二层，用户点开 `⋯` 只看到 3 项，
 *      以为这个菜单就这么点东西（产品负责人原话：「根本就不对，也不全」）；
 *   3. 关掉第二层之后回到第一层，用户要多按一次才能走。
 *
 * ## 现在的形状（对照滴答清单 `收集箱 → ⋯` 的 9 项）
 *
 * ```
 *   ⋯ 第一层：把全部入口列出来，多值的右边给「当前值 ›」
 *   ├ 视图            列表 ›
 *   ├ 日期显示        日期 ›
 *   ├ 排序            默认（按截止时间） ›
 *   ├ ────────────────
 *   ├ 在当前列表里筛选
 *   └ 批量选择
 * ```
 *
 * 点进去是**同一个浮层原地换成第二层**（顶部一条「‹ 视图」返回行），
 * 这是 iOS/Android 设置类菜单的既定语感，也是滴答「视图」那一项的做法。
 * 选项用**勾**表示当前值——菜单里唯一允许表达的选中态。
 *
 * ## 关闭策略
 *
 * 照 `dismissal.ts` 的 `menu` 那一档：点遮罩 / 返回键都收走。
 * 返回键在**子菜单里**先退一层（这是用户对 Android 返回键的预期），到第一层才关。
 *
 * ## 边界
 *
 * · 只负责壳（层、定位、子菜单栈、关闭、无障碍角色）；项的内容与顺序由调用方给。
 * · 不表达"开关"（我们没有那一族能力）；新增开关能力时先在这里加 `checkbox` 档，
 *   不要另起一个菜单。
 */

import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useTokens } from '../theme';
import { Icon, type IconName } from './icons';
import { Text } from './kit';

/** 子菜单里的一项（多值选择）。 */
export interface TopBarMenuChoice {
  readonly key: string;
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

export interface TopBarMenuItem {
  readonly id: string;
  readonly label: string;
  /**
   * 项右侧的当前值（例如视图名「列表」）。**有它就说明这一项会进子菜单**，
   * 并且会自动画出右箭头 —— 值 + 箭头是"还能往里走"的唯一记号。
   */
  readonly value?: string;
  /** 图标。列表型菜单里图标只是次级装饰，可以不给。 */
  readonly icon?: IconName;
  /** 直接执行的动作。与 `children` 二选一。 */
  readonly onPress?: () => void;
  /** 子菜单的选项。与 `onPress` 二选一。 */
  readonly children?: readonly TopBarMenuChoice[];
  /** 这一项之后画一条分隔线（分组用）。最后一项忽略。 */
  readonly groupEnd?: boolean;
}

export function TopBarMenu({
  visible,
  items,
  label,
  footer,
  onClose,
  testID = 'top-bar-menu',
}: {
  visible: boolean;
  items: readonly TopBarMenuItem[];
  /** 菜单的可访问名（读屏念的那句）。 */
  label: string;
  /**
   * 菜单末尾的一行说明（只读、不可点）。
   *
   * 为什么说明放在这里而不是藏进某个面板底部：手势（长按 = 操作菜单）
   * 是**没有可见入口**的能力，用户只能靠发现。菜单是"我把能做的都摆在这"
   * 的地方，说明跟着它走才有人读到。⚠️ 只放一行，超过一行就不该是 footer。
   */
  footer?: string;
  onClose: () => void;
  testID?: string;
}): React.JSX.Element {
  const t = useTokens();
  const { native } = useTheme();
  const insets = useSafeAreaInsets();
  /**
   * 当前进入的子菜单项 id（`null` = 在第一层）。
   *
   * 🔴 它**不能**放进调用方：菜单一关就重开、回到第一层是正确行为，
   * 而这个状态的生命周期恰好等于"这一次打开"，所以它属于本组件。
   * 放在调用方会让每次开关菜单都要多清一次状态，漏清就是"上次停在哪还停在哪"。
   */
  const [submenuId, setSubmenuId] = useState<string | null>(null);
  const submenu = items.find((item) => item.id === submenuId) ?? null;

  const closeAll = (): void => {
    setSubmenuId(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        // Android 返回键的预期：先退一层子菜单，退到第一层再关。
        if (submenu !== null) setSubmenuId(null);
        else closeAll();
      }}
      accessibilityViewIsModal
      statusBarTranslucent
      testID={testID}
    >
      <Pressable
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no"
        onPress={closeAll}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: t['material.scrim'],
        }}
        testID={`${testID}-scrim`}
      />
      <View
        accessibilityRole="menu"
        accessibilityLabel={submenu === null ? label : submenu.label}
        testID={`${testID}-items`}
        style={{
          position: 'absolute',
          // 锚在 `⋯` 下面：顶栏高度 + 安全区，右侧与顶栏同一个 gutter。
          top: insets.top + t['nav.app-bar-height'],
          right: t['screen.gutter'],
          /**
           * 🔴 宽度必须给**下限**，不能只给上限。
           *
           * `position: 'absolute'` + `right` 定位时容器没有确定的可用宽度，
           * 里面 `flex: 1` 的文字会塌到最小内容宽 —— 实测第一版菜单只有
           * 288px ≈ 96dp，三项文字全部被省略号截断（真机读数，不是推测）。
           */
          minWidth: '62%',
          maxWidth: '82%',
          maxHeight: '70%',
          backgroundColor: t['color.surface'],
          borderRadius: t['radius.dialog'],
          paddingVertical: t['space.1'],
          // 菜单是真正的浮层，阴影是它唯一的层级语言（与 FAB 同一条）。
          // 走归一化访问器：`shadow.*` 在 CSS 里是一整条字符串，RN 要拆成四项。
          ...(native.shadow('shadow.md') ?? {}),
          elevation: 8,
        }}
      >
        {submenu === null ? (
          <ScrollView bounces={false}>
            {items.map((item, index) => (
              <View key={item.id}>
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityLabel={
                    item.value === undefined ? item.label : `${item.label}：${item.value}`
                  }
                  onPress={() => {
                    if (item.children !== undefined) {
                      setSubmenuId(item.id);
                      return;
                    }
                    closeAll();
                    item.onPress?.();
                  }}
                  testID={`${testID}-${item.id}`}
                  style={({ pressed }) => ({
                    minHeight: t['touch-target.min'],
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: t['space.3'],
                    paddingHorizontal: t['space.4'],
                    backgroundColor: pressed ? t['color.surface-sunken'] : 'transparent',
                  })}
                >
                  {item.icon === undefined ? null : (
                    <Icon name={item.icon} size="sm" color={t['color.foreground-muted']} />
                  )}
                  <Text variant="row-title" style={{ flex: 1 }} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {item.value === undefined ? null : (
                    <>
                      <Text variant="row-meta" tone="muted" numberOfLines={1}>
                        {item.value}
                      </Text>
                      <Icon name="action.expand" size="xs" color={t['color.foreground-subtle']} />
                    </>
                  )}
                </Pressable>
                {item.groupEnd === true && index < items.length - 1 ? <Separator /> : null}
              </View>
            ))}
            {footer === undefined ? null : (
              <>
                <Separator />
                <Text
                  variant="caption"
                  tone="muted"
                  style={{
                    paddingHorizontal: t['space.4'],
                    paddingVertical: t['space.2'],
                  }}
                >
                  {footer}
                </Text>
              </>
            )}
          </ScrollView>
        ) : (
          <ScrollView bounces={false}>
            {/* 返回行：把"这是从哪进来的"写清楚，同时它自己就是返回按钮。 */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={submenu.label}
              onPress={() => setSubmenuId(null)}
              testID={`${testID}-back`}
              style={({ pressed }) => ({
                minHeight: t['touch-target.min'],
                flexDirection: 'row',
                alignItems: 'center',
                gap: t['space.3'],
                paddingHorizontal: t['space.4'],
                backgroundColor: pressed ? t['color.surface-sunken'] : 'transparent',
              })}
            >
              <Icon name="action.back" size="sm" color={t['color.foreground']} />
              <Text variant="headline" style={{ flex: 1 }} numberOfLines={1}>
                {submenu.label}
              </Text>
            </Pressable>
            <Separator />
            {(submenu.children ?? []).map((choice) => (
              <Pressable
                key={choice.key}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: choice.selected }}
                accessibilityLabel={choice.label}
                onPress={() => {
                  // 选完就整层关掉：这是**单选**，用户的目的地在列表上，
                  // 不是在这张菜单里继续点（与滴答点「视图 → 列表」后立刻回去一致）。
                  closeAll();
                  choice.onSelect();
                }}
                testID={`${testID}-${submenu.id}-${choice.key}`}
                style={({ pressed }) => ({
                  minHeight: t['touch-target.min'],
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t['space.3'],
                  paddingHorizontal: t['space.4'],
                  backgroundColor: pressed ? t['color.surface-sunken'] : 'transparent',
                })}
              >
                {/* 勾占位固定宽度：没有勾的项文字不许左右跳。 */}
                <View style={{ width: t['icon.sm'] }}>
                  {choice.selected ? (
                    <Icon name="task.done" size="sm" color={t['color.primary']} />
                  ) : null}
                </View>
                <Text variant="row-title" style={{ flex: 1 }} numberOfLines={1}>
                  {choice.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Separator(): React.JSX.Element {
  const t = useTokens();
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        height: t['border-width.hairline'],
        marginVertical: t['space.1'],
        marginHorizontal: t['space.4'],
        backgroundColor: t['color.border'],
      }}
    />
  );
}
