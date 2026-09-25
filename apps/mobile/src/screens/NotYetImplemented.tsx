/**
 * 尚未实现的三个 tab
 * ==================
 *
 * 🔴 这些是**诚实的占位**，不是伪造内容的界面。
 *
 * 为什么刻意做成"看得出来的未完成"，而不是画一些假数据：
 * 假数据会让整个应用看起来是完成了的 —— 于是"日历还没做"这件事
 * 只存在于某个人的记忆里，不在产品里。等真去做的时候，
 * 已经没人记得哪里是真哪里是假了。
 *
 * 导航壳（4 个 tab）是真的、可用的；这三个页面的内容是真的还没做。
 * 两者必须在界面上就分得开。
 *
 * ⚠️ 本文件是**临时的**：每实现一个 tab，就把对应组件从这里移出去、
 * 换成真实屏幕。三个都实现完，这个文件应当被删除 ——
 * 而不是留下来继续当"以后再说"的收纳箱。
 */

import React from 'react';
import { EmptyState, Screen } from '../ui/kit';

/** 日历：将来放月/周视图 + 按日期看任务，并支持拖拽改期。 */
export function CalendarScreen(): React.JSX.Element {
  return (
    <Screen title="日历">
      <EmptyState
        icon="tab.calendar"
        title="日历还没做"
        hint="这里将来是按日期看任务的地方：月视图、周视图、拖拽改期。"
        detailTone="subtle"
        detail="任务目前按「已过期 / 今天 / 收集箱」分组显示在「任务」页。"
      />
    </Screen>
  );
}

/** 专注：将来放番茄钟 + 专注统计，与任务关联。 */
export function FocusScreen(): React.JSX.Element {
  return (
    <Screen title="专注">
      <EmptyState
        icon="tab.focus"
        title="专注还没做"
        hint="这里将来是番茄钟：选一个任务，计时，记录专注时长。"
        detailTone="subtle"
        detail="设计系统里已有 numeric-display 样式（等宽数字），专门给倒计时用。"
      />
    </Screen>
  );
}

/** 我的：将来放账号、同步状态、清单与标签管理、主题与无障碍设置。 */
export function ProfileScreen(): React.JSX.Element {
  return (
    <Screen title="我的">
      <EmptyState
        icon="tab.profile"
        title="设置还没做"
        hint="这里将来是账号、同步状态、清单与标签管理、外观与无障碍设置。"
        detailTone="subtle"
        detail="同步服务端地址目前硬编码在 apps/mobile/src/db/open-host.ts（只允许的平台差异之外）。"
      />
    </Screen>
  );
}