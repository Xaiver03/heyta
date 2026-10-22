/**
 * 共享域的**并发同字段裁决件**（ADR-0067 裁决三）。
 * ==============================================
 *
 * 这条线原来欠的那一格比"看不见对方改动"更糟：**我改的没了，而且没有任何提示**。
 * 共享之后 `CONCURRENT` 是高频事件（两个人各自勾完成、改标题），而 share 侧
 * 连"谁踩了谁"都不报。本文件把它变成一件**用户看得见、能选、选完就落地**的事。
 *
 * ## 为什么判定住在 `packages/op-log`，冲突件住在这里
 *
 * "两条 op 并发吗"只有一份答案（`compareVectorClocks`，`@heyta/sync-core`）。
 * 本文件**不写第二套并发判定、也不写第二套合并器**（ADR-0067 裁决二/三的原话）——
 * 它只把"哪一条**字段**被一条并发 op 踩掉了"这件事从日志里读出来。
 *
 * 🔴 为什么按**字段**而不是按整行：个人引擎那侧的 `overwritten` 问的是
 * "这一行的内容变了没有"，那个问题对**上报**够用，对**打扰用户**不够用 ——
 * 两个人各改一条任务的不同字段（一个改标题、一个改备注），reducer 会把两边
 * 都留下（`state.ts` 的 field-history 合并），**没有任何人的东西丢了**，
 * 这时弹一句"需要手动选择保留哪一边"是**谎报**。裁决三自己给的判据就是这一形：
 * 不同字段各改一次 ⇒ 两边都保留、无冲突提示。
 *
 * ## 冲突是**从日志推出来的**，不是存起来的
 *
 * 本文件不写任何"已解决"标记：一条冲突在**有一条后来者的时钟同时压过两边**时
 * 自己就消失了。用户点"保留这一版"= 把那一边重新发一条 op（一个意图 = 一个 op），
 * 那条 op 的因果时钟包含两边 ⇒ 两边都不再"并发" ⇒ 这条冲突自然不再出现。
 * 所以：不需要第二份本地状态，也不需要服务端帮忙记账（服务端仍只存不判）。
 * 别人后来居上（第三个人改了同一处）同样会让它消失 —— 那也是**如实**的：
 * 那一刻已经没有需要这位用户来定的事了。
 */

import { compareVectorClocks, VectorClockComparison, type VectorClock } from '@heyta/sync-core';

import type { DecryptedShareOp } from './share-replay.js';

/** 冲突的一侧：一条**真上过线的 op**交出来的那一份。 */
export interface ShareConflictSide {
  readonly opId: string;
  readonly clientId: string;
  readonly timestamp: number;
  readonly opType: string;
  readonly payload: unknown;
  readonly clock: VectorClock;
}

/** 一处需要用户决定的共享冲突（形状与 `@heyta/ui` 的 `ConflictLike` 兼容）。 */
export interface ShareConflict {
  /** 稳定 id：同一份清单里同一个实体**只可能有一枚**（裁决三那句"恰好一枚"靠它）。 */
  readonly id: string;
  readonly shareId: string;
  readonly entityType: string;
  readonly entityId: string;
  /** 人类可读诊断（只进日志，界面不许显示它 —— 与 `ConflictInfo.reason` 同一条纪律）。 */
  readonly reason: string;
  /** 机器可读编码：查表用（`CONFLICT_CONCURRENT` 是既有词条，不新建词表）。 */
  readonly errorCode: 'CONFLICT_CONCURRENT';
  /** 真的被踩掉的那些字段名（诊断用；界面只报数量，不列内部标识符）。 */
  readonly fields: readonly string[];
  readonly local: ShareConflictSide;
  readonly remote: ShareConflictSide;
}

/** 墓碑不是载荷里的字段，但它确实是 `DEL` 写进去的那一"格"。 */
const DELETED_FIELD = 'deletedAt';

/**
 * 这条 op 要在**哪些格子上**记账并比对。
 *
 * 只看 op 自己带的键（不猜 reducer 的内部回退），但**每条非删的写都顺带记一笔
 * `deletedAt`** —— 理由是"这条还在不在"确实被它改写了：
 * 一个人删、一个人改，是同一种"同格并发"，漏掉它就是把最常见的破坏形（内容没了）
 * 做成了无提示。两条都不涉及删除时那一格两边取到的值相同 ⇒ 不会因此多弹。
 */
function trackedFields(op: DecryptedShareOp): readonly string[] {
  if (op.opType === 'DEL') return [DELETED_FIELD];
  const payload = op.payload;
  const keys = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload as Record<string, unknown>).filter((key) => !key.startsWith('_'))
    : [];
  return [...keys, DELETED_FIELD];
}

function sideOf(op: DecryptedShareOp): ShareConflictSide {
  return {
    opId: op.id,
    clientId: op.clientId,
    timestamp: op.timestamp ?? 0,
    opType: op.opType,
    payload: op.payload,
    clock: (op.vectorClock ?? {}) as VectorClock,
  };
}

/**
 * 从一份 share 日志（**重放全序**那份）推出待裁决的冲突。
 *
 * 三条性质，逐条有判据（`tests/share-conflicts.spec.ts`）：
 * 1. **不同字段 ⇒ 空**：两边都保留，不许弹"保留哪一边"（那是谎报）。
 * 2. **同一字段 ⇒ 恰好一枚**，且两边的**内容都在**（`local.payload` / `remote.payload`），
 *    谁也没被静默丢掉 —— 这正是"必须可见"那半句。
 * 3. **有一条后来者压过两边 ⇒ 空**：包括用户点过一次"保留这一版"之后
 *    （那条 op 自己就是后来者），与"另一个人后来又把这里改了"。
 *
 * ⚠️ 顺序输入必须是 `foldShareOps` 出来的 `log.ops`（全序），不是到达顺序 ——
 *    与 `replayShareOps` 同一条纪律，否则两台设备会推出两份不同的清单。
 */
