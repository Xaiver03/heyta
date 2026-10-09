/**
 * 「账号与安全」—— 登录密码 · 通行密钥 · 登录设备（移动端第二层屏）
 * ================================================================
 *
 * 🔴 **这个屏补的是移动端的一个真实空洞**（多端覆盖审计 P1-1）：
 * `changePassword` / `listPasskeys` / `renamePasskey` / `deletePasskey` 在
 * app-host 里语义完整、web 全有，`apps/mobile` 此前**零 import** —— 手机上
 * 魔法链接注册的账号没有任何途径管理自己的凭据。
 *
 * ## 🔴 令牌轮换是本屏的一条存在理由（变异靶）
 *
 * `changePassword` 成功时服务端 bump `tokenVersion`（**全局**计数器）并返回
 * **新会话** —— 不把新令牌落盘，症状是"改个密码把自己这台设备也踢出去"
 * （hosted-auth.ts 文件头原话）。所以成功路径是：`onPasswordChanged(session.token)`
 * → 宿主把新令牌写进活配置并立即重验同步。验收脚本
 * `verify-mobile-account.sh` 的判据 3 钉这条；变异（拿掉落盘）⇒ 同步 401 转红。
 *
 * ⚠️ **另两条路刻意不轮换，界面也就必须说三句不同的话**：
 *   · `setInitialPassword`（设**第一个**口令）不 bump `tokenVersion`、**不返回会话** ——
 *     手上那枚仍然有效（`packages/app-host/src/hosted-auth.ts` 里 `setInitialPassword`
 *     上面那段）。把它当改密那样"落盘新令牌"，落的是一件服务端从没发过的东西
 *     ⇒ 下一次同步 401。
 *   · `logoutCurrentDevice` 反过来：它**撤销手上这一枚**，所以本机凭据必须清。
 *     那一条的编排在 `../auth/sign-out-flow.ts`。
 *
 * ## 🔴 本屏不再自己 `readSyncConfig()` 取快照
 *
 * 旧版在挂载时 `useMemo(() => readSyncConfig(), [])` 抓一次地址与令牌。后果不是
 * 外观问题：**改密成功、令牌换新的之后，本屏每一次后续调用还在用那枚服务端
 * 已经不认的旧令牌** ⇒ 列表、改名、删除全部 `unauthorized`，而且没有任何一处说明原因。
 * 现在地址与令牌由父屏（持有 `useSyncCredentialForm` 的 `ProfileScreen`）传进来。
 *
 * ## 这一轮补上的三个**只有协议、没有入口**的路
 *
 * | 路 | 之前 | 现在 |
 * |---|---|---|
 * | 设第一个登录密码 | `setInitialPassword` 在移动端零调用点，而纯通行密钥/魔法链接账号**只能**走它（`requestPasswordReset` 对没有口令认证器的账号刻意不发信） | 一张独立的单字段表单；`no-password-set` 与 `password-already-set` 各自指向**自己那张表** |
 * | 已登录添加通行密钥 | 只有 `beginPasskeyRegistration`（注册**新账号**那条），本文件旧版把它当成"移动端不提供注册入口" | 走 `beginPasskeyEnrollment` / `completePasskeyEnrollment` |
 * | 找回通行密钥 | `requestPasskeyRecovery` 有函数、移动端没有触发点 | 通行密钥卡片里的一个按钮 |
 *
 * 🔴 **为什么注册必须用 `*Enrollment` 而不是 `*Registration`**：`Registration` 那两条
 * 是"注册新账号"，服务端 `verifyRegistration` 对"这个 email 已属于一个已验证账号"
 * **故意提前返回成功而不写任何凭据**（防枚举）。已登录用户走那条 ⇒
 * **界面说成功、凭据不存在**。`server/src/api.ts` 里 `/passkeys/registration/*` 那段
 * 注释记的就是这个事故形状。判据 `tests/account-security-wiring.spec.ts` 钉住
 * "本屏不许 import `beginPasskeyRegistration`"。
 *
 * ## 平台那一步仍然不在这里
 *
 * WebAuthn 的 `navigator.credentials` 等价物留在壳里（`../auth/passkey-host.ts`）。
 * 今天它返回 `undefined` 是**结论**，不是占位 —— 所以「添加一条通行密钥」在
 * 当前设备上**一个请求都不发**，直接说 `passkey-unsupported`。
 * 接原生模块时只改那一个文件，本屏一行不动。
 *
 * 错误措辞全部走共享层（`authFailureMessage`），与 web 同一个词表 ——
 * 本文件零错误文案。⚠️ 用 `authFailureMessage` 而不是旧的 `authFailureMessageKey`：
 * 后者只交 key，而带 `{seconds}` / `{min}` / `{max}` 的那几条词条于是会被渲染成
 * 没填数的占位符（`packages/ui/src/auth/model.ts` 里 W7 那次修的就是这个形状，
 * 本文件旧版正落在同一类里）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { formatCompactDate } from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { EmptyState, authFailureMessage, SettingsRow } from '@heyta/ui';
import {
  beginPasskeyEnrollment,
  changePassword,
  completePasskeyEnrollment,
  deletePasskey,
  listPasskeys,
  renamePasskey,
  requestPasskeyRecovery,
  setInitialPassword,
  type HostedAuthFailure,
  type HostedPasskeyCredential,
  type HostedPasskeySummary,
} from '@heyta/app-host';

import { Button, Card, Chip, Divider, HStack, Screen, Stack, Text, TextField } from '../ui/kit';
import { describePasskeyError, resolvePasskeyProvider } from '../auth/passkey-host';
import { SessionsSection } from './SessionsSection';
import { useTokens } from '../theme';

interface FailureMessage {
  readonly key: MessageKey;
  readonly vars?: Record<string, string | number>;
}

/** 失败 → 共享词表（连句子里要填的数一起拿）。本文件零错误文案。 */
function toFailureMessage(failure: HostedAuthFailure): FailureMessage {
  return authFailureMessage({
    reason: failure.reason,
    policyCode: failure.policyCode,
    retryAfterSeconds: failure.retryAfterSeconds,
  });
}

