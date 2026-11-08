/**
 * 顶层错误边界 —— **React 渲染期抛错不再等于整页白屏**
 * =====================================================
 *
 * 【为什么需要它（崩溃审计 2026-11-08 · U12 第 1 条 P0）】
 *
 * 审计时全仓 grep `ErrorBoundary|componentDidCatch|getDerivedStateFromError`
 * 命中 **0**。React 18 的语义是：**根树里任何组件在 render / 生命周期中抛错，
 * 整个 root 被卸载**。于是 `#root` 被清空、页面纯白 —— 没有错误文案、
 * 没有重试入口、连"发生了什么"都留不下。而且 `App.tsx` 里 0 个
 * `Suspense`/`lazy`，连一个可拦截面都没有。
 *
 * 对安装包里的桌面端更糟：`?shell=1` 走的是同一个 `#root`，
 * 白屏时首屏遮罩已经把品牌帧撤掉了，用户看到的是**纯白**。
 *
 * 【为什么是类组件】
 *
 * React 至今**没有**函数组件版的错误边界 —— `getDerivedStateFromError` 与
 * `componentDidCatch` 只能写在 class 上。这是框架限制，不是风格选择。
 *
 * 【为什么 fallback 用 `ErrorScreen`】
 *
 * 因为它是同一个仓里**已经被证明可以在无 Provider 环境下渲染**的那一屏
 * （见 `features/shell/ErrorScreen.tsx` 文件头：i18n context 有默认值，
 * 它不依赖任何 Provider）。错误边界崩掉时恰恰是最不能假设 Provider 还在的时刻。
 *
 * ⚠️ 边界**拦不住**：事件处理器里的抛错、async 函数里的 rejection、
 * `setTimeout` 回调里的抛错。那三类由 `lib/fatal-hooks.ts` 的全局钩子接。
 * 两条防线是互补的，不是重复。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { ErrorScreen } from '../features/shell/ErrorScreen.js';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 上报钩子（可选）。生产环境接日志，测试里接断言。 */
  onError?: (error: unknown, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | undefined;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 先留痕再上报：上报钩子自己也可能抛（它跑在边界的 catch 里），
    // 所以用 try 包住 —— **错误处理不能再变成新的错误源**。
    try {
      console.error('[heyta] 渲染期未捕获错误（已由 ErrorBoundary 接住）', error, info.componentStack);
    } catch {
      // console 被禁用之类的极端环境：什么都做不了，继续。
    }
    try {
      this.props.onError?.(error, info);
    } catch {
      // 上报失败不影响"用户至少能看到错误屏"这件事。
    }
  }

  /** 给错误屏一个真正能用的"重试"——重新挂载子树，而不是让用户自己找刷新。 */
  private readonly retry = (): void => {
    this.setState({ error: undefined });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    return (
      <ErrorScreen
        titleKey="web.error.crash.title"
        message={error.message}
        hintKey="web.error.crash.hint"
        onRetry={this.retry}
      />
    );
  }
}
