/**
 * 「全局唤出」键位配置的**判断**（与 Electron 无关，所以能被单测直接 import）。
 *
 * 为什么单独一个文件：本仓库的规矩是把"判断"和"接线"分开放
 * （见 `settings-shortcut.ts` 的同款理由）。键位这件事有一堆必须说清的规则
 * —— 什么形状合法、什么算跟 ⌘, 抢、配置文件坏了该怎么办 ——
 * 它们全都可以在**不起 Electron、不抢用户前台**的前提下逐条钉死。
 *
 * 🔴 配置存在**壳侧的 JSON 文件**里，不写进 op-log：
 * 快捷键是**这台机器**的属性（同一份数据同步到另一台机器，键位不该跟着跳），
 * 而 op-log 里每写一条都等于替用户决定"所有设备都用这个键"。
 *
 * ⚠️ 设置页里那个"改键位"的界面**不在本分包的边界内**（它在 `packages/ui` /
 * `apps/web`）。这一份导出的 `summonConfigPath()` / `writeSummonConfigFile()`
 * 就是给那一步预备的入口：界面只管调它们，判断仍然只在这里。
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** 两条全局命令的 id。滴答 Windows 端是同一族两个槽位（`Ic.HotKey.ShowHideApp` / `GlobalAdd`）。 */
export const SUMMON_COMMANDS = ['showHide', 'quickAdd'] as const;

export type SummonCommandId = (typeof SUMMON_COMMANDS)[number];

/** 命令 id → Electron accelerator 字符串。 */
export type SummonConfig = Record<SummonCommandId, string>;

/**
 * 默认键位。
 *
 * 🔴 为什么是**三修饰键**而不是两修饰键：两修饰键的组合（⌘⌥A、Ctrl+Alt+T 之类）
 * 在国内机器上被别的应用抢走的概率很高 —— 微信占 ⌘⌥A、Ubuntu 占 Ctrl+Alt+T。
 * 抢占了 `globalShortcut.register()` 会**返回 false**，症状是"按了没反应"，
 * 而用户没有任何办法知道原因。默认值选几乎不会撞车的三修饰族，
 * 撞车时的如实报错在 `global-summon.ts` 里，不在这里。
 * ⚠️ 键位可改，改完重启生效；判据见 `validateSummonConfig`。
 */
export const DEFAULT_SUMMON_CONFIG: SummonConfig = {
  showHide: 'CommandOrControl+Alt+Shift+S',
  quickAdd: 'CommandOrControl+Alt+Shift+A',
};

/** 配置文件名，落在 `app.getPath('userData')` 下。 */
export const SUMMON_CONFIG_FILENAME = 'summon.json';

/** 修饰键别名 → 规范名。`CommandOrControl` 按平台展开，所以它需要 platform 参数。 */
const MODIFIER_ALIASES: Record<string, 'meta' | 'ctrl' | 'alt' | 'shift' | 'super'> = {
  command: 'meta',
  cmd: 'meta',
  meta: 'meta',
  control: 'ctrl',
  ctrl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  super: 'super',
  win: 'super',
  windows: 'super',
};

/** 键名别名：只登记 Electron 自己写法里那几个有歧义的，其余原样小写。 */
const KEY_ALIASES: Record<string, string> = {
  space: 'space',
  空格: 'space',
  enter: 'return',
  return: 'return',
  esc: 'escape',
};

/**
 * 把任意写法的 accelerator 归一成 `修饰键(升序)+键` 一小串。
 *
 * 归一的用途只有一个：**比较**。`Cmd+Shift+A` 和 `⇧⌘A` 是不是同一个键，
 * 靠字符串原样比永远比不出来；而"两个命令撞到同一个键"和
 * "跟 ⌘, 抢"这两条判据都依赖比较。
 *
 * 归一不出来（缺键名、有未知 token）时返回 `undefined`，由调用方决定怎么说。
 */
