/**
 * 提醒 store（Web 壳）
 * ======================
 *
 * 与 `features/habits/store.ts` 同一个模板：**建 action → 导出 → `refresh()`
 * → `onEngineChange(refresh)`**。这里只做两件事：
 *
 *   1. 把界面意图转交给 `@heyta/app-host` 的 `createReminderActions`；
 *   2. 引擎变化时从动作层**重新读**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件里**一个判断都不能写**
 *
 * 哪些提醒算"未删除"、同一刻建两次要不要去重、每任务最多几条、
 * 已投递的还能不能 snooze —— 全部由动作层（`reminder-actions.ts`）与领域层
 * 决定。这一层连 `deletedAt` 都不读：`listForTask()` 已经是"存活的那几条"。
 *
 * ⚠️ 也**绝不许**出现 `entityType: 'REMINDER'` 字面量 ——
 * 那是 `pnpm check:layering` 的 `no-op-construction-in-apps` 明令禁止的
 * "外壳自己拼 op"（op 的构造只有 app-host 一份）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createReminderActions, type ActionContext } from '@heyta/app-host';
import { snoozeDeadline, type Reminder } from '@heyta/domain';
import { create } from 'zustand';

import { currentState, dispatchIntent, onEngineChange } from '../../lib/oplog.js';

/**
 * 失败回执：**哪一个任务的哪一次操作为什么失败**。
 *
 * 🔴 带上 `taskId` 不是装饰。提醒面板是**逐行**渲染的，一个全局 `error`
 * 会让"给 A 加提醒超了上限"的错误同时出现在 B、C、D 行的面板里 ——
 * 用户会以为所有任务都坏了。`taskId` 让错误只回到它真正属于的那一行。
 *
 * ⚠️ 动作层对"任务没有截止时间"和"超过每任务上限"都是**抛错**，
 * 这里必须接住并显示；静默吞掉会让用户看到一个点了没反应的按钮
 * （见 `ReminderPanel`）。
 */
export interface ReminderError {
  readonly taskId: string;
  readonly message: string;
}

interface ReminderState {
  /** 任务 id → 该任务的**存活**提醒。列表来自动作层，不在这里过滤。 */
  byTask: Record<string, Reminder[]>;
  /** 已到点、还没投递的提醒（动作层 `due()`）。顺序由领域层定。 */
  due: Reminder[];
  error?: ReminderError;

  /** 「截止**前** offsetMs」。任务没有截止时间时动作层抛错 → 落到 `error`。 */
  addBeforeDue: (taskId: string, offsetMs: number) => Promise<void>;
  /** 绝对时刻（没有截止时间时那唯一入口）。时刻由宿主算好传进来。 */
  addAbsolute: (taskId: string, triggerAt: number) => Promise<void>;
  /**
   * 稍后提醒。**收提醒自己的 id**（`Reminder.id`，形如 `taskId:triggerAt`），
   * 不是 taskId —— 动作层按它在 `state.reminders` 里找提醒。
   */
  snooze: (entityId: string) => Promise<void>;
  dismiss: (entityId: string) => Promise<void>;
  remove: (entityId: string) => Promise<void>;
}

/** 与任务 / 习惯 / 专注 store 同一个形状。只含两个函数引用，不含任何判断。 */
const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  getState: currentState,
};

/**
 * 🔴 **web 端唯一一处** `createReminderActions(...)` 的宿主调用点
 * （mobile 侧的同名接线在 `apps/mobile/src/lib/reminders.ts`）。
 *
 * 它就是 `check:reachability` 断言 C 要的"真实宿主调用点"——
 * 在那之前 `REMINDER` 有写路径、op 能同步，但没有任何界面能建它。
 */
const reminderActions = createReminderActions(actionContext);

export const useReminderStore = create<ReminderState>((set) => ({
  byTask: {},
  due: [],

  addBeforeDue: async (taskId, offsetMs) => {
    await attempt(set, taskId, () => reminderActions.createReminderBeforeDue(taskId, offsetMs));
  },

  addAbsolute: async (taskId, triggerAt) => {
    await attempt(set, taskId, () => reminderActions.createReminder(taskId, triggerAt));
  },

  snooze: async (entityId) => {
    // 🔴 推迟量**必须来自领域层**（`snoozeDeadline`），不许在这里手写
    // `10 * 60 * 1000`：算错了不会有任何类型或渲染断言变红。
    // 传 10（分钟）而不是靠默认值，是为了让这个数字与 a11y 文案
    // `reminder.a11y.snooze`（「推迟 10 分钟」）在同一个文件里对得上 ——
    // 领域层默认值和它同值，但那是巧合，不是契约。
    await attempt(set, taskIdOf(entityId), () =>
      reminderActions.snoozeReminder(entityId, snoozeDeadline(Date.now(), 10)),
    );
  },

  dismiss: async (entityId) => {
    await attempt(set, taskIdOf(entityId), () => reminderActions.dismissReminder(entityId));
  },

  remove: async (entityId) => {
    await attempt(set, taskIdOf(entityId), () => reminderActions.removeReminder(entityId));
  },
}));

/**
 * 提醒 id 形如 `${taskId}:${triggerAt}`（见 `reminder-actions.ts#reminderId`）。
 *
 * ⚠️ 这里只是**给错误回执找一个归属行**，不是业务判断 —— 动作层仍然按
 * 完整的 `entityId` 查实体。取不到前缀时回落到空串，错误就挂在
 * "没有任何一行"上（比错误地挂到随便一行更安全）。
 */
function taskIdOf(entityId: string): string {
  const at = entityId.lastIndexOf(':');
  return at < 0 ? '' : entityId.slice(0, at);
}

/**
 * 跑一次动作：成功清错误、失败**把错误留下**。
 *
 * 🔴 不 `throw` 出去（调用点全是 `void store.xxx()`，抛出去只会变成
 * Unhandled Rejection，界面还是什么都看不到）；也不 `catch` 了当没发生 ——
 * 那样按钮看起来"点了没反应"。错误进 state，由面板渲染出来。
 */
async function attempt(
  set: (partial: Partial<ReminderState>) => void,
  taskId: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
    set({ error: undefined });
  } catch (error) {
    set({
      error: { taskId, message: error instanceof Error ? error.message : String(error) },
    });
  }
}

/** 从动作层重新读 —— "哪些算未删除""顺序"都是产品语义，不在这里过滤或排序。 */
function refresh(): void {
  const tasks = currentState().tasks;
  const byTask: Record<string, Reminder[]> = {};
  for (const taskId of Object.keys(tasks)) {
    byTask[taskId] = reminderActions.listForTask(taskId);
  }
  useReminderStore.setState({ byTask, due: reminderActions.due() });
}

// 引擎状态变化时自动刷新（含远程 op 应用后）
onEngineChange(refresh);
