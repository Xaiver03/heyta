/**
 * 桌面端 **GUI 窗口**冒烟（M2）
 * =============================
 *
 * 已有的 `apps/desktop/src/smoke.ts` 回答的是"**Electron 运行时**能不能开库读写"，
 * 它**刻意不开窗口**（于是能在无桌面会话的环境里跑）。但它自己那份表格里写着：
 *
 *     | 窗口真的画出来了 | 只能人眼 / 截图，本文件**不覆盖** |
 *
 * 本文件补的就是这一格。它**真的启动 Electron、真的等窗口出来、真的在里面点**。
 *
 * 🔴 它同时关掉 M1 判据第 4 条：**桌面端加载的是同一套共享 UI**。
 * 断言里查的 `task-row-*` 是 `@heyta/ui` 的 `TaskList` 自己打的 testID ——
 * 如果哪天有人把桌面端改回自己手写的列表，这些断言会立刻失败。
 *
 * ⚠️ 为什么必须**真的点一下"添加"**：只断言"窗口里有内容"的话，
 * 一个写死的静态 HTML 也能过。点了之后要看到**新行出现**，才说明
 * 渲染进程 → preload → IPC → 主进程 → SQLite → 再读回来 → 共享组件重渲染
 * 这条链是通的。
 *
 * ⚠️ 必须用**临时的 userData 目录**：否则冒烟会往真实的用户库里塞示例任务。
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 硬性规范：**任何界面断言都必须留下截图，且人要真的看**
 * ─────────────────────────────────────────────────────────────
 *
 * 这条规则来自一次真实事故（本文件第一版就是这么翻车的）：桌面窗口
 * **全白**，而当时的断言只有"某个元素可见" —— 超时 60 秒后报的是
 * `Test timeout of 60000ms exceeded`，**完全没告诉你界面长什么样**。
 * 空白窗口在自动化里最阴的地方就是：它什么错都不报，只是"没出现"。
 *
 * 所以本文件强制三件事，后来者不要删：
 *
 * 1. **先截图，再断言**（`captureWindow()`）。截图在 `try` 之前就落盘，
 *    所以**失败时也有图**可看，而不是只有一个超时。
 * 2. **抓控制台与页面错误**。白窗口的根因几乎总在控制台里，
 *    而它默认不会出现在测试输出中。不抓的话就只能靠猜。
 * 3. 截图落到**固定路径**（`e2e/test-results/desktop-window.png`），
 *    不随测试名变化 —— 这样 `pnpm check` 之后可以直接打开同一个文件看。
 */

import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test, type Page } from '@playwright/test';

/** `e2e/tests/` → 仓库根。 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DESKTOP_DIR = join(ROOT, 'apps', 'desktop');

/** 截图固定落点 —— 见文件头第 3 条。 */
const SHOT = join(ROOT, 'e2e', 'test-results', 'desktop-window.png');

/**
 * Electron 的可执行文件路径。
 *
 * ⚠️ 不能 `import electron from 'electron'`：`e2e` 是**独立的 pnpm workspace**
 * （有自己的 store），`electron` 装在 `apps/desktop` 下，从本文件按常理解析
 * 是找不到的 —— 报错会是 `Cannot find module 'electron'`，看不出是解析起点的问题。
 * 用 `createRequire` 从 `apps/desktop/package.json` 出发，路径就唯一了。
 *
 * 在 **Node** 里 require `electron` 得到的是**指向二进制的路径字符串**
 * （不是 API 对象）—— 那正是 Playwright 要的 `executablePath`。
 *
 * 🔴 而 `electron/index.js` 在 `path.txt` 缺失时会**自动下载**二进制
 * （并打印 `Downloading Electron binary...`）。本机实测：`pnpm install`
 * 并**不会**把二进制装下来，必须显式跑一次
 * `node apps/desktop/node_modules/electron/install.js`（且要带代理 + `NODE_USE_ENV_PROXY=1`，
 * 见 `pnpm-workspace.yaml` 的 `allowBuilds.electron` 与 `docs/runbooks/desktop.md` §4.1）。
 * 也就是说：**没装二进制时，这一行会静默触发一次 100MB+ 的下载**。
 */
const desktopRequire = createRequire(join(DESKTOP_DIR, 'package.json'));
const electronBinary = desktopRequire('electron') as unknown as string;

/**
 * 把窗口当前的样子拍下来。
 *
 * ⚠️ 返回值里的 `logs` 必须在断言**失败之后**打印 —— 断言成功时它们是噪音。
 * 白窗口的根因（CSP 拦脚本、模块 404、React 抛错）几乎只在这里现形。
 *
 * 🔴 **不 reload。** 第一版在挂完监听后调了 `window.reload()` 想"保证日志都在
 * 监听之后发生"，结果是整条测试**卡死在 reload 上**（连截图都没跑到）。
 * 改成在 `app.on('window')` 上挂监听 —— 那个事件在**窗口刚创建、还没开始加载**
 * 时就触发，天然覆盖整次加载，不需要重载。
 */