export function normalizeAccelerator(accelerator: string, platform: NodeJS.Platform): string | undefined {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return undefined;

  const modifiers = new Set<string>();
  let key: string | undefined;

  for (const part of parts) {
    const lowered = part.toLowerCase();
    if (lowered === 'commandorcontrol') {
      modifiers.add(platform === 'darwin' ? 'meta' : 'ctrl');
      continue;
    }
    if (lowered === 'altoroption') {
      modifiers.add('alt');
      continue;
    }
    const modifier = MODIFIER_ALIASES[lowered];
    if (modifier !== undefined) {
      modifiers.add(modifier);
      continue;
    }
    if (key !== undefined) return undefined; // 两个键名（`⌘A+B`）不是合法 accelerator
    key = KEY_ALIASES[lowered] ?? lowered;
  }

  if (key === undefined) return undefined; // 只有修饰键 ⇒ 那是按住键的行为，不是组合键
  const mods = [...modifiers].sort();
  /**
   * 没修饰键时返回**裸键名**（`s`），不是 `+s`。
   *
   * 🔴 这里出过一次真错：写成 `mods.join('+') + '+' + key` 之后，裸键 `S` 归一成
   * `'+s'` —— 带着 `+`，于是"全局热键不许用裸键"那条判断**永远不成立**。
   * 一个恒不成立的判据比没有判据更糟：它让所有人以为拦住了。
   */
  return mods.length === 0 ? key : mods.join('+') + '+' + key;
}

/**
 * ⌘,（Windows/Linux 是 Ctrl+,）这条**已经属于设置窗**的快捷键。
 *
 * 判断本身在 `settings-shortcut.ts:20`，这里只是把它的结论翻成 accelerator
 * 形状，好让配置校验能拒绝"把全局唤出设成同一个键"。
 * 🔴 两处必须同源：改 `settings-shortcut.ts` 那条键时，这里的保留键要跟着动，
 * 否则设置窗的键会被全局注册抢走，而症状是"⌘, 打不开设置了"。
 */
/**
 * ⌘,（Windows/Linux 是 Ctrl+,）这条**已经属于设置窗**的快捷键，
 * 写成**归一后的形状**，因为校验比的就是归一形状。
 *
 * 判断本身在 `settings-shortcut.ts:20`，这里只是把它的结论搬过来一份可比的形式。
 * 🔴 两处必须同源：改 `settings-shortcut.ts` 那条键时，这里的保留键要跟着动，
 * 否则设置窗的键会被全局注册抢走，而症状是"⌘, 打不开设置了"。
 */
export function reservedSettingsAccelerator(platform: NodeJS.Platform): string {
  return (platform === 'darwin' ? 'meta' : 'ctrl') + '+' + ',';
}

/** 一条 accelerator 违反的规则（人话），`undefined` = 没问题。 */
export function describeAcceleratorProblem(
  command: SummonCommandId,
  accelerator: string,
  platform: NodeJS.Platform,
): string | undefined {
  const normalized = normalizeAccelerator(accelerator, platform);
  if (normalized === undefined) {
    return `${command} 的组合键「${accelerator}」不是合法形状：至少要有一个修饰键加一个键，例如 CommandOrControl+Alt+Shift+S`;
  }
  if (!/[+]/.test(normalized)) {
    return `${command} 的组合键「${accelerator}」缺少修饰键：全局热键会抢走用户打字的键，不允许`;
  }
  if (normalized === reservedSettingsAccelerator(platform)) {
    return `${command} 的组合键「${accelerator}」与设置窗口的 ${platform === 'darwin' ? '⌘,' : 'Ctrl+,'} 冲突：那条键已有归属，换一个`;
  }
  return undefined;
}

/**
 * 整份配置的校验。返回**所有**问题（不是第一个）——
 * 用户改一次键要同时看到两处错，而不是改一个再发现下一个。
 */
