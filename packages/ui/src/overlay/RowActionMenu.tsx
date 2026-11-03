/**
 * `RowActionMenu` —— 移动端（触屏）的**行上下文菜单**
 * ===================================================
 *
 * 出处：`docs/plans/row-actions-redesign.md` §3.4「移动 | **长按**行 | … |
 * 长按是移动端"上下文菜单"的既有手势（iOS/Android 一致）」。Web 那一端的同一组
 * 动作住在 `apps/web/src/features/tasks/TaskRowMenu.tsx`（右键 + `Shift+F10`），
 * 本文件是它在触屏上的对应物 —— **结构可以不同，判断不许分叉**：
 * 危险档位仍然问 `@heyta/domain` 的 `resolveDangerTier()`（经 `row-actions.ts`），
 * 关闭策略仍然查 `closePolicyOf('menu')`。
 *
 * ## 为什么不复用 `BottomSheet`
 *
 * `BottomSheet` 是"内容面板"那一类：多档 detent、可拖、带把手与 ×。
 * 一层只有五枚按钮的动作菜单要的是**菜单**的关闭语言（点外面 / 返回键都收走、不给 ×），
 * 也就是 `dismissal.ts` 里 `menu` 那一行。把菜单塞进 sheet 只会得到
 * "名字叫 Sheet、行为按 menu、拖拽纯属多余"的那只混合体 —— 那正是本仓拆掉 `*Sheet.tsx` 之前的形状。
 * 两者共用同一份**策略表**，各自只写几何。
 *
 * ## 边界（读清楚，别当已完成）
 *
 * · 🔴 **零文案**：`label` / `consequence` / `cancelLabel` 与每一项的字都由宿主注入，
 *   本包不 import `@heyta/i18n`（`packages/ui/src/index.ts` 文件头那条边界）。
 * · 🔴 **零数据变更**：菜单只回吐 `RowActionId`，执行归宿主的 action 层。
 * · ⚠️ §3.4 给移动端写的键盘等价是「VoiceOver / TalkBack 的"操作"转子」，
 *   那需要 RN 的原生 accessibility actions（当前 RN 版本对 JS 侧开放得很有限）。
 *   **本文件没有实现转子**，这一格登记为已知边界；人人可见的那条路仍是"点行 → 详情"。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { closePolicyOf, dismissActionFor } from './dismissal.js';
import { useHeytaText, useHeytaTokens, useHeytaUiTheme } from '../theme.js';
import {
  deleteNeedsConfirm,
  groupRowActions,
  isDangerousRowAction,
  type RowAction,
  type RowActionId,
} from '../task-list/row-actions.js';

export interface RowActionMenuProps {
  readonly visible: boolean;
  /** 这一层是为哪一条任务打开的。 */
  readonly taskId: string;
  /** 菜单的可访问名称（宿主注入，形如「任务操作：{标题}」）。 */
  readonly label: string;
  /**
   * 菜单里有哪些项（含**内容**：字与图标节点）。
   * 顺序与分组不在宿主这边 —— 由 `groupRowActions()` 决定，
   * 「已置顶就给 `unpin`」这类状态换面由宿主决定给哪一副。
   */
  readonly actions: readonly RowAction[];
  /**
   * 直接子任务数 —— 危险档**唯一**的输入。
   * 🔴 档位不在这里写死：`deleteNeedsConfirm(childCount)` 问的是
   * `resolveDangerTier({ affectedCount: 1, undoAvailable: isUndoableDeletion('task'), collateralImpact })`。
   */
  readonly childCount: number;
  /** `popconfirm` 档要说的那句后果（必须是真事实，见 §3.3 与 `subtasks.ts`）。 */
  readonly consequence: string;
  /** 二次确认那一态里的「取消」文案（宿主注入）。 */
  readonly cancelLabel: string;
  readonly onSelect: (actionId: RowActionId, taskId: string) => void;
  readonly onDismiss: () => void;
  /** 底部安全区（共享层没有 `react-native-safe-area-context`，由宿主量进来）。 */
  readonly bottomInset?: number;
  readonly testID?: string;
}

