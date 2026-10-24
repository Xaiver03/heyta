/**
 * 设置页的「提醒送达」
 * ====================
 *
 * 提醒能不能响，卡在**系统**里的三道闸门上：通知授权、精确闹钟、省电豁免。
 * 之前这三道闸门只在任务详情面板里、而且只在"有提醒且被挡住"时才露一次脸 ——
 * 用户拒完之后想反悔，找不到第二次入口（通知授权一旦被系统拒掉，应用**自己再也
 * 问不出弹窗**，只能把人送去系统页面）。这一节就是那条常年的回头路。
 *
 * 🔴 判定（哪一行该出现、那一格说什么词、那一跳落到哪儿该怎么说）全在
 * `../lib/reminder-delivery-display.ts` 里，是可断言的纯函数；本文件只做
 * **平台绑定**：把读数摆成行、把点击接回原生（AGENTS §3.5）。
 *
 * ⚠️ "什么时候重读"不在本文件里，而在 `../lib/use-reminder-delivery.ts` ——
 * 提醒面那一行降级状态与这一节读的是**同一份**读数、同一套时机。两处各挂一个
 * `AppState` 监听迟早会漂成"设置页已经翻新、提醒面还挂着旧的那句"。
 */

import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import { useI18n } from '@heyta/i18n';
import { SettingsSection, type SettingsRowModel } from '@heyta/ui';

import { Icon } from '../ui/icons';
import { useTokens } from '../theme';
import {
  deliveryRows,
  type DeliveryRow,
} from '../lib/reminder-delivery-display';
import { useReminderDelivery } from '../lib/use-reminder-delivery';

export function ReminderDeliverySection(): React.JSX.Element | null {
  const { t } = useI18n();
  const tokens = useTokens();
  const { readings, landing, open } = useReminderDelivery();

  const rows = useMemo(() => (readings === null ? [] : deliveryRows(readings, Platform.OS)), [readings]);

  if (readings === null || rows.length === 0) return null;

  const models: SettingsRowModel[] = [
    ...rows.map((row: DeliveryRow): SettingsRowModel => ({
      kind: 'value',
      testID: row.testID,
      valueTestID: `${row.testID}-value`,
      label: t(row.labelKey),
      value: t(row.valueKey),
      tone: row.warning ? 'warning' : 'default',
      onPress: () => { open(row.id); },
    })),
    ...(landing === null
      ? []
      : ([
          {
            kind: 'note',
            testID: `reminder-settings-landing-${landing.copy.key}`,
            text: t(landing.copy.key),
            tone: 'warning',
            role: landing.copy.alert ? 'alert' : undefined,
          },
        ] as const)),
    { kind: 'note', testID: 'reminder-settings-note', text: t('reminder.settings.note'), tone: 'muted' },
  ];

  return (
    <SettingsSection
      variant="card"
      testID="reminder-delivery-section"
      title={t('reminder.settings.section')}
      leading={<Icon name="action.settings" size="sm" color={tokens['color.foreground-muted']} />}
      rows={models}
    />
  );
}
