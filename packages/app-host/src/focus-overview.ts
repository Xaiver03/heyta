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
  focusSessionDay,
  focusStatsForDay,
  shouldPersistSession,
  type FocusSession,
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
}

/** 一条 session 的"实际时长"，与 `focusStatsForDay` 同一句兜底。 */
function actualMsOf(session: FocusSession): number {
  return session.actualMs ?? session.plannedMs;
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

  const records: FocusRecord[] = sessions
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

  return {
    todayCount: day.completedWorkCount,
    todayFocusMs: day.focusMs,
    todayAbortedCount: day.abortedWorkCount,
    totalCount: totals.focusCount,
    totalFocusMs: totals.focusMs,
    records,
  };
}
