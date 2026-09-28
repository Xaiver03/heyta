/**
 * 提醒列表（共享视图）
 * ======================
 *
 * M3 第十刀的共享实现：**"一条任务下面挂着哪几条提醒、每条现在什么状态、
 * 能对它做什么"这件事只有这一个实现。** web 与 mobile 只决定"把它放在
 * 页面的哪里"、注入文案，以及把三个回调接到各自的 action 层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 提醒是 A/B 两端都要有的签名功能（`docs/plans/site-and-parity-alignment.md`
 * §B1）。迁移前它只在 `apps/web` 的 `features/reminders` 里有一份，
 * 移动端一行都没有。两端各自回答"到点了没有""这条还能不能稍后提醒"的结果是：
 * 同一个 `Reminder` 在两个端上被读成两个样子，而差异**不会让任何测试变红**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 状态与时刻一律来自 `./model.ts`，组件里不做任何判断
 *
 * `phase` / `when` / `canSnooze` / `canDismiss` / `canRemove` 全部是
 * `toReminderRows` 算好的（它内部又只调 `@heyta/domain` 的 `reminderPhase` /
 * `reminderEffectiveAt`）。本文件**没有** `snoozedUntil ?? triggerAt`，
 * 也没有 `phase === 'fired'` 这种散落判断 —— 那些正是"第二份定义"的入口。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList` / `HabitBoard` / `OrganizerList` 同一个理由：i18n 包自己带过
 * 一份 React，四端会同时中招（`check:mobile-bundle` 盯着）。所以依赖行内容
 * 的无障碍名是函数（`a11ySnooze(when)`），模板留在有 i18n 的那一侧。
 *
 * `formatWhen` 也是注入的：相对时间（"10 分钟后"）与绝对时间（"周三 09:00"）
 * 是**产品口径**，而"多久算今天"依赖各端的本地化与用户偏好 ——
 * 共享层不认识 `Intl`，也不该替宿主决定。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 没有截止时间时换成**绝对时刻入口**，并把原因写出来
 *
 * `hasDueDate === false`（任务没有截止时间）时，"提前 30 分钟"没有参照物，
 * 相对提前量算不出来。本组件因此**一个相对预设都不渲染**
 * （`presets = hasDueDate ? offsetPresets() : []`），改为渲染一个由
 * `onAddAbsolute` 驱动的**绝对时刻**按钮，并在下面显示 `labels.noDueDate`
 * 说明为什么只剩它。
 *
 * 🔴 **这里踩过一次真坑，别改回去**：最初写的是
 * `offsetPresets().slice(0, 1)` —— 保留 `0` 那一档（文案"截止时"）。
 * 那**不是"少一个参照物"，是"多一个必然失败的按钮"**：
 * 宿主拿 `offsetMs = 0` 只能调 `createReminderBeforeDue(taskId, 0)`，
 * 而它在任务没有 `dueDate` 时**明确抛错**（`reminder-actions.ts`）。
 * ⇒ 规律：**档位与回调是一个契约的两半，"截断数组"会把它们拆开** ——
 * 少渲染几档不等于语义对得上。
 *
 * ⚠️ **不要**让按钮静默消失：用户看到"只有这一个入口、而且旁边写着为什么"，
 * 与看到"前一秒还有五个按钮、现在只剩一个且没人解释"，是完全不同的体验。
 * 前者知道了规则，后者只学会了不信任这个界面。
 * （`onAddAbsolute` 不传时**确实什么都不渲染** —— 那是在主动声明
 * "本端没有这个能力"，与"渲染一个按下去会抛错的按钮"不是一回事。）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 结束态的动作是**不渲染**，不是渲染成禁用
 *
 * `fired` / `dismissed` 的提醒不再出现 snooze / dismiss 按钮（`canSnooze` /
 * `canDismiss` 为 `false`），只剩 remove。理由：领域层对已投递的提醒再
 * snooze **不会让它复活**（`firedAt` 一旦写上就是单调的，见
 * `reminders.ts` 文件头第 2 条），一个点了没反应的禁用按钮比没有这个按钮
 * 更让人困惑。判据仍然只有 `./model.ts` 一处，组件只负责照 `can*` 摆。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `Pressable` 在 `react-native-web` 上都有等价实现；
 * `<button>` 在 iOS 上不存在。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { Reminder, ReminderPhase } from '@heyta/domain';
import { Clock, Plus, Trash2, X } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { offsetPresets, reminderPhaseToken, toReminderRows } from './model.js';

/** 列表全部文案，**每一项都由宿主注入**（见文件头）。 */
export interface ReminderListLabels {
  /** 列表标题（"提醒"）。 */
  readonly title: string;
  /** 一条提醒都没有时那一句。 */
  readonly empty: string;
  /** "添加提醒"那一排按钮的**前缀**语义（读屏用；可见文字是各预设自己的）。 */
  readonly add: string;
  /**
   * 每个预设的可见文案，**下标与 `offsetPresets()` 一一对应**。
   *
   * 🔴 长度/顺序漂移是本组件最容易静默错的地方：按钮显示"提前 30 分钟"、
   * 点下去却是"提前 1 天"。契约由 `offsetPresets()` 的**同一个数组引用**
   * 保证（见 `./model.ts`）。
   */
  readonly offsets: readonly string[];
  readonly snooze: string;
  readonly dismiss: string;
  readonly remove: string;
  /**
   * 任务没有截止时间时，解释"为什么这里不能按提前量建"。
   *
   * ⚠️ 这一句**不是**按钮文字（那是 {@link absolute}），是说明。
   */
  readonly noDueDate: string;
  /**
   * 没有截止时间时那**一个**按钮的文字（"1 小时后提醒"）。
   *
   * 🔴 为什么需要它，而不是复用 `offsets[0]`：
   * 预设 `0` 的文案是「截止时」，而没有截止时间时**根本没有"截止时"这个时刻**
   * —— 照着渲染会得到一个写着"截止时"、按下去必然抛错的按钮
   * （`createReminderBeforeDue` 对无 `dueDate` 的任务明确抛错）。
   * 所以这一档是**绝对时刻**语义，文案与回调都必须另给
   * （见 `onAddAbsolute`）。
   */
  readonly absolute: string;
  /** 状态 → 徽标文字。`Record` 是刻意的：五个状态一个都不能漏。 */
  readonly phase: Record<ReminderPhase, string>;
  readonly a11yRemove: (when: number) => string;
  readonly a11ySnooze: (when: number) => string;
  readonly a11yDismiss: (when: number) => string;
  /** 整个列表给屏幕阅读器的那一句（含标题，读屏用户据此知道"这里是提醒区"）。 */
  readonly a11yList: (title: string) => string;
}

