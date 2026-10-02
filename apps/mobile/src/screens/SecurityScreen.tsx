/**
 * 「账号与安全」—— 改登录密码 + 通行密钥管理（移动端第二层屏）
 * ==============================================================
 *
 * 🔴 **这个屏补的是移动端的一个真实空洞**（多端覆盖审计 P1-1）：
 * `changePassword` / `listPasskeys` / `renamePasskey` / `deletePasskey` 在
 * app-host 里语义完整、web 全有，`apps/mobile` 此前**零 import** —— 手机上
 * 魔法链接注册的账号没有任何途径管理自己的凭据。
 *
 * ## 🔴 令牌轮换是本屏的存在理由（变异靶）
 *
 * `changePassword` 成功时服务端 bump `tokenVersion`（**全局**计数器）并返回
 * **新会话** —— 不把新令牌落盘，症状是"改个密码把自己这台设备也踢出去"
 * （hosted-auth.ts 文件头原话）。所以成功路径是：`onPasswordChanged(session.token)`
 * → 宿主把新令牌写进活配置并立即重验同步。验收脚本
 * `verify-mobile-account.sh` 的判据 3 钉这条；变异（拿掉落盘）⇒ 同步 401 转 red。
 *
 * ## 通行密钥：管理纳入，注册排除（如实说明）
 *
 * 移动端没有 WebAuthn 平台桥（`auth/passkey-host.ts` 的 `resolvePasskeyProvider`
 * 返回 `undefined` 是**结论**），所以这里**不提供注册入口**，空态文案如实说
 * "去电脑上注册"；**管理**（列表/改名/删除）是纯令牌 API，与平台桥无关，纳入。
 *
 * 错误措辞全部走共享层（`authFailureMessageKey` / `passwordPolicyMessageKey`），
 * 与 web 同一个词表 —— 本文件零错误文案。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { formatCompactDate } from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';
import {
  authFailureMessageKey,
  passwordPolicyMessageKey,
} from '@heyta/ui';
import {
  changePassword,
  deletePasskey,
  listPasskeys,
  renamePasskey,
  type HostedAuthFailureReason,
  type HostedPasskeySummary,
} from '@heyta/app-host';

import { Button, Card, Chip, Screen, Text, TextField } from '../ui/kit';
import { readSyncConfig } from '../sync/config';
import { useTokens } from '../theme';

interface FailureMessage {
  readonly key: MessageKey;
  readonly vars?: Readonly<Record<string, string | number>>;
}

/** 失败原因 → 共享词表。本文件零错误文案（见文件头）。 */
function toFailureMessage(
  reason: HostedAuthFailureReason,
  policyCode?: string,
): FailureMessage {
  if (reason === 'password-policy') {
    return { key: passwordPolicyMessageKey(policyCode) };
  }
  return { key: authFailureMessageKey(reason) };
}

