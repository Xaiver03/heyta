/**
 * 进度横条（共享视图）—— 激励体系里**唯一**一处横条实现
 * ======================================================
 *
 * 抽出来的理由不是"少写几行"，而是把一条**容易做错的规则**收敛到一个地方：
 *
 * 🔴 **首次渲染不播动画，只有挂载后的变化才播。**
 * Apple 的物理动效是对"用户刚才做了某事"的回应。页面刚打开时用户什么都没做，
 * 此刻横条从 0 长到 60% 是在演一个不存在的操作，它会让"我刚点了什么"变模糊 ——
 * 而这个错误**在截图里完全看不出来**，只有真的盯着看才会发现。
 *
 * 如果每个用到横条的组件各写一遍，这条规则一定会在某一份里漏掉。
 * 迁移前 web 的 `features/motivation/ProgressBar.tsx` 用它（CSS transition +
 * 挂载后才加 `--animated` 类），mobile 的 `ui/kit#ProgressBar` **完全没有动画**
 * —— 合并取 web 的口径，手机端因此第一次有了"变化才播"的横条。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 与 web 的一处**实现差异**（不是取舍，是被 RN 逼的）
 *
 * web 动的是 `transform: scaleX`（合成层，不触发布局）。RN 的 `scaleX`
 * **以中心为原点**缩放，从 0 长起来会朝两边长 —— 而 RN 0.84 的 TypeScript
 * 类型里**没有 `transformOrigin`**（实测 `grep` 其 `types/` 无此项），
 * 于是没法把原点固定到左边。这里改成给 `width` 插值
 * （`0%` → `100%`，`useNativeDriver: false`）。
 *
 * · 影响：动画期间每帧触发布局 —— 一条高 `size.progress-height` 的横条，
 *   实测观感无差别；但它是**真实存在的**性能差异，不粉饰。
 * · 最小一步：RN 类型补上 `transformOrigin` 后改回 `scaleX` +
 *   `useNativeDriver: true`，本文件是唯一的改动点。
 *
 * ⚠️ `prefers-reduced-motion` **不需要**在这里再查一次：主题层的
 * `resolveNativeTokens` 已经把 `duration.*` 压成近 0（见 `theme.tsx` 文件头）。
 * 在这里再写一遍就等于制造第二个降级策略。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语（`View` / `Animated` / `Text` / `StyleSheet`），不 import DOM 标签
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { progressRatio } from './model.js';

/** 横条的语义色调。`muted` 给"这一项还没开始"一类的场景用。 */
export type MotivationProgressTone = 'primary' | 'success' | 'muted';

/**
 * 色调 → 颜色 token。
 *
 * 🔴 类型刻意**不是** `TokenName`（那是全部 token 的联合，含间距/圆角等**数字**
 * token）：标成 `TokenName` 会让 `tokens[token]` 的类型变成 `string | number`，
 * 喂给 `backgroundColor` 直接编译不过 —— 与 `categories/model.ts` /
 * `habits/model.ts` 的 `HabitHeatToken` 同一个理由。
 * 取值只能在 `tokens.css` / `resolvedNativeTokens` 里改，组件不能自己发明色调。
 */
export type MotivationProgressToken = 'color.primary' | 'color.success' | 'color.foreground-muted';

const TONE_TOKEN: Record<MotivationProgressTone, MotivationProgressToken> = {
  primary: 'color.primary',
  success: 'color.success',
  muted: 'color.foreground-muted',
};

export interface MotivationProgressBarProps {
  /** 0–1。超出范围会被夹住 —— 依赖调用方先夹是不可靠的（见 `model.ts`）。 */
  readonly ratio: number;
  /**
   * 读屏用的一句话。**必填**：一根没有名字的横条对读屏用户等于不存在。
   * 与 web 的 `label` / mobile 的 `label` 同名同义。
   */
  readonly label: string;
  readonly tone?: MotivationProgressTone;
  /** 数值的可见文本（如 `3/5`）。给了就显示在横条右侧。 */
  readonly valueText?: string;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸尺度值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    track: {
      flex: 1,
      height: tokens['size.progress-height'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.surface-sunken'],
      // 溢出不画：填充条即使因为插值误差多出半像素，也不会盖住圆角。
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
    },
    /** 数值在**句子里**，等宽给在整段上（与 `HabitBoard` 的 `numeric` 同一条）。 */
    value: {
      fontVariant: ['tabular-nums'],
    },
  });
}

export function MotivationProgressBar({
  ratio,
  label,
  tone = 'primary',
  valueText,
  testID,
}: MotivationProgressBarProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const clamped = progressRatio(ratio);
  const percent = Math.round(clamped * 100);

  /**
   * 动画值。初始值就是**当前比例** —— 首帧因此画的是终值，没有"从 0 长出来"
   * 那段假动作（见文件头）。
   */
  const [width] = useState(() => new Animated.Value(clamped));
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      // 首帧：只认下"我挂载了"，不播动画。终值已经由初始化给了。
      mounted.current = true;
      return;
    }
    Animated.timing(width, {
      toValue: clamped,
      duration: tokens['duration.normal'],
      // ⚠️ `width` 不是 transform，原生驱动不支持它（见文件头）。
      useNativeDriver: false,
    }).start();
  }, [clamped, tokens, width]);

  const animatedWidth = width.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.row} testID={testID}>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
        // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
        // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <Animated.View
          style={[
            styles.fill,
            { width: animatedWidth, backgroundColor: tokens[TONE_TOKEN[tone]] },
          ]}
        />
      </View>
      {valueText === undefined ? null : (
        <Text style={[text.caption, styles.value, { color: tokens['color.foreground-muted'] }]}>
          {valueText}
        </Text>
      )}
    </View>
  );
}