async function captureWindow(window: Page, label: string): Promise<readonly string[]> {
  mkdirSync(join(ROOT, 'e2e', 'test-results'), { recursive: true });

  console.log(`   · 当前 URL：${window.url()}`);

  // 给页面一点时间把首帧和错误都吐出来 —— 太早截图会拍到中间态。
  await window.waitForTimeout(1500);
  await window.screenshot({ path: SHOT });
  console.log(`📷 ${label} 截图：${SHOT}`);

  return logs;
}

/**
 * 控制台与页面错误的收集器。
 *
 * ⚠️ 放在模块级、并在**窗口一创建**就挂上（见测试体里的 `app.on('window')`）——
 * 挂晚了就收不到加载期的错误，而白窗口的根因 100% 在加载期。
 */
const logs: string[] = [];

function attachLogs(page: Page): void {
  page.on('console', (message) => {
    logs.push(`[console.${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    logs.push(`[pageerror] ${error.message}`);
  });
}

test('桌面端：真窗口打开，且共享 UI 真的画出来了', async () => {
  test.setTimeout(120_000);

  const userDataDir = mkdtempSync(join(tmpdir(), 'heyta-desktop-gui-'));
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [join(DESKTOP_DIR, 'dist', 'main.cjs'), `--user-data-dir=${userDataDir}`],
    cwd: DESKTOP_DIR,
    /**
     * 🔴 让窗口**不要抢前台**（见 `apps/desktop/src/main.ts` 的 `NO_FOCUS`）。
     *
     * 不加这一条，每跑一次冒烟就会把用户从正在做的事情里踢出来 ——
     * 谁都不会愿意为一个后台检查反复失去焦点。
     */
    env: { ...process.env, HEYTA_DESKTOP_NO_FOCUS: '1' },
  });

  // 🔴 在等窗口**之前**就挂监听：`window` 事件在窗口刚创建、页面还没开始加载时触发。
  app.on('window', attachLogs);
  console.log('① Electron 已启动');

  try {
    const window = await app.firstWindow();
    attachLogs(window); // 双保险：万一 window 事件早于本行执行
    console.log('② 拿到窗口');

    // 🔴 先截图 —— 顺序不能反。失败时也要有图。
    await captureWindow(window, '首帧');
    console.log('③ 首帧截图完成');

    try {
      // 1. 页面本体起来了（不是白窗口）。
      await expect(window.getByTestId('desktop-root')).toBeVisible();
      console.log('④ 页面根节点可见');

      // 2. 共享组件渲染完成 —— `desktop-loading` 消失是"IPC 回来了"的信号。
      //
      // ⚠️ 先等 loading 消失再断言列表，否则会在"还没读到库"的空窗期
      // 断言一个正常为空的列表，把一次真实的读取失败当成通过。
      await expect(window.getByTestId('desktop-loading')).toHaveCount(0);
      await expect(window.getByTestId('desktop-error')).toHaveCount(0);
      console.log('⑤ 宿主数据已回来');

      const rowsBefore = await window.locator('[data-testid^="task-row-"]').count();

      // 3. 点一下"添加"，然后**等新行真的出现**。
      await window.getByTestId('desktop-add').click();
      await expect(window.locator('[data-testid^="task-row-"]')).toHaveCount(rowsBefore + 1);
      console.log(`⑥ 新增一行成功（${rowsBefore} → ${rowsBefore + 1}）`);

      // 4. 行的文案来自共享组件 + 库里的真数据。
      await expect(window.locator('[data-testid^="task-row-"]').last()).toContainText('示例任务');

      // 5. 点击后的第二张截图（此时列表里应该有新行）。
      await window.screenshot({ path: SHOT });
      console.log('⑦ 全部断言通过');
    } catch (failure) {
      /**
       * ⚠️ 断言失败时**必须**把控制台吐出来。
       *
       * 白窗口在自动化里的表现是"某个元素一直不出现"，而**为什么**不出现
       * 只在控制台里。不打印的话，下一个人只能重新跑一遍去复现。
       */
      console.error('\n──── 窗口控制台 / 页面错误 ────');
      console.error(logs.length === 0 ? '（无输出 —— 那更可疑：脚本可能压根没执行）' : logs.join('\n'));
      console.error(`──── 截图见 ${SHOT} ────\n`);
      throw failure;
    }
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
