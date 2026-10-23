/**
 * 底部面板（共享原语，适配层 §4 T7）
 * ==================================
 *
 * ## 它补的那一格
 *
 * 移动端 4 个 `*Sheet.tsx` 全是 **RN `Modal` + 居中卡片 + 单档 `maxHeight:'90%'`**
 * —— 名字叫 Sheet，几何上是居中弹窗。把手 / 拖拽 / 分档 / 记忆档位实测全仓 0 处。
 * 这一层把"底部面板该有的东西"收成一个出口，与 `OverlayModal`（居中模态）**分开**：
 * 两者的几何不同，塞进同一个组件只会再造一个"名字叫 Sheet 其实是居中弹窗"。
 *
 * ## 地基与 `OverlayModal` 同一套，不新写
 *
 * RN/RNW 自带的 `Modal` 白送焦点陷阱、`aria-modal`、**关闭时归还焦点**，
 * 还有一个模态栈（只有最顶层响应）—— 见 `OverlayModal.tsx` 文件头的实测出处。
 *
 * ## 🔴 三件刻意的取舍（不是漏了）
 *
 * 1. **拖拽只用 RN 核心的 `Animated` + `PanResponder`**，不引 reanimated /
 *    gesture-handler —— 本仓两端都没有这两个依赖，为一条面板动画加一个原生模块
 *    会让 Android 构建链（本仓不在本机跑）多一处不确定性。代价是动画跑在 JS 线程。
 * 2. **把手区之外不接拖拽**：面板里是 `ScrollView`，没有 gesture-handler 的
 *    原生滚动协调，"内容滚到顶再往下拖就收起"做不对。做一半的那个形状是
 *    "想滚却把面板关了"，比没有更糟 —— 所以只在把手那一条上接。
 * 3. **不处理背景 `inert` 与滚动锁**：那两件要碰 DOM，共享层进不来
 *    （`packages/ui/src/index.ts` 文件头）。与 `OverlayModal` 同一条边界。
 *
 * ## 关闭策略来自一张表，不在这里判
 *
 * `closePolicyOf(overlay)` 是唯一依据。三条通道问同一个 `dismissActionFor`：
 * · 背景 → `policy.scrim`
 * · 返回键 → `policy.systemBack`
 * · **下拉拖拽 → 也读 `policy.scrim`**：两者都是"随手挥走"，判据必须同一条，
 *   分成两格就会出现"拖能关、点背景关不掉"。
 * ⚠️ 键盘那一格按表的定义是 `deny` —— 桌面键盘用户按 Esc 不该有反应，
 *   因为这一类面板的关闭语言是手势。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { X } from 'lucide';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens, useHeytaUiTheme } from '../theme.js';
import {
  closePolicyOf,
  dismissActionFor,
  hasExplicitClose,
  type ClosedOverlay,
  type DismissAction,
} from './dismissal.js';
import {
  SHEET_DETENTS,
  detentForHeight,
  detentHeight,
  largestDetent,
  nextDetent,
  normalizeDetents,
  resolveInitialDetent,
  shouldDismissOnRelease,
  type SheetDetent,
} from './sheet-detents.js';

/** 这一层原语覆盖的类别：几何是"贴底升起"的那几类。 */
export type BottomSheetClass = Extract<
  ClosedOverlay,
  'bottom-sheet' | 'drawer' | 'modal-readonly' | 'modal-dirty-form' | 'modal-forced-read'
>;

/** 一次"想关"的来源 —— 宿主据此决定问法（背景 / 返回键 / 下拉的措辞不一样）。 */
export type BottomSheetDismissVia = 'scrim' | 'back' | 'drag';

/** 文案由宿主注入：共享层不 import i18n（`packages/ui/src/index.ts` 文件头的边界）。 */
export interface BottomSheetLabels {
  /** 右上角 × 的无障碍名。策略判为"给 ×"的那些类必须给。 */
  readonly close: string;
  /** 把手：点它会变成更大的那一档。 */
  readonly expand: string;
  /** 把手：点它会回到最小那一档（已到最大档时的循环）。 */
  readonly collapse: string;
}

export interface BottomSheetProps {
  readonly visible: boolean;
  /** 类别。默认 `bottom-sheet`。 */
  readonly overlay?: BottomSheetClass;
  /** 标题 = 这一层的可访问名称。 */
  readonly title: string;
  readonly labels: BottomSheetLabels;
  /** 唯一的「取消 / 不执行」出口（背景 / 下拉 / × 都走它）。 */
  readonly onDismiss: () => void;
  /**
   * **系统返回键**那一格的出口。不传则与 `onDismiss` 同义。
   *
   * 🔴 为什么单开一格：Android 上"第一次返回先收键盘、第二次才关面板"
   * 是**已拍板**的端差异（`TaskDetailSheet` 的 `handleRequestClose`），
   * 而那条规则不能反向套到 × 上 —— 键盘开着时点 × 只收起键盘会读成"点了没反应"。
   * 三条通道共用一条回调，就必然有两条是错的。
   */
  readonly onBack?: () => void;
  /**
   * 策略判为 `ask-discard` 时的通道 —— 关之前要先问一句，而问法归宿主。
   * 🔴 省略它 = 这一层关不掉（安全侧默认），不是"那就直接关"。
   */
  readonly onDismissAttempt?: (via: BottomSheetDismissVia) => void;

