/**
 * 共享域的**客户端出口**（ADR-0062 决策 4/5；计划 W2-T1）。
 * ================================================================
 *
 * 这一枚是计划里**被推迟过一次**的那一件（`docs/plans/collaboration-shared-lists.md`
 * §3-W2："app-host share-client ⏸ 登记推迟（撞车面：`packages/app-host/src/` 正被并行会话改写）"）。
 * 它存在的意义只有一个：让共享域的写路径**真的出得去**——在此之前
 * `packages/sync-core` 的三枚原语与 `packages/sync-client` 的两条传输
 * （`uploadOps` / `downloadOps`）**消费者为零**，于是 `createCommentActions`
 * 的注入端口 `dispatchShareOp` 永远没有实现（`check:reachability` 的 COMMENT 断言 C 如实红）。
 *
 * 三条纪律写在这里，免得下一位重新踩：
 *
 * 1. 🔴 **加密用的 identity 与上线的 op 必须是同一份**。
 *    `verify-collab-sync.mjs:228-232` 逐字记着这个坑："线上 op 的 timestamp 若与加密时不同
 *    （两次 `Date.now()`），解密方按线上值重建 AAD 必被 GCM 拒——第一版各取一次就是这样红的。"
 *    所以本文件只取**一次** `now()`，先建 identity、再拿它去加密、最后原样上线。
 *
 * 2. 🔴 **未登录时一个请求都不发**（计划 §3-W2 的判据点名"短路在 `share-client.ts`"）。
 *    这条判据钉在**网络边界**（注入 fetch 替身数请求数），不是"函数返回了 undefined"——
 *    admin-console 那次教训就是判据钉错了层。
 *
 * 3. 🔴 **本文件不认识清单、不认识 store、不做路由**。路由（"这条 op 该进个人 log 还是
 *    share log"）是 `comment-actions.ts` 的 `shareIdForTask` 的活（ADR-0062 决策 4 要求
 *    它住 `packages/app-host`）。这里只做"给我一条意图，我把它加密、签名、上行"。
 *
 * 签名（W3-T3）**预留但不在这里发明**：`@heyta/sync-core` 已有
 * `buildShareOpSignatureMessage({ opId, clientId, shareId, keyEpoch, ciphertext })`
 * 与 `signShareOperation(secretKey, message)`，接线时把签名放进 op 的 `signature` 字段即可；
 * 本片先不做，是因为线协议里那个字段的服务端校验形状还没读（**线协议词表只有一份定义**，
 * 自造一个字段形状比不做更坏）。
 */

/** 上行一条 share op 需要的最小端口（`ShareApiClient.uploadOps` 结构上就满足它）。 */
export interface ShareOpUploadPort {
  uploadOps(shareId: string, ops: readonly unknown[]): Promise<unknown>;
}

/**
 * 加密端口。⚠️ 它是**窄化**过的：真实实现是
 * `createSharePayloadCipher({ current, previous })` 的 `encrypt(payload, identity)`，
 * 而这里的 `identity` 就是**要上线的那个 op 身份**（见纪律 1）。
 */
export interface SharePayloadCipherPort {
  encrypt(payload: string, identity: ShareOpWireIdentity): Promise<string>;
}

/** 线 op 的身份部分（字段名与顺序照 `verify-collab-sync.mjs` 的 `mkIdentity`）。 */
export interface ShareOpWireIdentity {
  readonly id: string;
  readonly clientId: string;
  readonly actionType: string;
  readonly opType: string;
  readonly entityType: string;
  readonly entityId?: string | undefined;
  /**
   * 🔴 下行必须带上它：AAD 的数组里**有这一维**（`payload-cipher.ts` 的 `identityAAD`），
   * 少传就等于换了一份 AAD ⇒ GCM 必拒。上行这一族（评论）今天不填它，
   * 所以它一直是可选的 —— 但"可选"不等于"解密时可以忽略"。
   */
  readonly entityIds?: readonly string[] | undefined;
  readonly timestamp: number;
  readonly schemaVersion: number;
}

/** 交给 share 通道的一条意图（与 `comment-actions.ts` 的 `ShareOpIntent` 同形）。 */
export interface ShareOpDispatchIntent {
  readonly entityType: string;
  readonly entityId: string;
  readonly opType: string;
  readonly payload?: unknown;
}

