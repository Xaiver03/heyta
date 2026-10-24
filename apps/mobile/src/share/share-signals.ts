/**
 * 移动端**共享信号**的投递与装配垫片（M6；对齐 web 的 `share-signal-sink` + 两个 hook 的
 * 形状，但没有 React/DOM —— 本壳没有组件渲染栈，注册点以纯函数交出来）。
 * =====================================================================================
 *
 * ## 三段各归各位（AGENTS §3.5）
 *
 *   · 该不该拉、拉到什么活动 —— `@heyta/app-host` 的 `createShareOpsSignalHandler`；
 *   · 该不该重取成员面、一条变化吵几次 —— 同一个包的 `createShareRosterSignalHandler`；
 *   · 这里只做**投递与登记**：实时通道把 `(shareId, latestSeq)` / `shareId` 递进来，
 *     界面层把"谁显示哪份清单"登记进来。
 *
 * ## 🔴 成员面闸门 = 「本机清单行绑定 ∪ 界面上登记着的 target」
 *
 * 只用清单行绑定的那一格事故（§9.11 自锁同一形状，web 实测抓过）：
 * 刚点完「接受邀请」那台设备的清单行**还没写**（那是 `finalize` 成功之后的事），
 * owner 补发信封那条信号会被判成"本机不认得"丢掉，而它恰好是这条信号唯一等着的
 * 收件人 —— 人永远停在等待页。所以 `shareRosterTargetShareIds()` 必须并进闸门，
 * 这一格在 `tests/share-signals.spec.ts` 里单独钉着（移动端同款判据）。
 *
 * ## 为什么信号消费者只有一处
 *
 * 与 web 同一条纪律：拉取、判活动各只有一个触发点。评论区/面板不许自己接 WS ——
 * 下行游标是**每份 share 全局一份**，第二趟拉取只会拿到 `fetched = 0`，
 * 界面上永远停在打开那一刻；正确动作是订阅这里的"重画"。
 *
 * ⚠️ 两类信号都**不触发个人全量同步**：内容走 share 自己的下行（`pullShareOps`），
 * 成员面只重取登记着的面板。把它们接到 `syncNow()` 上会把一次共享评论推放大成
 * 整库同步（判据在 `tests/share-realtime-wiring.spec.ts`）。
 *
 * ## 为什么对 `share-session` 只用**动态 import**
 *
 * `share-session` 静态引 `db/open-host`（原生 op-sqlite）—— 本模块被
 * `sync/realtime.ts` 静态引，而实时通道的判据要在纯 node 进程里值导入跑
 * （`tests/open-host-generation.spec.ts` 用 vi.mock 才碰得到那条链）。
 * 默认依赖里推迟加载时机，行为不变（这两件事本来就只在真收信号时才发生）。
 */

import {
  createShareOpsSignalHandler,
  createShareRosterSignalHandler,
  shareIdsOnDevice,
  type AppHost,
  type ShareLogStorage,
  type SharePullResult,
  type ShareSignalActivity,
  type ShareWriteChannel,
} from '@heyta/app-host';

import { currentState } from './wiring';

/* ── 投递垫片：两条传输通道（形状照 web 的 share-signal-sink） ───────────── */

export type ShareOpsSink = (shareId: string, latestSeq: number) => void;
export type ShareRosterSink = (shareId: string) => void;

let opsSink: ShareOpsSink | undefined;
let rosterSink: ShareRosterSink | undefined;

/** 注册是覆盖式：一个产品只该有一处传输消费者。 */
export function setShareOpsSink(next: ShareOpsSink | undefined): void {
  opsSink = next;
}

export function setShareRosterSink(next: ShareRosterSink | undefined): void {
  rosterSink = next;
}

export function dispatchShareOpsSignal(shareId: string, latestSeq: number): void {
  opsSink?.(shareId, latestSeq);
}

export function dispatchShareRosterSignal(shareId: string): void {
  rosterSink?.(shareId);
}

/** 只给测试用：现在有没有人在收。 */
export function hasShareSinks(): { ops: boolean; roster: boolean } {
  return { ops: opsSink !== undefined, roster: rosterSink !== undefined };
}

/* ── 第二条通道：「本机已经有新内容了」——界面重放，不是再拉一次 ───────────── */

export type ShareRepaintListener = () => void;

const repaintListeners = new Set<ShareRepaintListener>();

export function subscribeShareRepaint(listener: ShareRepaintListener): () => void {
  repaintListeners.add(listener);
  return () => {
    repaintListeners.delete(listener);
  };
}

