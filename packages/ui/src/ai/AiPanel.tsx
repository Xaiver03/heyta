/**
 * AI 面板的**容器**（共享层）
 * ============================
 *
 * 与 `AiPanelHead` 同一刀的形状：web 里 19 个 `ht-ai__panel` 容器各写一遍
 * `className` + `role` + `aria-label` + `data-testid`（其中 6 个还漏了后两个，
 * 见 `docs/plans/site-and-parity-alignment.md` 的"第 3 刀"）。这里把**卡片样式 +
 * 无障碍三件套**收成一份。
 *
 * ## 🔴 `role` 与 `label` 都是**必填**
 *
 * 不是"有默认值就行"：容器必须说得出自己是什么（`dialog`）还是"正在等"
 * （`status`）。给 `role` 一个默认值会让"忘了想这件事"变成静默通过 ——
 * 而这个缺陷上一轮刚发生过一次（工具调用的失败/结果两个容器没有任何
 * role/aria，读屏用户在那里会失去上下文）。
 *
 * ## ⚠️ `fontSize` 是**给 web 的**，RN 原生会忽略
 *
 * web 的 `.ht-ai__panel` 靠 `font-size: xs` **继承**给子元素（面板里有不少裸文本，
 * 例如加载态的 `<span>正在等待…</span>`）。RN 没有继承，而 RNW 会把 View 上的
 * `fontSize` 照样渲染成 CSS ⇒ 继承链在 web 上成立。
 *
 * 代价说清楚：**原生两端这一条不生效**（View 上的 fontSize 被忽略）。
 * 今天没有影响 —— 移动端还没有 AI 面板（宿主 SecretStore 未实现）；
 * 等它有了，面板子元素本来就该是 RN `<Text>`，各自带语义样式。
 *
 * ## 文案一律宿主注入
 *
 * 本文件**不 import `@heyta/i18n`**（i18n 包自带一份 React，四端会同时中招）。
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useHeytaTokens } from '../theme.js';

/** 面板在读屏里的角色。加载态用 `status`（没有可操作内容），其余用 `dialog`。 */
export type AiPanelRole = 'dialog' | 'status';

export interface AiPanelProps {
  /**
   * 无障碍名。读屏用它念出"这是什么面板"。
   * 🔴 **必填** —— 没有名字的容器对读屏用户等于不存在。
   */
  readonly label: string;
  /** 沿用改造前各面板自己的 testid（`ai-failed` / `capture-loading`…）。 */
  readonly testID: string;
  /** 🔴 **必填**：见文件头"为什么 role 不给默认值"。 */
  readonly role: AiPanelRole;
  readonly children: React.ReactNode;
}

export function AiPanel({ label, testID, role, children }: AiPanelProps): React.JSX.Element {
  const tokens = useHeytaTokens();

  const styles = StyleSheet.create({
    panel: {
      flexDirection: 'column',
      gap: tokens['space.2'],
      padding: tokens['space.3'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.surface'],
      /**
       * ⚠️ 给 web 的**继承基座**（见文件头）：面板里的裸文本继承它。
       * RN 原生会忽略 View 上的 fontSize —— 那不是 bug，是这条路的已知边界。
       */
      fontSize: tokens['font-size.xs'],
    },
  });

  return (
    <View style={styles.panel} role={role} aria-label={label} testID={testID}>
      {children}
    </View>
  );
}
