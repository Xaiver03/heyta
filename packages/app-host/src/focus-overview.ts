/**
 * 专注概览（工单 W7 的"同一个出口"）
 * ===================================
 *
 * 滴答的番茄钟右栏是**常驻**的：四张概览卡 + 一张"专注记录"列表，
 * 与选中了哪条任务无关。我们此前**一条专注记录都没有逐条渲染过**
 * （`listSessions()` 的唯一消费者只做当日汇总），而 web 连"今日专注时长"都没有 ——
 * mobile 有。所以这一层的存在理由是三条判据：
 *
 * ① 四个数**逐字来自领域函数**，界面不自己 reduce；
 * ② 记录列表的条数 == `listSessions()` 里的工作段条数（休息段不许混进来）；
 * ③ web 与 mobile 的"今日专注时长"来自**同一个出口**。
 *
 * 🔴 ①③ 是靠"这里只转调、不重算"实现的，不是靠注释：
 *   - 当日 → `focusStatsForDay`（`packages/domain/src/focus.ts`）
 *   - 累计 → `activityTotalsFromState`（`motivation.ts`，与里程碑/分享摘要同一个）
 *   - 列表 → `createFocusActions(...).listSessions()`（滤墓碑与排序的**唯一**所有者）
 * 任何一处想"顺手自己算一遍"，就是把 ③ 那句"两端对称"重新变成愿望。
 *
 * ⚠️ 时长**不在这里格式化成句子**。分档口径的唯一所有者是
 * `@heyta/domain#durationParts`（先四舍五入到分钟、再分三档），
 * 词由各界面按 `packages/i18n` 拼 —— 领域层曾有一个返回写死中文的
 * `formatFocusDuration`，W7 把它删了，理由写在 `focus.ts` 末尾那段。
 */

import {
  addDays,
  focusSessionDay,
  focusStatsForDay,
  intensityLevel,
  shouldPersistSession,
  toLocalDate,
  type FocusSession,
  type LocalDate,
} from '@heyta/domain';

import { createFocusActions } from './focus-actions.js';
import type { ActionContext } from './actions.js';
import { activityTotalsFromState } from './motivation.js';

/** 记录列表里的一行。 */
export interface FocusRecord {
  id: string;
  /**
   * 这条记录**算在哪一天**（epoch ms）。
   *
   * 🔴 不是 `startedAt` 也不是 `createdAt` —— 判据与统计层同一条
   * （`focusSessionDay`：`endedAt ?? createdAt`）。界面若自己挑一个字段排序，
   * 跨零点那一轮就会在两端落到不同的日子里。
   */
  at: number;
  /** 实际时长（ms）。缺 `actualMs` 时退回 `plannedMs`，同统计层那条兜底。 */
  actualMs: number;
  /** 自然完成，还是中途放弃。 */
  completed: boolean;
  taskId?: string;
  /**
   * 关联任务的标题；没关联任务时为 `null`。
   *
   * ⚠️ 任务**已被删除也照旧显示标题**：记录的是"那段时间挂在什么上面"，
   * 那是发生过的事实。把标题抹成空会让历史记录读起来像数据坏了。
   */
  taskTitle: string | null;
  /**
   * 这一段的相对长度档 `0..4`，用来画记录行里那条能量条。
   *
   * 🔴 与 `FocusDayPulse.level` **同一个函数**（`intensityLevel`），但峰值不同：
   * 这里是"相对记录里最长的那一段"。所以 25 分钟与 50 分钟在一屏里立刻分得开，
   * 而"这周哪天花得最多"是另一个问题（那是 `days` 的峰值）。
   * ⚠️ 中途放弃的段也参与峰值：它占用的时间是真的。
   */
  energyLevel: 0 | 1 | 2 | 3 | 4;
}

/**
 * 近 7 日里的一天。
 *
 * ⚠️ **顺序是旧 → 新**，且窗口内每一天都在（没有记录的那天也在，`level` 为 0）。
 * 与 `dailyActivityCountsFromState` 同一形状 —— 那个函数已经证明"补天"必须由
 * 生产者做：界面自己补就会在"跨零点没写入"时少画一格，而少画的那一格
 * 看起来和"那天没专注"一模一样。
 */
export interface FocusDayPulse {
  /** 本地日历日 `YYYY-MM-DD`。 */
  date: LocalDate;
  /** 那天实际专注时长（ms），**含**中途放弃的那部分（与 `todayFocusMs` 同口径）。 */
  focusMs: number;
  /** 那天自然完成的工作段数。 */
  completedCount: number;
  /**
   * 强度档 `0..4`，`0` = 那天没有记录。
   *
   * 🔴 分档用的是 `@heyta/domain#intensityLevel`（相对窗口峰值的四等分），
   * **不是**在这里新写一套阈值：同一个"多少算浓"的问题在全仓已经有一个答案
   * （分类泳道图那格用的就是它）。颜色仍然不在这里 —— 本层不认识 CSS。
   */
  level: 0 | 1 | 2 | 3 | 4;
}

export interface FocusOverview {
  /** 今天自然完成的工作段数。 */
  todayCount: number;
  /** 今天实际专注时长（ms），**含**中途放弃的那部分。 */
  todayFocusMs: number;
  /** 今天放弃了几段。0 时界面可以不显示（常年一行「0 次」不传达信息）。 */
  todayAbortedCount: number;
  /** 累计自然完成的工作段数。 */
  totalCount: number;
  /** 累计专注时长（ms）。 */
  totalFocusMs: number;
  /**
   * 工作段记录，**新到旧**。
   *
   * 已在此处滤掉休息段（`shouldPersistSession`）与墓碑（`listSessions`）。
   * 界面拿到什么就画什么 —— 再滤一遍就是第二个所有者。
   */
  records: FocusRecord[];
  /**
   * 近 7 日脉搏（**旧 → 新**，末位是今天）。
   *
   * 🔴 它是"今天这一格"的**背景**，不是第二组数字：昨天/前天的时长
   * 必须与 `todayFocusMs` 走同一个口径（`focusStatsForDay` 逐日调用），
   * 否则柱子高矮与卡上的数会在跨零点那天开始互相矛盾。
   */
  days: FocusDayPulse[];
}

