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
import { createWebAuthFetch } from '../../lib/central-fetch.js';
import { text } from '../../lib/text.js';
import { forgetShareLocally } from '@heyta/app-host';
import { clearStorageShareLog } from './comment-actions.js';
import { createWebShareKeyRotation } from './share-rotation.js';
import {
  getShareKeyEntry,
  deleteShareKey,
  unwrapShareListKey,
  wrapAndStoreShareKey,
} from './share-key-store.js';

/**
 * 本视图的样式：**模块级常量**，不再写成 `style={{…}}` 内联对象。
 *
 * 🔴 依据 `scripts/check-l4-no-style.mjs` 的断言 C：L4 视图
 * （`apps/web/src/features/**`，除 `shell`）的内联样式**只减不增**。
 * 内联对象每次渲染都新建、也拿不到浏览器对静态样式的缓存；而这些取值全部
 * 是常量（`cssVar()` / `text()` 都是模块加载期可求值的纯函数），没有任何
 * 依赖 props/state 的项 —— 所以它们本来就该住在模块级。
 *
 * ⚠️ 取值仍然是 `cssVar('…')`，**没有引入任何裸值**：断言 A/B
 * （`check:l4`）与 `check:design` 照旧盯着这些行（搬位置不改变字面量）。
 */
const styles = {
  /** 遮罩：铺满视口、居中卡片、吃掉所有点击（点空白处关闭）。 */
  overlay: {
    position: 'fixed',
    inset: 0,
    background: cssVar('color.overlay'),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: cssVar('space.4'),
    zIndex: cssVar('z.modal'),
  },
  dialog: {
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
  },
  headRow: { display: 'flex', alignItems: 'flex-start', gap: cssVar('space.3') },
  headText: { flex: 1, minWidth: 0 },
  /** 对话框自己的页标题（不是整页标题，所以走 `section-title`）。 */
  dialogTitle: { margin: 0, ...text('section-title') },
  dialogSubtitle: {
    margin: `${cssVar('space.1')} 0 0`,
    ...text('row-meta'),
    color: cssVar('color.foreground-muted'),
  },
  /** `<p>` 的默认外边距必须抹掉 —— 否则每一条状态句都会把卡片撑开一段。 */
  resetTitle: { margin: 0, ...text('row-title') },
  resetTitleDanger: { margin: 0, ...text('row-title'), color: cssVar('color.danger') },
  inviteForm: { display: 'flex', flexDirection: 'column', gap: cssVar('space.2') },
  labelTitle: { ...text('row-title') },
  input: {
    padding: cssVar('space.2'),
    borderRadius: cssVar('radius.md'),
    border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
    background: cssVar('color.surface'),
    color: cssVar('color.foreground'),
  },
  /** 邀请票据块：与成员面板同一个表面，包一圈边框。 */
  ticket: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space.2'),
    padding: cssVar('space.3'),
    borderRadius: cssVar('radius.md'),
    background: cssVar('color.surface'),
    border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
  },
  /**
   * token / 链接的等宽展示块。`break-all` 是必须的：那串 token 没有空格，
   * 不换行就会把对话框撑出横向滚动条（用户根本复制不到尾部）。
   */
  code: {
    ...text('row-meta'),
    wordBreak: 'break-all',
    padding: cssVar('space.2'),
    background: cssVar('color.surface-subtle'),
    borderRadius: cssVar('radius.sm'),
  },
  resetMeta: { margin: 0, ...text('row-meta'), color: cssVar('color.foreground-muted') },
  actionsRow: { display: 'flex', gap: cssVar('space.2'), flexWrap: 'wrap' },
  dangerText: { color: cssVar('color.danger') },
} as const;

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
  const authTransport = useSyncStore((s) => s.authTransport);
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
    return new ShareApiClient({ baseUrl, getToken: () => token, authTransport, fetchImpl: createWebAuthFetch(baseUrl, authTransport) });
  }, [authTransport, baseUrl, token]);

  const getPayloadCipher = useCallback(async (): Promise<SyncPayloadCipher | undefined> => {
    if (accountId === undefined || accountId === '') return undefined;
    const session = await getWebVaultSession(accountId, baseUrl, async () => token, authTransport);
    return session.getPayloadCipher();
  }, [accountId, authTransport, baseUrl, token]);

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
        // 🔴 服务端说"你不是这份共享的人了"（被移除 / 被转让后自己不是 owner 了）：
        // 本机的密钥与那份折叠出来的日志就不该再留着——它们装的是**别人写的评论**。
        // 只清共享域的数据（密钥 + 日志 + 游标），本地那行清单留给 M2 的路由一起处理。
        forgetShareLocally(
          { dropKey: () => { deleteShareKey(localStorage, shareId); }, dropShareData: () => { clearStorageShareLog(localStorage, shareId); } },
          shareId,
        );
        setPhase({ kind: 'not-a-member' });
      }
    }
  }, [api]);

  // owner 端自动信封下发：成员已入群但还没钥（hasEnvelope=false / 世代落后）
  // ⇒ 只要我是 owner 且解得出 listKey，就补封。这是"被邀请者无感知拿到密钥"的那一跳。
  //
  // 🔴 信封上的世代 = **本机这把钥自己的世代**，不是服务端那个号（M3 纪律 1）。
  // 按 `detail.keyEpoch` 贴标在换钥之前看不出错（两者总是相等），换钥之后就变成
  // "把 epoch2 的钥贴成 epoch1 发给所有人"——全员解不开新内容，而面板显示"密钥已下发"。
  // 所以本机落后时先**收**（owner 在别的设备上换过钥，他自己的信封就在服务端的行里），
  // 收到之后再把那把该发的发出去。
  const autoSeal = useCallback(async (shareId: string) => {
    if (api === undefined || detail?.yourRole !== 'owner') return;
    const cipher = await getPayloadCipher();
    if (cipher === undefined) { setNeedsUnlock(true); return; }
    const rotation = createWebShareKeyRotation({
      baseUrl, token: token ?? '', authTransport, vaultCipher: cipher, storage: localStorage,
    });
    if (rotation !== undefined) {
      try { await rotation.adoptRotatedShareKey(shareId); } catch { /* 解不开就照本机这把继续，下一轮再对账 */ }
    }
    const entry = getShareKeyEntry(localStorage, shareId);
    if (entry === undefined || entry.keyEpoch < 1) return;
    const listKey = await unwrapShareListKey({ storage: localStorage, cipher, shareId });
    if (listKey === undefined) { setNeedsUnlock(true); return; }
    for (const m of members) {
      if (m.keyEnvelope !== null && m.keyEnvelope !== undefined && m.memberKeyEpoch >= entry.keyEpoch) continue;
      if (m.identityPublicKey === null || m.identityPublicKey === undefined) continue;
      try {
        const envelope = await sealListKeyForRecipient({
          listKey, shareId, keyEpoch: entry.keyEpoch,
          recipientX25519PublicKey: fromBase64(m.identityPublicKey),
        });
        await api.putMemberEnvelope(shareId, m.memberId, { keyEpoch: entry.keyEpoch, keyEnvelope: envelope });
      } catch { /* 单个成员失败不拖垮整轮；下一轮 reload 再试。 */ }
    }
  }, [api, authTransport, baseUrl, detail?.yourRole, getPayloadCipher, members, token]);

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
    void autoSeal(phase.shareId);
  }, [phase, detail, members, autoSeal]);

  // ── 移除成员（owner）：一次点击 = 移除 + 当场换钥（M3 的一个用户意图）────────
  // 🔴 这两半不能拆开做。只移除不换钥，人走了、他手里那把钥仍然解得开你们以后写的内容；
  // 判断与顺序都在 `@heyta/app-host` 的 `removeMemberAndRekey` 里，这里只负责"接不上就说是接不上"。
  const removeMember = useCallback(async (memberId: string) => {
    if (phase.kind !== 'panel') return;
    const cipher = await getPayloadCipher();
    if (cipher === undefined) { setNeedsUnlock(true); return; }
    const rotation = createWebShareKeyRotation({
      baseUrl, token: token ?? '', authTransport, vaultCipher: cipher, storage: localStorage,
    });
    if (rotation === undefined) { setCreatingError(t('web.share.error.offline')); return; }
    try {
      const reading = await rotation.removeMemberAndRekey(phase.shareId, memberId);
      // 人已经移走了，换钥失败就不能报"移除失败"——但也不能不说（下一轮之前这份清单还在用旧钥写）。
      if (reading.rekeyError !== undefined) setCreatingError(reading.rekeyError);
    } catch (err) {
      setCreatingError(err instanceof ShareApiError ? `${String(err.status)} ${err.code ?? ''}` : String(err));
    }
    await reload(phase.shareId);
  }, [authTransport, baseUrl, getPayloadCipher, phase, reload, t, token]);

  // ── 邀请（owner）───────────────────────────────────────────────────────────
  /** 应用自己的可分享地址（W6 链接落点）：朋友点链接该落进**应用**的入群旅程，
   *  而不是同步服务器上一个不存在的页面。`BASE_URL` 让挂在子路径（如 `/app/`）
   *  的部署也拼对。 */
  const appBaseUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;

  const submitInvite = useCallback(async () => {
    if (phase.kind !== 'panel' || api === undefined) return;
    setInviteBusy(true);
    try {
      const email = inviteEmail.trim() === '' ? undefined : inviteEmail.trim();
      const res = await api.createInvitation(phase.shareId, email === undefined ? {} : { invitedEmail: email });
      setTicket({ token: res.token, link: buildShareJoinLink(appBaseUrl, res.token), invitedEmail: email ?? '' });
      setInviteEmail('');
    } catch (err) {
      setCreatingError(err instanceof ShareApiError ? `${err.status} ${err.code ?? ''}` : String(err));
    } finally {
      setInviteBusy(false);
    }
  }, [phase, api, inviteEmail, appBaseUrl]);

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
    // 转让所有权（W6）：确认句在词条里就说清「转让者降为可编辑」的后果。
    transfer: {
      button: t('web.share.transfer.button'),
      confirmHint: t('web.share.transfer.confirmHint'),
      confirm: t('web.share.transfer.confirm'),
      cancel: t('web.share.transfer.cancel'),
    },
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
      style={styles.overlay}
      data-testid="share-dialog-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ht-share-title"
        data-testid="share-dialog"
        style={styles.dialog}
      >
        <div style={styles.headRow}>
          <div style={styles.headText}>
            <h2 id="ht-share-title" style={styles.dialogTitle}>
              {t('web.share.dialog.title')}
            </h2>
            <p style={styles.dialogSubtitle}>
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
          <p role="status" data-testid="share-needs-unlock" style={styles.resetTitle}>
            {t('web.share.needUnlock')}
          </p>
        ) : null}

        {phase.kind === 'consent' ? (
          <>
            {creatingError !== undefined ? (
              <p role="alert" data-testid="share-create-error" style={styles.resetTitleDanger}>
                {t('web.share.error.create', { message: creatingError })}
              </p>
            ) : null}
            {api === undefined ? (
              <p role="alert" data-testid="share-offline" style={styles.resetTitle}>
                {t('web.share.error.offline')}
              </p>
            ) : (
              <ShareConsentModal
                labels={consentLabels}
                store={consentStore}
                // 这个对话框顶部 `<h2>` 写的就是同一句「共享清单」
                // （`web.share.dialog.title` 与 `common.share.consent.title` 同文），
                // 再画一遍会在同屏出现两个同名标题。
                titleHidden
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
          <p role="status" data-testid="share-creating" style={styles.resetTitle}>
            {t('web.share.creating')}
          </p>
        ) : null}

        {phase.kind === 'not-a-member' ? (
          <p role="status" data-testid="share-not-member" style={styles.resetTitle}>
            {t('web.share.notMember')}
          </p>
        ) : null}

        {phase.kind === 'panel' && api !== undefined && detail !== undefined ? (
          <>
            {detail.yourRole === 'owner' ? (
              <form
                data-testid="share-invite-form"
                style={styles.inviteForm}
                onSubmit={(e) => { e.preventDefault(); void submitInvite(); }}
              >
                <label htmlFor="ht-share-invite-email" style={styles.labelTitle}>
                  {t('web.share.invite.emailLabel')}
                </label>
                <input
                  id="ht-share-invite-email"
                  type="email"
                  value={inviteEmail}
                  placeholder={t('web.share.invite.emailPlaceholder')}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  data-testid="share-invite-email"
                  style={styles.input}
                />
                <button type="submit" className="ht-btn ht-btn--primary" disabled={inviteBusy} data-testid="share-invite-submit">
                  {inviteBusy ? t('web.share.invite.busy') : t('web.share.invite.submit')}
                </button>
              </form>
            ) : null}

            {ticket !== undefined ? (
              <div
                data-testid="share-invite-ticket"
                style={styles.ticket}
              >
                <p style={styles.resetTitle}>{t('web.share.invite.ticketTitle')}</p>
                <code
                  data-testid="share-invite-token"
                  style={styles.code}
                >
                  {ticket.token}
                </code>
                {/* 链接与 token 同样明文展示（W6 落点）：剪贴板被拒/接收方要手动转发时，
                    用户要能看见并选中这条链接本身 —— 与 token 的处理同一条理由。 */}
                <p style={styles.resetMeta}>
                  {t('web.share.invite.linkTitle')}
                </p>
                <code
                  data-testid="share-invite-link"
                  style={styles.code}
                >
                  {ticket.link}
                </code>
                <div style={styles.actionsRow}>
                  <button type="button" className="ht-btn ht-btn--ghost" data-testid="share-invite-copy-token" onClick={() => { void copyText(ticket.token, 'token'); }}>
                    {copied === 'token' ? t('web.share.invite.copied') : t('web.share.invite.copyToken')}
                  </button>
                  <button type="button" className="ht-btn ht-btn--ghost" data-testid="share-invite-copy-link" onClick={() => { void copyText(ticket.link, 'link'); }}>
                    {copied === 'link' ? t('web.share.invite.copied') : t('web.share.invite.copyLink')}
                  </button>
                </div>
                <p style={styles.resetMeta}>
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
                onRemoveMember: (memberId) => { void removeMember(memberId); },
                onRoleChange: (memberId, role) => {
                  void api.patchMemberRole(phase.shareId, memberId, role).then(() => reload(phase.shareId));
                },
                // 转让所有权（W6）：服务端事务里 ownerUserId 与两条成员行一起换，
                // 客户端只管发起 + 对账（reload 后自己的角色就是 editor 了）。
                onTransferOwnership: (memberId) => {
                  void api.transferOwnership(phase.shareId, memberId).then(() => reload(phase.shareId));
                },
              }}
            />

            {detail.yourRole !== 'owner' ? (
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                data-testid="share-leave"
                style={styles.dangerText}
                onClick={() => {
                  void (async () => {
                    await api.leaveShare(phase.shareId);
                    // 🔴 离场要把共享域的三件都清掉（密钥 + 日志 + 游标）。只删钥，
                    // 本机那份折叠出来的评论日志还留在 localStorage 里读得到。
                    forgetShareLocally(
                      { dropKey: () => { deleteShareKey(localStorage, phase.shareId); }, dropShareData: () => { clearStorageShareLog(localStorage, phase.shareId); } },
                      phase.shareId,
                    );
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
