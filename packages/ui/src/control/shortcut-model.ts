/**
 * 快捷键模型（键位解析 / 匹配 / 展示）—— 快捷键登记与一览的骨架
 * ============================================================
 *
 * 覆盖图谱 #7「快捷键一览 / 自定义」缺的那一半：heyta 此前只有 `⌘,` 一枚
 * 组合键，且键判断散在四处（列表光标 / 菜单 / tablist / Electron 主进程），
 * **没有一处总表**。这一份提供那张总表需要的三件纯判断：
 *
 * · `keyComboFromEvent` —— 把一个键盘事件压成**规范串**（`Meta+Shift+P`）；
 * · `matchShortcut` —— 拿规范串在登记表里查是哪条命令；
 * · `formatKeyCombo` —— 把规范串翻成**给人看**的样子（macOS `⇧⌘P` / 其他 `Ctrl+Shift+P`）。
 *
 * 另有 `findShortcutConflicts` 给"同一作用域里两条命令抢同一个键"这类登记错误兜底。
 *
 * ## 为什么是纯函数
 *
 * 键位判断最贵的失效形状是"按了没反应"或"按一下触发两次"，而这两种在界面上
 * **看起来都正常**。把它做成「事件串 → 规范串 → 登记表查 id」的纯链，就能在
 * 单测里逐格打一遍（修饰键顺序、只按下修饰键、Shift 让字母变大写、mac/win 写法），
 * 而不是等人真去按。宿主只做"拿到 id 后执行哪条动作"那一半。
 *
 * ## 规范串的形状（唯一一种，比较与存取都用它）
 *
 * `Ctrl`、`Alt`、`Shift`、`Meta` 四个修饰键按**固定顺序**在前，最后一个 `+` 之后是键名：
 *   `Ctrl+Alt+Shift+Meta+KeyName`
 * 单字符键名统一大写（`p` → `P`），`' '` → `Space`。
 * 🔴 macOS 的展示顺序（⌃⌥⇧⌘）与**比较用的固定顺序**是两件事 —— 见 `formatKeyCombo`。
 */

/** 展示用的平台档：macOS 与其余。判断在调用点做（共享层不读 `process`）。 */
export type ShortcutPlatform = 'darwin' | 'other';

export interface KeyCombo {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  /** 归一后的键名（单字符大写 / `Space` / 其余原样）。 */
  readonly key: string;
}

/** 与「只按了修饰键」相关的事件键名 —— 这类事件不构成命令。 */
const MODIFIER_KEY_NAMES: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'OS',
]);

/** 修饰键写法 → 规范名。别名都收下，避免"写了 command 不认"。 */
const MODIFIER_ALIASES: Readonly<Record<string, keyof Omit<KeyCombo, 'key'>>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
};