export function SecurityScreen({
  onBack,
  onPasswordChanged,
}: {
  onBack: () => void;
  /**
   * 改密成功后把**新令牌**交给宿主：宿主写活配置并立即重验同步。
   * 🔴 不落盘 = 把自己这台设备踢出去（变异靶，见文件头）。
   */
  onPasswordChanged: (newToken: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();

  const config = useMemo(() => readSyncConfig(), []);
  const baseUrl = config?.serverUrl ?? '';
  const token = config?.token ?? '';

  // ── 改密码 ────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [done, setDone] = useState(false);
  const [changeError, setChangeError] = useState<FailureMessage | null>(null);

  const submitPasswordChange = useCallback(async (): Promise<void> => {
    if (baseUrl === '' || token === '' || changing) return;
    setChanging(true);
    setChangeError(null);
    const outcome = await changePassword({ baseUrl }, token, {
      currentPassword,
      newPassword,
    });
    if (outcome.ok) {
      // 🔴 先落盘（宿主写活配置 + 立即重验同步），再清表 —— 顺序反了会让
      // "改密成功"的界面停在一条已经失效的令牌上。
      onPasswordChanged(outcome.session.token);
      setDone(true);
      setCurrentPassword('');
      setNewPassword('');
    } else {
      setChangeError(toFailureMessage(outcome.reason, outcome.policyCode));
    }
    setChanging(false);
  }, [baseUrl, token, changing, currentPassword, newPassword, onPasswordChanged]);

  // ── 通行密钥管理 ──────────────────────────────────────────
  const [passkeys, setPasskeys] = useState<readonly HostedPasskeySummary[] | null>(null);
  const [passkeyError, setPasskeyError] = useState<FailureMessage | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<FailureMessage | null>(null);

  const loadPasskeys = useCallback(async (): Promise<void> => {
    if (baseUrl === '' || token === '') return;
    const outcome = await listPasskeys({ baseUrl }, token);
    if (outcome.ok) {
      setPasskeys(outcome.passkeys);
      setPasskeyError(null);
    } else {
      setPasskeyError(toFailureMessage(outcome.reason));
    }
  }, [baseUrl, token]);

  useEffect(() => {
    void loadPasskeys();
  }, [loadPasskeys]);

  const submitRename = useCallback(
    async (id: string): Promise<void> => {
      if (baseUrl === '' || token === '' || busyId !== null) return;
      setBusyId(id);
      setRowError(null);
      const outcome = await renamePasskey({ baseUrl }, {
        token,
        id,
        // 空串 → `null`（去掉名字）是**服务端**的归一化（hosted-auth 注释）：
        // 客户端再写一遍就是第二个真相源。
        name: renameDraft,
      });
      if (outcome.ok) {
        // 界面的真相来自重新拉取列表，不是回传副本（hosted-auth 纪律）。
        setRenamingId(null);
        setRenameDraft('');
        await loadPasskeys();
      } else {
        setRowError(toFailureMessage(outcome.reason));
      }
      setBusyId(null);
    },
    [baseUrl, token, busyId, renameDraft, loadPasskeys],
  );

  const submitDelete = useCallback(
    async (id: string): Promise<void> => {
      if (baseUrl === '' || token === '' || busyId !== null) return;
      setBusyId(id);
      setRowError(null);
      const outcome = await deletePasskey({ baseUrl }, { token, id });
      if (outcome.ok) {
        setConfirmDeleteId(null);
        await loadPasskeys();
      } else {
        // 409（最后一条）在这里以服务端的原因出现 —— 说服务端说的话。
        setRowError(toFailureMessage(outcome.reason));
        setConfirmDeleteId(null);
      }
      setBusyId(null);
    },
    [baseUrl, token, busyId, loadPasskeys],
  );

  const askDelete = useCallback(
    (id: string, label: string): void => {
      Alert.alert(t('mobile.security.passkeys.deleteTitle'), label, [
        { text: t('mobile.common.cancel'), style: 'cancel' },
        {
          text: t('mobile.security.passkeys.delete'),
          style: 'destructive',
          onPress: () => {
            setConfirmDeleteId(id);
          },
        },
      ]);
    },
    [t],
  );

  return (
    <Screen
      title={t('mobile.security.title')}
      actions={[{ icon: 'action.back', label: t('mobile.security.back'), onPress: onBack }]}
    >
      {/* ── 改登录密码 ──────────────────────────────────────── */}
      <Card>
        <View style={{ gap: tokens['space.3'] }}>
          <Text variant="row-title" tone="default">
            {t('mobile.security.password.title')}
          </Text>
          <Text variant="row-meta" tone="muted">
            {t('mobile.security.password.lead')}
          </Text>
          {done ? (
            <View style={{ gap: tokens['space.1'] }}>
              <Text variant="row-meta" tone="default">
                {t('mobile.security.password.done')}
              </Text>
              <Text variant="caption" tone="subtle">
                {t('mobile.security.password.doneDetail')}
              </Text>
            </View>
          ) : null}
          {changeError !== null ? (
            <Text variant="row-meta" tone="danger">
              {t(changeError.key, changeError.vars as never)}
            </Text>
          ) : null}
          <TextField
            label={t('mobile.security.password.current')}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secure={true}
          />
          <TextField
            label={t('mobile.security.password.new')}
            value={newPassword}
            onChangeText={setNewPassword}
            secure={true}
          />
          <Button
            label={changing ? t('mobile.security.password.busy') : t('mobile.security.password.submit')}
            onPress={() => {
              void submitPasswordChange();
            }}
            tone="primary"
            loading={changing}
          />
        </View>
      </Card>

      {/* ── 通行密钥管理（注册在移动端排除，见文件头） ────────── */}
      <Card>
        <View style={{ gap: tokens['space.3'] }}>
          <Text variant="row-title" tone="default">
            {t('mobile.security.passkeys.title')}
          </Text>
          <Text variant="row-meta" tone="muted">
            {t('mobile.security.passkeys.hint')}
          </Text>
          {passkeyError !== null ? (
            <Text variant="row-meta" tone="danger">
              {t(passkeyError.key, passkeyError.vars as never)}
            </Text>
          ) : null}
          {rowError !== null ? (
            <Text variant="row-meta" tone="danger">
              {t(rowError.key, rowError.vars as never)}
            </Text>
          ) : null}
          {passkeys === null ? (
            <Text variant="caption" tone="subtle">
              {t('mobile.security.passkeys.loading')}
            </Text>
          ) : passkeys.length === 0 ? (
            <Text variant="row-meta" tone="subtle">
              {t('mobile.security.passkeys.empty')}
            </Text>
          ) : (
            <View style={{ gap: tokens['space.3'] }}>
              {passkeys.map((passkey) => {
                const label =
                  passkey.name ?? t('mobile.security.passkeys.unnamed');
                const isRenaming = renamingId === passkey.id;
                const isConfirming = confirmDeleteId === passkey.id;
                return (
                  <View
                    key={passkey.id}
                    style={{
                      gap: tokens['space.2'],
                      backgroundColor: tokens['color.surface-sunken'],
                      borderRadius: tokens['radius.md'],
                      padding: tokens['space.3'],
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] }}>
                      <Text variant="row-meta" tone="default" style={{ flex: 1 }}>
                        {label}
                      </Text>
                      <Text variant="caption" tone="subtle">
                        {formatCompactDate(
                          new Date(passkey.createdAt).getTime(),
                          Date.now(),
                        )}
                      </Text>
                    </View>
                    {isRenaming ? (
                      <View style={{ gap: tokens['space.2'] }}>
                        <TextField
                          label={t('mobile.security.passkeys.renameHint')}
                          value={renameDraft}
                          onChangeText={setRenameDraft}
                        />
                        <View style={{ flexDirection: 'row', gap: tokens['space.2'] }}>
                          <Chip
                            label={t('mobile.security.passkeys.renameSave')}
                            selected={true}
                            onPress={() => {
                              void submitRename(passkey.id);
                            }}
                          />
                          <Chip
                            label={t('mobile.security.passkeys.renameCancel')}
                            selected={false}
                            onPress={() => {
                              setRenamingId(null);
                              setRenameDraft('');
                            }}
                          />
                        </View>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: tokens['space.2'] }}>
                        <Chip
                          label={t('mobile.security.passkeys.rename')}
                          selected={false}
                          onPress={() => {
                            setRenamingId(passkey.id);
                            setRenameDraft(passkey.name ?? '');
                          }}
                        />
                        {isConfirming ? (
                          <Chip
                            label={t('mobile.security.passkeys.deleteConfirm')}
                            selected={true}
                            onPress={() => {
                              void submitDelete(passkey.id);
                            }}
                          />
                        ) : (
                          <Chip
                            label={t('mobile.security.passkeys.delete')}
                            selected={false}
                            onPress={() => {
                              askDelete(passkey.id, label);
                            }}
                          />
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </Card>
    </Screen>
  );
}
