/**
 * 重新确认（补签）：**"你同意的还是现在这一版吗"** 这件事的唯一裁决处。
 * ================================================================
 *
 * 它存在的理由是一句已经对外说出口的话 —— `packages/legal/src/documents/terms.ts` s10：
 * "涉及数据用途、责任范围或退款政策的重大变更，我们需要你在应用内**重新确认**"。
 * 在那之前，库里只有一列指针 `users.terms_document_version`，注册之后**再没有任何一条路径
 * 会写它**，所以那句话今天做得到与否完全取决于本文件。台账里对应 G-27。
 *
 * ## 🔴 三件事在本文件里被刻意排除，别"顺手加回来"
 *
 * 1. **不比时间**。判定只比版本字符串。`accepted_at` 是客户端时钟，§7 第 19 条
 *    （墙上时钟不能裁决因果）在这里的具体形态是：一个时钟慢了 30 秒的新账号会被读成
 *    "同意过旧版的人"，而这条判据**每天都会误伤一批人**。"取最新一条历史"同样按
 *    `id` 倒序（只追加的表里 id 顺序 == 服务端收到顺序），不按 `accepted_at`。
 * 2. **不新造档位，也不写公示天数**。D-04 已于 2026-10-02 由产品负责人拍板"按现状"
 *    （不分 A/B/C、不定 ≥15/≥7 日）。所以这里的规则只有一条：
 *    **指纹不等就要重新确认**。它比"只有重大变更才拦"更严，这是有意的取舍 ——
 *    另一种做法要求我们先给九份文档判定"哪些算重大"，那是替法务做决定。
 *    严的那一侧失败模式是多拦一次（用户体验），松的那一侧失败模式是漏拦（承诺没兑现），
 *    本项目一贯取前者（同 `assertEnableable()`、`memoryEnabled` 的 fail-closed 立场）。
 * 3. **不在非官方实例上拦人**。`users.terms_document_version` 在那种实例上永远是 `null`
 *    （裁决在 `legal-consent.ts`：那台机器发布的是运营者自己的文本，我们无权命名版本）。
 *    🔴 于是"指针为 null ⇒ 要拦"这条规则**必须**被"这台实例能不能命名版本"再挡一层，
 *    否则自建部署上的每一个账号都会被永久锁在门外 —— 那不是补签，是凭空造出一种故障。
 *
 * ## 谁写这张表
 *
 * **只有重新确认这一条路径写它**（`recordLegalReconfirm`），注册那三处入口
 * （`auth.ts` 的新建/重发两条 + `passkey.ts` 一条）一行都没动。理由不是省事：
 * 那三处各自还管着"重发计数上限""邮件必须先于库写入""邀请码绑定"这些既有规则，
 * 把它们改成事务的回归面比这张表的价值大。
 *
 * 🔴 但注册时的同意事实确实只存在那**一列指针**上，而重新确认要覆盖它 ——
 * 那就是"销毁旧事实"的那一刻。所以本函数在同一事务里先把指针那份事实**搬进账**
 *（仅当指针非空、且表里还没有这一版时才搬）：搬的是服务端自己早已记下的东西，
 * 不是替谁补一个版本号 —— 与"指针为 `null` 就不许造行"（那是发明同意）分得很清。
 * 搬完之后，"他先同意过 1.0、改版后又同意过 1.1"才是这张表真能回答的问题；
 * 不搬的话它只能回答"最后一次是哪一版"，那跟一列指针没有区别，这张表就白建了。
 */
import { loadConfigFromEnv } from './config';
import { LEGAL_SET_VERSION } from './legal.generated';
import { isOfficialHostedInstance } from './legal-consent';
import { prisma } from './db';
import type { Prisma } from '@prisma/client';

/**
 * 同意事项词表。**封闭**，今天只有一个成员。
 *
 * `legal_set` = "整套对外文本的当前版本"，与 `legalSetVersion()` 那种
 * `terms@1.1;privacy@1.0;…` 的整套指纹同形。研究文档层 2 那套五项词表
 * （`terms` / `privacy` / `auto_renew` / `e2ee_risk` / `age_declaration`）
 * 假设的是**逐项独立勾选**的界面；把一次勾选拆成多行等于发明用户没有分别作出的决定。
 * ⇒ 加一个成员的前提是界面上先出现那个独立的勾（D-06 的年龄声明、§7.1 的 AI 出境披露
 * 都在等各自的勾选项），不是先加词表再找界面。
 */
