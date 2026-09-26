/**
 * 同步状态 → 人话
 * =================
 *
 * `SyncStatus` 是给程序看的判别联合；这个文件把它变成用户能读、能行动的句子。
 *
 * 🔴 **为什么要单独一个文件、而不是在界面里写 `switch`：**
 * 状态文案会被多个地方用到（「我的」、将来的同步条、通知）。
 * 各写一份 `switch` 就是本项目已经吃过两次亏的那种漂移
 * （见 AGENTS.md §3.5）—— 而这里的漂移后果是"同一个状态在两处说法不同"，
 * 用户会以为它们是两件事。
 *
 * 🔴 **每种失败都必须说清是哪一种。** "同步失败"这四个字没有任何行动价值：
 * 未配置要去填设置、口令错误要去核对口令、服务端连不上要去检查网络或地址。
 * 三者混成一句话，用户唯一能做的是反复点同步。
 */

import type { SyncStatus } from '@heyta/sync-client';

export function describeSyncStatus(status: SyncStatus): string {
  switch (status.kind) {
    case 'idle':
      return '尚未同步';
    case 'syncing':
      return status.phase === 'download' ? '正在下载…' : '正在上传…';
    case 'synced':
      return '已是最新';
    case 'offline':
      return '当前离线';
    case 'conflict':
      return `有 ${String(status.conflicts.length)} 处冲突待你选择`;
    case 'error':
      return '同步失败';
    default: {
      // 穷尽性检查：`SyncStatus` 新增成员时这里会**编译报错**，
      // 而不是安静地显示一句空话。
      const never: never = status;
      return String(never);
    }
  }
}

/**
 * 状态对应的文字语气。
 *
 * 只有 `error` / `conflict` 用 danger —— `offline` **不算错误**：
 * 本地优先的应用离线是正常工作状态，标红会让用户以为出了问题。
 */
export function statusTone(status: SyncStatus): 'default' | 'muted' | 'danger' | 'success' {
  switch (status.kind) {
    case 'synced':
      return 'success';
    case 'error':
    case 'conflict':
      return 'danger';
    case 'idle':
    case 'offline':
      return 'muted';
    case 'syncing':
      return 'default';
    default: {
      const never: never = status;
      return String(never) as 'default';
    }
  }
}