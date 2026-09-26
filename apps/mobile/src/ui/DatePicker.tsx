/**
 * 日期选择器
 * ============
 *
 * 手机上给任务定"哪天做"的界面：一排快捷项 + 一个月历。
 *
 * 🔴 **不引入第三方日期选择器。** 理由不是"自己能写"，而是：
 *   - RN 没有内置日期选择器，社区的 `@react-native-community/datetimepicker`
 *     是**原生模块**：接进来要动三端构建（Android/iOS/鸿蒙），
 *     而鸿蒙侧还没有对应的 TPL 包 —— 那一刻这个功能在三端就不一致了；
 *   - 月历数学已经在 `@heyta/domain` 里（`monthGrid` / `addMonths`），
 *     有 22 条测试和三次注入验证过；本文件**只负责渲染**。
 *
 * 布局上踩过的两个坑，代码里都有对应写法：
 *   1. **不要在同一节点上同时给 `height` 和 `paddingBottom`** ——
 *      子元素会在被压缩后的内容盒里居中，看起来像"整体偏上"。
 *   2. **圆形选中态不能用 `flex: 1` 的外层直接上 `borderRadius`** ——
 *      宽度会被撑到整列宽，圆变成椭圆。要用一个定尺寸的内层。
 */

import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  addMonths,
  monthGrid,
  startOfMonth,
  type LocalDate,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { WEEKDAY_MESSAGE_KEYS, formatMonthTitleText } from '../lib/date';
import { quickDatePicks } from '../lib/quick-dates';
import { useTokens } from '../theme';
import { Chip, IconButton, Text } from './kit';

export function DatePicker({
  value,
  onChange,
  /** 冻结的"今天"（`LocalDate`）。不从 `Date.now()` 取，理由同 `TasksScreen` 的 `now`。 */
  today,
}: {
  value: LocalDate | undefined;
  onChange: (date: LocalDate | undefined) => void;
  today: LocalDate;
}): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();

  // 可见月份。初始跟到已选日期，没选就停在"今天"那一月。
  const [month, setMonth] = useState<LocalDate>(() => startOfMonth(value ?? today));

  // 🔴 外部把 value 跳到别的月时（点快捷项"下周一"）月份必须跟上，
  // 否则用户点了"下周一"，网格还停在当月 —— 界面上看不到自己刚选的那天。
  useEffect(() => {
    if (value !== undefined) setMonth(startOfMonth(value));
  }, [value]);

  const picks = quickDatePicks(today, t);
  const weeks = monthGrid(month);

  return (
    <View style={{ gap: tokens['space.3'] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>
        {picks.map((pick) => (
          <Chip
            key={pick.key}
            label={pick.label}
            selected={value === pick.date}
            onPress={() => {
              onChange(pick.date);
            }}
          />
        ))}
        {/* 「清除」只在真的有日期时出现 —— 没日期时给一个"清除"是假的选择 */}
        {value !== undefined ? (
          <Chip
            label={t('mobile.datePicker.clear')}
            onPress={() => {
              onChange(undefined);
            }}
          />
        ) : null}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <IconButton
          icon="action.prev-month"
          label={t('mobile.common.prevMonth')}
          color={tokens['color.foreground-muted']}
          onPress={() => {
            setMonth(addMonths(month, -1));
          }}
        />
        <Text variant="row-title">{formatMonthTitleText(month, t)}</Text>
        <IconButton
          icon="action.next-month"
          label={t('mobile.common.nextMonth')}
          color={tokens['color.foreground-muted']}
          onPress={() => {
            setMonth(addMonths(month, 1));
          }}
        />
      </View>

      <View style={{ flexDirection: 'row' }}>
        {WEEKDAY_MESSAGE_KEYS.map((key) => (
          <View key={key} style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="row-meta" tone="subtle">
              {t(key)}
            </Text>
          </View>
        ))}
      </View>

      {weeks.map((week) => (
        <View key={week[0]!.date} style={{ flexDirection: 'row' }}>
          {week.map((cell) => {
            const selected = value === cell.date;
            const isToday = cell.date === today;
            const day = Number(cell.date.slice(8, 10));
            const monthOfCell = Number(cell.date.slice(5, 7));
            const label = t('mobile.datePicker.dayLabel', { month: monthOfCell, day });

            return (
              <Pressable
                key={cell.date}
                onPress={() => {
                  onChange(cell.date);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                // 无障碍名给**完整日期**：只念"26"的话，
                // 读屏用户听到的是一串没有意义的数字。
                // 它同时让端到端脚本能唯一定位某一格（`xy_desc "9月26日"`）。
                accessibilityLabel={label}
                style={{
                  flex: 1,
                  // ⚠️ 这里只给 height，不给 paddingBottom —— 两个一起给
                  // 会让内层在压缩后的盒子居中，表现为整体偏上。
                  height: tokens['touch-target.min'],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* 定尺寸内层：圆是圆的，与列宽无关 */}
                <View
                  style={{
                    width: tokens['touch-target.min'],
                    height: tokens['touch-target.min'],
                    borderRadius: tokens['radius.full'],
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? tokens['color.primary'] : 'transparent',
                    borderWidth: isToday && !selected ? tokens['border-width.thin'] : 0,
                    borderColor: tokens['color.primary'],
                  }}
                >
                  <Text
                    variant="row-meta"
                    tone={selected ? 'default' : cell.inMonth ? 'default' : 'subtle'}
                    style={selected ? { color: tokens['color.on-primary'] } : undefined}
                  >
                    {String(day)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
