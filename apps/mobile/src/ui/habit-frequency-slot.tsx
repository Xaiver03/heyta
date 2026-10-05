/**
 * 习惯频次编辑器（移动端）—— 工单 H5
 * ====================================
 *
 * 与 web 的 `features/habits/HabitFrequencyEditor.tsx` 是**同一套规则**的两种画法，
 * 不是两份实现：三档、摘要常驻、清空=退回每天、N 只在按了那一档才提交、
 * 只画当前那一档的零件 —— 五条全都同源，判据也一一对应
 * （`apps/web/tests/habit-frequency-editor.spec.tsx` 的 G1–G11 ↔ 本壳的 M1–M6）。
 *
 * 🔴 「哪一种频次说哪句话」与「1–7 念作什么」**不在这里**：
 *    那是共享层 `@heyta/ui` 的 `habitFrequencySummaryKey` / `HABIT_WEEKDAY_MESSAGE_KEYS`
 *    （工单 H5 收编）。本壳各写一份的症状是"同一个 `weekly`，web 说『每周 一、三』、
 *    移动端说『周一、周三』"，两边都不报错。
 *
 * 🔴 合法性也**不在这里**：`{interval, everyNDays: 0}` 会让 `isScheduledOn` 取模除零
 *    （⇒ 恒 false ⇒ 连续天数永远 0），而那条判定住在 `@heyta/domain`。
 *    校验与归一在 `app-host` 的 `normalizeHabitFrequency`（会**抛**），
 *    本组件只负责**接住 reject 并说给用户听**（接不住就是"点了没反应"）。
 *
 * ⚠️ 列举分隔符取 `lib/recurrence-display.ts` 的 `LIST_SEPARATOR` —— 移动端这一壳
 *    只有那一位所有者（纯标点进不了词条表：`check:ui-language` 要求 zh 词条含汉字）。
 */

