/**
 * 桌面宿主骨架：真实 SQLite 文件上的端到端验证
 * ==============================================
 *
 * 🔴 这个测试**不起 Electron**，但它测的**就是应用跑的那条路径** ——
 * `openDesktopHost`（库文件定位）与 `handleDesktopRequest`（IPC 白名单）
 * 与 `main.ts` 用的是同两个函数。测试里另接一套的话，测的就不是应用了。
 *
 * 因此它能在**不下载 Electron 二进制**的前提下回答最关键的问题：
 * "桌面端真的复用了共享层、而不是又抄了一遍吗？"
 *
 * 这里**没有任何 mock**：每个用例都开一个临时目录里的真实 `.sqlite` 文件。
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { NodeHost } from '@heyta/node-host';
import { DESKTOP_DB_FILENAME, desktopDbPath, openDesktopHost } from '../src/host.js';
import { handleDesktopRequest, type DesktopRequest } from '../src/ipc-contract.js';

const tempDirs: string[] = [];
const opened: NodeHost[] = [];

function tempUserDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-desktop-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const host of opened.splice(0)) host.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('桌面宿主：库文件定位', () => {
  it('库文件落在 userData 目录下，而不是可执行文件旁边', () => {
    expect(desktopDbPath('/tmp/userData')).toBe(join('/tmp/userData', DESKTOP_DB_FILENAME));
  });

  it('打开宿主后，磁盘上**真的**出现了那个 SQLite 文件', async () => {
    const userDataDir = tempUserDataDir();
    const host = await openDesktopHost({ userDataDir });
    opened.push(host);

    expect(existsSync(desktopDbPath(userDataDir))).toBe(true);
    expect(host.dbPath).toBe(desktopDbPath(userDataDir));
  });
});

describe('IPC 契约：走的就是 main.ts 用的那条路径', () => {
  it('🔴 写 → 关 → 重开新引擎：任务仍在（经 op-log 落盘，不是内存缓存）', async () => {
    const userDataDir = tempUserDataDir();

    const first = await openDesktopHost({ userDataDir });
    const created = (await handleDesktopRequest(first, {
      method: 'addTask',
      title: '桌面端建的任务',
    })) as string;
    expect(created).toBeTruthy();
    expect((await handleDesktopRequest(first, { method: 'listTasks' })) as unknown[]).toHaveLength(
      1,
    );
    first.close();

    // 新引擎、同一个文件 —— 这才是"持久化"而不是"进程内还在"。
    const second = await openDesktopHost({ userDataDir });
    opened.push(second);
    const tasks = (await handleDesktopRequest(second, { method: 'listTasks' })) as {
      title: string;
    }[];
    expect(tasks.map((task) => task.title)).toEqual(['桌面端建的任务']);
  });

  it('改名与完成状态经同一个白名单生效', async () => {
    const userDataDir = tempUserDataDir();
    const host = await openDesktopHost({ userDataDir });
    opened.push(host);

    const id = (await handleDesktopRequest(host, {
      method: 'addTask',
      title: '原标题',
    })) as string;

    await handleDesktopRequest(host, { method: 'renameTask', entityId: id, title: '新标题' });
    await handleDesktopRequest(host, { method: 'setCompleted', entityId: id, completed: true });

    /**
     * ⚠️ 领域模型用 **`completedAt: number` 时间戳**，不是 `completed: boolean`。
     *
     * 我第一版断言写的是 `completed: true`，测试**红了才发现的** —— 这里留档，
     * 因为它是"外壳不该猜领域字段"的一个具体例子：
     * 桌面壳把 `completed: true` 原样透传给 `setCompleted`，由领域层决定
     * 落成哪个字段。壳猜字段名就会猜错，而领域层本来就该是唯一说话的人。
     */
    const tasks = (await handleDesktopRequest(host, { method: 'listTasks' })) as {
      title: string;
      completedAt: number | null;
    }[];
    expect(tasks).toEqual([
      expect.objectContaining({ title: '新标题', completedAt: expect.any(Number) }),
    ]);
  });

  it('待上传队列一开始是空的（离线也能读写，队列只为同步存在）', async () => {
    const userDataDir = tempUserDataDir();
    const host = await openDesktopHost({ userDataDir });
    opened.push(host);

    expect(await handleDesktopRequest(host, { method: 'pendingUploadCount' })).toBe(0);
  });
});

describe('IPC 契约是白名单，不是反射', () => {
  it('🔴 `close` 不在白名单里 —— 渲染进程不能关掉主进程的库连接', async () => {
    const userDataDir = tempUserDataDir();
    const host = await openDesktopHost({ userDataDir });
    opened.push(host);

    /**
     * 故意绕开类型系统。这是本用例的**重点**：类型只在编译期挡人，
     * 而真正的渲染进程是运行时输入 —— 恶意或过期的页面会发任意形状的请求。
     */
    const forged = { method: 'close' } as unknown as DesktopRequest;
    await expect(handleDesktopRequest(host, forged)).rejects.toThrow(/未处理的桌面请求/);

    // 库**仍然可用** —— 证明上面那一下确实没关掉它。
    expect(await handleDesktopRequest(host, { method: 'pendingUploadCount' })).toBe(0);
  });

  it('🔴 请求里**没有**任何字段能指定数据库路径', async () => {
    const userDataDir = tempUserDataDir();
    const host = await openDesktopHost({ userDataDir });
    opened.push(host);

    const before = host.dbPath;
    expect(before).toBe(desktopDbPath(userDataDir));

    /**
     * ⚠️ 注意这条断言要怎么写才诚实。
     *
     * 伪造的 `dbPath` **不会**让请求被拒 —— 运行时会命中 `listTasks` 分支，
     * 多余的字段被静静忽略。所以"它会抛错"是**错的断言**。
     *
     * 真正的不变量是：**没有任何代码路径会去读请求里的路径**。
     * 因此正确的断言是「库位置不受影响」，而不是「请求被拒绝」。
     * 这两者的区别很重要 —— 写成前者会让这个用例**因为错误的原因通过**。
     */
    const forged = { method: 'listTasks', dbPath: '/tmp/elsewhere.sqlite' } as unknown as
      DesktopRequest;
    await expect(handleDesktopRequest(host, forged)).resolves.toBeDefined();

    expect(host.dbPath).toBe(before);
    expect(existsSync('/tmp/elsewhere.sqlite')).toBe(false);
  });
});
