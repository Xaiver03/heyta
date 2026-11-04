/**
 * 「登录设备」—— 一枚访问令牌 = 一行，逐枚撤销
 * =============================================
 *
 * 裁决在 [ADR-0063](../../../../docs/adr/0063-email-rebinding-and-per-session-revocation.md) §2.5；
 * 协议、路径、失败归类全在 `@heyta/app-host` 的 `account-security.ts`，本文件一条都不重述。
 *
 * ## 🔴 这一屏补的是"退出登录"这四个字的谎
 *
 * 在这一族端点存在之前，移动端的"退出"只删本机凭据，而那枚 JWT 在服务端**还能用一整年**
 * （`session-contract.ts` 文件头记的就是这件事）。所以那之前这句界面在共享电脑上是假的。
 * 这里的每一行都对应**一枚真的会被作废的令牌**。
 *
 * ## 三件事各是一条不同的路，不许合并
 *
 * | 动作 | 打哪一发 | 之后本机怎么办 |
 * |---|---|---|
 * | 退出**那一台** | `revokeHostedSession(id)` | 什么都不动（不是这台） |
 * | 退出**这台** | `logoutCurrentDevice` + `planSignOut` | **一定**清本机凭据 |
 * | 退出**所有**台 | `logoutEveryDevice` | **一定**清本机凭据 —— 服务端删全部会话行 + `tokenVersion++`，手上这枚一起死了 |
 *
 * 🔴 最后那一行的后果很容易被漏掉：调用方**必须**把本机凭据也清掉，
 * 否则界面会停在一枚服务端已经不认的令牌上，下一次同步 401，
 * 而用户看到的是"我点了退出所有设备，这台反而坏了"。
 * 这一条不在本文件里判 —— 它由 `planSignOut()` 说，由调用方（`SecurityScreen` /
 * `ProfileScreen`）执行；本文件只负责把那两条出口**接对**。
 *
 * ## 列表的真相只来自服务端
 *
 * 撤销那一行之后本地摘掉它（`revokeHostedSession` 回传的 `sessionId` 就是权威 ——
 * 见 `account-security.ts` 那条注释），但**任何**失败都重拉一次整张表：
 * `unknown-session` 的三种成因（不存在 / 不是你的 / 已经撤过）在服务端故意同一句，
 * 客户端唯一诚实的动作是"再看一遍"。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import type { SessionSummary } from '@heyta/shared-schema';
import {
  listHostedSessions,
  logoutEveryDevice,
  revokeHostedSession,
  type HostedAuthFailure,
} from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';
import { authFailureMessage, EmptyState, SettingsSection, type SettingsRowModel } from '@heyta/ui';

import { Button, HStack, Text } from '../ui/kit';
import { formatStamp } from '../lib/date';
import { sessionDeviceLabel, type CopyMessage } from '../auth/account-security-copy';

/**
 * 会话这条路上的失败 → 句子。
 *
 * 🔴 共享词表落到 `common.auth.error.unknown`（那句"说不清哪儿错了"）时，
 * 本屏改用**这一族自己**那句 `common.sessions.failed` —— 它的动作更准：
 * "这一列表没刷新成，再看一遍"，而不是一个通用报错。
 * 其余原因（`unknown-session` / `unauthorized` / `consent-required`…）
 * 一律交回共享词表，本文件**不抄第二份**。
 */
function sessionFailureCopy(failure: HostedAuthFailure): CopyMessage {
  const shared = authFailureMessage({
    reason: failure.reason,
    retryAfterSeconds: failure.retryAfterSeconds,
  });
  if (shared.key === 'common.auth.error.unknown') return { key: 'common.sessions.failed' };
  return { key: shared.key, vars: shared.vars };
}

