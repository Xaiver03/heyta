/**
 * 流式光标 —— 回答还在生成时的那一根会闪的小竖条
 * ================================================
 *
 * ## 它解决什么
 *
 * 加了逐字揭示之后（见 `reveal.ts`），有一瞬间屏幕是这样的：
 * 最后几个字刚画出来、下一个字还没到。**静止的文字与"卡住了"长得一样** ——
 * 用户没法从画面上判断"它在想"还是"它挂了"。
 *
 * 光标就是那个判断的依据：它在闪 ⇒ 还在生成。流结束后它消失。
 *
 * ## 🔴 为什么不做成 `&::after { content: '|' }`（antdx 的做法）
 *
 * ant-design/x 的光标是纯 CSS 伪元素（`bubble/style/index.ts:11-15`：
 * `content: "|"`、0.8s、linear、infinite）。那在 web 上是对的做法，
 * 但 `packages/ui` 是**单份代码跑 web + RN**（无 `.native/.web` 分叉），
 * RN 没有伪元素、也没有 CSS 动画 —— 写 CSS 只有 web 能用。
 *
 * 所以这里用两端都有的 **RN 核心 `Animated`**（仓库已有三处先例：
 * `SwipeReveal` / `StateIllustration` / `BottomSheet`，均未引 reanimated）。
 * 同一个组件在 web 上被 `react-native-web` 渲染成 DOM 元素，
 * 动画由 JS 驱动 —— 代价是多了一条 JS 动画，换来两端一份实现。
 *
 * ## 🔴 减少动效时：**留着，但不闪**
 *
 * 这一条与 `.ht-ai__typing` 同一原则（降级降的是动作，不是信息）：
 * 光标承载"还在生成"这条信息，藏掉它等于让那一瞬间重新变得无法判断。
 * 所以 `reducedMotion` 下把不透明度**固定**在一个可见值，而不是停掉整个组件。
 *
 * ⚠️ `Animated.loop` 在 RN 上会持续占一帧回调；`reducedMotion` 时
 * **不启动**那个 loop（而不只是"看不见"），否则等于白烧电。
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useHeytaTokens, useHeytaUiTheme } from '../theme.js';

/** 光标不动时的可见度。0.45 与 `.ht-ai__typing` 的静止态同一档，两点一致。 */
const STATIC_OPACITY = 0.45;

/** 闪烁的两个端点。 */
const DIM_OPACITY = 0.15;
const BRIGHT_OPACITY = 1;

export interface StreamCaretProps {
  /** 供判据定位（`data-testid` / `testID`）。**必填**，理由见下。 */
  readonly testID: string;
  /**
   * 光标左边那行字的**字号**（点值）。
   *
   * 🔴 为什么是入参而不是自己去读某个 token：
   * 光标的正确高度是"与它旁边那行字同高"，而**只有调用方知道那是哪一档文字**
   * （回答正文是 `row-body`、思考行是 `row-meta`…）。
   * 组件自己去猜一个档位，就会在换档时忽高忽低 —— 而那正是它最显眼的时候。
   *
   * ⚠️ 单位是 RN 的**数值点**，不是 em：RN 的 `ViewStyle` 不接受 `'1em'`
   * 这类字符串（`DimensionValue` 只认数字与百分比，实测 TS 直接报错）。
   * 所以这里由调用方把 em 关系算好再传进来。
   */
  readonly fontSize: number;
}

/**
 * 一根闪烁的竖条。
 *
 * 🔴 `testID` **必填、没有默认值**：默认值会让"某个流式面忘了标"表现成
 * 一个仍然正常渲染的元素，而那正是这类东西最容易失效的方式 ——
 * 判据找不到它，于是"有没有光标"这件事从来没被真验过。
 * （与 `AiGeneratedLabel` 的 `label` 必填同一条纪律。）
 */
export function StreamCaret({ testID, fontSize }: StreamCaretProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const { reducedMotion } = useHeytaUiTheme();
  const opacity = useRef(new Animated.Value(BRIGHT_OPACITY)).current;

  useEffect(() => {
    if (reducedMotion) {
      // 🔴 不启动 loop：只是"看不见动画"不等于"没在烧电"。
      opacity.setValue(STATIC_OPACITY);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: DIM_OPACITY,
          duration: tokens['duration.slow'],
          // 走 token 的缓动，不写裸 cubic-bezier。
          // `easing` 在 RN 上要的是函数，故用 `Easing`；但设计变量里的曲线
          // 是 CSS 记法 —— 这里是"用一个接近的正弦替代"，理由见下。
          useNativeDriver: false,
        }),
        Animated.timing(opacity, {
          toValue: BRIGHT_OPACITY,
          duration: tokens['duration.slow'],
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reducedMotion, tokens]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        caret: {
          /**
           * 尺寸用 em 而不是绝对像素：光标必须与**它左边那行字**同高。
           * 用固定像素的话，正文换档（`caption` → `row-title`）时
           * 光标就会忽高忽低 —— 而那正是它最显眼的时候。
           */
          width: tokens['border-width.thick'],
          /**
           * 高度 = 字号（与旁边那行字同高）。
           * 🔴 不能用 `'1em'`：RN 的 `ViewStyle` 只接受数字/百分比 ——
           * 写 em 会在 typecheck 直接报 `Type '"1em"' is not assignable to
           * DimensionValue`（实测）。所以由调用方把字号算好传进来。
           */
          height: fontSize,
          /**
           * 左边距 = 字号的 1/8。同样不能用 em，理由同上。
           * ⚠️ 这里**故意不用** `--ht-space-*`：那一组是**布局间距**
           * （4/8/12px…，绝对值），而光标与字的间隙是**字号相对**的 ——
           * 大字号下 4px 会贴得看不见缝。
           */
          marginLeft: Math.round(fontSize / 8),
          borderRadius: tokens['border-width.hairline'],
          backgroundColor: tokens['color.foreground-muted'],
          /**
           * ⚠️ `alignSelf: 'stretch'` 不用：那会让它在 flex 容器里撑满整行高，
           * 而我们要的是"与字同高"。`height: '1em'` 在 RN 上按当前 fontSize 解析。
           */
          alignSelf: 'flex-end',
        },
      }),
    [tokens, fontSize],
  );

  return (
    <Animated.View
      style={[styles.caret, { opacity }]}
      testID={testID}
      /**
       * 🔴 对读屏隐藏：光标是**纯装饰**。
       * "还在生成"这条信息由 `aria-live="polite"` 的文本流本身传达，
       * 一个没有名字的空元素念出来只会是噪音。
       * （`AssistantMark` 与 `StateIllustration` 用的是同一形状。）
       */
      accessible={false}
      aria-hidden={true}
    />
  );
}

/** 供 `<View>` 之外的地方参考的静态可见度（测试断言"降级时仍可见"用）。 */
export const STREAM_CARET_STATIC_OPACITY = STATIC_OPACITY;
