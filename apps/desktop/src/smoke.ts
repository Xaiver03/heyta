/**
 * Electron **运行时**冒烟（无窗口 / 可选开窗截图）
 * ==============================================
 *
 * 为什么需要它：`tests/` 里的 11 个用例跑在**纯 Node** 里（vitest, environment: node），
 * 它们证明的是"这些逻辑在 Node 上成立"。但应用真正跑在 **Electron 主进程**里 ——
 * 一个"Node + Chromium"的混合运行时。两者不是一回事：
 *
 * - Electron 用**自己的** Node 构建（`process.versions.node` 与系统 node 不同）；
 * - 原生模块（这里是 `node:sqlite`）必须能在这个构建里 load 成功；
 * - V8/ABI 也可能不同。
 *
 * 所以这个入口回答的是一个纯 Node 测不出来的问题：
 * **"在真 Electron 运行时里，共享宿主能不能打开真 SQLite 文件并完成一次往返？"**
 *
 * 默认**刻意不创建窗口** —— 于是可以在无桌面会话的环境里跑（CI、SSH、容器）。
 *
 * | 想验证 | 用什么 |
 * |---|---|
 * | 业务逻辑在共享层成立 | `pnpm test`（纯 Node，快） |
 * | Electron 运行时能跑起来 | **本文件**（默认，无窗口，可自动化） |
 * | 窗口真的画出来了 | **本文件 `--window`**（见下），或 `desktop-window.spec.ts` |
 *
 * ## `--window`：无头会话也能证"窗口画出来了"
 *
 * ```bash
 * HEYTA_SMOKE_SHOT=/tmp/desktop.png pnpm --filter @heyta/desktop smoke -- --window
 * ```
 *
 * 🔴 **为什么不是 `--remote-debugging-port` + CDP**：那条路有两个坑，
 * 本仓都真踩过 ——
 *
 *   1. **端口可能早就被别人占着。** 实测在那台 Windows 机器上，9222 被一个
 *      **完全无关的 Tauri 应用**占着；探针连上去截到的是**别人的界面**，
 *      而输出里没有任何一处会告诉你"你截错应用了"。
 *   2. 打包后的 Electron 在无桌面会话里未必起得来调试端口（实测 60s 内没开）。
 *
 * `webContents.capturePage()` 走的是进程内 API：**没有端口、没有竞态、
 * 拿到的一定是本进程这个窗口**。所以它既能当判据，也能当截图。
 *
 * ⚠️ 隐藏窗口的合成器可能不产帧 ⇒ 截出全同色的图。所以这里是**两段式**：
 * 先按隐藏截一次，发现是空白就 `showInactive()` 再截一次，并在输出里
 * **如实报告走的哪条路、第一张是否空白**。不报告这件事的"截图通过"没有意义。
 *
 * 输出是**一行 JSON**（便于脚本断言），退出码 0/1。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BrowserWindow, app, ipcMain, type NativeImage } from 'electron';

import { openDesktopHost } from './host.js';
import { DESKTOP_CHANNELS, handleDesktopRequest, type DesktopRequest } from './ipc-contract.js';

const SMOKE_TITLE = 'electron 运行时冒烟';

/** 开窗截图模式：`--window`。 */
const WANT_WINDOW = process.argv.includes('--window');
/** 截图落盘路径；不传则只做判定、不留文件。 */
const SHOT_PATH = process.env['HEYTA_SMOKE_SHOT'] ?? '';

/**
 * 🔴 开窗模式下**关掉硬件加速**（必须在 `app.whenReady()` 之前）。
 *
 * 在无桌面会话（SSH / CI）里跑，真 Windows 上实测 GPU 进程直接崩：
 *
 *     ERROR:content\browser\gpu\gpu_process_host.cc] GPU process exited
 *       unexpectedly: exit_code=34
 *
 * 跟着 `webContents.capturePage()` 抛 `[Error: UnknownVizError]` ——
 * 没有合成器就没有帧。关掉硬件加速后走软件合成，这一环在无头环境里也成立。
 *
 * ⚠️ **这是一条测试环境的让步，要如实说**：这个冒烟证明的是
 * "这套 UI 在 Electron 的 Chromium 里能渲染出来"，
 * **不是**"GPU 加速路径在这台机器上健康"。后一条只有可见桌面上跑才算。
 */
