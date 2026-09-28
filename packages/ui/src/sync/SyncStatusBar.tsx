/**
 * 同步状态条（共享）
 * ====================
 *
 * M3 第四刀（sync）的主角之一：**"这个同步状态长什么样、要不要紧"只有这一个实现。**
 * 字形（勾 / 转圈 / 云被划掉 / 警示三角）、文字颜色、live region 语义，
 * 全部由这里决定；两侧的按钮（立即同步 / 设置 / 处理冲突 / 查看帮助）
 * 是**宿主动作区**，由 `actions` 插槽注入。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它
 *
 * 状态 → 色调这条映射此前两端各有一份，而且**三行对不上**
 * （`offline`：web 警示 / mobile 不是错误；`syncing`：web 信息 / mobile 普通；
 * `conflict`：web 警示 / mobile 危险）。两份答案之间的差异**不会让任何测试变红**，
 * 只会让同一个同步状态在浏览器和手机上呈现成三种不同的态度。
 * 判断本身收在 `./model.ts`（有单测），本文件只把它摆到 RN 原语上。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList.tsx` / `FocusPanel.tsx` / `CategoryReport.tsx` 同一个理由：
 * i18n 包曾自己带一份 React，让 Android 产物出现两个 React 实例。
 * `labels.status` 是函数而不是字符串 —— 措辞依赖状态（下载 vs 上传是两句话）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，且**只在 `{actions}` 插槽里允许宿主放自己的按钮**
 *
 * 为什么按钮不共享：两个端的按钮原语不同（web 是 `ht-btn` CSS 类 +
 * 真实 `<button>`，mobile 是 kit 的 `Button`），而 web 现有测试要求
 * "两个保留按钮是真实 `<button disabled>`" —— RNW 的 `Pressable` 只产出
 * `aria-disabled`，**不产出 DOM 的 `disabled` 属性**（`forwardedProps`
 * 白名单里没有它，见 `react-native-web/dist/modules/forwardedProps`）。
 * 所以按钮留在宿主，共享层负责"哪个状态该有哪些按钮"（`syncStatusAffordances`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 一个有意的视觉变化（如实记下）：`syncing` 的转圈
 *
 * 迁之前 web 用 `<Loader2 className="ht-spin">` —— 圈是靠**页面 CSS 动画**
 * 转的。共享层不许写 CSS 类（那是 L4 的方言），所以改用 RN 的
 * `ActivityIndicator`：它在 web 与原生上都是同一个"系统转圈"，
 * 代价是 web 上转圈的具体外观从 Lucide 描边变成 RNW 自绘的环。
 * 信息量不变（"正在进行"），但像素不同 —— 记在这里，不假装没发生。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 宿主必须把它包在 `<HeytaUiProvider>` 之内
 *
 * 本组件透过 `useHeytaTokens` / `useHeytaText` 取样式，缺 Provider 会
 * **运行时抛错**（类型与单测都不会红）。⚠️ 新组件目前**还没登记进**
 * `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT` 清单
 * （那个脚本不在本刀白名单里），所以这道门禁今天**不覆盖它** ——
 * 宿主侧的 Provider 是本地自己挂的（见 `apps/web/src/features/sync/SyncBar.tsx`
 * 文件头）。把这两个组件登记进清单是最小可行的下一步。
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, CheckCircle2, CloudOff } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  syncStatusColorToken,
  syncStatusGlyph,
  type SyncStatusLike,
} from './model.js';

/** 状态条文案。**整句由宿主拼**（措辞依赖状态，模板在有 i18n 的那一侧）。 */
export interface SyncStatusBarLabels {
  readonly status: (status: SyncStatusLike) => string;
}

export interface SyncStatusBarProps {
  readonly status: SyncStatusLike;
  readonly labels: SyncStatusBarLabels;
  /**
   * 宿主动作区（立即同步 / 同步设置 / 处理冲突 / 查看帮助）。
   *
   * 共享层决定**哪些状态该有哪些动作**（`syncStatusAffordances`），
   * 但按钮本体属于各端的原语，由宿主渲染。
   */
  readonly actions?: React.ReactNode;
  readonly testID?: string;
}

/** 语义字形 → `lucide` 数据。`spinner` 不在表里（它走 `ActivityIndicator`）。 */
const GLYPH_DATA = {
  check: CheckCircle2,
  'cloud-off': CloudOff,
  alert: AlertTriangle,
} as const;

/** 取一份 token 表建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: ReturnType<typeof useHeytaTokens>) {
  return StyleSheet.create({
    root: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    /** 字形 + 文字。它自己被读屏当成一句状态。 */
    line: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
  });
}

export function SyncStatusBar({
  status,
  labels,
  actions,
  testID,
}: SyncStatusBarProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const glyph = syncStatusGlyph(status);
  const color = tokens[syncStatusColorToken(status)];

  return (
    // 同步状态是异步变化的，用 live region 让屏幕阅读器播报。
    <View style={styles.root} role="status" aria-live="polite" testID={testID}>
      <View style={styles.line}>
        {glyph === 'spinner' ? (
          // 🔴 转圈走 `ActivityIndicator` 而不是描边图标（见文件头）。
          <ActivityIndicator size="small" color={color} />
        ) : (
          <HeytaIcon data={GLYPH_DATA[glyph]} size={tokens['icon.xs']} color={color} />
        )}
        <Text style={[text.caption, { color }]}>{labels.status(status)}</Text>
      </View>
      {actions}
    </View>
  );
}
