/**
 * 捕获框的「截止」面板（共享视图）
 * =================================
 *
 * 日期胶囊点开之后的东西。两个子视图，**同一时刻只画一个**：
 *
 *   · `日期`：快捷四档 + 月历 + 时刻那一行（只读，点开去）+ 这条句子里读到的日期；
 *   · `时刻`：全天 + 30 分钟步进列表 +「其它时间」（切进自由输入）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么时刻是**子视图**而不是月历下面再叠一列
 *
 * 48 格步进列表叠在月历下面，面板高度直接翻倍：1440×900 那档实测会把月历顶出可视区，
 * 375×720 更是只能滚着找。滴答那张图（图 4）也不是那个形状 —— 点「晚上 8:00」之后
 * **列表取代日历那一块**，回来再点返回。所以这里照那个形状做视图切换。
 *
 * 🔴 为什么步进列表与自由输入**不许同时在场**
 *
 * 同一个目的地两个控件是本仓写过两次的判据（`view-tabs.ts` 收集箱那一行、
 * P6 的迁移判据）。但**不能因此砍掉自由输入**：20:15 这一档在滴答那个列表里填不进去，
 * 而在我们这里 `Task.dueDate` 支持任意分钟，砍掉就是能力倒退。
 * 所以形状是：列表是默认，「其它时间」是显式出口，两者互斥地渲染。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 分工（与 `CaptureComposer` 同一套）
 *
 * 判断在 `./model.ts` 与 `../date-picker/steps.ts`（node 单测跑穿），
 * 措辞由宿主注入，写库在宿主 action 层（AGENTS.md §3.5）。
 * 本文件不 import `@heyta/i18n`，只用 RN 原语。
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { LocalDate, LocalTime } from '@heyta/domain';
import { RotateCcw, X } from 'lucide';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { DatePicker, type DatePickerLabels, type DatePickerQuickPick } from '../date-picker/DatePicker.js';
import { timeDraftToValue, timeStepSlots } from '../date-picker/steps.js';
import type { CaptureComposerLabels } from './CaptureComposer.js';
import type { CaptureChip, CaptureDue } from './model.js';

/** 滴答那一档的粒度：半小时。`Task` 本身支持任意分钟，所以「其它时间」必须留着。 */
const TIME_STEP_MINUTES = 30;

/** 面板自己的措辞（其余复用 `CaptureComposerLabels`，那里已有 `valueLabel` / `rejected` / `unused`）。 */
export interface CaptureDuePanelLabels {
  readonly title: string;
  readonly dueItems: string;
  /** 月历、快捷项、翻月的措辞（宿主复用 `web.due.*`，与详情面同一出处）。 */
  readonly datePicker: DatePickerLabels;
  readonly time: {
    readonly timeLabel: string;
    readonly allDay: string;
    readonly placeholder: string;
    readonly aria: string;
    /** 列表 → 自由输入的出口。 */
    readonly otherTime: string;
    /** 自由输入 → 列表的出口。 */
    readonly backToList: string;
    /** 时刻子视图 → 日期子视图的出口（与上面那枚**不同一件事**，不许共用一句）。 */
    readonly backToDay: string;
    /** 日期视图里那枚「时刻」行的无障碍名（点它进列表）。 */
    readonly rowAria: string;
  };
}