export const LEGAL_CONSENT_KINDS = ['legal_set'] as const;
export type LegalConsentKind = (typeof LEGAL_CONSENT_KINDS)[number];

/** 这台实例有没有资格为那份文本命名版本（= 能不能要求人重新确认）。 */
export const legalRecheckApplicable = (): boolean =>
  isOfficialHostedInstance(loadConfigFromEnv().publicUrl);

export type LegalRecheckDecision = {
  readonly needsReconfirm: boolean;
  /**
   * 结构化原因码（不是文案 —— 文案在 `packages/i18n`，服务端从不说人话）。
   * - `current`：这个账号同意过就是现在这一版。
   * - `version-changed`：同意过别的一版。
   * - `unprovable`：官方实例上没有任何版本记录（老账号，或注册时那批还没开始记的）。
   * - `not-applicable`：这台实例无权为文本命名版本 ⇒ 本机制整体不适用。
   */
  readonly reason: 'current' | 'version-changed' | 'unprovable' | 'not-applicable';
  /** 服务端自己那份当前指纹；`not-applicable` 时为 `null`（没有可宣告的版本）。 */
  readonly currentVersion: string | null;
  /** 裁决实际依据的那一版；没有可依据的记录时为 `null`。 */
  readonly recordedVersion: string | null;
};

/**
 * 纯判定。**不读库、不读环境** —— 所有输入由调用方给，这样它能被单测穷举，
 * 也让"判据到底看了哪些值"这件事可以从签名上读出来（多一个输入就得在这里多一个分支）。
 */
export const decideLegalRecheck = (input: {
  readonly applicable: boolean;
  readonly currentVersion: string;
  /** `user_consents` 里该事项**最新一行**的版本；一行都没有时传 `null`。 */
  readonly latestConsentVersion: string | null;
  /** `users.terms_document_version` 那列指针。 */
  readonly pointerVersion: string | null;
}): LegalRecheckDecision => {
  if (!input.applicable) {
    return {
      needsReconfirm: false,
      reason: 'not-applicable',
      currentVersion: null,
      recordedVersion: null,
    };
  }
  // 历史优先于指针：一个人补签过之后，表里那行才是事实，指针只是它的副本。
  // 两者都对不上时（表里最新一行是 1.1、指针写着 1.0）取表里那行 —— 那种不一致的方向
  // 是"按人真正同意过的东西判"，不会因为一次没写成的指针更新而漏拦。
  const recorded = input.latestConsentVersion ?? input.pointerVersion;
  if (recorded === null) {
    return {
      needsReconfirm: true,
      reason: 'unprovable',
      currentVersion: input.currentVersion,
      recordedVersion: null,
    };
  }
  return {
    needsReconfirm: recorded !== input.currentVersion,
    reason: recorded === input.currentVersion ? 'current' : 'version-changed',
    currentVersion: input.currentVersion,
    recordedVersion: recorded,
  };
};

/** 读一个账号的同意状态并裁决。GET 与 POST 都走它，避免两份判据漂移。 */
export const evaluateLegalRecheck = async (userId: number): Promise<LegalRecheckDecision> => {
  if (!legalRecheckApplicable()) {
    return decideLegalRecheck({
      applicable: false,
      currentVersion: LEGAL_SET_VERSION,
      latestConsentVersion: null,
      pointerVersion: null,
    });
  }
  // 按 id 倒序取最新一行：只追加的表里这就是"服务端最后收到的那条"，
  // 🔴 刻意不按 accepted_at 排 —— 那一列是客户端时钟。
  const latest = await prisma.userConsent.findFirst({
    where: { userId, kind: 'legal_set' satisfies LegalConsentKind },
    orderBy: { id: 'desc' },
    select: { documentVersion: true },
  });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { termsDocumentVersion: true },
  });
  return decideLegalRecheck({
    applicable: true,
    currentVersion: LEGAL_SET_VERSION,
    latestConsentVersion: latest?.documentVersion ?? null,
    pointerVersion: user?.termsDocumentVersion ?? null,
  });
};

