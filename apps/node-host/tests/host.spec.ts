/**
 * Node 宿主：真实 SQLite 文件上的读写与持久化。
 *
 * 这里**没有任何 mock**：每个用例都打开一个临时目录里的真实 `.sqlite` 文件。
 * 因此它证明不了同步（那需要真实服务端，见 `scripts/verify-p2-node-host.mjs`），
 * 但能证明本地这一半：写入经 op-log 落盘、重启后从**整个日志**重建。
 */

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openNodeHost, type NodeHost } from '../src/host.js';

const tempDirs: string[] = [];
const opened: NodeHost[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-node-host-'));
  tempDirs.push(dir);
  return join(dir, 'heyta.sqlite');
}

afterEach(() => {
  for (const host of opened.splice(0)) host.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Node 宿主：真实 SQLite 文件', () => {
  it('add → 关闭 → 重开新引擎：任务仍在（从整个日志重建，不是内存缓存）', async () => {
    const dbPath = tempDbPath();

    const first = await openNodeHost({ dbPath });
    opened.push(first);
    const id = await first.addTask('买牛奶');

    expect(first.listTasks().map((task) => task.title)).toEqual(['买牛奶']);
    const firstClientId = first.clientId;
    first.close();

    // 文件真的非空 —— 数据在磁盘上，不在内存里
    expect(statSync(dbPath).size).toBeGreaterThan(0);

    // 「重开」= 新的适配器 + 新的引擎，内存里一无所有
    const second = await openNodeHost({ dbPath });
    opened.push(second);

    const tasks = second.listTasks();
    expect(tasks.map((task) => task.id)).toEqual([id]);
    expect(tasks[0]!.title).toBe('买牛奶');

    // 设备 id 也是持久的：LWW 决胜依据不能每次重开就换一个
    expect(second.clientId).toBe(firstClientId);
  });

  it('改名与完成也是 op，重开后状态一致', async () => {
    const dbPath = tempDbPath();

    const first = await openNodeHost({ dbPath });
    opened.push(first);
    const id = await first.addTask('原始标题');
    await first.renameTask(id, '改过的标题');
    await first.setCompleted(id, true);
    first.close();

    const second = await openNodeHost({ dbPath });
    opened.push(second);
    const task = second.listTasks()[0]!;
    expect(task.title).toBe('改过的标题');
    expect(task.completedAt).toBeTypeOf('number');

    // 「取消完成」用 null 表达显式清除，重开后必须真的被清掉
    await second.setCompleted(id, false);
    second.close();

    const third = await openNodeHost({ dbPath });
    opened.push(third);
    expect(third.listTasks()[0]!.completedAt).toBeUndefined();
  });

  it('未登录/无口令时同步明确失败，不假装成功', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    await host.addTask('离线任务');

    // 没有 token → SyncClient 返回 error（不是 offline，也不是 synced）
    const status = await host.sync();
    expect(status.kind).toBe('error');

    // 离线写入必须仍在待上传队列里，不能因为同步失败丢了
    expect(await host.pendingUploadCount()).toBe(1);
  });

  it('空标题不建任务（抛错而不是静默忽略）', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    await expect(host.addTask('   ')).rejects.toThrow('任务标题不能为空');
    expect(host.listTasks()).toEqual([]);
  });
});
