/**
 * 共享清单的**换钥（rekey）编排**（计划 §9.3 M3）。
 * =================================================
 *
 * 产品承诺只有一句话：**把人移出共享之后，他解不开你们以后写的内容，而在册的每个人
 * 仍然打得开这份清单。**服务端做不了这件事（E2EE 下它看不到明文，也没有清单密钥），
 * 所以执行者只能是**握着那把钥的客户端**——也就是 owner 这一台设备。
 *
 * 🔴 五条纪律，每条都对应一种已经量过的坏法：
 *
 * 1. **信封上写的世代 = 所封那把钥的世代**，不是服务端那个号。
 *    §9.1 记着今天 `autoSeal` 的坏法（复封用同一把 listKey，却按 `detail.keyEpoch` 贴标）。
 *    换钥之后它会升级成"标签正确、内容错"：owner 本地已经是 epoch2 的钥，按服务端的号
 *    去封 = 把 epoch2 的钥贴成 epoch1 发给所有人 ⇒ 全员解不开新内容，而界面显示"密钥已下发"。
 * 2. **非 owner 不许换钥**。成员行的 role 是服务端判的，但"要不要铸造新一把钥"这件事
 *    如果由任何拿到钥的客户端决定，一个 commenter 就能反复换钥把整份清单锁死。
 * 3. **顺序是：移除 → 新钥落本地环 → 先发自己那枚 → 再发其余在册成员**。
 *    移除必须在前：反过来的话，新钥会先发给一个"即将被移出的人"，等于当场把要收回的钥匙
 *    又送一遍。本地环必须在发信前落好：`putMemberEnvelope` 一枚都没成功时，服务端世代没动、
 *    而这把钥至少还在 owner 自己盘上；先远后近则存在"新钥只活在内存里就崩了"的窗口。
 *    自己的信封排在最前：它是 owner **换设备后**唯一能找回这把钥的通道。
 * 4. **旧世代必须留在密钥环里**（`keys.save` 的端口说明里也写着）。
 *    这条线的日志是**追加模型**：旧世代的密文不会因为换钥而消失（`verify-collab-revoke`
 *    第 6 步就是去库里验"旧密文仍在"）。环里只留新钥 ⇒ 拉取一碰到旧世代的载荷就抛
 *    `Share key epoch unavailable`，而按 M1 的纪律那会**不推进游标** ⇒ 评论区从此卡死。
 * 5. 未登录 / vault 没解锁 / 本机没有这份钥 ⇒ **零请求**（与 `share-client.ts` 纪律 2 同源）。
 *
 * ## 这一片刻意不做的两件
 *
 * - **不重写历史**（把旧 op 逐条迁到新世代）。它要在追加模型上定义"迁移副本"该怎么回放
 *   （新 id、哪个 opType、回放时会不会与源行叠成两条），那是 op-log 语义 + 线协议的事，
 *   按计划 §9.6 与 M2/M4 合进**同一份 ADR**。安全承诺本身不依赖它：被移除的人在传输面
 *   已经 404（取不到新内容），在密码学面已经解不开新世代的载荷。
 * - **不发明"成员主动申请换钥"的协议**。触发点是 owner 按下"移除"这一下（一个用户意图）。
 *   owner 在别的设备上移除、或移除时这台设备根本不在线 ⇒ 这份清单会继续用旧钥写下去，
 *   直到下一次 owner 在本机执行移除/换钥。这一格的形状与代价登记在计划 §9.9。
 */

import {
  openListKeyEnvelope,
  planShareRekey,
  type ShareMemberKeyEnvelope,
} from '@heyta/sync-core';

import { ShareKeyUnavailableError, ShareNotSignedInError } from './share-comments.js';

/** 本机那份清单密钥（含它自己的世代——纪律 1 里"标签"的唯一来源）。 */
export interface ShareLocalKey {
  readonly keyEpoch: number;
  readonly listKey: Uint8Array;
}

/** 本机在这份共享里那枚成员行的身份（自封信封与收新信封都要它）。 */
export interface ShareLocalIdentity {
  readonly memberId: string;
  readonly x25519PublicKey: Uint8Array;
  readonly x25519SecretKey: Uint8Array;
}

