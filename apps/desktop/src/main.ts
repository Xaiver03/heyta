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
  type DesktopCommand,
  type DesktopReminderAccess,
  type DesktopRequest,
} from './ipc-contract.js';
import { armGlobalSummon, type SummonHandle } from './global-summon.js';
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
 * 🔴 **进程级错误边界**（崩溃审计 2026-11-08 · U11 第 2 条 P0）。
 *
 * 审计时全仓 grep `process.on('uncaughtException'|'unhandledRejection')` 就这一处
 * 都没有。Electron 主进程里一条未捕获异常 = 整个应用消失，
 * 而用户看到的是"窗口闪了一下就没了"—— 连日志都没有。
 *
 * 取舍：**记下来再退出**，不试图继续跑。一个已经处于未知状态的主进程
 * 继续服务，会让"未知状态"扩散到数据库（这个应用唯一不可再生的东西）。
 */
process.on('uncaughtException', (error: unknown) => {
  reportFatal('uncaughtException', error);
  app.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  reportFatal('unhandledRejection', reason);
  app.exit(1);
});

/** 把致命错误写进 stderr —— 这是 GUI 应用里唯一一定能留下的痕迹。 */
function reportFatal(kind: string, error: unknown): void {
  try {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[heyta] 主进程致命错误（${kind}）：${message}\n`);
  } catch {
    // stderr 都写不了（管道已关）：无能为力。
  }
}

/**
 * 🔴 所有窗口装载都走这里（崩溃审计 U11 第 1 条 P0）。
 *
 * `loadFile` / `loadURL` 返回的 Promise 在产物缺失、路径错、或协议未注册时
 * **会 reject**。此前四处都是 `void window.loadFile(...)` —— `void` 丢掉 promise，
 * 拒绝就变成主进程的未捕获异常（装上前面的处理器之后是"立刻退出"，
 * 装上之前是"闪退且无痕迹"）。
 *
 * 这里把失败变成**窗口内的一句可读说明**：白窗至少能诊断，
 * 而"闪退"什么都留不下。
 */
function guardedLoad(window: BrowserWindow, label: string, load: () => Promise<void>): void {
  void load().catch((error: unknown) => {
    reportFatal(`装载 ${label} 失败`, error);
    if (window.isDestroyed()) return;
    const message = error instanceof Error ? error.message : String(error);
    // 用 data: URL 而不是继续 loadFile —— 后者的失败模式正是我们要说明的那件事。
    void window.webContents
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          `<meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">` +
            `<h1>界面没能加载</h1><p>这通常是安装包不完整。</p>` +
            `<pre style="white-space:pre-wrap">${message}</pre></body>`,
        )}`,
      )
      .catch(() => undefined);
  });
}

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

/**
 * 🔴 **单飞**：用共享 promise 记忆化，而不是"可空变量当锁"（崩溃审计 U11 第 3 条 P0）。
 *
 * 原来写的是 `host ??= await openDesktopHost(...)`。`??=` 只在**赋值那一刻**判断，
 * 而 `await` 把它劈成了两段：渲染进程启动时的
 * `Promise.all([listTasks, listTagAliasTable])`（`renderer/main.tsx:113-116`）
 * 会让两个 IPC 回调在**同一个 tick** 都读到 `host === null`，于是各自
 * `openDesktopHost` → **同一个 `heyta.sqlite` 被打开两次**（两个 OpLogEngine、
 * 两条 SQLite 连接），后到的覆盖 `host`，先到的那份永不 `close()` 且仍持有写连接。
 *
 * 这正是本文件 `before-quit` 注释里警告的"两个 writer 悄悄写同一份数据"。
 *
 * 修法：把"正在打开"这件事本身变成一个可共享的 promise。失败时清掉，
 * 让下一次是**真重试**而不是拿到一个已拒绝的缓存。
 *
 * ⚠️ 退出中（`quitting`）必须拒绝：否则迟到的 IPC 会在 `before-quit` 之后
 * 重新开库、重挂提醒定时器（见 `quitting` 的用法）。
 */
let hostOpening: Promise<NodeHost> | null = null;

async function bootHost(): Promise<NodeHost> {
  if (quitting) throw new Error('应用正在退出，不再打开数据库');
  if (host !== null) return host;
  hostOpening ??= openDesktopHost({ userDataDir: app.getPath('userData') })
    .then((opened) => {
      host = opened;
      return opened;
    })
    .catch((error: unknown) => {
      // 失败即失效：让下一次调用是一次真重试，而不是复用一个已拒绝的 promise。
      hostOpening = null;
      throw error;
    });
  return hostOpening;
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
 * 快速添加面板（R6）。与设置窗同一族：**第二个窗口，不是主窗口的另一种形态**。
 *
 * 🔴 它可以完全独立于主窗口存在：输入落库走的是同一条 IPC 契约
 * （`addTask` ⇒ `host.addTask` ⇒ `createTaskActions().create` ⇒ op-log），
 * 而宿主是主进程的单例，主窗口开没开跟它能不能写没有关系。
 * 这正是判据②要钉的东西：**不打开主窗也能落库**。
 */
let quickAddWindow: BrowserWindow | null = null;

/** 全局热键与托盘的句柄；`before-quit` 里必须 dispose，否则退出后键位仍被这台机器占着。 */
let summon: SummonHandle | null = null;

/**
 * 主窗口**还没准备好**时收到的命令，等它准备好再补发。
 *
 * 🔴 两个"还没准备好"都要接住，而不只是第一个：
 *   1. 窗口根本不在了（macOS 上关窗不退应用，之后从托盘按「今天」）；
 *   2. 窗口刚建出来、页面**还在加载** —— `showToday()` 是先 `showMainWindow()`
 *      （那里可能新建窗口）再发命令，此时 `mainWindow` 已经非空，
 *      但页面的监听器要等 preload 跑完才挂上。**提前发出去的那一句不会排队，
 *      也不会报错，就是没人听见**，症状正是"点今天没反应，再点一次才有"。
 * ⚠️ 是队列不是单格：`reloadTasks` 与 `showToday` 可能连着到，
 *    留一条的话后到的会把先到的顶掉，于是"快速添加完之后视图丢了"。
 */
let pendingCommands: DesktopCommand[] = [];

/**
 * 把一条命令递给主窗口的渲染进程；它没准备好就先排队。
 *
 * ⚠️ 只发命令，不发数据 —— 理由写在 `ipc-contract.ts` 的 `DesktopCommand` 上。
 */
function sendToMainWindow(command: DesktopCommand): void {
  if (mainWindow !== null && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(DESKTOP_CHANNELS.command, command);
    return;
  }
  pendingCommands.push(command);
}

/** 页面加载完成后把欠下的命令补发出去（`createWindow` 里挂在 `did-finish-load`）。 */
function flushPendingCommands(window: BrowserWindow): void {
  if (pendingCommands.length === 0 || window.isDestroyed()) return;
  const queued = pendingCommands;
  pendingCommands = [];
  for (const command of queued) window.webContents.send(DESKTOP_CHANNELS.command, command);
}

/**
 * 唤出主窗口。
 *
 * 🔴 分两种现场，而且**这条分叉不能省**：
 *   · 窗口还在（macOS 上被热键藏起来的那一种）⇒ `show()` + `focus()`，
 *     这是判据①里"窗口拿到焦点"那一步；
 *   · 窗口不在了（关窗后只剩托盘）⇒ 重建，`ready-to-show` 里本来就会 `show()`。
 * 自动化（`NO_FOCUS`）一律走 `showInactive()`：判据③要的正是"唤出过程不抢前台"。
 */
function showMainWindow(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (NO_FOCUS) mainWindow.showInactive();
  else mainWindow.show();
  if (!NO_FOCUS) mainWindow.focus();
}

function hideMainWindow(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.hide();
}

/**
 * 显示/隐藏那一条热键的落点。
 *
 * 判据只看"可见"这一件事，不看焦点：窗口在前台但没焦点时按热键，
 * 用户的意图是"收起来"，此时要求焦点相等会把这条键变成"必须点一下才算聚焦"。
 */
function toggleMainWindow(): void {
  if (mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    hideMainWindow();
    return;
  }
  showMainWindow();
}

/**
 * 「今天」：唤出主窗口，并让界面切到今天那一档。
 *
 * 🔴 这里**不筛任务**。哪些任务算今天，判据在 `packages/domain/src/task-filter.ts`
 * （`filterTasks(…, { kind: 'today' }, …)`），由渲染进程去调它（AGENTS.md §3.5）。
 * 壳只说"界面请显示今天那一档"。
 */
function showToday(): void {
  showMainWindow();
  sendToMainWindow({ kind: 'showToday' });
}

/**
 * 打开（或唤回）快速添加面板。
 *
 * 三条与设置窗同样的纪律：不抢前台时只出现不聚焦、关掉不销毁实例、
 * 产物缺席要在窗口里说清楚缺什么（白窗排查在这两个壳上各花过一轮）。
 */
function createQuickAddWindow(): void {
  if (quickAddWindow !== null && !quickAddWindow.isDestroyed()) {
    if (NO_FOCUS) quickAddWindow.showInactive();
    else {
      quickAddWindow.show();
      quickAddWindow.focus();
    }
    return;
  }

  const window = new BrowserWindow({
    width: 460,
    height: 132,
    show: false,
    focusable: !NO_FOCUS,
    // 面板是"伸手就写一句"的东西：不带菜单栏、不可缩放、不进任务栏的窗口列表。
    frame: false,
    resizable: false,
    skipTaskbar: true,
    title: '快速添加',
    webPreferences: {
      // 与主窗口同一组安全边界，不放宽任何一项（理由见 createWindow）。
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => {
    if (NO_FOCUS) window.showInactive();
    else window.show();
  });

  /**
   * 🔴 加载的是**本壳自己的**渲染产物 `renderer-dist/quick-add.html`，
   * 不是 `apps/web` 那份共享 UI 产物。
   *
   * 理由是同一句：`heyta://` 那个 origin 上跑的是**页侧自带引擎**的完整应用，
   * 同一个库里开第二个引擎等于两套向量时钟各写各的（`HeytaMacApp.swift:1053-1055`
   * 记的就是这一族事故）。面板要的只是"一句话进库"，而那条路主进程已经有一份
   * —— 走 IPC，不开第二个引擎。
   */
  guardedLoad(window, '快速添加', () =>
    window.loadFile(join(__dirname, '..', 'renderer-dist', 'quick-add.html')),
  );

  quickAddWindow = window;
  window.on('closed', () => {
    if (quickAddWindow === window) quickAddWindow = null;
  });
}

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
    guardedLoad(window, '主界面', () =>
      window.loadURL(`${SCHEME}://app/index.html?${query.toString()}`),
    );
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
  guardedLoad(window, '主界面', () =>
    window.loadFile(join(__dirname, '..', 'renderer-dist', 'index.html')),
  );

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

  /**
   * 补发那些比页面准备好更早到的命令。
   *
   * 🔴 要等 `did-finish-load`：命令是**推**给页面的，而页面的监听器在 preload
   * 之后才挂上 —— 提前发的那一句不会排队、不会报错，就是没人听见。
   */
  window.webContents.once('did-finish-load', () => flushPendingCommands(window));

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
        const result = await handleDesktopRequest(opened, request, reminderAccess ?? undefined);
        /**
         * 快速添加面板写下的一条任务，主窗口那份列表**看不见** —— 它只在挂载时
         * 读过一次库（`renderer/main.tsx` 那条"每次写后重读"管得住的是**同一页上**
         * 发生的写）。所以这里推一句"重新读一次"。
         *
         * ⚠️ 推的是命令不是内容：界面仍然自己从库里读，库才是权威。
         * 🔴 只有 `addTask` 会新增一行，所以只在它之后推；面板里没有改名/完成
         *    那类入口，每条请求都推等于让界面白读一遍库。
         */
        if (request.method === 'addTask') sendToMainWindow({ kind: 'reloadTasks' });
        return result;
      });

      registerWebProtocol();

      createWindow();

      /**
       * 全局热键 + 托盘（R6）。
       *
       * 🔴 挂在 `createWindow()` **之后**、`whenReady` 之内：
       * `globalShortcut` 与 `Tray` 都要求 app 已就绪，早一步是 Electron 明确拒绝的；
       * 而它必须在任何取证开关之前 —— 判据①要的"把注册注掉这条必须红"
       * 指的是这一行，不是某个环境变量。
       */
      summon = armGlobalSummon(
        {
          toggleMainWindow,
          openQuickAdd: createQuickAddWindow,
          showToday,
          showMainWindow,
          quit: () => app.quit(),
        },
        { userDataDir: app.getPath('userData') },
      );

      /**
       * 取证开关（与 macOS / Windows 同名同义）：`HEYTA_OPEN_SETTINGS=1` 启动即开设置窗口。
       * `check:ai-e2e` 那条桌面门禁是"跑起来 → 判读数"，没有键盘那一步。
       */
      if (process.env.HEYTA_OPEN_SETTINGS === '1') createSettingsWindow();

      // macOS：点 Dock 图标且没有窗口时重开一个（平台惯例，不是业务逻辑）。
      app.on('activate', () => {
        if (mainWindow === null || mainWindow.isDestroyed()) {
          createWindow();
          return;
        }
        /**
         * 窗口**还在但被热键藏起来了**这一档，2026-11-06 随 R6 一起补：
         * 只判"有没有窗口"的话，藏起来的窗口会让 Dock 图标**点了没反应** ——
         * 而那正是本仓最不允许可见的失效（"看起来像应用卡住了"）。
         */
        if (!mainWindow.isVisible()) showMainWindow();
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
  /**
   * 🔴 全局热键与托盘**必须**在这里撤，而且要在关宿主之前。
   *
   * 不撤的代价不是"难看"而是**占着键位不放**：`globalShortcut` 注册的是系统级
   * 快捷键，进程退出后 Electron 会回收，但**托盘图标与热键在退出过程中还在**，
   * 而这一路里宿主还要写最后一次 op。顺序反过来只会让人怀疑是哪一步卡住了退出。
   */
  if (summon !== null) {
    summon.dispose();
    summon = null;
  }
  host?.close();
  host = null;
});
