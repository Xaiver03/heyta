/**
 * 共享清单的**写通道与评论动作** —— 移动端侧装配（与 web 的
 * `features/share/comment-actions.ts` 同形状的另一份装配，不是第二份判断）。
 * =========================================================================
 *
 * 判断一个字都不在这里：「这条清单是不是共享的、发不发、发到哪、发完怎么落本地」
 * 全在 `@heyta/app-host`（`decideShareWrite` / `createShareCommentDispatch`）。
 * 本文件只回答"这台手机上这些东西住在哪"：
 *
 * | 端口 | 移动端的实现 |
 * |---|---|
 * | HTTP | `ShareApiClient` + 宿主从外面递进来的 `fetchImpl`（同意闸在调用点接 `consentFetch`，这里不 import 隐私层，保持 node 可值导入） |
 * | 本地密钥环 | app-host 的便携件（`unwrapShareKeyRingPortable` 等）落在 `ShareKeyStoragePort`（M6-1 的原生安全存储窄端口，**异步**）上 |
 * | share 日志 | 调用点交进来的 `ShareLogStorage` |
 *
 * ⚠️ 返回 `undefined` = 这一刻接不上（没配服务端 / 没登录 / vault 没解锁 / 端口没接），
 * 与 web 同一口径：不造一个假装能用的对象。
 */
import {
  base64ToBytesPortable,
  createCommentActions,
  createShareCommentDispatch,
  createShareKeyRotation,
  createShareTaskPuller,
  getShareKeyEntryPortable,
  readShareOwnIdentityPortable,
  unwrapShareKeyRingPortable,
  unwrapShareListKeyPortable,
  wrapAndStoreShareKeyPortable,
  type ActionContext,
  type CommentActions,
  type ShareConflict,
  type ShareKeyRingPort,
  type ShareKeyStoragePort,
  type ShareLogStorage,
  type SharePullResult,
  type ShareSignatureRejection,
  type ShareWriteChannel,
} from '@heyta/app-host';
import type { CommentLike } from '@heyta/domain';
import { createSharePayloadCipher, ShareApiClient, type SyncPayloadCipher } from '@heyta/sync-client';

import { emitLocalWrite } from '../sync/write-signal';
import { dispatchChecked, dispatchIntent, currentState } from './wiring';

/**
 * 本地密钥环端口（`ShareKeyRingPort` 的移动端实现：异步 `ShareKeyStoragePort` + vault 载荷密钥）。
 *
 * 🔴 从 `createMobileShareComments` 里抽出来成一份**具名导出**：评论通道与换钥装配
 * （`share-rotation.ts`，M6-3a）要的是**同一个环端口**。两处各写一遍"load/save/ownIdentity
 * 落到哪个键"就是两份落盘口径 —— 换钥写进去的东西评论通道读不出来，这种分家没有报错。
 */
export function mobileShareKeyRingPort(args: {
  readonly keyPort: ShareKeyStoragePort;
  readonly cipher: SyncPayloadCipher;
}): ShareKeyRingPort {
  return {
    load: async (shareId) => {
      const entry = await getShareKeyEntryPortable(args.keyPort, shareId);
      if (entry === undefined || entry.wrappedListKey === '') return undefined;
      const listKey = await unwrapShareListKeyPortable({ port: args.keyPort, cipher: args.cipher, shareId });
      return listKey === undefined ? undefined : { keyEpoch: entry.keyEpoch, listKey };
    },
    // 只交世代与钥：身份种子与 ownMemberId 由存储层沿用旧值（换钥不该把身份抹掉）。
    save: async (shareId, next) => {
      await wrapAndStoreShareKeyPortable({
        port: args.keyPort, cipher: args.cipher, shareId, keyEpoch: next.keyEpoch, listKey: next.listKey,
      });
    },
    ownIdentity: async (shareId) =>
      readShareOwnIdentityPortable({ port: args.keyPort, cipher: args.cipher, shareId }),
  };
}

export interface MobileShareCommentsDeps {
  /** 同步配置里的服务端根（空串 = 没配服务端 ⇒ 不建客户端）。 */
  readonly baseUrl: string;
  /** 当前登录令牌（空串 = 未登录）。 */
  readonly token: string;
  readonly userId: string;
  readonly clientId: string;
  readonly schemaVersion: number;
  /** vault 的载荷密钥（解 listKey 信封要用）；没解锁就传 undefined。 */
  readonly vaultCipher: SyncPayloadCipher | undefined;
  /** share 密钥环的落盘端口（M6-1 交付：原生安全存储之上的窄 KV，异步）。 */
  readonly keyPort: ShareKeyStoragePort;
  /** share 日志的落盘端口（与密钥环**分开**：日志是指令明文，密钥是包裹后的秘密）。 */
  readonly shareLog: ShareLogStorage;
  /** 出站闸门：调用点必须传 `consentFetch`，没有"默认 `globalThis.fetch`"这一档。 */
  readonly fetchImpl: typeof fetch;
}