if (WANT_WINDOW) app.disableHardwareAcceleration();

/**
 * 判断一张截图是不是"什么都没画"。
 *
 * 判据是**采样点的颜色种类数**：真实界面有文字、边框、色块，采样出来几十种颜色；
 * 全白/全黑的空白窗口采样出来只有 1~2 种。比"跟角点比较"更稳
 * （角点在深色主题下是深色、浅色主题下是浅色，都成立）。
 */
function distinctColorBuckets(image: NativeImage): number {
  const size = image.getSize();
  if (size.width === 0 || size.height === 0) return 0;
  const bitmap = image.toBitmap();
  const seen = new Set<number>();
  // BGRA，每 4 字节一个像素
  for (let y = 0; y < size.height; y += 4) {
    for (let x = 0; x < size.width; x += 4) {
      const offset = (y * size.width + x) * 4;
      const b = bitmap[offset] ?? 0;
      const g = bitmap[offset + 1] ?? 0;
      const r = bitmap[offset + 2] ?? 0;
      // 量化到 5 bit/通道，避免抗锯齿噪点把种类数虚高
      seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }
  }
  return seen.size;
}

interface RenderEvidence {
  rows: number;
  bodyLen: number;
  title: string;
  /** 渲染进程里有没有拿到 preload 暴露的桥 —— 没有就说明 preload 路径又错了。 */
  bridge: boolean;
}