export function validateSummonConfig(config: SummonConfig, platform: NodeJS.Platform): string[] {
  const problems: string[] = [];
  const seen = new Map<string, SummonCommandId>();

  for (const command of SUMMON_COMMANDS) {
    const accelerator = config[command];
    if (typeof accelerator !== 'string' || accelerator.trim() === '') {
      problems.push(`${command} 的组合键是空的：填一个组合键，例如 CommandOrControl+Alt+Shift+S`);
      continue;
    }
    const problem = describeAcceleratorProblem(command, accelerator, platform);
    if (problem !== undefined) {
      problems.push(problem);
      continue;
    }
    const normalized = normalizeAccelerator(accelerator, platform);
    if (normalized === undefined) continue;
    const previous = seen.get(normalized);
    if (previous !== undefined) {
      problems.push(`${command} 与 ${previous} 用了同一个组合键「${accelerator}」：两条命令不能撞键`);
      continue;
    }
    seen.set(normalized, command);
  }

  return problems;
}

/**
 * 解析配置文件正文。
 *
 * 🔴 坏了**不抛**，而是"能用的部分用上、其余退回默认 + 把原因带回去"。
 * 理由是这条路径上没有第二个能说话的人：配置文件写坏时应用如果直接崩，
 * 用户看到的是"双击图标什么都没发生"。
 */
export function parseSummonConfig(text: string): { config: SummonConfig; problems: string[] } {
  const problems: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      config: { ...DEFAULT_SUMMON_CONFIG },
      problems: ['配置文件不是合法 JSON，整份退回默认键位'],
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      config: { ...DEFAULT_SUMMON_CONFIG },
      problems: ['配置文件不是一个对象，整份退回默认键位'],
    };
  }

  const record = parsed as Record<string, unknown>;
  const config: SummonConfig = { ...DEFAULT_SUMMON_CONFIG };
  for (const command of SUMMON_COMMANDS) {
    const value = record[command];
    if (value === undefined) continue; // 缺项 = 用默认，这是文档写明的行为，不算问题
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${command} 的值不是字符串（${JSON.stringify(value)}），这一项退回默认键位`);
      continue;
    }
    config[command] = value;
  }
  for (const key of Object.keys(record)) {
    if (!(SUMMON_COMMANDS as readonly string[]).includes(key)) {
      problems.push(`配置文件里有一项不认识：${key}（会被忽略）`);
    }
  }

  return { config, problems };
}

export function serializeSummonConfig(config: SummonConfig): string {
  return JSON.stringify(config, null, 2) + '\n';
}

/** 配置文件落点：userData 下一份 JSON。`userDataDir` 由调用方（主进程）给，好让测试用临时目录。 */
export function summonConfigPath(userDataDir: string): string {
  return `${userDataDir.replace(/\/$/, '')}/${SUMMON_CONFIG_FILENAME}`;
}

export interface SummonConfigFile {
  readonly path: string;
  readonly config: SummonConfig;
  readonly problems: string[];
  /** `false` = 文件还不存在（首次运行），此时键位是默认值而不是"用户设过又坏了"。 */
  readonly present: boolean;
}

/**
 * 读配置文件。文件不存在 ⇒ 默认值且 `present: false`，**不报错**。
 * 这里刻意不做"首次运行就写一份默认文件"：那会让"用户没设过"和
 * "用户设成了默认值"在盘上长得一样，而这两件事在排查时是不同的。
 */
export function readSummonConfigFile(path: string): SummonConfigFile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { path, config: { ...DEFAULT_SUMMON_CONFIG }, problems: [], present: false };
  }
  const { config, problems } = parseSummonConfig(text);
  return { path, config, problems, present: true };
}

/**
 * 写配置文件（供设置界面与验收脚本用）。
 *
 * 🔴 写之前先校验：**校验不过就直接抛，不落盘**。
 * 因为下一次启动读的是这份文件；把一份注定注册不上的键位写进去，
 * 等于让用户下次开机才发现键坏了。
 */
export function writeSummonConfigFile(
  path: string,
  config: SummonConfig,
  platform: NodeJS.Platform = process.platform,
): void {
  const problems = validateSummonConfig(config, platform);
  if (problems.length > 0) {
    throw new Error(`键位配置不合法，未写入 ${path}：\n   ${problems.join('\n   ')}`);
  }
  writeFileSync(path, serializeSummonConfig(config), 'utf8');
}