export interface ReminderListProps {
  /** 未删除的提醒（由宿主从 action 层取，`listReminders()` 已经是）。 */
  readonly reminders: readonly Reminder[];
  /** 当前时间（epoch ms）。显式传入，否则跨触发点与测试都不可复现。 */
  readonly now: number;
  /**
   * 归属任务有没有截止时间。`false` 时相对提前量没有参照物 ——
   * 只渲染第一个预设并显示 `labels.noDueDate`（见文件头）。
   */
  readonly hasDueDate: boolean;
  /** 加一条"截止前 offsetMs"的提醒。`0` = 截止时。**仅在有截止时间时被调用。** */
  readonly onAdd: (offsetMs: number) => void;
  /**
   * 加一条**绝对时刻**的提醒（任务没有截止时间时那唯一的一个入口）。
   *
   * 🔴 与 `onAdd` 分开是刻意的：两者的语义不同（相对 vs 绝对），
   * 合用一个回调会逼实现方在内部猜"这个 0 到底是截止时还是现在"。
   * 具体时刻由宿主决定（宿主才有 `now` 与产品默认值）。
   *
   * 不传 = 不渲染这个入口（只有说明文字）。**不渲染一个按下去会抛错的按钮。**
   */
  readonly onAddAbsolute?: () => void;
  /**
   * 稍后提醒。收**提醒自己的 id**（`ReminderRow.entityId`，即 `Reminder.id`）。
   *
   * ⚠️ 不是 `taskId`：`createReminderActions` 的同名方法收的就是提醒自己的 id。
   * 这里曾经写成"收任务 id"，是一句**与实现相反**的注释（组件传的一直是
   * `row.entityId`）—— 记在这里是因为下一个人很可能照着注释去接 `taskId`。
   */
  readonly onSnooze: (entityId: string) => void;
  /** 关闭这条提醒。收**提醒自己的 id**（同 `onSnooze`）。 */
  readonly onDismiss: (entityId: string) => void;
  /** 移除这条提醒。收**提醒自己的 id**（同 `onSnooze`）。 */
  readonly onRemove: (entityId: string) => void;
  readonly labels: ReminderListLabels;
  /**
   * 把触发时刻渲染成人读的字符串。
   *
   * ⚠️ **必须由宿主注入**：相对/绝对口径、"多久算今天"依赖本地化，
   * 而共享层不 import `@heyta/i18n`、也不认识 `Intl`（见文件头）。
   */
  readonly formatWhen: (at: number) => string;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸尺度值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    board: {
      gap: tokens['space.3'],
    },
    empty: {
      gap: tokens['space.1'],
    },
    /** 行容器。`list` role 给读屏，视觉上只是一列。 */
    list: {
      gap: tokens['space.2'],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
    },
    /** 时刻 + 徽标，吃掉剩余宽度（长文案换行而不是挤掉动作按钮）。 */
    main: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: tokens['space.2'],
    },
    when: {
      flexShrink: 1,
      fontVariant: ['tabular-nums'],
    },
    badge: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['size.badge-height'],
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.surface-sunken'],
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    /** 行内动作：图标 + 文字，触控目标下限靠 `minHeight`/`minWidth` 保证。 */
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      minWidth: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: 'transparent',
    },
    actionText: {
      color: tokens['color.foreground'],
    },
    /** "添加提醒"一排：可换行，预设多时不会把容器撑破。 */
    addRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['size.field-padding-x'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.primary'],
    },
    addText: {
      color: tokens['color.on-primary'],
    },
  });
}

