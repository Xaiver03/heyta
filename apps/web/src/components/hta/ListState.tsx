import type { ReactNode } from 'react';

import { EmptyState, ErrorState, HeytaUiProvider, Skeleton } from '@heyta/ui';

import './hta.css';

export interface ListStateError {
  readonly title: string;
  readonly hint?: string;
  readonly retryLabel?: string;
}

export interface ListStateProps {
  /** 首屏（条数未知）→ Skeleton；刷新已知条数应走行内 busy，不叠加这里。 */
  readonly loading?: boolean;
  readonly error?: ListStateError | null;
  readonly onRetry?: () => void;
  readonly empty?: boolean;
  readonly emptyTitle?: string;
  readonly emptyHint?: string;
  readonly skeletonRows?: number;
  readonly testID?: string;
  readonly children: ReactNode;
}

/**
 * 列表三态容器：`loading → Skeleton` / `error → ErrorState(+retry)` / `empty → EmptyState`。
 *
 * 🔴 三件套**全部复用 `@heyta/ui`**（`EmptyState`/`ErrorState`/`Skeleton`），不重造。
 * 🔴 它们都经 `useHeytaTokens` 取色 ⇒ 必须落在 `HeytaUiProvider` 之内。这里就地包一层：
 *    既保证运行时不出「必须在 Provider 内」的抛错，也满足 `check:ui-provider` 的
 *    消费者必须位于 Provider 子树内的判据（外壳本身可能先于根 Provider 被消费）。
 */
export function ListState({
  loading = false,
  error = null,
  onRetry,
  empty = false,
  emptyTitle = '',
  emptyHint,
  skeletonRows = 3,
  testID,
  children,
}: ListStateProps): React.JSX.Element {
  return (
    <HeytaUiProvider>
      <div className="hta-list-state" data-testid={testID}>
        {loading ? (
          <Skeleton rows={skeletonRows} testID={testID === undefined ? undefined : `${testID}-skeleton`} />
        ) : error !== null ? (
          <ErrorState
            labels={{ title: error.title, hint: error.hint, retryLabel: error.retryLabel }}
            onRetry={onRetry}
            testID={testID === undefined ? undefined : `${testID}-error`}
          />
        ) : empty ? (
          <EmptyState
            title={emptyTitle}
            hint={emptyHint}
            testID={testID === undefined ? undefined : `${testID}-empty`}
          />
        ) : (
          children
        )}
      </div>
    </HeytaUiProvider>
  );
}
