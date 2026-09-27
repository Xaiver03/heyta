/**
 * Electron **运行时**冒烟（无窗口）
 * ==================================
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
 * 它**刻意不创建窗口** —— 于是可以在无桌面会话的环境里跑（CI、SSH、容器），
 * 这正是"GUI 冒烟"与"运行时冒烟"的分工：
 *
 * | 想验证 | 用什么 |
 * |---|---|
 * | 业务逻辑在共享层成立 | `pnpm test`（纯 Node，快） |
 * | Electron 运行时能跑起来 | **本文件**（无窗口，可自动化） |
 * | 窗口真的画出来了 | 只能人眼 / 截图，本文件**不覆盖** |
 *
 * 输出是**一行 JSON**（便于脚本断言），退出码 0/1。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { app } from 'electron';

import { openDesktopHost } from './host.js';
import { handleDesktopRequest } from './ipc-contract.js';

const SMOKE_TITLE = 'electron 运行时冒烟';

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
    second.close();

    const roundTrip = tasks.length === 1 && tasks[0]?.title === SMOKE_TITLE;

    console.log(
      JSON.stringify({
        ok: roundTrip,
        electron: process.versions.electron,
        // ⚠️ 这个值与系统 `node --version` **不同** —— 那正是本文件存在的理由。
        node: process.versions.node,
        chrome: process.versions.chrome,
        platform: process.platform,
        arch: process.arch,
        taskCount: tasks.length,
      }),
    );

    return roundTrip ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
