import type { MessageKey } from '@heyta/i18n';

/**
 * 快捷键一览的**登记表**（覆盖图谱 #7）。
 *
 * 这里只放「有哪些快捷键、叫什么、归哪个作用域」这三件事，**不放任何按键处理**：
 * 键位匹配是 `@heyta/ui` 的 `shortcut-model` 纯函数，一览面板只是把这张表画出来。
 *
 * ## 规范串的写法
 *
 * `combo` 一律以 `Meta` 表示**主修饰键**（macOS 的 ⌘ / Windows 的 Ctrl）——
 * 详见 `@heyta/ui` 的 `shortcut-model.ts` 里 `keyComboFromEvent` 那段。
 * 于是同一条登记在两个平台都成立，不必按平台各存一份。
 *
 * ⚠️ 这张表是**只读一览**的数据源：本仓这一轮不做「自定义键位」的持久化改写
 * （那要动 `local-api` 的偏好存储与全部按键消费方，属于另一条线）。一览里的
 * 每一条都必须与真实按键处理同源 —— 所以它和 `App.tsx` 的监听读的是同一组常量
 * （`COMMAND_PALETTE_COMBOS` / `SHORTCUT_OVERVIEW_COMBOS`）。
 */

export type ShortcutScope = 'global' | 'navigation' | 'palette';

export interface ShortcutEntry {
  readonly id: string;
  readonly labelKey: MessageKey;
  /** 规范串，可有多个（如上下各一枚）。 */
  readonly combos: readonly string[];
  readonly scope: ShortcutScope;
}

/** 打开命令面板的键（`App.tsx` 的监听与一览面板同读这一组）。 */
export const COMMAND_PALETTE_COMBOS = ['Meta+Shift+P'] as const;

/** 打开「快捷键一览」的键。 */
export const SHORTCUT_OVERVIEW_COMBOS = ['Meta+/'] as const;

/** 作用域的显示顺序（一览面板按它分组）。 */
export const SHORTCUT_SCOPE_ORDER: readonly ShortcutScope[] = ['global', 'navigation', 'palette'];

/** 每个作用域标题的词条 key。 */
export const SHORTCUT_SCOPE_LABEL_KEYS: Readonly<Record<ShortcutScope, MessageKey>> = {
  global: 'web.shortcuts.scope.global',
  navigation: 'web.shortcuts.scope.navigation',
  palette: 'web.shortcuts.scope.palette',
};

/**
 * 一览的全部条目。**顺序即显示顺序**，按作用域分段。
 */
export const SHORTCUT_CATALOG: readonly ShortcutEntry[] = [
  { id: 'commandPalette', labelKey: 'web.shortcuts.action.commandPalette', combos: ['Meta+Shift+P'], scope: 'global' },
  { id: 'shortcutOverview', labelKey: 'web.shortcuts.action.shortcutOverview', combos: ['Meta+/'], scope: 'global' },
  { id: 'settings', labelKey: 'web.shortcuts.action.settings', combos: ['Meta+,'], scope: 'global' },
  { id: 'search', labelKey: 'web.shortcuts.action.search', combos: ['Meta+K'], scope: 'global' },
  { id: 'toggleDetail', labelKey: 'web.shortcuts.action.toggleDetail', combos: ['Meta+Shift+\\'], scope: 'global' },
  { id: 'move', labelKey: 'web.shortcuts.action.move', combos: ['ArrowUp', 'ArrowDown'], scope: 'navigation' },
  { id: 'open', labelKey: 'web.shortcuts.action.open', combos: ['Enter'], scope: 'navigation' },
  { id: 'toggleComplete', labelKey: 'web.shortcuts.action.toggleComplete', combos: ['Space'], scope: 'navigation' },
  { id: 'contextMenu', labelKey: 'web.shortcuts.action.contextMenu', combos: ['Shift+F10'], scope: 'navigation' },
  { id: 'close', labelKey: 'web.shortcuts.action.close', combos: ['Escape'], scope: 'navigation' },
  { id: 'paletteMove', labelKey: 'web.shortcuts.action.move', combos: ['ArrowUp', 'ArrowDown'], scope: 'palette' },
  { id: 'paletteRun', labelKey: 'web.shortcuts.action.runCommand', combos: ['Enter'], scope: 'palette' },
  { id: 'paletteClose', labelKey: 'web.shortcuts.action.close', combos: ['Escape'], scope: 'palette' },
];
