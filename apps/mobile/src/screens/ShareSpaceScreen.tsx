/**
 * 「共享清单」—— 移动端的共享主屏（M6-3a，第二层屏，顶栏返回）
 * =============================================================================
 *
 * 这是 web `features/share/ShareFeature.tsx` 那一层旅程在 RN 上的对偶装配：
 * 同意 → 建共享 → 成员面板（邀请/撤销/把链接交出去/改角色/移除即换钥/离开/转让），
 * 加上评论区与通知偏好。**判据全部在 `@heyta/app-host` / `@heyta/ui`**：
 * 本机哪些清单在共享（`shareRowsOnDevice`）、谁能不能接手所有权
 * （`memberCanHoldOwnership`，B-10 那道"没钥就灰掉并说为什么"在 `SharePanel` 里
 * 连按钮都不给）、转让打到服务端后的具名分类（`shareTransferFailure`）、
 * 移除必须连着换钥（`removeMemberAndRekey`）、离场要清三件（`forgetShareLocally`）。
 * 本文件只回答"这些东西在手机上画在哪、点了走哪条调用"（AGENTS §3.5）。
 *
 * 🔴 **没有一枚定时器。** 成员面由 `share_roster_changed` 信号驱动：本屏打开哪份
 * 清单就 `registerShareRosterTarget(shareId, reload)`，信号到 ⇒ 重取（ADR-0070
 * 刚撤掉 web 的两枚 3s 轮询，移动端一开始就用信号形状）。
 * 🔴 **评论区不许自己再拉。** 下行游标每份 share 全局一份，正在显示那一侧再拉只会
 * 拿到 `fetched = 0`；正确动作是 `subscribeShareRepaint` 之后**从盘上重放**
 * （`commentsForTask` 读的就是那一份缓存）。进入某一节的冷启动那一趟 `pullForTask`
 * 是 web `ShareCommentsSection` 的同一条纪律，不是轮询。
 *
 * 🔴 **系统横幅这一格今天做不到**（不是没做，是做不了；全文与两端的机制差异在
 * `share/share-activity-notify.ts` 文件头）：本机唯一那条原生通道归提醒链 —— iOS 那侧按
 * `categoryIdentifier` 整族认领回收（`HeytaReminderModule.swift` 的 `cancelStale`），安卓那侧
 * 只有一条 `heyta.reminders` 通道可投。做到它需要给活动通知一枚自己的身份并重打、重装两端 ——
 * 而那是提醒线的资产。所以投递端口保持**可注入**
 * （`ShareActivityDeliveryPorts.systemBanner`），本屏只把**应用内**那一格画出来
 * （「共享动态」在通知中心，入口装配见 `App.tsx`）。
 *
 * 与 web 的**刻意差异**（如实登记，别默默算做成）：
 *   1. 移动端没有 `navigator.clipboard` ⇒ "复制凭证/复制链接"换成系统分享面板
 *      （`Share.share`，`ExportScreen.tsx:367` 与邀请码同一先例）；
 *   2. 邀请**撤销**是移动端多出来的一格（服务端 `revokeInvitation` 本来就有，
 *      web 面板今天没摆）；票据只留在本机内存这一份，退出面板即丢，与 web
 *      "凭证只显示这一次"同一条语义；
 *   3. 转让失败的具名读数照 web 收口（面板灰态是第一层，服务端 409 具名码是第二层）；
 *   4. 「取消共享」（所有者单方面解散）两端都没有 —— 不在这里发明。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Share } from 'react-native';

import {
  base64ToBytesPortable,
  bytesToBase64Portable,
  createProjectActions,
  createTaskActions,
  deleteShareKeyPortable,
  forgetShareLocally,
  getShareKeyEntryPortable,
  localRowIdForShare,
  publishShareSigningKey,
  readShareOwnIdentityPortable,
  shareRowsOnDevice,
  shareTransferFailure,
  unwrapShareListKeyPortable,
  wrapAndStoreShareKeyPortable,
  type AppHost,
  type ShareTransferFailure,
} from '@heyta/app-host';
import { COMMENT_MAX_LENGTH, type Task } from '@heyta/domain';
import { deriveShareIdentityKeyPair, generateShareIdentitySeed, generateShareListKey, sealListKeyForRecipient } from '@heyta/sync-core';
import { ShareApiError } from '@heyta/sync-client';
import {
  buildShareJoinLink,
  CommentThread,
  NotificationPrefsPanel,
  ShareConsentModal,
  SharePanel,
  shouldShowConsent,
  type CommentThreadProps,
  type ShareConsentStore,
  type ShareNotificationPrefs,
  type ShareRole,
} from '@heyta/ui';
import { useI18n } from '@heyta/i18n';

import { openTaskHost } from '../db/open-host';
import {
  clearMobileShareLog,
  devicePrefKv,
  loadMobileShareConsent,
  loadMobileShareNotificationPrefs,
  mobileShareLogWriteError,
  saveMobileShareConsent,
  saveMobileShareNotificationPrefs,
} from '../lib/share-local-store';
import { useMobileSync } from '../sync/store';
import { Button, Card, Chip, Divider, EmptyState, Screen, Stack, Text, TextField } from '../ui/kit';
import { ensureMobileShareSession, mobileShareSession, resetMobileShareSession } from '../share/share-session';
import { prepareMobileShareAdmin, type MobileShareAdmin } from '../share/share-admin';
import { pullSharedContentsOnOpen, registerShareRosterTarget, subscribeShareRepaint } from '../share/share-signals';
import { bindProjectShare } from '../share/project-share';
import JoinShareScreen from './JoinShareScreen';

/** 面板票据（`createInvitation` 的产物；只活在本机内存，见文件头差异 2）。 */
interface InviteTicket {
  readonly invitationId: string;
  readonly token: string;
}

