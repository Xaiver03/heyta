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

import { existsSync } from 'node:fs';
import { isSettingsShortcut } from './settings-shortcut.js';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, net, protocol } from 'electron';

import type { NodeHost } from '@heyta/node-host';
import { openDesktopHost } from './host.js';
import {
  DESKTOP_CHANNELS,
  handleDesktopRequest,
  type DesktopReminderAccess,
  type DesktopRequest,
} from './ipc-contract.js';
import {
  REMINDER_NOTIFICATION_LABELS,
  createDeliveryLedger,
  createReminderForegroundPort,
  readReminderStatus,
} from './reminder-notify.js';
import { createElectronNotificationSurface } from './reminder-notify-electron.js';

/** 进程级单例。开第二个库连接会让 SQLite 文件被两个 writer 打开。 */
let host: NodeHost | null = null;
let quitting = false;

/**
 * 当前主窗口。只在 `second-instance` 里用来把已有窗口拉回前台。
 */
let mainWindow: BrowserWindow | null = null;

/**
 * 前台提醒这一族在主进程里的三个件：端口（怎么弹）、账本（最近一轮实况）、
 * 循环的取消函数（`before-quit` 撤掉）。
 *
 * 🔴 循环只在**宿主真的起来了**之后挂一次：`bootHost()` 是幂等单例，所以这里
 * 用同一个判据（`stopReminderLoop !== null`）而不看时间 —— 挂两枚循环等于同一轮
 * 到点投两次，而记账只有一份。
 */
let reminderAccess: DesktopReminderAccess | null = null;
let stopReminderLoop: (() => void) | null = null;

function armReminders(host: NodeHost): void {
  if (stopReminderLoop !== null) return;
  const port = createReminderForegroundPort(createElectronNotificationSurface());
  const ledger = createDeliveryLedger();
  stopReminderLoop = host.startForegroundReminders(port, {
    labels: REMINDER_NOTIFICATION_LABELS,
    // seam 每一轮的结论只从 onDelivery 出来，而渲染进程拿不到主进程的回调 ——
    // 中间必须有人把"最近一次实况"存下来，界面那一行才有真话可说。
    onDelivery: (result) => ledger.note(result),
    onError: (error: unknown) => console.error('前台提醒投递失败：', error),
  });
  reminderAccess = {
    status: () => readReminderStatus(port, ledger),
    // 端口没给 openSettings（Linux 没有标准入口）⇒ 这里回 false，
    // 界面据此**不画**那个点了没反应的按钮，而不是画一个骗人的。
    openSettings: () => (port.openSettings === undefined ? Promise.resolve(false) : port.openSettings()),
  };
}

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

/**
 * 设置窗口的**载荷**：与 macOS / Windows 两个壳同一条约定。
 *
 * 🔴 为什么这里也要 `standalone=1`：`apps/web` 那边的 `?settings=` 会在应用壳之上
 * 开一层模态；而在独立窗口里，那等于"整个应用 + 一个弹窗"。`standalone=1` 让页侧
 * 收起 rail / 主区 / 详情列，只画设置（见 `apps/web/src/lib/settings-deep-link.ts`，
 * 那是参数含义的唯一事实源；这里只负责拼 URL，不复制它的判断逻辑）。
 */
/** 共享 UI 产物用的 scheme（见 registerWebProtocol 里为什么不用 file://）。 */
const SCHEME = 'heyta';

const SETTINGS_SECTION_DEFAULT = 'settings-group-appearance';

/** 与 macOS 的 `HEYTA_SETTINGS_STANDALONE` / Windows 的同名，三壳一个约定。 */
function settingsSectionFromEnv(): string {
  const raw = process.env.HEYTA_SETTINGS_STANDALONE?.trim();
  return raw !== undefined && raw !== '' ? raw : SETTINGS_SECTION_DEFAULT;
}

/**
 * 共享 UI 产物目录：**优先环境变量，否则 `apps/web/dist`**。
 *
 * 与 macOS 的 `SharedWebRoot`、Windows 的 `WindowsWebRoot` 同一优先级顺序。
 * ⚠️ 这里不新造第二套约定 —— 三个壳找同一份产物、认同一个环境变量。
 */
