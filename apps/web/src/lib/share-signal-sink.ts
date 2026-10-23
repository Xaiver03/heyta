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

/*
 * ── 第三条通道：「这份清单的成员面变了」 ──────────────────────────────────
 *
 * ADR-0070。传输侧仍然只有一个消费者（和上面两条同一条纪律），界面侧则按 shareId
 * 登记**自己那份重取**：面板登记 `reload`、入群对话框登记 `finalize`。
 * 为什么键要带 shareId 而重画那条不带：面板同时只会有一份，而"哪一份的名单变了"
 * 必须能对上正在显示的那一份 —— 别处的成员变化不该把我这节刷一下。
 *
 * 🔴 没有登记任何目标 ⇒ 一条请求都不发。这不是优化，是形状决定的：
 * 面板没开的时候没有人显示名册，重取回来的东西没有读者，而它消耗一次带令牌的 GET。
 * 用户下一次打开面板时 `reload` 自己会把状态取正。
 */
export type ShareRosterSink = (shareId: string) => void;

let rosterSink: ShareRosterSink | undefined;

export function setShareRosterSink(next: ShareRosterSink | undefined): void {
  rosterSink = next;
}

export function dispatchShareRosterSignal(shareId: string): void {
  rosterSink?.(shareId);
}

/** 只给测试用：现在有没有人在收成员面信号。 */
export function hasShareRosterSink(): boolean {
  return rosterSink !== undefined;
}

type ShareRosterTarget = () => Promise<void>;

const rosterTargets = new Map<string, Set<ShareRosterTarget>>();

/** 登记一节界面自己的重取；返回注销函数（React effect 的 cleanup 直接可用）。 */
export function registerShareRosterTarget(shareId: string, target: ShareRosterTarget): () => void {
  let set = rosterTargets.get(shareId);
  if (set === undefined) {
    set = new Set<ShareRosterTarget>();
    rosterTargets.set(shareId, set);
  }
  set.add(target);
  return () => {
    const current = rosterTargets.get(shareId);
    if (current === undefined) return;
    current.delete(target);
    if (current.size === 0) rosterTargets.delete(shareId);
  };
}

/**
 * 跑一遍这一份清单上所有登记着的重取。
 *
 * 🔴 各目标并发跑、但**谁炸了都不许把别人带走**（`allSettled`），同时只要有一枚失败
 * 就整体抛 —— 抛出去才有读数（`createShareRosterSignalHandler` 的 `failed` 那一格），
 * 静默成功会让"面板其实没更新"这件事在界面上和成功长得一模一样。
 */
export async function runShareRosterTargets(shareId: string): Promise<void> {
  const set = rosterTargets.get(shareId);
  if (set === undefined || set.size === 0) return;
  const results = await Promise.allSettled([...set].map((target) => target()));
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error('share roster refresh failed');
  }
}

/** 只给测试用：这一份清单上有几节界面登记着重取。 */
export function shareRosterTargetCount(shareId: string): number {
  return rosterTargets.get(shareId)?.size ?? 0;
}

/**
 * 现在有哪几份清单被界面登记着。
 *
 * 🔴 这一格是**必需的**，不是便利：刚点完「接受邀请」那台设备正停在"等 owner 下发信封"，
 * 而它的清单行绑定（`shareIdsOnDevice` 读的那份）**还没写** —— 那是 `finalize` 成功之后
 * 才做的事。只按清单行绑定做闸门的话，owner 发信封那条信号会在这台设备上被判成
 * "本机不认得"而丢掉，于是它永远停在等待页 —— 与 M2 收尾抓到的那格自锁同一形状
 * （闸门认得的东西，恰好是它拦住的那个动作的产物）。
 */
export function shareRosterTargetShareIds(): string[] {
  return [...rosterTargets.keys()];
}
