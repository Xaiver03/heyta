/**
 * heyta 移动端根组件
 * ==================
 *
 * 🔴 这个文件里**没有一行业务逻辑**（AGENTS.md §3.5）：
 * 新建任务该写哪些字段、切换完成该发什么 op、清除日期写 null 还是 undefined ——
 * 全部来自 `@heyta/app-host` 的 `createTaskActions`。
 * 这里只负责：**导航外壳**、主题接线、**自动同步的启动**、
 * 以及**首次启动的欢迎页**（规范 `user-journey-and-auth.md` §3.1）。
 *
 * 唯一的平台差异是**注入哪个 SQLite 驱动**，在 `db/open-host.ts` 里。
 *
 * ---
 *
 * 导航结构：**5 个 tab —— 任务 / 日历 / 专注 / 分类 / 我的**
 * （`nav/TabBar.tsx` 的 `TABS`）。四象限**不在**导航里：它是「任务」页内的视图切换
 * （ADR-0015 §4），不再是第 6 个 tab（P10 已撤销那一刀）。
 *
 * 🔴 **欢迎页也不是 tab**（规范 §2-A8）：它是首次启动时**覆盖**主界面的一屏，
 * 底部标签仍然是 5 个。两个按钮都是"出去的路"——点「先离线使用」一步进主界面，
 * 未登录的本地功能照常。这里**没有登录墙**，理由写在规范 §0。
 *
 * 🔴 刻意**不引入导航库**（React Navigation / Expo Router）。
 * 当前需求是"5 个平级 tab + 每个 tab 一条轻量二级栈"，由 `nav/navigation.tsx`
 * 维护根 tab 与 push/pop；Modal 只负责平台输入表面，不再另造一套路由状态。
 * 引入导航库会带来：一整套依赖树、它自己的主题系统（与我们的 token 必然重复）、
 * 以及原生侧额外的配置。等真实深链需求出现，再用证据评估是否值得引入。
 *
 * 这不是"重复造轮子"：这里没有造轮子，只是在**还没有轮子需求**的时候
 * 用了最简单正确的东西。
 */

import React, { useEffect, useState } from 'react';
import { AppState, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider, type Locale } from '@heyta/i18n';
import { ThemeProvider, useTheme, useTokens } from './theme';
import { LocalePreferenceProvider } from './i18n/locale-preference';
import { resolveDeviceLocale } from './i18n/locale';
import { TabBar } from './nav/TabBar';
import { NavigationProvider, useMobileNavigation } from './nav/navigation';
import { TasksScreen } from './screens/TasksScreen';
// 🔴 五个 tab 现在**全部是真实屏幕**了 —— `screens/NotYetImplemented.tsx`
// 已按它自己文件头写好的方式删除（"实现一个就移走一个，最后删掉它"）。
// ⚠️ `QuadrantScreen` 不再是 tab：它已改为**「任务」页内那一档**的实现，
// import 在 `screens/TasksScreen.tsx` 里（不再由外壳渲染）。
import { CalendarScreen } from './screens/CalendarScreen';
import { FocusScreen } from './screens/FocusScreen';
import { CategoriesScreen } from './screens/CategoriesScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { PrivacyConsentSheet } from './screens/PrivacyConsentSheet';
// 🔴 G-27 的第二块面板：**账号级**补签。与隐私面板挂在**同两处**（欢迎页 + 主界面），
// 由 `legal-recheck/reconfirm-ui.ts` 的 `open` 裁决 —— 两块同时开着是允许的
// （它们问的不是同一个决定），但不会出现两层：每一块自己 `!open` 就返回 null。
import { LegalReconfirmSheet } from './screens/LegalReconfirmSheet';
import { startPrivacyGate } from './privacy/startup';
import { startAutoSync } from './sync/auto-sync';
import { useMobileSync } from './sync/store';
import { startWidgetLifecycle } from './widgets/lifecycle';
import { DEFAULT_SERVER_URL, readSyncConfig } from './sync/config';
import { hasSeenWelcome, markWelcomeSeen } from './prefs/device-prefs';
import { reconcileNativeReminders, subscribeNativeReminderWrites } from './lib/native-reminder-scheduler';
import { startMobileInboundWorker } from './inbound/lifecycle';

/**
 * 🔴 **隐私闸门必须在任何一次渲染之前装好**（G-12）。
 *
 * 放在模块顶层而不是 `useEffect` 里，理由是一条实测出来的时序：
 * 首启时面板要弹（G-11），而 `fetch` 要在那之前就已经换成带闸门的那个 ——
 * effect 要等首帧提交完才跑，而 `openTaskHost()` 在启动的 await 链里就会发出
 * 第一个同步请求。**差一个 tick 就是"同意之前发过请求"**，
 * 而这件事在界面上完全看不出来。
 *
 * ⚠️ 它必须在 `Shell` 之前求值，也就是**不能**塞进任何组件里。
 */
