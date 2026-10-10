/**
 * `ShareFeature` —— 共享清单的 web 宿主接线（ADR-0062 W4 的用户旅程收口）。
 * ================================================================================
 *
 * 旅程（产品视角，一条线走完）：
 *
 *   owner：清单头部「共享」→ PIPL 23 单独同意模态（方案 a）→ 服务端建 share
 *         → 生成身份种子 + 清单密钥 → 给自己封信封 → `Project.shareId` 回写
 *         → 成员面板（邀请 / 角色 / 移除 / 给新成员自动下发信封）。
 *   成员：侧栏「加入共享清单」贴 token → `acceptInvitation`（带公钥）→
 *         owner 端自动封信封 → 成员解出同一把 listKey → 本地出现这条清单。
 *
 * ## 分层（与 ADR-0003 §2.1 同一条线）
 *
 * - 判权限：服务端（本组件只把"点了也没用"的入口如实隐藏，`SharePanel` 已做）。
 * - 密码学：`@heyta/sync-core/share-keys`（身份/信封/rekey）。
 * - 密钥落盘：`./share-key-store`（vault 载荷信封包裹；未解锁 ⇒ 如实显示）。
 * - op 构造：`@heyta/app-host` 的 `setProjectShareId`（一个意图一条 op）。
 * - 本组件只做**接线与状态机**：把用户的操作翻译成上述调用。
 *
 * ## 🔴 诚实态
 *
 * vault 未解锁 ⇒ 密钥解不开 ⇒ 面板显示「需要解锁」，**不假装可用**；
 * 被移除的成员 ⇒ `shareDetail` 403 ⇒ 显示「已不在成员列表」，**不假装还在**。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { cssVar, ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import {
  generateShareIdentitySeed,
  generateShareListKey,
  deriveShareIdentityKeyPair,
  sealListKeyForRecipient,
} from '@heyta/sync-core';
import { ShareApiClient, ShareApiError, type SyncPayloadCipher } from '@heyta/sync-client';
import { SharePanel, ShareConsentModal, buildShareJoinLink } from '@heyta/ui';
import {
  shouldShowConsent,
  applyShareConsent,
  type ShareConsentStore,
  type ShareRole,
} from '@heyta/ui';

import { useSyncStore } from '../sync/store.js';
import { useProjectStore } from '../projects/store.js';
import { getWebVaultSession } from '../../lib/vault-session.js';
import { text } from '../../lib/text.js';
import {
  getShareKeyEntry,
  deleteShareKey,
  unwrapShareListKey,
  wrapAndStoreShareKey,
} from './share-key-store.js';

const CONSENT_STORAGE_KEY = 'heyta.share-consent.v1';

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};
const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

function loadConsent(): ShareConsentStore {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    return raw === null ? {} : (JSON.parse(raw) as ShareConsentStore);
  } catch {
    return {};
  }
}

export interface ShareFeatureProps {
  /** 本地清单实体 id（写回 `shareId` 用）。 */
  projectId: string;
  /** 已有的 share id（`Project.shareId`）；undefined = 还没共享。 */
  initialShareId?: string;
  onClose: () => void;
}

interface InviteTicket {
  token: string;
  link: string;
  invitedEmail: string;
}

type Phase =
  | { kind: 'consent' }
  | { kind: 'creating' }
  | { kind: 'panel'; shareId: string }
  | { kind: 'not-a-member' }
  | { kind: 'error'; message: string };

