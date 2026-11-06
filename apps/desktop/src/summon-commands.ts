/**
 * 唤出这一族的**命令表**：托盘菜单的内容、每条命令对应哪个动作（与 Electron 无关）。
 *
 * 分成两个文件的原因和本仓其他壳一样：**画什么 / 叫什么**是判断，**怎么画**是平台接线。
 * 判据要能红就得钉在判断上 —— 菜单少一条、把「今天」接到"显示主窗"上、
 * 键位接到"打开快速添加"，这些在界面上**全都看起来正常**，
 * 只有把"哪条命令叫哪个动作"写成数据，单测才能逐条打一遍，
 * 而不是等人用鼠标点四次。
 *
 * ⚠️ 这里的文案是中文常量，不引 `@heyta/i18n`：与 `renderer/main.tsx:16-19`
 * 同一条理由（桌面端引第二份 React 崩过一次），也与本壳既有的
 * `main.ts` 里 `title: '设置'`、`reminder-notify.ts` 的标签同一个形状。
 * 桌面端整体接 i18n 是另一条线的事，不在本分包里顺手做一半。
 */

import { type SummonConfig, normalizeAccelerator } from './summon-config.js';

/** 托盘菜单的四条命令 id。 */
export const TRAY_COMMANDS = ['today', 'quickAdd', 'showMainWindow', 'quit'] as const;

export type TrayCommandId = (typeof TRAY_COMMANDS)[number];

/** 四条命令的文案。`显示主窗` 与 `退出` 是 macOS 与滴答两家的共同形状。 */
export const TRAY_LABELS: Record<TrayCommandId, string> = {
  today: '今天',
  quickAdd: '快速添加',
  showMainWindow: '显示主窗',
  quit: '退出',
};

/**
 * 每条命令对应**哪个动作名**（实现由 `main.ts` 递进来，见 `SummonTargets`）。
 * 这里只有名字，一个实现都不写，所以这个文件里没有任何业务判断。
 */
export const TRAY_TARGETS: Record<TrayCommandId, keyof SummonTargetNames> = {
  today: 'showToday',
  quickAdd: 'openQuickAdd',
  showMainWindow: 'showMainWindow',
  quit: 'quit',
};

/** 两条全局热键对应哪个动作名，与上面那张表同一个理由。 */
export const SUMMON_TARGETS: Record<'showHide' | 'quickAdd', keyof SummonTargetNames> = {
  showHide: 'toggleMainWindow',
  quickAdd: 'openQuickAdd',
};

/** 动作名的全集，写在这里是为了让**拼错在编译期就红**，而不是运行时点了没反应。 */
export interface SummonTargetNames {
  toggleMainWindow: () => void;
  openQuickAdd: () => void;
  showToday: () => void;
  showMainWindow: () => void;
  quit: () => void;
}

export interface TrayMenuEntry {
  readonly id: TrayCommandId;
  readonly label: string;
  /**
   * `false` 只有一种来源：**这条命令现在做不了**。
   * 🔴 本仓的纪律是"不许画点了没反应的按钮"（同一个理由见 `main.ts` 里
   * 那个"端口没给 openSettings 就不画那个按钮"的分支），
   * 所以真做不了的时候要**禁用并说明**，而不是留一枚看起来能点的项。
   */
  readonly enabled: boolean;
}

/** 一条只能看不能点的说明（键位被占用 / 配置文件写坏时出现）。 */
export interface TrayNoticeEntry {
  readonly label: string;
  readonly enabled: false;
}

export type TrayItem = TrayMenuEntry | TrayNoticeEntry;

/**
 * 把命令 id 落成可调用的表。
 *
 * 🔴 缺一个动作就**当场抛**：一个接不到动作的菜单项，症状是"点了没反应"，
 * 而那正是这一族里最贵的一种失效 —— 用户会以为应用卡住了。
 * 抛在装配时刻（启动那一下），而不是等用户去点。
 */
