/**
 * 专注面板（共享）
 * ==================
 *
 * M3 第二刀的主角：**番茄钟的计时核心只有这一个实现**。
 * 进度环、倒计时、阶段文案、主按钮 / 中止按钮、今日已完成、落盘失败提示，
 * 全部由这里渲染；web 与 mobile 只决定"把它放在页面的哪里"，
 * 以及下面挂哪些**各端特有**的东西（web 的时长设置、mobile 的类型胶囊与统计卡）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 迁之前两端各有一份：web 的 `FocusTimer.tsx`（环形 SVG + 内联样式）与
 * mobile 的 `FocusScreen.tsx`（水平进度条 + RN 原语）。它们读的是**同一份**
 * 领域状态机，却各自回答"暂停之后主按钮该干什么"这类问题 —— 而两份答案
 * 之间的差异**不会让任何测试变红**（web 那份把"暂停 → 开始"实现成了重新开始，
 * 因为 `resume()` 一直没有调用点）。这正是 §1.4「一个列表 + 类型化 cell」
 * 在专注这一项上的对应物：**统一的是契约，不是样式表。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList.tsx` 同一个理由（见那里的文件头）：i18n 包曾自己带一份 React，
 * 让 Android 产物出现两个 React 实例，报错位置离根因很远 —— 仓库里因此有
 * `check:mobile-bundle` 盯着。共享层是四端共用的，它一旦拖进 React，
 * 四个端会同时中招。所以 `labels` 里的每一项都是函数（文案依赖状态），
 * 模板留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `Pressable` 在 `react-native-web` 上都有等价实现；
 * `<div>` 在 iOS 上不存在。图标走 `../icon/Icon.tsx`（数据来自框架无关的
 * `lucide`，渲染用 `react-native-svg`），所以两端画的是同一个字形。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Pause, Play, Square } from 'lucide';
import { focusElapsedMs, type FocusState } from '@heyta/domain';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens, useHeytaUiTheme } from '../theme.js';
import { FocusRing } from './FocusRing.js';
import {
  FOCUS_MODE_ORDER,
  focusDisplayText,
  focusPrimaryAction,
  toFocusViewModel,
  type FocusMode,
  type FocusPrimaryAction,
} from './model.js';

/**
 * 面板全部文案。**每一项都由宿主注入**（见文件头）。
 *
 * `phase` 与 `primary` 是函数而不是字符串：文案依赖当前状态
 * （"专注中"/"已暂停"/"准备好了就开始"，"开始专注"/"暂停"/"继续"），
 * 而"状态 → 文案"的映射属于词条表那一侧。
 */
export interface FocusPanelLabels {
  /** 阶段行文案。返回 undefined 或空串时不渲染 —— 空闲态无需废话解释。 */
  readonly phase: (state: FocusState) => string | undefined;
  /** 主按钮可见文案。 */
  readonly primary: (action: FocusPrimaryAction, state: FocusState) => string;
  /** 主按钮无障碍名。省略时退回可见文案。 */
  readonly primaryA11y?: (action: FocusPrimaryAction, state: FocusState) => string;
  /** 中止按钮文案 —— **同时也是它的无障碍名**（真机验收靠它定位）。 */
  readonly abort: string;
  /** 进度环的无障碍名，例如「进度 42%」。 */
  readonly ring: (percent: number) => string;
  /** 本轮时长说明（「本轮 25 分钟」）。省略则不渲染。 */
  readonly roundLength?: string;
  /** 今日已完成（整句）。省略则不渲染。 */
  readonly completed?: string;
  /** 落盘失败（整句）。省略则不渲染。 */
  readonly error?: string;
}

