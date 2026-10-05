/**
 * 日历里"这一天的倒数日"那一叠行（W6）
 * ====================================
 *
 * 它存在的理由只有一条：**倒数日不是任务**。
 *
 * `TaskList` 那一行有复选框、有截止槽、有"完成"这个动作 —— 把一条"妈妈生日"
 * 塞进去，界面就会问它一个它答不上来的问题（"这天做完了几件？"）。而反过来
 * 让它冒充一条 `Task`（给它发明一个并不存在的 `dueDate`）正是 W6 那条判据要防的事：
 * **判据是"没有截止日的倒数日也能上日历"**，一旦要靠补 `dueDate` 才显示得出来，
 * 它测的就已经不是这件事了。
 *
 * 🔴 所以这一行**只说一件事**：这条倒数日在这一天。
 * · 不画"还有 N 天"：那是倒数日屏的口径，同一屏两处各数一次就是两套数
 *   （`../countdown/model.ts#countdownFace` 是它唯一的事实源）；
 * · 不可点：共享板没有"打开某条倒数日"的端口，而 §9.3 的立场是
 *   "不摆点了没反应的菜单项" —— 等宿主真的给出跳转再挂 `Pressable`。
 *
 * 外观**照格子里那条任务条**（左侧状态条 + 一行标题）：同一块日历里"一件事"
 * 该长成一个样，否则用户要重新学一遍哪种行能勾。
 *
 * ⚠️ 月/周档的当天那块与日档的"全天带"**共用这一个实现**（不是两份 JSX）——
 * 这正是 `check:row-single-source` 那条"一行只许有一份实现"的立场在一个
 * 还不是任务行的东西上的用法。
 */

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { CountdownEvent } from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';

export interface CalendarEventRowListProps {
  /** 这一天落得的倒数日（归属判断在 `model.ts#groupEventsByOccurrence`）。 */
  readonly events: readonly CountdownEvent[];
  /** 每行的锚点前缀；行本身是 `${testIDPrefix}-${event.id}`（按 id，不按 index）。 */
  readonly testID: string;
}

/** 一行的锚点：判据要能按 id 取到它 —— index 会随插入/删除错位。 */
const rowTestID = (prefix: string, event: CountdownEvent): string =>
  `${prefix}-${event.id}`;

export function CalendarEventRowList({
  events,
  testID,
}: CalendarEventRowListProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  /*
   * 行之间的缝。`gap` 取 `space.2`：这两叠行是**并列**关系（一叠可勾、一叠不可勾），
   * 中间要有可辨的缝，而 `space.1` 在读屏缩放后基本贴在了一起。
   */
  const listStyle = useMemo(
    () => ({ gap: tokens['space.2'], paddingTop: tokens['space.2'] }),
    [tokens],
  );

  return (
    <View style={listStyle} testID={testID}>
      {events.map((event) => (
        <View
          key={event.id}
          testID={rowTestID(testID, event)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] }}
        >
          <View
            style={{
              width: tokens['border-width.thick'],
              height: tokens['space.4'],
              borderRadius: tokens['radius.full'],
              backgroundColor: tokens['color.primary'],
            }}
          />
          {/* 🔴 标题自己带 testID，和格子里那条任务条同一形状：
              RN-web 里 `Text` 与 `View` 都渲染成 `<div>`，判据抓"行里第一个 div"
              会正好抓到那根没有字的色条（这条真错过一次，见 `CalendarBoard.tsx` 同处注释）。 */}
          <Text
            numberOfLines={1}
            testID={`${rowTestID(testID, event)}-title`}
            style={[text['row-meta'], { color: tokens['color.foreground'] }]}
          >
            {event.title}
          </Text>
        </View>
      ))}
    </View>
  );
}