/**
 * 每条动作的可读标签。
 *
 * ⚠️ 词表来源不是猜的：`scripts/verify-collab-sync.mjs:231` 里 TASK 的 `CRT` 用的是
 * `'add task'`，而全仓没有集中登记表（`grep "'add task'" packages/<包>/src` 回 0 处）
 * ⇒ 它是**每条动作自己起的名字**。评论族按同一惯例起名，并且**只**登记这三档
 * （个人偏好类实体不进 share log，见计划 §2.2）。
 */
const COMMENT_ACTION_TYPES: Readonly<Record<string, string>> = {
  CRT: 'add comment',
  UPD: 'edit comment',
  DEL: 'delete comment',
};

/** 未知 `opType` 时不要静默造名字：抛出去，让"新动作没登记标签"在写之前就红。 */
export function shareActionTypeFor(opType: string, table: Readonly<Record<string, string>> = COMMENT_ACTION_TYPES): string {
  const name = table[opType];
  if (name === undefined) throw new Error(`Unregistered share actionType for opType: ${opType}`);
  return name;
}

export interface ShareOpDispatcherOptions {
  readonly api: ShareOpUploadPort;
  readonly cipher: SharePayloadCipherPort;
  readonly clientId: string;
  readonly schemaVersion: number;
  /** 会话是否已登录；false ⇒ **零请求**（纪律 2）。 */
  readonly isSignedIn: () => boolean;
  /** 时钟与 id 可注入（测试要确定性）。 */
  readonly now?: (() => number) | undefined;
  readonly newId?: (() => string) | undefined;
  /** 动作标签表（默认评论族那三档）。 */
  readonly actionTypes?: Readonly<Record<string, string>> | undefined;
}

export interface ShareOpDispatchResult {
  /** 上行的 op id；`skipped` 为 true 时是空串（没有 op 被构造）。 */
  readonly opId: string;
  /** 未登录短路：没构造 op、没发请求。 */
  readonly skipped: boolean;
  /**
   * 真的上线了的那一条 op（`skipped` 时为 undefined）。
   *
   * 🔴 交回来是为了**不让第二份线 op 形状出现**：本地物化也要同一条 op 的身份字段
   * （id/clientId/actionType/opType/entityType/entityId/timestamp/schemaVersion），
   * 而这些字段一旦在别处重新拼一遍，就迟早和线上那份漂移。
   *
   * ⚠️ 这里的 `payload` 是**密文**。本地 share 日志要存**明文**
   * （物化不可能拿密文去过 reducer）—— 所以调用方用**同一条 op**、把 `payload`
   * 换成 `intent.payload` 再落本地（见 `share-comments.ts`）。
   */
  readonly op?: ShareOpWire | undefined;
}

/** 装配好的线 op（身份 + 密文 + 向量时钟）。 */
export interface ShareOpWire extends ShareOpWireIdentity {
  readonly payload: string;
  readonly vectorClock: Record<string, number>;
  readonly isPayloadEncrypted: boolean;
}

let fallbackSeq = 0;

/**
 * 造一个把意图送上共享通道的 dispatcher。
 *
 * ⚠️ 它**不是** `OpIntent` 那条路：个人 op-log 会永久拒 `COMMENT`（`op-log/src/state.ts`），
 * 所以这里出去的东西**只**走 `api.uploadOps`。
 */
export function createShareOpDispatcher(options: ShareOpDispatcherOptions): {
  dispatch: (shareId: string, intent: ShareOpDispatchIntent) => Promise<ShareOpDispatchResult>;
} {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? ((): string => `share-op-${String((fallbackSeq += 1))}-${String(now())}`);

  return {
    dispatch: async (shareId, intent) => {
      // ① 未登录：一个请求都不发，也不构造 op（连 id 都不消耗）。
      if (!options.isSignedIn()) return { opId: '', skipped: true };

      // ② 只取**一次**时间与 id，之后加密与上线共用这同一份 identity（纪律 1）。
      const identity: ShareOpWireIdentity = {
        id: newId(),
        clientId: options.clientId,
        actionType: shareActionTypeFor(intent.opType, options.actionTypes ?? COMMENT_ACTION_TYPES),
        opType: intent.opType,
        entityType: intent.entityType,
        entityId: intent.entityId,
        timestamp: now(),
        schemaVersion: options.schemaVersion,
      };
      const payload = await options.cipher.encrypt(JSON.stringify(intent.payload ?? {}), identity);

      // ③ 线 op = identity + 密文 + 向量时钟（形状照 `verify-collab-sync.mjs` 的 `mkOp`）。
      const op = {
        ...identity,
        payload,
        vectorClock: { [options.clientId]: 1 },
        isPayloadEncrypted: true,
      };
      await options.api.uploadOps(shareId, [op]);
      return { opId: identity.id, skipped: false, op };
    },
  };
}

