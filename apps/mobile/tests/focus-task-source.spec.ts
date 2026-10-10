import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTaskActions, openAppHost, type AppHost } from '@heyta/app-host';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { readFocusTaskSource } from '../src/lib/focus-task-source';

const opened: AppHost[] = [];
async function memoryHost(): Promise<AppHost> {
  const host = await openAppHost({ driverFactory: () => new NodeSqliteDriver(':memory:'), dbPath: ':memory:' });
  opened.push(host);
  return host;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const host of opened.splice(0)) host.close();
});

describe('focus picker reads the currently ready host', () => {
  it('uses real task actions and switches to a new SQLite host without reading the closed old host', async () => {
    const oldHost = await memoryHost();
    const oldTasks = createTaskActions(oldHost);
    await oldTasks.create('旧宿主的待办');
    const completed = await oldTasks.create('旧宿主已完成');
    await oldTasks.setCompleted(completed, true);
    let current: AppHost | undefined = oldHost;
    const readHost = (): AppHost | undefined => current;
    expect(readFocusTaskSource(readHost).tasks).toHaveLength(2);
    expect(readFocusTaskSource(readHost).pendingTasks.map((task) => task.title)).toEqual(['旧宿主的待办']);

    oldHost.close(); // 关闭 :memory: SQLite 会销毁该内存数据库。
    const oldRead = vi.spyOn(oldHost, 'getState').mockImplementation(() => { throw new Error('closed old host must not be read'); });
    current = undefined;
    expect(readFocusTaskSource(readHost)).toEqual({ host: null, tasks: [], pendingTasks: [] });
    const newHost = await memoryHost();
    await createTaskActions(newHost).create('新宿主的待办');
    current = newHost;
    const newWrites = vi.spyOn(newHost, 'dispatch');
    const result = readFocusTaskSource(readHost);
    expect(result.host).toBe(newHost);
    expect(result.tasks.map((task) => task.title)).toEqual(['新宿主的待办']);
    expect(result.pendingTasks.map((task) => task.title)).toEqual(['新宿主的待办']);
    expect(oldRead).not.toHaveBeenCalled();
    expect(newWrites).not.toHaveBeenCalled();
  });
});
