/**
 * Electron 主进程
 * ================
 *
 * 这个文件的全部职责：**开窗口、定位库文件、把渲染进程的请求挡住并转发**。
 * 一条业务规则都不在这里 —— 它们全在 `@heyta/node-host`（进而全在 `packages/`）。
 *
 * 主进程持库（不是渲染进程），理由见 `docs/runbooks/desktop.md` 的 Spike S1：
 * `node:sqlite` 是同步 API，主进程是 Node 环境、天然可用；
 * 渲染进程则被 contextIsolation + sandbox 隔离，本来就不该碰文件系统。
 */

import { join } from 'node:path';

import { app, BrowserWindow, ipcMain } from 'electron';

import type { NodeHost } from '@heyta/node-host';
import { openDesktopHost } from './host.js';
import { DESKTOP_CHANNELS, handleDesktopRequest, type DesktopRequest } from './ipc-contract.js';

/** 进程级单例。开第二个库连接会让 SQLite 文件被两个 writer 打开。 */
let host: NodeHost | null = null;
let quitting = false;

async function bootHost(): Promise<NodeHost> {
  host ??= await openDesktopHost({ userDataDir: app.getPath('userData') });
  return host;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    // 先不显示，等首帧就绪再 show —— 否则会看到一段白屏闪一下。
    show: false,
    title: 'heyta',
    webPreferences: {
      preload: join(app.getAppPath(), 'dist', 'preload.cjs'),
      /**
       * 🔴 这三项是桌面端**唯一**的安全边界，不要为了图方便放开任何一个：
       * - `contextIsolation` 让 preload 与页面在**不同的 JS 世界**
       * - `nodeIntegration: false` 让页面拿不到 `require`
       * - `sandbox: true` 让渲染进程跑在 OS 级沙箱里
       * 放开任一项，一个 XSS 就等于任意文件读写。
       */
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  // ⚠️ 临时占位页。M1（共享 UI 垂直切片）会把它换成真正的共享组件；
  // 在那之前它至少证明"窗口 → preload → 主进程 → 共享宿主 → SQLite"这条链是通的。
  void window.loadFile(join(app.getAppPath(), 'renderer', 'index.html'));

  return window;
}

app.whenReady().then(
  () => {
    ipcMain.handle(DESKTOP_CHANNELS.request, async (_event, request: DesktopRequest) => {
      const opened = await bootHost();
      return handleDesktopRequest(opened, request);
    });

    createWindow();

    // macOS：点 Dock 图标且没有窗口时重开一个（平台惯例，不是业务逻辑）。
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  },
  (error: unknown) => {
    console.error('桌面应用启动失败：', error);
    app.quit();
  },
);

app.on('window-all-closed', () => {
  // macOS 的惯例是关窗不退应用；其他平台退出。
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // 只关一次：`before-quit` 可能被触发多次。
  if (quitting) return;
  quitting = true;
  host?.close();
  host = null;
});
