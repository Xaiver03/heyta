import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  COMMAND_CURSOR_NONE,
  filterCommands,
  formatKeyCombo,
  moveCommandCursor,
  type Command,
  type ShortcutPlatform,
} from '@heyta/ui';

import { SHORTCUT_SCOPE_ORDER, type ShortcutScope } from './shortcut-catalog.js';

/**
 * 命令面板 + 快捷键一览（覆盖图谱 #6 / #7）
 * =========================================
 *
 * 一个浮层，两种内容：
 * · `commands` —— 可搜索的动作清单（↑↓ 选、回车执行）；
 * · `shortcuts` —— 按作用域分类的快捷键一览（只读）。
 *
 * ## 分工（与 `@heyta/ui` 的 `command-registry` / `shortcut-model` 配套）
 *
 * 过滤、光标位移、键位格式化全是 `@heyta/ui` 的纯函数；本组件只做**渲染与焦点**两件属于宿主的事。
 * 命令的 `run` 与快捷键文案都由 `App.tsx` 在绑定层注入 —— 这里不含任何业务判断。
 *
 * ## 形态纪律（读者必看）
 *
 * · **不是 `role="dialog"`、不带 `aria-modal`**：它是非模态的键盘浮层（与搜索浮层同族，
 *   下层视图继续渲染）。输入用 `role="combobox"` + `role="listbox"` 的标准 ARIA 1.2 形状，
 *   于是它不进 `check:overlay` 的模态账本（那本账只许减不许增）。
 * · **焦点环不在这里画**：全局焦点 CSS 是单一来源（`check:focus-single-source`），
 *   这里只给结构，不写 `:focus-visible` 环。
 */

export interface CommandPaletteLabels {
  readonly title: string;
  readonly inputAria: string;
  readonly placeholder: string;
  readonly noResults: string;
  /** 命令分组 id → 分组标题（`navigate` / `create` / `open`）。 */
  readonly groupLabels: Readonly<Record<string, string>>;
  /** 命令列表末尾那条「查看键盘快捷键」的标题。 */
  readonly shortcutsEntry: string;
  /** 快捷键一览的标题（进入一览态后显示）。 */
  readonly shortcutsTitle: string;
  /** 作用域 id → 标题。 */
  readonly scopeLabels: Readonly<Record<ShortcutScope, string>>;
}

/** 已解析成当前语言的快捷键条目（`labelKey` 在 App 里 `t()` 过）。 */
export interface ResolvedShortcut {
  readonly id: string;
  readonly label: string;
  readonly combos: readonly string[];
  readonly scope: ShortcutScope;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly mode: 'commands' | 'shortcuts';
  readonly commands: readonly Command[];
  readonly shortcuts: readonly ResolvedShortcut[];
  readonly labels: CommandPaletteLabels;
  readonly onClose: () => void;
  /** 从命令列表切到「快捷键一览」。 */
  readonly onOpenShortcuts: () => void;
}

const SHORTCUTS_ENTRY_ID = '__shortcuts';