/** 一条 session 的"实际时长"，与 `focusStatsForDay` 同一句兜底。 */
function actualMsOf(session: FocusSession): number {
  return session.actualMs ?? session.plannedMs;
}

/** 近 7 日脉搏的窗口宽度（天）。**只有这一处定义**，界面不许写 `7`。 */
export const FOCUS_PULSE_DAYS = 7;

/**
 * 把毫秒**按显示口径取整到分钟**，再拿去分档。
 *
 * 🔴 不这么做就会当场自相矛盾：一段 3 秒的记录，文字说"0 分钟"（`durationParts`
 * 先四舍五入到分钟），而强度按原始毫秒算成了满格 —— 界面上"0 分钟 + 满格深蓝条"
 * 是同一行里两个打架的读数。数字与条必须吃同一个取整，否则用户有理由认为条在说谎。
 *
 * ⚠️ 取整口径**故意**是 `Math.round(ms / 60000)`，与 `durationParts` 那条
 * "先四舍五入到分钟"逐字同源；不要在这里另挑一个阈值。
 */
function roundedMinuteMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 60000) * 60000;
}

/**
 * 近 N 日脉搏（旧 → 新，末位是今天）。
 *
 * 🔴 **逐日调 `focusStatsForDay`**，不自己按 `dayRange` 切一遍：
 * "某一天算哪些段""`actualMs` 缺失怎么兜底""跨零点算哪天"这三个问题的答案
 * 都在那个函数里，而它是 `todayFocusMs` 的来源。在这里重切一次，
 * 柱子高矮就会在某天开始与卡上的数不一致 —— 那种不一致不会让任何测试变红。
 *
 * ⚠️ 分档相对**窗口内峰值**（`intensityLevel` 的口径）：一整周都只专注 10 分钟的人，
 * 也该看见"相对自己"的高低起伏，而不是七根一样矮的柱子。
 */
function focusPulse(sessions: readonly FocusSession[], now: number): FocusDayPulse[] {
  const raw: Array<Omit<FocusDayPulse, 'level'>> = [];
  for (let i = FOCUS_PULSE_DAYS - 1; i >= 0; i -= 1) {
    // 用 addDays + parseLocalDate 那条路取"那天的正午"，不写 `now - i*86400000`：
    // 夏令时切换那天后者会偏一小时，而偏出来的那一小时足以让一段记录落到邻日。
    const date = addDays(toLocalDate(now), -i);
    const noon = new Date(`${date}T12:00:00`).getTime();
    const stats = focusStatsForDay(sessions, noon);
    raw.push({ date, focusMs: stats.focusMs, completedCount: stats.completedWorkCount });
  }
  // 峰值与逐日都先按显示口径取整到分钟，再分档 —— 见 `roundedMinuteMs` 的理由。
  const peakMs = raw.reduce((peak, day) => Math.max(peak, roundedMinuteMs(day.focusMs)), 0);
  return raw.map((day) => ({
    ...day,
    level: intensityLevel(roundedMinuteMs(day.focusMs), peakMs),
  }));
}

/**
 * 专注概览。`now` 决定"今天"是哪一天（本地日历日，跨零点归属见 `focusSessionDay`）。
 *
 * 纯读：不派发任何 op，也不缓存 —— 每次从物化状态现算，
 * 于是同步回来的另一台设备的记录会自动进到这个数里（与 web 专注 store
 * 那条 `onEngineChange` 订阅同一个理由）。
 */
export function focusOverview(ctx: ActionContext, now: number): FocusOverview {
  const state = ctx.getState();
  // listSessions() 是"滤墓碑 + 确定性排序（createdAt 升序，同值比 id）"的唯一所有者。
  const sessions = createFocusActions(ctx).listSessions();
  const day = focusStatsForDay(sessions, now);
  const totals = activityTotalsFromState(state);

  const records: Array<Omit<FocusRecord, 'energyLevel'>> = sessions
    .filter((session) => shouldPersistSession(session))
    .map((session) => ({
      id: session.id,
      at: focusSessionDay(session),
      actualMs: actualMsOf(session),
      completed: session.completed === true,
      ...(session.taskId === undefined || session.taskId === null
        ? {}
        : { taskId: session.taskId }),
      taskTitle:
        session.taskId === undefined || session.taskId === null
          ? null
          : (state.tasks[session.taskId]?.title ?? null),
    }))
    // 新到旧：记录列表的第一行应该是"最近那一段"，而不是最早那一段。
    .reverse();

  // 能量条的峰值 = 这一屏记录里最长的那一段（放弃的也算：它占用的时间是真的）。
  // 与文字时长吃同一个取整（`roundedMinuteMs`），否则"0 分钟 + 满格条"会自相矛盾。
  const peakRecordMs = records.reduce(
    (peak, record) => Math.max(peak, roundedMinuteMs(record.actualMs)),
    0,
  );

  return {
    todayCount: day.completedWorkCount,
    todayFocusMs: day.focusMs,
    todayAbortedCount: day.abortedWorkCount,
    totalCount: totals.focusCount,
    totalFocusMs: totals.focusMs,
    records: records.map((record) => ({
      ...record,
      energyLevel: intensityLevel(roundedMinuteMs(record.actualMs), peakRecordMs),
    })),
    days: focusPulse(sessions, now),
  };
}