export interface CaptureDuePanelProps {
  readonly due: CaptureDue;
  readonly now: number;
  readonly today: LocalDate;
  readonly quickPicks: readonly DatePickerQuickPick[];
  readonly dueChips: readonly CaptureChip[];
  readonly labels: CaptureComposerLabels & { readonly panel: CaptureDuePanelLabels };
  readonly onPick: (date: LocalDate, time: LocalTime | undefined) => void;
  readonly onClear: () => void;
  readonly onToggle: (chip: CaptureChip) => void;
  readonly testID?: string;
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    /**
     * 🔴 面板有上限宽，而且**由 token 给**：时刻列表那 49 枚的 max-content 宽过视口时，
     * 没有上限的面板会与视口两侧齐边（2026-11-05 在 1440 实测到），
     * 那就不是"贴着胶囊的一块面板"，而是一条盖住整个侧栏的带子。
     * 移动端视口（≈411dp）小于这个值 ⇒ 同一份样式在手机上自然 inert，不需要分支。
     */
    body: { gap: tokens['space.3'], maxWidth: tokens['size.capture-panel-max-width'] },
    items: { gap: tokens['space.1'] },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
    },
    raw: { color: tokens['color.foreground'] },
    value: { color: tokens['color.primary'] },
    itemOff: { opacity: tokens['state.disabled-opacity'] },
    toggle: {
      marginInlineStart: 'auto',
      alignItems: 'center',
      justifyContent: 'center',
      width: tokens['touch-target.min'],
      height: tokens['touch-target.min'],
      borderRadius: tokens['radius.full'],
    },
    groupTitle: { color: tokens['color.foreground-subtle'] },
    /** 日期视图里那枚「时刻」行：与快捷项同一档高度，不是一枚裸文本。 */
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
    },
    timeValue: { color: tokens['color.primary'] },
    slots: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] },
    slot: {
      minHeight: tokens['size.chip-height'],
      paddingHorizontal: tokens['size.chip-padding-x'],
      borderRadius: tokens['radius.full'],
      alignItems: 'center',
      justifyContent: 'center',
    },
    slotOn: { backgroundColor: tokens['color.primary'] },
    slotOff: {
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: 'transparent',
    },
    slotTextOn: { color: tokens['color.on-primary'] },
    slotText: { color: tokens['color.foreground'] },
    /** 时刻数字等宽：否则选中态换格时整列宽度会跳（与芯片行 `numeric` 同一条理由）。 */
    numericSlot: { fontVariant: ['tabular-nums'] },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: tokens['space.2'],
    },
    /** 自由输入那一格：与 `DatePicker` 的时刻框同一档，只是这里由面板自己管草稿。 */
    manualInput: {
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      borderRadius: tokens['radius.sm'],
      paddingVertical: tokens['space.1'],
      paddingHorizontal: tokens['space.2'],
      color: tokens['color.foreground'],
    },
  });
}

