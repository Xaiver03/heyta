/**
 * 移动端的同步状态
 * ==================
 *
 * `SyncClient` 是宿主无关的编排，它**没有订阅层** —— 状态要由宿主主动拉。
 * Web 宿主有自己的 store（zustand）；这里用 React 内建的
 * `useSyncExternalStore`，不引入状态库：
 * 需求就是"一个可订阅的小对象"，那是 React 自带的，没有理由再造一遍。
 *
 * 🔴 **`status` 与"待上传数"必须一起更新。**
 * 只更新状态会让同步成功后界面还显示"待上传 3 项"，
 * 于是用户以为没同步成功、再点一次 —— 而这正是最不该发生的事。
 */

import { useSyncExternalStore } from 'react';
import type { ConflictInfo, SyncStatus } from '@heyta/sync-client';

import { openTaskHost } from '../db/open-host';

export interface MobileSyncState {
  status: SyncStatus;
  /** 上次**成功**同步的时间。失败不清空它 —— 那是用户上一次真正同步的时刻。 */
  lastSyncedAt?: number;
  /**
   * 待上传队列长度。同步后应为 0。
   *
   * 🔴 **`undefined` 表示"还没读过"，不是 0。**
   * 初值写成 `0` 时，「我的」屏在**任何读取发生之前**就显示"已全部上传" ——
   * 实测：本地明明躺着一条从未同步的任务，界面却告诉用户全部上传完了。
   * 这不是显示瑕疵，是**说谎**：用户会据此认为数据已经上云。
   * 所以三态是必须的：`undefined`=未知、`0`=确实没有待上传、`>0`=有。
   */
  pendingUpload: number | undefined;
  /** 正在同步（用于禁用按钮，避免连点打出并发请求）。 */
  busy: boolean;
}

let state: MobileSyncState = {
  status: { kind: 'idle' },
  pendingUpload: undefined,
  busy: false,
};

const listeners = new Set<() => void>();

/** 只在**真的变了**的时候换对象引用 —— `useSyncExternalStore` 靠引用判断变化。 */
function set(patch: Partial<MobileSyncState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): MobileSyncState {
  return state;
}

export function useMobileSync(): MobileSyncState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 重新读取待上传数。**任何一次成功或失败的同步之后都要调。** */
export async function refreshPendingUpload(): Promise<void> {
  const host = await openTaskHost();
  set({ pendingUpload: await host.pendingUploadCount() });
}

/**
 * 同步一次。
 *
 * 🔴 **`busy` 在 `finally` 里复位，不在 `then` 里。**
 * 同步抛异常时如果只有成功路径复位，按钮会**永久禁用** ——
 * 用户唯一的出路是杀掉应用。而"网络异常导致界面卡死"是最难被归因到同步的一类 bug。
 */
export async function syncNow(): Promise<SyncStatus> {
  if (state.busy) return state.status;

  set({ busy: true, status: { kind: 'syncing', phase: 'upload' } });

  try {
    const host = await openTaskHost();
    const status = await host.sync();

    set({
      status,
      ...(status.kind === 'synced' ? { lastSyncedAt: status.at } : {}),
      pendingUpload: await host.pendingUploadCount(),
    });
    return status;
  } catch (error) {
    // 宿主自己会把可预期的失败表达成 `SyncStatus`；能走到这里的都是意外，
    // 所以必须**如实报出来**，不能吞掉变成一句"同步失败"。
    const message = error instanceof Error ? error.message : String(error);
    const status: SyncStatus = { kind: 'error', message, retryable: true };
    set({ status });
    return status;
  } finally {
    set({ busy: false });
  }
}

/** 仅供测试。 */
export function __resetSyncStateForTests(): void {
  state = { status: { kind: 'idle' }, pendingUpload: undefined, busy: false };
  listeners.clear();
}

/**
 * 用户在冲突界面上做出选择。
 *
 * 🔴 **两个方向都走 op-log 重新派发**，由 `SyncClient.resolveConflict` 负责：
 * 保留本机 = 把本地那条重新派发（时钟已含并入的远端时钟）；
 * 保留远端 = 把远端载荷重新表达成一条新的本地 op，**并丢弃**原来那条待上传项。
 * 宿主不得直接改状态 —— 那正是 AGENTS.md §3.4 禁止的绕开 op-log 的写入。
 *
 * 🔴 **返回值是"解决之后的真实状态"，不是"成功"。**
 * 那个方法内部会 `sync()` 一次，所以：
 *   - 全部处理完 → `synced`
 *   - 还剩几处   → `conflict`（带着剩余的清单）
 *   - 又出别的错 → `error`
 * 界面必须**如实显示这个返回值**。这里如果自作主张报"已解决"，
 * 用户会以为剩下的冲突也处理完了 —— 而它们还躺在待上传队列里。
 *
 * ⚠️ `busy` 期间直接返回当前状态（不排队、不并发）：
 * `SyncClient` 没有为并发调用设计，两条并行的同步会互相推进游标。
 * 界面必须用 `busy` 禁用按钮，否则这里就是一个**静默的空操作**。
 */
export async function resolveConflictNow(
  conflict: ConflictInfo,
  choice: 'keep-local' | 'keep-remote',
): Promise<SyncStatus> {
  if (state.busy) return state.status;

  set({ busy: true });

  try {
    const host = await openTaskHost();
    const status = await host.resolveConflict(conflict, choice);

    set({
      status,
      ...(status.kind === 'synced' ? { lastSyncedAt: status.at } : {}),
      pendingUpload: await host.pendingUploadCount(),
    });
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: SyncStatus = { kind: 'error', message, retryable: true };
    set({ status });
    return status;
  } finally {
    // 与 `syncNow` 同样的纪律：复位必须在 `finally` 里。
    // 只写在成功路径上，一次异常就会让界面**永久无法再解决冲突**。
    set({ busy: false });
  }
}