export interface FocusPanelProps {
  readonly state: FocusState;
  /** 重绘节拍给出的当前时刻。剩余量每次由领域层重算，这里只传值。 */
  readonly now: number;
  readonly labels: FocusPanelLabels;
  readonly onStart: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  /** 中止并落盘（记为未自然完成）。 */
  readonly onAbort: () => void;
  /** 环正上方的目标/阶段轻入口（如 `专注 ›` / `{任务名} ›`），与环共处同一条居中轴。 */
  readonly header?: React.ReactNode;
  /** 空闲且倒计时模式下点击中央时间数字触发自定义时长。 */
  readonly onTimePress?: () => void;
  readonly timePressA11y?: string;
  readonly timePressTestID?: string;
  /** 宿主特有的区块。 */
  readonly children?: React.ReactNode;
  /**
   * 按钮组是否**撑满容器宽度**（主按钮 `flex:1`，中止按钮按内容）。
   *
   * 🔴 这是**外壳差异**，不是外观偏好：手机端的内容区有确定宽度，主按钮
   * 撑满才够按；web 端的面板是内容宽，撑满会让按钮横跨整页。
   *
   * ⚠️ 它同时是**真机验收**的前提：`scripts/verify-mobile-focus.sh` 在空闲态
   * 取一次主按钮坐标，之后整轮都点它 —— 而"空闲时只有主按钮、计时中多出
   * 中止按钮"会让内容宽的行重新居中，主按钮中心左右移动。撑满时主按钮
   * 的左缘与宽度不随中止按钮出现而变，那个坐标才一直是同一个按钮。
   */
  readonly fillControls?: boolean;
  /**
   * 模式切换：提供 `onModeChange` 与 `modeLabels` 才渲染（页面中部、环下方）。
   * 切换只在 idle 生效（领域层 `selectMode` 判），运行中两颗胶囊灰显。
   */
  readonly onModeChange?: (mode: FocusMode) => void;
  readonly modeLabels?: { group: string; countdown: string; countup: string };
  /**
   * 是否撑满容器并**竖直居中**（immersive 全屏档用）。
   * 专注页要的是「环在屏高中部、按钮在拇指区」，而不是把内容堆在顶部。
   */
  readonly fill?: boolean;
  readonly testID?: string;
}

/** 主按钮字形。与文案同源 —— 两者不能各判一次（见 `focusPrimaryAction`）。 */
const PRIMARY_GLYPH = {
  start: Play,
  pause: Pause,
  resume: Play,
} as const;

