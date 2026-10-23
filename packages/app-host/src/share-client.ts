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
 * 4. 🔴 **因果时钟的基准由调用方给**（`baseClock`），本文件不自己存一份。
 *    见下面 `dispatch` 里那段注释。
 *
 * 5. 🔴 **每条上行的 op 必须带签名，且必须拿到服务端的收件回执才算写成功**（ADR-0069 裁决四/六）。
 *    两半都是这条腿的"永久拒绝"落点，缺一半就退化成 M4 之前那一格：
 *    - 拿不到本机签名件（未解锁 / 没有自己的成员行）⇒ **零请求**并具名抛错。
 *      发一条无签 op 没有意义：服务端本来就按无签拒（裁决六），发出去只是多一次"看起来写成功了"。
 *    - 回执里这条 op 没出现在 `accepted` ⇒ 具名抛错，**调用方因此不落本地日志**。
 *      个人那条腿有 `PERMANENT_REJECTION_CODES` + 待上传队列（`sync-client/src/client.ts`）；
 *      共享这条腿**没有队列**（一条意图一次上行），所以它的"移出队列"只能是"别落进日志"。
 *      ⚠️ 这里不列码表：判据是"服务端有没有把它收进日志"，而不是"服务端说的是哪一码"——
 *      多一份码表就多一份会与词表漂移的抄件（#535 那一族），而 `code` 只作为**读数**带在错误里。
 */

import { signShareOpWire, type VectorClock } from '@heyta/sync-core';

import type { ShareSignatureRejection } from './share-verify.js';

/**
 * 上行一条 share op 需要的最小端口（`ShareApiClient.uploadOps` 结构上就满足它）。
 *
 * 🔴 回执必须声明进来：这一枚端口的**返回值**是"服务端到底收没收这条"的唯一读数。
 * 以前它被丢掉，于是共享那条腿没有任何一格知道自己被拒了 —— 症状是"本地改成功了、
 * 对面的成员永远看不见"，而界面上没有任何东西说这件事。
 */
export interface ShareOpUploadPort {
  uploadOps(shareId: string, ops: readonly unknown[]): Promise<ShareOpUploadReceipt>;
}

/** 服务端逐 op 的收件回执（只声明本文件真的读的字段）。 */
export interface ShareOpUploadReceipt {
  readonly accepted?: readonly { id: string }[];
  readonly rejected?: readonly { id: string; code: string }[];
}

/**
 * 本机签名件：这份 share 里"我是哪个成员"+"我的 Ed25519 私钥"。
 *
 * 🔴 两枚都必要，缺一不可签：私钥签出的东西要由**在册的那把公钥**验，
 * 而在册公钥挂在成员行上 ⇒ 签名消息里必须写同一个成员行 id（ADR-0069 裁决三）。
 * 私钥不出本机：它从保险库里的身份种子派生，只用于签，不上线、不备份成第二份。
 */
export interface ShareOpSigner {
  readonly memberId: string;
  readonly ed25519SecretKey: Uint8Array;
}

/** 本机签不出条 op（未解锁 / 没有自己的成员行）⇒ 零请求、具名失败。 */
export class ShareOpUnsignableError extends Error {
  readonly code = 'share-op-unsignable' as const;
  constructor(shareId: string) {
    super(`这份共享清单（${shareId}）本机没有可用的签名身份，改动没有上行`);
    this.name = 'ShareOpUnsignableError';
  }
}

/**
 * 服务端明确没把这条 op 收进共享日志 ⇒ 具名失败，调用方因此**不落本地日志**。
 *
 * ⚠️ `code` 是服务端给的那一枚（`SHARE_OP_SIGNATURE_INVALID` / `SHARE_ROLE_FORBIDDEN` /
 * 线协议词表里的任何一枚），本文件不解释它、不据它分支 —— 它只是**读数**，
 * 决定"这条没写进去"的判据是"它不在 accepted 里"。
 */
