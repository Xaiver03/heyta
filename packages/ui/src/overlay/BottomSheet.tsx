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
  explicitCloseOutcomeOf,
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
  resolveDetentSeed,
  resolveInitialDetent,
  shouldDismissOnRelease,
  type SheetDetent,
} from './sheet-detents.js';
import { isSheetDragRegion, type SheetDragRegion } from './sheet-drag.js';

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
  /**
   * 关闭出口的**具名文字**（G2）。给了它，右上角显示这句话而不是那只 ×。
   *
   * 🔴 为什么要有这一档：一个只有 × 的出口，用户**在读它之前就得猜它干什么**。
   * 法律/条款类面板（"稍后再处理"、"我已阅读并同意"）尤其明显 ——
   * 那种面板的关闭是有后果的（不点就等于没读完），把后果写在那个可点区域上，
   * 比让它变成一个抽象符号便宜，也不是装饰。
   * ⚠️ 省略 = 维持原样（画 ×）。这一档**不替换** `close`：
   * 文字按钮仍然要 `close` 当无障碍名的兜底吗？不要 —— 按钮的可见文字本身就是名字，
   * 所以给了 `closeText` 时 `accessibilityLabel` 用它，避免读屏念两句。
   */
  readonly closeText?: string;
  /**
   * 把手：点它会变成更大的那一档。
   *
   * ⚠️ **单档面板可以不给**（`detents` 只有一档时永远读不到它 —— 那一档没有把手可拖）。
   * 之前它们是必填的，实测后果是宿主被迫拿**关闭**那句文案去占位
   * （`ConflictSheet` 就写了 `expand: t('mobile.conflict.close')`），
   * 于是无障碍树里出现两句"稍后再处理"，而其中一句的名字在说"展开"。
   * 必填项逼出来的假文案，比缺一项更糟。
   */
  readonly expand?: string;
  /** 把手：点它会回到最小那一档（已到最大档时的循环）。见 `expand` 那条。 */
  readonly collapse?: string;
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
  /** 非受控时的起始档位。缺省用 `DEFAULT_SHEET_DETENT`（medium，见模型里的理由）。 */
  readonly defaultDetent?: SheetDetent;
  /**
   * 宿主从自己的持久层读回来的"上次那一档"。
   *
   * 🔴 优先级是 **记忆 > `defaultDetent` > 模型默认**（`resolveDetentSeed`）。
   * 让宿主写死的默认档赢，等于每次打开都把用户的手势选择抹掉 ——
   * 而"记不住档位"正是这一格立项时要修的缺陷
   * （`onDetentChange` 全仓零宿主使用那条）。
   * ⚠️ 允许**异步**送到（宿主先渲染后取本地库），组件里那一次"只采纳、不回写"
   * 的更新就是为它准备的；受控（`detent`）时本 prop 被忽略。
   */
  readonly rememberedDetent?: SheetDetent;
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
  rememberedDetent,
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
    resolveDetentSeed(rememberedDetent, defaultDetent, allowed),
  );
  // 🔴 受控优先；非受控时组件自己记 —— 面板靠 `visible` 收起而不是卸载，
  // 所以这份 state 天然跨"开/关"留着，用户上次拉到哪一档，下次打开还是那一档。
  const current = detent ?? inner;

  /**
   * 用户在这一世（本次挂载内）**自己**拖过 / 点过把手。
   *
   * 🔴 它存在的理由只有一个：记忆是宿主异步读上来的，可能在挂载之后才到，
   * 而"我刚把面板拖到 60%，宿主的记忆这时候读回来了"会把面板拽回上次那一档，
   * 读起来像被抢了一下。所以迟到的记忆只在不覆盖用户手势时被采纳。
   */
  const userChoseDetent = useRef(false);

  // 迟到的记忆：采纳，但**不回写** `onDetentChange`。
  // 采纳一次读取不是用户改了档位，回写会把一次纯粹的"读"变成一次"持久化写入"。
  useEffect(() => {
    if (detent !== undefined || rememberedDetent === undefined) return;
    if (userChoseDetent.current) return;
    const seed = resolveInitialDetent(rememberedDetent, allowed);
    setInner((prev) => (prev === seed ? prev : seed));
  }, [detent, rememberedDetent, allowed]);

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
    // 走到这里的一定是**用户手势**（拖拽吸附 / 点把手），所以从此迟到的记忆不再采纳。
    userChoseDetent.current = true;
    if (detent === undefined) setInner(next);
    onDetentChange?.(next);
  };

  const scrimAction = dismissActionFor(policy, policy.scrim);
  const backAction = dismissActionFor(policy, policy.systemBack);
  // 下拉拖拽与背景同一条判据（见文件头）。
  const dragAction = scrimAction;
  /**
   * 🔴 × 读 `explicitCloseOutcomeOf`，不读 `scrimAction`：`modal-deferrable` 与
   * `full-screen` 的背景是 `deny`，接 `scrimAction` 会得到一个**按下去什么都不发生**的
   * ×（实测缺陷，2026-11-02 由 `RowActionMenu` 那一族的迁移撞出来）。
   * 反过来 `bottom-sheet` 的 `escape` 是 `deny`，所以也不能固定读键盘那一格。
   */
  const explicitCloseAction = dismissActionFor(policy, explicitCloseOutcomeOf(policy));

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
        /**
         * 标题栏里**可拖的那一段**。它不占满整条 header —— × 必须留在外面，
         * 理由见 `sheet-drag.ts` 文件头（move 阶段抢走 responder 会让 × 点不动）。
         */
        headerDrag: { flex: 1 },
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

  /** 单档面板没有把手可拖（`nextDetent` 的理由），手势与可及性都跟着这一判据走。 */
  const draggable = allowed.length > 1;
  /**
   * 一块区域接不接拖拽 —— 🔴 判断只住在 `sheet-drag.ts` 那张表里，
   * 组件里不许出现第二处"哪一块能拖"的字面量（判据问两次就有两种问法，
   * 第二种通常是错的）。
   */
  const dragHandlers = (region: SheetDragRegion): object =>
    draggable && isSheetDragRegion(region) ? pan.panHandlers : {};

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
                {...dragHandlers('handle')}
                accessible={draggable}
                accessibilityRole={draggable ? 'button' : undefined}
                accessibilityLabel={
                  draggable
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
                {/* 可拖的是标题这一段，不是整条 header：× 留在拖拽段之外。
                    按住标题往上往下都是拖 —— 用户不需要瞄准一条几 px 的把手。 */}
                <View style={styles.headerDrag} {...dragHandlers('header')}>
                  <Text accessibilityRole="header" style={[text['section-title'], styles.title]}>
                    {title}
                  </Text>
                </View>
                {hasExplicitClose(policy) ? (
                  <Pressable
                    // 具名文字出口在时，可见文字就是它的名字（见 `BottomSheetLabels.closeText`）。
                    accessibilityLabel={labels.closeText ?? labels.close}
                    accessibilityRole="button"
                    onPress={() => runDismiss(explicitCloseAction, 'scrim')}
                    style={({ pressed }) => [
                      styles.closeButton,
                      pressed ? styles.pressed : undefined,
                    ]}
                    testID={`${testID}-close`}
                  >
                    {labels.closeText !== undefined ? (
                      <Text style={[text['section-title'], { color: tokens['color.foreground-muted'] }]}>
                        {labels.closeText}
                      </Text>
                    ) : (
                      <HeytaIcon
                        data={X}
                        size={tokens['icon.sm']}
                        color={tokens['color.foreground-muted']}
                      />
                    )}
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
                /**
                 * 🔴 键盘弹起时把滚动内容顶出键盘之上，并让系统把**当前第一响应者**
                 * 滚进可视区（iOS 13.4+ 的平台行为）。
                 *
                 * 为什么必须有：外层那只 `KeyboardAvoidingView` 只把**整块面板**抬起来，
                 * 面板高度仍由档位决定 ⇒ 焦点输入框如果在折叠内容更靠下的位置，
                 * 抬完还是被键盘盖住。2026-11-03 真机实测（iPhone 模拟器，Release 构建）：
                 * 详情面板里点「添加子任务」，键盘起来了、输入框拿到了焦点，
                 * 而屏幕上从头部三件套到键盘之间**整段是空白** ——
                 * 用户视角就是"点了没反应"。静态判据、类型检查、2100+ 条测试全绿。
                 *
                 * ⚠️ 这一条修的是"看得见"。宿主如果要更讲究（比如自动展开到最高档），
                 * 那是产品取向，不是这里的前置条件。
                 */
                automaticallyAdjustKeyboardInsets
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