startPrivacyGate();

function Shell(): React.JSX.Element {
  const t = useTokens();
  const { theme } = useTheme();
  const { tab, setTab } = useMobileNavigation();
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
  const { dataRevision } = useMobileSync();

  // 原生通知不是 React 状态；数据变化、冷启动和回前台都走同一条回收/排程路径。
  useEffect(() => {
    const reconcile = (): void => { void reconcileNativeReminders().catch((error: unknown) => {
      console.warn('[reminder] 原生提醒同步失败：', error);
    }); };
    reconcile();
    const unsubscribeWrites = subscribeNativeReminderWrites((error: unknown) => {
      console.warn('[reminder] 本地写入后排程失败：', error);
    });
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') reconcile();
    });
    return () => { subscription.remove(); unsubscribeWrites(); };
  }, [dataRevision]);

  /**
   * 🔴 **自动同步**：回到前台时拉一次，本地写入之后（防抖）推一次。
   *
   * 在这个 effect 之前，全应用**只有**「我的」页那个按钮会调 `syncNow()`。
   * 也就是用户建完一条任务，它**不会自己出去** —— 要让它到另一台设备，
   * 用户得自己想到"去我的页点一下同步"。这不是少个功能，
   * 这是本地优先应用最核心的承诺没兑现，而且**不报错、界面也看不出异常**。
   *
   * `startAutoSync()` 是**幂等**的（React 严格模式下 effect 会跑两次，
   * 不幂等就会挂两个监听 + 两套定时器，表现为同步请求翻倍），
   * 并且返回停止函数 —— 正好是清理函数该有的形状。
   */
  useEffect(() => startAutoSync(), []);

  // Automatic capture is a foreground worker on mobile. The shared loop
  // rechecks Vault, recipient-key, worker-token, route and consent readiness;
  // closing/backgrounding the app stops new claims rather than pretending the
  // device is an always-on executor.
  useEffect(() => startMobileInboundWorker(), []);

  /**
   * 🔴 **小组件**：启动时醒一次，回到前台再醒一次。醒来做两件事 ——
   * **drain**（把组件里攒下的点击落成 op）与 **publish**（重发快照）。
   *
   * 为什么必须有这个 effect：
   *
   * 1. 组件**产生不了 op**（刻意的红线，见 `packages/app-host/src/widget-actions.ts`
   *    的文件头）。用户在组件上勾了一下，那条意图只是躺在共享容器里 ——
   *    没有任何东西会主动叫醒应用。少了 drain，症状是"我在组件上勾了，
   *    进应用还是没勾"，而数据**好好地躺在容器里**。
   * 2. 发布只挂在 `dispatch` 之后，所以"应用开了但什么都没改"不触发任何发布 ——
   *    而那正是**每天早上最常见的情况**。少了 publish，`validUntil` 还是昨天
   *    的零点，组件一整天都显示"数据已过期"。
   *
   * 两条都**不报错**，都只在时间流逝之后才出现，所以都不能靠肉眼验收。
   *
   * `startWidgetLifecycle()` 与 `startAutoSync()` 同样是幂等的，也返回停止函数。
   * 单独一个（而不是塞进 `startAutoSync`）是为了不引入
   * `auto-sync → open-host → …` 的又一条循环依赖边。
   */
  useEffect(() => startWidgetLifecycle(), []);

  /**
   * 🔴 **欢迎页（首次启动）—— 规范 §3.1 的落点。**
   *
   * 初值**同步**读一次设备本地偏好（`readDevicePref` 走 op-sqlite 的
   * `executeSync`，是一张小表的单行查询）。异步读会让首帧先画出主界面、
   * 再盖上欢迎页 —— 那一帧的闪烁在冷启动上非常显眼。
   *
   * ⚠️ 它在**所有 hook 之后**：提前 return 会让后面没跑到的 hook 数量在
   * 两次渲染间变化，React 会直接报错（与 `ProfileScreen` 里那条注释同一条纪律）。
   * `startAutoSync` / `startWidgetLifecycle` 两个 effect 在它**之前**，
   * 所以欢迎页显示期间同步与小组件照常工作 —— 这正是"离线可用"的实现方式。
   *
   * ⚠️ 服务端地址也只算一次：它在一次会话里不会变（用户改了要重启才生效），
   * 而放在渲染里会让每次重渲染都读一遍活配置。
   */
  const [welcomeDone, setWelcomeDone] = useState<boolean>(() => hasSeenWelcome());
  const [authServerUrl] = useState<string>(
    () => readSyncConfig()?.serverUrl ?? DEFAULT_SERVER_URL,
  );

  const leaveWelcome = (): void => {
    // 🔴 写不进去要说出来。写失败的后果是"下次打开又弹一次" ——
    //    可以接受，但**不能静默**：那会变成没人解释得清的现象。
    if (!markWelcomeSeen()) {
      console.warn('[welcome] 设备本地偏好写不进去 —— 下次冷启动还会显示欢迎页');
    }
    setWelcomeDone(true);
  };

  /**
   * 面板挂在**两个分支**上（欢迎页 + 主界面）。
   *
   * 为什么不是只挂主界面：首启时用户看到的第一屏是欢迎页，而隐私决定
   * **必须**比"要不要登录"更早征求 —— 欢迎页上那个「注册 / 登录」按钮
   * 一按就会发请求。RN 的 `Modal` 在自己的原生层里渲染，放在树的哪一层
   * 不影响它盖住谁，所以两处各挂一份是安全的（面板由 store 的 `open` 裁决，
   * 不会出现两层）。
   */
  const privacySheet = <PrivacyConsentSheet serverUrl={authServerUrl} />;
  /**
   * 🔴 补签面板**不需要**宿主传地址：它显示的是"作出这次裁决的那台服务端"的链接，
   * 而那个地址在面板**被打开的那一刻**由 `reconfirm-ui.ts` 从活配置里取好
   * （见那里 `serverUrl` 的注释）。与隐私面板的差别是有理由的：
   * 那块面板的地址由注册表单决定（一次性的），这块跟着用户随时可改的同步凭据走。
   */
  const legalReconfirmSheet = <LegalReconfirmSheet />;

  if (!welcomeDone) {
    return (
      <>
        <StatusBar
          barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
          backgroundColor={t['color.background']}
        />
        <WelcomeScreen
          initialServerUrl={authServerUrl}
          onUseOffline={leaveWelcome}
          onSignedIn={leaveWelcome}
        />
        {privacySheet}
        {legalReconfirmSheet}
      </>
    );
  }

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
        <View style={{ flex: 1, display: tab === 'tasks' ? 'flex' : 'none' }}>
          <TasksScreen onPendingCountChange={setPendingCount} />
        </View>
        <View style={{ flex: 1, display: tab === 'calendar' ? 'flex' : 'none' }}><CalendarScreen /></View>
        <View style={{ flex: 1, display: tab === 'focus' ? 'flex' : 'none' }}><FocusScreen /></View>
        <View style={{ flex: 1, display: tab === 'categories' ? 'flex' : 'none' }}><CategoriesScreen /></View>
        <View style={{ flex: 1, display: tab === 'profile' ? 'flex' : 'none' }}><ProfileScreen /></View>
      </View>
      <TabBar
        active={tab}
        onChange={setTab}
        badges={{ tasks: pendingCount }}
      />
      {privacySheet}
      {legalReconfirmSheet}
    </View>
  );
}

