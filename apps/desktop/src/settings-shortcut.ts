/**
 * 「⌘, / Ctrl+,」这条快捷键的**判断**，从 `main.ts` 里抽出来的纯函数。
 *
 * 为什么值得单独一个文件：它在主进程里埋在 `before-input-event` 回调里，
 * 而那条回调只有真起一个 Electron 窗口、还真把焦点给它、再灌一个键盘事件才走得到。
 * 抽出纯函数之后，macOS 上就能用单测钉住三条最要紧的分支（见 tests/）。
 *
 * 🔴 只认「修饰键 + 逗号」：
 *   · macOS 用 `meta`（⌘），其他平台用 `control`（Windows/Linux 的 Ctrl）；
 *   · 不带修饰键的 `,` **不算** —— 用户打字时要打逗号，那是输入，不是命令；
 *   · `input.type` 必须是 `keyDown`：`keyUp` 也带着同样的 `key`，不筛会触发两次。
 */
export interface SettingsShortcutInput {
  readonly type: string;
  readonly key: string;
  readonly meta?: boolean;
  readonly control?: boolean;
}

export function isSettingsShortcut(
  input: SettingsShortcutInput,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (input.type !== 'keyDown') return false;
  if (input.key !== ',') return false;
  const modifier = platform === 'darwin' ? input.meta === true : input.control === true;
  return modifier;
}
