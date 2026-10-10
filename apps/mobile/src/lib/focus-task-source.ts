import { createTaskActions, type AppHost } from '@heyta/app-host';
import type { Task } from '@heyta/domain';

/** 屏幕接线：每次重读当前已就绪宿主，不缓存注销前的物化状态。 */
export function readFocusTaskSource(readHost: () => AppHost | undefined): {
  host: AppHost | null;
  tasks: Task[];
  pendingTasks: Task[];
} {
  const host = readHost();
  if (host === undefined) return { host: null, tasks: [], pendingTasks: [] };
  const actions = createTaskActions(host);
  return { host, tasks: actions.listTasks(), pendingTasks: actions.listPendingTasks() };
}
