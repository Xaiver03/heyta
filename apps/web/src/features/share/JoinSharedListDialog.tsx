/**
 * `JoinSharedListDialog` —— 被邀请者入群（贴 token / 链接 → 拿到同一把清单密钥）。
 * ================================================================================
 *
 * 旅程（成员侧半程）：
 *   同意闸（PIPL 23；判断与界面都在 `@heyta/ui`，本壳只落盘）→
 *   贴 token → `acceptInvitation`（带封装公钥）→ 身份种子 vault 落盘 →
 *   等 owner 下发信封（owner 端面板开着时自动补发）→ 解出 listKey 落盘 →
 *   本地建清单行（挂 `shareId`）→ 侧栏出现这条清单。
 *
 * 🔴 **入群这一侧也要过同意闸**：通知路径读的就是这份本地同意
 *    （`use-share-activity-signal.ts`），而它过去只有 owner 那一屏会写 ⇒
 *    一台只走过「贴链接入群」的浏览器永远没有同意记录，按 fail-closed 的口径
 *    它就一条共享活动都收不到。移动端早就是这道闸在前，这里与它同形。
 *
 * 🔴 **等待 owner 是如实显示的**：接受邀请成功 ≠ 立刻有密钥——E2EE 下
 *    listKey 只能由 owner 封给你。对话框轮询成员表里自己的信封，拿到才收口；
 *    拿不到就一直显示「等待所有者分发密钥」（可以关掉，之后再从清单头部进）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { cssVar, ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import {
  generateShareIdentitySeed,
  deriveShareIdentityKeyPair,
  openListKeyEnvelope,
  type ShareMemberKeyEnvelope,
} from '@heyta/sync-core';
import { ShareApiClient, ShareApiError, type SyncPayloadCipher } from '@heyta/sync-client';
import { parseShareJoinLink, ShareConsentModal, shouldShowConsent, type ShareConsentStore } from '@heyta/ui';

import { useSyncStore } from '../sync/store.js';
import { registerShareRosterTarget } from '../../lib/share-signal-sink.js';
import { useProjectStore } from '../projects/store.js';
import { getWebVaultSession } from '../../lib/vault-session.js';
import { createWebAuthFetch } from '../../lib/central-fetch.js';
import { text } from '../../lib/text.js';
import { useDirtyDismissGuard } from '../../lib/form/useDirtyDismissGuard.js';
import {
  unwrapShareIdentitySeed,
  storeShareIdentity,
  wrapAndStoreShareKey,
} from './share-key-store.js';
import { loadShareConsent, saveShareConsent } from './share-consent-store.js';

/**
 * 本视图的样式：**模块级常量**，不再写成 `style={{…}}` 内联对象。
 *
 * 🔴 依据 `scripts/check-l4-no-style.mjs` 的断言 C：L4 视图
 * （`apps/web/src/features/**`，除 `shell`）的内联样式**只减不增**。
 * 这里每一处取值都是常量（`cssVar()` / `text()` 都是模块加载期可求值的
 * 纯函数），没有任何依赖 props/state 的项 —— 内联对象只会让它们每次渲染
 * 重建一遍，所以本来就该住在模块级。
 *
 * ⚠️ 取值仍是 `cssVar('…')` / `text('…')`，**没有引入任何裸值**：
 * `check:l4` 的断言 A/B 与 `check:design` 照旧盯着这些行（搬位置不改字面量）。
 */
const styles = {
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
  dialogTitle: { margin: 0, ...text('section-title') },
  dialogSubtitle: {
    margin: `${cssVar('space.1')} 0 0`,
    ...text('row-meta'),
    color: cssVar('color.foreground-muted'),
  },
  /** `<p>` 的默认外边距必须抹掉 —— 否则每一条状态句都会把卡片撑开一段。 */
  resetTitle: { margin: 0, ...text('row-title') },
  resetTitleDanger: { margin: 0, ...text('row-title'), color: cssVar('color.danger') },
  form: { display: 'flex', flexDirection: 'column', gap: cssVar('space.2') },
  labelTitle: { ...text('row-title') },
  input: {
    padding: cssVar('space.2'),
    borderRadius: cssVar('radius.md'),
    border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
    background: cssVar('color.surface'),
    color: cssVar('color.foreground'),
  },
} as const;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

export interface JoinSharedListDialogProps {
  onClose: () => void;
  /** 入群成功后宿主导航到那条清单（App 的 `goToFilter`）。 */
  onJoined?: (projectId: string) => void;
  /**
   * 预填的入群凭证（token 或整条链接）：分享链接 `?shareToken=` 落进应用时由
   * 宿主传入（W6 链接落点）。用户仍可改——预填只是把"贴 token"这一步省掉。
   */
  initialToken?: string;
}

