/**
 * 本机库归属（ADR-0084）
 * ======================
 *
 * 这个文件回答一个问题：**「这台设备上的 op-log 是谁的」**。
 * 它不销毁任何东西（销毁在 `local-erasure.ts` 的注册表里），也不认识界面 ——
 * 只给出「允许 / 拒绝 / 该问用户了」三种答案。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 为什么是「整库归属」而不是「每条 op 带 accountId」
 *
 * 后者（单库 + 分区键）要求**每一条读路径**都带 `WHERE accountId = ?`。
 * 漏一条不会报错，只会让另一个账号看见不该看见的数据 —— 而这正是本需求要断的
 * 那件事。整库归属只有一个判定点：**打开/写入之前问一句"这个库是不是你的"**，
 * 判定点少到一个手指数得过来，才有可能被测试钉住。
 *
 * 代价写在 ADR-0084 §四：登出即销毁，切回要等一次服务端回放。这是有意的。
 * ═════════════════════════════════════════════════════════════════════════
 */

import { META_KEYS, type DbDestroyReport, type OpLogStore } from '@heyta/storage';

import { eraseLocalData, hasLocalEraser } from './local-erasure.js';

/** 一个本地库的归属。`serverOrigin` 参与判定：同一个 accountId 在另一台服务器上是另一个账号。 */
export interface LibraryOwner {
  readonly accountId: string;
  readonly serverOrigin: string;
  /** 认领时刻（毫秒）。只用于诊断与界面说明，不参与判定。 */
  readonly boundAt: number;
}

/** 一次认证会话带来的身份（`accountId` 必填）。 */
export interface LibraryIdentity {
  readonly accountId: string;
  readonly serverOrigin: string;
}

/** `claimLibrary` 的三种结局 —— **封闭词表**，调用方按它分支，不要只看布尔。 */
export type ClaimLibraryResult =
  /** 这个库原来是匿名的，现在归你了。 */
  | 'bound'
  /** 本来就是你的。 */
  | 'same'
  /** 属于另一个账号：**拒绝**，且没有副作用。 */
  | 'mismatch';

/**
 * 归属不符：库属于别人。
 *
 * 带上**当前** owner，因为界面必须能说清"属于谁" —— 只说"不允许"，
 * 用户既不知道发生了什么，也不知道该点哪个出口。
 */
export class LocalLibraryOwnedByAnotherAccountError extends Error {
  readonly code = 'LOCAL_LIBRARY_OWNED_BY_ANOTHER_ACCOUNT';
  constructor(
    readonly owner: LibraryOwner,
    readonly attempted: LibraryIdentity,
  ) {
    super(
      `本机数据属于另一个账号（${owner.accountId} @ ${owner.serverOrigin}），` +
        `不能以 ${attempted.accountId} @ ${attempted.serverOrigin} 打开。`,
    );
    this.name = 'LocalLibraryOwnedByAnotherAccountError';
  }
}

/** 归属记录存在但读不懂。**fail closed**：不把它当成"匿名库"悄悄认领给别人。 */
export class LocalLibraryOwnerUnreadableError extends Error {
  readonly code = 'LOCAL_LIBRARY_OWNER_UNREADABLE';
  constructor(readonly raw: string) {
    super('本机库的归属记录损坏，无法判断它属于哪个账号。清除本机数据后才能继续。');
    this.name = 'LocalLibraryOwnerUnreadableError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parseOwner(raw: string | number): LibraryOwner {
  if (typeof raw !== 'string') throw new LocalLibraryOwnerUnreadableError(String(raw));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LocalLibraryOwnerUnreadableError(raw);
  }
  const record = parsed as Record<string, unknown> | null;
  if (record === null || typeof record !== 'object' ||
      !isNonEmptyString(record['accountId']) ||
      !isNonEmptyString(record['serverOrigin']) ||
      typeof record['boundAt'] !== 'number') {
    throw new LocalLibraryOwnerUnreadableError(raw);
  }
  return {
    accountId: record['accountId'],
    serverOrigin: record['serverOrigin'],
    boundAt: record['boundAt'],
  };
}

/** 读归属。`undefined` = 匿名库（还没有账号认领过）。 */
export async function readLibraryOwner(
  store: Pick<OpLogStore, 'getMetaValue'>,
): Promise<LibraryOwner | undefined> {
  const raw = await store.getMetaValue(META_KEYS.LOCAL_LIBRARY_OWNER);
  if (raw === undefined) return undefined;
  return parseOwner(raw);
}