export function deriveShareConflicts(
  shareId: string,
  ops: readonly DecryptedShareOp[],
): ShareConflict[] {
  /** `entityType:entityId` → 每个字段当前那一版的来源。 */
  const provenance = new Map<string, Map<string, ShareConflictSide>>();
  /** 待裁决的字段级冲突（同一个字段只留**最新**那一对：后来者会压过前一对）。 */
  const pending = new Map<string, { entityId: string; entityType: string; items: Map<string, { local: ShareConflictSide; remote: ShareConflictSide }> }>();

  for (const op of ops) {
    if (op.entityId === undefined || op.entityId === null || op.entityId === '') continue;
    const key = `${op.entityType}:${op.entityId}`;
    const fields = provenance.get(key) ?? new Map<string, ShareConflictSide>();
    const side = sideOf(op);

    for (const field of trackedFields(op)) {
      const previous = fields.get(field);
      const relation = previous === undefined
        ? undefined
        : compareVectorClocks(side.clock, previous.clock);

      // 这条 op 没有改写这一格（reducer 的 `shouldAcceptWrite` 同样会拒它）⇒ 来源不动。
      if (relation === VectorClockComparison.LESS_THAN) continue;

      if (previous !== undefined && relation === VectorClockComparison.CONCURRENT &&
        !sameValue(previous, field, side)) {
        const bucket = pending.get(key) ?? { entityId: op.entityId, entityType: op.entityType, items: new Map() };
        bucket.items.set(field, { local: previous, remote: side });
        pending.set(key, bucket);
      } else if (previous !== undefined && relation === VectorClockComparison.GREATER_THAN) {
        // 后来者压过了这一格 ⇒ 这里已经没有什么要人定的了（含"用户点过保留这一版"那一形）。
        pending.get(key)?.items.delete(field);
      }
      // 🔴 `EQUAL` 那一形**故意不弹**：两条 op 时钟相等意味着这份日志里
      // 根本没有因果边（M2-b 之前的存量形状，每条都是 `{我:1}`）。
      // 把历史噪声当成"要你来挑"是另一种谎报，所以只更新来源、不记冲突。
      fields.set(field, side);
    }
    provenance.set(key, fields);
  }

  const out: ShareConflict[] = [];
  for (const [, bucket] of pending) {
    if (bucket.items.size === 0) continue;
    const entries = [...bucket.items.values()];
    // 一枚实体只出**一条**：`local` 取这组里最早那一条 op 的那一份，
    // `remote` 取最晚那一条 —— 用户看见的是"这两个版本要挑一个"，
    // 而不是同一处被拆成三行让他挑三次。
    const ordered = [...entries].sort((a, b) => a.local.timestamp - b.local.timestamp || (a.local.opId < b.local.opId ? -1 : 1));
    const local = ordered[0]!.local;
    const remote = [...entries].sort((a, b) => a.remote.timestamp - b.remote.timestamp || (a.remote.opId < b.remote.opId ? -1 : 1)).at(-1)!.remote;
    out.push({
      id: `share:${shareId}:${bucket.entityType}:${bucket.entityId}`,
      shareId,
      entityType: bucket.entityType,
      entityId: bucket.entityId,
      reason: `Concurrent share modification for ${bucket.entityType}:${bucket.entityId}`,
      errorCode: 'CONFLICT_CONCURRENT',
      fields: [...bucket.items.keys()],
      local,
      remote,
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 两侧对**同一个字段**给的值是否相同（相同就不是"丢东西"，只是重复写）。 */
function sameValue(local: ShareConflictSide, field: string, remote: ShareConflictSide): boolean {
  const pick = (payload: unknown): unknown =>
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)[field]
      : undefined;
  // 墓碑那一侧的载荷是空的，它写的"值"就是"这条没了"—— 两边都取不到字段 ⇒ 相等，
  // 但 `DEL` 与 `UPD` 的 `opType` 不同，靠下面那一支再判一次。
  if (local.opType === 'DEL' || remote.opType === 'DEL') return local.opType === remote.opType;
  return JSON.stringify(pick(local.payload)) === JSON.stringify(pick(remote.payload));
}

/**
 * 用户选完之后**要发的那一条**意图（一个意图 = 一个 op）。
 *
 * 🔴 为什么这里只产出意图而不直接发：发送是通道的活（谁加密、落哪本日志、
 * 时钟怎么长），本文件只管"这一处该发什么"。产出的就是**被选那一侧原来那条 op 的
 * 载荷与 `opType`** —— 重新拼一份"等于那一版"的载荷是第二条真相来源，
 * 而它一旦和线上那份漂移，用户点的"保留这一版"保的就不是他看见的那一版。
 */
export function shareConflictResolution(
  conflict: ShareConflict,
  choice: 'keep-local' | 'keep-remote',
): { entityType: string; entityId: string; opType: string; payload: unknown } {
  const side = choice === 'keep-local' ? conflict.local : conflict.remote;
  return {
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    opType: side.opType,
    payload: side.payload,
  };
}
