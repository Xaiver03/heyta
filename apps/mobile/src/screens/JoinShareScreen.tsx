/**
 * 「加入共享清单」—— 收邀请那台设备的移动端旅程（M6-3a）
 * =============================================================================
 *
 * web 基准是 `JoinSharedListDialog.tsx`，旅程一格不少：
 *   贴口令或链接 → **同意面**（PIPL 23：共享是双向披露，收方同样要先看清楚
 *   "内容对成员可见"这件事——web 的入群框没有这一格，是移动端按任务书补的，
 *   用同一个 `ShareConsentModal`、同一批 `common.share.consent.*` 词条）→
 *   接受邀请（带身份公钥 + 签名公钥，ADR-0069 裁决二）→ 存身份、**先登记
 *   roster target 再等信封** → owner 补发的信封到 ⇒ 解 listKey 落盘 →
 *   `bindProjectShare` 建/绑本地清单行 → 收口。
 *
 * 🔴 「等 owner」这一格是**信号驱动**的（ADR-0070）：等待态一确立就
 * `registerShareRosterTarget(shareId, finalize)`，`share_roster_changed` 到 ⇒ 重试。
 * **没有轮询** —— 而"先登记再等"是这个形状里防自锁的那一半：刚入群这台设备
 * **还没有清单行绑定**，成员面闸门只认清单行的话，owner 补发信封那条信号会被
 * 判成"本机不认得"丢掉，人永远停在等待页（这条线实测踩过两次）。
 *
 * 🔴 每一步失败都**具名可见**（照 web 的词表：无效凭证 / 已不在成员列表 /
 * 需要解锁 / 没配服务端 / 状态码+错误码），不许折成"出错了"。
 *
 * ⚠️ 与系统横幅无关：这一屏不投递任何通知；共享活动的投递面装配在
 * `App.tsx` + `share/share-activity-notify.ts`（横幅今天做不到的原因写在那份文件头）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  bytesToBase64Portable,
  createProjectActions,
  getShareKeyEntryPortable,
  localRowIdForShare,
  storeShareIdentityPortable,
  unwrapShareIdentitySeedPortable,
  wrapAndStoreShareKeyPortable,
} from '@heyta/app-host';
import { deriveShareIdentityKeyPair, generateShareIdentitySeed, openListKeyEnvelope, type ShareMemberKeyEnvelope } from '@heyta/sync-core';
import { ShareApiError } from '@heyta/sync-client';
import { parseShareJoinLink, ShareConsentModal, shouldShowConsent, type ShareConsentStore } from '@heyta/ui';
import { useI18n } from '@heyta/i18n';

import { openTaskHost } from '../db/open-host';
import { loadMobileShareConsent, saveMobileShareConsent } from '../lib/share-local-store';
import { registerShareRosterTarget } from '../share/share-signals';
import { bindProjectShare } from '../share/project-share';
import { prepareMobileShareAdmin, type MobileShareAdmin } from '../share/share-admin';
import { Button, Screen, Stack, Text, TextField } from '../ui/kit';

type JoinPhase =
  | { kind: 'consent' }
  | { kind: 'input' }
  | { kind: 'accepting' }
  | { kind: 'waiting-key'; shareId: string; memberId: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export default function JoinShareScreen({
  onBack,
  onJoined,
}: {
  onBack: () => void;
  /** 收口回调（宿主用它回共享主屏；web 的 `onJoined(projectId)` 在移动端的对偶）。 */
  onJoined?: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  const [phase, setPhase] = useState<JoinPhase>(() => {
    // 同意面 fail-closed：没确认过 ⇒ 先弹（`shouldShowConsent`，判断在 `@heyta/ui`）。
    const decision = shouldShowConsent(loadMobileShareConsent());
    return decision.show ? { kind: 'consent' } : { kind: 'input' };
  });
  const [consentStore, setConsentStore] = useState<ShareConsentStore>(() => loadMobileShareConsent());
  const [consentSaveFailed, setConsentSaveFailed] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [listName, setListName] = useState('');
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const adminRef = useRef<MobileShareAdmin | undefined>(undefined);
  /**
   * 🔴 同一条 share 的 finalize **必须独占**：本地清单行是"建行 + 绑 shareId"两步写，
   * 第一步刚写完时那一行还没绑上，下面的"已有就复用"看不见它 ⇒ 两个 finalize 并发
   * 就各建一行（web 2026-10-22 旅程实测：侧栏两行同名清单）。移动端同一形状。
   */
  const creatingRef = useRef<Set<string>>(new Set());

  // ── 拿到信封 ⇒ 解钥 ⇒ 建/绑本地清单行 ⇒ 收口 ──────────────────────────────
  const finalize = useCallback(async (shareId: string, memberId: string): Promise<void> => {
    const admin = adminRef.current;
    if (admin === undefined) {
      adminRef.current = await prepareMobileShareAdmin();
    }
    const ready = adminRef.current;
    if (ready === undefined) return; // 解锁/登录后由下一次信号或重进补上
    try {
      const roster = await ready.api.listMembers(shareId);
      const own = roster.members.find((m) => m.memberId === memberId);
      if (own?.keyEnvelope == null) return; // 还没轮到：继续等（信号驱动，不轮询）。
      const seed = await unwrapShareIdentitySeedPortable({ port: ready.keyPort, cipher: ready.vaultCipher, shareId });
      if (seed === undefined) {
        setNeedsUnlock(true);
        return;
      }
      const identity = deriveShareIdentityKeyPair(seed);
      const listKey = await openListKeyEnvelope({
        // 线上信封由服务端写、`openListKeyEnvelope` 自己再校形状（客户端类型放宽成 unknown）。
        envelope: own.keyEnvelope as ShareMemberKeyEnvelope,
        recipientX25519SecretKey: identity.x25519SecretKey,
      });
      const detail = await ready.api.shareDetail(shareId);
      await wrapAndStoreShareKeyPortable({
        port: ready.keyPort,
        cipher: ready.vaultCipher,
        shareId,
        listKey,
        keyEpoch: detail.keyEpoch,
        identitySeed: seed,
        ownMemberId: memberId,
      });
      const host = await openTaskHost();
      if (creatingRef.current.has(shareId)) return;
      creatingRef.current.add(shareId);
      try {
        const existing = localRowIdForShare(host.getState(), shareId);
        if (existing === undefined) {
          const name = listName.trim() === '' ? t('web.share.join.defaultName') : listName.trim();
          const projectId = await createProjectActions(host).createProject(name);
          // 全壳唯一绑定入口（判据在 app-host；`share-session.spec` 钉调用点只许一处）。
          await bindProjectShare(projectId, shareId);
        }
      } finally {
        creatingRef.current.delete(shareId);
      }
      setPhase({ kind: 'done' });
      onJoined?.();
    } catch (err) {
      if (err instanceof ShareApiError && (err.status === 403 || err.status === 404)) {
        setPhase({ kind: 'error', message: t('web.share.join.notMember') });
      }
      // 其余失败（比如信封还没落全）**不改相位**：留在等待态由下一条信号再试，
      // 这与 web 那一侧同一形状——它也不把"这一次没成"折成"出错了"。
    }
  }, [listName, onJoined, t]);

  /**
   * 🔴 等待态一确立：**先登记 target，再等信封**（文件头那条自锁事故的正面写法）。
   * 登记者 = `finalize`；`share_roster_changed` 到 ⇒ 垫片跑这一份重取。
   */
  useEffect(() => {
    if (phase.kind !== 'waiting-key') return undefined;
    const unregister = registerShareRosterTarget(phase.shareId, async () => {
      await finalize(phase.shareId, phase.memberId);
    });
    void finalize(phase.shareId, phase.memberId);
    return unregister;
  }, [phase, finalize]);

  const submit = useCallback(async () => {
    const admin = await prepareMobileShareAdmin();
    if (admin === undefined) {
      setNeedsUnlock(true);
      return;
    }
    adminRef.current = admin;
    const tokenFromInput = parseShareJoinLink(inputValue) ?? inputValue.trim();
    if (tokenFromInput === '') {
      setPhase({ kind: 'error', message: t('web.share.join.invalidToken') });
      return;
    }
    setPhase({ kind: 'accepting' });
    try {
      const identitySeed = generateShareIdentitySeed();
      const identity = deriveShareIdentityKeyPair(identitySeed);
      const accepted = await admin.api.acceptInvitation({
        token: tokenFromInput,
        identityPublicKey: bytesToBase64Portable(identity.x25519PublicKey),
        // 同一次入群把签名公钥也交上去（ADR-0069 裁决二）：少了这一格，这个人此后
        // 每一条共享 op 都会在上传边界被判「未签名」而永久拒。
        signingPublicKey: bytesToBase64Portable(identity.ed25519PublicKey),
      });
      await storeShareIdentityPortable({
        port: admin.keyPort,
        cipher: admin.vaultCipher,
        shareId: accepted.shareId,
        identitySeed,
        ownMemberId: accepted.memberId,
      });
      setNeedsUnlock(false);
      // 🔴 相位切换即登记（见上面那个 effect）——"登记在前、等待在后"不许倒。
      setPhase({ kind: 'waiting-key', shareId: accepted.shareId, memberId: accepted.memberId });
    } catch (err) {
      if (err instanceof ShareApiError && (err.status === 409 || err.status === 404 || err.status === 410)) {
        setPhase({ kind: 'error', message: t('web.share.join.invalidToken') });
      } else {
        setPhase({
          kind: 'error',
          message: err instanceof ShareApiError
            ? `${String(err.status)} ${String(err.code ?? '')}`
            : err instanceof Error
              ? err.message
              : String(err),
        });
      }
    }
  }, [inputValue, t]);

  const consentLabels = useMemo(
    () => ({
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
    }),
    [t],
  );

  const needsUnlockLine = needsUnlock ? (
    <Text variant="row-title" tone="default" testID="share-join-needs-unlock">
      {t('web.share.needUnlock')}
    </Text>
  ) : null;

  const body = (): React.JSX.Element => {
    if (phase.kind === 'consent') {
      return (
        <ShareConsentModal
          labels={consentLabels}
          store={consentStore}
          onConsent={(next) => {
            setConsentStore(next);
            if (!saveMobileShareConsent(next)) setConsentSaveFailed(true);
            else setConsentSaveFailed(false);
          }}
          onProceed={() => setPhase({ kind: 'input' })}
          onCancel={onBack}
        />
      );
    }
    if (phase.kind === 'input' || phase.kind === 'error') {
      return (
        <Stack>
          {phase.kind === 'error' ? (
            <Text variant="row-title" tone="danger" testID="share-join-error">
              {phase.message}
            </Text>
          ) : null}
          {needsUnlockLine}
          <TextField
            label={t('web.share.join.tokenLabel')}
            value={inputValue}
            onChangeText={setInputValue}
            placeholder={t('web.share.join.tokenPlaceholder')}
            multiline
            lines={3}
            testID="share-join-token"
          />
          <TextField
            label={t('web.share.join.nameLabel')}
            value={listName}
            onChangeText={setListName}
            placeholder={t('web.share.join.namePlaceholder')}
            autoCapitalize="sentences"
            testID="share-join-name"
          />
          <Button
            label={t('web.share.join.submit')}
            tone="primary"
            testID="share-join-submit"
            onPress={() => {
              void submit();
            }}
          />
          {consentSaveFailed ? (
            <Text variant="caption" tone="danger">{t('mobile.share.consent.saveFailed')}</Text>
          ) : null}
        </Stack>
      );
    }
    if (phase.kind === 'accepting') {
      return (
        <Text variant="row-title" tone="default" testID="share-join-accepting">
          {t('web.share.join.accepting')}
        </Text>
      );
    }
    if (phase.kind === 'waiting-key') {
      return (
        <Stack>
          <Text variant="row-title" tone="default" testID="share-join-waiting">
            {t('web.share.join.waitingKey')}
          </Text>
          {needsUnlockLine}
        </Stack>
      );
    }
    return (
      <Stack>
        <Text variant="row-title" tone="default" testID="share-join-done">
          {t('web.share.join.done')}
        </Text>
        <Button label={t('web.share.dialog.close')} onPress={onBack} testID="share-join-close-final" />
      </Stack>
    );
  };

  return (
    <Screen
      title={t('web.share.join.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      <Text variant="row-meta" tone="muted" testID="share-join-subtitle">
        {t('web.share.join.subtitle')}
      </Text>
      {body()}
    </Screen>
  );
}