export function RowActionMenu({
  visible,
  taskId,
  label,
  actions,
  childCount,
  consequence,
  cancelLabel,
  onSelect,
  onDismiss,
  bottomInset = 0,
  testID = 'heyta-row-action-menu',
}: RowActionMenuProps): React.JSX.Element {
  const theme = useHeytaUiTheme();
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  /**
   * `popconfirm` 的那一态：第一下**只改口**（把「删除」换成「仍要删除」+ 一句后果），
   * 第二下才真的执行。换到别的任务、或这一层被关掉重开，都必须回到第一态 ——
   * 否则"上次没删成"会带着下一次长按一起生效（第一下就直接删）。
   */
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setConfirming(false);
  }, [taskId, visible]);

  const needsConfirm = deleteNeedsConfirm(childCount);
  const { safe, danger } = groupRowActions(actions);

  /** 关闭策略查表，不在这里内联比较（`overlay-feedback.md` §3）。 */
  const policy = closePolicyOf('menu');
  const runDismiss = useCallback(
    (outcome: 'scrim' | 'back'): void => {
      const action = dismissActionFor(policy, outcome === 'back' ? policy.systemBack : policy.scrim);
      // `menu` 这一档三条通道全 `dismiss` ⇒ 查表结果只会是 `close`。
      // 「ask」与「none」在这里**没有**降级路径：策略改了就该改这一层的形态，
      // 而不是让菜单悄悄变成"点了没反应"。
      if (action === 'close') onDismiss();
    },
    [onDismiss, policy],
  );

  const runItem = useCallback(
    (item: RowAction): void => {
      if (isDangerousRowAction(item.id) && needsConfirm && !confirming) {
        setConfirming(true);
        return;
      }
      onSelect(item.id, taskId);
      // 一次意图一次执行 ⇒ 执行完这一层就收走（与 Web 的 `TaskRowMenu` 同一形状）。
      onDismiss();
    },
    [confirming, needsConfirm, onDismiss, onSelect, taskId],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        layer: { flex: 1 },
        // 🔴 遮罩绝对定位铺满（原生上 `flex:1` 在 Modal 里按内容算高，实测出处见 `BottomSheet.tsx`）。
        scrim: {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: tokens['material.scrim'],
        },
        sheet: {
          borderTopLeftRadius: tokens['radius.xl'],
          borderTopRightRadius: tokens['radius.xl'],
          backgroundColor: tokens['color.surface-raised'],
          paddingTop: tokens['space.2'],
          paddingBottom: tokens['space.2'],
          gap: tokens['space.1'],
          ...theme.native.shadow('shadow.lg'),
        },
        /**
         * 一行一项，整项可点。
         * 🔴 命中下限走 `touch-target.min`，不写 44/48 这种字面量 ——
         * 菜单是手指操作的，比行内徽章更要守这一格。
         */
        item: {
          minHeight: tokens['touch-target.min'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.3'],
          paddingHorizontal: tokens['space.4'],
        },
        itemLabel: {
          // 菜单项是"要按的东西"，不是正文：用行标题那一档，读起来才是主句。
          ...text['row-title'],
          color: tokens['color.foreground'],
          flex: 1,
        },
        itemLabelDanger: {
          color: tokens['color.danger'],
          // 🔴 危险项**不只靠颜色**（色觉障碍读不出来）：它在分隔线之后、单独一组，
          // 与 `apps/web/tests/task-row-menu.spec.tsx` 的 P2 钉的是同一件事。
        },
        separator: {
          height: tokens['border-width.hairline'],
          marginVertical: tokens['space.1'],
          marginLeft: tokens['space.4'],
          marginRight: tokens['space.4'],
          backgroundColor: tokens['color.border'],
        },
        consequence: {
          ...text['row-meta'],
          color: tokens['color.foreground-subtle'],
          paddingHorizontal: tokens['space.4'],
          paddingBottom: tokens['space.1'],
        },
      }),
    [text, theme, tokens],
  );

  const renderStyle = theme.reducedMotion ? 'none' : 'slide';

  return (
    <Modal
      visible={visible}
      transparent
      animationType={renderStyle}
      // 没有 `onRequestClose` 时 Android 返回键什么都不做（实测出处见 `BottomSheet.tsx`）。
      onRequestClose={() => runDismiss('back')}
      accessibilityViewIsModal
      statusBarTranslucent
      testID={testID}
    >
      <View style={styles.layer}>
        <Pressable
          // 遮罩不进无障碍树：读屏用户要读的是菜单本身（与 `BottomSheet` 同一条）。
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no"
          onPress={() => runDismiss('scrim')}
          style={styles.scrim}
          testID={`${testID}-scrim`}
        />
        <View style={[styles.sheet, { paddingBottom: tokens['space.2'] + bottomInset }]}>
          <View accessibilityRole="menu" accessibilityLabel={label} testID={`${testID}-items`}>
            {safe.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="menuitem"
                accessibilityLabel={item.label}
                onPress={() => runItem(item)}
                style={styles.item}
                testID={`${testID}-${item.id}`}
              >
                {item.icon ?? null}
                <Text style={styles.itemLabel} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            ))}

            {danger.length === 0 ? null : (
              <View
                // 纯装饰的分隔线：不进无障碍树，也不许当"分组已经说出来"用。
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={styles.separator}
                testID={`${testID}-separator`}
              />
            )}

            {confirming ? (
              <Text style={styles.consequence} accessibilityLiveRegion="polite" testID={`${testID}-consequence`}>
                {consequence}
              </Text>
            ) : null}

            {danger.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="menuitem"
                accessibilityLabel={confirming ? `${consequence} ${item.confirmingLabel ?? item.label}` : item.label}
                onPress={() => runItem(item)}
                style={styles.item}
                testID={`${testID}-${item.id}`}
              >
                {item.icon ?? null}
                <Text style={[styles.itemLabel, styles.itemLabelDanger]} numberOfLines={1}>
                  {confirming ? (item.confirmingLabel ?? item.label) : item.label}
                </Text>
              </Pressable>
            ))}

            {confirming ? (
              <Pressable
                accessibilityRole="menuitem"
                accessibilityLabel={cancelLabel}
                onPress={() => setConfirming(false)}
                style={styles.item}
                testID={`${testID}-cancel`}
              >
                <Text style={styles.itemLabel} numberOfLines={1}>
                  {cancelLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
