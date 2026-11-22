/**
 * Web 顶部栏（DOM 版的 TopBar）
 * ==============================
 *
 * 与共享层 `@heyta/ui` 的 `TopBar`（RN 版，移动端用）**同一份槽位契约**：
 *   `leading` ｜ `title` ｜ `trailing`（如 habits 插槽）｜ `children`（actions 区）
 *
 * 🔴 为什么是两份实现而不是一份：Web 外壳是 **DOM + CSS 类**（`.ht-header*`），
 *   不是 React Native Web；把 RN 的 `TopBar` 塞进来会与 `.ht-header` 的 CSS 打架，
 *   还会丢掉大量 e2e 依赖的类名与 testid。所以"平台差异"落在这一层：
 *   **摆位契约（有哪些槽、顺序如何）保持一致，渲染实现各按各的运行时。**
 *
 * 这是从 `App.tsx` 里那坨 `<header>` 抽出来的 —— 抽出后 App 只传槽位，
 * 顶栏的摆放（前导 → 标题 → 插槽 → 动作）只在**这一处**决定。
 */

import type { ReactNode } from 'react';

export interface WebTopBarProps {
  /** 页面标题（渲染进 `.ht-header__title`）。 */
  readonly title: ReactNode;
  /** 前导槽：侧栏/范围开关等。 */
  readonly leading?: ReactNode;
  /** 标题后的插槽（如 habits 的页头控件）。 */
  readonly trailing?: ReactNode;
  /** 动作区：整块 `.ht-header__actions`。 */
  readonly children?: ReactNode;
  /** 额外的 header 修饰类（如日历的 `ht-header--calendar`，用于两层顶栏布局）。 */
  readonly className?: string;
}

export function WebTopBar({ title, leading, trailing, children, className }: WebTopBarProps): React.JSX.Element {
  return (
    <header className={className === undefined ? 'ht-header' : `ht-header ${className}`}>
      {leading}
      <h1 className="ht-header__title">{title}</h1>
      {trailing}
      {children}
    </header>
  );
}
