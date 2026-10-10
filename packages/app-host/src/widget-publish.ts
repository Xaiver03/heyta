import type { FocusState, Habit, HabitLog, LocalDate, Project, Task } from '@heyta/domain';
import { addDays, parseLocalDate, toLocalDate } from '@heyta/domain';
import { buildWidgetPayload, type WidgetPayload } from '@heyta/widget-core';

/** [planWidgetPublish] 需要的状态切片。写全 `MaterializedState` 会让单测造假数据很啰嗦。 */
export interface WidgetPublishStateSlice {
  tasks: Record<string, Task>;
  projects: Record<string, Project>;
  habits: Record<string, Habit>;
  habitLogs: Record<string, HabitLog>;
}

export interface WidgetPublishPlan {
  dayStr: LocalDate;
  validUntil: number;
  payload: WidgetPayload;
  payloadJson: string;
}

/**
 * **纯函数**：算出这一轮该发布什么。
 *
 * ⚠️ 记录是 `Record<string, T>` 而选择器要数组 —— 转换只在这一处做。
 * 让每个调用方各自 `Object.values` 的话，"哪个忘了转"会在某个端上表现为
 * "某个 section 永远是空的"，而类型系统不会拦住它。
 */
export function planWidgetPublish(input: {
  state: WidgetPublishStateSlice;
  focus?: FocusState;
  now: number;
}): WidgetPublishPlan {
  const { state, focus, now } = input;

  const today = toLocalDate(now);

  const payload = buildWidgetPayload({
    tasks: Object.values(state.tasks),
    projects: Object.values(state.projects),
    habits: Object.values(state.habits),
    logs: Object.values(state.habitLogs),
    // ⚠️ 专注状态只在应用活着时存在（正在跑的番茄钟不落盘），所以它由调用方传入；
    //    拿不到时传 `undefined`，选择器会给 `{ active: false }`。
    focus,
    today,
    now,
  });

  return {
    dayStr: today,
    /**
     * 🔴 **正是下一个本地零点**（不是 `now + msUntilNextMidnight(now)`）。
     *
     * 这两件事看起来一样，其实是**两个不同的概念**，而且用错的那个方向是危险的：
     *
     * | 谁 | 语义 | 边界行为 |
     * |---|---|---|
     * | `msUntilNextMidnight` | **定时器**该睡多久 | 有 `MIN_TICK_DELAY_MS` 下限，保证 `setTimeout` 不会 0 毫秒自旋 |
     * | `validUntil` | 这份数据**什么时候开始不可信** | 必须是**确切的**零点 |
     *
     * 拿前者算后者：在午夜前最后一秒发布时，`next - now` 小于那个下限、
     * 于是被抬成 1 秒 —— `validUntil` 就落到**午夜之后**，
     * 组件会在新的一天里继续显示**昨天的任务**（组件侧只判 `now >= validUntil`，
     * 按设计**不会**自己去推"今天"，所以**没有任何东西会拦住它**）。
     *
     * 这个 bug 是测试抓出来的，不是我读代码看出来的。
     */
    validUntil: parseLocalDate(addDays(today, 1)).getTime(),
    payload,
    payloadJson: JSON.stringify(payload),
  };
}