function resolveWebRoot(): string {
  const overridden = process.env.HEYTA_WEB_ROOT?.trim();
  if (overridden !== undefined && overridden !== '') return overridden;
  return join(__dirname, '..', '..', 'web', 'dist');
}

let settingsWindow: BrowserWindow | null = null;

/**
 * 打开（或唤回）独立设置窗口。
 *
 * 与主窗口的三条差异都是刻意的：
 *   1. **不设 parent** —— macOS 的 sheet 会跟着父窗口动、还不能移出父窗口范围；
 *      设置要能被拖到另一块屏上。
 *   2. **关掉不销毁实例**，再按一次 ⌘, 只是把它提到前面（与 macOS/Windows 同纪律）。
 *   3. **产物缺席时说清楚缺什么**，不留白窗 —— 白窗排查在两个壳上各花过一轮。
 */
function createSettingsWindow(): BrowserWindow {
  if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  const window = new BrowserWindow({
    width: 900,
    height: 640,
    show: false,
    focusable: !NO_FOCUS,
    title: '设置',
    webPreferences: {
      // 与主窗口同一组安全边界，不放宽任何一项（理由见 createWindow）。
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => {
    if (NO_FOCUS) window.showInactive();
    else window.show();
  });

  const root = resolveWebRoot();
  const entry = join(root, 'index.html');
  if (existsSync(entry)) {
    const query = new URLSearchParams({
      settings: settingsSectionFromEnv(),
      standalone: '1',
    });
    void window.loadURL(`${SCHEME}://app/index.html?${query.toString()}`);
  } else {
    // 产物缺席：标题与正文都说清楚"缺什么、该跑哪条命令"，而不是一个白窗口。
    window.setTitle('设置（未找到 web-dist）');
    void window.loadURL(
      /*
       * 🔴 这张页**不带任何样式**：它是"产物都不在"时的兜底，
       * 而 app 的样式表这时根本没加载。写内联 hex/px 会被 `check:design`
       * 判成硬编码设计变量（实测红了 3 处），而在这里引 token 又不可能 —— 
       * 所以就用最朴素的语义 HTML，让它靠浏览器默认样式显示。
       * 缺什么、该跑哪条命令，仍然说清楚。
       */
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<body><h1>找不到共享 UI 产物</h1><p>期望位置：<code>${entry}</code></p>` +
          `<p>先在仓库根跑 <code>pnpm --filter @heyta/web build</code>，` +
          `或用 <code>HEYTA_WEB_ROOT</code> 指过去。</p></body>`,
      )}`,
    );
  }

  settingsWindow = window;
  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null;
  });
  return window;
}

