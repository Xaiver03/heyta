/**
 * 「我的」首屏的成长摘要。
 *
 * 这是个人中心的投影，不是第二个成长页：数字直接来自 app-host 的 motivation
 * 选择器，完整里程碑与热力图仍然只在 GrowthScreen 展开。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '@heyta/i18n';
import { milestonesFromState, weeklyReviewFromState, type MotivationTables } from '@heyta/app-host';

import { openTaskHost } from '../db/open-host';
import { useToday } from '../lib/use-today';
import { useMobileSync } from '../sync/store';
import { onLocalWrite } from '../sync/write-signal';
import { SPACING_ROLE } from '@heyta/design-system';
import { Pressable } from 'react-native';
import { Button, Card, HStack, SectionHeader, Stack, Text } from '../ui/kit';
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
        <SectionHeader title={t('mobile.profile.section.progress')} />
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

  /**
   * 🔴 2026-11-15：**竖排三行 → 横排三格**（照滴答清单的数据概览）。
   *
   * 原来三条是 `SettingsRow`（每行 56dp 高，标签在左、数字在右），
   * 三条占 170dp，而用户真正想看的只是三个数字。
   * 滴答的「我的」页是**横排三格**：数字在上（大）、标签在下（小），整块约 80dp。
   *
   * 锚点全部保留（`profile-progress-tasks` / `-focus` / `-growth`）——
   * `verify-mobile-*` 与三条源码判据靠它们定位。
   */
  const cells: readonly {
    label: string;
    value: string;
    testID: string;
    onPress?: () => void;
  }[] = [
    {
      label: t('mobile.profile.progress.tasks'),
      value: String(snapshot.week.tasksCompleted),
      testID: 'profile-progress-tasks',
    },
    {
      label: t('mobile.profile.progress.focus'),
      value: String(snapshot.week.focusMinutes),
      testID: 'profile-progress-focus',
    },
    {
      label: t('mobile.profile.progress.achievements'),
      value: `${String(snapshot.reached)}/${String(snapshot.total)}`,
      testID: 'profile-progress-growth',
      onPress: onOpenGrowth,
    },
  ];

  return (
    <>
      {/*
        🔴 组标题与它管辖的卡片要**成组**（4dp），不能交给 `Screen` 的 gap(16dp)。
        真机实测（`heyta-profile.xml`）：「近期状态」→ 第一行是 **32dp** ——
        16（Screen gap）+ 16（另一层）= 32，组标题浮在两组中间，
        而它本该"属于下面那一组"。

        `SPACING_ROLE['label-to-control']` 表达的就是这个关系。
        ⚠️ 只有这一个屏到此为止；其余 35 处 `SectionHeader` 的调用点还在
        `Screen` gap 之下 —— 逐个收敛是下一轮的事，这一轮先把实测超标的那一处修掉。
      */}
      <View style={{ gap: tokens[SPACING_ROLE['label-to-control']] }}>
        <SectionHeader title={t('mobile.profile.section.progress')} />
        <Card>
        <HStack gap="default">
          {cells.map((cell) => (
            <Pressable
              key={cell.testID}
              testID={cell.testID}
              onPress={cell.onPress}
              accessibilityRole={cell.onPress === undefined ? 'summary' : 'button'}
              style={{ flex: 1, alignItems: 'center' }}
            >
              <Text variant="headline">{cell.value}</Text>
              {/*
                🔴 2026-11-15：第三格（已达成成就）是成长屏的入口，但它和同排
                两个纯读数格长得**一模一样** —— 真机上看不出这一格能点。
                给可点的格子在标签后补一枚 chevron（14dp，克制到不抢数字），
                让"哪一格通向下一层"在视觉上可判。不可点的格保持原样。
              */}
              <HStack gap="tight" align="center">
                <Text variant="caption" tone="subtle">
                  {cell.label}
                </Text>
                {cell.onPress === undefined ? null : (
                  <Icon name="action.disclose" size="xs" color={tokens['color.foreground-subtle']} />
                )}
              </HStack>
            </Pressable>
          ))}
        </HStack>
        {readState === 'error' ? (
          <Stack>
            <Text variant="caption" tone="subtle">
              {t('mobile.profile.progress.stale')}
            </Text>
            <Button label={t('mobile.profile.progress.retry')} onPress={retry} tone="secondary" />
          </Stack>
        ) : null}
        </Card>
      </View>
    </>
  );
}
