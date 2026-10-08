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

/**
 * A profile route remains mounted while another root tab is visible.  Keep the
 * route lookup separate from the active-tab check so a hidden profile surface
 * can retain its draft/result state without registering visible-only handlers.
 */
export function isProfileAssistantVisible(
  tab: TabKey,
  stacks: NavigationStacks,
): boolean {
  return tab === 'profile' && stacks.profile.at(-1)?.key === 'profile:assistant';
}