function sameIdentity(owner: LibraryOwner, identity: LibraryIdentity): boolean {
  return owner.accountId === identity.accountId && owner.serverOrigin === identity.serverOrigin;
}

/**
 * 认领（或确认）本机库的归属。
 *
 * `bound` 只在**匿名库**上发生，且是幂等写入：同一个 identity 再来一次返回 `same`，
 * 不会刷新 `boundAt`（那个时间戳是"第一次归谁"的证据，不是心跳）。
 */
export async function claimLibraryOwner(
  store: Pick<OpLogStore, 'getMetaValue' | 'setMetaValue'>,
  identity: LibraryIdentity,
  now: number = Date.now(),
): Promise<ClaimLibraryResult> {
  const owner = await readLibraryOwner(store);
  if (owner === undefined) {
    const next: LibraryOwner = {
      accountId: identity.accountId,
      serverOrigin: identity.serverOrigin,
      boundAt: now,
    };
    await store.setMetaValue(META_KEYS.LOCAL_LIBRARY_OWNER, JSON.stringify(next));
    return 'bound';
  }
  return sameIdentity(owner, identity) ? 'same' : 'mismatch';
}

/**
 * 断言「这个库是我的」；不是就抛 {@link LocalLibraryOwnedByAnotherAccountError}。
 *
 * 返回当前 owner（可能刚刚 `bound`），调用方可以把它记进内存缓存，省掉下次读 META。
 */
export async function assertLibraryOwner(
  store: Pick<OpLogStore, 'getMetaValue' | 'setMetaValue'>,
  identity: LibraryIdentity,
  now: number = Date.now(),
): Promise<LibraryOwner> {
  const claim = await claimLibraryOwner(store, identity, now);
  const owner = await readLibraryOwner(store);
  if (owner === undefined) throw new LocalLibraryOwnerUnreadableError('missing-after-claim');
  if (claim === 'mismatch') throw new LocalLibraryOwnedByAnotherAccountError(owner, identity);
  return owner;
}

/* ========================================================================
 * 销毁：登出 = 这台设备上不再留这个账号的数据
 * ====================================================================== */

/**
 * 销毁前的**事实清单**。
 *
 * 🔴 `requiresConfirmation` 不是提示，是硬前置：`pendingUpload > 0` 意味着
 * 本机有改动**只存在于这台机器上**，销毁 = 永久丢失（ADR-0084 §三.3）。
 */
export type LibraryPurgePlan =
  | { readonly status: 'nothing-to-erase' }
  | {
      readonly status: 'ready';
      /** 还没上传的 op 条数（`pending` 队列；服务端永久拒绝的 `rejected` 不在内）。 */
      readonly pendingUpload: number;
      readonly totalOps: number;
      readonly requiresConfirmation: boolean;
    };

export async function planLibraryPurge(
  store: Pick<OpLogStore, 'countAllOps' | 'countPendingUpload'>,
): Promise<LibraryPurgePlan> {
  const totalOps = await store.countAllOps();
  if (totalOps === 0) return { status: 'nothing-to-erase' };
  const pendingUpload = await store.countPendingUpload();
  return { status: 'ready', pendingUpload, totalOps, requiresConfirmation: pendingUpload > 0 };
}

/** `purgeLocalLibrary` 的结局。**不许**把 `incomplete` 说成"已清除"。 */
export type LibraryPurgeResult =
  | { readonly status: 'purged'; readonly reports: readonly DbDestroyReport[] }
  | { readonly status: 'nothing-to-erase' }
  /** 宿主没注册销毁器：**做不了就是做不了**，不当成功。 */
  | { readonly status: 'no-eraser' }
  | { readonly status: 'incomplete'; readonly reports: readonly DbDestroyReport[] };

/**
 * 销毁本机库（走宿主注册的那个销毁器，与"注销账号"同一条路径）。
 *
 * 注意它**不判断**有没有未上传的改动：确认由调用方（`planLibraryPurge` + 界面）做。
 * 这一层只负责"说要清就真的清，并且如实回报每一类清没清掉"。
 */
export async function purgeLocalLibrary(): Promise<LibraryPurgeResult> {
  if (!hasLocalEraser()) return { status: 'no-eraser' };
  const reports = await eraseLocalData();
  return reports.every((report) => report.containerRemoved)
    ? { status: 'purged', reports }
    : { status: 'incomplete', reports };
}
