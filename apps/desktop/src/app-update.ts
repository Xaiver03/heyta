/**
 * 桌面（Electron）的自动更新检测 —— electron 侧接线。
 * =====================================================
 *
 * 纯逻辑（查一次 + 决定弹哪一种）在 `app-update-core.ts`。本文件只放**要 electron 的两步**：
 * 从 `app.getVersion()` 取本机版本，弹原生对话框，点「下载」用 `shell.openExternal` 打开下载页。
 *
 * Electron **不自己替换已安装的二进制** —— 桌面形态的"自动安装"= 引导用户打开下载地址，
 * 由系统安装器完成（签名 + 公证 + 系统接管）。所以这里不承诺"静默自更新"。
 *
 * 🔴 未指向发布服务器（`HEYTA_UPDATE_BASE_URL` 为空）时不查；任何失败都不弹、不阻塞。
 */

import { app, dialog, shell } from 'electron';

import { APP_UPDATE_INTERVAL_MS, APP_UPDATE_START_DELAY_MS } from '@heyta/node-host';

import {
  type DesktopUpdateOutcome,
  resolveUpdateBaseUrl,
  runDesktopUpdateCheck,
} from './app-update-core.js';

export { resolveUpdateBaseUrl, runDesktopUpdateCheck } from './app-update-core.js';
export type {
  DesktopUpdateOutcome,
  DesktopUpdatePorts,
  DesktopUpdatePrompt,
} from './app-update-core.js';

/** 弹原生对话框；点「下载」且有地址时用系统浏览器打开下载页。 */
async function presentOutcome(outcome: DesktopUpdateOutcome): Promise<void> {
  if (outcome.prompt === 'none') return;
  const force = outcome.prompt === 'force';
  const version = outcome.latestVersion === '' ? '' : ` v${outcome.latestVersion}`;
  const buttons = force ? ['下载'] : ['下载', '稍后'];
  const { response } = await dialog.showMessageBox({
    type: force ? 'warning' : 'info',
    message: force ? `需要更新后才能继续使用${version}` : `有新版本可用${version}`,
    detail: force ? '这是一个必须更新到的版本。' : '',
    buttons,
    defaultId: 0,
    // 可选项按 Esc 等同「稍后」；强制项按 Esc 也落在「下载」，不给"关掉照样用"的路。
    cancelId: force ? 0 : 1,
    noLink: true,
  });
  if (response === 0 && outcome.downloadUrl !== '') {
    void shell.openExternal(outcome.downloadUrl);
  }
}

/**
 * 启动检查：延迟一次 + 定时。在 `app.whenReady()` 之后、`createWindow()` 之后调用。
 * 返回一个 `stop`（测试/退出用）。
 */
export function armDesktopUpdateCheck(): () => void {
  const baseUrl = resolveUpdateBaseUrl();
  if (baseUrl === '') return () => {};

  const check = async (): Promise<void> => {
    try {
      const outcome = await runDesktopUpdateCheck({
        baseUrl,
        currentVersion: app.getVersion(),
        fetchImpl: fetch,
        log: (message) => console.warn(`[app-update] ${message}`),
      });
      await presentOutcome(outcome);
    } catch (error) {
      // 更新检查是增强，任何异常都不该冒泡到主进程的 uncaughtException 边界。
      console.warn('[app-update] desktop check crashed', error);
    }
  };

  const startTimer = setTimeout(() => void check(), APP_UPDATE_START_DELAY_MS);
  const intervalTimer = setInterval(() => void check(), APP_UPDATE_INTERVAL_MS);
  return () => {
    clearTimeout(startTimer);
    clearInterval(intervalTimer);
  };
}
