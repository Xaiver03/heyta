/**
 * 任务列表排序口径的**设备本地**偏好。
 * =====================================================
 *
 * 与 `due-display-pref.ts`、`features/shell/modules.ts` 同一条推理：
 * "这台设备上我想按什么顺序看"是**界面选择**，不是用户数据 ——
 * 所以它不进 op-log（op-log 只装用户意图，AGENTS §3.4），也不跨设备同步。
 * 手机上按截止时间、电脑上按优先级，是两台设备各自的自由。
 *
 * 三条纪律照抄那两份：
 * 1. **永不抛** —— 隐私模式下 `localStorage` 会抛，读失败退默认、写失败静默；
 * 2. 非法值（手改存储 / 旧版本残留）退回默认档，而不是让列表变空；
 * 3. 可选值只有领域 `TASK_SORT_KEYS` 那一套 —— **不在这里再列一遍**，
 *    否则加一档时要改两个地方，而漏改的那处表现成"选项存了但没生效"。
 */

import { TASK_SORT_KEYS, type TaskSortKey } from '@heyta/domain';

const KEY = 'heyta.taskSort';

export function loadTaskSort(): TaskSortKey {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'string' && (TASK_SORT_KEYS as readonly string[]).includes(parsed)) {
        return parsed as TaskSortKey;
      }
    }
  } catch {
    // 读失败 = 默认值，不崩。
  }
  return 'display';
}

export function saveTaskSort(sort: TaskSortKey): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sort));
  } catch {
    // 写失败不影响本次生效。
  }
}