export function mapActions<K extends string>(input: {
  keys: readonly K[];
  targetOf: (key: K) => keyof SummonTargetNames;
  labelOf: (key: K) => string;
  targets: SummonTargetNames;
}): Record<K, () => void> {
  const actions = {} as Record<K, () => void>;
  for (const key of input.keys) {
    const name = input.targetOf(key);
    const action = input.targets[name];
    if (typeof action !== 'function') {
      throw new Error(`命令「${input.labelOf(key)}」要的动作 ${String(name)} 没有提供：这一项会点了没反应`);
    }
    actions[key] = () => action();
  }
  return actions;
}

/** 托盘菜单项的 id → 可调用动作。 */
export function mapTrayActions(targets: SummonTargetNames): Record<TrayCommandId, () => void> {
  return mapActions({ keys: TRAY_COMMANDS, targetOf: (id) => TRAY_TARGETS[id], labelOf: (id) => TRAY_LABELS[id], targets });
}

/**
 * 把归一后的 accelerator 翻成平台上给人看的样子（`⌘⌥⇧S` / `Ctrl+Alt+Shift+S`）。
 *
 * ⚠️ 不在这儿做任何判断：认不出的形状原样返回，因为这一串的读者是人。
 */
export function displayAccelerator(accelerator: string, platform: NodeJS.Platform): string {
  const normalized = normalizeAccelerator(accelerator, platform);
  if (normalized === undefined) return accelerator;
  const index = normalized.lastIndexOf('+');
  if (index < 0) return normalized.toUpperCase();
  const modifiers = normalized.slice(0, index).split('+').filter((m) => m !== '');
  const key = normalized.slice(index + 1);
  const symbol: Record<string, string> =
    platform === 'darwin'
      ? { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘', super: '🌐' }
      : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win', super: 'Super' };
  /**
   * 🔴 macOS 的修饰键**有规定顺序**（⌃⌥⇧⌘），不是字母序。
   * 归一串是字母序（那是给比较用的），拿字母序直接投给人会写出 `⌥⌘⇧S`
   * —— 系统自己的菜单里没有这种写法，用户会以为是另一个键。
   */
  const order = ['ctrl', 'alt', 'shift', 'meta', 'super'];
  const sorted = [...modifiers].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // macOS 的写法没有分隔符（⌥⇧⌘S），其他平台用 + 串起来（Ctrl+Alt+Shift+S）。
  return [...sorted.map((m) => symbol[m] ?? m), displayKey(key)].join(platform === 'darwin' ? '' : '+');
}

/** 键名的样子：单字母大写，少数有固定写法的键给专门的名字。 */
function displayKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  const named: Record<string, string> = { space: '空格', escape: 'Esc', return: '回车' };
  return named[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * 托盘菜单的项序。
 *
 * 🔴 四条命令**恒定在场**（`enabled` 可以变，项不可以少）：
 * 少一项的代价是用户学不到"这个动作存在"，而让人学到正是这一格存在的理由。
 * 说明行只在真有问题时出现，且永不自称命令 —— 它 `enabled: false`。
 * ⚠️ `退出` 永远排最后（macOS 惯例），所以它不在中间被说明行插开。
 */
export function buildTrayMenu(input: {
  config: SummonConfig;
  platform: NodeJS.Platform;
  /** 配置文件的问题 + 注册失败的键位，人话，已在来源处写好。 */
  problems: readonly string[];
}): TrayItem[] {
  const head: TrayMenuEntry[] = TRAY_COMMANDS.filter((id) => id !== 'quit').map((id) => ({
    id,
    label: TRAY_LABELS[id],
    enabled: true,
  }));

  const notices: TrayNoticeEntry[] = [];
  if (input.problems.length > 0) {
    notices.push({ label: '快捷键当前不可用', enabled: false });
    for (const problem of input.problems) notices.push({ label: problem, enabled: false });
    notices.push({
      label: `当前键位：${displayAccelerator(input.config.showHide, input.platform)} / ${displayAccelerator(
        input.config.quickAdd,
        input.platform,
      )}`,
      enabled: false,
    });
  }

  const quit: TrayMenuEntry = { id: 'quit', label: TRAY_LABELS.quit, enabled: true };
  return [...head, ...notices, quit];
}