type JoinPhase =
  | { kind: 'consent' }
  | { kind: 'input' }
  | { kind: 'accepting' }
  | { kind: 'waiting-key'; shareId: string; memberId: string }
  | { kind: 'done'; projectId: string }
  | { kind: 'error'; message: string };

export function JoinSharedListDialog(props: JoinSharedListDialogProps) {
  const { onClose, onJoined, initialToken } = props;
  const { t } = useI18n();

  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const authTransport = useSyncStore((s) => s.authTransport);
  const accountId = useSyncStore((s) => s.accountId);

  // 同意闸 fail-closed：本机没确认过 ⇒ 先弹（判断在 `@heyta/ui`，与移动端入群屏同一份）。
  const [phase, setPhase] = useState<JoinPhase>(() =>
    shouldShowConsent(loadShareConsent(localStorage)).show ? { kind: 'consent' } : { kind: 'input' },
  );
  const [consentStore, setConsentStore] = useState<ShareConsentStore>(() => loadShareConsent(localStorage));
  const [inputValue, setInputValue] = useState(initialToken ?? '');
  const [listName, setListName] = useState('');
  const [needsUnlock, setNeedsUnlock] = useState(false);
  /* 🔴 令牌 / 清单名住在组件本地 state，关掉即丢 ⇒ 三条通道先问一句。
     判脏**分相位**：只有 `input` / `error` 这两格场上有可丢的东西；
     `consent`（还没开始打）与 `done`（已经加进去了）都拦一道确认，
     就是把成本摊给每一次正常操作。 */
  const { requestDismiss, guard } = useDirtyDismissGuard({
    overlay: 'modal-dirty-form',
    isDirty: () =>
      (phase.kind === 'input' || phase.kind === 'error')
      && (inputValue.trim() !== '' || listName.trim() !== ''),
    onDismiss: onClose,
  });
  const creatingRef = useRef<Set<string>>(new Set());

  const api = useMemo(() => {
    if (baseUrl.trim() === '' || token === undefined || token.trim() === '') return undefined;
    return new ShareApiClient({ baseUrl, getToken: () => token, authTransport, fetchImpl: createWebAuthFetch(baseUrl, authTransport) });
  }, [authTransport, baseUrl, token]);

  const getPayloadCipher = useCallback(async (): Promise<SyncPayloadCipher | undefined> => {
    if (accountId === undefined || accountId === '') return undefined;
    const session = await getWebVaultSession(accountId, baseUrl, async () => token, authTransport);
    return session.getPayloadCipher();
  }, [accountId, authTransport, baseUrl, token]);

  const consentLabels = useMemo(() => ({
    title: t('common.share.consent.title.join'),
    body: t('common.share.consent.body.join'),
    detailsLabel: t('common.share.consent.details.label'),
    details: [
      t('common.share.consent.scope.content'),
      t('common.share.consent.scope.server'),
      t('common.share.consent.scope.e2ee'),
      t('common.share.consent.scope.notAffected'),
    ],
    dontAskAgain: t('common.share.consent.dontAskAgain'),
    accept: t('common.share.consent.accept.join'),
    cancel: t('common.share.consent.cancel'),
  }), [t]);

  // 拿到信封 ⇒ 解钥 ⇒ 建本地清单行 ⇒ 收口。
  const finalize = useCallback(async (shareId: string, memberId: string) => {
    if (api === undefined) return;
    const cipher = await getPayloadCipher();
    if (cipher === undefined) { setNeedsUnlock(true); return; }
    try {
      const members = await api.listMembers(shareId);
      const own = members.members.find((m) => m.memberId === memberId);
      if (own?.keyEnvelope == null) return; // 还没轮到：继续等。
      const seed = await unwrapShareIdentitySeed({ storage: localStorage, cipher, shareId });
      if (seed === undefined) { setNeedsUnlock(true); return; }
      const identity = deriveShareIdentityKeyPair(seed);
      const listKey = await openListKeyEnvelope({
        // 客户端类型把线上的信封放宽成 unknown（防御 JSON 边界）；这里它来自
        // 本账号自己的成员行，形状由服务端写、`openListKeyEnvelope` 自己再校。
        envelope: own.keyEnvelope as ShareMemberKeyEnvelope,
        recipientX25519SecretKey: identity.x25519SecretKey,
      });
      const detail = await api.shareDetail(shareId);
      // 换钥（世代>1）后同样走这里：listKey 覆盖为当前世代。
      await wrapAndStoreShareKey({
        storage: localStorage, cipher, shareId, listKey,
        keyEpoch: detail.keyEpoch,
        identitySeed: seed,
        ownMemberId: memberId,
      });
      // 已有挂这条 share 的本地清单（比如以前加入过）就不重复建。
      // 🔴 这一段必须对同一条 share 独占：本地清单行是 `addProject` + `setProjectShare`
      // 两步写，第一步刚写完时那一行还没有 `shareId`，下面的 `existing` 判据看不见它 ⇒
      // 两个 finalize 同时在跑就会各建一行（2026-10-22 旅程实测：侧栏两行同名清单）。
      // 为什么会同时在跑：本函数由 `waiting-key` 那个 effect 既**立即调一次**又**每 3 秒调一次**，
      // 而 effect 依赖里有 `finalize` 自己 —— 它的身份一变（父组件换 `onJoined`、locale 换 `t`）
      // 就又立即调一次，不排队。
      if (creatingRef.current.has(shareId)) return;
      creatingRef.current.add(shareId);
      let projectId: string | undefined;
      try {
        const existing = useProjectStore.getState().projects.find((p) => p.shareId === shareId && p.deletedAt === undefined);
        projectId = existing?.id;
        if (projectId === undefined) {
          const name = listName.trim() === '' ? t('web.share.join.defaultName') : listName.trim();
          projectId = await useProjectStore.getState().addProject(name) ?? undefined;
          if (projectId !== undefined) {
            await useProjectStore.getState().setProjectShare(projectId, shareId);
          }
        }
      } finally {
        creatingRef.current.delete(shareId);
      }
      if (projectId !== undefined) {
        setPhase({ kind: 'done', projectId });
        onJoined?.(projectId);
      }
    } catch (err) {
      if (err instanceof ShareApiError && (err.status === 403 || err.status === 404)) {
        setPhase({ kind: 'error', message: t('web.share.join.notMember') });
      }
    }
  }, [api, getPayloadCipher, listName, onJoined, t]);

  // 等待 owner 下发信封：由 `share_roster_changed` 驱动（ADR-0070），不再每 3s 打一次。
  // 🔴 这一节是**新成员的清单行还没建起来**的那段时间 —— 闸门只认清单行绑定的话
  // 这条信号会被判成"本机不认得"而丢掉，人永远停在等待页。垫片因此把
  // "本机登记着的 target"也算进认得的那一集（见 share-signal-sink 第三条通道）。
  useEffect(() => {
    if (phase.kind !== 'waiting-key') return;
    void finalize(phase.shareId, phase.memberId);
    return registerShareRosterTarget(phase.shareId, async () => { await finalize(phase.shareId, phase.memberId); });
  }, [phase, finalize]);

  const submit = useCallback(async () => {
    if (api === undefined) { setPhase({ kind: 'error', message: t('web.share.error.offline') }); return; }
    const cipher = await getPayloadCipher();
    if (cipher === undefined) { setNeedsUnlock(true); return; }
    const tokenFromInput = parseShareJoinLink(inputValue) ?? inputValue.trim();
    if (tokenFromInput === '') { setPhase({ kind: 'error', message: t('web.share.join.invalidToken') }); return; }
    setPhase({ kind: 'accepting' });
    try {
      const identitySeed = generateShareIdentitySeed();
      const identity = deriveShareIdentityKeyPair(identitySeed);
      const accepted = await api.acceptInvitation({
        token: tokenFromInput,
        identityPublicKey: toBase64(identity.x25519PublicKey),
        // 同一次入群把自己的签名公钥也交上去（ADR-0069 裁决二）：少了这一格，
        // 这个人此后每一条共享 op 都会在上传边界被判「未签名」而永久拒。
        signingPublicKey: toBase64(identity.ed25519PublicKey),
      });
      await storeShareIdentity({
        storage: localStorage, cipher,
        shareId: accepted.shareId,
        identitySeed,
        ownMemberId: accepted.memberId,
      });
      setPhase({ kind: 'waiting-key', shareId: accepted.shareId, memberId: accepted.memberId });
    } catch (err) {
      if (err instanceof ShareApiError && (err.status === 409 || err.status === 404 || err.status === 410)) {
        setPhase({ kind: 'error', message: t('web.share.join.invalidToken') });
      } else {
        setPhase({ kind: 'error', message: err instanceof ShareApiError ? `${err.status} ${err.code ?? ''}` : String(err) });
      }
    }
  }, [api, getPayloadCipher, inputValue, t]);

  // 🔴 必须走 portal 挂到 body：本组件由侧栏（ProjectsPanel）挂载，而侧栏列
  // `nav.ht-sidebar` 是 `position: sticky` —— sticky **总是**创建层叠上下文，
  // 里面的 fixed + z-modal 会被困在该上下文内，整列按树序画在 `.ht-main`
  // 之前 ⇒ 对话框看得见（fixed 不被裁剪）但**点不到**（命中测试落在主内容上）。
  // 模态是应用级表面，出口与 App 根部的 ShareFeature 同层（2026-10-10 旅程首跑实测）。
  return createPortal(
    <div
      style={styles.overlay}
      data-testid="share-join-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) requestDismiss('scrim'); }}
    >
      {guard}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ht-share-join-title"
        data-testid="share-join-dialog"
        style={styles.dialog}
      >
        <div style={styles.headRow}>
          <div style={styles.headText}>
            <h2 id="ht-share-join-title" style={styles.dialogTitle}>
              {/* 同意相位换成语境键那句「加入清单」（下面 `titleHidden` 的同一句），
                  入群相位才是「加入共享清单」。 */}
              {phase.kind === 'consent'
                ? t('common.share.consent.title.join')
                : t('web.share.join.title')}
            </h2>
            {/* 同意面画的时候这句话还没有对象可指（表单还没出场），先收起来。 */}
            {phase.kind !== 'consent' ? (
              <p style={styles.dialogSubtitle}>
                {t('web.share.join.subtitle')}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            data-testid="share-join-close"
            aria-label={t('web.share.dialog.close')}
            className="ht-btn ht-btn--ghost"
            onClick={() => requestDismiss('escape')}
          >
            <X size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        </div>

        {needsUnlock ? (
          <p role="status" data-testid="share-join-needs-unlock" style={styles.resetTitle}>
            {t('web.share.needUnlock')}
          </p>
        ) : null}

        {phase.kind === 'consent' ? (
          <ShareConsentModal
            labels={consentLabels}
            store={consentStore}
            // 顶部 `<h2>` 在同意相位写的就是同一句「加入清单」，再画一遍会在同一张卡里
            // 出现两个同族标题 —— 与 owner 侧那屏同一个处置。
            titleHidden
            onConsent={(next) => {
              setConsentStore(next);
              saveShareConsent(localStorage, next);
            }}
            onProceed={() => setPhase({ kind: 'input' })}
            onCancel={onClose}
          />
        ) : null}

        {phase.kind === 'input' || phase.kind === 'error' ? (
          <form
            data-testid="share-join-form"
            style={styles.form}
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
          >
            {phase.kind === 'error' ? (
              <p role="alert" data-testid="share-join-error" style={styles.resetTitleDanger}>
                {phase.message}
              </p>
            ) : null}
            <label htmlFor="ht-share-join-token" style={styles.labelTitle}>
              {t('web.share.join.tokenLabel')}
            </label>
            <input
              id="ht-share-join-token"
              value={inputValue}
              placeholder={t('web.share.join.tokenPlaceholder')}
              onChange={(e) => setInputValue(e.target.value)}
              data-testid="share-join-token"
              style={styles.input}
            />
            <label htmlFor="ht-share-join-name" style={styles.labelTitle}>
              {t('web.share.join.nameLabel')}
            </label>
            <input
              id="ht-share-join-name"
              value={listName}
              placeholder={t('web.share.join.namePlaceholder')}
              onChange={(e) => setListName(e.target.value)}
              data-testid="share-join-name"
              style={styles.input}
            />
            <button type="submit" className="ht-btn ht-btn--primary" data-testid="share-join-submit">
              {t('web.share.join.submit')}
            </button>
          </form>
        ) : null}

        {phase.kind === 'accepting' ? (
          <p role="status" data-testid="share-join-accepting" style={styles.resetTitle}>
            {t('web.share.join.accepting')}
          </p>
        ) : null}

        {phase.kind === 'waiting-key' ? (
          <p role="status" data-testid="share-join-waiting" style={styles.resetTitle}>
            {t('web.share.join.waitingKey')}
          </p>
        ) : null}

        {phase.kind === 'done' ? (
          <>
            <p role="status" data-testid="share-join-done" style={styles.resetTitle}>
              {t('web.share.join.done')}
            </p>
            <button type="button" className="ht-btn ht-btn--primary" data-testid="share-join-close-final" onClick={onClose}>
              {t('web.share.dialog.close')}
            </button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