export default function App(): React.JSX.Element {
  return (
    <NavigationProvider>
      <Shell />
    </NavigationProvider>
  );
}

/**
 * 语言宿主：React 驱动当前 locale；冷启动优先恢复独立设备偏好。
 *
 * 🔴 `I18nProvider` 必须在**所有**调 `useI18n()` 的组件之上 ——
 * 也就是在这里，而不是更靠下的某个屏幕。`useState(resolveDeviceLocale)`
 * 传的是**初始化函数**：设备语言的读取只在挂载时发生一次，不是每帧。
 */
function LocaleHost(): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>(resolveDeviceLocale);
  return (
    <I18nProvider locale={locale}>
      <ThemeProvider locale={locale}>
      <LocalePreferenceProvider locale={locale} setLocale={setLocale}>
        <App />
      </LocalePreferenceProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

/**
 * 入口：SafeAreaProvider + 主题 + 语言宿主。
 *
 * 🔴 **这里不再需要 `UiThemeBridge`**（2026-09-28 收敛后删掉）。
 *
 * 在收敛之前，`./theme` 的 `ThemeProvider` 是**自建的第二份主题实现**，
 * 共享 `TaskList` / `TaskBadges` 透过它拿不到 `HeytaUiProvider` 的 context ——
 * 实测后果是一个 P0：应用一有任务就崩在主界面
 * （`useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用`）。当时的修法是加一层桥，
 * 把移动端解析好的 `ThemeValue` 回灌给共享 Provider。
 *
 * 现在 `./theme` 的 `ThemeProvider` **就是** `HeytaUiProvider`
 * （`apps/mobile/src/theme.tsx` 只剩转发，见那里的文件头），所以桥没有存在的意义：
 * 整棵树里只有**一次**解析、**一次** `reduceMotionChanged` 订阅，
 * 也不再有"哪份主题才是权威"的问题。
 *
 * ⚠️ 之前那段注释说"移动端有自己的主题选择" —— **实测这句话是错的**：
 * `apps/mobile/src` 里没有任何主题偏好/持久化，`useColorScheme()` 是唯一来源。
 * 所以"传移动端解析的值"与"不传 `value` 让 Provider 自己解析"结果逐字段相同。
 */
export function Root(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <LocaleHost />
    </SafeAreaProvider>
  );
}
