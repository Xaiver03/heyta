/**
 * 清单级排序偏好。
 *
 * 这是设备上的阅读选择，不是同步数据：清单本身仍由 op-log 管理，
 * 这里只按清单 id 记住用户在这台设备上想怎么扫列表。
 */
import { TASK_SORT_KEYS, type TaskSortKey } from '@heyta/domain';

const KEY = 'heyta.projectTaskSort';

function readAll(): Record<string, TaskSortKey> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, TaskSortKey> = {};
    for (const [projectId, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && (TASK_SORT_KEYS as readonly string[]).includes(value)) {
        result[projectId] = value as TaskSortKey;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function loadProjectTaskSort(projectId: string): TaskSortKey | undefined {
  return readAll()[projectId];
}

export function saveProjectTaskSort(projectId: string, sort: TaskSortKey): void {
  try {
    const next = readAll();
    next[projectId] = sort;
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 隐私模式或存储配额失败不影响当前列表。
  }
}