export function emitShareRepaint(): void {
  for (const listener of [...repaintListeners]) {
    // 一枚监听器抛错不许把别人带下去，更不许把拉取那条路带下去。
    try {
      listener();
    } catch {
      /* 重画失败下一次信号还会来。 */
    }
  }
}

export function shareRepaintListenerCount(): number {
  return repaintListeners.size;
}

/* ── 第三条通道：成员面按 shareId 登记「自己那份重取」 ────────────────────── */

export type ShareRosterTarget = () => Promise<void>;

const rosterTargets = new Map<string, Set<ShareRosterTarget>>();

/**
 * 谁显示哪份清单谁来登记（面板登记 `reload`、入群对话框登记 `finalize`）；
 * 返回注销函数（卸载 cleanup 直接可用）。
 */
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
 * 跑一遍这一份清单上所有登记着的重取：各目标并发、谁炸了都不许把别人带走，
 * 但只要有一枚失败就整体抛（抛出去才有读数 —— 静默成功让"面板其实没更新"
 * 和成功长得一模一样）。
 */
export async function runShareRosterTargets(shareId: string): Promise<void> {
  const set = rosterTargets.get(shareId);
  if (set === undefined || set.size === 0) return;
  const results = await Promise.allSettled([...set].map((target) => target()));
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error('share roster refresh failed');
  }
}

/**
 * 现在有哪几份清单被界面登记着。
 * 🔴 闸门必需的一格：见文件头"刚接受邀请那台设备"——登记中的 target 也算认得。
 */
export function shareRosterTargetShareIds(): string[] {
  return [...rosterTargets.keys()];
}

export function shareRosterTargetCount(shareId: string): number {
  return rosterTargets.get(shareId)?.size ?? 0;
}

/* ── 第四条通道：拉回来的活动交给界面（通知措辞/投递属界面那一趟，这里只转发） ── */

export type ShareActivityListener = (
  shareId: string,
  latestSeq: number,
  activities: readonly ShareSignalActivity[],
) => void;

const activityListeners = new Set<ShareActivityListener>();

export function subscribeShareActivity(listener: ShareActivityListener): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

/* ── 装配：把两条信号接到 app-host 的两个 handler ────────────────────────── */

/**
 * 实时通道建连时把宿主绑进来，这里**只取 `clientId`**：
 *
 * · `clientId` 是"自己不吵自己"与活动差集的依据 —— 没有它，内容信号宁可不处理
 *   （拿空串去滤等于"自己不吵自己"静默失效，与 web 的 `hasEngine()` 那一档同理由）；
 * · "本机认不认得这份 share"的闸门读 `currentState()`（合并视图），
 *   而那份状态的个人那条腿由 `db/open-host.ts` 绑好 —— 走到这里必然已经绑过，
 *   因为 `deps.openHost()` 就是那枚单例 `openTaskHost()`。
 *
 * 🔴 **这里不许再调 `bindMobileOplogBase`**（2026-10-24 真机炸过一次，别再写回去）：
 * 传进来的永远是 `openTaskHost()` 那份**包装后**的宿主，它的 `getState` 就是
 * `wiring.currentState`；把它当 base 交进去 ⇒ `currentState → base.getState → currentState`
 * 无限互递归。上一版这句注释写的是"传包装宿主即可，路由在包装之外，不会递归"——
 * **那句话是错的**：路由不在包装之外，包装件正是路由的读侧出口。
 * 症状：用户在设置页存完凭据（那一次会 `startRealtime()`），下一帧渲染整个 App
 * 死在 `RangeError: Maximum call stack size exceeded`。现在 `currentState()` 有闸门，
 * 同样的错法会具名报错；常驻判据在 `tests/share-routing-assembly.spec.ts`。
 */
let boundClientId = '';

export function bindShareSignalHost(host: AppHost | undefined): void {
  boundClientId = host?.clientId ?? '';
}

/** 这台设备认得的 shareId（清单行绑定，读合并视图）；路由还没绑 base ⇒ 空。 */
function boundShareIds(): string[] {
  try {
    return shareIdsOnDevice(currentState());
  } catch {
    // base 未绑（宿主没打开）：这一刻没有"本机认得"的读数，宁可不响也不空打。
    return [];
  }
}

/** 信号消费者认得出的那份会话的最小切面（默认由 `share-session` 交出，测试注替身）。 */
export interface ShareSignalSession {
  readonly channel: ShareWriteChannel;
  pullShareOps(shareId: string): Promise<SharePullResult>;
  signatureRejections(): readonly unknown[];
}

