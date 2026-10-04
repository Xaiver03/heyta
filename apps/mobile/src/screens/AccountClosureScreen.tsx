/**
 * 「我的 → 注销账号」—— 移动端那一条**主动**路径（批次 E3）
 * ==========================================================
 *
 * 补的是同一个洞：服务端那个 `DELETE /api/account` 存在了很久，而三个宿主里
 * 没有任何一个调用过它。E2 把"收到注销信号就清本机"装好了，可那条反应在此之前
 * 只有一条被动来路（下一次同步撞上 401/410）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这一屏可以**没有** CLI 那道"未上传就硬拒"
 *
 * node-host 那条（`cli-account.ts`）带了 `--confirm` 也照样拒绝未同步的账号。
 * 这里不挡，只把数字摆出来并要求打勾。区别不是松紧，是**确认能承载多少信息**：
 *
 *   · 终端上的 `--confirm` 是一个字面量 —— 有没有未上传的 op，敲下的字一模一样，
 *     所以那层确认**结构上**承载不了那个信息，只能由程序替用户挡。
 *   · 这一屏的勾选配着一句写着现量数字的话（「这台设备上还有 N 条改动没同步出去」，
 *     N 来自 `pendingUploadCount()`）。用户是在读过具体后果之后打的勾。
 *
 * ⚠️ 这条差异是刻意的，也允许被推翻（"移动上也该硬挡"）。若要改，改这里，
 * 同时 `apps/mobile/tests/account-closure-entry.spec.ts` 里那条
 * "勾选框与未上传那一句成对存在"的判据会跟着变 —— 它负责让"话和代码分家"这件事可见。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 顺序与句子都不在本文件里判断
 *
 *   · "服务端没删成 ⇒ 本机一个字节都不动" → `@heyta/app-host/account-closure.ts`；
 *   · "这台设备清哪些东西" → `openAppHost` 的销毁器兜底（移动端是 op-sqlite 那个文件）；
 *   · 四种结局各说哪句话 → `@heyta/ui` 的 `accountClosureMessageKey`（Web 读同一份）。
 *
 * 本文件只做：读配置、请求出境前过同意闸门、摆状态、把结果交给宿主。
 *
 * ⚠️ `onClosed` 是**宿主**的活：清凭据在移动端是四件事（凭据、小组件快照、表单状态、
 * 账号邮箱），这屏一件都没做，它只知道"账号没了"。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View } from 'react-native';

import { closeAccountAndEraseLocal, type ClosureResult } from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';
import { accountClosureMessageKey } from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import { consentFetch } from '../privacy/consent-gate';
import { readSyncConfig } from '../sync/config';
import { useTheme, useTokens } from '../theme';
import { Button, Card, Checkbox, HStack, Screen, Text } from '../ui/kit';

export function AccountClosureScreen({
  onBack,
  onClosed,
}: {
  onBack: () => void;
  /**
   * 账号确认没了之后回调一次。🔴 只在 `disposition !== 'not-closed'` 时调 ——
   * 反过来会把"请求失败"演成"已注销"，而用户接着做的事是删掉备份、把设备卖掉。
   */
  onClosed: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const { native } = useTheme();

  const config = readSyncConfig();
  const baseUrl = config?.serverUrl ?? '';
  const token = config?.token ?? '';
  const signedIn = baseUrl !== '' && token !== '';

  const [pending, setPending] = useState<number | undefined>(undefined);
  const [acked, setAcked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClosureResult | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void openTaskHost()
      .then((host) => host.pendingUploadCount())
      .then((count) => {
        if (alive) setPending(count);
      })
      .catch((error: unknown) => {
        // 读不到就当**不知道**：不显示 0（那句会让人敢按下），也不显示"未知"
        //（会被读成"那就是没有"）。整行不进树。
        console.warn('[account-closure] 读未上传条数失败', error);
        if (alive) setPending(undefined);
      });
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const submit = useCallback(async (): Promise<void> => {
    // in-flight 守卫**写在函数里**，不只靠按钮的 `disabled`：双击会发两条 DELETE，
    // 第二条拿到"账号已经不在了"的失败，于是界面在"已注销"之后又显示"没有注销"。
    if (busy || !acked || !signedIn) return;
    setBusy(true);
    setConfirming(false);
    setResult(null);
    try {
      // 🔴 `consentFetch`：注销也是出境。没同意时它一个字节都不发，
      // 而 `closeAccount` 把那份拦截归一成 `consent-required` —— 界面上是那句
      // "你还没同意这台设备的隐私规则"，不是"网络不可用"。
      const closure = await closeAccountAndEraseLocal(
        { baseUrl, fetchImpl: consentFetch },
        token,
      );
      setResult(closure);
      if (closure.disposition !== 'not-closed') onClosed();
    } finally {
      setBusy(false);
    }
  }, [acked, baseUrl, busy, onClosed, signedIn, token]);

  // 词表以外的情形由共享层落到保守那一句（"没注销、本机没动"），这里不兜第二层。
  const messageKey = result === null ? undefined : accountClosureMessageKey(result);

  return (
    <Screen
      title={t('common.accountClosure.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      <Card>
        <Text variant="caption">{t('common.accountClosure.lead')}</Text>
        <Text variant="caption" tone="muted">
          {t('common.accountClosure.exportHint')}
        </Text>
        {signedIn ? null : (
          <Text variant="caption" tone="muted">
            {t('common.accountClosure.needLogin')}
          </Text>
        )}
      </Card>

      {signedIn && pending !== undefined && pending > 0 ? (
        <HStack gap="tight" testID="account-closure-pending">
          <Text variant="caption" tone="danger" grow>
            {t('common.accountClosure.pending', { count: pending })}
          </Text>
        </HStack>
      ) : null}

      {signedIn ? (
        <HStack gap="tight" align="center" testID="account-closure-ack">
          <Checkbox
            checked={acked}
            busy={busy}
            onToggle={() => {
              setAcked((current) => !current);
              setConfirming(false);
              setResult(null);
            }}
            label={t('common.accountClosure.confirmLocal')}
          />
          <Text variant="caption" tone="muted" grow>
            {t('common.accountClosure.confirmLocal')}
          </Text>
        </HStack>
      ) : null}

      {acked && result === null ? (
        <Button
          label={t('common.accountClosure.action')}
          tone="danger"
          disabled={busy}
          loading={busy}
          onPress={() => {
            setConfirming(true);
          }}
        />
      ) : null}

      {messageKey === undefined ? null : (
        <HStack gap="tight" testID="account-closure-result">
          <Text
            variant="caption"
            tone={result && result.disposition !== 'not-closed' ? 'warning' : 'danger'}
            grow
            selectable
          >
            {t(messageKey)}
          </Text>
        </HStack>
      )}

      {confirming ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => {
            setConfirming(false);
          }}
          accessibilityViewIsModal
        >
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              padding: tokens['screen.gutter'],
              backgroundColor: tokens['color.overlay'],
            }}
          >
            <View
              testID="account-closure-confirm-dialog"
              style={[
                {
                  gap: tokens['space.4'],
                  padding: tokens['space.5'],
                  borderRadius: tokens['radius.lg'],
                  backgroundColor: tokens['color.surface-raised'],
                },
                native.shadow('shadow.lg') ?? undefined,
              ]}
            >
              <HStack gap="tight" align="center">
                <Text variant="section-title" grow>
                  {t('common.accountClosure.confirmTitle')}
                </Text>
              </HStack>
              <Text variant="caption" tone="muted">
                {t('common.accountClosure.lead')}
              </Text>
              {pending !== undefined && pending > 0 ? (
                <Text variant="caption" tone="danger">
                  {t('common.accountClosure.pending', { count: pending })}
                </Text>
              ) : null}
              <HStack gap="default">
                <Button
                  label={t('common.accountClosure.cancel')}
                  tone="secondary"
                  style={{ flex: 1 }}
                  onPress={() => {
                    setConfirming(false);
                  }}
                />
                <Button
                  label={t('common.accountClosure.action')}
                  tone="danger"
                  disabled={busy}
                  style={{ flex: 1 }}
                  onPress={() => {
                    void submit();
                  }}
                />
              </HStack>
            </View>
          </View>
        </Modal>
      ) : null}
    </Screen>
  );
}
