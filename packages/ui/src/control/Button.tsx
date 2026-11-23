/**
 * `Button` —— 四端共用的按钮原语
 * ==============================
 *
 * ## 这枚补的是哪个洞
 *
 * 到 2026-11-23，仓里有**两套**按钮、**零个**共享实现：
 *
 *   · Web：`apps/web/src/styles/app/controls.css` 的 `.ht-btn` + 色调修饰类。
 *     类名在 `.tsx` 里被**手写**了 210 次（`grep -rn 'ht-btn' apps/web/src --include=*.tsx`）；
 *   · Mobile：`apps/mobile/src/ui/kit.tsx` 的 `Button`。
 *
 * 两套的**判断**早就在 `control/states.ts` 里收成了一份（`CONTROL_PALETTE`
 * 写 token 名，不写色值），但那只是"颜色该用哪个"；"一枚按钮怎么摆、按下怎么反馈、
 * 状态发成什么属性"仍然各写各的。于是 web 侧每加一个动作就再手写一次类名，
 * 而类名写错不会报错，只会少一层底色。
 *
 * ## 边界（读清楚，别当成已完成）
 *
 * · 🔴 **零文案**：`label` / `ariaLabel` 由宿主注入，本包不 import `@heyta/i18n`。
 * · 🔴 **零业务**：`onPress` 原样回吐，不知道按下去会发生什么。
 * · ⚠️ **Web 的 hover 靠 `onHoverIn/onHoverOut`**：RN 没有 hover 概念，
 *   这两个回调是 RNW 的实现细节，但在真 RN 上只是不触发 —— 所以两端共用一份
 *   代码时，移动端永远拿 `hoverBg` 的**静止**档，这正是它要的。
 * · ⚠️ **Web 的焦点环不在这里画**：`borderless-controls.css` 用
 *   `:is(button, [role='button'], …):focus-visible` 一处定义（`check:focus-single-source`
 *   守着）。本组件只负责渲染出 `role="button"` 且可聚焦，画环是那一份的事。
 * · ⚠️ **Web 的按下涟漪（`::after` 扩散）没有搬进来**：RN 没有伪元素，
 *   那一层是 web 的装饰细节；按下反馈在两端统一走 `motion.press-scale` 缩放
 *   （`CONTROL_STATE_TOKENS.pressScale`）。**视觉差异已登记**，不是漏搬。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useHeytaText, useHeytaTokens, useHeytaUiTheme } from '../theme.js';
import {
  CONTROL_STATE_TOKENS,
  DEFAULT_CONTROL_EMPHASIS,
  DEFAULT_CONTROL_TONE,
  controlAria,
  controlPaletteOf,
  type ControlEmphasis,
  type ControlTone,
  type SelectionContext,
} from './states.js';

export interface ButtonBaseProps {
  /** 按钮上的字。 */
  readonly label?: string | undefined;
  /**
   * 前置图标节点（`lucide-react` / `lucide-react-native` 的图标由宿主注入）。
   *
   * 🔴 这里**不收 `children`**：RN 里裸字符串不能直接放进 `View`，
   * 而"图标 + 字"若交给调用方拼，每个人都要记得把字包进 `<Text>` ——
   * 漏一次就是运行时红屏（"Text strings must be rendered within a <Text>"），
   * 而 web 上同一个写法可能只是渲染得难看一点，于是没人会发现。
   * 形状收在组件里，调用方只给"图标"和"字"两样。
   */
  readonly icon?: React.ReactNode;
  /** 色调。默认 `secondary` —— 与 `DEFAULT_CONTROL_TONE` 同源，不在这里另立默认。 */
  readonly tone?: ControlTone | undefined;
  /** 重量。`commit` 只给确认层里那枚唯一要按下去的按钮。 */
  readonly emphasis?: ControlEmphasis | undefined;
  readonly onPress?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  /** 进行中：发 `aria-busy`、显示转圈、吞掉点击（区别于 `disabled`：它还会回来）。 */
  readonly busy?: boolean | undefined;
  /** 开关类按钮的按下态（发 `aria-pressed`）。 */
  readonly pressed?: boolean | undefined;
  /** 只有图标时的可访问名称。有可见文字时不必给。 */
  readonly ariaLabel?: string | undefined;
  /** 撑满容器宽度。 */
  readonly fullWidth?: boolean | undefined;
  /** 判据钩子。 */
  readonly testID?: string | undefined;
}

/**
 * 组里"当前那个"这两格**绑在一起**（与 `ControlStateAxes` 同一条规矩）。
 *
 * 🔴 不能写成两个可选字段：写了 `selected` 却不写 `selection`，`controlAria`
 * 就不知道该发 `aria-selected` 还是 `aria-current`，而它选择"什么都不发"——
 * 于是这一格在界面上没有任何痕迹，只在读屏里少一次播报。
 * 类型上绑死，才不会有人靠"记得"。
 */
