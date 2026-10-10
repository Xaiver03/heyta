import React from 'react';
import { View } from 'react-native';
import { Path, Svg } from 'react-native-svg';
import { useHeytaTokens } from '../theme.js';

/** Original micro-icons requested for habit statistics, designed on a 24-unit grid.
 * These are product artwork, separate from the standard Lucide control icons.
 * Color communicates the metric category, never its current success/failure.
 */
export const HABIT_METRIC_PATHS = {
  month: ['M6 3v4M18 3v4M4 9h16M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2', 'm8 15 3 3 5-6'],
  total: ['M5 20v-5M12 20V9M19 20V3', 'M3 20h18'],
  rate: ['M20 12a8 8 0 1 1-8-8', 'M15 3v6h6', 'm8 13 3 3 4-5'],
  streak: ['M13 2c1 5-5 6-3 10 2-1 3-3 3-5 4 4 7 7 5 11-2 4-9 5-12 1-3-4 0-8 2-10-1 4 1 5 2 5', 'M12 15c-3 2-3 5 0 6 3-1 3-4 0-6'],
  best: ['M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4', 'M12 13v6M8 21h8M9 19h6'],
  target: ['M20 12a8 8 0 1 1-8-8M16 12a4 4 0 1 1-4-4', 'm12 12 8-8M16 4h4v4'],
  calendar: ['M7 3v4M17 3v4M4 9h16M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2', 'M8 13h2M14 13h2M8 17h2M14 17h2'],
  journal: ['M7 3h12v18H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM7 3v18', 'M10 8h6M10 12h6M10 16h4'],
} as const;

export type HabitMetricKind = keyof typeof HABIT_METRIC_PATHS;

export function HabitMetricIcon({ kind, size, label }: {
  kind: HabitMetricKind; size?: number; label?: string;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const color = kind === 'streak' || kind === 'best'
    ? tokens['color.warning-strong']
    : kind === 'month' || kind === 'rate'
      ? tokens['color.success-strong'] : tokens['color.primary'];
  return <View accessible={label !== undefined} accessibilityLabel={label}
    accessibilityElementsHidden={label === undefined} aria-hidden={label === undefined}>
    <Svg width={size ?? tokens['icon.sm']} height={size ?? tokens['icon.sm']}
    viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round">
    {HABIT_METRIC_PATHS[kind].map((d, index) => <Path key={index} d={d} />)}
  </Svg></View>;
}