/** 键名归一：单字符大写（`p`→`P`），空格→`Space`，其余原样。 */
function normalizeKeyName(key: string): string {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * 解析规范串（或用户手写的 `Ctrl+Shift+P` / `command+shift+p`）。
 *
 * 解析失败（空串 / 修饰键写错）返回 `null` —— 调用方据此"这条登记无效"，
 * 而不是把它当成某个默认键。
 */
export function parseKeyCombo(combo: string): KeyCombo | null {
  const parts = combo
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return null;
  const keyName = parts[parts.length - 1];
  if (keyName === undefined) return null;
  const result = { ctrl: false, alt: false, shift: false, meta: false, key: normalizeKeyName(keyName) };
  for (const raw of parts.slice(0, -1)) {
    const slot = MODIFIER_ALIASES[raw.toLowerCase()];
    if (slot === undefined) return null;
    result[slot] = true;
  }
  return result;
}

/** 一次键盘事件里我们用得到的字段（只列读到的，Events 天然带这些）。 */
export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

/**
 * 把键盘事件压成规范串；只按下修饰键（Shift/Control/…）时返回 `null`。
 *
 * 🔴 规范串里的 `Meta` 表示「**主修饰键**」，不是物理 Command 键：
 *   · macOS 主修饰键是 ⌘（`metaKey`）；
 *   · Windows / Linux 主修饰键是 Ctrl（`ctrlKey`）。
 * 于是同一条登记（`Meta+Shift+P`）在两个平台都成立，宿主不必各存一份。
 * macOS 上的物理 ⌃（`ctrlKey`）作为**次修饰键**记成 `Ctrl`，与主修饰键区分。
 *
 * 🔴 `event.key` 已经反映了 Shift：按住 Shift 打 `p` 得到的是大写 `P`，
 * 所以这里**不能**再从 `shiftKey` 去改键名字母大小写 —— 那会 double。
 * `shiftKey` 只用来把它记进规范串的修饰键部分。
 */
export function keyComboFromEvent(
  event: KeyEventLike,
  platform: ShortcutPlatform = 'other',
): string | null {
  if (MODIFIER_KEY_NAMES.has(event.key)) return null;
  const key = normalizeKeyName(event.key);
  const primary = platform === 'darwin' ? event.metaKey === true : event.ctrlKey === true;
  // macOS 的 ⌃ 是次修饰键；非 macOS 上 Win 键不参与本项目任何登记，忽略。
  const secondaryCtrl = platform === 'darwin' && event.ctrlKey === true;
  const parts: string[] = [];
  if (secondaryCtrl) parts.push('Ctrl');
  if (event.altKey === true) parts.push('Alt');
  if (event.shiftKey === true) parts.push('Shift');
  if (primary) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

/** 比较用的签名（把布尔压成位串，避免两处各比一遍）。 */
function signature(combo: KeyCombo): string {
  return `${combo.ctrl ? 1 : 0}${combo.alt ? 1 : 0}${combo.shift ? 1 : 0}${combo.meta ? 1 : 0}:${combo.key}`;
}

/** 两个规范串是否指同一个键位（大小写 / 别名 / 顺序都容忍）。 */
export function comboMatches(a: string, b: string): boolean {
  const left = parseKeyCombo(a);
  const right = parseKeyCombo(b);
  if (left === null || right === null) return false;
  return signature(left) === signature(right);
}

const MAC_SYMBOLS: Readonly<Record<string, string>> = {
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  meta: '⌘',
};

const PC_SYMBOLS: Readonly<Record<string, string>> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  // 非 macOS 上 `Meta`（规范串里的"主修饰键"）展示为 Ctrl —— 见 `keyComboFromEvent`。
  meta: 'Ctrl',
};

/** 少数有固定写法的键名 → 展示名。 */
const KEY_DISPLAY: Readonly<Record<string, string>> = {
  Space: '空格',
  Escape: 'Esc',
  Enter: '回车',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

function displayKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  return KEY_DISPLAY[key] ?? key;
}

/**
 * 规范串 → 给人看的样子。
 *
 * · macOS：`⇧⌘P`（无分隔符，顺序 ⌃⌥⇧⌘，系统菜单就是这么写的）；
 * · 其他平台：`Ctrl+Shift+P`。
 * 解析不了就**原样返回** —— 这一串的读者是人，编一个形状只会误导。
 */
export function formatKeyCombo(combo: string, platform: ShortcutPlatform = 'other'): string {
  const parsed = parseKeyCombo(combo);
  if (parsed === null) return combo;
  // macOS 用 ⌃⌥⇧⌘ 顺序、无分隔符；其他平台把主修饰键（规范里的 Meta）排最前，用 + 连接。
  const order = platform === 'darwin'
    ? (['ctrl', 'alt', 'shift', 'meta'] as const)
    : (['meta', 'ctrl', 'alt', 'shift'] as const);
  const symbols = platform === 'darwin' ? MAC_SYMBOLS : PC_SYMBOLS;
  const rendered = order.filter((slot) => parsed[slot]).map((slot) => symbols[slot] ?? slot);
  return [...rendered, displayKey(parsed.key)].join(platform === 'darwin' ? '' : '+');
}

/** 一条「键位 → 命令 id」的登记。 */
export interface ShortcutBinding {
  readonly id: string;
  readonly combo: string;
}

/**
 * 拿一个规范串在登记表里查命令 id；查不到返回 `undefined`。
 *
 * `combo` 允许为 `null`（`keyComboFromEvent` 只按下修饰键时就是它）—— 直接返回未命中。
 */
export function matchShortcut(
  bindings: readonly ShortcutBinding[],
  combo: string | null,
): string | undefined {
  if (combo === null) return undefined;
  for (const binding of bindings) {
    if (comboMatches(binding.combo, combo)) return binding.id;
  }
  return undefined;
}

/**
 * 同一作用域内的键位冲突：两条及以上命令登记了同一个键。
 *
 * 🔴 只用于**一个作用域内部**（全局 / 列表导航 / 命令面板各自一张表）：
 * 不同作用域用同一个键（比如 `Escape` 在导航和面板里都出现）是**正常**的，
 * 把它们也报成冲突就是一把打宽的尺（见 AGENTS 里"宽判据等于没有判据"）。
 */
export interface ShortcutConflict {
  readonly combo: string;
  readonly ids: readonly string[];
}

export function findShortcutConflicts(
  bindings: readonly ShortcutBinding[],
): ShortcutConflict[] {
  const bySignature = new Map<string, { combo: string; ids: string[] }>();
  const order: string[] = [];
  for (const binding of bindings) {
    const parsed = parseKeyCombo(binding.combo);
    if (parsed === null) continue;
    const sig = signature(parsed);
    const entry = bySignature.get(sig);
    if (entry === undefined) {
      bySignature.set(sig, { combo: binding.combo, ids: [binding.id] });
      order.push(sig);
    } else if (!entry.ids.includes(binding.id)) {
      entry.ids.push(binding.id);
    }
  }
  return order
    .map((sig) => bySignature.get(sig))
    .filter((entry): entry is { combo: string; ids: string[] } => entry !== undefined && entry.ids.length > 1)
    .map((entry) => ({ combo: entry.combo, ids: [...entry.ids] }));
}