export function FocusPanel({
  state,
  now,
  labels,
  onStart,
  onPause,
  onResume,
  onAbort,
  header,
  onTimePress,
  timePressA11y,
  timePressTestID,
  children,
  fillControls,
  onModeChange,
  modeLabels,
  fill,
  testID,
}: FocusPanelProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const { reducedMotion } = useHeytaUiTheme();

  const view = toFocusViewModel(state, now);
  const action = focusPrimaryAction(state);
  const primaryLabel = labels.primary(action, state);
  const primaryA11y = labels.primaryA11y?.(action, state) ?? primaryLabel;
  const phaseText = labels.phase(state);
  const canPressTime = onTimePress !== undefined && view.idle && view.mode === 'countdown';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          alignItems: 'center',
          gap: tokens['space.6'],
        },
        rootFill: {
          flex: 1,
          justifyContent: 'center',
          gap: tokens['space.8'],
          minHeight: 0,
        },
        modeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.1'],
          padding: tokens['space.1'],
          borderRadius: tokens['radius.full'],
          backgroundColor: tokens['color.surface-sunken'],
        },
        modePill: {
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.4'],
          borderRadius: tokens['radius.full'],
          alignItems: 'center',
          justifyContent: 'center',
        },
        modePillSelected: {
          backgroundColor: tokens['color.surface'],
        },
        /** 环中央的文字块。 */
        face: {
          alignItems: 'center',
          gap: tokens['space.1'],
        },
        timeHit: {
          minHeight: tokens['touch-target.min'],
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: tokens['space.2'],
          borderRadius: tokens['radius.md'],
        },
        controls: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.3'],
        },
        controlsFill: {
          alignSelf: 'stretch',
        },
        buttonFill: {
          flex: 1,
        },
        button: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens['space.2'],
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.8'],
          borderRadius: tokens['radius.full'],
        },
        abortButton: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens['space.2'],
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.5'],
          borderRadius: tokens['radius.full'],
        },
        tabular: {
          // 数字等宽：计数变化时宽度不跳。`tabular-nums` 是唯一的字形特性。
          fontVariant: ['tabular-nums'],
        },
      }),
    [tokens],
  );

  const onPrimary = (): void => {
    if (action === 'pause') onPause();
    else if (action === 'resume') onResume();
    else onStart();
  };

  const displayNode = (
    <Text style={[text['focus-display'], { color: tokens['color.foreground'] }]}>
      {focusDisplayText(state, now)}
    </Text>
  );

  return (
    <View style={[styles.root, fill === true ? styles.rootFill : null]} testID={testID}>
      {header}

      <FocusRing
        progress={view.progress}
        elapsedMs={focusElapsedMs(state, now)}
        variant={view.mode === 'countup' ? 'dial' : 'progress'}
        tone={view.tone}
        label={labels.ring(view.percent)}
        testID="focus-ring"
      >
        <View style={styles.face}>
          {/* 大号计时数字。空闲倒计时态点击本身就是改时长的入口，不另堆说明按钮。 */}
          {canPressTime ? (
            <Pressable
              onPress={onTimePress}
              accessibilityRole="button"
              accessibilityLabel={timePressA11y ?? focusDisplayText(state, now)}
              testID={timePressTestID ?? 'focus-time-trigger'}
              style={({ pressed }) => [
                styles.timeHit,
                { opacity: pressed && !reducedMotion ? tokens['state.pressed-opacity'] : 1 },
              ]}
            >
              {displayNode}
            </Pressable>
          ) : (
            displayNode
          )}
          {phaseText === undefined || phaseText === '' ? null : (
            <Text style={[text['row-meta'], { color: tokens['color.foreground-muted'] }]}>
              {phaseText}
            </Text>
          )}
        </View>
      </FocusRing>

      {/*
        模式切换（正计时 / 倒计时）—— **页面中部、环正下方**，不占顶部 tab、不占底部。
        它改变的是「这一轮怎么计时」，视线本就落在环上，放在环下伸手可及。
        只在 idle 可切（领域层 `selectMode` 也判一次，不靠这里当唯一防线）。
      */}
      {modeLabels === undefined || onModeChange === undefined ? null : (
        <View
          style={styles.modeRow}
          accessibilityRole="tablist"
          accessibilityLabel={modeLabels.group}
          testID={testID === undefined ? 'focus-mode' : `${testID}-mode`}
        >
          {FOCUS_MODE_ORDER.map((m) => {
            const selected = view.mode === m;
            const enabled = view.idle;
            const label = m === 'countup' ? modeLabels.countup : modeLabels.countdown;
            return (
              <Pressable
                key={m}
                onPress={() => {
                  if (enabled) onModeChange(m);
                }}
                disabled={!enabled}
                accessibilityRole="tab"
                aria-selected={selected}
                accessibilityLabel={label}
                testID={`focus-mode-${m}`}
                style={({ pressed }) => [
                  styles.modePill,
                  selected ? styles.modePillSelected : null,
                  {
                    opacity:
                      !enabled && !selected
                        ? tokens['state.disabled-opacity']
                        : pressed && !reducedMotion
                          ? tokens['state.pressed-opacity']
                          : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    text['row-title'],
                    { color: selected ? tokens['color.primary'] : tokens['color.foreground-muted'] },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {labels.roundLength === undefined ? null : (
        <Text style={[text.caption, { color: tokens['color.foreground-subtle'] }]}>
          {labels.roundLength}
        </Text>
      )}

      <View style={[styles.controls, fillControls === true ? styles.controlsFill : null]}>
        <Pressable
          onPress={onPrimary}
          accessibilityRole="button"
          accessibilityLabel={primaryA11y}
          testID="focus-primary"
          style={({ pressed }) => [
            styles.button,
            fillControls === true ? styles.buttonFill : null,
            {
              backgroundColor: tokens['color.primary'],
              opacity: pressed && !reducedMotion ? tokens['state.pressed-opacity'] : 1,
            },
          ]}
        >
          <HeytaIcon
            data={PRIMARY_GLYPH[action]}
            size={tokens['icon.sm']}
            color={tokens['color.on-primary']}
          />
          <Text style={[text.headline, { color: tokens['color.on-primary'] }]}>
            {primaryLabel}
          </Text>
        </Pressable>

        {/* 只有真的在计时才给「放弃」—— 空闲时它没有可放弃的东西。 */}
        {view.idle ? null : (
          <Pressable
            onPress={onAbort}
            accessibilityRole="button"
            accessibilityLabel={labels.abort}
            testID="focus-abort"
            style={({ pressed }) => [
              styles.abortButton,
              {
                backgroundColor: tokens['color.surface-sunken'],
                opacity: pressed && !reducedMotion ? tokens['state.pressed-opacity'] : 1,
              },
            ]}
          >
            <HeytaIcon
              data={Square}
              size={tokens['icon.sm']}
              color={tokens['color.foreground-muted']}
            />
            <Text style={[text.headline, { color: tokens['color.foreground-muted'] }]}>
              {labels.abort}
            </Text>
          </Pressable>
        )}
      </View>

      {labels.completed === undefined ? null : (
        <Text style={[text.caption, { color: tokens['color.foreground-muted'] }, styles.tabular]}>
          {labels.completed}
        </Text>
      )}

      {children}

      {/* 🔴 落盘失败必须看得见。静默的话用户会以为记录存下了。 */}
      {labels.error === undefined ? null : (
        <Text
          accessibilityRole="alert"
          style={[text['row-meta'], { color: tokens['color.danger'] }]}
        >
          {labels.error}
        </Text>
      )}
    </View>
  );
}
