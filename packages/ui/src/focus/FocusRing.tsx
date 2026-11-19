/**
 * 进度环（共享）
 * ==============
 *
 * web 端原来用 DOM `<svg>` 手写，mobile 端用一条水平进度条 —— 同一件事
 * （"这一轮走到哪了"）两种形状、两份实现。M3 第二刀把它收成一份：
 * **环本身只有这一个实现，两端只决定把它放在哪。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么这里可以放心用 `react-native-svg`
 *
 * `react-native-svg` 在 iOS / Android / 鸿蒙（`@react-native-oh-tpl/react-native-svg`）
 * 以及 web（自带的 `ReactNativeSVG.web.js`，见 `apps/web/vite.config.ts` 的别名）
 * 上都有实现，此前已经用在 `../icon/Icon.tsx` 的图标渲染上。
 * 所以"共享层画一个圆"不是新风险，是**同一条已验证的路**。
 *
 * ⚠️ 与 web 旧实现有**一处刻意的差异**：旧实现给 `stroke-dashoffset` 加了
 * `transition: … var(--ht-duration-fast) linear`，RN 没有等价的 CSS 过渡
 * （`react-native-svg` 也不暴露这个属性）。所以环现在是**逐帧重绘**而不是
 * 平滑补间。倒计时本身的判据（剩余时间由时间戳重算）完全没变，
 * 少的只是两帧之间的一次视觉补间。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 几何值全部来自 token
 *
 * 直径与描边宽度是 `size.focus-ring` / `size.focus-ring-stroke`（见
 * `packages/design-system/src/tokens.css`）。不在这里写字面量的理由不是洁癖：
 * 这个组件会被**四个端同时渲染**，一个裸数字改一处不会带动另外三处。
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Circle, Line, Svg, Text as SvgText } from 'react-native-svg';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import type { FocusTone } from './model.js';

const ROMAN_NUMERALS = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'] as const;

export interface FocusRingProps {
  /** 进度 0–1。越界值会被夹取 —— 越界在 RN 里不报错，只会画到容器外。 */
  readonly progress: number;
  /**
   * 环的外观：
   *   · `progress`（默认）—— 画进度弧（倒计时那一轮走到哪了）。
   *   · `dial`          —— 画刻度盘、不画进度弧（正计时没有「总长」，用钟表式刻度）。
   */
  readonly variant?: 'progress' | 'dial';
  /** 正计时已经走的毫秒数；只驱动 `dial` 的三根指针，缺省指向 XII。 */
  readonly elapsedMs?: number;
  /** 工作段 / 休息段。颜色承载语义，不是装饰。 */
  readonly tone: FocusTone;
  /** 整环的无障碍名（例如「进度 42%」）。钟面数字是装饰，读屏以它为准。 */
  readonly label: string;
  /** 环中央的内容（倒计时、阶段文字…）。 */
  readonly children?: React.ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function FocusRing({
  progress,
  variant = 'progress',
  elapsedMs = 0,
  tone,
  label,
  children,
  style,
  testID,
}: FocusRingProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const dialText = useHeytaText().caption;
  const size = tokens['size.focus-ring'];
  const stroke = tokens['size.focus-ring-stroke'];
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // 夹取到 0–1：`progress` 来自领域层（已夹过），这里再夹一次是**渲染守卫** ——
  // 越界宽度/偏移在 RN 里既不报错也不警告，只是画错。
  const clamped = Math.min(1, Math.max(0, progress));
  const offset = circumference * (1 - clamped);

  /**
   * 正计时钟面使用**不旋转**的坐标系，角度零点固定在 XII（正上方）。
   * 倒计时仍单独旋转整个 Svg；这里的刻度、数字与指针都不受它影响。
   * 所有几何从环的直径 / 描边 token 派生，指针端点直接计算，不依赖 SVG transform。
   */
  const cx = size / 2;
  const tickOuter = radius + stroke / 2;
  const tickCount = 60;
  const dialTicks = Array.from({ length: tickCount }, (_, i) => {
    const angle = (i / tickCount) * Math.PI * 2 - Math.PI / 2;
    const long = i % 5 === 0;
    const inner = tickOuter - (long ? stroke * 1.6 : stroke * 0.9);
    return {
      key: `tick-${String(i)}`,
      x1: cx + Math.cos(angle) * inner,
      y1: cx + Math.sin(angle) * inner,
      x2: cx + Math.cos(angle) * tickOuter,
      y2: cx + Math.sin(angle) * tickOuter,
      long,
    };
  });
  const numeralRadius = tickOuter - stroke * 3.2;
  const dialNumerals = ROMAN_NUMERALS.map((text, i) => {
    const angle = (i / ROMAN_NUMERALS.length) * Math.PI * 2;
    return {
      text,
      x: cx + Math.sin(angle) * numeralRadius,
      y: cx - Math.cos(angle) * numeralRadius,
    };
  });
  const elapsed = Math.max(0, elapsedMs);
  const handAngles = {
    hour: (elapsed / (12 * 60 * 60_000)) * Math.PI * 2,
    minute: (elapsed / (60 * 60_000)) * Math.PI * 2,
    second: (elapsed / 60_000) * Math.PI * 2,
  };
  const dialHands = [
    {
      id: 'hour',
      angle: handAngles.hour,
      length: numeralRadius * 0.55,
      strokeWidth: tokens['border-width.thick'] * 2,
      color: tokens['color.foreground'],
    },
    {
      id: 'minute',
      angle: handAngles.minute,
      length: numeralRadius * 0.85,
      strokeWidth: tokens['border-width.thick'],
      color: tokens['color.foreground'],
    },
    {
      id: 'second',
      angle: handAngles.second,
      length: numeralRadius,
      strokeWidth: tokens['border-width.thin'],
      color: tone === 'work' ? tokens['color.focus-work'] : tokens['color.focus-break'],
    },
  ].map((hand) => ({
    ...hand,
    x2: cx + Math.sin(hand.angle) * hand.length,
    y2: cx - Math.cos(hand.angle) * hand.length,
  }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
        // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
        // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
        // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      testID={testID}
      style={[styles.wrap, { width: size, height: size }, style]}
    >
      {/*
        🔴 只有倒计时旋转**整个 Svg**：让圆弧从顶部开始，避开 `react-native-svg`
        `rotation` + `origin` 的跨端差异。正计时钟面绝不继承这个旋转，
        否则 XII 会落到左边、罗马数字也会整体侧转。
      */}
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        style={[StyleSheet.absoluteFill, variant === 'progress' ? styles.rotated : null]}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tokens['color.border']}
          strokeWidth={stroke}
        />
        {variant === 'dial' ? (
          <>
            {dialTicks.map((t) => (
              <Line
                key={t.key}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke={tokens['color.border-strong']}
                strokeWidth={t.long ? tokens['border-width.thick'] : tokens['border-width.thin']}
                strokeLinecap="round"
              />
            ))}
            {dialNumerals.map((numeral) => (
              <SvgText
                key={numeral.text}
                x={numeral.x}
                y={numeral.y}
                fill={tokens['color.foreground-muted']}
                fontSize={dialText.fontSize}
                fontWeight={dialText.fontWeight}
                letterSpacing={dialText.letterSpacing}
                textAnchor="middle"
                alignmentBaseline="central"
                accessible={false}
              >
                {numeral.text}
              </SvgText>
            ))}
            {dialHands.map((hand) => (
              <Line
                key={hand.id}
                testID={`focus-dial-${hand.id}-hand`}
                x1={cx}
                y1={cx}
                x2={hand.x2}
                y2={hand.y2}
                stroke={hand.color}
                strokeWidth={hand.strokeWidth}
                strokeLinecap="round"
              />
            ))}
            <Circle
              cx={cx}
              cy={cx}
              r={stroke / 2}
              fill={tone === 'work' ? tokens['color.focus-work'] : tokens['color.focus-break']}
            />
          </>
        ) : (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone === 'work' ? tokens['color.focus-work'] : tokens['color.focus-break']}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        )}
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * 圆画在**绝对定位**的一层上，中央内容走正常流并被居中。
   *
   * 🔴 不能让 `<Svg>` 和中央内容一起参与流式布局：RN 默认是纵向 flex，
   * 两者会上下堆叠 —— 结果是环被挤出自己的方框、中央文字掉到环下面。
   * 而那**不会报错**，只会让计时器看起来"跑到框外面去了"。
   */
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotated: {
    transform: [{ rotate: '-90deg' }],
  },
});