export function SecurityScreen({
  onBack,
  baseUrl,
  token,
  onPasswordChanged,
  onSignOutCurrentDevice,
  onSignedOutEverywhere,
}: {
  onBack: () => void;
  /**
   * 🔴 地址与令牌由**父屏的活状态**传进来，不在这里取快照 —— 理由见文件头
   * "本屏不再自己 `readSyncConfig()`" 那一节。
   */
  baseUrl: string;
  token: string;
  /**
   * 改密成功后把**新令牌**交给宿主：宿主写活配置并立即重验同步。
   * 🔴 不落盘 = 把自己这台设备踢出去（变异靶，见文件头）。
   */
  onPasswordChanged: (newToken: string) => void;
  /** 「退出登录」：撤销手上这一枚 **并**清本机凭据（编排在 `auth/sign-out-flow.ts`）。 */
  onSignOutCurrentDevice: () => void;
  /** 「退出所有设备」成功之后手上这枚也死了 ⇒ 走与退出登录**同一条**本机清理路径。 */
  onSignedOutEverywhere: () => void;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const tokens = useTokens();

  // 🔴 `useMemo` 不是优化，是**正确性**：这个对象进了下面每一个 `useCallback` 的
  // 依赖表，每次渲染都新建的话 `loadPasskeys` 就每渲染变一次，而那个 effect
  // 会在挂载后无限重发列表请求。
  const options = useMemo(() => ({ baseUrl, locale }), [baseUrl, locale]);
  const ready = baseUrl.trim() !== '' && token.trim() !== '';

  // ── 修改登录密码（账号**已有**口令的那张表）───────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [done, setDone] = useState(false);
  const [changeError, setChangeError] = useState<FailureMessage | null>(null);
  /** 留住原始原因：`no-password-set` 指向的是**另一张表单**，光有句子不够。 */
  const [changeReason, setChangeReason] = useState<string | undefined>(undefined);

  const submitPasswordChange = useCallback(async (): Promise<void> => {
    if (!ready || changing) return;
    setChanging(true);
    setChangeError(null);
    const outcome = await changePassword(options, token, { currentPassword, newPassword });
    if (outcome.ok) {
      // 🔴 先落盘（宿主写活配置 + 立即重验同步），再清表 —— 顺序反了会让
      // "改密成功"的界面停在一条已经失效的令牌上。
      onPasswordChanged(outcome.session.token);
      setDone(true);
      setCurrentPassword('');
      setNewPassword('');
      setChangeReason(undefined);
    } else {
      setChangeError(toFailureMessage(outcome));
      setChangeReason(outcome.reason);
    }
    setChanging(false);
  }, [ready, changing, options, token, currentPassword, newPassword, onPasswordChanged]);

  // ── 设置**第一个**登录密码（账号还没有口令的那张表）───────
  // ⚠️ 名字一律带 `first` 前缀：状态值不叫 `setXxx`（那是 setter 的形状）。
  // 本文件旧版一度把值命名成 `setFirstOpen` / `setDone`，后者与上面改密那段的
  // `setDone` **撞成同一个块级绑定**，`tsc` 直接报 "Cannot redeclare"。
  const [firstOpen, setFirstOpen] = useState(false);
  const [firstPassword, setFirstPassword] = useState('');
  const [setting, setSetting] = useState(false);
  const [firstDone, setFirstDone] = useState(false);
  const [firstError, setFirstError] = useState<FailureMessage | null>(null);
  const [firstReason, setFirstReason] = useState<string | undefined>(undefined);

  const submitInitialPassword = useCallback(async (): Promise<void> => {
    if (!ready || setting || firstPassword === '') return;
    setSetting(true);
    setFirstError(null);
    const outcome = await setInitialPassword(options, token, { newPassword: firstPassword });
    if (outcome.ok) {
      // 🔴 这条**没有新令牌**可落盘，也不 bump `tokenVersion`：界面要说的是
      // "口令加上了"，不是"这台设备换了凭据"。
      setFirstDone(true);
      setFirstPassword('');
      setFirstReason(undefined);
    } else {
      setFirstError(toFailureMessage(outcome));
      setFirstReason(outcome.reason);
    }
    setSetting(false);
  }, [ready, setting, firstPassword, options, token]);

  // ── 通行密钥：管理 ────────────────────────────────────────
  const [passkeys, setPasskeys] = useState<readonly HostedPasskeySummary[] | null>(null);
  const [passkeyError, setPasskeyError] = useState<FailureMessage | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<FailureMessage | null>(null);

  const loadPasskeys = useCallback(async (): Promise<void> => {
    if (!ready) return;
    const outcome = await listPasskeys(options, token);
    if (outcome.ok) {
      setPasskeys(outcome.passkeys);
      setPasskeyError(null);
    } else {
      setPasskeyError(toFailureMessage(outcome));
    }
  }, [ready, options, token]);

  useEffect(() => {
    void loadPasskeys();
  }, [loadPasskeys]);

  const submitRename = useCallback(
    async (id: string): Promise<void> => {
      if (!ready || busyId !== null) return;
      setBusyId(id);
      setRowError(null);
      const outcome = await renamePasskey(options, {
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
        setRowError(toFailureMessage(outcome));
      }
      setBusyId(null);
    },
    [ready, busyId, renameDraft, options, token, loadPasskeys],
  );

  const submitDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!ready || busyId !== null) return;
      setBusyId(id);
      setRowError(null);
      const outcome = await deletePasskey(options, { token, id });
      if (outcome.ok) {
        setConfirmDeleteId(null);
        await loadPasskeys();
      } else {
        // 409（最后一条）在这里以服务端的原因出现 —— 说服务端说的话，
        // 而那两句共享词条给的都是**出路**（先加一条 / 设一个登录口令）。
        setRowError(toFailureMessage(outcome));
        setConfirmDeleteId(null);
      }
      setBusyId(null);
    },
    [ready, busyId, options, token, loadPasskeys],
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

  // ── 通行密钥：已登录**添加一条**（真会写库的那两条端点）────
  const [enrolling, setEnrolling] = useState(false);
  const [enrollDone, setEnrollDone] = useState(false);
  const [enrollError, setEnrollError] = useState<FailureMessage | null>(null);

  const submitEnroll = useCallback(async (): Promise<void> => {
    if (!ready || enrolling) return;
    setEnrollError(null);
    setEnrollDone(false);
    // 🔴 能力探测在**发任何请求之前**：这台设备没有平台桥就先要 options 是白问，
    // 而且会把"这台设备不支持"伪装成一次失败的网络请求。
    const provider = resolvePasskeyProvider();
    if (provider === undefined) {
      setEnrollError({ key: 'common.auth.error.passkeyUnsupported' });
      return;
    }
    setEnrolling(true);
    const begun = await beginPasskeyEnrollment(options, token);
    if (!begun.ok) {
      setEnrollError(toFailureMessage(begun));
      setEnrolling(false);
      return;
    }
    let credential: HostedPasskeyCredential;
    try {
      // 用户在系统弹窗上操作，可能停住很久；取消 / 超时在这里抛，由
      // `describePasskeyError` 翻成封闭原因 —— 这一支**绝不**说成功。
      credential = await provider.create(begun.options);
    } catch (error) {
      setEnrollError({ key: authFailureMessage({ reason: describePasskeyError(error) }).key });
      setEnrolling(false);
      return;
    }
    const completed = await completePasskeyEnrollment(options, { token, credential });
    if (!completed.ok) {
      setEnrollError(toFailureMessage(completed));
      setEnrolling(false);
      return;
    }
    setEnrolling(false);
    setEnrollDone(true);
    // 成功 ⟺ 服务端真的写进了凭据行 ⇒ 列表以服务端为准重拉，不做乐观新增。
    await loadPasskeys();
  }, [ready, enrolling, options, token, loadPasskeys]);

  // ── 通行密钥：找回（发一封恢复链接）───────────────────────
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [recoverDone, setRecoverDone] = useState(false);
  const [recoverError, setRecoverError] = useState<FailureMessage | null>(null);

  const submitRecovery = useCallback(async (): Promise<void> => {
    if (recovering || recoverEmail.trim() === '') return;
    setRecovering(true);
    setRecoverError(null);
    setRecoverDone(false);
    const outcome = await requestPasskeyRecovery(options, recoverEmail);
    if (outcome.ok) {
      // 🔴 服务端**永远**回同一句中性文案（防邮箱枚举），所以这句既不能说"已登录"、
      // 也不能说"链接一定到了"。恢复本身在**服务端渲染的那一页**完成，
      // 那一步必须调 `navigator.credentials`，本来就不该在原生壳里做。
      setRecoverDone(true);
    } else {
      setRecoverError(toFailureMessage(outcome));
    }
    setRecovering(false);
  }, [recovering, recoverEmail, options]);

  return (
    <Screen
      title={t('mobile.security.title')}
      actions={[{ icon: 'action.back', label: t('mobile.security.back'), onPress: onBack }]}
    >
      {/* ── 修改登录密码（已有口令的那张表）────────────────── */}
      <Card>
        <Stack gap="loose">
          <Text variant="row-title" tone="default">
            {t('mobile.security.password.title')}
          </Text>
          <Text variant="row-meta" tone="muted">
            {t('mobile.security.password.lead')}
          </Text>
          {done ? (
            <Stack gap="tight">
              <Text variant="row-meta" tone="default">
                {t('mobile.security.password.done')}
              </Text>
              <Text variant="caption" tone="subtle">
                {t('mobile.security.password.doneDetail')}
              </Text>
            </Stack>
          ) : null}
          {changeError !== null ? (
            <Text variant="row-meta" tone="danger" selectable>
              {t(changeError.key, changeError.vars)}
            </Text>
          ) : null}
          {/*
            🔴 「这个账号还没有口令」不是一句报错就完了 —— 它是一条**相反的路**：
            `requestPasswordReset` 对没有口令认证器的账号**刻意不发信**，
            所以"去走忘记密码"那种指引是做不到的。这里把用户送到真走得通的那张表。
          */}
          {changeReason === 'no-password-set' ? (
            <Button
              label={t('mobile.security.password.setFirst')}
              onPress={() => {
                setFirstOpen(true);
              }}
              tone="secondary"
              testID="security-open-set-first"
            />
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
            disabled={!ready || changing}
          />
        </Stack>
      </Card>

      {/* ── 设置第一个登录密码（还没有口令的那张表）────────── */}
      <Card>
        <Stack gap="loose">
          <SettingsRow
            row={{
              kind: 'action',
              label: t('mobile.security.password.setFirst'),
              hint: t('mobile.security.password.setFirstHint'),
              testID: 'security-set-first-row',
              onPress: () => {
                setFirstOpen((open) => !open);
              },
            }}
          />
          {!firstOpen ? null : (
            <Stack gap="loose">
              {firstDone ? (
                <Stack gap="tight">
                  <Text variant="row-meta" tone="default">
                    {t('mobile.security.password.setDone')}
                  </Text>
                  <Text variant="caption" tone="subtle">
                    {t('mobile.security.password.setDoneDetail')}
                  </Text>
                </Stack>
              ) : null}
              {firstError !== null ? (
                <Text variant="row-meta" tone="danger" selectable>
                  {t(firstError.key, firstError.vars)}
                </Text>
              ) : null}
              {/* 与上面那条相反：已有口令的账号走的是「修改密码」那张两字段表。 */}
              {firstReason === 'password-already-set' ? (
                <Button
                  label={t('mobile.security.password.switchToChange')}
                  onPress={() => {
                    setFirstOpen(false);
                  }}
                  tone="secondary"
                />
              ) : null}
              <TextField
                label={t('mobile.security.password.new')}
                value={firstPassword}
                onChangeText={setFirstPassword}
                secure={true}
                testID="security-first-password-input"
              />
              <Button
                label={setting ? t('mobile.security.password.setBusy') : t('mobile.security.password.setSubmit')}
                onPress={() => {
                  void submitInitialPassword();
                }}
                tone="primary"
                loading={setting}
                disabled={!ready || setting || firstPassword === ''}
                testID="security-set-first-submit"
              />
            </Stack>
          )}
        </Stack>
      </Card>

      {/* ── 通行密钥：管理 + 已登录添加 + 找回 ──────────────── */}
      <Card>
        <Stack gap="loose">
          <Text variant="row-title" tone="default">
            {t('mobile.security.passkeys.title')}
          </Text>
          <Text variant="row-meta" tone="muted">
            {t('mobile.security.passkeys.hint')}
          </Text>
          {passkeyError !== null ? (
            <Text variant="row-meta" tone="danger">
              {t(passkeyError.key, passkeyError.vars)}
            </Text>
          ) : null}
          {rowError !== null ? (
            <Text variant="row-meta" tone="danger" selectable>
              {t(rowError.key, rowError.vars)}
            </Text>
          ) : null}
          {enrollError !== null ? (
            <Text variant="row-meta" tone="danger" selectable>
              {t(enrollError.key, enrollError.vars)}
            </Text>
          ) : null}
          {enrollDone ? (
            <Text variant="row-meta" tone="default">{t('mobile.security.passkeys.enrollDone')}</Text>
          ) : null}
          <Button
            label={enrolling ? t('mobile.security.passkeys.enrollBusy') : t('mobile.security.passkeys.enroll')}
            onPress={() => {
              void submitEnroll();
            }}
            tone="secondary"
            icon="privacy.consent"
            loading={enrolling}
            disabled={!ready || enrolling}
            testID="security-enroll-passkey"
          />
          {passkeys === null ? (
            <Text variant="caption" tone="subtle">
              {t('mobile.security.passkeys.loading')}
            </Text>
          ) : passkeys.length === 0 ? (
            // 共享空态的 `section` 档：设置卡片里的一行占位。
            // 🔴 不用页面档 —— 那是"居中 + 上下 64px"，塞进卡片是视觉回归；
            //    也不往门禁的 EMPTY_SITES 加一行 —— 那等于把这笔债合法化。
            <EmptyState size="section" title={t('mobile.security.passkeys.empty')} />
          ) : (
            <Stack gap="loose">
              {passkeys.map((passkey) => {
                const label = passkey.name ?? t('mobile.security.passkeys.unnamed');
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
                    <HStack align="center">
                      <Text variant="row-meta" tone="default" grow={true}>
                        {label}
                      </Text>
                      <Text variant="caption" tone="subtle">
                        {formatCompactDate(
                          new Date(passkey.createdAt).getTime(),
                          Date.now(),
                        )}
                      </Text>
                    </HStack>
                    {isRenaming ? (
                      <Stack>
                        <TextField
                          label={t('mobile.security.passkeys.renameHint')}
                          value={renameDraft}
                          onChangeText={setRenameDraft}
                        />
                        <HStack>
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
                        </HStack>
                      </Stack>
                    ) : (
                      <HStack>
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
                      </HStack>
                    )}
                  </View>
                );
              })}
            </Stack>
          )}

          {/* 找回通行密钥：一封邮件，落点是服务端渲染的凭据页，**不在本屏完成**。 */}
          <Divider />
          <SettingsRow
            row={{
              kind: 'action',
              label: t('mobile.security.passkeys.recover'),
              hint: t('mobile.security.passkeys.recoverHint'),
              testID: 'security-recover-passkey-row',
              onPress: () => {
                setRecoverOpen((open) => !open);
              },
            }}
          />
          {!recoverOpen ? null : (
            <Stack gap="loose">
              {recoverError !== null ? (
                <Text variant="row-meta" tone="danger" selectable>
                  {t(recoverError.key, recoverError.vars)}
                </Text>
              ) : null}
              {recoverDone ? (
                <Text variant="row-meta" tone="default" selectable>
                  {t('mobile.security.passkeys.recoverDone')}
                </Text>
              ) : null}
              <TextField
                label={t('mobile.security.passkeys.recoverEmail')}
                value={recoverEmail}
                onChangeText={(next) => {
                  setRecoverEmail(next);
                  setRecoverError(null);
                }}
                keyboard="email-address"
                onSubmitEditing={() => {
                  void submitRecovery();
                }}
                testID="security-recover-email-input"
              />
              <Button
                label={recovering ? t('mobile.security.passkeys.recoverBusy') : t('mobile.security.passkeys.recoverSubmit')}
                onPress={() => {
                  void submitRecovery();
                }}
                tone="primary"
                loading={recovering}
                disabled={recovering || recoverEmail.trim() === ''}
                testID="security-recover-submit"
              />
            </Stack>
          )}
        </Stack>
      </Card>

      {/* ── 登录设备（逐枚撤销 + 退出这台 + 退出所有）────────── */}
      <SessionsSection
        baseUrl={baseUrl}
        token={token}
        onSignOutCurrentDevice={onSignOutCurrentDevice}
        onSignedOutEverywhere={onSignedOutEverywhere}
      />
    </Screen>
  );
}
