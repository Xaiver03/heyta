/**
 * 「我的」首屏的成长摘要。
 *
 * 这是个人中心的投影，不是第二个成长页：数字直接来自 app-host 的 motivation
 * 选择器，完整里程碑与热力图仍然只在 GrowthScreen 展开。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@heyta/i18n';
import { milestonesFromState, weeklyReviewFromState, type MotivationTables } from '@heyta/app-host';
import { SettingsRow, settingsRowKey, type SettingsRowModel } from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import { useToday } from '../lib/use-today';
import { useMobileSync } from '../sync/store';
import { onLocalWrite } from '../sync/write-signal';
import { Button, Card, SectionHeader, Stack, Text } from '../ui/kit';
import { Icon } from '../ui/icons';
import { useTokens } from '../theme';

export function ProfileProgressSummary({ onOpenGrowth }: { onOpenGrowth: () => void }): React.JSX.Element | null {
  const { t } = useI18n();
  const tokens = useTokens();
  const { now } = useToday();
  const { dataRevision } = useMobileSync();
  const [tables, setTables] = useState<MotivationTables | null>(null);
  const [localWriteRevision, setLocalWriteRevision] = useState(0);
  const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryRevision, setRetryRevision] = useState(0);

  // `dataRevision` advances after sync/conflict handling. Local task, focus, and
  // habit writes emit through the host's write signal instead, so a persistent
  // ProfileScreen must subscribe to both sources to keep this summary current.
  useEffect(() => onLocalWrite(() => {
    setLocalWriteRevision((revision) => revision + 1);
  }), []);

  useEffect(() => {
    let alive = true;
    setReadState('loading');
    void openTaskHost()
      .then((host) => {
        if (!alive) return;
        setTables(host.getState());
        setReadState('ready');
      })
      .catch(() => {
        // 个人中心摘要是渐进增强；读取失败不应阻塞账号卡和设置入口。
        // 保留上一次成功的快照，避免一次本地读取抖动让用户以为数据消失。
        if (alive) setReadState('error');
      });
    return () => {
      alive = false;
    };
  }, [dataRevision, localWriteRevision, retryRevision]);

  const snapshot = useMemo(() => {
    if (tables === null) return null;
    const week = weeklyReviewFromState(tables, now);
    const milestones = milestonesFromState(tables);
    const reached = milestones.reduce((sum, milestone) => sum + (milestone.reached ? 1 : 0), 0);
    const total = milestones.length;
    return { week, reached, total };
  }, [tables, now]);

  const retry = (): void => setRetryRevision((revision) => revision + 1);

  if (snapshot === null) {
    return (
      <>
        <SectionHeader icon="growth.week" title={t('mobile.profile.section.progress')} />
        <Card>
          <Stack>
            <Text variant="caption" tone="subtle">
              {readState === 'error'
                ? t('mobile.profile.progress.error')
                : t('mobile.profile.progress.loading')}
            </Text>
            {readState === 'error' ? (
              <Button label={t('mobile.profile.progress.retry')} onPress={retry} tone="secondary" />
            ) : null}
          </Stack>
        </Card>
      </>
    );
  }

  const rows: readonly SettingsRowModel[] = [
    {
      kind: 'value',
      label: t('mobile.profile.progress.tasks'),
      value: String(snapshot.week.tasksCompleted),
      valueTestID: 'profile-progress-tasks',
    },
    {
      kind: 'value',
      label: t('mobile.profile.progress.focus'),
      value: String(snapshot.week.focusMinutes),
      valueTestID: 'profile-progress-focus',
    },
    {
      kind: 'value',
      label: t('mobile.profile.progress.achievements'),
      value: `${String(snapshot.reached)}/${String(snapshot.total)}`,
      valueTestID: 'profile-progress-achievements',
    },
    {
      kind: 'action',
      label: t('mobile.profile.progress.openGrowth'),
      hint: t('mobile.profile.progress.openGrowthHint'),
      testID: 'profile-progress-growth',
      leading: <Icon name="growth.week" size="sm" color={tokens['color.foreground-muted']} />,
      onPress: onOpenGrowth,
    },
  ];

  return (
    <>
      <SectionHeader icon="growth.week" title={t('mobile.profile.section.progress')} />
      <Card>
        {rows.map((row, index) => (
          <SettingsRow key={settingsRowKey(row, index)} row={row} />
        ))}
        {readState === 'error' ? (
          <Stack>
            <Text variant="caption" tone="subtle">
              {t('mobile.profile.progress.stale')}
            </Text>
            <Button label={t('mobile.profile.progress.retry')} onPress={retry} tone="secondary" />
          </Stack>
        ) : null}
      </Card>
    </>
  );
}