/* ── 下行（M1）：把别人写进这份 share 的 op 拉回来 ────────────────────
 *
 * 🔴 为什么端口声明在这里而不是直接 import `@heyta/sync-client` 的类型：
 * 这条纪律是本文件一开始就立的（"只声明**真的用到**的字段"）—— 多声明一个字段
 * 就等于把"线协议里必须有它"写进共享层，而线协议词表的唯一来源是服务端的校验。
 * `ShareApiClient.downloadOps` 结构上满足下面这两个接口，所以装配点不需要适配器。
 */

/** 一条**已上线**的 share op（`payload` 是密文；`serverSeq` 是服务端盖的序）。 */
export interface ShareOpWireRow {
  readonly id: string;
  readonly clientId: string;
  readonly actionType: string;
  readonly opType: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly entityIds?: readonly string[];
  readonly schemaVersion: number;
  /**
   * 密文。声明成 `unknown` 而不是 `string` 是因为**传输层给的就是 `unknown`**
   * （`ShareApiClient.ShareOpWire`），而端口骗人说它是字符串，只会把检查推到更远的地方 ——
   * 拉取那一头必须自己验（不是字符串就抛错、不推进游标）。
   */
  readonly payload: unknown;
  readonly vectorClock?: unknown;
  readonly serverSeq: number;
  /**
   * 服务端盖在 op 上的**作者时刻**（`null` 是传输层允许的：见 `ShareOpWire`）。
   *
   * 🔴 重建 AAD 只能用这一个值，不能用 `Date.now()`，也不能用 `serverSeq` 换算 ——
   * 加密时用的就是作者那一刻的 timestamp，解密方按线上值重建 AAD，
   * 差一个字节就被 GCM 拒（纪律 1 的反方向；`verify-collab-sync.mjs:228-232` 记着第一次踩）。
   * 而 `null` **没法**参与 AAD（写侧从来不送空值）⇒ 拉取那一头遇到它就抛错、不推进游标。
   */
  readonly clientTimestamp: number | null;
}

/** 一页的返回：op 列表 + 服务端当前最新序（拉完没有拉完，看这两个）。 */
export interface ShareOpDownloadBatch {
  readonly ops: readonly ShareOpWireRow[];
  readonly cursor: { readonly latestServerSeq: number };
}

/** 下行需要的最小端口。 */
export interface ShareOpDownloadPort {
  downloadOps(shareId: string, after: number, limit?: number): Promise<ShareOpDownloadBatch>;
}

/** 解一条 share 载荷（与 `SharePayloadCipherPort.encrypt` 同一份实现的两半）。 */
export interface SharePayloadDecryptPort {
  decrypt(payload: string, identity: ShareOpWireIdentity): Promise<string>;
}

/** 装配点给的那种端口：同一枚 `createSharePayloadCipher` 的结果，能封也能解。 */
export type SharePayloadCodecPort = SharePayloadCipherPort & SharePayloadDecryptPort;

/** 一次拉取的读数（判据要点名它，不接受"函数跑完了"）。 */
export interface SharePullResult {
  /** 真的从线上收到的 op 条数（含重复 —— 重复由折叠吃掉）。 */
  readonly fetched: number;
  /** 折叠后**新增**的条数（`fetched - 重复`）。 */
  readonly added: number;
  /** 拉完之后落盘的游标（服务端 seq）。 */
  readonly cursor: number;
  /** 为收敛而翻的页数（>1 说明分页那条路真的被走过）。 */
  readonly pages: number;
}
