/**
 * `AiPanel` 的 **web 适配器**
 * =============================
 *
 * 与 `AiDisclosureHost` / `AiPanelHeadHost` 同一形状、同一理由：共享层的
 * `AiPanel` 会 `useHeytaTokens()`，**缺 Provider 是运行时抛错**；而三个 AI 面板
 * 由 `App.tsx` 直接渲染，不在 tasks 那棵 Provider 子树里。
 *
 * ⚠️ 与另外两个适配器一样，最小下一步是把 Provider 提到 `App.tsx` 根、
 * 一次删掉三个适配器里的 Provider —— 在那之前**不要只删一个**。
 *
 * ## 三件套原样透传
 *
 * `role` / `label` / `testID` 在这里**逐项透传**，不做任何默认值 ——
 * 默认值会让"忘了想这件事"静默通过（`AiPanel` 的文件头写着为什么）。
 */

import React from 'react';

import { AiPanel, HeytaUiProvider, type AiPanelRole } from '@heyta/ui';

export interface AiPanelHostProps {
  /** 无障碍名（`web.ai.*.aria`）。 */
  readonly label: string;
  /** 沿用改造前各面板自己的 testid —— web 测试与 e2e 都按它定位。 */
  readonly testID: string;
  readonly role: AiPanelRole;
  readonly children: React.ReactNode;
}

export function AiPanelHost({
  label,
  testID,
  role,
  children,
}: AiPanelHostProps): React.JSX.Element {
  return (
    <HeytaUiProvider>
      <AiPanel label={label} testID={testID} role={role}>
        {children}
      </AiPanel>
    </HeytaUiProvider>
  );
}
