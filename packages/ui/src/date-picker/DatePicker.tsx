/**
 * DatePicker —— 四端共用的月历日期选择器（共享层）
 * ==================================================
 *
 * 从 `apps/mobile/src/ui/DatePicker.tsx` 上提（多端覆盖审计批一）：
 * web 补 due 事后编辑时两端要**同一只**选择器，上提的收尾是删掉
 * 移动端那份、两端消费共享份（AGENTS §3.5：抽取的收尾是删旧份，
 * 不是"再留一份本地的"）。
 *
 * 🔴 **不引入第三方日期选择器**（当初 mobile 版的裁决原样有效）：
 * RN 社区的 `@react-native-community/datetimepicker` 是原生模块，
 * 接进来要动三端构建；月历数学已在 `@heyta/domain`
 * （`monthGrid` / `addMonths`，有测试），本文件**只负责渲染**。
 *
 * 🔴 **不 import `@heyta/i18n`** —— 文案由宿主注入（`labels`），
 * 理由同 `task-list/TaskList.tsx` 文件头（i18n 会拖进第二份 React）。
 *
 * 🔴 格子的无障碍名 = **完整日期**（`labels.dayLabel`）：只念"26"的话
 * 读屏用户听到的是一串没有意义的数字。它同时是两端 e2e 的定位钩子
 * （移动端 content-desc `10月18日`、web aria-label 同文）。
 *
 * 布局两个坑（mobile 版实测换来的，别"顺手简化"掉）：
 *   1. 格子**只给 height、不给 paddingBottom** —— 两个一起给，
 *      子元素会在被压缩后的内容盒里居中，看起来像"整体偏上"。
 *   2. 圆形选中态用**定尺寸内层**上 `borderRadius`，不用 `flex:1`
 *      的外层直接上 —— 宽度会被撑到整列宽，圆变椭圆。
 */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { addMonths, monthGrid, startOfMonth, type LocalDate } from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';

/** 快捷项：日期数学在 `@heyta/domain` 的 `quickDuePickDates`，措辞由宿主映射。 */
export interface DatePickerQuickPick {
  readonly key: string;
  readonly label: string;
  readonly date: LocalDate;
}

/** 全部文案。**宿主注入**（本文件不碰 i18n）。 */
export interface DatePickerLabels {
  /** 一周列头，7 个，**周一开头** —— 必须与 `monthGrid` 同序，错一位整历错位。 */
  readonly weekdays: readonly string[];
  /** 「2026年10月」。翻月时由本组件回调。 */
  monthTitle(month: LocalDate): string;
  readonly clear: string;
  readonly prevMonth: string;
  readonly nextMonth: string;
  /** 格子的无障碍名：完整日期（"10月18日"），不是孤零零的 "18"。 */
  dayLabel(month: number, day: number): string;
}

export function DatePicker({
  value,
  today,
  onChange,
  quickPicks,
  labels,
  testID,
}: {
  value: LocalDate | undefined;
  onChange: (date: LocalDate | undefined) => void;
  /** 冻结的"今天"（`LocalDate`）。不从 `Date.now()` 取 —— 宿主决定时钟。 */
  today: LocalDate;
  readonly quickPicks: readonly DatePickerQuickPick[];
  readonly labels: DatePickerLabels;
  readonly testID?: string;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  // 可见月份。初始跟到已选日期，没选就停在"今天"那一月。
  const [month, setMonth] = useState<LocalDate>(() => startOfMonth(value ?? today));

  // 🔴 外部把 value 跳到别的月时（点快捷项"下周一"）月份必须跟上，
  // 否则用户点了"下周一"，网格还停在当月 —— 看不到自己刚选的那天。
  useEffect(() => {
    if (value !== undefined) setMonth(startOfMonth(value));
  }, [value]);

  const weeks = monthGrid(month);

  const chipStyle = (selected: boolean) => ({
    paddingVertical: tokens['space.1'],
    paddingHorizontal: tokens['space.3'],
    borderRadius: tokens['radius.full'],
    backgroundColor: selected ? tokens['color.primary'] : 'transparent',
  });

  return (
    <View style={{ gap: tokens['space.3'] }} testID={testID ?? 'date-picker'}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>
        {quickPicks.map((pick) => {
          const selected = value === pick.date;
          return (
            <Pressable
              key={pick.key}
              onPress={() => {
                onChange(pick.date);
              }}
              accessibilityRole="button"
              aria-selected={selected}
              style={chipStyle(selected)}
            >
              <Text
                style={[
                  text.caption,
                  { color: selected ? tokens['color.on-primary'] : tokens['color.foreground'] },
                ]}
              >
                {pick.label}
              </Text>
            </Pressable>
          );
        })}
        {/* 「清除」只在真的有日期时出现 —— 没日期时给一个"清除"是假的选择 */}
        {value !== undefined ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onChange(undefined);
            }}
            style={chipStyle(false)}
          >
            <Text style={[text.caption, { color: tokens['color.foreground'] }]}>
              {labels.clear}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Pressable
          onPress={() => {
            setMonth(addMonths(month, -1));
          }}
          accessibilityRole="button"
          accessibilityLabel={labels.prevMonth}
          style={{
            width: tokens['touch-target.min'],
            height: tokens['touch-target.min'],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[text['row-title'], { color: tokens['color.foreground-muted'] }]}>‹</Text>
        </Pressable>
        <Text style={[text['row-title'], { color: tokens['color.foreground'] }]}>
          {labels.monthTitle(month)}
        </Text>
        <Pressable
          onPress={() => {
            setMonth(addMonths(month, 1));
          }}
          accessibilityRole="button"
          accessibilityLabel={labels.nextMonth}
          style={{
            width: tokens['touch-target.min'],
            height: tokens['touch-target.min'],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[text['row-title'], { color: tokens['color.foreground-muted'] }]}>›</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row' }}>
        {labels.weekdays.map((weekday) => (
          <View key={weekday} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[text.caption, { color: tokens['color.foreground-subtle'] }]}>
              {weekday}
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

            return (
              <Pressable
                key={cell.date}
                onPress={() => {
                  onChange(cell.date);
                }}
                accessibilityRole="button"
                aria-selected={selected}
                accessibilityLabel={labels.dayLabel(monthOfCell, day)}
                style={{
                  flex: 1,
                  // ⚠️ 这里只给 height，不给 paddingBottom（见文件头坑 1）。
                  height: tokens['touch-target.min'],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* 定尺寸内层：圆是圆的，与列宽无关（见文件头坑 2） */}
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
                    style={[
                      text.caption,
                      selected
                        ? { color: tokens['color.on-primary'] }
                        : cell.inMonth
                          ? { color: tokens['color.foreground'] }
                          : { color: tokens['color.foreground-subtle'] },
                    ]}
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
