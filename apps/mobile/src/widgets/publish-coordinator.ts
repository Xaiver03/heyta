/**
 * 小组件发布与清理之间的生命周期屏障。
 *
 * 清理账号状态时，不能让已经开始的 seal/write 在清理之后又把旧快照写回去。
 * 这个文件故意不依赖 React Native 或 bridge：发布管线和原生清理桥都要使用它，
 * 但两者不能互相 import。
 */

let publishEpoch = 0;
let currentPublish: Promise<void> | undefined;
/** 原生实时活动也会保留标题，清理必须等已启动的异步更新落定。 */
const currentActivities = new Set<Promise<unknown>>();

/**
 * 清理是一个可以重叠的操作：登出、切换账号和凭据失效可能在同一轮事件循环里
 * 同时进入。不能用一个布尔值表示它们的生命周期，否则先完成的操作会把仍在进行的
 * 操作挡板提前放下，随后发布就能把旧快照写回共享容器。
 */
let activeCleanupCount = 0;
let nextCleanupLeaseId = 0;

/**
 * 清理失败后的闸门。失败必须持续到一个**之后开始**且成功完成的显式清理；
 * 同一批已经在途的清理即使随后成功，也不能替失败的操作解除闸门。
 */
let failedCleanupBarrier: number | undefined;

function cleanupBlocked(): boolean {
  return activeCleanupCount > 0 || failedCleanupBarrier !== undefined;
}

export function currentPublishEpoch(): number | undefined {
  return cleanupBlocked() ? undefined : publishEpoch;
}

export function canCommitPublish(epoch: number): boolean {
  return !cleanupBlocked() && epoch === publishEpoch;
}

export function registerPublish(promise: Promise<void>): void {
  currentPublish = promise;
  const clear = (): void => {
    if (currentPublish === promise) currentPublish = undefined;
  };
  promise.then(clear, clear);
}

export function registerWidgetActivity(promise: Promise<unknown>): void {
  currentActivities.add(promise);
  const clear = (): void => { currentActivities.delete(promise); };
  promise.then(clear, clear);
}

export interface WidgetCleanupLease {
  /** 原生清理成功后释放屏障；失败时保持屏障，避免旧快照再次发布。 */
  release(success: boolean): void;
}

/** 建立清理屏障，等待在途快照及实时活动结束，再由调用者清除原生状态。 */
export async function beginWidgetCleanup(): Promise<WidgetCleanupLease> {
  const leaseId = ++nextCleanupLeaseId;
  activeCleanupCount += 1;
  publishEpoch += 1;
  const inFlight = [...currentActivities];
  if (currentPublish !== undefined) inFlight.push(currentPublish);
  await Promise.allSettled(inFlight);

  let released = false;
  return {
    release(success: boolean): void {
      if (released) return;
      released = true;
      activeCleanupCount = Math.max(0, activeCleanupCount - 1);
      if (success) {
        // 只有失败之后才开始的清理才有资格解除失败闸门。
        if (
          failedCleanupBarrier !== undefined &&
          leaseId > failedCleanupBarrier
        ) {
          failedCleanupBarrier = undefined;
        }
        // 若仍有其它清理在途，计数器继续挡住发布；这里只更新 epoch，
        // 让已经拿到旧 epoch 的发布永远不能提交。
        publishEpoch += 1;
      } else {
        // 失败闸门保持到后续显式成功清理，避免旧快照复活。
        // 包括失败发生时已经开始的所有 lease；它们不能算失败之后的新清理。
        failedCleanupBarrier = Math.max(failedCleanupBarrier ?? 0, nextCleanupLeaseId);
      }
    },
  };
}

export function isWidgetPublishBlocked(): boolean {
  return cleanupBlocked();
}

/** 仅供测试：恢复模块级生命周期状态。 */
export function resetWidgetPublishCoordinatorForTests(): void {
  publishEpoch = 0;
  activeCleanupCount = 0;
  nextCleanupLeaseId = 0;
  failedCleanupBarrier = undefined;
  currentPublish = undefined;
  currentActivities.clear();
}
