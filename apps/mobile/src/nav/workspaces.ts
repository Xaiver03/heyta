/**
 * 底栏工作空间的展示规格（label / icon）与可见 tab 计算。
 *
 * 🔴 为什么单独一个文件：`nav/TabBar.tsx` 的 `TABS` 必须保持**字面量 5 项**——
 * `apps/mobile/tests/feature-entries.spec.ts` 与 `account-security-wiring.spec.ts`
 * 都按源码解析 `TABS`（前者数全文件 `key:` 出现次数=5，后者数 TABS 块内 key=5）。
 * 把可选工作空间（含 habits/countdown 这类功能域 key）留在 TabBar.tsx 里会让那两条
 * 铁律判红。规格表放这里，TabBar 只 import 计算结果。
 *
 * key 的唯一来源仍在 `tab-preferences.ts`（DIY 偏好的读写与校验）。
 */
import type { MessageKey } from '@heyta/i18n';
import type { IconName } from '../ui/icons';
import {
  DEFAULT_TAB_BAR_WORKSPACES,
  type WorkspaceKey,
} from './tab-preferences';

export interface WorkspaceTabSpec {
  readonly key: WorkspaceKey;
  readonly labelKey: MessageKey;
  readonly icon: IconName;
}

/** 六个可选工作空间的展示规格（顺序即设置面板里的默认罗列顺序）。 */
export const WORKSPACE_TAB_META: readonly WorkspaceTabSpec[] = [
  { key: 'tasks', labelKey: 'mobile.tab.tasks', icon: 'tab.tasks' },
  { key: 'calendar', labelKey: 'mobile.tab.calendar', icon: 'tab.calendar' },
  { key: 'focus', labelKey: 'mobile.tab.focus', icon: 'tab.focus' },
  { key: 'ai', labelKey: 'mobile.tab.ai', icon: 'tab.ai' },
  { key: 'habits', labelKey: 'mobile.habits.entry', icon: 'tab.habits' },
  { key: 'countdown', labelKey: 'mobile.countdown.entry', icon: 'tab.countdown' },
];

export const PROFILE_TAB = {
  key: 'profile',
  labelKey: 'mobile.tab.profile',
  icon: 'tab.profile',
} as const satisfies { key: string; labelKey: MessageKey; icon: IconName };

/** 全部一级目的地：六个工作空间 + 固定最右的「我的」。 */
export type TabKey = WorkspaceKey | typeof PROFILE_TAB.key;

/**
 * 按用户偏好算出**可见的底栏**：workspaces 顺序 → 对应规格，末尾永远接「我的」。
 * 空/非法输入回默认；不去重（`tab-preferences` 写入前已保证 2–4 且唯一）。
 */
export function tabSpecsFor(workspaces: readonly WorkspaceKey[]): readonly WorkspaceTabSpec[] | readonly (WorkspaceTabSpec | typeof PROFILE_TAB)[] {
  const source = workspaces.length === 0 ? DEFAULT_TAB_BAR_WORKSPACES : workspaces;
  const ordered = source
    .map((key) => WORKSPACE_TAB_META.find((spec) => spec.key === key))
    .filter((spec): spec is WorkspaceTabSpec => spec !== undefined);
  return [...ordered, PROFILE_TAB];
}
