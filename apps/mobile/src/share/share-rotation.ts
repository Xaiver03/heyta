/**
 * 换钥（M3）的**移动端端壳装配** —— web `share-rotation.ts` 的同一件事的另一份接法。
 * ============================================================================
 *
 * 判断一个字都不在这里（AGENTS §3.5）：换不换、发给谁、世代写几、什么时候不收，
 * 全在 `@heyta/app-host` 的 `share-rekey.ts`。本文件只回答"这台手机上环端口接在哪"：
 * 密钥环 = `mobileShareKeyRingPort`（与评论通道**同一份**，见 comment-actions 那格
 * 抽出成具名导出的理由），落盘是 Keychain 兄弟槽（`lib/share-key-store.ts`）。
 *
 * ⚠️ 返回 `undefined` = 这一刻接不上（没登录 / vault 没解锁）——不造假装能换钥的对象。
 */
import {
  base64ToBytesPortable,
  createShareKeyRotation,
  type ShareKeyRingPort,
  type ShareRekeyApi,
} from '@heyta/app-host';
import type { SyncPayloadCipher } from '@heyta/sync-client';

import type { ShareKeyStoragePort } from '@heyta/app-host';
import { mobileShareKeyRingPort } from './comment-actions';

export function createMobileShareKeyRotation(args: {
  readonly api: ShareRekeyApi;
  readonly keyPort: ShareKeyStoragePort;
  readonly vaultCipher: SyncPayloadCipher | undefined;
  readonly isSignedIn: () => boolean;
}): ReturnType<typeof createShareKeyRotation> | undefined {
  if (args.vaultCipher === undefined) return undefined;
  const keys: ShareKeyRingPort = mobileShareKeyRingPort({
    keyPort: args.keyPort,
    cipher: args.vaultCipher,
  });
  return createShareKeyRotation({
    api: args.api,
    keys,
    decodeMemberPublicKey: base64ToBytesPortable,
    isSignedIn: args.isSignedIn,
  });
}