export function ShareFeature(props: ShareFeatureProps) {
  const { projectId, initialShareId, onClose } = props;
  const { t } = useI18n();

  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const accountId = useSyncStore((s) => s.accountId);
  const setProjectShare = useProjectStore((s) => s.setProjectShare);

  const [phase, setPhase] = useState<Phase>(
    initialShareId === undefined ? { kind: 'consent' } : { kind: 'panel', shareId: initialShareId },
  );
  const [consentStore, setConsentStore] = useState<ShareConsentStore>(() => loadConsent());
  const [creatingError, setCreatingError] = useState<string | undefined>();

  // 面板数据（phase=panel 时有效）。
  const [members, setMembers] = useState<Awaited<ReturnType<ShareApiClient['listMembers']>>['members']>([]);
  const [detail, setDetail] = useState<{ ownerId: number; keyEpoch: number; yourRole: string } | undefined>();
  const [inviteEmail, setInviteEmail] = useState('');
  const [ticket, setTicket] = useState<InviteTicket | undefined>();
  const [inviteBusy, setInviteBusy] = useState(false);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [copied, setCopied] = useState<'token' | 'link' | undefined>();
  const pollRef = useRef<number | undefined>(undefined);

  const api = useMemo(() => {
    if (baseUrl.trim() === '' || token === undefined || token.trim() === '') return undefined;
    return new ShareApiClient({ baseUrl, getToken: () => token });
  }, [baseUrl, token]);

  const getPayloadCipher = useCallback(async (): Promise<SyncPayloadCipher | undefined> => {
    if (accountId === undefined || accountId === '') return undefined;
    const session = await getWebVaultSession(accountId, baseUrl, async () => token);
    return session.getPayloadCipher();
  }, [accountId, baseUrl, token]);

  // ── 创建共享（owner 侧一次性动作：建 share + 钥匙 + 自封信封 + 回写清单） ──
  const createShare = useCallback(async () => {
    if (api === undefined) {
      setCreatingError(t('web.share.error.offline'));
      return;
    }
    const cipher = await getPayloadCipher();
    if (cipher === undefined) {
      setNeedsUnlock(true);
      return;
    }
    setPhase({ kind: 'creating' });
    try {
      const created = await api.createShare();
      const identitySeed = generateShareIdentitySeed();
      const identity = deriveShareIdentityKeyPair(identitySeed);
      const listKey = generateShareListKey();
      // 给自己封一枚信封：换设备/重载后靠它（而非内存）拿回 listKey。
      const envelope = await sealListKeyForRecipient({
        listKey,
        shareId: created.shareId,
        keyEpoch: 1,
        recipientX25519PublicKey: identity.x25519PublicKey,
      });
      await api.putMemberEnvelope(created.shareId, created.memberId, { keyEpoch: 1, keyEnvelope: envelope });
      await wrapAndStoreShareKey({
        storage: localStorage,
        cipher,
        shareId: created.shareId,
        listKey,
        keyEpoch: 1,
        identitySeed,
        ownMemberId: created.memberId,
      });
      // 服务端成功之后才写本地清单字段（app-host：一个意图一条 op）。
      await setProjectShare(projectId, created.shareId);
      setPhase({ kind: 'panel', shareId: created.shareId });
    } catch (err) {
      setCreatingError(err instanceof ShareApiError ? `${err.status} ${err.code ?? ''}` : String(err));
      setPhase({ kind: 'consent' });
    }
  }, [api, getPayloadCipher, projectId, setProjectShare, t]);

  // ── 面板数据加载 ────────────────────────────────────────────────────────────
  const reload = useCallback(async (shareId: string) => {
    if (api === undefined) return;
    try {
      const [d, m] = await Promise.all([api.shareDetail(shareId), api.listMembers(shareId)]);
      setDetail({ ownerId: d.ownerId, keyEpoch: d.keyEpoch, yourRole: d.yourRole });
      setMembers(m.members);
    } catch (err) {
      if (err instanceof ShareApiError && (err.status === 403 || err.status === 404)) {
        setPhase({ kind: 'not-a-member' });
      }
    }
  }, [api]);

  // owner 端自动信封下发：成员已入群但还没钥（hasEnvelope=false / 世代落后）
  // ⇒ 只要我是 owner 且解得出 listKey，就补封。这是"被邀请者无感知拿到密钥"的那一跳。
  const autoSeal = useCallback(async (shareId: string, keyEpoch: number) => {
    if (api === undefined || detail?.yourRole !== 'owner') return;
    const cipher = await getPayloadCipher();
    if (cipher === undefined) { setNeedsUnlock(true); return; }
    const listKey = await unwrapShareListKey({ storage: localStorage, cipher, shareId });
    if (listKey === undefined) { setNeedsUnlock(true); return; }
    for (const m of members) {
      if (m.keyEnvelope !== null && m.keyEnvelope !== undefined && m.memberKeyEpoch >= keyEpoch) continue;
      if (m.identityPublicKey === null || m.identityPublicKey === undefined) continue;
      try {
        const envelope = await sealListKeyForRecipient({
          listKey, shareId, keyEpoch,
          recipientX25519PublicKey: fromBase64(m.identityPublicKey),
        });
        await api.putMemberEnvelope(shareId, m.memberId, { keyEpoch, keyEnvelope: envelope });
      } catch { /* 单个成员失败不拖垮整轮；下一轮 reload 再试。 */ }
    }
  }, [api, detail?.yourRole, getPayloadCipher, members]);

  useEffect(() => {
    if (phase.kind !== 'panel') return;
    void reload(phase.shareId);
    // 轮询：邀请接受/信封下发都发生在另一端，面板开着的时候每 3s 对一次账。
    pollRef.current = window.setInterval(() => { void reload(phase.shareId); }, 3000);
    return () => { if (pollRef.current !== undefined) window.clearInterval(pollRef.current); };
  }, [phase.kind, phase.kind === 'panel' ? phase.shareId : '', reload]);

  // members 变化 ⇒ 尝试补发信封（幂等：有信封且世代新的跳过）。
  useEffect(() => {
    if (phase.kind !== 'panel' || detail === undefined) return;
    void autoSeal(phase.shareId, detail.keyEpoch);
  }, [phase, detail, members, autoSeal]);

  // ── 邀请（owner）───────────────────────────────────────────────────────────
  const submitInvite = useCallback(async () => {
    if (phase.kind !== 'panel' || api === undefined) return;
    setInviteBusy(true);
    try {
      const email = inviteEmail.trim() === '' ? undefined : inviteEmail.trim();
      const res = await api.createInvitation(phase.shareId, email === undefined ? {} : { invitedEmail: email });
      setTicket({ token: res.token, link: buildShareJoinLink(baseUrl, res.token), invitedEmail: email ?? '' });
      setInviteEmail('');
    } catch (err) {
      setCreatingError(err instanceof ShareApiError ? `${err.status} ${err.code ?? ''}` : String(err));
    } finally {
      setInviteBusy(false);
    }
  }, [phase, api, inviteEmail, baseUrl]);

  const copyText = useCallback(async (value: string, which: 'token' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(undefined), 2000);
    } catch { /* 剪贴板被拒：token 仍完整显示，可手动选中。 */ }
  }, []);

  const panelLabels = useMemo(() => ({
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
  }), [t]);

  const consentLabels = useMemo(() => ({
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
  }), [t]);

  const shareKeyEntry = phase.kind === 'panel' ? getShareKeyEntry(localStorage, phase.shareId) : undefined;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: cssVar('color.overlay'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: cssVar('space.4'),
        zIndex: cssVar('z.modal'),
      }}
      data-testid="share-dialog-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ht-share-title"
        data-testid="share-dialog"
        style={{
          width: '100%',
          maxWidth: cssVar('layout.modal-max'),
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: cssVar('space.4'),
          background: cssVar('color.surface-raised'),
          borderRadius: cssVar('radius.lg'),
          boxShadow: cssVar('shadow.lg'),
          padding: cssVar('space.6'),
          color: cssVar('color.foreground'),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: cssVar('space.3') }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="ht-share-title" style={{ margin: 0, ...text('section-title') }}>
              {t('web.share.dialog.title')}
            </h2>
            <p style={{ margin: `${cssVar('space.1')} 0 0`, ...text('row-meta'), color: cssVar('color.foreground-muted') }}>
              {t('web.share.dialog.subtitle')}
            </p>
          </div>
          <button
            type="button"
            data-testid="share-dialog-close"
            aria-label={t('web.share.dialog.close')}
            className="ht-btn ht-btn--ghost"
            onClick={onClose}
          >
            <X size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        </div>

        {needsUnlock ? (
          <p role="status" data-testid="share-needs-unlock" style={{ margin: 0, ...text('row-title') }}>
            {t('web.share.needUnlock')}
          </p>
        ) : null}

        {phase.kind === 'consent' ? (
          <>
            {creatingError !== undefined ? (
              <p role="alert" data-testid="share-create-error" style={{ margin: 0, ...text('row-title'), color: cssVar('color.danger') }}>
                {t('web.share.error.create', { message: creatingError })}
              </p>
            ) : null}
            {api === undefined ? (
              <p role="alert" data-testid="share-offline" style={{ margin: 0, ...text('row-title') }}>
                {t('web.share.error.offline')}
              </p>
            ) : (
              <ShareConsentModal
                labels={consentLabels}
                store={consentStore}
                onConsent={(next) => {
                  setConsentStore(next);
                  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(next));
                }}
                onProceed={() => { void createShare(); }}
                onCancel={onClose}
              />
            )}
          </>
        ) : null}

        {phase.kind === 'creating' ? (
          <p role="status" data-testid="share-creating" style={{ margin: 0, ...text('row-title') }}>
            {t('web.share.creating')}
          </p>
        ) : null}

        {phase.kind === 'not-a-member' ? (
          <p role="status" data-testid="share-not-member" style={{ margin: 0, ...text('row-title') }}>
            {t('web.share.notMember')}
          </p>
        ) : null}

        {phase.kind === 'panel' && api !== undefined && detail !== undefined ? (
          <>
            {detail.yourRole === 'owner' ? (
              <form
                data-testid="share-invite-form"
                style={{ display: 'flex', flexDirection: 'column', gap: cssVar('space.2') }}
                onSubmit={(e) => { e.preventDefault(); void submitInvite(); }}
              >
                <label htmlFor="ht-share-invite-email" style={{ ...text('row-title') }}>
                  {t('web.share.invite.emailLabel')}
                </label>
                <input
                  id="ht-share-invite-email"
                  type="email"
                  value={inviteEmail}
                  placeholder={t('web.share.invite.emailPlaceholder')}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  data-testid="share-invite-email"
                  style={{
                    padding: cssVar('space.2'),
                    borderRadius: cssVar('radius.md'),
                    border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
                    background: cssVar('color.surface'),
                    color: cssVar('color.foreground'),
                  }}
                />
                <button type="submit" className="ht-btn ht-btn--primary" disabled={inviteBusy} data-testid="share-invite-submit">
                  {inviteBusy ? t('web.share.invite.busy') : t('web.share.invite.submit')}
                </button>
              </form>
            ) : null}

            {ticket !== undefined ? (
              <div
                data-testid="share-invite-ticket"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: cssVar('space.2'),
                  padding: cssVar('space.3'),
                  borderRadius: cssVar('radius.md'),
                  background: cssVar('color.surface'),
                  border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
                }}
              >
                <p style={{ margin: 0, ...text('row-title') }}>{t('web.share.invite.ticketTitle')}</p>
                <code
                  data-testid="share-invite-token"
                  style={{ ...text('row-meta'), wordBreak: 'break-all', padding: cssVar('space.2'), background: cssVar('color.surface-subtle'), borderRadius: cssVar('radius.sm') }}
                >
                  {ticket.token}
                </code>
                <div style={{ display: 'flex', gap: cssVar('space.2'), flexWrap: 'wrap' }}>
                  <button type="button" className="ht-btn ht-btn--ghost" data-testid="share-invite-copy-token" onClick={() => { void copyText(ticket.token, 'token'); }}>
                    {copied === 'token' ? t('web.share.invite.copied') : t('web.share.invite.copyToken')}
                  </button>
                  <button type="button" className="ht-btn ht-btn--ghost" data-testid="share-invite-copy-link" onClick={() => { void copyText(ticket.link, 'link'); }}>
                    {copied === 'link' ? t('web.share.invite.copied') : t('web.share.invite.copyLink')}
                  </button>
                </div>
                <p style={{ margin: 0, ...text('row-meta'), color: cssVar('color.foreground-muted') }}>
                  {t('web.share.invite.ticketNote')}
                </p>
              </div>
            ) : null}

            <SharePanel
              data={{
                shareId: phase.shareId,
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
                selfMemberId: shareKeyEntry?.ownMemberId,
              }}
              labels={panelLabels}
              callbacks={{
                onInvite: () => { /* 邀请表单常驻上方；这个入口指向它。 */ const el = document.getElementById('ht-share-invite-email'); el?.focus(); },
                onRemoveMember: (memberId) => {
                  void api.removeMember(phase.shareId, memberId).then(() => reload(phase.shareId));
                },
                onRoleChange: (memberId, role) => {
                  void api.patchMemberRole(phase.shareId, memberId, role).then(() => reload(phase.shareId));
                },
              }}
            />

            {detail.yourRole !== 'owner' ? (
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                data-testid="share-leave"
                style={{ color: cssVar('color.danger') }}
                onClick={() => {
                  void (async () => {
                    await api.leaveShare(phase.shareId);
                    deleteShareKey(localStorage, phase.shareId);
                    // 成员端离开：本地的这条清单一并移除（它是加入时建的那行）。
                    await useProjectStore.getState().deleteProject(projectId);
                    onClose();
                  })();
                }}
              >
                {t('web.share.leave')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
