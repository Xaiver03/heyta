/**
 * 习惯图形（共享 · 原创位图）
 * ============================
 *
 * 习惯图标的 key 由 `@heyta/domain` 定义，图形由这一个共享组件渲染。
 * Web、移动端和原生壳因此不会各自维护一张 key → 图形的映射。
 * 运行时使用离线内嵌的透明 PNG；原始 atlas、切图脚本和来源登记保留在
 * `assets/illustrations/habits/`，便于重新生成和审阅。
 */

import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import type { HabitIcon } from '@heyta/domain';
import { ICON_SIZE } from '@heyta/design-system';

import generatedArtwork from './habit-artwork.generated.json';

export const HABIT_ARTWORK = generatedArtwork satisfies Record<HabitIcon, string>;

export interface HabitArtworkProps {
  readonly icon: HabitIcon;
  /** 默认使用设计系统的 `icon.md`；调用方可以传入列表/选择器尺寸。 */
  readonly size?: number;
  readonly style?: StyleProp<ImageStyle>;
  /** 省略时图形作为装饰隐藏；需要独立朗读时传入语义名称。 */
  readonly label?: string;
  readonly testID?: string;
}

/** 用统一的原创图形绘制一个习惯图标。它不承载状态或优先级语义。 */
export function HabitArtwork({ icon, size, style, label, testID }: HabitArtworkProps): React.JSX.Element {
  const resolvedSize = size ?? ICON_SIZE.md;
  return (
    <Image
      source={{ uri: HABIT_ARTWORK[icon] }}
      resizeMode="contain"
      accessible={label !== undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={label === undefined}
      testID={testID}
      style={[{ width: resolvedSize, height: resolvedSize }, style]}
    />
  );
}
