/**
 * `SwipeReveal` —— 一行的**左滑露出动作**外壳（RN 核心 `Animated` + `PanResponder`）
 * ===============================================================================
 *
 * 出处：`docs/plans/row-actions-redesign.md` §3.4「移动（第二入口）| 左滑露出动作 |
 * 滑动是列表删除的第一惯例，而它可以被**误触**：一次横向抖动不该毁掉一条任务。
 * 所以滑动**只露出**动作，点那一枚才执行」+ §9.3（不做"滑到底即删"）。
 *
 * 🔴 **本文件里没有 `deleteTask`，也没有任何"松手即执行"的分支。**
 * 手势只做一件事：把动作条挪进视野。执行永远来自那枚按钮自己的 `onPress`。
 *
 * ## 为什么它是"外壳"而不是"另一种行"
 *
 * `check-row-single-source` 钉的是「勾选框 + 标题 + 截止」那一棵 JSX 子树**全仓只有一份**
 * （在 `TaskRow.tsx`）。所以这一层**不画行**：它只接 `children`（就是那一行本身），
 * 自己只负责几何、手势与那几枚露出来的按钮。这样"滑开的行"与"没滑开的行"
 * 永远是同一份实现，不会出现第二份行。
 *
 * ## 与纵向滚动的方向分家（这一格做不对就不要开手势）
 *
 * 三条闸，缺一不可，全都在 `onMoveShouldSetPanResponder` 那一句里：
 *   1. 横向位移必须**压过**纵向位移（`|dx| > |dy|`）；
 *   2. 横向位移必须先过 `gesture.hysteresis` 那条阈值（方向判定阈值在 token 里，
 *      与 `BottomSheet` 的拖拽判定同一个来源，不写字面量）；
 *   3. `onShouldBlockNativeResponder` 只在**已经**满足 1+2 之后为真，
 *      `onPanResponderTerminationRequest` 拒接把手被列表抢回去。
 * 于是纯纵向的滚动一开始就落在 `ScrollView` 那一侧（我们从不 `onStartShouldSetPanResponder`），
 * 而斜着抖一下也不会把行拽开 —— 那两条正是"跟滚动打架"的两种形状。
 *
 * ⚠️ **登记为已知边界**：iOS 的原生 `UIScrollView` 在高速度下仍有可能把一次
 * 横向拖拽判成滚动（RN 的 JS  responder 谈判晚于原生手势识别器）。
 * 判据只能靠真机（`docs/agents/ui-acceptance.md`），不能靠这段注释。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useHeytaText, useHeytaTokens, useHeytaUiTheme } from '../theme.js';
import { isDangerousRowAction, type RowAction, type RowActionId } from './row-actions.js';

export interface SwipeRevealProps {
  /** 这一行的主体 id（任务 id）。用于"同一时刻只允许一行是滑开的"与切行时复位。 */
  readonly subjectId: string;
  /**
   * 露出来的那几枚（**顺序即视觉顺序**，从靠近行身的那枚起）。
   * 分组与危险项的位置由菜单那一层钉（`groupRowActions`）；滑动条通常只有一枚，
   * 不在这里重排一遍，免得两处的"顺序"变成两份判断。
   */
  readonly actions: readonly RowAction[];
  /**
   * 危险项要不要就地改口。
   * 🔴 判定不在这里：由调用方经 `row-actions.ts` 的 `deleteNeedsConfirm(childCount)` 给，
   * 而那一枚问的是 `@heyta/domain` 的 `resolveDangerTier()`。
   */
  readonly confirmDanger: boolean;
  /** 二次确认时要说的那句事实（读屏播报用；整句的视觉落点在长按菜单里）。 */
  readonly consequence: string;
  /** 滑开之后盖在行身上的那枚透明收口按钮的无障碍名。 */
  readonly closeLabel: string;
  readonly onAction: (actionId: RowActionId) => void;
  /** 批量选择态、正在处理中的那一行：不接受手势，也不接受点击。 */
  readonly disabled?: boolean;
  readonly children: React.ReactNode;
  readonly testID?: string;
}

/**
 * 同一时刻只允许**一行**是滑开的。
 *
 * 为什么用模块级的一格状态而不是 props：列表是虚拟化的，行会随滚动挂载卸载；
 * 让宿主持这一个"哪一行开着"的读数，就是把视图态塞进业务 state（它既不进 op-log
 * 也不该随屏幕飘走）。这一格只在渲染层，卸载即复位。
 */
let openRow: { readonly subjectId: string; readonly close: () => void } | null = null;