/**
 * 给共享 UI 产物注册一个**受信任的** scheme。
 *
 * 🔴 为什么不能用 `file://`：`file://` 是**不透明 origin**，页面拿不到
 * IndexedDB / OPFS。/app 的启动第一步就是开本地库，于是它会**永远停在闪屏**——
 * 不报错、不白屏、就是不动（2026-10-25 在设置窗口上实测过一次）。
 * macOS 壳遇到过同一类问题的另一面（`heyta-local://` 的 origin 下也拿不到存储，
 * 最后靠"由壳当存储宿主"解决）。这里选另一条同样正确的路：
 * 把 scheme 登记成 `standard + secure`，于是它是一个**正常 origin**，
 * 页侧自己的存储就能用 —— 不需要为设置窗口再造一套宿主。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

/** 把 `heyta://app/index.html` 映射到 web 产物目录下的真实文件。 */
function registerWebProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const root = resolveWebRoot();
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === '' || pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const file = join(root, relative);
    // 目录逃逸防护：只允许产物目录内的文件（`..` 一律拒绝）。
    if (!file.startsWith(root)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

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
       *
       * ⚠️ 同样用 `__dirname`（理由见下面 `loadFile` 那段）：asar 之后
       * `app.getAppPath()` 是 `app.asar`，不是 `dist/`。
       */
      preload: join(__dirname, 'preload.cjs'),
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
   * 所以路径要从 `dist/` **往上走一级**。
   *
   * ⚠️ 用 `__dirname` 而**不是** `app.getAppPath()`：
   * `__dirname` 就是 `main.cjs` 所在目录，开发时是 `apps/desktop/dist`、
   * 打包后（asar）是 `…/Resources/app.asar/dist` —— 两种形态下
   * `'..'` 都恰好落在该在的地方。
   * 而 `getAppPath()` 打包后返回的是 **`app.asar` 本身**，`'..'` 会跑到
   * `Resources/` 去，于是又变回"白窗口、无报错"。
   * 这个差异只在打包后才出现，开发时怎么试都是好的 —— 所以现在就用对的写法。
   */
  void window.loadFile(join(__dirname, '..', 'renderer-dist', 'index.html'));

  /**
   * ⌘, / Ctrl+, ⇒ 独立设置窗口。
   *
   * 🔴 用 `before-input-event` 而不是重建应用菜单：Electron 的默认菜单带着
   * 复制/粘贴/全选那一整套 role，替换它就得把那些一条条补回来 ——
   * 补漏的症状是"粘贴忽然不好使了"，而它与设置毫无关系。
   * 这里只截一个组合键，其余键一律放行（`return` 不 preventDefault）。
   */
  window.webContents.on('before-input-event', (event, input) => {
    // 判断本身是纯函数（`settings-shortcut.ts`），这里只做"命中就拦下 + 开窗口"。
    if (!isSettingsShortcut(input)) return;
    event.preventDefault();
    createSettingsWindow();
  });

  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  return window;
}

/**
 * 🔴 **单实例锁**。
 *
 * 这个应用**独占一个 SQLite 文件**（`userData/` 下）。没有锁时，双击两次就真的
 * 会跑起两个进程、各自开一个连接写同一个库 —— **本机实测：两个实例能同时活着、
 * 谁也不报错**。所以这不是"会不会崩"的问题，而是"两个 writer 悄悄写同一份数据"
 * 的问题，等发现时数据已经不对了。
 *
 * `requestSingleInstanceLock()` 按 **userData 目录** 区分实例，所以 e2e
 * 用 `--user-data-dir=<临时目录>` 启动时**不受影响**（见
 * `e2e/tests/desktop-window.spec.ts`）—— 每个测试仍是独立实例。
 *
 * ⚠️ 第二个实例**不静默消失**：它先把已有窗口拉到前台再退出。
 * 直接 `app.quit()` 的话，用户双击图标会得到"什么都没发生"，
 * 那看起来**正好像是应用意外退出了** —— 一个正确的保护会被误读成 bug。
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(
    () => {
      ipcMain.handle(DESKTOP_CHANNELS.request, async (_event, request: DesktopRequest) => {
        const opened = await bootHost();
        armReminders(opened);
        return handleDesktopRequest(opened, request, reminderAccess ?? undefined);
      });

      registerWebProtocol();

      createWindow();

      /**
       * 取证开关（与 macOS / Windows 同名同义）：`HEYTA_OPEN_SETTINGS=1` 启动即开设置窗口。
       * `check:ai-e2e` 那条桌面门禁是"跑起来 → 判读数"，没有键盘那一步。
       */
      if (process.env.HEYTA_OPEN_SETTINGS === '1') createSettingsWindow();

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
}

app.on('window-all-closed', () => {
  // macOS 的惯例是关窗不退应用；其他平台退出。
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // 只关一次：`before-quit` 可能被触发多次。
  if (quitting) return;
  quitting = true;
  /* 先撤提醒循环再关宿主：`setTimeout` 在宿主关掉之后还会打过来，
   * 那一发投在已销毁的宿主上，症状是退出时一句看不懂的栈。 */
  if (stopReminderLoop !== null) stopReminderLoop();
  stopReminderLoop = null;
  reminderAccess = null;
  host?.close();
  host = null;
});
