/**
 * SharePanel 的 web 宿主壳：ui 组件（纯展示）+ ShareApiClient（传输）
 * + share-key-store（密钥落点）在这里汇成**可用的面板**。
 *
 * 🔴 这一层不做权限裁决（服务端是唯一裁决者），不做密码学（sync-core），
 * 不存文案（i18n）——只把三者接起来，并把用户意图交回 API。
 *
 * 密钥流：owner 创建共享 / 被邀请者解信封 ⇒ listKey 进 key-store（vault
 * 子钥包裹落 localStorage）。vault 未解锁 ⇒ unwrap 得 undefined ⇒
 * 面板如实显示「需要解锁」，不假装能用。
 */
import { useCallback, useEffect, useState } from 'react';

import { ShareApiClient, ShareApiError } from '@heyta/sync-client';

import {
  loadShareKeyStore,
  unwrapShareListKey,
  wrapAndStoreShareKey,
} from './share-key-store';
import { SharePanel, type ShareRole } from '@heyta/ui';

export interface SharePanelHostProps {
  shareId: string;
  apiClient: ShareApiClient;
  /** 解锁会话的载荷信封（vault sync 子钥）——包裹/解包 listKey 用。 */
  getPayloadCipher: () => Promise<import('@heyta/sync-client').SyncPayloadCipher | undefined>;
  selfUserId: number;
  labels: import('@heyta/ui').SharePanelLabels;
}

interface PanelState {
  kind: 'loading' | 'needs-unlock' | 'ready' | 'error';
  error?: string;
}

export function useShareKey(shareId: string, getPayloadCipher: SharePanelHostProps['getPayloadCipher']) {
  const [listKey, setListKey] = useState<Uint8Array | undefined>();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const storage = window.localStorage;
      const cipher = await getPayloadCipher();
      if (cipher === undefined) {
        if (!cancelled) { setListKey(undefined); setChecked(true); }
        return;
      }
      const key = await unwrapShareListKey({ storage, cipher, shareId });
      if (!cancelled) { setListKey(key); setChecked(true); }
    })();
    return () => { cancelled = true; };
  }, [shareId, getPayloadCipher]);

  const storeKey = useCallback(async (key: Uint8Array, keyEpoch: number) => {
    const cipher = await getPayloadCipher();
    if (cipher === undefined) return;
    await wrapAndStoreShareKey({ storage: window.localStorage, cipher, shareId, listKey: key, keyEpoch });
    setListKey(key);
  }, [getPayloadCipher, shareId]);

  return { listKey, checked, storeKey };
}

export function SharePanelHost(props: SharePanelHostProps) {
  const { shareId, apiClient, selfUserId, labels } = props;
  const { listKey, checked, storeKey } = useShareKey(shareId, props.getPayloadCipher);
  const [members, setMembers] = useState<Parameters<typeof SharePanel>[0]['data']['members']>([]);
  const [keyEpoch, setKeyEpoch] = useState(0);
  const [myRole, setMyRole] = useState<'owner' | 'editor' | 'commenter' | 'viewer'>('viewer');
  const [ownerId, setOwnerId] = useState(0);
  const [loadError, setLoadError] = useState<string | undefined>();

  const reload = useCallback(async () => {
    try {
      const detail = await apiClient.shareDetail(shareId);
      const members = await apiClient.listMembers(shareId);
      setMembers(members.members);
      setKeyEpoch(detail.keyEpoch);
      setMyRole((detail.yourRole as typeof myRole) ?? 'viewer');
      setOwnerId(detail.ownerId);
      setLoadError(undefined);
    } catch (err) {
      setLoadError(err instanceof ShareApiError ? `${err.status} ${err.code ?? ''}` : String(err));
    }
  }, [apiClient, shareId]);

  useEffect(() => { void reload(); }, [reload]);

  if (loadError !== undefined) {
    return <div role="alert">{`共享清单不可用：${loadError}`}</div>;
  }
  if (!checked || members.length === 0) {
    return <div>{'加载中…'}</div>;
  }
  if (listKey === undefined) {
    return <div role="status">{'此共享清单已加密存储，解锁后即可使用。'}</div>;
  }

  const onRemoveMember = async (memberId: string) => {
    await apiClient.removeMember(shareId, memberId);
    await reload();
  };
  const onRoleChange = async (memberId: string, role: ShareRole) => {
    await apiClient.patchMemberRole(shareId, memberId, role);
    await reload();
  };

  return (
    <SharePanel
      data={{ shareId, ownerId, keyEpoch, myRole, members }}
      selfUserId={selfUserId}
      labels={labels}
      callbacks={{
        onInvite: () => { /* 邀请流（W6 链接/邮箱表单）——面板入口已就绪 */ },
        onRemoveMember: (memberId) => { void onRemoveMember(memberId); },
        onRoleChange: (memberId, role) => { void onRoleChange(memberId, role); },
      }}
    />
  );
}
