/**
 * 模态浮层（共享原语）
 * ===================
 *
 * 本仓 17 处 `aria-modal` 全是各页自绘：滚动锁、焦点陷阱、背景 inert、
 * 焦点归还各抄一份，而关闭策略（点背景算不算关）**0 处显式约定**
 * （读数见 `docs/reference/overlay-feedback-adaptation.md` §1）。
 * 这一层把"同一个模态该有的东西"收成一个出口。
 *
 * ## 地基是 react-native-web 自己的 Modal，不是新写的一套
 *
 * 实测 `react-native-web@0.21.3`（`src/exports/Modal/`）已经提供了四件我们手抄的东西：
 *
 * · `ModalFocusTrap` —— 焦点入内、Tab 不外逃、关闭时**把焦点还给触发者**（`ModalFocusTrap.js:137-152`）；
 * · `ModalContent` 给内容层写 `aria-modal`，激活时给 `role="dialog"`（`ModalContent.js:52-54`）；
 * · 一个**模态栈**：只有最顶层 `active`（`index.js:60-90`）⇒ 嵌套时低层不会抢走 Esc，
 *   这正是 `apps/web/src/lib/use-modal-dismiss.ts` 文件头那条"一次 Esc 连着关两层"边界的解；
 * · Esc 走 **`keyup`**（`ModalContent.js:42`）—— 这是绕开本仓一条陷阱的必要条件：
 *   RN-web 的 `TextInput` 在 `keydown` 上无条件 `stopPropagation()`
 *   （AGENTS §7 第 80 条），挂冒泡阶段的 `keydown` 监听会"写了 Esc 却按了没反应"。
 *
 * ## 🔴 这一层刻意不做的事（不是漏了）
 *
 * · **不接管背景 `inert` 与滚动锁**：那两件事要碰 DOM，而共享层进不来 DOM
 *   （`packages/ui/src/index.ts` 文件头）。焦点出不去由 `ModalFocusTrap` 保证，
 *   "读屏器同时读到两层"那一条仍归宿主（web 侧 `apps/web/src/lib/`）。
 * · **不判同屏几个模态**：原语看不见别的层，那条判据只能由 e2e 走查负责。
 * · **不做 drawer / bottom sheet / 全屏浮层**：它们的**几何**不同，属于移动端形态那一档
 *   （适配层 §4 T7）。把它们塞进居中模态只会再造一个"名字叫 Sheet 其实是居中弹窗"。
 *
 * ## 关闭策略来自一张表，不在这里判
 *
 * `closePolicyOf(overlay)` 是唯一依据（同目录 `dismissal.ts`）。
 * `ask-discard` 的那几类里少了 `onDismissAttempt` 就**不关** —— 安全侧默认：
 * 不关，用户再点一次还在；关了，填了一半的表单就没了。
 */

import React, { useId, useMemo } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { X } from 'lucide';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens, useHeytaUiTheme } from '../theme.js';
import {
  closePolicyOf,
  dismissActionFor,
  hasExplicitClose,
  type DismissAction,
} from './dismissal.js';

/**
 * `OverlayModal` 实现的几类。`danger-confirm` 也在其中 ——
 * 它的"禁背景、不给 ×、Esc 落取消"全部由策略表给出，
 * 所以 `DangerDialog` 只需管内容义务，关不掉这件事没法在页面里被重新写坏。
 */
export type OverlayModalClass =
  | 'modal-readonly'
  | 'modal-dirty-form'
  | 'modal-forced-read'
  | 'danger-confirm';

/** 一次"想关"的来源 —— 宿主据此决定问法（背景 / Esc / 返回键的措辞不一样）。 */
export type OverlayDismissVia = 'scrim' | 'escape' | 'back';

/** 文案由宿主注入：共享层不 import i18n（`packages/ui/src/index.ts` 文件头的边界）。 */
export interface OverlayModalLabels {
  /** 右上角 × 的无障碍名。策略判为"给 ×"的那些类必须给。 */
  readonly close: string;
}

export interface OverlayModalProps {
  readonly visible: boolean;
  readonly overlay: OverlayModalClass;
  /** 标题 = 这一层的可访问名称。危险确认里它该写**后果**，不是动作名。 */
  readonly title: string;
  readonly labels: OverlayModalLabels;
  /** 唯一的「取消 / 不执行」出口。策略判为 `dismiss` 或 `cancel` 时走这里。 */
  readonly onDismiss: () => void;
  /**
   * 策略判为 `ask-discard` 时的通道 —— 关之前要先问一句，而问法归宿主。
   * 🔴 省略它 = 这一层关不掉（安全侧默认），不是"那就直接关"。
   */
  readonly onDismissAttempt?: (via: OverlayDismissVia) => void;
  readonly children: React.ReactNode;
  /** 动作区。渲染在内容之后 —— DOM 顺序决定焦点落点（见 `DangerDialog`）。 */
  readonly footer?: React.ReactNode;
  readonly testID?: string;
}

/**
 * 一次"想关"到底该做什么 —— 三种结果由 `dismissActionFor` 判，这里只负责执行。
 *
 * · `close` → `onDismiss`（在危险确认里它就是「取消」）。
 * · `ask` → `onDismissAttempt`；**没给就什么都不做** —— 安全侧默认：
 *   不关，用户再点一次还在；关了，填了一半的表单就没了。
 * · `none` → 什么都不做（这一通道在原语上根本不该被挂上）。
 */