/** 把任意 id 变成合法的 HTML id（只保留字母数字，其余换 `-`）。 */
function optionId(id: string): string {
  return `ht-command-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function detectPlatform(): ShortcutPlatform {
  if (typeof navigator === 'undefined') return 'other';
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'darwin' : 'other';
}

export function CommandPalette(props: CommandPaletteProps): React.JSX.Element | null {
  const { open, mode, commands, shortcuts, labels, onClose, onOpenShortcuts } = props;
  const platform = useMemo(detectPlatform, []);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<number>(COMMAND_CURSOR_NONE);

  /** 命令列表 = 宿主给的动作 + 末尾那条「查看键盘快捷键」。 */
  const commandList = useMemo<Command[]>(
    () => [
      ...commands,
      { id: SHORTCUTS_ENTRY_ID, title: labels.shortcutsEntry, group: 'open', run: onOpenShortcuts },
    ],
    [commands, labels.shortcutsEntry, onOpenShortcuts],
  );

  const filtered = useMemo(() => filterCommands(commandList, query), [commandList, query]);

  /** 打开 / 切态时把查询词与光标归零（每次进来都是干净的一屏）。 */
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(COMMAND_CURSOR_NONE);
  }, [open, mode]);

  /** 结果变短时把光标夹回范围内（不许出现"选中的是第 5 条，但只有 3 条"）。 */
  useEffect(() => {
    setActive((current) => {
      if (current === COMMAND_CURSOR_NONE) return current;
      if (current >= filtered.length) return filtered.length === 0 ? COMMAND_CURSOR_NONE : filtered.length - 1;
      return current;
    });
  }, [filtered.length]);

  /** 打开（命令态）时把焦点放进输入框。 */
  useEffect(() => {
    if (!open || mode !== 'commands') return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, mode]);

  /** Esc 关浮层（捕获阶段，输入框在里面也收得到）。 */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const runAt = (index: number): void => {
    const command = filtered[index];
    if (command === undefined) return;
    if (command.id === SHORTCUTS_ENTRY_ID) {
      onOpenShortcuts();
      return;
    }
    // 先关面板再执行：视图切换会重画下层，浮层留着会盖在新视图上。
    onClose();
    command.run();
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => moveCommandCursor(current, filtered.length, 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => moveCommandCursor(current, filtered.length, -1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (active !== COMMAND_CURSOR_NONE) runAt(active);
      else if (filtered.length > 0) runAt(0);
    }
  };

  if (!open) return null;

  const rows: React.JSX.Element[] = [];
  let lastGroup: string | undefined;
  filtered.forEach((command, index) => {
    if (command.group !== lastGroup) {
      lastGroup = command.group;
      rows.push(
        <li key={`group-${command.group}`} role="presentation" className="ht-sheet__command-group">
          {labels.groupLabels[command.group] ?? command.group}
        </li>,
      );
    }
    const selected = index === active;
    rows.push(
      <li
        key={command.id}
        id={optionId(command.id)}
        role="option"
        aria-selected={selected}
        className={`ht-sheet__command-option${selected ? ' ht-sheet__command-option--active' : ''}`}
        onMouseMove={() => setActive(index)}
        onClick={() => runAt(index)}
      >
        <span className="ht-sheet__command-title">{command.title}</span>
        {command.keys !== undefined && command.keys.length > 0 ? (
          <span className="ht-sheet__command-keys">
            {command.keys.map((combo) => formatKeyCombo(combo, platform)).join(' ')}
          </span>
        ) : null}
      </li>,
    );
  });

  return (
    <div
      className="ht-sheet__command-overlay"
      data-testid="command-palette-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ht-sheet__command-card" role="presentation">
        {mode === 'commands' ? (
          <>
            <input
              ref={inputRef}
              type="text"
              className="ht-sheet__command-input"
              role="combobox"
              aria-expanded={true}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-label={labels.inputAria}
              placeholder={labels.placeholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(COMMAND_CURSOR_NONE);
              }}
              onKeyDown={onInputKeyDown}
              aria-activedescendant={
                active !== COMMAND_CURSOR_NONE && filtered[active] !== undefined
                  ? optionId(filtered[active].id)
                  : undefined
              }
              data-testid="command-palette-input"
            />
            <ul
              id={listboxId}
              role="listbox"
              aria-label={labels.title}
              className="ht-sheet__command-list"
              data-testid="command-palette-list"
            >
              {filtered.length === 0 ? (
                <li role="presentation" className="ht-sheet__command-no-results" data-testid="command-palette-no-results">
                  {labels.noResults}
                </li>
              ) : (
                rows
              )}
            </ul>
          </>
        ) : (
          <div className="ht-sheet__command-shortcuts" data-testid="shortcut-overview">
            <h2 className="ht-sheet__command-shortcuts-title">{labels.shortcutsTitle}</h2>
            <div className="ht-sheet__command-shortcuts-body">
              {SHORTCUT_SCOPE_ORDER.map((scope) => {
                const items = shortcuts.filter((entry) => entry.scope === scope);
                if (items.length === 0) return null;
                return (
                  <section key={scope} className="ht-sheet__command-scope">
                    <h3 className="ht-sheet__command-scope-title">{labels.scopeLabels[scope]}</h3>
                    <ul className="ht-sheet__command-scope-list">
                      {items.map((entry) => (
                        <li key={entry.id} className="ht-sheet__command-shortcut-row">
                          <span className="ht-sheet__command-shortcut-label">{entry.label}</span>
                          <span className="ht-sheet__command-shortcut-keys">
                            {entry.combos.map((combo) => formatKeyCombo(combo, platform)).join(' / ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
