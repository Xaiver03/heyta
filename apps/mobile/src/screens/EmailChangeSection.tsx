/**
 * 「更换登录邮箱」—— 换绑那张活请求在移动端的**发起面**
 * ====================================================
 *
 * 裁决在 [ADR-0063](../../../../docs/adr/0063-email-rebinding-and-per-session-revocation.md)。
 * 协议、路径、失败归类、阶段判定全部在 `@heyta/app-host` 的 `account-security.ts`，
 * 本文件**一条都不重述**。
 *
 * ## 🔴 界面上那句"还等谁点"只有一个来源
 *
 * `getEmailChangeStatus()` + `emailChangeStage()`。
 *
 * 组件**不许**自己记"我刚点了发起、所以现在是等待中"：那半句话在
 * 这个屏活不过一次切标签（`SettingsScreen` 是 RN `Modal`，`visible={false}`
 * 时 children **整体卸载**，见那个文件头）。本地记的后果不是"不好看"，
 * 而是**界面会指着一封没人点过的信说"另一边已经确认了"** ——
 * 而那张换绑请求还在库里等着，用户以为已经改完了。
 *
 * 判据（`tests/account-security-wiring.spec.ts`）：本文件**不许**出现
 * `useState<EmailChangeStage>` 或任何"本地阶段"。
 *
 * ## 这一屏**不会**把邮箱改掉
 *
 * 生效发生在两个收件箱里各点一次之后，而那一侧的出口是服务端渲染的
 * `/change-email?token=` 凭据页 —— 客户端**刻意没有** confirm 这条路
 * （`account-security.ts` 文件头写了理由：那两个邮箱各自的时序判断只能有一个裁决点）。
 * 所以这里的成功文案只能是"两封信已经发出"，永远不能是"已更换"。
 *
 * ## 为什么这段挂在 `profileEditor` 里
 *
 * 它紧接在只读的邮箱行**下面** —— `common.profile.email.hint` 那句
 * "请用下面的「更换登录邮箱」"指的就是这里。那句指引一旦指不到东西，
 * 就是一句比空白更糟的假话。而表单**不能**进「我的」的滚动流
 * （`check:mobile-settings` R3 与 `profile-settings-ia.spec.ts` 钉着），
 * 所以这里是一个自带卡片的外挂组件，由 `profileEditor` 摆进去。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import type { EmailChangeStatusResponse } from '@heyta/shared-schema';
import {
  cancelEmailChange,
  emailChangeStage,
  getEmailChangeStatus,
  requestEmailChange,
  type HostedAuthFailure,
} from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';
import { authFailureMessage, SettingsRow } from '@heyta/ui';

import { Button, Card, Stack, Text, TextField } from '../ui/kit';
import {
  cooldownSecondsLeft,
  emailChangeFailureCopy,
  emailChangeStageCopy,
  type CopyMessage,
} from '../auth/account-security-copy';

/** 失败 → 句子：先问换绑特有的那几条，都没有才落共享词表（`@heyta/ui` 那一份）。 */
function toCopy(failure: HostedAuthFailure, cooldownSeconds: number): CopyMessage {
  return (
    emailChangeFailureCopy(failure.reason, cooldownSeconds) ??
    authFailureMessage({
      reason: failure.reason,
      policyCode: failure.policyCode,
      retryAfterSeconds: failure.retryAfterSeconds,
    })
  );
}

