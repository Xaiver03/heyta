/**
 * 通知中心 / 活动（移动端第二层屏）
 * ===================================
 *
 * 🔴 **这个屏补的是移动端的一个真实空洞**（多端覆盖审计 P0-2）：
 * `app-host` 的 inbox 三函数一直都在，但 `apps/mobile` 从未 import 过任何一个
 * —— 邀请得会员是已上线的运营功能，移动端登录用户完全看不见。
 * 本屏与 web 的 `InboxBell` 消费**同一批函数、同一个封闭词表**
 * （`@heyta/domain` 的 `parseNotificationPayload`，见 `lib/inbox-display.ts`），
 * 形态按移动壳惯例：第二层屏（顶栏返回）+ 页内两 tab（chips）。
 *
 * 三条与 web 同源的纪律（那边实测换来的，别"简化"掉）：
 *
 * 1. **通知与活动分开加载**：`GET /api/activity` 会**惰性创建邀请码**，
 *    徽标那次加载顺带拉活动 = 给每个用户每次启动都写一行邀请码。
 *    所以活动只在「活动」tab 第一次被打开时拉。
 * 2. **读不到时不清空已有数据**：`unavailable` 只改状态。清空的后果是
 *    用户看到"还没有通知"，而真相是"这次没读到" —— 前者是结论，后者是失败。
 * 3. **打开通知列表即自动已读**（goal 批二的裁决，微信/滴答式）：
 *    拉到未读 > 0 → `markNotificationsRead({all})` → 回读一次未读数上报
 *    （入口徽标随它清零）。`ids` 省略 = 请求体 `{all:true}`，不是空体 ——
 *    服务端刻意不接受"缺省即全部"，客户端 bug 会被 400 照出来。
 *
 * 出口闸：全局 `fetch` 已被 `consent-gate.ts` 换成带闸的版本（未同意一个字节
 * 都不出设备）；这里再用 `privacyConsent.networkAllowed()` 挡一次**发起**，
 * 让界面停在"还没拉过"而不是写出一条"读不到" —— 与 web 的 pollNotifications
 * 同一个理由：对着一发出去就会被拦的请求说"稍后重试"，重试永远不会有用。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { formatCompactDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { EmptyState } from '@heyta/ui';
import {
  fetchAccountNotifications,
  fetchActivityFeed,
  markNotificationsRead,
  type AccountNotificationItem,
  type CampaignItem,
  type InboxUnavailableCause,
} from '@heyta/app-host';

import { Button, Card, Chip, HStack, Screen, Stack, Text } from '../ui/kit';
import { toRenderableNotifications } from '../lib/inbox-display';
import { privacyConsent } from '../privacy/consent-gate';
import { readSyncConfig } from '../sync/config';
import { useTokens } from '../theme';

type LoadState = 'ready' | 'unconfigured' | 'unavailable' | null;

export function NotificationsScreen({
  onBack,
  onUnreadCountChange,
}: {
  /** 返回「我的」。宿主在返回时会重读一次未读数刷新入口徽标。 */
  onBack: () => void;
  /** 每次读到可信的未读数都上报（含"自动已读后归零"）—— 入口徽标的唯一数据源。 */
  onUnreadCountChange: (count: number) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();

  // 凭据在挂载时读一次（本屏是一次性第二层表面，不是常驻状态）。
  const config = useMemo(() => readSyncConfig(), []);
  const baseUrl = config?.serverUrl ?? '';
  const getToken = useCallback(async () => config?.token, [config]);

  const [tab, setTab] = useState<'notifications' | 'activity'>('notifications');

  const [notifications, setNotifications] = useState<readonly AccountNotificationItem[]>([]);
  const [notificationsState, setNotificationsState] = useState<LoadState>(null);
  const [notificationsCause, setNotificationsCause] = useState<InboxUnavailableCause | undefined>(
    undefined,
  );
  const [loadingNotifications, setLoadingNotifications] = useState(false);

  // `null` = 还没拉过（惰性建码语义：没打开过活动 tab 就不该有请求）。
  const [campaigns, setCampaigns] = useState<readonly CampaignItem[] | null>(null);
  const [activityState, setActivityState] = useState<LoadState>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);

  const [shareFailed, setShareFailed] = useState(false);

  const loadNotifications = useCallback(
    async (allowMarkRead: boolean): Promise<void> => {
      if (baseUrl === '') {
        setNotificationsState('unconfigured');
        return;
      }
      if (!privacyConsent.networkAllowed()) return;
      setLoadingNotifications(true);
      const reading = await fetchAccountNotifications({ baseUrl, getToken });
      if (reading.kind === 'ready') {
        setNotifications(reading.notifications);
        setNotificationsState('ready');
        onUnreadCountChange(reading.unreadCount);
        // 打开即已读（见文件头 3）：mark 全部 → 回读一次，把归零后的未读数报给徽标。
        if (allowMarkRead && reading.unreadCount > 0) {
          const mark = await markNotificationsRead({ baseUrl, getToken });
          if (mark.kind === 'ok') {
            const fresh = await fetchAccountNotifications({ baseUrl, getToken });
            if (fresh.kind === 'ready') {
              setNotifications(fresh.notifications);
              onUnreadCountChange(fresh.unreadCount);
            }
          }
        }
      } else if (reading.kind === 'unconfigured') {
        setNotificationsState('unconfigured');
      } else {
        setNotificationsState('unavailable');
        setNotificationsCause(reading.cause);
      }
      setLoadingNotifications(false);
    },
    [baseUrl, getToken, onUnreadCountChange],
  );

  const loadActivity = useCallback(async (): Promise<void> => {
    if (baseUrl === '') {
      setActivityState('unconfigured');
      return;
    }
    if (!privacyConsent.networkAllowed()) return;
    setLoadingActivity(true);
    const reading = await fetchActivityFeed({ baseUrl, getToken });
    if (reading.kind === 'ready') {
      setCampaigns(reading.campaigns);
      setActivityState('ready');
    } else if (reading.kind === 'unconfigured') {
      setActivityState('unconfigured');
    } else {
      setActivityState('unavailable');
    }
    setLoadingActivity(false);
  }, [baseUrl, getToken]);

  useEffect(() => {
    void loadNotifications(true);
  }, [loadNotifications]);

  useEffect(() => {
    if (tab === 'activity' && campaigns === null) void loadActivity();
  }, [tab, campaigns, loadActivity]);

  const renderable = toRenderableNotifications(notifications);
  const invite = campaigns?.find((c) => c.kind === 'invite' && c.invite !== undefined)?.invite;

  const notice = (
    state: 'unconfigured' | 'unavailable' | null,
    loading: boolean,
    onRetry: () => void,
  ): React.JSX.Element | null => {
    if (state === 'unconfigured') {
      return (
        <Text variant="row-meta" tone="subtle">
          {t('mobile.inbox.unconfigured')}
        </Text>
      );
    }
    if (state === 'unavailable') {
      return (
        <Stack>
          <Text variant="row-meta" tone="danger">
            {t('mobile.inbox.error')}
          </Text>
          <Button label={t('mobile.inbox.retry')} onPress={onRetry} />
        </Stack>
      );
    }
    if (loading) {
      return (
        <Text variant="row-meta" tone="subtle">
          {t('mobile.inbox.loading')}
        </Text>
      );
    }
    return null;
  };

  const notificationsBody = (): React.JSX.Element | null => {
    const placeholder = notice(
      notificationsState === 'ready' ? null : notificationsState,
      loadingNotifications,
      () => {
        void loadNotifications(true);
      },
    );
    if (placeholder !== null) return placeholder;
    if (notificationsState !== 'ready') return null;

    if (renderable.length === 0) {
      return <EmptyState title={t('mobile.inbox.empty')} testID="inbox-notifications-empty" />;
    }
    return (
      <Stack testID="inbox-notifications-list">
        {renderable.map(({ item, payload }) => {
          const bodyText =
            payload.displayName === null
              ? t('mobile.inbox.notification.referral.bodyUnknownActor', { days: payload.days })
              : t('mobile.inbox.notification.referral.body', {
                  name: payload.displayName,
                  days: payload.days,
                });
          return (
            <Card key={item.id}>
              <HStack align="center">
                {item.readAt === null ? (
                  <View
                    style={{
                      width: tokens['space.3'],
                      height: tokens['space.3'],
                      borderRadius: tokens['radius.full'],
                      backgroundColor: tokens['color.primary'],
                    }}
                  />
                ) : null}
                <Text variant="row-title" tone="default" style={{ flex: 1 }}>
                  {t('mobile.inbox.notification.referral.title')}
                </Text>
                <Text variant="caption" tone="subtle">
                  {formatCompactDate(item.createdAt, Date.now())}
                </Text>
              </HStack>
              <Text variant="row-meta" tone="muted">
                {bodyText}
              </Text>
            </Card>
          );
        })}
      </Stack>
    );
  };

  const activityBody = (): React.JSX.Element | null => {
    if (activityState === 'unconfigured' || activityState === 'unavailable') {
      return (
        notice(activityState, loadingActivity, () => {
          void loadActivity();
        }) ?? null
      );
    }
    if (campaigns === null) {
      return (
        <Text variant="row-meta" tone="subtle">
          {loadingActivity ? t('mobile.inbox.loading') : ''}
        </Text>
      );
    }
    if (invite === undefined) {
      return <EmptyState title={t('mobile.inbox.activity.empty')} testID="inbox-activity-empty" />;
    }
    const remaining = Math.max(0, invite.windowCap - invite.windowInvited);
    return (
      <Card>
        <Text variant="row-title" tone="default">
          {t('mobile.inbox.invite.title')}
        </Text>
        <Text variant="row-meta" tone="muted">
          {t('mobile.inbox.invite.body', { days: invite.rewardDays })}
        </Text>

        <View
          style={{
            backgroundColor: tokens['color.surface-sunken'],
            borderRadius: tokens['radius.md'],
            padding: tokens['space.3'],
            gap: tokens['space.1'],
          }}
        >
          <Text variant="caption" tone="subtle">
            {t('mobile.inbox.invite.codeLabel')}
          </Text>
          {/*
            🔴 码的无障碍名给**完整语义**（「邀请码 XXXX」），既让读屏念得懂，
            也让真机验收脚本能从 content-desc 里唯一定位并**抓出码值**
            （#45：text/content-desc 双面，desc 是脚本这边的一手）。
            ⚠️ **必须用 `Pressable`**：RN 安卓上普通 `View` 就算加了
            `accessible` + accessibilityLabel 也不会变成 content-desc
            （两轮实测：码画在屏幕上、脚本解析不到）；而 `Pressable` 会
            （DatePicker 的日子格就是铁证）。点码即分享 —— 也是真实交互。
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.inbox.invite.codeAria', { code: invite.inviteCode })}
            onPress={() => {
              void Share.share({
                message: t('mobile.inbox.invite.shareMessage', { code: invite.inviteCode }),
              })
                .then(() => {
                  setShareFailed(false);
                })
                .catch(() => {
                  setShareFailed(true);
                });
            }}
            style={{ alignSelf: 'flex-start' }}
          >
            <Text variant="row-title" tone="default">
              {invite.inviteCode}
            </Text>
          </Pressable>
        </View>

        <Button
          label={t('mobile.inbox.invite.share')}
          onPress={() => {
            void Share.share({
              message: t('mobile.inbox.invite.shareMessage', { code: invite.inviteCode }),
            })
              .then(() => {
                setShareFailed(false);
              })
              .catch(() => {
                // 用户取消分享在安卓上也可能走 reject；码就在界面上，失败要说出口。
                setShareFailed(true);
              });
          }}
          tone="primary"
        />
        {shareFailed ? (
          <Text variant="caption" tone="danger">
            {t('mobile.inbox.invite.shareFailed')}
          </Text>
        ) : null}

        <Text variant="row-meta" tone="muted">
          {t('mobile.inbox.invite.stats', {
            invited: invite.invited,
            activated: invite.activated,
            days: invite.daysEarned,
          })}
        </Text>
        <Text variant="caption" tone="subtle">
          {t('mobile.inbox.invite.remaining', { count: remaining })}
        </Text>

        {invite.referrals.length > 0 ? (
          <Stack>
            <Text variant="caption" tone="subtle">
              {t('mobile.inbox.invite.listTitle')}
            </Text>
            {invite.referrals.map((referral) => (
              <HStack key={referral.code} align="center">
                <Text variant="row-meta" tone="default" style={{ flex: 1 }}>
                  {referral.displayName ?? t('mobile.inbox.invite.unknownName')}
                </Text>
                <Text variant="caption" tone={referral.activatedAt === null ? 'muted' : 'default'}>
                  {referral.activatedAt === null
                    ? t('mobile.inbox.invite.status.pending')
                    : t('mobile.inbox.invite.status.activated')}
                </Text>
              </HStack>
            ))}
          </Stack>
        ) : null}
      </Card>
    );
  };

  return (
    // 返回是顶栏动作 —— 本屏是「我的」下面的第二层，没有第 6 个 tab。
    <Screen
      title={t('mobile.inbox.title')}
      actions={[{ icon: 'action.back', label: t('mobile.inbox.back'), onPress: onBack }]}
    >
      <HStack>
        <Chip
          label={t('mobile.inbox.tab.notifications')}
          selected={tab === 'notifications'}
          onPress={() => {
            setTab('notifications');
          }}
        />
        <Chip
          label={t('mobile.inbox.tab.activity')}
          selected={tab === 'activity'}
          onPress={() => {
            setTab('activity');
          }}
        />
      </HStack>
      {tab === 'notifications' ? notificationsBody() : activityBody()}
    </Screen>
  );
}
