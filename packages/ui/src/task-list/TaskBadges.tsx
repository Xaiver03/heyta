/**
 * 任务行的徽章（共享）
 * ====================
 *
 * 截止 / 优先级 / 重复 这三个徽章原本**每个端各写一遍**：
 * `apps/mobile/src/screens/TasksScreen.tsx` 里有 60 多行是它们的布局，
 * web 端另有一套。这正是"共享组件接管机制"要收掉的那部分。
 *
 * ## 分工：图标 + 布局 + 无障碍 共享；**文字**与**颜色值**由宿主给
 *
 * | 共享 | 宿主 |
 * |---|---|
 * | 图标字形（从 `lucide` 取数据，见 `../icon/Icon.tsx`） | 截止文案（`t()`） |
 * | 图标与文字的间距、字号、对齐 | 优先级文案 |
 * | 逾期自动变红 | **优先级的颜色**（由优先级数值决定） |
 * | 无文字时退化成纯图标（仍可读屏） | 重复规则的句子 |
 *
 * 为什么"优先级的颜色"由宿主给、而"逾期变红"留在共享层：逾期是个**布尔语义**
 * （只有两个状态，且"逾期=危险色"是设计系统的规定），而优先级是**数据驱动的**
 * （High/Medium/Low… 各有各的色槽，映射规则属于业务）。把后者定死在共享层
 * 就等于把优先级色板焊死，将来加一档就要改共享包。
 *
 * ## 无障碍：图标默认**不**单独表意
 *
 * 徽章旁边一定有文字，所以图标是装饰性的 —— 传 `label` 会让读屏把同一件事
 * 念两遍。只有**没有文字**时（`text` 为空）才需要图标自己承担语义。
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CalendarClock, Flag, Repeat, TriangleAlert } from 'lucide';
import { HeytaIcon, type HeytaIconData } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';

/**
 * 徽章字形。
 *
 * ⚠️ 这几个选择**必须与各端已有的一致**（mobile 的
 * `apps/mobile/src/ui/icons.tsx` 里就是这样登记的），否则同一个"逾期"
 * 在手机上是个三角、在桌面上是另一种形状 —— 那比没有图标更糟。
 */
const GLYPHS = {
  due: CalendarClock,
  overdue: TriangleAlert,
  priority: Flag,
  repeat: Repeat,
} satisfies Record<string, HeytaIconData>;

export interface TaskBadgesProps {
  /** 截止：已本地化的文案，以及是否逾期。逾期由共享层决定用危险色。 */
  readonly due?: { readonly text: string; readonly overdue: boolean } | null;
  /** 优先级：已本地化的文案 + 颜色（色槽由业务决定，见文件头注释）。 */
  readonly priority?: { readonly text: string; readonly color: string } | null;
  /** 重复：已本地化的句子。 */
  readonly repeat?: string | null;
  /**
   * 没有文字时给图标的无障碍名。
   *
   * ⚠️ 只在**确实没有文字**时才会被用上；有文字时图标不表意。
   * 三个徽章共用这一个值会说不清是哪一个，所以它只在"整行只有一个无文字徽章"
   * 的场景下有意义 —— 那种场景目前不存在，但留着这个口子比到时候硬塞一条
   * 拼接的假文案要好。
   */
  readonly iconLabel?: string;
  readonly testID?: string;
}

export function TaskBadges({
  due,
  priority,
  repeat,
  iconLabel,
  testID,
}: TaskBadgesProps): React.JSX.Element | null {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.2'],
        },
        item: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.1'] },
      }),
    [tokens],
  );

  const hasDue = due !== null && due !== undefined;
  const hasPriority = priority !== null && priority !== undefined;
  const hasRepeat = repeat !== null && repeat !== undefined && repeat !== '';

  // 一个都没有时**返回 null**，而不是渲染一个空的 View。
  // 空 View 也会占掉 `gap` 的间距，让没有徽章的行看起来比有徽章的行矮一截。
  if (!hasDue && !hasPriority && !hasRepeat) return null;

  const dueColor = due?.overdue === true ? tokens['color.danger'] : tokens['color.foreground-subtle'];

  return (
    <View style={styles.row} testID={testID}>
      {hasDue ? (
        <View style={styles.item}>
          <HeytaIcon
            data={due.overdue ? GLYPHS.overdue : GLYPHS.due}
            size={tokens['icon.xs']}
            color={dueColor}
            {...(due.text === '' && iconLabel !== undefined ? { label: iconLabel } : {})}
          />
          <Text
            style={[
              text['row-meta'],
              // 逾期用危险色。**不只靠颜色**：字形本身也换成了警告三角，
              // 色觉障碍用户靠形状就能分辨。
              { color: dueColor },
            ]}
          >
            {due.text}
          </Text>
        </View>
      ) : null}

      {hasPriority ? (
        <View style={styles.item}>
          <HeytaIcon
            data={GLYPHS.priority}
            size={tokens['icon.xs']}
            color={priority.color}
            {...(priority.text === '' && iconLabel !== undefined ? { label: iconLabel } : {})}
          />
          <Text style={[text['row-meta'], { color: priority.color }]}>{priority.text}</Text>
        </View>
      ) : null}

      {hasRepeat ? (
        <View style={styles.item}>
          <HeytaIcon
            data={GLYPHS.repeat}
            size={tokens['icon.xs']}
            color={tokens['color.foreground-subtle']}
          />
          <Text style={[text['row-meta'], { color: tokens['color.foreground-muted'] }]}>
            {repeat}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
