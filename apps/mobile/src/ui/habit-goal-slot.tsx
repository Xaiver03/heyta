/**
 * 习惯目标（移动端）—— 数值 / 单位 / 达成口径
 * ==============================================
 *
 * 与 web 的 `HabitGoalEditor` 是**同一件事的两个平台实现**，形状刻意对齐：
 * 摘要常驻可见（折叠着也知道目标是什么）+ 展开式编辑 + 三个字段一次提交。
 *
 * 🔴 两处**必须共用**的东西，都不在这两个文件里：
 *   · 「口径 → 摘要词条 key」在 `@heyta/ui` 的 `habitGoalSummaryKey`
 *     （否则会出现"同一个 `atMost`，web 说『最多』、移动端说『不超过』"）；
 *   · 「目标合法不合法」在 `@heyta/app-host` 的 `setHabitGoal`
 *     （负数 / 非有限数会让 `isAchieved` 恒真或恒假）。
 *
 * ⚠️ 移动端与 web 的**交互形态不同**，这是平台差异不是漂移：
 * 触摸没有 hover 与 `Esc`，所以这里用**可展开的面板 + Chip**，
 * 而不是 web 的 `<details>` + `<input>`（后者在手机上会调出键盘遮住上下文）。
 */

import React, { useCallback, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import type { Habit, HabitGoalType } from '@heyta/domain';
import { habitGoalSummaryKey } from '@heyta/ui';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { Chip, Text } from './kit';
import { useTokens } from '../theme';

export function HabitGoalSlot({
  habit,
  onSetGoal,
}: {
  habit: Habit;
  /** 一次提交三个字段（见 app-host 的 `setHabitGoal`）。失败会 reject。 */
  onSetGoal: (goal: { target?: number; unit?: string; goalType?: HabitGoalType }) => Promise<void>;
}): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 草稿的**字符串**形态：`''` 与 `'0'` 必须能分辨（见下面的校验）。 */
  const [draftTarget, setDraftTarget] = useState('1');
  const [draftUnit, setDraftUnit] = useState('');

  const goalType: HabitGoalType = habit.goalType ?? 'atLeast';
  const target = habit.target ?? 1;
  const unit = habit.unit ?? '';

  const submit = useCallback(
    (nextType: HabitGoalType): void => {
      // 🔴 本地只拦**空 / 非数字 / 负数**。
      //    `0` 是**合法**的：`atMost` + 0 = "一次都不碰"，把它当成非法值
      //    等于把一整类习惯（戒掉某件事）判了死刑（web 侧为此专门有一条断言）。
      const parsed = Number(draftTarget);
      if (draftTarget.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
        setFailed(true);
        return;
      }
      setFailed(false);
      void onSetGoal({ target: parsed, unit: draftUnit, goalType: nextType }).catch(() => {
        setFailed(true);
      });
    },
    [draftTarget, draftUnit, onSetGoal],
  );

  const typeChip = (key: HabitGoalType, labelKey: MessageKey): React.JSX.Element => (
    <Chip
      label={t(labelKey)}
      selected={goalType === key}
      onPress={() => {
        submit(key);
      }}
    />
  );

  return (
    <View style={{ alignItems: 'flex-start', gap: tokens['space.1'] }}>
      <Pressable
        onPress={() => {
          // 每次展开都把草稿同步回**当前真值** —— 否则上次没提交的输入会留着，
          // 用户再展开时看到的是一个"看起来已经生效"的值。
          setDraftTarget(String(target));
          setDraftUnit(unit);
          setFailed(false);
          setOpen((current) => !current);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('web.habits.goal.aria', { name: habit.name })}
        style={{ minHeight: tokens['touch-target.min'], justifyContent: 'center' }}
      >
        {/* 摘要**常驻可见**：只放进展开面板的话，扫一眼列表看不出每个习惯的目标。 */}
        <Text variant="row-meta" tone="muted">
          {t(habitGoalSummaryKey(goalType), {
            target,
            unit: unit === '' ? t('web.habits.goal.defaultUnit') : unit,
          })}
        </Text>
      </Pressable>

      {open ? (
        <View style={{ gap: tokens['space.2'] }}>
          <View style={{ flexDirection: 'row', gap: tokens['space.2'] }}>
            <TextInput
              value={draftTarget}
              onChangeText={setDraftTarget}
              keyboardType="number-pad"
              accessibilityLabel={t('web.habits.goal.target')}
              placeholder={t('web.habits.goal.target')}
              placeholderTextColor={tokens['color.foreground-subtle']}
              style={{
                width: tokens['space.8'],
                minHeight: tokens['touch-target.min'],
                paddingHorizontal: tokens['space.2'],
                borderRadius: tokens['radius.md'],
                backgroundColor: tokens['color.surface'],
                color: tokens['color.foreground'],
              }}
            />
            <TextInput
              value={draftUnit}
              onChangeText={setDraftUnit}
              accessibilityLabel={t('web.habits.goal.unit')}
              placeholder={t('web.habits.goal.unitPlaceholder')}
              placeholderTextColor={tokens['color.foreground-subtle']}
              style={{
                flex: 1,
                minHeight: tokens['touch-target.min'],
                paddingHorizontal: tokens['space.2'],
                borderRadius: tokens['radius.md'],
                backgroundColor: tokens['color.surface'],
                color: tokens['color.foreground'],
              }}
            />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>
            {typeChip('atLeast', 'web.habits.goal.atLeast')}
            {typeChip('atMost', 'web.habits.goal.atMost')}
            {typeChip('exactly', 'web.habits.goal.exactly')}
          </View>

          {failed ? (
            <Text variant="row-meta" tone="danger">
              {t('web.habits.goal.invalid')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