export interface ShareSignalDeps {
  /** 会话的晚绑定（这一刻建不出来 ⇒ 信号丢掉：游标没推进，下一次信号会补）。 */
  ensureSession: () => Promise<ShareSignalSession | undefined>;
  /** share 日志的落盘端口（"认得"的第二条途径与活动差集都读它）。 */
  ensureStorage: () => Promise<ShareLogStorage | undefined>;
}

/**
 * 默认依赖：动态取 `share-session`（见文件头那条 import 纪律）。
 * `armMobileShareSession` 没被调过（端口未装）⇒ `ensureMobileShareSession` 自己就停在
 * "什么都没有"上，这里不需要第二道判断。
 */
const defaultDeps: ShareSignalDeps = {
  ensureSession: async () => {
    const { ensureMobileShareSession } = await import('./share-session');
    return ensureMobileShareSession();
  },
  ensureStorage: async () => {
    const { mobileSharePorts } = await import('./share-session');
    return mobileSharePorts()?.shareLog;
  },
};

let installed = false;

/**
 * 装一次（幂等）：注册两条 sink。
 *
 * 🔴 为什么不等界面层来调：`sync/realtime.ts` 的默认回调走
 * `handleShareOpsSignal` / `handleShareRosterSignal`，而装配存在但没有调用点
 * 正是"第 10 项幻觉"的形态（纯逻辑全绿、信号永远没人接）。界面层要换掉默认
 * 消费者时用 `setShareOpsSink` / `setShareRosterSink` 覆盖即可。
 */
export function installMobileShareSignals(over: Partial<ShareSignalDeps> = {}): void {
  if (installed) return;
  installed = true;
  const deps: ShareSignalDeps = { ...defaultDeps, ...over };

  /*
   * 成员面：闸门 = 清单行绑定 ∪ 登记中的 target（文件头那格 🔴）。
   * refresh 只跑登记着的重取 —— 没有登记 ⇒ 一条请求都不发（形状决定，不是优化）。
   */
  const rosterHandler = createShareRosterSignalHandler({
    knownShareIds: () => [...boundShareIds(), ...shareRosterTargetShareIds()],
    refresh: runShareRosterTargets,
  });
  setShareRosterSink((shareId) => {
    void rosterHandler.onRosterSignal(shareId);
  });

  /*
   * 内容：每次现取那**一份**会话 —— 拉回来的东西要落进合并视图读的那份缓存，
   * 落进另一份等于"拉到了但没人看得见"（web 的先例逐字适用）。
   */
  setShareOpsSink((shareId, latestSeq) => {
    void (async () => {
      if (boundClientId === '') return;
      const session = await deps.ensureSession();
      const storage = await deps.ensureStorage();
      if (session === undefined || storage === undefined) return;
      const handler = createShareOpsSignalHandler({
        storage,
        knownShareIds: boundShareIds,
        pull: session.pullShareOps,
        myClientId: boundClientId,
      });
      const reading = await handler.onShareOpsSignal(shareId);
      /*
       * 🔴 验签拒了也要敲重画，且**不能等 added > 0**：被拒那条根本没落盘，
       * `added` 很可能就是 0 —— 只看"有没有新内容"的话，症状恰好是这条线要防的静默。
       */
      if (reading.pulled && (reading.added > 0 || session.signatureRejections().length > 0)) {
        emitShareRepaint();
      }
      if (reading.activities.length === 0) return;
      for (const listener of [...activityListeners]) {
        try {
          listener(shareId, latestSeq, reading.activities);
        } catch {
          /* 通知是尽力而为；投递失败不改变"内容已经拉回来了"。 */
        }
      }
    })();
  });
}

/** 只给测试：回到"没装过"的状态。 */
export function __resetMobileShareSignalsForTests(): void {
  installed = false;
  opsSink = undefined;
  rosterSink = undefined;
  rosterTargets.clear();
  repaintListeners.clear();
  activityListeners.clear();
  bindShareSignalHost(undefined);
}

/** 实时通道两条回调的默认落点：先保证消费者装好，再投递。 */
export function handleShareOpsSignal(shareId: string, latestSeq: number): void {
  installMobileShareSignals();
  dispatchShareOpsSignal(shareId, latestSeq);
}

export function handleShareRosterSignal(shareId: string): void {
  installMobileShareSignals();
  dispatchShareRosterSignal(shareId);
}