/**
 * 本地密钥环端口（宿主实现：web 是 vault 包裹的 localStorage，测试是内存）。
 *
 * 🔴 `save` 不是"覆盖"：换世代时**旧世代那把必须留在环里**（纪律 4）。
 * 端口只交出一把当前钥，所以"保留旧的"这件事由实现负责，也因此它必须被宿主侧的测试钉住
 * （`apps/web/tests/share-key-ring-epochs.spec.ts`）。
 */
export interface ShareKeyRingPort {
  load(shareId: string): Promise<ShareLocalKey | undefined>;
  save(shareId: string, next: ShareLocalKey): Promise<void>;
  /** 本机解不出自己的身份（没入库 / vault 没解锁）⇒ undefined ⇒ 零请求。 */
  ownIdentity(shareId: string): Promise<ShareLocalIdentity | undefined>;
}

/** 成员行里这件事要用的字段（比 `ShareApiClient.ShareMemberRow` 窄）。 */
export interface ShareRosterMemberRow {
  readonly memberId: string;
  /** 线上可能整格不下发（owner 那一行就是），所以"没有"与"为 null"都要能吃下。 */
  readonly identityPublicKey?: string | null;
  readonly keyEnvelope?: unknown;
  readonly memberKeyEpoch?: number;
}

/** 换钥用到的 HTTP 面（`ShareApiClient` 结构上就满足）。 */
export interface ShareRekeyApi {
  shareDetail(shareId: string): Promise<{ keyEpoch: number; yourRole: string }>;
  listMembers(shareId: string): Promise<{ members: readonly ShareRosterMemberRow[] }>;
  putMemberEnvelope(
    shareId: string,
    memberId: string,
    input: { keyEpoch: number; keyEnvelope: object },
  ): Promise<unknown>;
  /** 只有 `removeMemberAndRekey` 需要它；只换钥的装配可以不注入。 */
  removeMember?(shareId: string, memberId: string): Promise<unknown>;
}

export interface ShareKeyRotationOptions {
  api: ShareRekeyApi;
  keys: ShareKeyRingPort;
  /** 成员行里那枚 base64 公钥 → 字节（各端 base64 端口不同形状，交给宿主）。 */
  decodeMemberPublicKey: (value: string) => Uint8Array;
  isSignedIn: () => boolean;
}

/** 不是 owner：不许铸造新钥（纪律 2）。 */
export class ShareNotOwnerError extends Error {
  readonly code = 'share-not-owner' as const;
  constructor() {
    super('只有清单所有者能换共享密钥');
    this.name = 'ShareNotOwnerError';
  }
}

/** 本机那把钥与服务端的世代对不上，且收不回（信封还没到 / 解不开）。 */
export class ShareKeyOutOfSyncError extends Error {
  readonly code = 'share-key-out-of-sync' as const;
  constructor(detail: { localEpoch: number; serverEpoch: number }) {
    super(
      `本机密钥世代 ${String(detail.localEpoch)} 与服务端 ${String(detail.serverEpoch)} 对不上，` +
        '且还没收到对应信封——等所有者下发或重新解锁后再换钥',
    );
    this.name = 'ShareKeyOutOfSyncError';
  }
}

/** 一次换钥的读数（判据点名它，不接受"函数跑完了"）。 */
export interface ShareRekeyReading {
  readonly fromEpoch: number;
  readonly toEpoch: number;
  /** 成功收到新信封的成员行（**含 owner 自己那一行**）。 */
  readonly sealedMemberIds: readonly string[];
  /** 这一轮 PUT 失败的成员行；下一轮补封会再试（面板的 3s 轮询）。 */
  readonly failedMemberIds: readonly string[];
  /** 在册但行里没有公钥 ⇒ 这一轮封不了（正常入群不该出现；出现就如实报，不静默跳过）。 */
  readonly skippedMemberIds: readonly string[];
}

/** 一次"收新钥"的读数。`adopted:false` 不等于失败：也可能是 owner 还没发到这一代。 */
export interface ShareAdoptReading {
  readonly adopted: boolean;
  readonly keyEpoch: number;
  readonly serverKeyEpoch: number;
}

/** 移除 + 换钥这一条意图的读数。🔴 `rekeyError` 不抛出去是要留给界面说的话（见下）。 */
export interface ShareRemovalReading {
  readonly removed: boolean;
  readonly rekey?: ShareRekeyReading | undefined;
  readonly rekeyError?: string | undefined;
}