/** 等渲染进程真的画出任务行；超时返回当时的实况，而不是抛错。 */
async function waitForRows(window: BrowserWindow, timeoutMs: number): Promise<RenderEvidence> {
  const deadline = Date.now() + timeoutMs;
  let last: RenderEvidence = { rows: 0, bodyLen: 0, title: '', bridge: false };

  for (;;) {
    try {
      const raw = (await window.webContents.executeJavaScript(
        `JSON.stringify({
           rows: document.querySelectorAll('[data-testid^="task-row-"]').length,
           bodyLen: document.body ? document.body.innerText.length : 0,
           title: document.title,
           bridge: typeof window.heytaDesktop === 'object' && window.heytaDesktop !== null,
         })`,
      )) as string;
      last = JSON.parse(raw) as RenderEvidence;
    } catch {
      // 渲染进程还没起来，继续等
    }
    if (last.rows > 0) return last;
    if (Date.now() > deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function smoke(): Promise<number> {
  // 临时目录，跑完就删 —— 冒烟不该在用户真实的 userData 里留东西。
  const dir = mkdtempSync(join(tmpdir(), 'heyta-desktop-smoke-'));

  try {
    const first = await openDesktopHost({ userDataDir: dir });
    await handleDesktopRequest(first, { method: 'addTask', title: SMOKE_TITLE });
    first.close();

    /**
     * 关掉再**重开一个新引擎**读回来。
     *
     * 只写不读会漏掉一整类失败：写进内存缓存也算"成功"，
     * 而这里要证明的是 `node:sqlite` 在 Electron 里**真的落盘了**。
     */
    const second = await openDesktopHost({ userDataDir: dir });
    const tasks = (await handleDesktopRequest(second, { method: 'listTasks' })) as {
      title: string;
    }[];

    const roundTrip = tasks.length === 1 && tasks[0]?.title === SMOKE_TITLE;

    const base = {
      ok: roundTrip,
      electron: process.versions.electron,
      // ⚠️ 这个值与系统 `node --version` **不同** —— 那正是本文件存在的理由。
      node: process.versions.node,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      taskCount: tasks.length,
    };

    if (!WANT_WINDOW) {
      second.close();
      console.log(JSON.stringify(base));
      return roundTrip ? 0 : 1;
    }

    /*
     * ── 开窗模式 ────────────────────────────────────────────────
     *
     * ⚠️ 这里**故意重复** main.ts 的 webPreferences 三件套与两条路径。
     * 不 import main.ts 的 `createWindow()`：那个模块底部挂着 `app.on(...)`
     * 与单实例锁，import 它就等于把整个应用再启动一遍。
     *
     * 重复的代价是**真的**，这里如实记下：窗口偏好或那两条路径改了而这里忘了改，
     * 这个冒烟会在**另一套配置**上通过。挡住它的是
     * `e2e/tests/desktop-window.spec.ts` —— 那条路驱动的是真 main.ts，
     * 两边对同一件事都下了结论时，漂移会被它撞出来。
     */
    ipcMain.handle(DESKTOP_CHANNELS.request, async (_event, request: DesktopRequest) =>
      handleDesktopRequest(second, request),
    );

    const preload = join(__dirname, 'preload.cjs');
    const indexHtml = join(__dirname, '..', 'renderer-dist', 'index.html');

    const makeWindow = (show: boolean): BrowserWindow =>
      new BrowserWindow({
        width: 1100,
        height: 720,
        show,
        focusable: false,
        webPreferences: {
          preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

    let window = makeWindow(false);
    await window.loadFile(indexHtml);

    const hiddenEvidence = await waitForRows(window, 20000);
    const hiddenShot = await window.webContents.capturePage();
    const hiddenBuckets = distinctColorBuckets(hiddenShot);
    const hiddenBlank = hiddenBuckets < 8;

    /*
     * 隐藏窗口的合成器可能不产帧。若第一张是空白，就 showInactive() 再来一次 ——
     * 无头会话里没有可交互桌面，但 Chromium 仍会往离屏表面合成。
     */
    let usedVisible = false;
    let finalShot = hiddenShot;
    let finalEvidence = hiddenEvidence;
    let finalBuckets = hiddenBuckets;

    if (hiddenBlank) {
      window.showInactive();
      usedVisible = true;
      finalEvidence = await waitForRows(window, 10000);
      finalShot = await window.webContents.capturePage();
      finalBuckets = distinctColorBuckets(finalShot);
    }

    const bytes = finalShot.toPNG();
    if (SHOT_PATH !== '') writeFileSync(SHOT_PATH, bytes);

    const size = finalShot.getSize();
    const ok = roundTrip && finalEvidence.rows > 0 && finalBuckets >= 8;

    console.log(
      JSON.stringify({
        ...base,
        ok,
        window: {
          /** preload 真的注入了 —— 没有它渲染进程是瞎的。 */
          bridge: finalEvidence.bridge,
          rows: finalEvidence.rows,
          bodyLen: finalEvidence.bodyLen,
          docTitle: finalEvidence.title,
          shotWidth: size.width,
          shotHeight: size.height,
          shotBytes: bytes.length,
          /** 第一张（隐藏时截的）是不是空白 —— 如实报告，别让"通过"含糊。 */
          hiddenBlank,
          hiddenColorBuckets: hiddenBuckets,
          colorBuckets: finalBuckets,
          usedVisible,
          savedTo: SHOT_PATH,
        },
      }),
    );

    window.destroy();
    second.close();
    return ok ? 0 : 1;
  } finally {
    cleanupTempDir(dir);
  }
}

/**
 * 删临时目录，**失败不让它否决结论**。
 *
 * 🔴 Windows 上实测：`rmSync` 会因 SQLite 的文件句柄还没释放而抛
 * `EPERM`（`\\?\C:\Users\…\Temp\heyta-desktop-smoke-…`）。第一版没有兜住，
 * 于是"清理失败"把整个冒烟变成了红色 —— 而**判据其实已经算出来了**。
 *
 * 这是"证据"与"打扫"混在一起的老问题：打扫不该能否决证据。
 * 所以这里退避重试几次，仍失败就**打印一行警告并放行**，退出码不受影响。
 * 临时目录残留是可接受的代价，用一行警告换"结论不被无关原因污染"值得。
 */
function cleanupTempDir(dir: string): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      // Windows 释放句柄是异步的，睡一会儿再试。
      // `Atomics.wait` 是 Node 里正经的**同步**睡眠 —— 这里不能用 await
      // （`finally` 里没有 async 上下文），也不该忙等烧 CPU。
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  console.warn(`⚠️ 临时目录没能删掉（不影响结论）：${dir}`);
}

/**
 * ⚠️ 本文件编译成 **CJS**（见 `tsup.config.ts`），所以**不能用顶层 await**。
 * 必须包在函数里、经 `app.whenReady()` 触发。
 */
app.whenReady().then(
  () => {
    smoke().then(
      (code) => {
        app.exit(code);
      },
      (error: unknown) => {
        console.error('冒烟失败：', error);
        app.exit(1);
      },
    );
  },
  (error: unknown) => {
    console.error('Electron 启动失败：', error);
    app.exit(1);
  },
);
