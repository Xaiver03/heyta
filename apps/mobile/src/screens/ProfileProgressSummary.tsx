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
import { Card, SectionHeader } from '../ui/kit';

export function ProfileProgressSummary({ onOpenGrowth }: { onOpenGrowth: () => void }): React.JSX.Element | null {
  const { t } = useI18n();
  const { now } = useToday();
  const { dataRevision } = useMobileSync();
  const [tables, setTables] = useState<MotivationTables | null>(null);
  const [localWriteRevision, setLocalWriteRevision] = useState(0);

  // `dataRevision` advances after sync/conflict handling. Local task, focus, and
  // habit writes emit through the host's write signal instead, so a persistent
  // ProfileScreen must subscribe to both sources to keep this summary current.
  useEffect(() => onLocalWrite(() => {
    setLocalWriteRevision((revision) => revision + 1);
  }), []);

  useEffect(() => {
    let alive = true;
    void openTaskHost()
      .then((host) => {
        if (alive) setTables(host.getState());
      })
      .catch(() => {
        // 个人中心摘要是渐进增强；读取失败不应阻塞账号卡和设置入口。
      });
    return () => {
      alive = false;
    };
  }, [dataRevision, localWriteRevision]);

  const snapshot = useMemo(() => {
    if (tables === null) return null;
    const week = weeklyReviewFromState(tables, now);
    const milestones = milestonesFromState(tables);
    const reached = milestones.reduce((sum, milestone) => sum + (milestone.reached ? 1 : 0), 0);
    const total = milestones.length;
    return { week, reached, total };
  }, [tables, now]);

  if (snapshot === null) return null;

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
      </Card>
    </>
  );
}
