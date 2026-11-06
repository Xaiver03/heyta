/**
 * 「全局唤出」的 Electron 接线：全局热键 + 托盘（macOS 菜单栏）。
 *
 * 这个文件里**没有业务判断**（AGENTS.md §3.5）：它只做三件事
 * —— 把键位注册到操作系统、把托盘菜单画出来、把触发原样转交给 `main.ts` 给的动作。
 * 键位形状与冲突规则的判断在 `summon-config.ts`，菜单内容的判断在 `summon-menu.ts`。
 *
 * 🔴 图标是**用代码画的**，不是素材文件：仓库里还没有桌面端图标
 * （`scripts/package-desktop.mjs:188` 明写「不设 icon：仓库里还没有桌面端图标」）。
 * 拿一枚位图进来会同时撞上素材许可门禁与设计系统"外观值只能来自 token"那条线，
 * 而托盘图标此刻需要的只是一个**能认出是 heyta 的记号**。
 * 真图标属于设计系统线，不属于这里。
 */

import { Tray, Menu, globalShortcut, nativeImage } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import {
  SUMMON_COMMANDS,
  type SummonCommandId,
  type SummonConfig,
  readSummonConfigFile,
  summonConfigPath,
  validateSummonConfig,
} from './summon-config.js';
import {
  SUMMON_TARGETS,
  TRAY_COMMANDS,
  buildTrayMenu,
  mapActions,
  mapTrayActions,
  type SummonTargetNames,
} from './summon-commands.js';

/**
 * `main.ts` 递进来的动作。
 *
 * 🔴 类型就是 `SummonTargetNames` 那一份：动作名拼错、少给一个，
 * 都在**装配那一刻**编译失败，而不是等用户去点才知道"点了没反应"。
 */
export type SummonTargets = SummonTargetNames;

export interface SummonRegistration {
  readonly command: SummonCommandId;
  readonly accelerator: string;
  readonly ok: boolean;
}

export interface SummonStatus {
  readonly configPath: string;
  readonly config: SummonConfig;
  readonly registrations: SummonRegistration[];
  readonly trayPresent: boolean;
  /** 空数组 = 一切正常。非空时托盘菜单里会如实列出，且这一串会打进 stdout。 */
  readonly problems: string[];
}

export interface SummonHandle {
  status(): SummonStatus;
  /** 配置文件可能被别的会话改过：重读、重注册、重画菜单。 */
  reload(): void;
  dispose(): void;
}

/**
 * 托盘图标：16x16 的模板图（圆角方框 + 一个勾）。
 *
 * ⚠️ 像素格式是 **BGRA**（Electron `createFromBitmap` 的要求），
 * 模板图只认 alpha，所以 RGB 全 0、alpha 表示覆盖率。
 */
function createTrayIcon(): Electron.NativeImage {
  const SIZE = 16;
  const buffer = Buffer.alloc(SIZE * SIZE * 4);

  const frame = roundedRectCoverage(1.25, SIZE - 1.25, 1.25, 3.0);
  const check: readonly (readonly [number, number])[] = [
    [3.6, 8.2],
    [6.6, 11.0],
    [12.2, 5.0],
  ];
  const tick = polylineCoverage(check, 1.7);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const coverage = Math.max(frame(cx, cy), tick(cx, cy));
      const i = (y * SIZE + x) * 4;
      buffer[i] = 0; // B
      buffer[i + 1] = 0; // G
      buffer[i + 2] = 0; // R
      buffer[i + 3] = Math.round(coverage * 255); // A
    }
  }

  const image = nativeImage.createFromBitmap(buffer, { width: SIZE, height: SIZE });
  // macOS 菜单栏据此自动适配亮暗底；其他平台上这句是无害的 no-op。
  image.setTemplateImage(true);
  return image;
}

/** 圆角矩形**轮廓**的覆盖率函数（线宽 `lineWidth` 像素，含抗锯齿）。 */
function roundedRectCoverage(
  left: number,
  right: number,
  lineWidth: number,
  radius: number,
): (x: number, y: number) => number {
  const half = lineWidth / 2;
  const center = (left + right) / 2;
  const extent = (right - left) / 2;
  return (x, y) => {
    // 圆角矩形的带符号距离场取绝对值 = 到轮廓的距离。
    // 用 SDF 而不是"四条边 + 四个角"逐段判，是因为分段判在角上会漏像素（实测出一个豁口）。
    const qx = Math.abs(x - center) - (extent - radius);
    const qy = Math.abs(y - center) - (extent - radius);
    const distance = Math.abs(
      Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius,
    );
    return Math.min(1, Math.max(0, half - distance + 0.5));
  };
}

/** 折线段集合的覆盖率函数。 */
function polylineCoverage(points: readonly (readonly [number, number])[], lineWidth: number) {
  const half = lineWidth / 2;
  return (x: number, y: number): number => {
    let best = Number.POSITIVE_INFINITY;
    let previous: readonly [number, number] | undefined;
    for (const point of points) {
      if (previous !== undefined) {
        const [ax, ay] = previous;
        const [bx, by] = point;
        const vx = bx - ax;
        const vy = by - ay;
        const length2 = vx * vx + vy * vy;
        const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / length2));
        best = Math.min(best, Math.hypot(x - (ax + t * vx), y - (ay + t * vy)));
      }
      previous = point;
    }
    return Math.min(1, Math.max(0, half - best + 0.5));
  };
}

