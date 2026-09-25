/**
 * heyta 移动端根组件
 * ==================
 *
 * 🔴 这个文件里**没有一行业务逻辑**（AGENTS.md §3.5）：
 * 新建任务该写哪些字段、切换完成该发什么 op、清除日期写 null 还是 undefined ——
 * 全部来自 `@heyta/app-host` 的 `createTaskActions`。
 * 这里只负责：**导航外壳**、主题接线。
 *
 * 唯一的平台差异是**注入哪个 SQLite 驱动**，在 `db/open-host.ts` 里。
 *
 * ---
 *
 * 导航结构：**4 个 tab —— 任务 / 日历 / 专注 / 我的**。
 *
 * 🔴 刻意**不引入导航库**（React Navigation / Expo Router）。
 * 当前需求是"4 个平级 tab、无栈、无深链" —— 这是一段不到 200 行的状态切换。
 * 引入导航库会带来：一整套依赖树、它自己的主题系统（与我们的 token 必然重复）、
 * 以及原生侧额外的配置。**先不引入，等出现真实的栈/深链需求再评估** ——
 * 那时才有足够信息判断引哪个、值不值。
 *
 * 这不是"重复造轮子"：这里没有造轮子，只是在**还没有轮子需求**的时候
 * 用了最简单正确的东西。
 */

import React, { useState } from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, useTokens } from './theme';
import { TabBar, type TabKey } from './nav/TabBar';
import { TasksScreen } from './screens/TasksScreen';
import { CalendarScreen, FocusScreen, ProfileScreen } from './screens/NotYetImplemented';

function Shell(): React.JSX.Element {
  const t = useTokens();
  const { theme } = useTheme();
  const [tab, setTab] = useState<TabKey>('tasks');
  /**
   * 「任务」标签的角标数字。
   *
   * 🔴 **只由 `TasksScreen` 上报**，外壳不自己算 —— 待办口径只有一处定义
   * （`TasksScreen` 的 `groups`）。外壳再算一遍就会出现"角标写 3、屏幕里 4 条"，
   * 而且没有任何一处报错。
   *
   * `undefined` 而不是 `0`：0 会让角标要么常年顶着个红点、
   * 要么逼 `TabBar` 内部去特判。让"没有"就用"没有"表达。
   */
  const [pendingCount, setPendingCount] = useState<number | undefined>(undefined);

  return (
    <View style={{ flex: 1, backgroundColor: t['color.background'] }}>
      {/* 🔴 状态栏图标要**跟着主题走**：深色背景上放深色图标等于看不见。
          `dark-content` = 深色图标（用于浅色背景），反之亦然。
          另外必须给 `backgroundColor` —— Android 上状态栏默认是透明，
          内容滚到它下面时会透出来，看起来像渲染错位。 */}
      <StatusBar
        barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={t['color.background']}
      />
      <View style={{ flex: 1 }}>
        {tab === 'tasks' ? <TasksScreen onPendingCountChange={setPendingCount} /> : null}
        {tab === 'calendar' ? <CalendarScreen /> : null}
        {tab === 'focus' ? <FocusScreen /> : null}
        {tab === 'profile' ? <ProfileScreen /> : null}
      </View>
      <TabBar
        active={tab}
        onChange={setTab}
        badges={{ tasks: pendingCount }}
      />
    </View>
  );
}

export default function App(): React.JSX.Element {
  return <Shell />;
}

/** 入口：SafeAreaProvider + ThemeProvider。 */
export function Root(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}