import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { isoWeekday, type Habit, type HabitFrequency, type LocalDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { HABIT_WEEKDAY_MESSAGE_KEYS, habitFrequencySummaryKey } from '@heyta/ui';

import { LIST_SEPARATOR } from '../lib/recurrence-display';
import { useTokens } from '../theme';
import { Text, TextField } from './kit';

export interface HabitFrequencySlotProps {
  habit: Habit;
  /** 「今天」：切到「每周挑几天」时给一个默认日子，而不是发一个空集合。 */
  today: LocalDate;
  /** `undefined` = 清除（回到"每天"）。失败会 reject，由本组件接住并显示。 */
  onSet: (frequency: HabitFrequency | undefined) => Promise<void>;
}

export function HabitFrequencySlot({
  habit,
  today,
  onSet,
}: HabitFrequencySlotProps): React.JSX.Element {
  const tokens = useTokens();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 草稿是**字符串**：`''` 与 `'0'` 必须能分辨（与 web 那条同一条理由）。 */
  const [draftN, setDraftN] = useState('2');

  const frequency = habit.frequency;
  const days = frequency?.type === 'weekly' ? frequency.daysOfWeek : [];
  const everyN = frequency?.type === 'interval' ? frequency.everyNDays : 2;
  const isDaily = frequency === undefined || frequency.type === 'daily';
  const isWeekly = frequency?.type === 'weekly';
  const isInterval = frequency?.type === 'interval';

  const summaryKey = habitFrequencySummaryKey(frequency);
  const summary =
    summaryKey === 'web.habits.freq.summary.interval'
      ? t(summaryKey, { n: String(everyN) })
      : summaryKey === 'web.habits.freq.summary.weekly'
        ? t(summaryKey, {
            days: days
              .map((day) => t(HABIT_WEEKDAY_MESSAGE_KEYS[day - 1] ?? HABIT_WEEKDAY_MESSAGE_KEYS[0]))
              .join(LIST_SEPARATOR[locale]),
          })
        : t(summaryKey);

  const submit = (next: HabitFrequency | undefined): void => {
    // 🔴 自己接住 reject：本壳的 `runFor` 只置灰不显示原因，交给它会变成一条
    //    unhandled rejection，而用户看到的是"点了没反应"。
    void onSet(next).catch(() => {
      setFailed(true);
    });
  };

  const chip = (
    key: string,
    label: string,
    pressed: boolean,
    onPress: () => void,
  ): React.JSX.Element => (
    <Pressable
      key={key}
      onPress={() => {
        setFailed(false);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: pressed }}
      testID={`habit-freq-${key}-${habit.id}`}
      style={({ pressed: down }) => ({
        minHeight: tokens['touch-target.min'],
        paddingHorizontal: tokens['space.2'],
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: tokens['radius.md'],
        borderWidth: pressed ? tokens['border-width.thick'] : tokens['border-width.thin'],
        borderColor: pressed ? tokens['color.primary'] : tokens['color.border'],
        backgroundColor: down ? tokens['color.surface-sunken'] : tokens['color.surface'],
      })}
    >
      <Text variant="row-meta" tone={pressed ? 'default' : 'muted'}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ gap: tokens['space.1'] }}>
      <Pressable
        onPress={() => {
          // 每次展开都把草稿同步回**当前真值**：否则上次没提交的数字会留着，
          // 用户再展开时看到的是一个"看起来已经生效"的值。
          setDraftN(String(everyN));
          setFailed(false);
          setOpen((was) => !was);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('web.habits.freq.aria', { name: habit.name })}
        testID={`habit-freq-toggle-${habit.id}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.2'],
          minHeight: tokens['touch-target.min'],
        }}
      >
        {/* 摘要**常驻可见**：折叠着也要知道这条习惯多久一次 —— 这是改它的前提。 */}
        <Text variant="row-meta" tone="muted">
          {t('web.habits.freq.toggle')}
        </Text>
        {/* 🔴 摘要**没有**自己的 testID：kit 的 `Text` 不接这个 prop（它的测试锚点是
            外层那颗 `Pressable`）。设备侧读它走 AX 文本，不靠 id。 */}
        <Text variant="row-meta">{summary}</Text>
      </Pressable>

      {open ? (
        <View
          testID={`habit-freq-panel-${habit.id}`}
          accessibilityRole="summary"
          accessibilityLabel={t('web.habits.freq.aria', { name: habit.name })}
          style={{ gap: tokens['space.1'] }}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.1'] }}>
            {chip('daily', t('web.habits.freq.daily'), isDaily, () => {
              // 规则 3：发**清除**，不是 `{type:'daily'}`；已经是每天时一条都不发。
              if (isDaily) return;
              submit(undefined);
            })}
            {chip('weekly', t('web.habits.freq.weekly'), isWeekly, () => {
              if (isWeekly) return;
              // 规则 1：默认给"今天那一档"。空集合会被动作层**抛**，
              // 而"点了那一格没反应"正是本仓库反复栽过的那一种坏。
              submit({ type: 'weekly', daysOfWeek: [isoWeekday(today)] });
            })}
            {chip('interval', t('web.habits.freq.interval'), isInterval, () => {
              const parsed = Number(draftN);
              if (draftN.trim() === '' || !Number.isInteger(parsed) || parsed < 1) {
                setFailed(true);
                return;
              }
              submit({ type: 'interval', everyNDays: parsed });
            })}
          </View>

          {/* 🔴 只画**当前那一档**的零件（与 web 同一条规则，G11/Q3 各钉一侧）：
              把两档的零件同时摆着 = 界面把一个不生效的规则连数字一起显示给用户看，
              而"该有的在不在"那类断言对这份坏结构上看不见。 */}
          {isWeekly ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.1'] }}>
              {HABIT_WEEKDAY_MESSAGE_KEYS.map((key, index) => {
                const day = index + 1;
                const on = days.includes(day);
                return chip(
                  `day-${day}`,
                  t(key),
                  on,
                  () => {
                    const next = on ? days.filter((d) => d !== day) : [...days, day].sort();
                    // 规则 2：清空 = 退回每天，而不是发一个空集合。
                    submit(next.length === 0 ? undefined : { type: 'weekly', daysOfWeek: next });
                  },
                );
              })}
            </View>
          ) : null}

          {isInterval ? (
            <TextField
              testID={`habit-freq-n-${habit.id}`}
              label={t('web.habits.freq.nDays')}
              value={draftN}
              // ⚠️ 这里**没开**数字键盘：kit 的 `TextField` 的 `keyboard` 只有
              //    `default | url`（`ui/kit.tsx`），加一档要动的是那个共享件本身
              //    而不是本组件。已登记成 H5-M2，不在这一单里顺手改。
              onChangeText={setDraftN}
              // 这条不是装饰：`interval` 的锚点是**固定日历格**（`isScheduledOn` 拿
              // `1970-01-01` 取模），不是"从建立习惯那天起每 N 天"。
              hint={t('web.habits.freq.intervalHint', { n: draftN.trim() === '' ? '1' : draftN })}
            />
          ) : null}

          {failed ? (
            <View testID={`habit-freq-error-${habit.id}`}>
              <Text variant="row-meta" tone="danger">
                {t('web.habits.freq.invalid')}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
