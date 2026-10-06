/**
 * 同步凭据表单的状态与"输入即生效"接线
 * ======================================
 *
 * 🔴 **状态活在「我的」（调用方），不活在设置面里。**
 *
 * 设置面（`SettingsScreen`）是 RN `Modal` —— `visible={false}` 时 children
 * **整体卸载**。表单状态若放在它里面，关一次设置面就丢一次未落盘的输入
 * （只改了服务器地址、还没填令牌时，写盘守卫不会落盘，重开就是空的）。
 * 所以状态留在常驻的 `ProfileScreen`，设置面只拿值与回调 —— 它开或关，
 * 打到一半的字都在。
 *
 * 逻辑原样搬自 `ProfileScreen`（2026-09-29 拆设置面之前就在那里）：
 *   · **输入即写活配置**，不等到点「立即同步」—— 本屏切标签会卸载重建，
 *     首次同步前切走再回来，令牌就永久丢了（移动端冲突验收实测撞过）；
 *   · **只有真填了才写**（否则空令牌会把"从没配过"变成"配了但没令牌"）；
 *   · `notifyConfigured()` 只在"从不可用变为可用"那一刻发一次 ——
 *     这个 effect 逐击键重跑，无脑通知会变成打一个字符通知一次。
 */

import { useEffect, useRef, useState } from 'react';
import { classifyTransportSecurity } from '@heyta/sync-client';

import { notifyConfigured } from './auto-sync';
import { DEFAULT_SERVER_URL, readSyncConfig, writeSyncConfig } from './config';
import { syncNow } from './store';

export interface SyncCredentialForm {
  readonly serverUrl: string;
  readonly token: string;
  readonly password: string;
  setServerUrl: (value: string) => void;
  setToken: (value: string) => void;
  setPassword: (value: string) => void;
  /** 服务器地址与令牌都非空 —— 「立即同步」的可用判据。 */
  readonly configured: boolean;
  /** 明文连接的判定（`@heyta/sync-client`，三端同一份规则）。 */
  readonly transport: ReturnType<typeof classifyTransportSecurity>;
  /**
   * 「立即同步」：先把表单写进活配置、通知实时通道，**再**同步 ——
   * 顺序反了的话第一次点用的还是上一次的凭据。
   */
  submit: () => void;
  /** 只清**状态**（磁盘与小组件的清理由调用方按序组合，见清凭据按钮）。 */
  clear: () => void;
}

export function useSyncCredentialForm(): SyncCredentialForm {
  // 🔴 初值从**活配置**里读，而不是各写一份空字符串 ——
  // 否则切走再切回来（组件会卸载重建）会把用户刚填的内容抹掉，
  // 而看起来像"填了没保存"。
  const existing = readSyncConfig();
  const [serverUrl, setServerUrl] = useState(existing?.serverUrl ?? DEFAULT_SERVER_URL);
  const [token, setToken] = useState(existing?.token ?? '');
  const [password, setPassword] = useState(existing?.password ?? '');

  /**
   * 凭据是否**上一次就已完整**。
   *
   * 🔴 这个 ref 是为了让 `notifyConfigured()` **只在"从不可用变为可用"那一刻**调一次。
   */
  const wasConfigured = useRef(false);
  useEffect(() => {
    // 守卫：只有真的填了凭据才写（理由见文件头）。
    // Authentication fills token and E2EE password through two controlled
    // state updates. During that handoff React can briefly render the new
    // password with the old empty token. Do not write that transient tuple:
    // it would erase the authenticated accountId binding before the token
    // update arrives, leaving VaultSettingsSection saying "please sign in".
    // Explicit credential logout calls clearSyncConfig separately, so an
    // empty token here does not weaken the logout path.
    if (token.trim() === '') return;
    writeSyncConfig({ serverUrl, token, password });

    // 凭据刚变完整的那一刻，必须通知一次（启动实时通道的钩子就在这里）。
    const complete = serverUrl.trim() !== '' && token.trim() !== '';
    if (complete && !wasConfigured.current) notifyConfigured();
    wasConfigured.current = complete;
  }, [serverUrl, token, password]);

  const configured = serverUrl.trim() !== '' && token.trim() !== '';
  const transport = classifyTransportSecurity(serverUrl);

  const submit = (): void => {
    // 先写活配置、再通知、最后同步 —— 三步的顺序是语义，不是习惯。
    writeSyncConfig({ serverUrl, token, password });
    // 重复通知无害：同步被 `auto-sync-core` 的 `MIN_GAP_MS` 挡，
    // `startRealtime()` 会先 `dispose()` 旧连接再建新的。
    notifyConfigured();
    void syncNow();
  };

  const clear = (): void => {
    setToken('');
    setPassword('');
  };

  return {
    serverUrl,
    token,
    password,
    setServerUrl,
    setToken,
    setPassword,
    configured,
    transport,
    submit,
    clear,
  };
}