  /** 允许的档位。默认三档全开。**只给一档 = 没有把手可拖**（把手仍画，但不响应）。 */
  readonly detents?: readonly SheetDetent[];
  /** 受控档位。给了它，本组件不再自己记。 */
  readonly detent?: SheetDetent;
  /** 非受控时的起始档位。缺省用允许集合里最大那一档（见模型里的理由）。 */
  readonly defaultDetent?: SheetDetent;
  /** 档位变了（点把手 / 拖拽吸附）。宿主据此做"记忆"。 */
  readonly onDetentChange?: (detent: SheetDetent) => void;

  /**
   * 底部安全区。**共享层没有 `react-native-safe-area-context`**（它只在移动端），
   * 所以由宿主把自己量到的 `insets.bottom` 递进来 —— 不传就是 0，
   * 而那会让面板最后一行压在手势条底下。
   */
  readonly bottomInset?: number;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly testID?: string;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function BottomSheet({
  visible,
  overlay = 'bottom-sheet',
  title,
  labels,
  onDismiss,
  onBack,
  onDismissAttempt,
  detents = SHEET_DETENTS,
  detent,
  defaultDetent,
  onDetentChange,
  bottomInset = 0,
  children,
  footer,
  testID = 'heyta-bottom-sheet',
}: BottomSheetProps): React.JSX.Element {
  const theme = useHeytaUiTheme();
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const { height: viewportHeight } = useWindowDimensions();
  const policy = closePolicyOf(overlay);

  // 🔴 按**内容**而不是数组身份做记忆：宿主传内联数组（`detents={['small','large']}`）
  // 时每次渲染都是新数组，直接进依赖会让 PanResponder 每次渲染重建 ——
  // 而正在进行的那一次拖拽会因此凭空断掉，表现为"拖到一半松手没吸附"。
  const detentsKey = detents.join(',');
  const allowed = useMemo(
    () => normalizeDetents(detents),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 判据就是内容：detentsKey 变了才重算。
    [detentsKey],
  );
  const maxHeight = detentHeight(largestDetent(allowed), viewportHeight);

  const [inner, setInner] = useState<SheetDetent>(() =>
    resolveInitialDetent(detent ?? defaultDetent, allowed),
  );
  // 🔴 受控优先；非受控时组件自己记 —— 面板靠 `visible` 收起而不是卸载，
  // 所以这份 state 天然跨"开/关"留着，用户上次拉到哪一档，下次打开还是那一档。
  const current = detent ?? inner;

  const offsetFor = (value: SheetDetent): number =>
    maxHeight - detentHeight(value, viewportHeight);

  const offsetRef = useRef<Animated.Value | null>(null);
  if (offsetRef.current === null) offsetRef.current = new Animated.Value(offsetFor(current));
  const offset = offsetRef.current;

  /** 当前偏移的像素读数。`Animated.Value` 没有公开的同步取值口，靠监听跟着跑。 */
  const offsetPx = useRef(offsetFor(current));
  useEffect(() => {
    const id = offset.addListener(({ value }) => {
      offsetPx.current = value;
    });
    return () => {
      offset.removeListener(id);
    };
  }, [offset]);

  // 档位 / 视口变了就弹到目标位置。拖拽中不弹（否则手还没松就被拽回去）。
  const dragging = useRef(false);
  useEffect(() => {
    if (dragging.current) return;
    const target = offsetFor(current);
    if (Math.abs(offsetPx.current - target) < 1) {
      offset.setValue(target);
      return;
    }
    const animation = theme.reducedMotion
      ? Animated.timing(offset, { toValue: target, duration: 0, useNativeDriver: false })
      : Animated.spring(offset, {
          toValue: target,
          // 🔴 不用 native driver：RNW 上 `useNativeDriver` 不是同一套实现，
          // 而这一层两端共用。面板吸附不是每秒 60 次的连续动画，JS 线程够用。
          useNativeDriver: false,
          stiffness: 320,
          damping: 32,
          mass: 0.7,
        });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [current, viewportHeight, maxHeight, offset, theme.reducedMotion]);

  const applyDetent = (next: SheetDetent): void => {
    if (detent === undefined) setInner(next);
    onDetentChange?.(next);
  };

  const scrimAction = dismissActionFor(policy, policy.scrim);
  const backAction = dismissActionFor(policy, policy.systemBack);
  // 下拉拖拽与背景同一条判据（见文件头）。
  const dragAction = scrimAction;

  const runDismiss = (
    action: DismissAction,
    via: BottomSheetDismissVia,
    /** 这一通道专属的关闭动作。返回键传 `onBack`，其余走 `onDismiss`。 */
    closeWith?: () => void,
  ): void => {
    if (action === 'close') {
      (closeWith ?? onDismiss)();
      return;
    }
    if (action === 'ask') onDismissAttempt?.(via);
  };

  /**
   * PanResponder 是 `useMemo` 出来的（重建它会让正在进行的那一次拖拽凭空断掉），
   * 于是它闭包里的回调会停在第一次渲染那一版。
   * 🔴 这一支和 `useModalDismiss` 那一份 `latest` ref 是同一个理由：
   * 宿主换过 `onDismiss`（新闭包）而手势里还是旧的 ⇒ 拖到松手关掉的
   * 是**上一个**任务，且没有任何报错。
   */
  const runDismissRef = useRef(runDismiss);
  useEffect(() => {
    runDismissRef.current = runDismiss;
  }, [runDismiss]);

  /** 按下那一刻的偏移。`gesture.dy` 是自按下起的**累计**位移，不是每帧增量。 */
  const startOffset = useRef(0);
  const hysteresis = tokens['gesture.hysteresis'];

  const pan = useMemo(
    () =>
      PanResponder.create({
        // 只响应纵向：横向的一点抖动不该抢走手势。
        // 🔴 方向阈值走 `gesture.hysteresis`，不写字面量：本仓已有这一格
        // （侧滑那一族用的是同一条），写 4 就等于给手势判据开了第二处定义。
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > hysteresis,
        onPanResponderGrant: () => {
          dragging.current = true;
          startOffset.current = offsetPx.current;
          offset.stopAnimation();
        },
        onPanResponderMove: (_event, gesture) => {
          // 累计位移 + 按下时的偏移。⚠️ 不加到 `offsetPx.current` 上 ——
          // 那个读数每帧都在被自己更新，加进去会变成每次移动都翻倍。
          offset.setValue(clamp(startOffset.current + gesture.dy, 0, maxHeight));
        },
        onPanResponderRelease: (_event, gesture) => {
          dragging.current = false;
          const released = clamp(startOffset.current + gesture.dy, 0, maxHeight);
          const visibleHeight = maxHeight - released;
          if (shouldDismissOnRelease(visibleHeight, allowed, viewportHeight)) {
            runDismissRef.current(dragAction, 'drag');
            // 关掉之后下一次打开要回到该在的档位，别停在"被拖没"的偏移上。
            offset.setValue(offsetFor(current));
            return;
          }
          applyDetent(detentForHeight(visibleHeight, viewportHeight, allowed));
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          applyDetent(detentForHeight(maxHeight - offsetPx.current, viewportHeight, allowed));
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖里刻意不含 `offsetPx`/`runDismiss`：两者都是 ref 包裹的稳定读数，进依赖会让 PanResponder 每次渲染重建，手感变成"拖一半重来"。
    [
      offset,
      maxHeight,
      viewportHeight,
      allowed,
      dragAction,
      current,
      detent,
      hysteresis,
    ],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        layer: { flex: 1 },
        // 🔴 遮罩**绝对定位铺满**，不是靠 flex 撑：原生上 Modal 里 `flex:1`
        // 会按内容算高度（实测出处见 `OverlayModal.tsx`）。
        scrim: {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          /**
           * 🔴 用 `material.scrim`（0.32）而不是 `color.overlay`（0.5）：
           * 底部面板的**全部意义**是"底下还看得见上下文"，压暗过狠就退化成模态了；
           * 而移动端任务详情那块面板（本仓唯一有设备级验收读数的 sheet）用的
           * 就是这一层。迁移不该顺手把它改深 —— 那是一次无人要求的视觉变更。
           */
          backgroundColor: tokens['material.scrim'],
        },
        /**
         * 把 `KeyboardAvoidingView` 顶到屏幕底部的占位。
         *
         * 🔴 为什么还要一块看不见的占位，而不是给 KAV 写 `bottom: 0`：
         * Android 的 `behavior="height"` 是靠**改自己的 height** 工作的，
         * 贴底绝对定位时改 height 会让盒子上边缘往下走，面板反而被推到键盘底下。
         * 它必须在**正常流**里被 flex 挤到底部 —— 这与迁移前 `TaskDetailSheet`
         * 里"遮罩 `flex:1` + 之后才是 KAV"的几何逐字相同。
         * ⚠️ `pointerEvents: 'none'`：它压在遮罩之上，不穿透的话点背景就关不掉了。
         */
        spacer: { flex: 1 },
        /**
         * 裁剪框：高度固定在**最大档**，面板在里面往下平移。
         *
         * 为什么不是直接动画 `height`：动 `height` 每一帧都在重排整棵子树，
         * 面板里是 `ScrollView`；动 `translateY` 只走合成。
         */
        clip: {
          height: maxHeight,
          overflow: 'hidden',
        },
        sheet: {
          height: maxHeight,
          gap: tokens['space.3'],
          borderTopLeftRadius: tokens['radius.xl'],
          borderTopRightRadius: tokens['radius.xl'],
          backgroundColor: tokens['color.surface-raised'],
          ...theme.native.shadow('shadow.lg'),
        },
        handleZone: {
          // 触控目标：把手那一条肉眼看着很细，但手指按的是这一整条。
          minHeight: tokens['touch-target.min'],
          alignItems: 'center',
          justifyContent: 'center',
        },
        grabber: {
          width: tokens['size.grabber-width'],
          height: tokens['size.grabber-height'],
          borderRadius: tokens['radius.full'],
          backgroundColor: tokens['color.border-strong'],
        },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens['space.2'],
          paddingHorizontal: tokens['screen.gutter'],
          paddingBottom: tokens['space.2'],
        },
        title: { flex: 1, color: tokens['color.foreground'] },
        closeButton: {
          minWidth: tokens['touch-target.min'],
          minHeight: tokens['touch-target.min'],
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: tokens['radius.full'],
        },
        body: { flexGrow: 1, flexShrink: 1, paddingHorizontal: tokens['screen.gutter'] },
        bodyContent: { gap: tokens['space.4'] },
        footer: {
          paddingHorizontal: tokens['screen.gutter'],
          paddingTop: tokens['space.3'],
          gap: tokens['space.3'],
        },
        pressed: { opacity: 0.72 },
      }),
    [theme, tokens, maxHeight],
  );

  const animationType = Platform.OS === 'web' || theme.reducedMotion ? 'none' : 'slide';

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      // `none` 传 undefined ⇒ RN/RNW 的 Esc 与 Android 返回键都不被接走
      // （`ModalContent.js:35-40`：没有 `onRequestClose` 时按 Esc 什么都不发生）。
      onRequestClose={
        backAction === 'none'
          ? undefined
          : () => runDismiss(backAction, 'back', onBack)
      }
      accessibilityViewIsModal
      statusBarTranslucent
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
            // 遮罩不进无障碍树：读屏用户要读的是面板。
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no"
            onPress={() => runDismiss(scrimAction, 'scrim')}
            style={styles.scrim}
            testID={`${testID}-scrim`}
          />
        )}

