/**
 * `JoinSharedListDialog` —— 被邀请者入群（贴 token / 链接 → 拿到同一把清单密钥）。
 * ================================================================================
 *
 * 旅程（成员侧半程）：
 *   贴 token → `acceptInvitation`（带封装公钥）→ 身份种子 vault 落盘 →
 *   等 owner 下发信封（owner 端面板开着时自动补发）→ 解出 listKey 落盘 →
 *   本地建清单行（挂 `shareId`）→ 侧栏出现这条清单。
 *
 * 🔴 **等待 owner 是如实显示的**：接受邀请成功 ≠ 立刻有密钥——E2EE 下
 *    listKey 只能由 owner 封给你。对话框轮询成员表里自己的信封，拿到才收口；
 *    拿不到就一直显示「等待所有者分发密钥」（可以关掉，之后再从清单头部进）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { parseShareJoinLink } from '@heyta/ui';

import { useSyncStore } from '../sync/store.js';
import { useProjectStore } from '../projects/store.js';
import { getWebVaultSession } from '../../lib/vault-session.js';
import { text } from '../../lib/text.js';
import {
  unwrapShareIdentitySeed,
  storeShareIdentity,
  wrapAndStoreShareKey,
} from './share-key-store.js';

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

export interface JoinSharedListDialogProps {
  onClose: () => void;
  /** 入群成功后宿主导航到那条清单（App 的 `goToFilter`）。 */
  onJoined?: (projectId: string) => void;
}

type JoinPhase =
  | { kind: 'input' }
  | { kind: 'accepting' }
  | { kind: 'waiting-key'; shareId: string; memberId: string }
  | { kind: 'done'; projectId: string }
  | { kind: 'error'; message: string };

export function JoinSharedListDialog(props: JoinSharedListDialogProps) {
  const { onClose, onJoined } = props;
  const { t } = useI18n();

  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const accountId = useSyncStore((s) => s.accountId);

  const [phase, setPhase] = useState<JoinPhase>({ kind: 'input' });
  const [inputValue, setInputValue] = useState('');
  const [listName, setListName] = useState('');
  const [needsUnlock, setNeedsUnlock] = useState(false);
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

  useEffect(() => () => { if (pollRef.current !== undefined) window.clearInterval(pollRef.current); }, []);

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
      const existing = useProjectStore.getState().projects.find((p) => p.shareId === shareId && p.deletedAt === undefined);
      let projectId = existing?.id;
      if (projectId === undefined) {
        const name = listName.trim() === '' ? t('web.share.join.defaultName') : listName.trim();
        projectId = await useProjectStore.getState().addProject(name) ?? undefined;
        if (projectId !== undefined) {
          await useProjectStore.getState().setProjectShare(projectId, shareId);
        }
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

  // 等待 owner 下发信封（轮询自己的成员行）。
  useEffect(() => {
    if (phase.kind !== 'waiting-key') return;
    void finalize(phase.shareId, phase.memberId);
    pollRef.current = window.setInterval(() => { void finalize(phase.shareId, phase.memberId); }, 3000);
    return () => { if (pollRef.current !== undefined) window.clearInterval(pollRef.current); };
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
      data-testid="share-join-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ht-share-join-title"
        data-testid="share-join-dialog"
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
            <h2 id="ht-share-join-title" style={{ margin: 0, ...text('section-title') }}>
              {t('web.share.join.title')}
            </h2>
            <p style={{ margin: `${cssVar('space.1')} 0 0`, ...text('row-meta'), color: cssVar('color.foreground-muted') }}>
              {t('web.share.join.subtitle')}
            </p>
          </div>
          <button
            type="button"
            data-testid="share-join-close"
            aria-label={t('web.share.dialog.close')}
            className="ht-btn ht-btn--ghost"
            onClick={onClose}
          >
            <X size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        </div>

        {needsUnlock ? (
          <p role="status" data-testid="share-join-needs-unlock" style={{ margin: 0, ...text('row-title') }}>
            {t('web.share.needUnlock')}
          </p>
        ) : null}

        {phase.kind === 'input' || phase.kind === 'error' ? (
          <form
            data-testid="share-join-form"
            style={{ display: 'flex', flexDirection: 'column', gap: cssVar('space.2') }}
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
          >
            {phase.kind === 'error' ? (
              <p role="alert" data-testid="share-join-error" style={{ margin: 0, ...text('row-title'), color: cssVar('color.danger') }}>
                {phase.message}
              </p>
            ) : null}
            <label htmlFor="ht-share-join-token" style={{ ...text('row-title') }}>
              {t('web.share.join.tokenLabel')}
            </label>
            <input
              id="ht-share-join-token"
              value={inputValue}
              placeholder={t('web.share.join.tokenPlaceholder')}
              onChange={(e) => setInputValue(e.target.value)}
              data-testid="share-join-token"
              style={{
                padding: cssVar('space.2'),
                borderRadius: cssVar('radius.md'),
                border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
                background: cssVar('color.surface'),
                color: cssVar('color.foreground'),
              }}
            />
            <label htmlFor="ht-share-join-name" style={{ ...text('row-title') }}>
              {t('web.share.join.nameLabel')}
            </label>
            <input
              id="ht-share-join-name"
              value={listName}
              placeholder={t('web.share.join.namePlaceholder')}
              onChange={(e) => setListName(e.target.value)}
              data-testid="share-join-name"
              style={{
                padding: cssVar('space.2'),
                borderRadius: cssVar('radius.md'),
                border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
                background: cssVar('color.surface'),
                color: cssVar('color.foreground'),
              }}
            />
            <button type="submit" className="ht-btn ht-btn--primary" data-testid="share-join-submit">
              {t('web.share.join.submit')}
            </button>
          </form>
        ) : null}

        {phase.kind === 'accepting' ? (
          <p role="status" data-testid="share-join-accepting" style={{ margin: 0, ...text('row-title') }}>
            {t('web.share.join.accepting')}
          </p>
        ) : null}

        {phase.kind === 'waiting-key' ? (
          <p role="status" data-testid="share-join-waiting" style={{ margin: 0, ...text('row-title') }}>
            {t('web.share.join.waitingKey')}
          </p>
        ) : null}

        {phase.kind === 'done' ? (
          <>
            <p role="status" data-testid="share-join-done" style={{ margin: 0, ...text('row-title') }}>
              {t('web.share.join.done')}
            </p>
            <button type="button" className="ht-btn ht-btn--primary" data-testid="share-join-close-final" onClick={onClose}>
              {t('web.share.dialog.close')}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