function claimOpenRow(subjectId: string, close: () => void): void {
  if (openRow !== null && openRow.subjectId !== subjectId) openRow.close();
  openRow = { subjectId, close };
}

/** 开始拖新的一行之前，先把**别的**那一行收回原位。 */
function closeOtherRows(subjectId: string): void {
  if (openRow !== null && openRow.subjectId !== subjectId) openRow.close();
}

function releaseOpenRow(subjectId: string): void {
  if (openRow !== null && openRow.subjectId === subjectId) openRow = null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function SwipeReveal({
  subjectId,
  actions,
  confirmDanger,
  consequence,
  closeLabel,
  onAction,
  disabled = false,
  children,
  testID = 'heyta-swipe-reveal',
}: SwipeRevealProps): React.JSX.Element {
  const theme = useHeytaUiTheme();
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  /** 露出来的总宽 = 动作数 × `size.swipe-action`（这一格本来就是为它准备的 token）。 */
  const revealWidth = actions.length * tokens['size.swipe-action'];

  const offsetRef = useRef<Animated.Value | null>(null);
  if (offsetRef.current === null) offsetRef.current = new Animated.Value(0);
  const offset = offsetRef.current;
  const offsetPx = useRef(0);

  useEffect(() => {
    const id = offset.addListener(({ value }) => {
      offsetPx.current = value;
    });
    return () => {
      offset.removeListener(id);
    };
  }, [offset]);

  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /** 换了一条行 ⇒ 回到"没改口"的那一态，否则上次没删成的第二下会跟着这一行。 */
  useEffect(() => {
    setConfirming(false);
  }, [subjectId]);

  const animateTo = useCallback(
    (target: number): void => {
      if (theme.reducedMotion) {
        offset.setValue(target);
        offsetPx.current = target;
        return;
      }
      Animated.timing(offset, {
        toValue: target,
        // 时长走 token（`duration.fast`），不自定义毫秒数；曲线是标准缓出，
        // 设计变量里的 `--ht-ease-exit` 一族是给 CSS 的，RN 侧没有对应刻度，
        // 自造一组数字等于在 token 表外新建一份裁决。
        duration: tokens['duration.fast'],
        easing: Easing.out(Easing.cubic),
        // 与 `BottomSheet` 同一条理由：RNW 上 native driver 不是同一套实现，
        // 而位移只在松手那一次，不是每帧重排。
        useNativeDriver: false,
      }).start();
    },
    [offset, theme.reducedMotion, tokens],
  );

  const closeNow = useCallback((): void => {
    setOpen(false);
    setConfirming(false);
    animateTo(0);
  }, [animateTo]);

  /** `closeNow` 每次渲染都是新闭包，而登记给协调器的那一句收口必须是**当前**的那一句。 */
  const closeNowRef = useRef(closeNow);
  useEffect(() => {
    closeNowRef.current = closeNow;
  }, [closeNow]);

  /**
   * 滑开 = 占住"唯一开着的那一行"；关掉或卸载 = 交还。
   * 卸载这一支防的是：行随虚拟列表被回收之后，协调器还指着它的收口函数
   *（那会让下一次"收别的行"收到一个已经卸载的组件）。
   */
  useEffect(() => {
    if (!open) {
      releaseOpenRow(subjectId);
      return undefined;
    }
    claimOpenRow(subjectId, () => closeNowRef.current());
    return () => releaseOpenRow(subjectId);
  }, [open, subjectId]);

  /** 手势回调进 ref：PanResponder 只在依赖变化时重建，闭包不能停在旧读数上。 */
  const stateRef = useRef({ revealWidth, disabled, subjectId });
  useEffect(() => {
    stateRef.current = { revealWidth, disabled, subjectId };
  }, [disabled, revealWidth, subjectId]);

  /** 按下那一刻的偏移。`gesture.dx` 是自按下起的**累计**位移，不是每帧增量。 */
  const startOffset = useRef(0);
  const hysteresis = tokens['gesture.hysteresis'];

  const pan = useMemo(
    () =>
      PanResponder.create({
        // 🔴 按下那一下**永远不抢**：抢了就没有点击、也没有读屏的"双击激活"。
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => {
          const { revealWidth: width, disabled: isDisabled } = stateRef.current;
          if (isDisabled || width === 0) return false;
          return Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > hysteresis;
        },
        onMoveShouldSetPanResponderCapture: (_event, gesture) => {
          const { revealWidth: width, disabled: isDisabled } = stateRef.current;
          if (isDisabled || width === 0) return false;
          return Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > hysteresis;
        },
        // 已经判定是横向手势之后才挡住原生滚动（挡住"斜着抖一下就滚"是反的）。
        onShouldBlockNativeResponder: () => true,
        // 拖到一半不许被列表收回（否则表现为"拽到一半自己弹回去"）。
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startOffset.current = offsetPx.current;
          offset.stopAnimation();
          // 开始拽这一行之前，先把开着的那一行（如果有）收回去。
          closeOtherRows(stateRef.current.subjectId);
        },
        onPanResponderMove: (_event, gesture) => {
          // 累计位移 + 按下那一刻的偏移（同 `BottomSheet` 的读法：`dx` 不是每帧增量）。
          const { revealWidth: width } = stateRef.current;
          offset.setValue(clamp(startOffset.current + gesture.dx, -width, 0));
        },
        onPanResponderRelease: () => {
          const { revealWidth: width } = stateRef.current;
          // 🔴 松手**只决定开还是关**，永远不执行任何动作 —— 全滑直删不在本单（§9.3）。
          // 一半的位置是判据：`revealWidth / 2` 不是魔法数，它是"露出来的那一半"本身。
          if (width > 0 && offsetPx.current <= -width / 2) {
            setOpen(true);
            animateTo(-width);
            return;
          }
          closeNow();
        },
        // 被系统收回手势（来电、原生滚动抢走）时也必须回到关掉的那一态，
        // 否则行身会停在半开的偏移上，看起来像"卡在中间"。
        onPanResponderTerminate: () => {
          closeNow();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 读数走 ref：把 `offsetPx`/`stateRef` 放进依赖会让 PanResponder 每次渲染重建，正在拖的那一次会凭空断掉（`BottomSheet` 同一条理由）。
    [animateTo, closeNow, hysteresis],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        shell: { width: '100%' },
        // 露出来的那几枚在**行身之下**，靠行身平移出来（不是把行推走）。
        actions: {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          flexDirection: 'row',
          alignItems: 'stretch',
        },
        action: {
          width: tokens['size.swipe-action'],
          justifyContent: 'center',
          alignItems: 'center',
          gap: tokens['space.1'],
          paddingHorizontal: tokens['space.1'],
        },
        actionDanger: {
          backgroundColor: tokens['color.danger'],
        },
        actionSafe: {
          backgroundColor: tokens['color.surface-sunken'],
        },
        actionLabel: {
          ...text['row-meta'],
          color: tokens['color.on-danger'],
          textAlign: 'center',
        },
        actionLabelSafe: {
          color: tokens['color.foreground'],
        },
        /**
         * 行身那一层必须**不透明**，否则滑开之前动作条会透出来。
         * ⚠️ 底色取屏幕那一格的 `color.background`（`apps/mobile/src/ui/kit.tsx` 的
         * `Screen` 用的就是它）；宿主如果把列表放在别的底色上，得由宿主传进来，
         * 而不是在这里换一个颜色。
         */
        front: {
          width: '100%',
          backgroundColor: tokens['color.background'],
        },
        catcher: {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        },
      }),
    [text, tokens],
  );

  // 没有动作、或这一行不该响应手势 ⇒ 逐字节交回原来的那一行（不套任何壳）。
  if (actions.length === 0) return <>{children}</>;

  return (
    <View style={styles.shell} testID={testID}>
      <View style={styles.actions} testID={`${testID}-actions`}>
        {actions.map((action) => {
          const danger = isDangerousRowAction(action.id);
          const pending = danger && confirmDanger && confirming;
          const label = pending ? (action.confirmingLabel ?? action.label) : action.label;
          return (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              // 🔴 改口那一态把那句事实**说出来**：滑出的这一枚放不下整句后果（72 宽），
              // 视觉上的整句落点在长按菜单里，这里至少让读屏用户知道"为什么要按两下"。
              accessibilityLabel={pending ? `${consequence} ${label}` : label}
              disabled={disabled}
              onPress={() => {
                if (danger && confirmDanger && !confirming) {
                  setConfirming(true);
                  return;
                }
                onAction(action.id);
                closeNow();
              }}
              style={[styles.action, danger ? styles.actionDanger : styles.actionSafe]}
              testID={`${testID}-${action.id}`}
            >
              {action.icon ?? null}
              <Text
                style={[styles.actionLabel, danger ? null : styles.actionLabelSafe]}
                numberOfLines={2}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Animated.View style={[styles.front, { transform: [{ translateX: offset }] }]} {...pan.panHandlers}>
        {children}
        {open ? (
          // 滑开之后，行身那一片是"收口"而不是"打开详情"：
          // 否则用户按在原地会把详情打开，而他刚做的事是"把删除露出来"。
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            onPress={closeNow}
            style={styles.catcher}
            testID={`${testID}-close`}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}
