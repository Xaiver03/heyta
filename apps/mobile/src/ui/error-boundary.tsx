/**
 * 移动端顶层错误边界 —— 任意屏抛错不再等于整应用白屏
 * ===================================================
 *
 * 【为什么需要它（崩溃审计 2026-11-08 · U16 第 1 条 P0）】
 *
 * 审计时在 `apps/mobile/src`、`apps/mobile/index.js`、`packages/ui/src`
 * 全量 grep `ErrorBoundary|componentDidCatch|getDerivedStateFromError`
 * 命中 **0**。`index.js` 的 `registerComponent(appName, () => Root)` 直接把
 * `Root` 挂上去，树里没有任何边界。
 *
 * React 的语义是：**根树里任何组件在 render / 生命周期抛错，整棵树被卸载**。
 * 在 RN 的 **release** 构建里没有红屏 —— 用户看到的就是**纯白屏**，
 * 只能杀掉进程。而这里有 38 个屏共用同一个根，一处抛错整站不可用。
 *
 * 【为什么 fallback 不依赖任何 Provider】
 *
 * 出错时恰恰是最不能假设 Provider 还在的时刻（i18n / 主题 / 导航都可能就是
 * 崩溃原因本身）。所以兜底屏只用 RN 原语 + `useI18n()` 的默认值
 * （`@heyta/i18n` 的 context 有 `DEFAULT_LOCALE` 默认值，Provider 缺席也不抛）
 * —— 与 Web 侧 `ErrorScreen` 同一条取舍。
 *
 * 【拦不住什么】
 *
 * 事件处理器、async 函数、`setTimeout` 回调里的抛错。那三类不经过 React 的
 * 渲染阶段。移动端目前**没有**全局 `ErrorUtils` 钩子（Web 有 `fatal-hooks.ts`），
 * 这是下一步该补的一条 —— 本文件只解决"渲染期崩溃 = 白屏"这一条最粗的。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@heyta/i18n';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 上报钩子（可选）。它自己抛错会被吞掉。 */
  onError?: (error: unknown, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | undefined;
}

/** 兜底屏：只用 RN 原语，不依赖任何 Provider。 */
function CrashFallback({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.container} testID="crash-fallback">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{t('web.error.crash.title')}</Text>
        <Text style={styles.hint}>{t('web.error.crash.hint')}</Text>
        {/* 原始错误当"技术详情"，不当主文案 —— 它是跨包的中文。 */}
        <Text style={styles.detail} selectable>
          {message}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.retry}
          testID="crash-fallback-retry"
        >
          <Text style={styles.retryLabel}>{t('web.error.crash.retry')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    try {
      console.error('[heyta] 渲染期未捕获错误（已由 ErrorBoundary 接住）', error, info.componentStack);
    } catch {
      // console 不可用
    }
    try {
      this.props.onError?.(error, info);
    } catch {
      // 上报失败不影响"用户至少能看到兜底屏"
    }
  }

  private readonly retry = (): void => {
    this.setState({ error: undefined });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    return <CrashFallback message={error.message} onRetry={this.retry} />;
  }
}

/**
 * 兜底屏的样式刻意用**字面量**而不是设计 token：
 * 崩溃时 `ThemeProvider` 可能正是崩掉的那一环，取 token 会二次崩溃。
 * 这一条是 Web 侧 `ErrorScreen` 之外唯一被允许的例外（它至少保证能显示文字）。
 */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '600', color: '#111111' },
  hint: { fontSize: 15, lineHeight: 22, color: '#555555' },
  detail: { fontSize: 12, color: '#777777', fontFamily: 'monospace' },
  retry: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cccccc',
  },
  retryLabel: { fontSize: 15, color: '#111111' },
});