function runDismiss(
  action: DismissAction,
  onDismiss: () => void,
  onDismissAttempt: ((via: OverlayDismissVia) => void) | undefined,
  via: OverlayDismissVia,
): void {
  if (action === 'close') {
    onDismiss();
    return;
  }
  if (action === 'ask') {
    onDismissAttempt?.(via);
  }
}

export function OverlayModal({
  visible,
  overlay,
  title,
  labels,
  onDismiss,
  onDismissAttempt,
  children,
  footer,
  testID = 'heyta-overlay-modal',
}: OverlayModalProps): React.JSX.Element {
  const theme = useHeytaUiTheme();
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const policy = closePolicyOf(overlay);
  const titleId = useId();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        layer: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: tokens['space.4'],
        },
        // 🔴 遮罩**绝对定位铺满**，不是靠 flex 撑：原生上 Modal 里写 `flex:1`
        // 会按内容算高度（实测像素取证见 `apps/mobile/src/screens/TasksScreen.tsx:196-214`）。
        // 它和面板是**兄弟**，不是父 —— 点面板就不会冒泡成"点了背景"。
        scrim: {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: tokens['color.overlay'],
        },
        panel: {
          width: '100%',
          maxWidth: tokens['layout.modal-max'],
          maxHeight: '88%',
          gap: tokens['space.4'],
          padding: tokens['space.5'],
          borderRadius: tokens['radius.xl'],
          backgroundColor: tokens['color.surface-raised'],
          ...theme.native.shadow('shadow.md'),
        },
        header: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: tokens['space.3'],
        },
        headingBlock: { flex: 1, gap: tokens['space.1'] },
        title: { color: tokens['color.foreground'], flexShrink: 1 },
        closeButton: {
          minWidth: tokens['touch-target.min'],
          minHeight: tokens['touch-target.min'],
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: tokens['radius.full'],
        },
        body: { flexGrow: 0, flexShrink: 1 },
        footer: { gap: tokens['space.3'] },
        pressed: { opacity: 0.72 },
      }),
    [theme, tokens],
  );

  // 🔴 web 上固定 `none`，不是随手选的动画：`ModalAnimation` 只在
  // `animationType === 'none'` 时**直接**调 `onShow`（`ModalAnimation.js:65-71`），
  // 走动画则要等 `animationend`。而 `isActive` 决定 `role="dialog"` 与焦点陷阱
  // 是否生效 —— 系统关掉动画时 `animationend` 可能永不触发，那一层就变成
  // **没有角色、没有焦点陷阱的浮层**，且不会有任何报错。
  const animationType = Platform.OS === 'web' || theme.reducedMotion ? 'none' : 'fade';

  // 三条通道各自查表，但**问的是同一个函数** —— 组件里不许再内联比较策略值。
  // 键盘那一格分平台：web 上是 Esc，原生上是系统返回键（Android back / iOS 侧滑）。
  const keyboardVia: OverlayDismissVia = Platform.OS === 'web' ? 'escape' : 'back';
  const keyboardAction = dismissActionFor(
    policy,
    Platform.OS === 'web' ? policy.escape : policy.systemBack,
  );
  const scrimAction = dismissActionFor(policy, policy.scrim);
  // × 是一个**取消**控件，不是"丢弃"快捷键：脏表单里点它要先问「放弃修改？」，
  // 所以它读键盘那一格，而不是硬编码"直接关"。
  const closeButtonAction = dismissActionFor(policy, policy.escape);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      // `none` 传 undefined ⇒ RN-web 的 Esc 与 Android 返回键都不被接走
      // （`ModalContent.js:35-40`：没有 `onRequestClose` 时按 Esc 什么都不发生）。
      onRequestClose={
        keyboardAction === 'none'
          ? undefined
          : () => runDismiss(keyboardAction, onDismiss, onDismissAttempt, keyboardVia)
      }
      accessibilityViewIsModal
      aria-labelledby={titleId}
      testID={testID}
    >
      <View style={styles.layer}>
        {scrimAction === 'none' ? (
          // 禁背景这一类**连点击都不接受**：不是"点了没反应"，是没有这一条通道。
          <View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.scrim}
          />
        ) : (
          <Pressable
            // 遮罩本身不进无障碍树：读屏用户要读的是面板。
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no"
            onPress={() => runDismiss(scrimAction, onDismiss, onDismissAttempt, 'scrim')}
            style={styles.scrim}
            testID={`${testID}-scrim`}
          />
        )}
        <View style={styles.panel} testID={`${testID}-panel`}>
          <View style={styles.header}>
            <View style={styles.headingBlock}>
              <Text
                accessibilityRole="header"
                nativeID={titleId}
                style={[text['section-title'], styles.title]}
              >
                {title}
              </Text>
            </View>
            {hasExplicitClose(policy) ? (
              <Pressable
                accessibilityLabel={labels.close}
                accessibilityRole="button"
                onPress={() => runDismiss(closeButtonAction, onDismiss, onDismissAttempt, keyboardVia)}
                style={({ pressed }) => [styles.closeButton, pressed ? styles.pressed : undefined]}
                testID={`${testID}-close`}
              >
                <HeytaIcon
                  data={X}
                  size={tokens['icon.sm']}
                  color={tokens['color.foreground-muted']}
                />
              </Pressable>
            ) : null}
          </View>
          <ScrollView style={styles.body}>{children}</ScrollView>
          {footer !== undefined ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}