        <View accessible={false} style={styles.spacer} pointerEvents="none" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.clip} testID={`${testID}-clip`}>
            <Animated.View
              style={[styles.sheet, { transform: [{ translateY: offset }] }]}
              testID={`${testID}-sheet`}
            >
              <View
                style={styles.handleZone}
                // 多档才挂手势：单档的把手是一条装饰，挂上会变成"拖了没反应"。
                {...(allowed.length > 1 ? pan.panHandlers : {})}
                accessible={allowed.length > 1}
                accessibilityRole={allowed.length > 1 ? 'button' : undefined}
                accessibilityLabel={
                  allowed.length > 1
                    ? nextDetent(current, allowed) === current
                      ? labels.collapse
                      : labels.expand
                    : undefined
                }
                testID={`${testID}-handle`}
              >
                <View style={styles.grabber} />
              </View>

              <View style={styles.header}>
                <Text accessibilityRole="header" style={[text['section-title'], styles.title]}>
                  {title}
                </Text>
                {hasExplicitClose(policy) ? (
                  <Pressable
                    accessibilityLabel={labels.close}
                    accessibilityRole="button"
                    onPress={() => runDismiss(scrimAction, 'scrim')}
                    style={({ pressed }) => [
                      styles.closeButton,
                      pressed ? styles.pressed : undefined,
                    ]}
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

              <ScrollView
                style={styles.body}
                // 底部留白 = 常规一档 **加** 宿主量到的安全区：
                // 只给 inset 会让最后一行压在手势条上，只给 space.8 又会在全面屏上
                // 留一道无意义的白边（迁移前 `TaskDetailSheet` 是两者相加）。
                contentContainerStyle={[
                  styles.bodyContent,
                  { paddingBottom: tokens['space.8'] + bottomInset },
                ]}
                keyboardShouldPersistTaps="handled"
              >
                {children}
              </ScrollView>

              {footer !== undefined ? <View style={styles.footer}>{footer}</View> : null}
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
