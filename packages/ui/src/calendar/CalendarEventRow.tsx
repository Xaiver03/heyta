/**
 * `CalendarEventRow` —— 日历里"倒数日那一行"的**唯一一份 JSX**。
 *
 * 🔴 为什么单独一个文件，而不是在两块板里各写一遍：
 * 本目录的 `CalendarBoard.tsx` 文件头写着这条线的老规矩 ——
 * 「日历格里的行 = `<TaskRow density="minimal" />`。**不是三份 JSX。**」
 * 倒数日这行现在有**两个容器**要它（月/周档"选中那天"的清单、日档的「全天」带），
 * 各写一份的下场就是同一行在不同容器里不同高度、不同字色 ——
 * 那正是 `density` 这一档在本仓要消灭的东西（§4.2 的判据）。
 *
 * ## 这里**不判**任何事
 *
 * · 这一天到底有没有这个日子 → `model.ts#groupEventsByOccurrence`
 *   （它再往下是 `@heyta/domain` 的 `eventOccurrencesInRange`：农历、闰月三档、重复规则展开）
 * · 这句话怎么写 → `model.ts#calendarEventBarTitle`（词表由宿主注入）
 * · 排在哪一位 → 由容器决定（清单里排在任务**下面**：任务是"要做的"，
 *   倒数日是"这天为什么值得记"，排前面会让人以为它是待办）
 *
 * ⚠️ **不可勾选、不可点开**：`CountdownEvent` 不是 `Task`。给它一个勾选框只有两条路 ——
 * 伪造 `completedAt`（那条 op 会写进任务通道）或在共享层发明第三种语义，两条都比
 * "这一行读不出可交互"贵。完成/归档在「我的 → 倒数纪念日」那个面板里做。
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HeytaNativeTokens } from '@heyta/design-system';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  calendarEventBarTitle,
  type CalendarDayEvent,
  type CalendarEventBarLabels,
} from './model.js';

export interface CalendarEventRowProps {
  readonly event: CalendarDayEvent;
  /** 宿主注入的词表。**不给就只剩标题**（与网格那条同一条理由：默认值必须等于"没接之前"）。 */
  readonly labels: CalendarEventBarLabels | undefined;
  /**
   * 整行的锚点。**由调用方带上自己的命名空间**（两块板各自的 `testID` 前缀不同），
   * 组件只负责在它后面接 `-title`。
   *
   * 🔴 标题必须**自己带一个 testID**：RN-web 里 `Text` 与 `View` 都渲染成 `<div>`，
   *   判据若靠"行里第一个 div"会正好抓到那根没有字的色条，
   *   量到的东西与"字读不读得出"毫无关系（`CalendarBoard` 的格子条真错过一次）。
   */
  readonly testID: string;
}

export function CalendarEventRow({
  event,
  labels,
  testID,
}: CalendarEventRowProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  return (
    <View style={styles.row} testID={testID}>
      {/* 左侧色条与格子里那条同宽同圆角：读者要能把"网格那条"和"清单这行"认成同一个东西。 */}
      <View
        style={{
          width: tokens['border-width.thick'],
          alignSelf: 'stretch',
          borderRadius: tokens['radius.full'],
          backgroundColor: tokens['color.primary'],
        }}
      />
      <Text
        numberOfLines={1}
        testID={`${testID}-title`}
        style={[text['row-meta'], styles.title, { color: tokens['color.foreground'] }]}
      >
        {calendarEventBarTitle(event, labels)}
      </Text>
    </View>
  );
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.1'] },
    title: { flex: 1, minWidth: 0 },
  });
}