/**
 * 这一次拉取回来的清单详情。
 *
 * 🔴 `ownMemberId` 在 2026-10-25 之前是一个**独立的** `useState<…Id>`。
 * `check:selection-single-source` 断言 G 把它记成"没有语义登记的本地 id" ——
 * 而它既不是"当前看的是哪一条"，也不是 5 类瞬态之一：它是**同一次拉取里的数据**
 * （与 ownerId / keyEpoch / yourRole 同一个 `Promise.all` 回来）。
 * ⇒ 正确的修法不是给它加一条豁免，是把它并回它本来就属于的那个对象。
 */
type PanelDetail = { ownerId: number; keyEpoch: number; yourRole: string; ownMemberId?: string };
type MemberRow = Awaited<ReturnType<MobileShareAdmin['api']['listMembers']>>['members'][number];

export default function ShareSpaceScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  /** 🔴 评论落盘、远端回流都敲 `dataRevision`（`check:materialized-reads` 同一判据）。 */
  const { dataRevision } = useMobileSync();

  const [view, setView] = useState<'space' | 'join'>('space');
  const [host, setHost] = useState<AppHost | null>(null);
  const [admin, setAdmin] = useState<MobileShareAdmin | undefined>(undefined);
  const [adminTried, setAdminTried] = useState(false);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  /** 日志写失败要说出口（症状是"评论下次开机看不见"，见 `share-local-store` 文件头）。 */
  const [storageError, setStorageError] = useState<string | undefined>(mobileShareLogWriteError());

  // ── 主屏：本机共享清单名册 ────────────────────────────────────────────────
  const [sharedRows, setSharedRows] = useState<readonly { shareId: string; projectId: string; name: string }[]>([]);
  const [shareable, setShareable] = useState<readonly { projectId: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);

  // ── 面板态（对齐 web `ShareFeature` 的同名格子）──────────────────────────
  const [detail, setDetail] = useState<PanelDetail | undefined>();
  const [members, setMembers] = useState<readonly MemberRow[]>([]);
  const [notMember, setNotMember] = useState(false);
  const [panelError, setPanelError] = useState<string | undefined>();
  const [transferFailure, setTransferFailure] = useState<{ kind: ShareTransferFailure; detail: string } | undefined>();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [ticket, setTicket] = useState<InviteTicket | undefined>();
  const [shareFailed, setShareFailed] = useState(false);
  const [leaveArmed, setLeaveArmed] = useState(false);

  // ── 创建共享（owner 侧一次性动作，web `createShare` 的对偶）───────────────
  const [consentStore, setConsentStore] = useState<ShareConsentStore>(() => loadMobileShareConsent());
  const [consentFor, setConsentFor] = useState<string | undefined>();
  const [creatingFor, setCreatingFor] = useState<string | undefined>();
  const [creatingError, setCreatingError] = useState<string | undefined>();

  // ── 评论区（repaint 纪律那一格）──────────────────────────────────────────
  const [commentTask, setCommentTask] = useState<string | undefined>();
  const [tick, setTick] = useState(0);
  const [sessionComments, setSessionComments] = useState(() => mobileShareSession());

  // ── 通知偏好（本机磁盘，零请求）──────────────────────────────────────────
  const [prefs, setPrefs] = useState<ShareNotificationPrefs>(() => loadMobileShareNotificationPrefs());
  const [prefsSaveFailed, setPrefsSaveFailed] = useState(false);
  const [consentSaveFailed, setConsentSaveFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void openTaskHost()
      .then((next) => {
        if (alive) setHost(next);
      })
      .catch(() => {
        if (alive) setHost(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void prepareMobileShareAdmin()
      .then((next) => {
        if (!alive) return;
        setAdmin(next);
        setAdminTried(true);
        // 🔴 有凭据但接不上 = 这一刻只有"vault 没解锁"一种解释（web 的 `needsUnlock` 同一格）。
        setNeedsUnlock(next === undefined);
      })
      .catch(() => {
        if (alive) {
          setAdmin(undefined);
          setAdminTried(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [dataRevision]);

  /**
   * 名册从**合并视图**推。判据不在这：`shareRowsOnDevice` 是 app-host 的唯一读侧判据
   * （"没删的清单行挂着 shareId 才算在册"），可共享的那批 = 全部清单行减去在册行 ——
   * 这里一次都不读 `.shareId`（AGENTS §3.5；`share-session.spec` 那条反向判据盯的就是它）。
   */
  useEffect(() => {
    if (host === null) return;
    const state = host.getState();
    const rows = shareRowsOnDevice(state);
    const knownProjectIds = new Set(rows.values());
    const shared: { shareId: string; projectId: string; name: string }[] = [];
    for (const [shareId, projectId] of rows) {
      const project = state.projects[projectId];
      if (project === undefined) continue;
      shared.push({ shareId, projectId, name: project.name });
    }
    shared.sort((a, b) => a.name.localeCompare(b.name));
    setSharedRows(shared);
    const rest = Object.values(state.projects)
      .filter((p) => p.deletedAt === undefined && !knownProjectIds.has(p.id))
      .map((p) => ({ projectId: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setShareable(rest);
  }, [host, dataRevision, selected]);

  // ── 面板加载（reload）：web `ShareFeature.reload` 的对偶，含"被移除 ⇒ 本地三件清掉" ──
  const reload = useCallback(
    async (shareId: string): Promise<void> => {
      if (admin === undefined) return;
      try {
        const [d, m] = await Promise.all([admin.api.shareDetail(shareId), admin.api.listMembers(shareId)]);
        const entry = await getShareKeyEntryPortable(admin.keyPort, shareId);
        setDetail({
          ownerId: d.ownerId,
          keyEpoch: d.keyEpoch,
          yourRole: d.yourRole,
          ownMemberId: entry?.ownMemberId,
        });
        setMembers(m.members);
        setNotMember(false);
        setStorageError(mobileShareLogWriteError());
      } catch (err) {
        if (err instanceof ShareApiError && (err.status === 403 || err.status === 404)) {
          // 🔴 服务端说"你不是这个人了"：本机的钥 + 折叠日志 + 游标都不该再留着
          // （里面是**别人写的评论**）。两件都做才算离场（判据在 `forgetShareLocally`），
          // 内存里那份已解密的会话缓存也必须摘（`resetMobileShareSession`）。
          forgetShareLocally(
            {
              dropKey: () => {
                void deleteShareKeyPortable({ port: admin.keyPort, shareId }).catch((e: unknown) => {
                  setPanelError(t('web.share.error.action', { message: e instanceof Error ? e.message : String(e) }));
                });
              },
              dropShareData: () => {
                clearMobileShareLog(devicePrefKv, shareId);
              },
            },
            shareId,
          );
          resetMobileShareSession();
          setNotMember(true);
          setDetail(undefined);
          setMembers([]);
        }
      }
    },
    [admin, t],
  );

  /**
   * 🔴 面板开着 ⇒ 登记 roster target；信号到 ⇒ `reload`。没有轮询（ADR-0070）。
   * 这也是"刚入群那台设备"格子的移动端同款：闸门认「清单行绑定 ∪ 登记中的 target」，
   * 面板这一侧的登记让它**开着的时候**对信号可见（`shareRosterTargetShareIds`）。
   */
  useEffect(() => {
    if (selected === undefined) return undefined;
    void reload(selected);
    return registerShareRosterTarget(selected, async () => {
      await reload(selected);
    });
  }, [selected, reload]);

  // ── owner 补发信封（autoSeal）：世代落后/没信封的成员 ⇒ 用**本机这把钥的世代**封信封 ──
  useEffect(() => {
    if (admin === undefined || selected === undefined || detail === undefined || detail.yourRole !== 'owner') return;
    let alive = true;
    void (async () => {
      const { rotation, keyPort, vaultCipher, api } = admin;
      if (rotation === undefined) return;
      try {
        await rotation.adoptRotatedShareKey(selected);
      } catch {
        /* 收不到新信封不是错（对方还没发），照本机这把继续（M3 纪律 1 的同一格）。 */
      }
      if (!alive) return;
      const entry = await getShareKeyEntryPortable(keyPort, selected);
      if (entry === undefined || entry.keyEpoch < 1) return;
      const listKey = await unwrapShareListKeyPortable({ port: keyPort, cipher: vaultCipher, shareId: selected });
      if (listKey === undefined) {
        if (alive) setNeedsUnlock(true);
        return;
      }
      for (const m of members) {
        if (m.keyEnvelope !== null && m.keyEnvelope !== undefined && m.memberKeyEpoch >= entry.keyEpoch) continue;
        if (m.identityPublicKey === null || m.identityPublicKey === undefined) continue;
        try {
            const envelope = await sealListKeyForRecipient({
              listKey,
              shareId: selected,
              keyEpoch: entry.keyEpoch,
              recipientX25519PublicKey: base64ToBytesPortable(m.identityPublicKey),
            });
            await api.putMemberEnvelope(selected, m.memberId, { keyEpoch: entry.keyEpoch, keyEnvelope: envelope });
          } catch {
            /* 单个成员失败不拖垮整轮；下一次 roster 信号或重进面板再补。 */
          }
        }
    })();
    return () => {
      alive = false;
    };
    // `members` 在依赖里是刻意的：补发链的唯一驱动是「reload → members 变 → 这一发」（ADR-0070），
    // 撤掉轮询后断了这一环，症状是"信封永远补不出去"而界面完全看不出来。
  }, [admin, selected, detail, members]);

  // ── 签名公钥自证补发（ADR-0069 裁决二"老设备也能上路"那条腿）──────────────
  useEffect(() => {
    if (admin === undefined || selected === undefined || detail === undefined) return;
    void (async () => {
      const own = await readShareOwnIdentityPortable({ port: admin.keyPort, cipher: admin.vaultCipher, shareId: selected });
      if (own === undefined) return;
      const row = members.find((m) => m.memberId === own.memberId);
      if (row === undefined) return;
      try {
        await publishShareSigningKey({
          api: admin.api,
          shareId: selected,
          memberId: own.memberId,
          signingPublicKey: bytesToBase64Portable(own.ed25519PublicKey),
          registeredPublicKey: row.signingPublicKey ?? null,
        });
      } catch {
        /* 发不出去下一轮再发；这台设备的共享写会被服务端拒，不靠这里兜（web 逐字同口径）。 */
      }
    })();
  }, [admin, selected, detail, members]);

  // ── 动作：邀请 / 撤销 / 交出去 ────────────────────────────────────────────
  const submitInvite = useCallback(async () => {
    if (admin === undefined || selected === undefined) return;
    setInviteBusy(true);
    setPanelError(undefined);
    try {
      const email = inviteEmail.trim() === '' ? undefined : inviteEmail.trim();
      const res = await admin.api.createInvitation(selected, email === undefined ? {} : { invitedEmail: email });
      setTicket({ invitationId: res.invitationId, token: res.token });
      setInviteEmail('');
    } catch (err) {
      setPanelError(t('web.share.error.action', { message: shareApiText(err) }));
    } finally {
      setInviteBusy(false);
    }
  }, [admin, selected, inviteEmail, t]);

  const revokeInvite = useCallback(async () => {
    if (admin === undefined || selected === undefined || ticket === undefined) return;
    setPanelError(undefined);
    try {
      await admin.api.revokeInvitation(selected, ticket.invitationId);
      setTicket(undefined);
    } catch (err) {
      setPanelError(t('web.share.error.action', { message: shareApiText(err) }));
    }
  }, [admin, selected, ticket, t]);

  /** 移动端没有 `navigator.clipboard`：链接经系统分享面板交出去（`ExportScreen` 同一先例）。 */
  const handOffTicket = useCallback(async () => {
    if (admin === undefined || ticket === undefined) return;
    const link = buildShareJoinLink(admin.baseUrl, ticket.token);
    try {
      await Share.share({ message: `${link}\n${ticket.token}` });
      setShareFailed(false);
    } catch {
      // 用户自己关掉面板也可能走 reject；凭证就在屏幕上，失败要说出口（邀请码那一格同口径）。
      setShareFailed(true);
    }
  }, [admin, ticket]);

  // ── 动作：移除即换钥 / 改角色 / 转让 / 离开 ───────────────────────────────
  const removeMember = useCallback(
    async (memberId: string) => {
      if (admin === undefined || selected === undefined) return;
      if (admin.rotation === undefined) {
        setPanelError(t('web.share.error.offline'));
        return;
      }
      setPanelError(undefined);
      try {
        const reading = await admin.rotation.removeMemberAndRekey(selected, memberId);
        // 人已经移走了，换钥失败不能报"移除失败"，但也不能不说（这份清单还在用旧钥写）。
        if (reading.rekeyError !== undefined) {
          setPanelError(t('web.share.error.rekeyAfterRemove', { message: reading.rekeyError }));
        }
      } catch (err) {
        setPanelError(t('web.share.error.action', { message: shareApiText(err) }));
      }
      await reload(selected);
    },
    [admin, selected, reload, t],
  );

  const changeRole = useCallback(
    async (memberId: string, role: ShareRole) => {
      if (admin === undefined || selected === undefined) return;
      setPanelError(undefined);
      try {
        await admin.api.patchMemberRole(selected, memberId, role);
      } catch (err) {
        setPanelError(t('web.share.error.action', { message: shareApiText(err) }));
      }
      await reload(selected);
    },
    [admin, selected, reload, t],
  );

  const transferOwnership = useCallback(
    async (memberId: string) => {
      if (admin === undefined || selected === undefined) return;
      setTransferFailure(undefined);
      try {
        await admin.api.transferOwnership(selected, memberId);
      } catch (err) {
        // 🔴 B-10 的服务端第二层门：面板灰掉不合格接收方只是第一层，数据落后一拍时
        // 那一发仍会打到服务端。没有这一发 catch，"确认转让"按下去什么都不说。
        const status = err instanceof ShareApiError ? err.status : undefined;
        const code = err instanceof ShareApiError ? err.code : undefined;
        setTransferFailure({
          kind: shareTransferFailure({ status, code: code === undefined ? undefined : String(code) }),
          detail: shareApiText(err),
        });
      }
      await reload(selected);
    },
    [admin, selected, reload, t],
  );

  const leaveShare = useCallback(async () => {
    if (admin === undefined || selected === undefined || host === null) return;
    setPanelError(undefined);
    try {
      await admin.api.leaveShare(selected);
    } catch (err) {
      setPanelError(t('web.share.error.action', { message: shareApiText(err) }));
      return;
    }
    forgetShareLocally(
      {
        dropKey: () => {
          void deleteShareKeyPortable({ port: admin.keyPort, shareId: selected }).catch(() => undefined);
        },
        dropShareData: () => {
          clearMobileShareLog(devicePrefKv, selected);
        },
      },
      selected,
    );
    resetMobileShareSession();
    // 成员端离开：本地那条清单行一并移除（它是加入时建的那行；web 逐字同一动作）。
    const rowId = localRowIdForShare(host.getState(), selected);
    if (rowId !== undefined) {
      await createProjectActions(host).removeProject(rowId).catch(() => undefined);
    }
    setLeaveArmed(false);
    setSelected(undefined);
  }, [admin, selected, host, t]);

  // ── 创建共享（同意 → 建 share → 钥匙/信封/签名 → 回写清单行）──────────────
  const createShare = useCallback(
    async (projectId: string) => {
      if (admin === undefined) {
        setCreatingError(t('web.share.error.offline'));
        return;
      }
      setCreatingFor(projectId);
      setCreatingError(undefined);
      try {
        const created = await admin.api.createShare();
        const identitySeed = generateShareIdentitySeed();
        const identity = deriveShareIdentityKeyPair(identitySeed);
        const listKey = generateShareListKey();
        const envelope = await sealListKeyForRecipient({
          listKey,
          shareId: created.shareId,
          keyEpoch: 1,
          recipientX25519PublicKey: identity.x25519PublicKey,
        });
        await admin.api.putMemberEnvelope(created.shareId, created.memberId, { keyEpoch: 1, keyEnvelope: envelope });
        // 🔴 建 share 的 POST 不带公钥（owner 行是空身份行）；签名公钥只能由本人在这之后
        // 发一次，少了这一跳此后每一条共享 op 都会被上传边界永久拒（ADR-0069 裁决六）。
        await admin.api.putMemberSigningKey(created.shareId, created.memberId, bytesToBase64Portable(identity.ed25519PublicKey));
        await wrapAndStoreShareKeyPortable({
          port: admin.keyPort,
          cipher: admin.vaultCipher,
          shareId: created.shareId,
          listKey,
          keyEpoch: 1,
          identitySeed,
          ownMemberId: created.memberId,
        });
        // 服务端成功之后才写本地清单字段（一个意图一条 op；调用点全壳唯一，见 project-share.ts）。
        await bindProjectShare(projectId, created.shareId);
        setCreatingFor(undefined);
        setSelected(created.shareId);
      } catch (err) {
        setCreatingFor(undefined);
        setCreatingError(shareApiText(err));
      }
    },
    [admin, t],
  );

  const startShare = useCallback(
    (projectId: string) => {
      setCreatingError(undefined);
      const decision = shouldShowConsent(consentStore);
      if (decision.show) setConsentFor(projectId);
      else void createShare(projectId);
    },
    [consentStore, createShare],
  );

  // ── 评论区：进入那一节拉一次（冷启动），之后**只从盘上重放** ────────────────
  useEffect(() => {
    let alive = true;
    void ensureMobileShareSession().then((session) => {
      if (alive) setSessionComments(session);
    });
    return () => {
      alive = false;
    };
  }, [tick, dataRevision]);

  useEffect(() => {
    if (sessionComments === undefined || commentTask === undefined) return;
    let alive = true;
    void sessionComments
      .pullForTask(commentTask)
      .then((result) => {
        if (alive && (result?.added ?? 0) > 0) setTick((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionComments, commentTask]);

  /**
   * 🔴 **打开这份共享 ⇒ 拉一次既有下行**。判据本体在 `@heyta/app-host` 的
   *    `pullSharedListOnOpen`（为什么每次打开都拉、为什么不抛穿，写在那份文件头）。
   *    这一格是 2026-10-25 iOS 设备腿 L2 抓出来的：成员名册已经下来、清单行也绑好了，
   *    评论区却写「这条共享清单里还没有任务」—— 因为 `new_share_ops` 只在**有人新写**时
   *    响，"加入之前就在清单里的东西"此前**没有任何一条路径**会带来（两壳同形）。
   *    只按 `selected` 触发，不许挂 `tick`：拉成功会敲重画、重画会顶 `tick`，
   *    挂上去就变成"拉到 ⇒ 再拉"的自循环。
   */
  useEffect(() => {
    if (selected === undefined) return;
    void pullSharedContentsOnOpen(selected).catch(() => undefined);
  }, [selected]);

  /**
   * 🔴 重画通道订阅：信号消费侧落盘后敲这一下，本节的动作是**重读那一份缓存**
   * （`commentsForTask`），绝不是再发一次 `pullForTask` —— 游标是每份 share 全局一份，
   * 这里再拉只会拿到 `fetched = 0`，界面永远停在打开那一刻（这条线实测过两次）。
   */
  useEffect(
    () =>
      subscribeShareRepaint(() => {
        setTick((n) => n + 1);
      }),
    [],
  );

  const tasksForSelected = useMemo<readonly Task[]>(() => {
    if (host === null || selected === undefined) return [];
    const rowId = localRowIdForShare(host.getState(), selected);
    if (rowId === undefined) return [];
    // 顺序/判据交给 `listTasks()`（合并视图那份），这里只按清单归属取子集。
    return createTaskActions(host)
      .listTasks()
      .filter((task) => task.projectId === rowId);
  }, [host, selected, tick]);

  const commentLabels = useMemo(
    () => ({
      emptyThread: t('common.share.comment.emptyThread'),
      fallbackAuthor: (id: string) => t('common.share.comment.fallbackAuthor', { id }),
      composerPlaceholder: t('common.share.comment.composerPlaceholder'),
      sendButton: t('common.share.comment.send'),
      errorEmpty: t('common.share.comment.empty'),
      errorTooLong: t('common.share.comment.tooLong', { max: COMMENT_MAX_LENGTH }),
    }),
    [t],
  );

  const panelLabels = useMemo(
    () => ({
      membersTitle: t('common.share.panel.membersTitle'),
      member: {
        roleByRole: {
          owner: t('common.share.member.role.owner'),
          editor: t('common.share.member.role.editor'),
          commenter: t('common.share.member.role.commenter'),
          viewer: t('common.share.member.role.viewer'),
        } as Record<ShareRole, string>,
        waitingForEnvelope: t('common.share.member.waitingForEnvelope'),
      },
      inviteButton: t('web.share.invite.button'),
      slotsLeft: (n: number) => t('common.share.member.slotsLeft', { n }),
      limitReached: t('common.share.member.limitReached'),
      removeButton: t('web.share.panel.remove'),
      fallbackMember: (idPrefix: string) => t('common.share.comment.fallbackAuthor', { id: idPrefix }),
      transfer: {
        button: t('web.share.transfer.button'),
        confirmHint: t('web.share.transfer.confirmHint'),
        confirm: t('web.share.transfer.confirm'),
        cancel: t('web.share.transfer.cancel'),
      },
    }),
    [t],
  );

  const prefsLabels = useMemo(
    () => ({
      sectionTitle: t('common.share.notif.sectionTitle'),
      activitiesTitle: t('common.share.notif.activitiesTitle'),
      activityCompleted: t('common.share.notif.activityCompleted'),
      activityAdded: t('common.share.notif.activityAdded'),
      activityDeleted: t('common.share.notif.activityDeleted'),
    }),
    [t],
  );

  const savePrefs = useCallback((next: ShareNotificationPrefs) => {
    // 🔴 只落本地，不出网（ADR-0062 决策 7）；写不进去必须说出口（开关下次开机又全关上）。
    if (saveMobileShareNotificationPrefs(next)) setPrefsSaveFailed(false);
    else setPrefsSaveFailed(true);
    setPrefs(next);
  }, []);

  const backAction = {
    icon: 'action.back' as const,
    label: t('mobile.growth.back'),
    onPress: (): void => {
      if (selected === undefined) onBack();
      else setSelected(undefined);
    },
  };

  /* hooks 全部结束 —— 以下提前 return 不改变 hook 数量（AGENTS §7 记过的那个真 bug）。 */

  if (view === 'join') {
    // 入群屏自己是一块完整屏（标题 + 返回），嵌进来渲染，不套第二层 Screen。
    // ⚠️ 这里**没有** `onJoined`：入群成功那一屏要留在原地给用户看一眼回执，
    //    由用户按「关闭」回来（宿主两个回调本来就是同一件事）。
    return <JoinShareScreen onBack={() => setView('space')} />;
  }

  const notices = (
    <Stack>
      {storageError !== undefined ? (
        <Text variant="row-meta" tone="danger" testID="share-storage-error">
          {t('web.share.error.action', { message: storageError })}
        </Text>
      ) : null}
      {needsUnlock && adminTried ? (
        <Text variant="row-title" tone="default" testID="share-needs-unlock">
          {t('web.share.needUnlock')}
        </Text>
      ) : null}
      {adminTried && admin === undefined && !needsUnlock ? (
        <Text variant="row-title" tone="default" testID="share-offline">
          {t('web.share.error.offline')}
        </Text>
      ) : null}
      {creatingError !== undefined ? (
        <Text variant="row-title" tone="danger" testID="share-create-error">
          {t('web.share.error.create', { message: creatingError })}
        </Text>
      ) : null}
    </Stack>
  );

  // 验签被拒的那一行（web `ShareSignatureNotice` 的对偶；拒了必须说得出哪一种、几条）。
  const rejections = sessionComments?.signatureRejections() ?? [];
  const invalidCount = rejections.filter((r) => r.outcome === 'invalid').length;
  const unregisteredCount = rejections.filter((r) => r.outcome === 'signer-unregistered').length;

  if (host === null) {
    return (
      <Screen title={t('mobile.share.entry')} actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}>
        <EmptyState icon="action.sync" title={t('mobile.tasks.loading.title')} hint={t('mobile.tasks.loading.hint')} />
      </Screen>
    );
  }

  return (
    <Screen
      title={selected === undefined ? t('mobile.share.entry') : sharedRows.find((r) => r.shareId === selected)?.name ?? t('web.share.dialog.title')}
      actions={[backAction]}
    >
      {notices}

      {selected === undefined ? (
        <>
          <Card>
            <Text variant="row-title" tone="default">{t('mobile.share.space.sharedTitle')}</Text>
            {sharedRows.length === 0 ? (
              <Text variant="row-meta" tone="subtle">{t('mobile.share.space.noneYet')}</Text>
            ) : (
              <Stack>
                {sharedRows.map((row) => (
                  <Button
                    key={row.shareId}
                    label={row.name}
                    testID={`share-space-row-${row.shareId}`}
                    onPress={() => {
                      setSelected(row.shareId);
                      setTicket(undefined);
                      setPanelError(undefined);
                      setTransferFailure(undefined);
                      setCommentTask(undefined);
                    }}
                  />
                ))}
              </Stack>
            )}
          </Card>

          <Card>
            <Text variant="row-title" tone="default">{t('mobile.share.space.shareableTitle')}</Text>
            {shareable.length === 0 ? (
              <Text variant="row-meta" tone="subtle">{t('mobile.share.space.shareableEmpty')}</Text>
            ) : (
              <Stack>
                {shareable.map((row) => (
                  <Button
                    key={row.projectId}
                    label={`${row.name} · ${t('web.share.open.new')}`}
                    tone="ghost"
                    testID={`share-create-${row.projectId}`}
                    disabled={creatingFor === row.projectId}
                    loading={creatingFor === row.projectId}
                    onPress={() => startShare(row.projectId)}
                  />
                ))}
              </Stack>
            )}
          </Card>

          <Button label={t('web.share.join.button')} tone="primary" testID="share-join-entry" onPress={() => setView('join')} />

          {consentFor !== undefined ? (
            <ShareConsentModal
              labels={{
                title: t('common.share.consent.title'),
                body: t('common.share.consent.body'),
                scopes: [
                  t('common.share.consent.scope.content'),
                  t('common.share.consent.scope.metadata'),
                  t('common.share.consent.scope.notAffected'),
                ],
                dontAskAgain: t('common.share.consent.dontAskAgain'),
                accept: t('common.share.consent.accept'),
                cancel: t('common.share.consent.cancel'),
              }}
              store={consentStore}
              onConsent={(next) => {
                setConsentStore(next);
                // 🔴 「不再提示」写不进去下次还会弹 —— 那句话要说出口。
                if (!saveMobileShareConsent(next)) setConsentSaveFailed(true);
                else setConsentSaveFailed(false);
              }}
              onProceed={() => {
                const projectId = consentFor;
                setConsentFor(undefined);
                if (projectId !== undefined) void createShare(projectId);
              }}
              onCancel={() => setConsentFor(undefined)}
            />
          ) : null}
          {consentSaveFailed ? (
            <Text variant="caption" tone="danger" testID="share-consent-save-failed">
              {t('mobile.share.consent.saveFailed')}
            </Text>
          ) : null}

          <Divider />
          <Card>
            <NotificationPrefsPanel prefs={prefs} labels={prefsLabels} onChange={savePrefs} />
            {prefsSaveFailed ? (
              <Text variant="caption" tone="danger" testID="share-prefs-save-failed">
                {t('mobile.share.prefs.saveFailed')}
              </Text>
            ) : null}
          </Card>
        </>
      ) : notMember ? (
        /* 🔴 2026-10-25：这一格原先是裸 `<Text>`（`check:empty-state` 断言 B 记的"新
           手写空态站点"就是它）。它是**终态**，不是"这一块暂时没内容" —— 用共享
           `EmptyState` 才拿得到同一套留白与排版；`testID` 与 web 那枚同名。 */
        <EmptyState
          illustration="search"
          title={t('web.share.notMember')}
          hint={t('web.share.notMemberHint')}
          testID="share-not-member"
        />
      ) : detail === undefined ? (
        <EmptyState icon="action.sync" title={t('mobile.tasks.loading.title')} hint={t('mobile.tasks.loading.hint')} />
      ) : (
        <>
          {detail.yourRole === 'owner' ? (
            <Card>
              <TextField
                label={t('web.share.invite.emailLabel')}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder={t('web.share.invite.emailPlaceholder')}
                keyboard="email-address"
                testID="share-invite-email"
              />
              <Button
                label={inviteBusy ? t('web.share.invite.busy') : t('web.share.invite.submit')}
                tone="primary"
                disabled={inviteBusy}
                testID="share-invite-submit"
                onPress={() => {
                  void submitInvite();
                }}
              />
              {ticket !== undefined ? (
                <Stack>
                  <Text variant="row-title" tone="default">{t('web.share.invite.ticketTitle')}</Text>
                  <Text variant="caption" tone="default" testID="share-invite-token">
                    {ticket.token}
                  </Text>
                  <Button
                    label={t('mobile.share.invite.handOff')}
                    onPress={() => {
                      void handOffTicket();
                    }}
                    testID="share-invite-handoff"
                  />
                  <Button
                    label={t('mobile.share.invite.revoke')}
                    tone="ghost"
                    onPress={() => {
                      void revokeInvite();
                    }}
                    testID="share-invite-revoke"
                  />
                  {shareFailed ? (
                    <Text variant="caption" tone="danger">{t('mobile.inbox.invite.shareFailed')}</Text>
                  ) : null}
                  <Text variant="row-meta" tone="muted">{t('web.share.invite.ticketNote')}</Text>
                </Stack>
              ) : null}
            </Card>
          ) : null}

          {transferFailure !== undefined ? (
            <Text variant="row-title" tone="danger" testID="share-transfer-error">
              {transferFailure.kind === 'target-unsealed'
                ? // 与面板行内那句等待提示同一份文案：同一件事不许有两个说法（B-10 的收口句）。
                  t('common.share.member.waitingForEnvelope')
                : t('web.share.transfer.error', { message: transferFailure.detail })}
            </Text>
          ) : null}
          {panelError !== undefined ? (
            <Text variant="row-title" tone="danger" testID="share-panel-error">
              {t('web.share.error.action', { message: panelError })}
            </Text>
          ) : null}
          {rejections.length > 0 ? (
            <Stack testID="share-signature-notice">
              {invalidCount > 0 ? (
                <Text variant="row-meta" tone="danger">{t('web.share.signature.invalid', { count: invalidCount })}</Text>
              ) : null}
              {unregisteredCount > 0 ? (
                <Text variant="row-meta" tone="danger">{t('web.share.signature.signerUnregistered', { count: unregisteredCount })}</Text>
              ) : null}
            </Stack>
          ) : null}

          <Card>
            <SharePanel
              data={{
                shareId: selected,
                ownerId: detail.ownerId,
                keyEpoch: detail.keyEpoch,
                myRole: (detail.yourRole as ShareRole) ?? 'viewer',
                members: members.map((m) => ({
                  memberId: m.memberId,
                  userId: m.userId,
                  role: m.role,
                  addedAt: m.addedAt,
                  hasEnvelope: m.hasEnvelope,
                  memberKeyEpoch: m.memberKeyEpoch,
                })),
                selfMemberId: detail.ownMemberId,
              }}
              labels={panelLabels}
              callbacks={{
                onInvite: () => {
                  /* 邀请表单常驻本屏上方；这个入口不需要额外动作（web 是聚焦输入框）。 */
                },
                onRemoveMember: (memberId) => {
                  void removeMember(memberId);
                },
                onRoleChange: (memberId, role) => {
                  void changeRole(memberId, role);
                },
                onTransferOwnership: (memberId) => {
                  void transferOwnership(memberId);
                },
              }}
            />
          </Card>

          {detail.yourRole !== 'owner' ? (
            leaveArmed ? (
              <Card>
                <Text variant="row-meta" tone="muted">{t('web.share.leave')}</Text>
                <Button
                  label={t('mobile.share.space.leaveConfirm')}
                  tone="danger"
                  testID="share-leave-confirm"
                  onPress={() => {
                    void leaveShare();
                  }}
                />
                <Button label={t('web.share.transfer.cancel')} tone="ghost" onPress={() => setLeaveArmed(false)} />
              </Card>
            ) : (
              <Button
                label={t('web.share.leave')}
                tone="ghost"
                testID="share-leave"
                onPress={() => setLeaveArmed(true)}
              />
            )
          ) : null}

          {/* 评论区：先选一条任务（评论挂在任务上，与 web 的详情栏同一归属）。 */}
          <Divider />
          <Stack>
            <Text variant="row-title" tone="default">{t('mobile.share.space.commentsTitle')}</Text>
            {tasksForSelected.length === 0 ? (
              <Text variant="row-meta" tone="subtle">{t('mobile.share.space.noTasks')}</Text>
            ) : (
              <>
                <Text variant="row-meta" tone="muted">{t('mobile.share.space.pickTask')}</Text>
                {tasksForSelected.map((task) => (
                  <Chip
                    key={task.id}
                    label={task.title}
                    selected={commentTask === task.id}
                    testID={`share-comment-task-${task.id}`}
                    onPress={() => setCommentTask(task.id)}
                  />
                ))}
              </>
            )}
            {sessionComments !== undefined && commentTask !== undefined ? (
              <CommentThread
                taskId={commentTask}
                comments={sessionComments.commentsForTask(commentTask) as unknown as CommentThreadProps['comments']}
                labels={commentLabels}
                onSubmit={async (body) => {
                  await sessionComments.actions.addComment(commentTask, body);
                  setTick((n) => n + 1);
                }}
              />
            ) : null}
          </Stack>
        </>
      )}
    </Screen>
  );
}

/* ── 呈现层小工具（没有任何业务判断）─────────────────────────────────────── */

/** `ShareApiError` 的具名读数（`状态码 错误码`），其余错误原样（web 同一条口径）。 */
function shareApiText(err: unknown): string {
  return err instanceof ShareApiError
    ? `${String(err.status)} ${String(err.code ?? '')}`
    : err instanceof Error
      ? err.message
      : String(err);
}
