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
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  addMonths,
  monthGrid,
  parseLocalTime,
  startOfMonth,
  type LocalDate,
  type LocalTime,
} from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';

/** 快捷项：日期数学在 `@heyta/domain` 的 `quickDuePickDates`，措辞由宿主映射。 */
export interface DatePickerQuickPick {
  readonly key: string;
  readonly label: string;
  readonly date: LocalDate;
}

/**
 * 时刻输入框允许几个字符。
 *
 * 从形状本身推（`HH:MM` 就是 5 个字符），不抄一个裸的 5 ——
 * 抄来的数字在格式改宽那天会变成"打不进去"。
 */
const TIME_TEXT_MAX_LENGTH = 'HH:MM'.length;

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

/**
 * 「时刻」那一行的装配。**整个 prop 可选 —— 不传就一个节点都不画**，
 * 所以现有消费者（移动端任务详情）渲染出来的东西与改动前逐字节相同。
 *
 * 🔴 为什么这一行住在共享层而不是 web 自己画：
 *  1. "这条截止有没有时刻"是**产品语义**（同一个 `dueDate` 数字的两种精度），
 *     不是平台差异 —— AGENTS §3.5 说这种判断不许出现在 `apps/*`。
 *  2. web 用 `<input type="time">`、mobile 用另一套，就是同形状的第二次；
 *     而两端对"清空 = 回到全天"的口径一旦分叉，界面上会出现
 *     "时间线画在 16:00，而编辑器说它全天"。
 *  3. `apps/web/src/features/**` 是 L4（`check:l4` 数 `style={{}}` 只减不增），
 *     在这里画样式对那道门禁是中性的。
 *
 * ⚠️ 输入框是**自由文本 + 校验**，不是原生 time 控件：RN 没有那种控件，
 *  而"能填进去的必须能被读回来"这条比"少敲三个键"重要。
 *  没到 `HH:MM` 的形状**不提交**（用户还在打字），失焦时回落到已提交的值
 *  （输入框不撒谎）。
 */
export interface DatePickerTime {
  /** 已提交的时刻；`undefined` = 只到日（界面上叫"全天"）。 */
  readonly value: LocalTime | undefined;
  /** 能不能编辑。🔴 没有日期就没有"几点"可言 —— 由宿主把这条事实传进来。 */
  readonly enabled: boolean;
  readonly labels: {
    readonly timeLabel: string;
    readonly allDay: string;
    readonly placeholder: string;
    readonly aria: string;
  };
  /** `undefined` = 清掉时刻（回到全天）。一次编辑 = 一次回调 = 一条 op。 */
  onChange(time: LocalTime | undefined): void;
}

export function DatePicker({
  value,
  today,
  onChange,
  quickPicks,
  labels,
  testID,
  time,
}: {
  value: LocalDate | undefined;
  onChange: (date: LocalDate | undefined) => void;
  /** 冻结的"今天"（`LocalDate`）。不从 `Date.now()` 取 —— 宿主决定时钟。 */
  today: LocalDate;
  readonly quickPicks: readonly DatePickerQuickPick[];
  readonly labels: DatePickerLabels;
  readonly testID?: string;
  /** 见 `DatePickerTime` —— 不传就没有这一行。 */
  readonly time?: DatePickerTime;
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

  /*
   * 时刻输入框里的**草稿** = 用户此刻敲的原文，与已经提交出去的 `time.value`
   * 可以不一致（框里是 "16:"，外面还是"全天"）。这不是没做完的同步，是有意的：
   * 🔴 **没到 `HH:MM` 的形状不提交** —— 半截时刻写进 op 就是替用户猜时间。
   * 失焦时把框回落到已提交的值，于是界面不会撒谎说"16:"是个时刻。
   */
  const [timeDraft, setTimeDraft] = useState<string>(time?.value ?? '');
  useEffect(() => {
    setTimeDraft(time?.value ?? '');
  }, [time?.value]);

  const editTimeText = (text: string): void => {
    setTimeDraft(text);
    if (time === undefined) return;
    if (text.trim() === '') {
      time.onChange(undefined);
      return;
    }
    const parsed = parseLocalTime(text);
    if (parsed !== undefined) time.onChange(parsed);
  };

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
      {time === undefined ? null : (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] }}
          testID={`${testID ?? 'date-picker'}-time-row`}
        >
          <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
            {time.labels.timeLabel}
          </Text>
          <TextInput
            value={timeDraft}
            onChangeText={editTimeText}
            onBlur={() => {
              setTimeDraft(time.value ?? '');
            }}
            editable={time.enabled}
            keyboardType="numbers-and-punctuation"
            maxLength={TIME_TEXT_MAX_LENGTH}
            placeholder={time.labels.placeholder}
            placeholderTextColor={tokens['color.foreground-subtle']}
            accessibilityLabel={time.labels.aria}
            aria-disabled={!time.enabled}
            testID={`${testID ?? 'date-picker'}-time-input`}
            style={{
              // `flex: 1` 而不是定宽：这一行的宽度由宿主的面板决定，
              // 而共享层不猜视口（同 `CalendarYearBoard` 那条立场）。
              flex: 1,
              paddingVertical: tokens['space.1'],
              paddingHorizontal: tokens['space.2'],
              borderWidth: tokens['border-width.thin'],
              borderColor: tokens['color.border'],
              borderRadius: tokens['radius.sm'],
              color: tokens['color.foreground'],
            }}
          />
          {/*
            「全天」只在**真的有时刻**时出现 —— 已经全天还给一个"改成全天"，
            与"没日期还给一个清除"是同一种假可供性（上面那个按钮同一条理由）。
          */}
          {time.value !== undefined ? (
            <Pressable
              onPress={() => {
                time.onChange(undefined);
              }}
              accessibilityRole="button"
              style={chipStyle(false)}
              testID={`${testID ?? 'date-picker'}-time-all-day`}
            >
              <Text style={[text.caption, { color: tokens['color.foreground'] }]}>
                {time.labels.allDay}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}
