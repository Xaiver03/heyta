/**
 * 这台设备现在能拿哪把钥匙加解密头像（Web 宿主的那一半）
 * ======================================================
 *
 * ## 它修的是什么
 *
 * 头像的钥匙一直是**同步那把口令**（`hosted-auth.ts` 的 `AvatarKey`）。ADR-0050 的
 * vault 落地之后，"同步那把钥匙"在**登录态账号**上换了人：vault 模式下 `sync` store
 * 把 `getPassword` 固定返回 `undefined`，真正的钥匙是 vault 根钥匙，而它只在
 * `getWebVaultSession(...).getPayloadCipher()` 里、**解锁之后**才有。
 *
 * 于是口令变成了一把**在登录态下永远不会存在的钥匙** —— 界面据此说
 * 「本机没有保存这个口令，请先在同步设置里填写一次」，而 vault 模式下那一格根本
 * 不渲染（`SyncSettingsPanel` 的 `!vaultMode` 分支）。用户拿到的是一句无解的指引
 * （2026-10-24 产品负责人实拍）。
 *
 * ## 为什么是 hook，而不是"在面板里现取一次"
 *
 * 头像有两个读者：设置里的「个人资料」，和左侧导航顶部 / 头像菜单（`useAccountIdentity`）。
 * 两处各写一次"去哪拿钥匙"就是把同一条规则判两遍，而这两处**今天已经漂过一次**：
 * 一处拿到 `needs-password`，另一处把它当成"没有头像"。
 *
 * ## 🔴 拿不到钥匙**不是错误**
 *
 * `vaultCipher === undefined` 是一个正常状态（vault 还锁着 / 这个账号还没建 vault /
 * 这是手填凭据的实例）。界面该说"先解锁"，不该说"头像坏了"，也不该在这里抛。
 * `IndexedDB` 不可用（隐私模式）时同理：`getWebVaultSession` 会被 reject，这里吞掉
 * 并落回口令那条路 —— 一次读不到钥匙不该让整个资料页白掉。
 */
import { useEffect, useMemo, useState } from 'react';

import { resolveAvatarKey, type AvatarKey } from '@heyta/app-host';
import type { SyncPayloadCipher } from '@heyta/sync-client';

import { getWebVaultSession } from '../../lib/vault-session.js';
import { useSyncStore } from './store.js';

export interface AvatarKeyState {
  /** 加解密头像用的钥匙；`undefined` = 这台设备现在没有钥匙。 */
  readonly key: AvatarKey | undefined;
  /** 钥匙从哪来 —— 只用于诊断与文案分支，不参与"能不能换"的判断。 */
  readonly source: 'vault' | 'password' | 'none';
  /** 这个账号是登录态（有 `accountId`）⇒ 钥匙只可能在 vault 里。 */
  readonly vaultMode: boolean;
}

export function useAvatarKey(options: { readonly active?: boolean } = {}): AvatarKeyState {
  const active = options.active ?? true;
  const baseUrl = useSyncStore((state) => state.baseUrl);
  const token = useSyncStore((state) => state.token);
  const password = useSyncStore((state) => state.password);
  const accountId = useSyncStore((state) => state.accountId);

  const vaultMode = accountId !== undefined && accountId.trim() !== '';
  const [vaultCipher, setVaultCipher] = useState<SyncPayloadCipher | undefined>(undefined);

  useEffect(() => {
    // 口令模式的实例没有 vault，这条 effect 一个请求都不发（连 IndexedDB 都不碰）。
    if (!active || !vaultMode || baseUrl.trim() === '' || token === undefined) {
      // 🔴 用函数式 set 并**返回同一个值**：这样 React 直接 bail out，不排一次
      //    多余的重渲染（effect 里的裸 `setState(undefined)` 每帧都会排一次）。
      setVaultCipher((current) => (current === undefined ? current : undefined));
      return undefined;
    }
    let current = true;
    void (async () => {
      try {
        const session = await getWebVaultSession(accountId.trim(), baseUrl, async () => token);
        const cipher = await session.getPayloadCipher();
        if (current) setVaultCipher(cipher);
      } catch {
        // 见文件头：读不到钥匙落回"没有钥匙"，不把它变成页面级故障。
        if (current) setVaultCipher((previous) => (previous === undefined ? previous : undefined));
      }
    })();
    return () => {
      current = false;
    };
  }, [accountId, active, baseUrl, token, vaultMode]);

  // 🔴 `useMemo` 不是性能优化，是**依赖稳定性**：调用方把 `key` 放进 effect 的依赖表，
  //    每次渲染都新建一个 `{ cipher }` 会让那条 effect 每帧重跑一次资料读取。
  const key = useMemo(() => resolveAvatarKey({ password, vaultCipher }), [password, vaultCipher]);
  return {
    key,
    source: key === undefined ? 'none' : typeof key === 'string' ? 'password' : 'vault',
    vaultMode,
  };
}