export function EmailChangeSection({
  baseUrl,
  token,
  currentEmail,
}: {
  readonly baseUrl: string;
  readonly token: string;
  readonly currentEmail: string | undefined;
}): React.JSX.Element {
  const { t, locale } = useI18n();

  /** 🔴 `null` = **还没读到**。它不能与"读到了、没有活请求"合并成同一个值。 */
  const [status, setStatus] = useState<EmailChangeStatusResponse | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<CopyMessage | null>(null);
  const [failure, setFailure] = useState<CopyMessage | null>(null);
  /** 冷却倒计时的"现在"。只在真的有冷却时才有定时器（见下面那个 effect）。 */
  const [now, setNow] = useState(() => Date.now());

  const hasSession = baseUrl.trim() !== '' && token.trim() !== '';

  const loadStatus = useCallback(async (): Promise<void> => {
    // 未登录 ⇒ **一个请求都不发**（与 `account-security.ts` 的 bearer 闸同一条）。
    if (!hasSession) return;
    const outcome = await getEmailChangeStatus({ baseUrl, locale }, token);
    if (outcome.ok) {
      setStatus(outcome);
      setStatusFailed(false);
    } else {
      // 读不到状态**不等于**没有活请求 —— 必须留下"读失败"的痕迹。
      // 把 status 置回 null 会让界面显示"没有进行中的更换"，而那是一句假话：
      // 那张请求在服务端还活得好好的，两封信也还在两个收件箱里。
      setStatusFailed(true);
    }
  }, [baseUrl, token, locale, hasSession]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const cooldown = cooldownSecondsLeft(status?.resendAvailableAt, now);

  // 🔴 定时器只在**真的在冷却**时存在。常驻每秒重渲染一次是白烧电，
  // 而"到点了那行字自己消失"正是要被观测的效果。
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [cooldown]);

  /** 🔴 阶段的唯一来源：`status`（服务端）→ `emailChangeStage`。没有第二条路。 */
  const stage = status === null ? undefined : emailChangeStage(status);
  const stageKey = stage === undefined ? undefined : emailChangeStageCopy(stage);

  const submit = useCallback(async (): Promise<void> => {
    if (!hasSession || busy || draft.trim() === '') return;
    setBusy(true);
    setFailure(null);
    setNotice(null);
    const outcome = await requestEmailChange({ baseUrl, locale }, token, draft);
    if (outcome.ok) {
      // 这句是"信发出去了"，**不是**"邮箱改好了"。见文件头。
      setNotice({ key: 'common.emailChange.sent' });
      setDraft('');
      // "等哪一边"由服务端回话之后再画。
      await loadStatus();
    } else {
      setFailure(
        toCopy(
          outcome,
          // 冷却秒数**只**从服务端那次失败里取；本地那个倒计时是上一次读到的值，
          // 拿它当这次的依据会把一个已经过期的数字说成"还要等"。
          outcome.reason === 'email-change-cooldown'
            ? (outcome.retryAfterSeconds ?? 0)
            : 0,
        ),
      );
    }
    setBusy(false);
  }, [hasSession, busy, draft, baseUrl, locale, token, loadStatus]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!hasSession || busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await cancelEmailChange({ baseUrl, locale }, token);
    if (outcome.ok) {
      setNotice({ key: 'common.emailChange.cancelled' });
      await loadStatus();
    } else {
      setFailure(toCopy(outcome, cooldown));
    }
    setBusy(false);
  }, [hasSession, busy, baseUrl, locale, token, cooldown, loadStatus]);

  return (
    <Card gap="loose">
      <Stack gap="tight">
        <Text variant="row-title" tone="default">
          {t('common.emailChange.title')}
        </Text>
        <Text variant="row-meta" tone="muted">
          {t('common.emailChange.intro')}
        </Text>
      </Stack>

      <SettingsRow
        row={{
          kind: 'value',
          label: t('common.emailChange.currentLabel'),
          // 🔴 读不到登录邮箱时说"还没登录"那句，不说空串 ——
          // 空值会被读成"这个账号的邮箱是空的"，而那件事在这个系统里不存在。
          value: currentEmail ?? t('mobile.profile.account.offline'),
          tone: currentEmail === undefined ? 'subtle' : 'default',
          testID: 'email-change-current-row',
        }}
      />

      {notice === null ? null : (
        <View testID="email-change-notice">
          <Text variant="row-meta" tone="default">
            {t(notice.key, notice.vars)}
          </Text>
        </View>
      )}

      {failure === null ? null : (
        <View testID="email-change-failure">
          {/* selectable：用户会把这句复制去反馈（与 ProfileScreen 的同步错误行同一取舍）。 */}
          <Text variant="row-meta" tone="danger" selectable>
            {t(failure.key, failure.vars)}
          </Text>
        </View>
      )}

      {hasSession && status === null ? (
        <View testID="email-change-loading">
          <Text variant="caption" tone="subtle">
            {statusFailed ? t('mobile.emailChange.statusFailed') : t('mobile.emailChange.loading')}
          </Text>
        </View>
      ) : null}

      {/*
        🔴 这一整块的输入只有 `status`。`statusFailed` 时**不画**它 ——
        没有读到状态就没有阶段可说，硬要画只能说谎。
      */}
      {statusFailed || stageKey === undefined ? null : (
        <Stack gap="tight" testID="email-change-pending">
          <Text variant="row-meta" tone="default">
            {t(stageKey)}
          </Text>
          {status?.pendingEmail === undefined ? null : (
            <SettingsRow
              row={{
                kind: 'value',
                label: t('common.emailChange.pendingLabel'),
                value: status.pendingEmail,
                tone: 'muted',
                testID: 'email-change-pending-row',
              }}
            />
          )}
          {cooldown > 0 ? (
            // `numeric-body`：等宽数字，倒计时每秒换位数时这一行不横向抖。
            <View testID="email-change-cooldown">
              <Text variant="numeric-body" tone="subtle">
                {t('common.emailChange.cooldown', { seconds: cooldown })}
              </Text>
            </View>
          ) : null}
          <Button
            label={busy ? t('mobile.emailChange.busy') : t('common.emailChange.cancel')}
            onPress={() => {
              void cancel();
            }}
            tone="ghost"
            loading={busy}
            disabled={busy}
            testID="email-change-cancel"
          />
        </Stack>
      )}

      {statusFailed ? (
        <Button
          label={t('mobile.emailChange.refresh')}
          onPress={() => {
            void loadStatus();
          }}
          tone="ghost"
          testID="email-change-refresh"
        />
      ) : null}

      <TextField
        label={t('common.emailChange.newLabel')}
        value={draft}
        onChangeText={(next) => {
          setDraft(next);
          setFailure(null);
        }}
        keyboard="email-address"
        hint={t('mobile.emailChange.inboxHint')}
        onSubmitEditing={() => {
          void submit();
        }}
        testID="email-change-new-input"
      />
      <Button
        label={busy ? t('common.emailChange.busy') : t('common.emailChange.submit')}
        onPress={() => {
          void submit();
        }}
        tone="primary"
        disabled={!hasSession || draft.trim() === ''}
        loading={busy}
        testID="email-change-submit"
      />
      {hasSession ? null : (
        <Text variant="caption" tone="subtle">
          {t('mobile.emailChange.needSession')}
        </Text>
      )}
    </Card>
  );
}