export type ButtonSelection =
  | { readonly selected?: undefined; readonly selection?: undefined }
  | { readonly selected: boolean; readonly selection: SelectionContext };

export type ButtonProps = ButtonBaseProps & ButtonSelection;

export function Button(props: ButtonProps): React.JSX.Element {
  const {
    tone = DEFAULT_CONTROL_TONE,
    emphasis = DEFAULT_CONTROL_EMPHASIS,
    disabled = false,
    busy = false,
    fullWidth = false,
  } = props;

  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const { reducedMotion } = useHeytaUiTheme();

  const [hovered, setHovered] = useState(false);
  const [pressing, setPressing] = useState(false);

  /**
   * 🔴 配方查不到就**抛**，不兜成某一档默认色。
   *
   * `controlPaletteOf` 对词表外的名字返回 `undefined`，而调用方把它兜成
   * `secondary` 会让"新加了一个 tone 名字却没给配方"静默画成次要按钮 ——
   * 那正是 `states.ts` 要消灭的那类毛病（同一个意图四处各答各的）。
   * 类型上 TS 已经拦住；这里兜的是运行时（`as any`、JSON 驱动的宿主）。
   */
  const recipe = controlPaletteOf(tone, emphasis);
  if (recipe === undefined) {
    throw new Error(`<Button> 没有 tone="${tone}" 的配方：请先在 control/states.ts 的 CONTROL_PALETTE 登记`);
  }

  const scale = useRef(new Animated.Value(1)).current;
  const pressScale = tokens[CONTROL_STATE_TOKENS.pressScale];
  const pressDuration = reducedMotion ? 0 : tokens[CONTROL_STATE_TOKENS.pressDuration];

  useEffect(() => {
    Animated.timing(scale, {
      toValue: pressing ? pressScale : 1,
      duration: pressDuration,
      // `transform` 的 scale 在 RN 与 RNW 上由 JS 驱动即可；
      // 原生驱动在 RNW 上没有实现，传 true 只会在 web 上被静默忽略。
      useNativeDriver: false,
    }).start();
  }, [pressing, pressScale, pressDuration, scale]);

  const blocked = disabled || busy;

  const handlePress = useCallback(() => {
    if (blocked) return;
    props.onPress?.();
  }, [blocked, props]);

  const styles = useMemo(() => {
    const fill = (name: typeof recipe.bg): string =>
      name === 'transparent' ? 'transparent' : (tokens[name] as string);

    return StyleSheet.create({
      root: {
        minHeight: tokens['touch-target.min'],
        paddingHorizontal: tokens['space.4'],
        borderRadius: tokens['radius.button'],
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens['space.2'],
      },
      text: { ...text['body-sm'], color: tokens[recipe.fg] },
      fill: {
        backgroundColor: fill(recipe.bg),
      },
      hovered: {
        backgroundColor: fill(recipe.hoverBg),
      },
      /** 按下换底只有 `primary` 有配方；其余三档靠缩放表达（见 ControlPalette）。 */
      active: recipe.activeBg === undefined ? {} : { backgroundColor: fill(recipe.activeBg) },
      hoveredText: { color: tokens[recipe.hoverFg] },
      disabled: { opacity: tokens[CONTROL_STATE_TOKENS.disabledOpacity] },
      fullWidth: { alignSelf: 'stretch' },
    });
    // `recipe` 是 `controlPaletteOf` 的返回对象，引用稳定（表里的同一枚），
    // 所以按它入依赖不会在每次渲染重造 StyleSheet。
  }, [tokens, text, recipe]);

  const aria =
    props.selected === undefined
      ? controlAria({ pressed: props.pressed })
      : controlAria({ pressed: props.pressed, selected: props.selected, selection: props.selection });

  return (
    <Pressable
      accessibilityRole="button"
      aria-label={props.ariaLabel}
      aria-disabled={disabled || undefined}
      aria-busy={busy || undefined}
      {...aria}
      disabled={blocked}
      onPress={handlePress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPressIn={() => setPressing(true)}
      onPressOut={() => setPressing(false)}
      testID={props.testID}
      style={[
        styles.root,
        styles.fill,
        hovered && !blocked ? styles.hovered : null,
        pressing && recipe.activeBg !== undefined && !blocked ? styles.active : null,
        blocked ? styles.disabled : null,
        fullWidth ? styles.fullWidth : null,
      ]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] }}>
          {busy ? (
            <ActivityIndicator
              size="small"
              color={hovered ? tokens[recipe.hoverFg] : tokens[recipe.fg]}
            />
          ) : (
            props.icon ?? null
          )}
          {props.label === undefined ? null : (
            <Text style={[styles.text, hovered && !blocked ? styles.hoveredText : null]}>
              {props.label}
            </Text>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}