const hasPublicKey = (row: ShareRosterMemberRow): boolean =>
  typeof row.identityPublicKey === 'string' && row.identityPublicKey.trim() !== '';

/**
 * 造一份共享清单的换钥器。
 *
 * ⚠️ 它**不认识界面**：谁按了按钮、错误文案怎么说，都是宿主的事。它只保证
 * "要么按纪律把这件事做完并把读数交出去，要么一个请求都不发"。
 */
export function createShareKeyRotation(options: ShareKeyRotationOptions) {
  const readRoster = async (shareId: string): Promise<readonly ShareRosterMemberRow[]> =>
    (await options.api.listMembers(shareId)).members;

  /**
   * 收新钥：本机世代落后于服务端 ⇒ 去自己的成员行取那一枚新信封。
   * 这是"重封给在册成员"的**收**那一半——没有它，换钥等于把其他人锁在门外。
   */
  const adoptRotatedShareKey = async (shareId: string): Promise<ShareAdoptReading> => {
    if (!options.isSignedIn()) throw new ShareNotSignedInError();
    const [local, identity] = await Promise.all([options.keys.load(shareId), options.keys.ownIdentity(shareId)]);
    if (local === undefined || identity === undefined) throw new ShareKeyUnavailableError(shareId);
    const detail = await options.api.shareDetail(shareId);
    if (detail.keyEpoch <= local.keyEpoch) {
      return { adopted: false, keyEpoch: local.keyEpoch, serverKeyEpoch: detail.keyEpoch };
    }
    const own = (await readRoster(shareId)).find((m) => m.memberId === identity.memberId);
    // 信封还没到，或到的是**别的世代**那一枚（owner 正在逐个人发）⇒ 如实"还没轮到"，
    // 不去解一把世代不对的信封（解开了就是把旧钥当新钥用）。
    if (own === undefined || own.keyEnvelope === null || own.keyEnvelope === undefined) {
      return { adopted: false, keyEpoch: local.keyEpoch, serverKeyEpoch: detail.keyEpoch };
    }
    if (own.memberKeyEpoch !== detail.keyEpoch) {
      return { adopted: false, keyEpoch: local.keyEpoch, serverKeyEpoch: detail.keyEpoch };
    }
    const listKey = await openListKeyEnvelope({
      // 线上的信封是 `unknown`（防御 JSON 边界）；形状由 `openListKeyEnvelope` 自己再校。
      envelope: own.keyEnvelope as ShareMemberKeyEnvelope,
      recipientX25519SecretKey: identity.x25519SecretKey,
    });
    await options.keys.save(shareId, { keyEpoch: detail.keyEpoch, listKey });
    return { adopted: true, keyEpoch: detail.keyEpoch, serverKeyEpoch: detail.keyEpoch };
  };

  /** 换钥：铸一把新 listKey、推进世代、把新信封发给**移除之后**仍在册的每个人。 */
  const rotateShareKey = async (shareId: string): Promise<ShareRekeyReading> => {
    if (!options.isSignedIn()) throw new ShareNotSignedInError();
    const loaded = await options.keys.load(shareId);
    const identity = await options.keys.ownIdentity(shareId);
    // 本地先读：这一步就能否掉"没解锁也要发请求"（纪律 5）。
    if (loaded === undefined || identity === undefined) throw new ShareKeyUnavailableError(shareId);
    const detail = await options.api.shareDetail(shareId);
    if (detail.yourRole !== 'owner') throw new ShareNotOwnerError();

    // 别的设备已经换过 ⇒ 先把他那把新钥收下来，再从那一代往上换。
    let local = loaded;
    if (detail.keyEpoch > local.keyEpoch) {
      await adoptRotatedShareKey(shareId);
      const afterAdopt = await options.keys.load(shareId);
      if (afterAdopt === undefined || afterAdopt.keyEpoch !== detail.keyEpoch) {
        throw new ShareKeyOutOfSyncError({ localEpoch: local.keyEpoch, serverEpoch: detail.keyEpoch });
      }
      local = afterAdopt;
    }

    const roster = await readRoster(shareId);
    const recipients = [
      // 自己那一行永远排第一（纪律 3）。owner 的成员行**没有** `identityPublicKey`
      // （`POST /shares` 不收它），所以公钥只能从本机身份种子派生——不能靠名册。
      { memberId: identity.memberId, publicKey: identity.x25519PublicKey },
      ...roster
        .filter((m) => m.memberId !== identity.memberId && hasPublicKey(m))
        .map((m) => ({ memberId: m.memberId, publicKey: options.decodeMemberPublicKey(m.identityPublicKey as string) })),
    ];
    const skippedMemberIds = roster
      .filter((m) => m.memberId !== identity.memberId && !hasPublicKey(m))
      .map((m) => m.memberId);

    const plan = await planShareRekey({
      shareId,
      fromEpoch: local.keyEpoch,
      remainingMemberX25519PublicKeys: recipients.map((r) => r.publicKey),
    });
    // `planShareRekey` 按入参顺序逐枚封；对齐是它的契约，这里现量验一次而不是靠记忆。
    if (plan.envelopes.length !== recipients.length) {
      throw new Error(`Share rekey envelope count ${String(plan.envelopes.length)} != recipients ${String(recipients.length)}`);
    }

    await options.keys.save(shareId, { keyEpoch: plan.toEpoch, listKey: plan.newListKey });

    const sealedMemberIds: string[] = [];
    const failedMemberIds: string[] = [];
    for (const [index, recipient] of recipients.entries()) {
      try {
        await options.api.putMemberEnvelope(shareId, recipient.memberId, {
          // 🔴 世代 = `plan.toEpoch` = 这把新钥自己的世代（纪律 1），不是 `detail.keyEpoch + 1`。
          keyEpoch: plan.toEpoch,
          keyEnvelope: plan.envelopes[index] as object,
        });
        sealedMemberIds.push(recipient.memberId);
      } catch {
        failedMemberIds.push(recipient.memberId);
      }
    }
    return {
      fromEpoch: plan.fromEpoch,
      toEpoch: plan.toEpoch,
      sealedMemberIds,
      failedMemberIds,
      skippedMemberIds,
    };
  };

  /**
   * 一个用户意图：把人移出共享**并**当场换钥。
   *
   * 🔴 动手前先问"这台设备现在换得了钥吗"（解不开就**零请求**）。只把人移除、不换钥，
   *    等于门关了但钥匙还在他口袋里——那正是计划 §9.1 登记的现状，不该由一次点击重新造出来。
   * 🔴 换钥失败**不**回滚移除，也不抛出去——人已经移走了（服务端的事已经成了），
   *    这时把整件事报成"移除失败"是假话。读数里留着 `rekeyError`，由宿主如实说。
   */
  const removeMemberAndRekey = async (shareId: string, memberId: string): Promise<ShareRemovalReading> => {
    if (!options.isSignedIn()) throw new ShareNotSignedInError();
    if (options.api.removeMember === undefined) throw new Error('This rotation port set cannot remove members');
    const [readyKey, readyIdentity] = await Promise.all([options.keys.load(shareId), options.keys.ownIdentity(shareId)]);
    if (readyKey === undefined || readyIdentity === undefined) throw new ShareKeyUnavailableError(shareId);
    await options.api.removeMember(shareId, memberId);
    try {
      return { removed: true, rekey: await rotateShareKey(shareId) };
    } catch (err) {
      return { removed: true, rekeyError: err instanceof Error ? err.message : String(err) };
    }
  };

  return { adoptRotatedShareKey, rotateShareKey, removeMemberAndRekey };
}

/**
 * 一份共享在本地的东西：密钥 + 折叠出来的日志 + 下行游标。
 * 三件都在离开共享的那一刻变得**不该再存在**——留着一件就是留着别人的评论。
 */
export interface ShareForgetPort {
  dropKey(shareId: string): void;
  dropShareData(shareId: string): void;
}

/**
 * 本机不再拥有这份共享时清掉本地数据（退出、被移除、面板读到 403/404）。
 *
 * ⚠️ 顺序无关，但**两件都要做**：只删钥不删日志，界面上评论还在（读的是本地那份明文日志）；
 * 只删日志不删钥，下一轮拉取会把同一批内容又拉回来。
 */
export function forgetShareLocally(ports: ShareForgetPort, shareId: string): void {
  ports.dropKey(shareId);
  ports.dropShareData(shareId);
}
