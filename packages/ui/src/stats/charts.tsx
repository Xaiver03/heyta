/**
 * 手写 SVG 图表原语（覆盖图谱 #48 / #50 的图表载体）
 * ===================================================
 *
 * 🔴 **不引入任何图表库**（可维护性 + 许可证两道门，见 AGENTS §3.1–3.2）。
 * 这里用 `react-native-svg` 的几种基础图元（`Rect` / `Polyline`）手绘 —— 与
 * `focus/FocusRing.tsx` 同一条已验证的跨端路径（iOS / Android / 鸿蒙 / web
 * 都有 `react-native-svg` 实现）。
 *
 * 🔴 颜色与线宽全部来自 `useHeytaTokens()`（token 名 → 值），**没有裸值**：
 * 组件只说"我要主色"，色值由设计系统给。图是**纯展示**，不判断业务、
 * 不读 `@heyta/i18n`（无障碍名由宿主注入）。
 *
 * ⚠️ 数据为空 / 全零时不在这里写空态文案（那是宿主的活，且空态只有
 * `EmptyState` 一个实现）。本组件只把"零柱/零线"如实画出来。
 */

import React from 'react';
import { View } from 'react-native';
import { Polyline, Rect, Svg } from 'react-native-svg';

import { useHeytaTokens } from '../theme.js';

/** 一根柱 / 一个点。`key` 是稳定身份（React key 与无障碍遍历用）。 */
export interface ChartDatum {
  readonly key: string;
  readonly value: number;
}

/** 十字坐标系的逻辑宽度（viewBox 单位）。实际宽度由容器拉伸。 */
const VIEW_WIDTH = 100;

/**
 * 柱状图。
 *
 * 每根柱占一个等宽槽（柱宽 = 槽宽的 60%），高度按 `max` 归一。
 * `max` 缺省取"数据里最大的值"，全零时退到 1（避免除零）。
 */
export interface BarChartProps {
  readonly data: readonly ChartDatum[];
  /** SVG 高度（px）。宽度自适应容器。 */
  readonly height: number;
  /** 归一上限；缺省取数据最大值（再兜底 1）。 */
  readonly max?: number;
  /** 无障碍名（宿主注入的整张图事实，例如"近 8 周完成率"）。 */
  readonly ariaLabel: string;
  readonly testID?: string;
}

export function BarChart({ data, height, max, ariaLabel, testID }: BarChartProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const n = data.length;
  const top = max !== undefined && max > 0 ? max : Math.max(1, ...data.map((d) => d.value));
  const slot = n === 0 ? 0 : VIEW_WIDTH / n;
  const barWidth = slot * 0.6;

  return (
    <View accessibilityRole="image" accessibilityLabel={ariaLabel} testID={testID}>
      <Svg width="100%" height={height} viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(height)}`} preserveAspectRatio="none">
        {data.map((datum, i) => {
          const ratio = Math.min(1, Math.max(0, datum.value / top));
          // 最少给 0.5px 高：值 > 0 时它必须看得见（0 才是空白）。
          const barHeight = datum.value > 0 ? Math.max(0.5, ratio * height) : 0;
          return (
            <Rect
              key={datum.key}
              x={i * slot + (slot - barWidth) / 2}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              fill={tokens['color.primary']}
              rx={1}
            />
          );
        })}
      </Svg>
    </View>
  );
}

/**
 * 折线图。
 *
 * 每个点等距分布在逻辑宽度上（首点 x=0、末点 x=VIEW_WIDTH），
 * y 按 `max` 归一。只有一个点时画在正中（避免除零 / 无跨度）。
 */
export interface LineChartProps {
  readonly data: readonly ChartDatum[];
  readonly height: number;
  readonly max?: number;
  readonly ariaLabel: string;
  readonly testID?: string;
}

export function LineChart({ data, height, max, ariaLabel, testID }: LineChartProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const n = data.length;
  const top = max !== undefined && max > 0 ? max : Math.max(1, ...data.map((d) => d.value));
  const points = data
    .map((datum, i) => {
      const x = n <= 1 ? VIEW_WIDTH / 2 : (i / (n - 1)) * VIEW_WIDTH;
      const ratio = Math.min(1, Math.max(0, datum.value / top));
      const y = height - ratio * height;
      return `${String(x)},${String(y)}`;
    })
    .join(' ');

  return (
    <View accessibilityRole="image" accessibilityLabel={ariaLabel} testID={testID}>
      <Svg width="100%" height={height} viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(height)}`} preserveAspectRatio="none">
        {n > 0 ? (
          <Polyline
            points={points}
            fill="none"
            stroke={tokens['color.primary']}
            strokeWidth={tokens['border-width.thick']}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </Svg>
    </View>
  );
}
