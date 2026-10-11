import type { SyncPayloadIdentity } from '@heyta/sync-client';

/**
 * 共享清单密钥**本地存储信封**用的合成 AAD 身份（ADR-0062 W4）。
 * =====================================================================
 *
 * 🔴 这不是一个 op：它不被派发、不进 op-log、不上线。它只是喂给
 * `SyncPayloadCipher.encrypt/decrypt` 的 AAD 参数，把 localStorage 里
 * 某条 wrappedListKey 绑到它自己的 `shareId` 上（防两条记录互换后
 * 互相解得开）。`SyncPayloadIdentity` 要求带 `entityType` 字段，这里
 * 就得填一个值 —— 'SHARE_KEY' 是这条本地信封的标签，不是领域实体。
 *
 * 为什么住 app-host 而不是外壳（AGENTS §3.5）：凡 op 形状的构造都不许
 * 落在 `apps/*`（`check:layering` 拦的就是这个）。这个标签纯函数、零浏览器
 * 依赖，换钥/解锁各宿主都要同一个约定，所以它是宿主无关的一层。
 */
export const shareKeyStoreIdentity = (shareId: string): SyncPayloadIdentity => ({
  id: `share-key-store:${shareId}`,
  clientId: 'share-key-store',
  actionType: 'store',
  opType: 'UPD',
  entityType: 'SHARE_KEY',
  entityId: shareId,
  timestamp: 0,
  schemaVersion: 1,
});
