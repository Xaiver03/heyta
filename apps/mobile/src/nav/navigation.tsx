/**
 * 移动端一级 tab + 二级页面栈。
 *
 * tab 是根目的地；任何详情、设置或编辑器都应该 push 到当前 tab 的栈里。
 * 栈按 tab 分开保存，所以切换 tab 不会销毁另一 tab 的返回位置和滚动状态。
 */
import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import type { TabKey } from './TabBar';
import {
  popNavigationEntry,
  pushNavigationEntry,
  type NavigationEntry,
  type NavigationStacks,
} from './navigation-state';
export type { NavigationEntry, NavigationStacks } from './navigation-state';

interface NavigationValue {
  readonly tab: TabKey;
  readonly setTab: (tab: TabKey) => void;
  /** All tab stacks; a hidden tab remains mounted and keeps its route state. */
  readonly stacks: NavigationStacks;
  readonly stack: readonly NavigationEntry[];
  readonly push: (key: string) => void;
  readonly pop: () => boolean;
  /** A visible second-level surface can consume Back before the tab stack. */
  readonly setBackHandler: (handler: (() => boolean) | null) => void;
  readonly canGoBack: boolean;
}

const NavigationContext = createContext<NavigationValue | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>('tasks');
  const [stacks, setStacks] = useState<NavigationStacks>({
    tasks: [], calendar: [], focus: [], categories: [], profile: [],
  });
  const backHandlerRef = useRef<(() => boolean) | null>(null);
  const stack = stacks[tab] ?? [];
  const push = (key: string): void => {
    setStacks((previous) => pushNavigationEntry(previous, tab, key));
  };
  const pop = (): boolean => {
    if (stack.length === 0) return false;
    setStacks((previous) => popNavigationEntry(previous, tab));
    return true;
  };

  React.useEffect(() => {
    const handler = (): boolean => {
      if (backHandlerRef.current?.() === true) return true;
      if (pop()) return true;
      if (tab !== 'tasks') {
        setTab('tasks');
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => subscription.remove();
  });

  const value = useMemo<NavigationValue>(
    () => ({
      tab,
      setTab,
      stacks,
      stack,
      push,
      pop,
      canGoBack: stack.length > 0,
      setBackHandler: (handler) => {
        backHandlerRef.current = handler;
      },
    }),
    [tab, stack, stacks],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useMobileNavigation(): NavigationValue {
  const value = useContext(NavigationContext);
  if (value === null) throw new Error('useMobileNavigation must be used inside NavigationProvider');
  return value;
}
