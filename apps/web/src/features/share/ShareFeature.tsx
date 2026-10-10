/**
 * `ShareFeature` —— 共享清单的 web 宿主接线组件（自包含，等 App.tsx 解封一行 import）。
 * ================================================================================
 *
 * 汇合三线：ShareConsentModal（PIPL 方案 a）+ SharePanel（成员管理）+ ShareApiClient（传输）
 * + share-key-store（密钥落盘）。
 *
 * ## 为什么它是独立的
 *
 * `App.tsx` 正被并行会话改写（132+ 文件）。等解封后只需 `import { ShareFeature } from './features/share/ShareFeature.js'`
 * 加一行挂载，其余全部自包含。密钥存储用 vault 载荷信封包裹（ADR-0050 机器），
 * vault 未解锁 ⇒ 面板如实显示「需要解锁」。
 *
 * ## 🔴 零 mock：`ShareApiClient` 由宿主注入 `baseUrl` + `getToken`，fetch 走真网络
 *
 * 本组件只负责把用户的操作翻译成 API 调用与密钥操作，**不判任何业务规则**
 * （服务端是唯一裁决者，AGENTS §3.5）。
 */

import { useCallback, useEffect, useState } from 'react';

import { ShareApiClient, ShareApiError } from '@heyta/sync-client';
import type { SyncPayloadCipher } from '@heyta/sync-client';
import { ShareConsentModal } from '@heyta/ui';
import { SharePanel } from '@heyta/ui';
import {
  shouldShowConsent,
  applyShareConsent,
  type ShareConsentStore,
} from '@heyta/ui';
import type { SharePanelLabels } from '@heyta/ui';

import {
  loadShareKeyStore,
  unwrapShareListKey,
  wrapAndStoreShareKey,
} from './share-key-store';

export interface ShareFeatureProps {
  shareId: string;
  baseUrl: string;
  getToken: () => string;
  getPayloadCipher: () => Promise<SyncPayloadCipher | undefined>;
  selfUserId: number;
  panelLabels: SharePanelLabels;
  consentLabels: {
    title: string;
    body: string;
    scopes: readonly string[];
    dontAskAgain: string;
    accept: string;
    cancel: string;
  };
}

export function ShareFeature(props: ShareFeatureProps) {
  const { shareId, baseUrl, getToken, getPayloadCipher, selfUserId, panelLabels, consentLabels } = props;

  const [apiClient] = useState(() => new ShareApiClient({ baseUrl, getToken }));
  const [consentStore, setConsentStore] = useState<ShareConsentStore>({});
  const [showConsent, setShowConsent] = useState(false);
  const [members, setMembers] = useState<Parameters<typeof SharePanel>[0]['data']['members']>([]);
  const [keyEpoch, setKeyEpoch] = useState(0);
  const [myRole, setMyRole] = useState<'owner' | 'editor' | 'commenter' | 'viewer'>('viewer');
  const [ownerId, setOwnerId] = useState(0);
  const [listKey, setListKey] = useState<Uint8Array | undefined>();
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();

  // 加载成员 + 解钥
  const reload = useCallback(async () => {
    try {
      const detail = await apiClient.shareDetail(shareId);
      const membersRes = await apiClient.listMembers(shareId);
      setMembers(membersRes.members);
      setKeyEpoch(detail.keyEpoch);
      setMyRole((detail.yourRole as typeof myRole) ?? 'viewer');
      setOwnerId(detail.ownerId);
      setLoadError(undefined);
    } catch (err) {
      setLoadError(err instanceof ShareApiError ? `${err.status} ${err.code ?? ''}` : String(err));
    }
  }, [apiClient, shareId]);

  useEffect(() => { void reload(); }, [reload]);

  // 密钥解包（vault 解锁后自动）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cipher = await getPayloadCipher();
      if (cipher === undefined) { if (!cancelled) setNeedsUnlock(true); return; }
      const key = await unwrapShareListKey({ storage: window.localStorage, cipher, shareId });
      if (!cancelled) { setListKey(key); setNeedsUnlock(false); }
    })();
    return () => { cancelled = true; };
  }, [getPayloadCipher, shareId]);

  const consentDecision = shouldShowConsent(consentStore);

  const handleConsent = (next: ShareConsentStore, proceed: boolean) => {
    setConsentStore(next);
    if (proceed) {
      // 用户确认了共享 ⇒ 走 API 创建共享并挂载面板。
      void (async () => {
        try {
          await apiClient.createShare();
          setShowConsent(false);
        } catch (err) {
          setLoadError(err instanceof ShareApiError ? `${err.status} ${err.code ?? ''}` : String(err));
        }
      })();
    } else {
      setShowConsent(false);
    }
  };

  const handleAcceptInvitation = async (token: string, identityPublicKey: string) => {
    await apiClient.acceptInvitation({ token, identityPublicKey });
    // 信封下发后由 owner 端 seal；bob 从 members 表的 keyEnvelope 取自己的信封解封。
  };

  if (loadError !== undefined) {
    return <div role="alert">{`共享清单不可用：${loadError}`}</div>;
  }

  if (showConsent || consentDecision.show) {
    return (
      <ShareConsentModal
        labels={consentLabels}
        store={consentStore}
        onConsent={(next) => handleConsent(next, true)}
        onCancel={() => handleConsent(consentStore, false)}
        onProceed={() => { /* handled in handleConsent */ }}
      />
    );
  }

  if (needsUnlock) {
    return <div role="status">{'此共享清单已加密存储，解锁后即可使用。'}</div>;
  }

  return (
    <div>
      <SharePanel
        data={{
          shareId,
          ownerId,
          keyEpoch,
          myRole,
          members: members.map((m) => ({
            memberId: m.memberId,
            userId: m.userId,
            role: m.role,
            addedAt: m.addedAt,
            hasEnvelope: m.hasEnvelope,
            memberKeyEpoch: m.memberKeyEpoch,
          })),
        }}
        selfUserId={selfUserId}
        labels={panelLabels}
        callbacks={{
          onInvite: () => { /* 邀请流 UI（W6）——面板骨架已就绪 */ },
          onRemoveMember: (memberId) => {
            void apiClient.removeMember(shareId, memberId).then(() => reload());
          },
          onRoleChange: (memberId, role) => {
            void apiClient.patchMemberRole(shareId, memberId, role).then(() => reload());
          },
        }}
      />
    </div>
  );
}
