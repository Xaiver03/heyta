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

/**
 * 冒烟/自动化模式下不让窗口抢焦点。
 *
 * 🔴 为什么需要它：`window.show()` 会把窗口激活到前台。跑 GUI 冒烟时这等于
 * **每跑一次测试就把用户从正在做的事里踢出来** —— 本机实测就是这样，
 * 用户明确要求不要抢前台。自动化里窗口只需要"能被截图"，不需要"被聚焦"。
 *
 * `focusable: false` 是更硬的一道：在 macOS 上光用 `showInactive()` 有时
 * 仍会因为窗口可聚焦而被激活，禁止聚焦之后它就不可能抢走输入焦点。
 */
const NO_FOCUS = process.env.HEYTA_DESKTOP_NO_FOCUS === '1';

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    // 先不显示，等首帧就绪再 show —— 否则会看到一段白屏闪一下。
    show: false,
    focusable: !NO_FOCUS,
    title: 'heyta',
    webPreferences: {
      /**
       * 🔴 同样是 `app.getAppPath()` 那个坑（见下面 `loadFile` 的注释）：
       * 它返回的是 `dist/`，所以这里**不能**再拼一次 `'dist'`。
       *
       * 拼错时 `preload` 静默不加载 —— Electron **不会**因为 preload 文件
       * 不存在而拒绝开窗口，渲染进程里 `window.heytaDesktop` 直接是
       * `undefined`，界面上表现为一句
       * `TypeError: Cannot read properties of undefined (reading 'request')`。
       * 这个错误看起来像"宿主坏了"，实际只是路径多了一层。
       */
      preload: join(app.getAppPath(), 'preload.cjs'),
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
    /**
     * 🔴 自动化里用 `showInactive()`：窗口会出现（Playwright 才截得到图），
     * 但**不会**被激活到前台。手动启动时仍然用 `show()` —— 双击应用的人
     * 当然希望它到前台来。
     */
    if (NO_FOCUS) window.showInactive();
    else window.show();
  });

  /**
   * 🔴 加载的是**构建产物** `renderer-dist/`，不是源码目录 `renderer/`。
   *
   * `renderer/` 里是 `.tsx` + 一个 `<script type="module" src="./main.tsx">` ——
   * Chromium **不认识 TSX**，直接 `loadFile` 源码目录会得到一个白窗口。
   * 产物由 `vite build` 生成（见 `apps/desktop/vite.config.ts`）。
   *
   * ─────────────────────────────────────────────────────────────
   * 🔴🔴 `app.getAppPath()` 是**入口脚本所在目录**，不是包根
   * ─────────────────────────────────────────────────────────────
   *
   * 这里踩过一次真实的坑，而且**症状是全白、没有任何报错**：
   *
   * 第一版写的是 `join(app.getAppPath(), 'renderer', 'index.html')`。
   * 直觉上 `getAppPath()` 应该是"应用的根目录"（`apps/desktop`），
   * 但实测它是 **`apps/desktop/dist`** —— 也就是 `dist/main.cjs` 所在的那个
   * 目录。于是拼出来的路径是：
   *
   *     file:///…/apps/desktop/dist/renderer-dist/index.html   ← 不存在
   *
   * Electron 只在**终端**里打一行
   *     electron: Failed to load URL: … error: ERR_FILE_NOT_FOUND
   * 窗口本身照常打开、照常是白的，Playwright 那边表现为
   * `electron.launch()` 直接超时（连窗口对象都拿不到）。
   * 换句话说：**这个 bug 从占位页时期就存在**，桌面端从来没显示过东西。
   *
   * 所以路径要从 `dist/` **往上走一级**。写成 `'..'` 而不是依赖 cwd，
   * 是因为 cwd 取决于谁启动的（`pnpm start`、Playwright、双击 .app 各不相同）。
   */
  void window.loadFile(join(app.getAppPath(), '..', 'renderer-dist', 'index.html'));

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