export function ReminderList({
  reminders,
  now,
  hasDueDate,
  onAdd,
  onAddAbsolute,
  onSnooze,
  onDismiss,
  onRemove,
  labels,
  formatWhen,
  testID,
}: ReminderListProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const rows = useMemo(() => toReminderRows(reminders, now), [reminders, now]);

  /**
   * 🔴 有截止时间 → 相对提前量预设；没有 → **一个绝对时刻入口**。
   *
   * 这里曾经是 `hasDueDate ? offsetPresets() : offsetPresets().slice(0, 1)` ——
   * 也就是无截止时间时留着 `0` 那一档。那**是个 bug**：`0` 的文案是「截止时」，
   * 而没有截止时间时按下去会调 `createReminderBeforeDue`，
   * 它对无 `dueDate` 的任务**明确抛错**。用户看到的是一个必然失败的按钮。
   *
   * ⇒ 规律：**"少渲染几档"不等于"语义对得上"** —— 档位与回调是一个契约的两半，
   * 截断数组会把它们拆开。
   */
  const presets = hasDueDate ? offsetPresets() : [];

  return (
    <View style={styles.board} testID={testID}>
      <Text accessibilityRole="header" style={[text['section-title'], { color: tokens['color.foreground'] }]}>
        {labels.title}
      </Text>

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
            {labels.empty}
          </Text>
        </View>
      ) : (
        <View
          style={styles.list}
          accessibilityRole="list"
          accessibilityLabel={labels.a11yList(labels.title)}
        >
          {rows.map((row) => (
            <View key={row.id} style={styles.row} testID={`reminder-row-${row.id}`}>
              <View style={styles.main}>
                <Text
                  style={[text['row-meta'], styles.when, { color: tokens['color.foreground'] }]}
                >
                  {formatWhen(row.when)}
                </Text>
                {/*
                  状态徽标：文字来自 `labels.phase`，颜色来自 `./model.ts` 的
                  `reminderPhaseToken` —— 组件里没有 `phase === …` 的分支。
                */}
                <View style={styles.badge} testID={`reminder-phase-${row.id}`}>
                  <Text
                    style={[
                      text.badge,
                      { color: tokens[reminderPhaseToken(row.phase)] },
                    ]}
                  >
                    {labels.phase[row.phase]}
                  </Text>
                </View>
              </View>

              <View style={styles.actions}>
                {/*
                  snooze / dismiss 只在 `can*` 为真时渲染；结束态只剩 remove。
                  见文件头「结束态的动作是不渲染，不是渲染成禁用」。
                */}
                {row.canSnooze ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={labels.a11ySnooze(row.when)}
                    onPress={() => {
                      onSnooze(row.entityId);
                    }}
                    style={styles.actionButton}
                    testID={`reminder-snooze-${row.id}`}
                  >
                    <HeytaIcon data={Clock} size={tokens['icon.xs']} color={tokens['color.foreground']} />
                    <Text style={[text.caption, styles.actionText]}>{labels.snooze}</Text>
                  </Pressable>
                ) : null}

                {row.canDismiss ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={labels.a11yDismiss(row.when)}
                    onPress={() => {
                      onDismiss(row.entityId);
                    }}
                    style={styles.actionButton}
                    testID={`reminder-dismiss-${row.id}`}
                  >
                    <HeytaIcon data={X} size={tokens['icon.xs']} color={tokens['color.foreground']} />
                    <Text style={[text.caption, styles.actionText]}>{labels.dismiss}</Text>
                  </Pressable>
                ) : null}

                {row.canRemove ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={labels.a11yRemove(row.when)}
                    onPress={() => {
                      onRemove(row.entityId);
                    }}
                    style={styles.actionButton}
                    testID={`reminder-remove-${row.id}`}
                  >
                    <HeytaIcon data={Trash2} size={tokens['icon.xs']} color={tokens['color.danger']} />
                    <Text style={[text.caption, styles.actionText]}>{labels.remove}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}

      {/*
        🔴 `labels.add` 是**这一排按钮**的名字，不是某个按钮的。

        它曾经是个死字段（定义了但没人读）—— 而一个没有消费者的 label
        正是本仓库门禁在修的形状（"基础设施做完了、最后一米没接"），
        只是缩小到了一个字段。读屏用户现在听到的是「添加提醒」+ 各个预设，
        而不是一串没有归属的按钮。
      */}
      <View
        style={styles.addRow}
        accessibilityLabel={labels.add}
        testID="reminder-add-row"
      >
        {presets.map((offsetMs, index) => {
          const label = labels.offsets[index] ?? '';
          return (
            <Pressable
              key={String(offsetMs)}
              accessibilityRole="button"
              // 可见文字就是 `label`，但仍显式给无障碍名：图标按钮与文本按钮
              // 一律带 `accessibilityLabel` 是本层的硬约定，避免将来换成纯图标时漏掉。
              accessibilityLabel={label}
              onPress={() => {
                onAdd(offsetMs);
              }}
              style={styles.addButton}
              testID={`reminder-add-${String(index)}`}
            >
              <HeytaIcon data={Plus} size={tokens['icon.xs']} color={tokens['color.on-primary']} />
              <Text style={[text.caption, styles.addText]}>{label}</Text>
            </Pressable>
          );
        })}

        {/*
          没有截止时间时的**唯一**入口：绝对时刻。
          🔴 不传 `onAddAbsolute` 就什么都不渲染 —— 一个按下去会抛错的按钮
          比没有按钮更糟（见 `ReminderListProps.onAddAbsolute`）。
        */}
        {hasDueDate || onAddAbsolute === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.absolute}
            onPress={onAddAbsolute}
            style={styles.addButton}
            testID="reminder-add-absolute"
          >
            <HeytaIcon data={Plus} size={tokens['icon.xs']} color={tokens['color.on-primary']} />
            <Text style={[text.caption, styles.addText]}>{labels.absolute}</Text>
          </Pressable>
        )}
      </View>

      {/*
        没有截止时间时**必须解释**，否则用户只看到"预设少了一半"（见文件头）。
      */}
      {hasDueDate ? null : (
        <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]} testID="reminder-no-due-date">
          {labels.noDueDate}
        </Text>
      )}
    </View>
  );
}