/**
 * 挂上全局热键与托盘。返回句柄；`dispose()` 必须在 `before-quit` 里调。
 *
 * 🔴 注册失败**不静默**：`globalShortcut.register()` 在键已被别的应用抢走时
 * 只返回 `false`，不报错也不解释（Electron 官方行为，见其 d.ts 里
 * "silently fail" 那句）。所以这里把每一条的结果收进 `status()`，
 * 既打进 stdout 给验收脚本读，也写进托盘菜单给与人。
 */
export function armGlobalSummon(
  targets: SummonTargets,
  deps: { userDataDir: string; log?: (line: string) => void },
): SummonHandle {
  const platform = process.platform;
  const log =
    deps.log ??
    ((line: string): void => {
      process.stdout.write(line + '\n');
    });

  let tray: Tray | null = null;
  let lastStatus: SummonStatus = {
    configPath: '',
    config: { showHide: '', quickAdd: '' },
    registrations: [],
    trayPresent: false,
    problems: [],
  };

  /**
   * 两张"命令 → 动作"的表，都按 `summon-commands.ts` 里的数据装配，
   * 这里一行判断都不写：接错键位或接错动作，那张表 + 单测负责，不是运行时。
   */
  const handlers = mapActions({
    keys: SUMMON_COMMANDS,
    targetOf: (command) => SUMMON_TARGETS[command],
    labelOf: (command) => command,
    targets,
  });
  const trayActions = mapTrayActions(targets);

  function registerAll(config: SummonConfig): { registrations: SummonRegistration[]; failures: string[] } {
    const registrations: SummonRegistration[] = [];
    const failures: string[] = [];
    for (const command of SUMMON_COMMANDS) {
      const accelerator = config[command];
      let ok = false;
      let error: unknown = undefined;
      try {
        ok = globalShortcut.register(accelerator, handlers[command]);
      } catch (caught: unknown) {
        // accelerator 坏到 Electron 直接抛（而不是返回 false）的形状时走这一支。
        error = caught;
      }
      registrations.push({ command, accelerator, ok });
      if (error !== undefined) {
        failures.push(`${command} 的组合键「${accelerator}」注册时出错：${String(error)}`);
      } else if (!ok) {
        failures.push(
          `${command} 的组合键「${accelerator}」没被系统接受：多半是别的应用已经占了它。改配置文件换一键，重启生效。`,
        );
      }
    }
    return { registrations, failures };
  }

  function buildMenu(config: SummonConfig, problems: string[]): Menu {
    const items = buildTrayMenu({ config, platform, problems });
    const template: MenuItemConstructorOptions[] = [];
    let previousEnabled = true;
    for (const item of items) {
      // 命令块与说明块之间插一条分隔线：说明不是命令，视觉上要分开。
      if (previousEnabled && !item.enabled) template.push({ type: 'separator' });
      previousEnabled = item.enabled;
      if ('id' in item) {
        const action = trayActions[item.id];
        template.push({ label: item.label, enabled: item.enabled, click: action });
      } else {
        template.push({ label: item.label, enabled: false });
      }
    }
    return Menu.buildFromTemplate(template);
  }

  function reload(): void {
    globalShortcut.unregisterAll();

    const file = readSummonConfigFile(summonConfigPath(deps.userDataDir));
    const configProblems = [...file.problems, ...validateSummonConfig(file.config, platform)];
    const { registrations, failures } = registerAll(file.config);
    configProblems.push(...failures);

    if (tray === null) {
      try {
        tray = new Tray(createTrayIcon());
        tray.setToolTip('heyta');
      } catch (error: unknown) {
        // Linux 上没有 appindicator 时这里会抛；托盘缺席要如实说，而不是让整个功能消失。
        configProblems.push(`托盘没能建出来：${String(error)}`);
        tray = null;
      }
    }
    if (tray !== null) tray.setContextMenu(buildMenu(file.config, configProblems));

    lastStatus = {
      configPath: file.path,
      config: file.config,
      registrations,
      trayPresent: tray !== null,
      problems: configProblems,
    };

    // 一行机器可读的实况：验收脚本读它，不靠人翻日志。
    log(
      `HEYTA_SUMMON ${JSON.stringify({
        configPath: lastStatus.configPath,
        registrations: lastStatus.registrations,
        trayPresent: lastStatus.trayPresent,
        trayMenu: TRAY_COMMANDS.slice(),
        problems: lastStatus.problems,
        focusable: process.env.HEYTA_DESKTOP_NO_FOCUS !== '1',
      })}`,
    );
  }

  reload();

  return {
    status: () => lastStatus,
    reload,
    dispose: () => {
      globalShortcut.unregisterAll();
      if (tray !== null) {
        tray.destroy();
        tray = null;
      }
    },
  };
}
