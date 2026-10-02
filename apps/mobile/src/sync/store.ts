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

import { requireNetworkConsent } from '../privacy/consent-ui';
import { readSyncConfig } from './config';
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
  /**
   * **本地物化数据的版本号。每完成一次同步就 +1**（成功或失败都加）。
   *
   * 🔴 为什么必须有它：任务屏、日历屏读的是**内存里的物化状态**
   * （`host.engine.getState()`），而它们只在挂载时读一次。
   * 实测的后果：冷启动落在「任务」页（此时是空的）→ 去「我的」同步 →
   * 切回「任务」——**屏幕一直挂着，`useEffect` 依赖没变，不会重读**，
   * 于是界面显示"还没有任务"，而**数据库里那条任务明明已经应用了**
   * （重启 App 就能看见）。
   *
   * 这不是显示瑕疵：用户会据此认为"同步没成功/多端没同步"，
   * 而真相是**数据已经到了，只是没人告诉界面去看一眼**。
   *
   * 为什么"失败也加"：同步是**先下载后上传**的两段。下载段可能已经
   * 应用并物化了远端 op，之后上传段才失败 —— 那种情况下数据是**新的**，
   * 界面必须重读。按"只在成功时加"写，就会漏掉这一类。
   */
  dataRevision: number;
}

let state: MobileSyncState = {
  status: { kind: 'idle' },
  pendingUpload: undefined,
  busy: false,
  dataRevision: 0,
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

/** 这台设备**配好了**同步（地址 + 令牌都齐）。纯本机判断，不发任何请求。 */
function isConfigured(): boolean {
  const config = readSyncConfig();
  return (
    config !== undefined && config.serverUrl !== '' && (config.token ?? '') !== ''
  );
}

/**
 * 用户**主动**发起同步时的那道同意闸（计划 **G-12**）。
 *
 * @returns 被拦下时要写进 `status` 的那条错误（同时把面板弹起来）；放行时 `null`。
 *
 * 🔴 顺序是**先"配没配"、后"同没同意"**，与 web 侧 `consentGate()` 逐字同一条纪律：
 * 没配服务端的用户拿到 `not-signed-in`（真话、可操作），
 * 而不是让他先去处理一件此刻不必要的事。未配置时**不会**走到出站代码，
 * `SyncClient` 在发第一个请求之前就返回那条状态。
 */
function consentGate(): SyncStatus | null {
  if (!isConfigured()) return null;
  if (requireNetworkConsent()) return null;
  return { kind: 'error', reason: 'consent-required', retryable: false };
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

  /**
   * 🔴 用户主动点「同步」时的那道同意闸（计划 **G-12**）。
   *
   * 拦在这里而不是只拦在 `auto-sync.ts` 的 `ready()` 里，是因为这两条路
   * 触发的是**同一个** `syncNow()`：自动那条有 `ready()` 挡着，
   * 手点这条**没有**任何东西挡 —— 少这一句，症状就是
   * 「没同意的人在『我的』页按一下，数据就出去了」，而且**不报错**。
   *
   * 拦下时把面板**一起**弹起来（`requireNetworkConsent` 内部做的事）：
   * 只写一条错误状态的话，用户读到的是"同步失败了"，
   * 而真正的出路（去作那个决定）界面上没有给。
   *
   * ⚠️ 排在**本地配置判断之后**（与 web 侧 `consentGate()` 同一条顺序纪律）：
   * 没配服务端的用户拿到的是 `not-signed-in`，不是 `consent-required`。
   * "你还没配同步服务"对着一个什么都没配的人是真话、且可操作；
   * 让他先去处理隐私面板，是在让他做一件此刻不必要的事。
   */
  const blocked = consentGate();
  if (blocked !== null) {
    set({ status: blocked });
    return blocked;
  }

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
    const status: SyncStatus = { kind: 'error', reason: 'unexpected', message, retryable: true };
    set({ status });
    return status;
  } finally {
    // 🔴 `dataRevision` 在 `finally` 里加，**不在成功路径上加** ——
    // 同步是"先下载后上传"两段，下载段可能已经应用了远端 op，
    // 之后上传段才失败。只在成功时加会漏掉这类"数据其实变了"的情况。
    set({ busy: false, dataRevision: state.dataRevision + 1 });
  }
}

/** 仅供测试。 */
export function __resetSyncStateForTests(): void {
  state = { status: { kind: 'idle' }, pendingUpload: undefined, busy: false, dataRevision: 0 };
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
    const status: SyncStatus = { kind: 'error', reason: 'unexpected', message, retryable: true };
    set({ status });
    return status;
  } finally {
    // 与 `syncNow` 同样的纪律：复位必须在 `finally` 里。
    // 只写在成功路径上，一次异常就会让界面**永久无法再解决冲突**。
    // `dataRevision` 同理在 `finally` 里加 —— 解决冲突本身会重新派发 op 并同步。
    set({ busy: false, dataRevision: state.dataRevision + 1 });
  }
}