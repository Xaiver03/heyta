/**
 * `AiPanelHead` 的 **web 适配器**
 * ================================
 *
 * 与 `AiDisclosureHost` 同一形状、同一理由：共享层的 `AiPanelHead` 会
 * `useHeytaUiTheme()` / `useHeytaTokens()`，**缺 Provider 是运行时抛错**
 * （P0 形状，仓库里踩过一次）。而三个 AI 面板由 `App.tsx` 直接渲染，
 * 它们**不在** tasks 那棵 Provider 子树里 —— 所以在适配器里挂一层最省事，
 * 也最不容易漏。
 *
 * ⚠️ 与 `AiDisclosureHost` 的那条注记一样：真正的最小下一步是把 Provider
 * 提到 `App.tsx` 根、删掉这些适配器里的 Provider。**在那之前不要**只在某一个
 * 面板上删掉这层 —— 那会让"别的面板还能用"与"这个面板崩了"同时成立。
 *
 * ## 关闭按钮的可访问名在这里注入（不是写死）
 *
 * 各面板的关闭语义不同：披露态是「取消」（关掉就什么都不做），失败态是
 * 「关闭」。共享组件只认 `closeLabel` 这一个字符串，选哪个由调用方决定 ——
 * 这正是"文案一律由宿主注入"那条纪律（共享层不 import `@heyta/i18n`）。
 */

import React from 'react';

import { AiPanelHead, HeytaUiProvider } from '@heyta/ui';

export interface AiPanelHeadHostProps {
  /** 标题。可以是拼好的句子（`AiDuration` 的提案标题里嵌着 `<strong>`）。 */
  readonly title: React.ReactNode;
  /** 标题前的装饰图标（工具调用面板的 Sparkles）。 */
  readonly lead?: React.ReactNode;
  /** 右端的来源标签（本机 / 远端）。 */
  readonly tag?: {
    readonly text: string;
    readonly testID: string;
  };
  readonly onClose?: (() => void) | undefined;
  /** 关闭按钮的可访问名（`web.ai.action.cancel` / `.close`）。 */
  readonly closeLabel?: string | undefined;
  readonly closeTestID?: string | undefined;
}

export function AiPanelHeadHost({
  title,
  lead,
  tag,
  onClose,
  closeLabel,
  closeTestID,
}: AiPanelHeadHostProps): React.JSX.Element {
  return (
    <HeytaUiProvider>
      <AiPanelHead
        title={title}
        {...(lead === undefined ? {} : { lead })}
        {...(tag === undefined ? {} : { tag })}
        {...(onClose === undefined ? {} : { onClose })}
        {...(closeLabel === undefined ? {} : { closeLabel })}
        {...(closeTestID === undefined ? {} : { closeTestID })}
      />
    </HeytaUiProvider>
  );
}
