/**
 * 读侧逐 op 验签（ADR-0069 裁决五的对偶那半边）。
 *
 * 写侧与服务端上传边界已经各自有判据（`share-client.ts` / `server/src/shares/share.routes.ts`），
 * 这里管的是**最后那一步**：一条已经落进服务端共享日志的 op，拉到本机之后到底能不能折进我的视图。
 * 这一步不能省：服务端是唯一持有那批密文的人，它要能在我们的眼皮底下把一条换成另一条，
 * 唯一能发现的地方就是这里。
 *
 * 🔴 四条纪律，都是这一页的判据本体：
 *
 * 1. **验不过就不物化**。伪造件不许进 `ShareLogState`，也不许进合并视图 —— 界面宁可少一条，
 *    也不能把"别人塞进来的东西"画成"同事写的东西"。
 * 2. **停下来，但不静默**。游标只推进到**被拒那一条之前**，于是这一条每次拉取都会再撞上一次；
 *    结局同时交出去（`rejections`），由界面具名报警。抛错不算报警：`pullForTask` 那两处
 *    `.catch(() => undefined)` 会把名字吞掉（实测在 `ShareCommentsSection.tsx`）。
 * 3. **存量不等于伪造**。`signerMemberId` 本身为空 = 这条从来没进过签名协议
 *    （M4 之前的日志行；裁决六定的"不追签"）⇒ 读成"未验证但照旧可用"，不报警。
 *    反过来说，**有作者列却没有对应公钥**是要报的：那才是"我不知道这是谁写的"。
 *    ⚠️ 残余风险如实记在这儿：能改库的服务端可以把 `signature` 与 `signerMemberId` **一起抹掉**
 *    让一条篡改件落进"存量"这一档。这条腿今天防不住，判据与翻案条件写在 ADR-0069 的实施记录里。
 * 4. **名单拿不到 ⇒ 整条 pull 失败**，而不是"当作没签名继续折"。取不到成员名单就没有验证能力，
 *    而"没验证"与"验证通过"在界面上长得一样；宁可这一轮不同步。
 */
import { classifyShareOpSignature, type ShareOpSignatureOutcome, type ShareOpWireForSignature } from '@heyta/sync-core';

/** 一条已经下载下来的 op 里，验签要读的那几格（`ShareOpWireRow` structural 超集）。 */
export interface ShareOpVerifyRow {
  readonly id: string;
  readonly clientId: string;
  readonly actionType: string;
  readonly opType: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly entityIds?: readonly string[];
  readonly payload: unknown;
  readonly vectorClock?: unknown;
  readonly vectorClockEncoding?: string | null;
  readonly isPayloadEncrypted?: boolean | null;
  readonly schemaVersion: number;
  readonly serverSeq: number;
  readonly clientTimestamp: number | null;
  /** 库里那一格：谁写的（share 作用域的成员行 id）。 */
  readonly signerMemberId?: string | null;
  /** 线协议上那枚 base64 签名。 */
  readonly signature?: string | null;
}

/** 取某一**份** share 的「成员行 id → 签名公钥（base64）」；拿不到就回 `undefined`。 */
export type ShareSigningRosterPort = (shareId: string) => Promise<Record<string, string> | undefined>;

/** 取不到名单时抛这一枚：它是"这轮没法验"，不是"这条有问题"。 */
export class ShareSignatureRosterUnavailableError extends Error {
  readonly code = 'share-signing-roster-unavailable' as const;
  constructor(shareId: string) {
    super(`取不到共享清单（${shareId}）的签名成员名单，这一轮没有验签能力，改动没有落地`);
    this.name = 'ShareSignatureRosterUnavailableError';
  }
}

/** 一条被拒的 op（具名，界面直接画）。 */
export interface ShareSignatureRejection {
  readonly shareId: string;
  readonly opId: string;
  readonly serverSeq: number;
  readonly clientId: string;
  /** 只可能是这两档：缺席与存量都不算拒（见文件头纪律 3）。 */
  readonly outcome: Exclude<ShareOpSignatureOutcome, 'verified' | 'unsigned'>;
  readonly signerMemberId: string | null;
}

/**
 * 单条判定：`accept`（可以物化）或 `reject`（具名报警）。
 *
 * `roster === undefined` = 这份清单没有名单可读 ⇒ 抛错（纪律 4）。
 * 只有**需要验**的行才会走到这里，所以调用方可以只对带 `signerMemberId` 的行取名单。
 */
export const decideShareOpVerification = (args: {
  shareId: string;
  row: ShareOpVerifyRow;
  roster: Record<string, string> | undefined;
}): { readonly accepted: true } | { readonly accepted: false; readonly rejection: ShareSignatureRejection } => {
  const { shareId, row } = args;
  const signerMemberId = row.signerMemberId ?? null;
  // 存量：库里没有作者列 = 这条从没进过签名协议。照旧可用，且不要求有名单。
  if (signerMemberId === null) return { accepted: true };

  if (args.roster === undefined) throw new ShareSignatureRosterUnavailableError(shareId);

  const outcome = classifyShareOpSignature({
    signingPublicKey: args.roster[signerMemberId],
    shareId,
    signerMemberId,
    signature: row.signature ?? null,
    wire: {
      id: row.id,
      clientId: row.clientId,
      actionType: row.actionType,
      opType: row.opType,
      entityType: row.entityType,
      entityId: row.entityId ?? null,
      entityIds: row.entityIds ?? null,
      payload: row.payload,
      vectorClock: row.vectorClock ?? null,
      vectorClockEncoding: row.vectorClockEncoding ?? null,
      isPayloadEncrypted: row.isPayloadEncrypted ?? null,
      schemaVersion: row.schemaVersion,
      // 库里那一格就是写侧签进去的那一枚（服务端存的时候已经截断）。
      clientTimestamp: row.clientTimestamp ?? 0,
    } satisfies ShareOpWireForSignature,
  });
  if (outcome === 'verified' || outcome === 'unsigned') return { accepted: true };
  return {
    accepted: false,
    rejection: { shareId, opId: row.id, serverSeq: row.serverSeq, clientId: row.clientId, outcome, signerMemberId },
  };
};