export function SessionsSection({
  baseUrl,
  token,
  onSignOutCurrentDevice,
  onSignedOutEverywhere,
}: {
  readonly baseUrl: string;
  readonly token: string;
  /** 「退出登录」：撤销手上这一枚 **并**清本机（编排见 `sign-out-flow.ts`）。 */
  readonly onSignOutCurrentDevice: () => void;
  /** 「退出所有设备」成功之后手上这枚也死了 ⇒ 走与退出登录**同一条**本机清理。 */
  readonly onSignedOutEverywhere: () => void;
}): React.JSX.Element {
  const { t, locale } = useI18n();

  /** 🔴 `null` = **还没读到**，与"读到了、一张会话都没有"是两件事。 */
  const [sessions, setSessions] = useState<readonly SessionSummary[] | null>(null);
  const [failure, setFailure] = useState<HostedAuthFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const hasSession = baseUrl.trim() !== '' && token.trim() !== '';

  const load = useCallback(async (): Promise<void> => {
    if (!hasSession) return;
    const outcome = await listHostedSessions({ baseUrl, locale }, token);
    if (outcome.ok) {
      setSessions(outcome.sessions);
      setFailure(null);
    } else {
      setFailure(outcome);
    }
  }, [baseUrl, token, locale, hasSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = useCallback(
    async (session: SessionSummary): Promise<void> => {
      if (!hasSession || busy) return;
      setBusy(true);
      setFailure(null);
      const outcome = await revokeHostedSession({ baseUrl, locale }, token, session.sessionId);
      if (outcome.ok) {
        // 服务端回了它撤掉的正是这一枚 ⇒ 就地摘掉这一行是可信的，不是乐观更新。
        setSessions((current) =>
          current === null ? current : current.filter((row) => row.sessionId !== outcome.sessionId),
        );
      } else {
        setFailure(outcome);
        await load();
      }
      setBusy(false);
    },
    [baseUrl, locale, token, hasSession, busy, load],
  );

  const askRevoke = useCallback(
    (session: SessionSummary, device: string): void => {
      Alert.alert(t('mobile.sessions.revoke.title'), device, [
        { text: t('mobile.common.cancel'), style: 'cancel' },
        {
          text: t('common.sessions.revoke'),
          style: 'destructive',
          onPress: () => {
            void revoke(session);
          },
        },
      ]);
    },
    [t, revoke],
  );

  const signOutEverywhere = useCallback(async (): Promise<void> => {
    if (!hasSession || busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await logoutEveryDevice({ baseUrl, locale }, token);
    if (outcome.ok) {
      // 🔴 手上这枚**一起死了** ⇒ 交给调用方走与「退出登录」同一条本机清理，
      // 并给那句"包括这台"的实话。这里不清本机：本机清哪些存储只有宿主知道。
      onSignedOutEverywhere();
      return;
    }
    setFailure(outcome);
    setBusy(false);
  }, [baseUrl, locale, token, hasSession, busy, onSignedOutEverywhere]);

  const askSignOutEverywhere = useCallback((): void => {
    /* 上面那句是危险确认框的正文（后果句），按 overlay-feedback.md 就该在这儿说清楚。 */
    // settings-prose-ok: 危险确认框正文，不是设置项说明
    Alert.alert(t('mobile.sessions.logoutAll.title'), t('mobile.sessions.logoutAll.message'), [
      { text: t('mobile.common.cancel'), style: 'cancel' },
      {
        text: t('common.sessions.logoutAll'),
        style: 'destructive',
        onPress: () => {
          void signOutEverywhere();
        },
      },
    ]);
  }, [t, signOutEverywhere]);

  const unlabeled = t('mobile.security.passkeys.unnamed');
  const failureCopy = failure === null ? null : sessionFailureCopy(failure);

  /*
    🔴 这一屏的行骨架**归共享契约**（治理计划 G-4 的 mobile 那一格，2026-11-04）。
    迁之前它自己手搓一套（`Stack` + `Divider` + `HStack` 标签行 + 时间戳行 + 按钮行），
    而 web 同形那一格已经吃 `trailing` —— 两份骨架的差异不会让任何测试变红，
    只会让"一行登录设备"在两端长成两种留白与两种层级。

    档位选择：
      · 每一台设备 = `trailing`（一个对象 + 几行事实 + 只对得起那个对象的尾随动作）。
        不用 `action` 档：那让**整行**可点，会把"看这一行"与"销毁这台设备"混成同一个手势。
      · 读失败那一句 = `host`（顺序与分组归契约，内容自己的解剖归它那一族）——
        它要保住 `selectable`（用户会把这句复制去反馈）与"在列表**上面**"这个位置，
        而 `note` 档的文字由共享层画，没有 `selectable` 这一层。
      · 「这台设备」那个记号进 `meta`（与 web 同形），提示句进 `note`，撤销按钮进 `actions`。
        ⚠️ `actions` 归宿主渲染：**这一端当前那一行不给撤销出口**（web 给的是禁用按钮），
        两种都满足 ADR-0063 §2.5「两个动作分开措辞」，G-4 统一的是骨架不是这个选择。

    🔴 真机脚本的锚点一个都不许动：`sessions-list`（`scroll_to_id`）、
    `sessions-revoke`（`count_id` 数几台可撤）、`sessions-logout-all`、`sessions-sign-out`、
    `sessions-refresh`、`sessions-failure`。列表容器靠 `listTestID` 透传，不是新造一层。
  */
  const rows: SettingsRowModel[] = [
    ...(failureCopy === null
      ? []
      : ([
          {
            kind: 'host',
            node: (
              <View testID="sessions-failure">
                <Text variant="row-meta" tone="danger" selectable>
                  {t(failureCopy.key, failureCopy.vars)}
                </Text>
              </View>
            ),
          },
        ] as SettingsRowModel[])),
    ...(sessions ?? []).map(
      (session): SettingsRowModel => {
        const device = sessionDeviceLabel(session, unlabeled);
        return {
          kind: 'trailing',
          testID: `session-row-${session.sessionId}`,
          divider: true,
          label: device,
          meta: (
            <>
              {session.current ? (
                <Text variant="caption" tone="primary">
                  {t('common.sessions.thisDevice')}
                </Text>
              ) : null}
              <HStack gap="default">
                {/* `numeric-body`：时间戳必须等宽，否则两行的分钟数对不齐。 */}
                <Text variant="numeric-body" tone="subtle">
                  {`${t('common.sessions.signedInSince')} ${formatStamp(session.createdAt)}`}
                </Text>
                <Text variant="numeric-body" tone="subtle">
                  {`${t('common.sessions.lastSeen')} ${formatStamp(session.lastSeenAt)}`}
                </Text>
              </HStack>
            </>
          ),
          note: session.current ? (
            <Text variant="caption" tone="subtle">
              {t('common.sessions.currentHint')}
            </Text>
          ) : null,
          actions: session.current ? null : (
            <Button
              label={t('common.sessions.revoke')}
              accessibilityLabel={t('mobile.sessions.revoke.aria', { device })}
              onPress={() => {
                askRevoke(session, device);
              }}
              tone="ghost"
              disabled={busy}
              testID="sessions-revoke"
            />
          ),
        };
      },
    ),
  ];

  return (
    <SettingsSection
      variant="card"
      testID="sessions-card"
      listTestID="sessions-list"
      title={t('common.sessions.title')}
      note={t('common.sessions.intro')}
      rows={rows}
    >
      {!hasSession ? (
        <Text variant="caption" tone="subtle">
          {t('mobile.sessions.needSession')}
        </Text>
      ) : sessions === null ? (
        <Text variant="caption" tone="subtle">
          {t('mobile.sessions.loading')}
        </Text>
      ) : sessions.length === 0 ? (
        // 共享空态的 `section` 档（与 `SecurityScreen` 的通行密钥卡片同一取舍）。
        <EmptyState size="section" title={t('common.sessions.empty')} />
      ) : null}

      {/*
        本轮之前签的令牌没有 `jti`，按枚撤销撤不动它们。
        这句是**实话**而不是故障说明 —— 少了它，用户在列表里找不到那台旧设备
        就会以为"它已经登出了"，而它还在登录着。
      */}
      <Text variant="caption" tone="subtle">
        {t('common.sessions.legacyHint')}
      </Text>

      <Button
        label={t('common.sessions.logoutAll')}
        onPress={askSignOutEverywhere}
        tone="danger"
        disabled={!hasSession || busy}
        loading={busy}
        testID="sessions-logout-all"
      />
      <Button
        label={t('mobile.signOut.button')}
        onPress={() => {
          onSignOutCurrentDevice();
        }}
        tone="ghost"
        disabled={!hasSession}
        testID="sessions-sign-out"
      />
      {failure !== null ? (
        <Button
          label={t('mobile.sessions.refresh')}
          onPress={() => {
            void load();
          }}
          tone="ghost"
          testID="sessions-refresh"
        />
      ) : null}
    </SettingsSection>
  );
}