export class ShareOpNotAcceptedError extends Error {
  readonly code: string;
  constructor(
    readonly opId: string,
    code: string | undefined,
    /** 服务端没给这一条的收件结果时，这里是一句人话；给了码就以码为准。 */
    readonly reason: string,
  ) {
    super(`共享改动未被服务端接受（${code ?? reason}）：${opId}`);
    this.name = 'ShareOpNotAcceptedError';
    this.code = code ?? 'NO_ACK';
  }
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
 * 🔴 **键是 `entityType:opType`，不是 `opType`。**
 * 这张表原先只按 `opType` 键（评论族那三档），因为那时 share 通道只有评论一族在走。
 * M2 把任务/便签/标签也路由进来之后，`CRT` 同时属于"add comment"与"add task"
 * —— 一个键对两个标签，只能靠"每次调用换一张表"来绕，而那份"现在在用哪张表"的状态
 * 迟早和实际写出去的 op 漂移。语义键在 ADR-0067 裁决六里已经定死是 `(entityType, opType)`，
 * 这张表的键就得跟它一致。
 *
 * 🔴 **没有 `PROJECT:*`**：清单这条记录本身不是共享内容（ADR-0068 裁决一 ——
 * share 域里没有"清单"这个实体，成员各自持有 id 不同的一行）。
 * 这张表里留着一行没人走的键，等于把"清单可以共享写"这个口径继续摆在协议边上。
 *
 * ⚠️ 评论那三个**字符串值逐字不许改**：`actionType` 是线 op 身份的一部分（进 AAD），
 * 改名等于给已经躺在服务端日志里的那批 op 换了一份身份 ⇒ 下行解密必拒（GCM tag 不匹配），
 * 症状是评论区整块解不开，不是"标签旧了一点"。
 * 删掉 `PROJECT:*` 之所以安全，是因为**从来没有一条 PROJECT 族 share op 上过线**
 * （M2 写侧本批才接线，历史上进过 share log 的只有 COMMENT 族）。
 *
 * 未登记的一律**抛错**（`shareActionTypeFor`）：让"新动作没登记标签"在写之前就红，
 * 而不是悄悄造一个名字上线。
 */
const SHARE_ACTION_TYPES: Readonly<Record<string, string>> = {
  'COMMENT:CRT': 'add comment',
  'COMMENT:UPD': 'edit comment',
  'COMMENT:DEL': 'delete comment',
  'TASK:CRT': 'add task',
  'TASK:UPD': 'edit task',
  'TASK:DEL': 'delete task',
  'TASK:MOV': 'move task',
  'TASK:BATCH': 'batch update task',
  'NOTE:CRT': 'add note',
  'NOTE:UPD': 'edit note',
  'NOTE:DEL': 'delete note',
  'TAG:CRT': 'add tag',
  'TAG:UPD': 'edit tag',
  'TAG:DEL': 'delete tag',
};

/** 未知 `(entityType, opType)` 时不要静默造名字：抛出去，让"新动作没登记标签"在写之前就红。 */
export function shareActionTypeFor(
  entityType: string,
  opType: string,
  table: Readonly<Record<string, string>> = SHARE_ACTION_TYPES,
): string {
  const key = `${entityType}:${opType}`;
  const name = table[key];
  if (name === undefined) throw new Error(`Unregistered share actionType for ${key}`);
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
  /**
   * 🔴 **这条 share 当前的因果时钟**（ADR-0067 裁决二）。
   *
   * 必须**按 shareId 现读**，不许在建 dispatcher 时抓一份死值：同一个 dispatcher 会被
   * 用来写多份清单，而每份清单的时钟各自长。
   *
   * 为什么是调用方给而不是这里存：本文件的纪律 3 —— 它不认识日志、不认识存储。
   * 时钟的真相只有一份，就是 `ShareLogState.clock`（`foldShareOps` 折出来的那份，
   * 里面已经含本地上行过的每一条 + 下行拉回来的远端每一条）。
   */
  readonly baseClock: (shareId: string) => VectorClock;
  /**
   * 🔴 按 shareId 取本机签名件；拿不到就返回 `undefined`（未解锁、没有自己的成员行）。
   *
   * 为什么异步、为什么按 shareId：签名件住在保险库里（解包是异步的），而**每台设备在每份
   * share 里的成员行各不相同** —— 一个 dispatcher 会服务多份清单，它的成员行 id 不能是
   * 建 dispatcher 时抓的那一份死值（与 `baseClock` 同一条理由）。
   *
   * 为什么必需而不是可选：服务端按 ADR-0069 裁决六拒绝无签上传，所以"没签名"这一档
   * 在本条腿上没有任何出路 —— 可选就等于允许发一条注定被拒的 op，还顺手把"写成功了"
   * 画给用户看。
   */
  readonly signerFor: (shareId: string) => Promise<ShareOpSigner | undefined>;
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

/** 装配好的线 op（身份 + 密文 + 向量时钟 + 逐 op 签名）。 */
export interface ShareOpWire extends ShareOpWireIdentity {
  readonly payload: string;
  readonly vectorClock: Record<string, number>;
  readonly isPayloadEncrypted: boolean;
  /**
   * Ed25519 签名的 base64（签名域 = 线协议里除 `serverSeq`/`receivedAt` 外的全部字段）。
   *
   * 🔴 它是**必填**的：这条腿上不再存在"合法的无签 op"。把它声明成可选就等于把
   * "服务端会拒无签"这件事只写在 ADR 里 —— 类型上谁都能漏一个，而漏掉的那一条
   * 在服务端是一枚具名拒绝，在本机却已经画成"改好了"。
   */
  readonly signature: string;
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

      /*
       * ② 签名件（ADR-0069 裁决一/二）：**在消耗 id 之前**问一次。
       *
       * 拿不到就具名抛错、零请求 —— 这一档不是"暂时没配好可以先发着"：服务端按裁决六
       * 拒绝无签上传，一条无签 op 的唯一结局是被拒，而本机会把它折进日志画成"改好了"。
       * 抛在加密之前还有个具体好处：不消耗 op id、不解清单钥、不读因果时钟，
       * 于是"一条根本没发出去的 op"不会在日志里占下一个序号（与①同一条纪律）。
       */
      const signer = await options.signerFor(shareId);
      if (signer === undefined) throw new ShareOpUnsignableError(shareId);

      /*
       * ③ 只取**一次**时间与 id，之后加密、签名与上线共用这同一份 identity（纪律 1）。
       *
       * ⚠️ `Math.trunc`：服务端把这一枚存成 `client_timestamp`（BigInt）时做的正是截断
       * （`share.routes.ts` 里那次 `BigInt(Math.trunc(op.timestamp))`）。签的域必须等于
       * **会被存下来、以后又被下载回来**的那一份，否则读侧重建出来的消息与写侧签的那一份
       * 差在小数上 ⇒ 每台非签名者的设备把这枚合法签名读成失败。截断放在**加密之前**，
       * 这样 AAD 里那一份、签名域里那一份、线上那一份是同一个数（纪律 1 的同一条轴）。
       */
      const identity: ShareOpWireIdentity = {
        id: newId(),
        clientId: options.clientId,
        actionType: shareActionTypeFor(intent.entityType, intent.opType, options.actionTypes ?? SHARE_ACTION_TYPES),
        opType: intent.opType,
        entityType: intent.entityType,
        entityId: intent.entityId,
        timestamp: Math.trunc(now()),
        schemaVersion: options.schemaVersion,
      };
      const payload = await options.cipher.encrypt(JSON.stringify(intent.payload ?? {}), identity);

      /*
       * ④ 线 op = identity + 密文 + 向量时钟 + 签名（形状照 `verify-collab-sync.mjs` 的 `mkOp`）。
       *
       * 🔴 **时钟是"本地那一维 +1"，不是写死的 `{我:1}`**（ADR-0067 裁决二）。
       * 基准在**构造 op 之前**读（不是上传之后）：一条 op 的 `vectorClock` 是它的**因果前集**，
       * 把"我自己这条"算进自己的前集是定义错误。落盘那一步（`foldShareOps`）才把这条推进日志的钟，
       * 于是本地上行的每一条也会自增本地维 —— 服务端不必 ack 这条 op 才算"我写过"，
       * 因为 share 日志的唯一所有者就是这台设备。
       *
       * ⚠️ 这条链一旦退化（写回 `{我:1}`），`compareVectorClocks` 对**同一设备的两条 op**
       * 也只能判 `EQUAL`/`CONCURRENT` ⇒ 顺序只能靠 timestamp 平局来猜，
       * 而"两个人各自的第 2 条改动"会被判成并发。判据在
       * `tests/share-causal-clock.spec.ts`（"因果边真存在"那一枚会红）。
       *
       * 🔴 签名域里那枚 `signerMemberId` 是**本机以为的自己**（`share-key-store` 里那行成员 id），
       * 服务端验的却是**认证上传者**那一行（`lookup.member.id`）。两者不一致 ⇒ 验不过，
       * 于是"替别人签一条"在这条协议上结构性地做不到（ADR-0069 裁决四"不许代签"的落点）。
       */
      const base = options.baseClock(shareId);
      const unsigned = {
        ...identity,
        payload,
        vectorClock: { ...base, [options.clientId]: (base[options.clientId] ?? 0) + 1 },
        isPayloadEncrypted: true,
      };
      const op: ShareOpWire = {
        ...unsigned,
        signature: signShareOpWire(signer.ed25519SecretKey, {
          shareId,
          signerMemberId: signer.memberId,
          wire: { ...unsigned, clientTimestamp: identity.timestamp },
        }),
      };

      /*
       * ⑤ 回执：这条 op **被服务端收进共享日志**才算写成功。
       *
       * 判据是"它在不在 `accepted` 里"，不是"服务端报了哪一枚码"—— 多一份码表就多一份
       * 会与线协议词表漂移的抄件（环境陷阱 #535 那一族：个人那条腿的 `PERMANENT_REJECTION_CODES`
       * 绿不代表共享这条腿也有同一套处置）。`code` 只作为读数带在错误里，给界面与诊断用。
       */
      const receipt = await options.api.uploadOps(shareId, [op]);
      const acceptedIds = new Set((receipt?.accepted ?? []).map((row) => row.id));
      if (!acceptedIds.has(identity.id)) {
        const row = (receipt?.rejected ?? []).find((item) => item.id === identity.id);
        throw new ShareOpNotAcceptedError(identity.id, row?.code, '服务端没给出这条的收件结果');
      }
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
  /**
   * 时钟编码（`full` 缺省 / `frontier-delta`）。在签名域里，所以读侧要拿得到才能重建那份字节。
   */
  readonly vectorClockEncoding?: string | null;
  readonly isPayloadEncrypted?: boolean | null;
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
  /**
   * 库里那一格：这条是谁写的（share 作用域的成员行 id）。
   *
   * 🔴 `null` 与"没有这一格"都只有一种意思：**这条从来没进过签名协议**（M4 之前的存量行）。
   * 读侧据此把它归入"未验证但照旧可用"，而不是"伪造"（`share-verify.ts` 纪律 3）。
   */
  readonly signerMemberId?: string | null;
  /** 线协议上那枚 base64 签名。缺 ⇒ 读成"未签名"，不是"已验证"。 */
  readonly signature?: string | null;
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
  /**
   * 这一轮**验签被拒**的那几条（ADR-0069 裁决五：读侧要能分出"通过/未签名/失败/查无此人"）。
   *
   * 🔴 它必须随结果交出去而不是抛：拉取的两个调用点都 `.catch(() => undefined)`
   * （`ShareCommentsSection.tsx` 与信号垫片），抛进去的名字会被吞掉 ——
   * 症状正是这一整条线一直在防的"静默"。没有拒的时候是空数组（可选 + 运行时默认，§3.3）。
   */
  readonly rejections?: readonly ShareSignatureRejection[];
}