export interface MobileShareComments {
  readonly actions: CommentActions;
  readonly channel: ShareWriteChannel;
  conflicts(): ShareConflict[];
  resolveConflict(conflict: ShareConflict, choice: 'keep-local' | 'keep-remote'): Promise<void>;
  commentsForTask(taskId: string): CommentLike[];
  pullForTask(taskId: string): Promise<SharePullResult | undefined>;
  signatureRejections(): ShareSignatureRejection[];
  pullShareOps(shareId: string): Promise<SharePullResult>;
}

export function createMobileShareComments(
  deps: MobileShareCommentsDeps,
): MobileShareComments | undefined {
  if (deps.baseUrl.trim() === '' || deps.token.trim() === '') return undefined;
  if (deps.vaultCipher === undefined) return undefined;

  const vaultCipher = deps.vaultCipher;
  const api = new ShareApiClient({
    baseUrl: deps.baseUrl,
    getToken: () => deps.token,
    authTransport: 'bearer',
    fetchImpl: deps.fetchImpl,
  });

  const rotation = createShareKeyRotation({
    api,
    isSignedIn: () => deps.token.trim() !== '',
    // 便携 base64（不碰 `atob`：那在 Hermes 上不是白名单里的全局）。
    decodeMemberPublicKey: base64ToBytesPortable,
    keys: mobileShareKeyRingPort({ keyPort: deps.keyPort, cipher: vaultCipher }),
  });

  const dispatch = createShareCommentDispatch({
    api,
    cipherFor: async (shareId) => {
      // 🔴 先问一句"这台设备还追得上服务端的世代吗"（M3）：收不到新信封不算错。
      try {
        await rotation.adoptRotatedShareKey(shareId);
      } catch {
        /* 未登录/没解锁：下面读环会给出 undefined */
      }
      // 🔴 交出去的是**整个密钥环**，不是当前那把（M3 同一条理由：只喂当前那把，
      // 旧评论解不开会把整块评论区卡死）。
      const ring = await unwrapShareKeyRingPortable({ port: deps.keyPort, cipher: vaultCipher, shareId });
      if (ring === undefined) return undefined;
      return createSharePayloadCipher(ring);
    },
    verifiersFor: async (shareId) => {
      try {
        const { members } = await api.listSigningKeys(shareId);
        const roster: Record<string, string> = {};
        for (const m of members) {
          if (typeof m.signingPublicKey === 'string' && m.signingPublicKey.length > 0) roster[m.memberId] = m.signingPublicKey;
        }
        return roster;
      } catch {
        return undefined;
      }
    },
    signerFor: async (shareId) => {
      const own = await readShareOwnIdentityPortable({ port: deps.keyPort, cipher: vaultCipher, shareId });
      if (own === undefined) return undefined;
      return { memberId: own.memberId, ed25519SecretKey: own.ed25519SecretKey };
    },
    storage: deps.shareLog,
    currentUserId: () => deps.userId,
    clientId: deps.clientId,
    schemaVersion: deps.schemaVersion,
    isSignedIn: () => deps.token.trim() !== '',
  });

  // 🔴 判据 C 数的那一处：端壳里真的构造评论动作（判断全在 app-host 里）。
  const ctx: ActionContext = {
    dispatch: (intent) => dispatchIntent(intent),
    dispatchChecked: (build) => dispatchChecked(build),
    getState: currentState,
  };

  const dispatchShareOp = async (shareId: string, intent: Parameters<typeof dispatch.dispatchShareOp>[1]): Promise<void> => {
    await dispatch.dispatchShareOp(shareId, intent);
    // 共享内容能在个人 op-log 一动没动的前提下变：敲一下让界面重读（web 同一条理由）。
    emitLocalWrite();
  };
  const pullShareOps = async (shareId: string): Promise<SharePullResult> => {
    const result = await dispatch.pullShareOps(shareId);
    // ⚠️ 只在真拿到新内容时敲：`added = 0` 时状态引用没变，敲一次是白重读一遍。
    if (result.added > 0) emitLocalWrite();
    return result;
  };

  const actions = createCommentActions(ctx, {
    dispatchShareOp,
    currentUserId: () => deps.userId,
  });

  return {
    actions,
    conflicts: dispatch.conflicts,
    resolveConflict: async (conflict, choice) => {
      await dispatch.resolveConflict(conflict, choice);
      emitLocalWrite();
    },
    channel: {
      dispatch: dispatchShareOp,
      stateFor: dispatch.stateFor,
      conflicts: dispatch.conflicts,
      resolveConflict: async (conflict, choice) => {
        await dispatch.resolveConflict(conflict, choice);
        emitLocalWrite();
      },
    },
    commentsForTask: dispatch.commentsForTask,
    signatureRejections: dispatch.signatureRejections,
    pullForTask: createShareTaskPuller({
      shareIdOfTask: actions.shareIdOfTask,
      pullShareOps,
    }),
    pullShareOps,
  };
}
