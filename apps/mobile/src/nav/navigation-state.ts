import type { TabKey } from './TabBar';

export interface NavigationEntry {
  readonly key: string;
}

export type NavigationStacks = Readonly<Record<TabKey, readonly NavigationEntry[]>>;

export function pushNavigationEntry(stacks: NavigationStacks, tab: TabKey, key: string): NavigationStacks {
  return { ...stacks, [tab]: [...(stacks[tab] ?? []), { key }] };
}

export function popNavigationEntry(stacks: NavigationStacks, tab: TabKey): NavigationStacks {
  const stack = stacks[tab] ?? [];
  return stack.length === 0 ? stacks : { ...stacks, [tab]: stack.slice(0, -1) };
}