export type RecordConsentResult =
  | { readonly ok: true; readonly recordedVersion: string }
  | { readonly ok: false; readonly error: 'not-applicable' | 'version-mismatch' };

/**
 * 写一条"他确认了现在这一版"。历史行与指针**必须同一个事务**。
 *
 * 🔴 幂等：同一个人对同一版只有一行（库里那条 UNIQUE 就是它）。重复点确认
 * 不会长出第二行，也不会把人再拦一次 —— 这正是唯一索引存在的理由。
 *
 * `clientVersion` 是**界面上真的展示给过他的**那一版。它必须逐字等于服务端当前指纹，
 * 否则拒绝：一个拿着旧版来"确认新版"的客户端（缓存的产物、发了一半的改版）会把
 * 一条版本号写错的历史记录变成证据 —— 那比没有记录更糟，也正是链 3 立起来要防的事。
 */
export const recordLegalReconfirm = async (input: {
  readonly userId: number;
  readonly clientVersion: string;
  readonly acceptedAt: number;
}): Promise<RecordConsentResult> => {
  if (!legalRecheckApplicable()) return { ok: false, error: 'not-applicable' };
  if (input.clientVersion !== LEGAL_SET_VERSION) return { ok: false, error: 'version-mismatch' };
  if (!Number.isInteger(input.acceptedAt) || input.acceptedAt <= 0) {
    // 时间戳不参与裁决，但它是给人看的证据。epoch 0 或负数会渲染成"1970 年同意过"。
    return { ok: false, error: 'version-mismatch' };
  }

  const now = BigInt(Date.now());
  const row: Prisma.UserConsentCreateInput = {
    user: { connect: { id: input.userId } },
    kind: 'legal_set' satisfies LegalConsentKind,
    documentVersion: LEGAL_SET_VERSION,
    acceptedAt: BigInt(input.acceptedAt),
    serverReceivedAt: now,
  };

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { termsAcceptedAt: true, termsDocumentVersion: true },
    });
    const pointer = user?.termsDocumentVersion ?? null;

    // 把指针那份旧事实搬进账 —— 只在它非空、且表里还没有这一版的时候。
    // 🔴 `pointer === null` 时**什么都不搬**：那可能是"这台实例无法命名版本"，
    //    也可能根本是一次没有留痕的注册。给它造一行就是发明同意。
    if (pointer !== null && pointer !== LEGAL_SET_VERSION) {
      const already = await tx.userConsent.findFirst({
        where: { userId: input.userId, kind: 'legal_set', documentVersion: pointer },
        select: { id: true },
      });
      if (!already) {
        await tx.userConsent.create({
          data: {
            user: { connect: { id: input.userId } },
            kind: 'legal_set' satisfies LegalConsentKind,
            documentVersion: pointer,
            // 时刻取注册时记下的那个（同一列指针的兄弟列）；没有就落 0，
            // 含义是"版本有记录、时刻不可考"，仍然不编造时间。
            acceptedAt: user?.termsAcceptedAt ?? BigInt(0),
            // 0 = 这条不是服务端当场收到的，是从指针搬过来的。
            serverReceivedAt: BigInt(0),
          },
        });
      }
    }

    // 同版重复确认 ⇒ 只刷新服务端收据时刻，不新增行（库里那条 UNIQUE 就是它）。
    await tx.userConsent.upsert({
      where: {
        userId_kind_documentVersion: {
          userId: input.userId,
          kind: 'legal_set',
          documentVersion: LEGAL_SET_VERSION,
        },
      },
      create: row,
      update: { serverReceivedAt: now },
    });
    await tx.user.update({
      where: { id: input.userId },
      data: { termsDocumentVersion: LEGAL_SET_VERSION },
    });
  });
  return { ok: true, recordedVersion: LEGAL_SET_VERSION };
};
