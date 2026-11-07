/**
 * 骨架（共享）——「条数未知」的那一半
 * ===================================
 *
 * 判据出处：PRD R11 与 [`docs/plans/r11-states-audit-2026-11.md`] 建议 5：
 * **条数未知 ⇒ 骨架；条数已知 ⇒ 行内转圈**。两者是两件事：
 *   - 骨架说"这里**会**出现若干条，但还不知道有几条"；
 *   - 行内转圈说"这几条已经有了，正在刷新"。
 *
 * 所以骨架**只画"若干条等宽占位"**，不画数字、不画真实内容 —— 一旦知道条数，
 * 就该换成行内转圈（`<TaskRow busy>` 那一族），而不是继续用骨架。
 *
 * 🔴 **不做无限动画**：
 *   - `prefers-reduced-motion` 下必须是静态（`Skeleton.tsx` 里不放动画，
 *     只有可选的 `shimmer` 由 CSS/宿主决定）；
 *   - 真实动效会让"正在加载"看起来像"正在播放"，而且一个永动的 shimmer
 *     在省电模式下是纯粹的电池成本。
 *
 * `accessibilityRole="progressbar"` + `aria-busy`：读屏要念"正在加载"，
 * 而不是把 N 个空盒子逐个念一遍（所以每条占位都是 `accessibilityElementsHidden`）。
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useHeytaTokens } from '../theme.js';

export interface SkeletonProps {
  /** 画几条。默认 3 —— 面板里常见的条数。 */
  readonly rows?: number | undefined;
  /** 定位钩子。宿主传 `xxx-skeleton`，判据靠它区分"骨架在"与"空态在"。 */
  readonly testID?: string | undefined;
}

/**
 * 一条等宽占位的高度与圆角都走 token；**宽度用百分比**（骨架要跟着容器）。
 */
export function Skeleton(props: SkeletonProps): React.JSX.Element {
  const rows = Math.max(1, Math.floor(props.rows ?? 3));
  const tokens = useHeytaTokens();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { gap: tokens['space.2'], paddingVertical: tokens['space.2'] },
        row: {
          height: tokens['size.field-height'],
          borderRadius: tokens['radius.sm'],
          backgroundColor: tokens['color.surface-subtle'],
        },
      }),
    [tokens],
  );

  return (
    <View
      style={styles.root}
      accessibilityRole="progressbar"
      aria-busy
      testID={props.testID}
    >
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          style={styles.row}
          // 读屏不该把 N 个空盒子逐个念一遍；根节点已经说了"正在加载"。
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={props.testID === undefined ? undefined : `${props.testID}-row-${index}`}
        />
      ))}
    </View>
  );
}