export function CaptureDuePanel({
  due,
  now,
  today,
  quickPicks,
  dueChips,
  labels,
  onPick,
  onClear,
  onToggle,
  testID,
}: CaptureDuePanelProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const [view, setView] = useState<'date' | 'time'>('date');
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState<string>(due.time ?? '');

  // 🔴 草稿与已提交值可以不一致（框里是「16:」，外面还是上一个时刻）。
  // 提交规则只有 `timeDraftToValue` 这一处，与 `DatePicker` 共用。
  const commitDraft = (value: string): void => {
    setDraft(value);
    const next = timeDraftToValue(value, due.time);
    if (next === due.time && value !== (due.time ?? '')) return;
    // 🔴 没日期时敲出一个时刻 = 「今天这个时刻」，不是"敲了没反应"。
    //    清空草稿（next undefined）又没有日期，本来就没有该落的东西，仍然不提交。
    if (next === undefined && due.date === undefined) return;
    onPick(due.date ?? today, next);
  };

  if (view === 'time') {
    // 🔴 这一档里每一枚控件都**不许**因为"还没选日子"而静默无效：
    //    `due.date ?? today` 就是 capture.ts 文件头那条「无日期的时刻落在今天（与滴答清单同款）」。
    //    文本解析对裸 `16:00` 保守（`dueTimeNeedsDate`）是因为它还可能是视频比例；
    //    **一次点击不是歧义**，所以这里落成今天。
    return (
      <View style={styles.body} accessibilityLabel={labels.panel.title} testID={testID ?? 'capture-due-panel'}>
        <View style={styles.head}>
          <Text style={[text['row-title'], styles.groupTitle]}>{labels.panel.time.timeLabel}</Text>
          <Pressable
            accessibilityRole="button"
            // 🔴 无障碍名必须说"返回日期"这件事本身。
            //    这里原来挂的是 `rowAria`（「选择时刻」）—— 那是**进入**时刻视图那枚按钮该说的话，
            //    由英文档那条 e2e 抓到：读屏用户在一枚写着「返回」的按钮上听到"选择时刻"。
            accessibilityLabel={labels.panel.time.backToDay}
            onPress={() => {
              setView('date');
              setManual(false);
            }}
            testID="capture-time-back"
          >
            <Text style={[text.caption, styles.timeValue]}>{labels.panel.time.backToDay}</Text>
          </Pressable>
        </View>

        {manual ? (
          <TextInput
            value={draft}
            onChangeText={commitDraft}
            onBlur={() => {
              setDraft(due.time ?? '');
            }}
            maxLength={'HH:MM'.length}
            keyboardType="numbers-and-punctuation"
            placeholder={labels.panel.time.placeholder}
            placeholderTextColor={tokens['color.foreground-subtle']}
            accessibilityLabel={labels.panel.time.aria}
            testID="capture-time-input"
            style={[text['row-meta'], styles.manualInput]}
          />
        ) : (
          <View style={styles.slots} testID="capture-time-slots">
            <Pressable
              accessibilityRole="button"
              aria-selected={due.time === undefined}
              onPress={() => {
                onPick(due.date ?? today, undefined);
              }}
              style={[styles.slot, due.time === undefined ? styles.slotOn : styles.slotOff]}
              testID="capture-time-slot-all-day"
            >
              <Text style={[text.caption, due.time === undefined ? styles.slotTextOn : styles.slotText]}>
                {labels.panel.time.allDay}
              </Text>
            </Pressable>
            {timeStepSlots(TIME_STEP_MINUTES).map((slot) => {
              const on = slot === due.time;
              return (
                <Pressable
                  key={slot}
                  accessibilityRole="button"
                  aria-selected={on}
                  onPress={() => {
                    onPick(due.date ?? today, slot);
                  }}
                  style={[styles.slot, on ? styles.slotOn : styles.slotOff]}
                  testID={`capture-time-slot-${slot}`}
                >
                  <Text style={[text.caption, styles.numericSlot, on ? styles.slotTextOn : styles.slotText]}>
                    {slot}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setManual((value) => !value);
            setDraft(due.time ?? '');
          }}
          testID="capture-time-mode"
        >
          <Text style={[text.caption, styles.timeValue]}>
            {manual ? labels.panel.time.backToList : labels.panel.time.otherTime}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.body} accessibilityLabel={labels.panel.title} testID={testID ?? 'capture-due-panel'}>
      <DatePicker
        value={due.date}
        today={today}
        quickPicks={quickPicks}
        labels={labels.panel.datePicker}
        // 🔴 面板**不传** `time`：时刻那一格在这里是"进子视图的入口"，
        // 不是第二份自由输入。传了它就有两个目的地相同的控件。
        onChange={(date) => {
          if (date === undefined) {
            onClear();
            return;
          }
          onPick(date, due.time);
        }}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labels.panel.time.rowAria}
        onPress={() => {
          setView('time');
          setDraft(due.time ?? '');
        }}
        style={styles.timeRow}
        testID="capture-time-row"
      >
        <Text style={[text.caption, styles.groupTitle]}>{labels.panel.time.timeLabel}</Text>
        <Text style={[text.caption, styles.timeValue]} testID="capture-time-value">
          {due.date === undefined ? labels.panel.time.allDay : (due.time ?? labels.panel.time.allDay)}
        </Text>
      </Pressable>

      {dueChips.length === 0 ? null : (
        <View style={styles.items} accessibilityLabel={labels.panel.dueItems} testID="capture-due-items">
          {dueChips.map((chip) => {
            const off = chip.action !== 'ignore';
            return (
              <View key={chip.key} style={[styles.item, off ? styles.itemOff : null]} testID={`capture-due-item-${chip.key}`}>
                <Text style={[text.caption, styles.raw]}>{chip.raw}</Text>
                <Text style={[text.caption, styles.value]}>
                  {chip.action === 'restore' ? labels.rejected : labels.valueLabel(chip, now)}
                </Text>
                {chip.action === 'unused' ? (
                  <Text style={[text.caption, styles.groupTitle]} testID="capture-due-item-hint">
                    {labels.unused}
                  </Text>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      chip.action === 'restore' ? labels.restoreAria(chip.raw) : labels.ignoreAria(chip.raw)
                    }
                    onPress={() => {
                      onToggle(chip);
                    }}
                    style={styles.toggle}
                    testID={`capture-due-item-toggle-${chip.key}`}
                  >
                    <HeytaIcon
                      data={chip.action === 'restore' ? RotateCcw : X}
                      size={tokens['icon.xs']}
                      color={tokens['color.foreground-subtle']}
                    />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
