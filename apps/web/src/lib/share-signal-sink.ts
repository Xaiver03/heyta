/**
 * 实时信号（`new_share_ops`）的**投递垫片**。
 *
 * 为什么要有这一小块：`apps/web/src/features/share/**` 要读同步设置与登录态
 * （`features/sync/store.js`），而实时通道恰好就建在那个 store 里 ——
 * 让 store 反过来 import 共享那一侧就是个**循环**。垫片只有一件事：
 * 谁愿意收信号谁来注册，通道只管把 `(shareId, latestSeq)` 递出去。
 *
 * 🔴 注册是覆盖式（一个产品只该有一处消费者）。未注册时信号被丢掉：
 *    那不会是静默故障，因为唯一的注册点在根组件上（`useShareActivitySignal()`），
 *    而它有判据钉着（`tests/share-activity-signal.spec.tsx`）—— 不是靠这里写日志。
 */

export type ShareSignalSink = (shareId: string, latestSeq: number) => void;

let sink: ShareSignalSink | undefined;

export function setShareSignalSink(next: ShareSignalSink | undefined): void {
  sink = next;
}

export function dispatchShareSignal(shareId: string, latestSeq: number): void {
  sink?.(shareId, latestSeq);
}

/** 只给测试用：现在有没有人在收。 */
export function hasShareSignalSink(): boolean {
  return sink !== undefined;
}

/*
 * ── 第二条通道：「本机已经有新内容了」 ────────────────────────────────────
 *
 * 为什么要有它（也为什么不能就用上面那条）：上面那条是**传输**的消费者，一个产品
 * 只该有一处 —— 拉取、判活动、发通知都归它。而界面这边要的不是"再拉一次"，
 * 是"把我显示的那份重画一下"。
 *
 * 🔴 关键事实：下行游标是**这份 share 全局一份**（落在 `localStorage` 的
 *   `heyta.share-log.cursor.<shareId>`），谁先拉到都把它推进了。所以正在显示评论区的
 *   那一侧**再拉一次只会拿到 `fetched = 0`**（而它的宿主又按实例缓存重放结果），
 *   界面上就会永远停在打开那一刻。正确动作是**从盘上重放**，不是第二次下载 ——
 *   这条通道传的就是"去重放"这个信号，不带 shareId：调用方没有"任务 → 清单"的映射，
 *   而重放的成本只在真开着那一节时才发生。
 */
export type ShareRepaintListener = () => void;

const repaintListeners = new Set<ShareRepaintListener>();

/** 注册一个重画监听；返回注销函数（React  effect 的 cleanup 直接可用）。 */
export function subscribeShareRepaint(listener: ShareRepaintListener): () => void {
  repaintListeners.add(listener);
  return () => repaintListeners.delete(listener);
}

/** 由那个唯一的传输消费者在**真的拉到新内容**之后调用。 */
export function emitShareRepaint(): void {
  for (const listener of [...repaintListeners]) listener();
}

/** 只给测试用：现在有几个界面在等重画。 */
export function shareRepaintListenerCount(): number {
  return repaintListeners.size;
}
