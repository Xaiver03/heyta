/**
 * 提醒动作（宿主无关）
 * =====================
 *
 * 与 `habit-actions.ts`（习惯/打卡）同一个理由：**op 的构造只能有一份**。
 *
 * 这是 B1-1 的**写路径** —— 在此之前 `REMINDER` 是一个合法实体名、
 * 服务端会接受、op 能同步到所有设备，但**没有任何一处能生成它**
 * （`scripts/check-reachability.mjs` 的断言 D 抓的就是这个形状）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 五个由这里**独占**的语义决定，每一个错了都只在用户那头才看得见：
 *
 * 1. 🔴 **提醒的 id 是 `${taskId}:${triggerAt}`，不是随机 id。**
 *    与 `habitLogId` 同一条推理：同一任务、同一时刻建两次提醒落到**同一个
 *    实体**上，reducer 的 LWW 把它们收敛成一条，而不是两条同时弹通知。
 *    界面上"连点两下保存"是常事，随机 id 会让它变成两条。
 *
 * 2. **建提醒前先校验任务还在。** 给一个已软删除/不存在的任务建提醒，
 *    用户看到的是"提醒建好了"，而任务在回收站里 —— 到点弹一条点进去
 *    什么都没有的通知。所以这里在**写之前**查一次（`taskOf`）。
 *
 * 3. **每任务存活提醒数封顶**（`MAX_REMINDERS_PER_TASK`，单点定义在
 *    `packages/domain/src/reminders.ts`）。不封顶的话，导入或程序化调用可以
 *    在一条任务上挂几千条，调度器每次都要遍历它们。
 *
 * 4. **到期判定不在这一层。** `due()` 只是把 `ctx.getState().reminders`
 *    交给领域层的 `dueReminders()` —— "什么时候算到期"（含 snooze 优先、
 *    fired/dismissed 优先于到点）只有那一份定义。
 *
 * 5. **重复任务的顺延是"重置同一条提醒"，不是新建一条。**
 *    见 `rescheduleForRepeat`：新建会让每个周期留下一个永不过期的实体，
 *    几个周期就撞上上限。
 *
 * ⚠️ 这里的 `firedAt` / `dismissedAt` / `snoozedUntil` 全部走 op（`UPD`），
 * **不写本地状态** —— 只改内存的话，另一端回放不到，"这条提醒已经发过了"
 * 在第二台设备上就变成"再弹一次"（AGENTS.md §3.4）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  MAX_REMINDERS_PER_TASK,
  aliveReminders,
  dueReminders as dueOf,
  nextTriggerAfterRepeat,
  reminderPhase,
  reminderRejection,
  reminderTriggerFromOffset,
  type Reminder,
} from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';

/** 建提醒时可覆盖的字段。 */
export interface NewReminderFields {
  /**
   * 相对任务 `dueDate` 的提前量（ms）。给了它，任务完成顺延时这条提醒
   * **跟着新的截止走**；不给 = 绝对时刻提醒，不随重复移动。
   * 语义与理由见 `packages/domain/src/reminders.ts` 的 `nextTriggerAfterRepeat`。
   */
  offsetMs?: number;
}

export interface ReminderActionsOptions {
  /** 时间源。默认 `Date.now` —— "到没到点"全部由它决定。 */
  now?: () => number;
}

export interface ReminderActions {
  /**
   * 建一条**绝对时刻**的提醒（`triggerAt` 是 epoch ms）。
   *
   * 幂等：同一任务 + 同一时刻重复调用**不再写 op**，返回同一个 id
   * （见文件头第 1 条）。
   */
  createReminder(taskId: string, triggerAt: number, over?: NewReminderFields): Promise<string>;
  /**
   * 建一条「截止**前** `offsetMs` 提醒」的提醒。
   *
   * 任务没有截止时间时**抛错**而不静默建一条绝对提醒 —— 那会让"提前 30 分钟"
   * 这条规则在没有任何依据的情况下变成一个莫名其妙的时刻。
   */
  createReminderBeforeDue(taskId: string, offsetMs: number): Promise<string>;
  /** 改触发时刻。**不改** `offsetMs`（那是"提前量"语义，不是当前差值）。 */
  rescheduleReminder(entityId: string, triggerAt: number): Promise<void>;
  /**
   * 「稍后提醒」。返回是否真的写入了 op：
   * 已投递 / 已关闭的提醒**不写**（写入也是无效 op，见领域层的判定顺序），
   * 用户的点击由界面负责提示。
   */
  snoozeReminder(entityId: string, untilMs: number): Promise<boolean>;
  /**
   * 标记已投递。**幂等**：已投递返回 `false` 且不写 op
   * （否则每次进前台都会推高 `updatedAt`，在两端制造假冲突）。
   */
  markReminderFired(entityId: string): Promise<boolean>;
  /** 用户主动关闭。已关闭返回 `false`。 */
  dismissReminder(entityId: string): Promise<boolean>;
  /** 撤销关闭（清 `dismissedAt`）。未关闭返回 `false`。 */
  undoDismissReminder(entityId: string): Promise<boolean>;
  /** 软删除（`DEL` op）。物理删除会让另一端把它同步回来。 */
  removeReminder(entityId: string): Promise<void>;
  /** 某任务的未删除提醒，按 id 字典序（两端顺序一致）。 */
  listForTask(taskId: string): Reminder[];
  /** **已到点、还没投递**的提醒，顺序确定（领域层 `dueReminders`）。 */
  due(): Reminder[];
  /**
   * 重复任务顺延：把该任务每条带 `offsetMs` 的提醒重置到**下一个周期**。
   *
   * 一条 `UPD` 同时写 `triggerAt` + 清 `firedAt` / `dismissedAt` / `snoozedUntil`
   * —— 上一个周期的投递/关闭/推迟状态对新周期没有意义（见文件头第 5 条）。
   * 不需要顺延的（无 `offsetMs`、无新截止、时刻没变）**不写 op**。
   *
   * 返回真正被顺延的提醒数。
   */
  rescheduleForRepeat(taskId: string, nextDueDate: number | undefined): Promise<number>;
}

/**
 * 提醒实体的主键：任务 + 触发时刻。
 *
 * 🔴 见文件头第 1 条 —— 这个形状就是"重复建不产生重复通知"的来源，
 * **不要**改成随机 id。也**不要**把 `offsetMs` 放进 key：
 * 同任务的"提前 30 分钟"和"绝对时刻 9:00"若指向同一时刻，那是同一条提醒。
 */
export function reminderId(taskId: string, triggerAt: number): string {
  return `${taskId}:${String(triggerAt)}`;
}

export function createReminderActions(
  ctx: ActionContext,
  options: ReminderActionsOptions = {},
): ReminderActions {
  const now = options.now ?? Date.now;

  const taskOf = (taskId: string): { id: string; dueDate?: number } | undefined => {
    const task = ctx.getState().tasks[taskId];
    if (task === undefined || task.deletedAt !== undefined) return undefined;
    return task;
  };

  const reminderOf = (entityId: string): Reminder | undefined => {
    const reminder = ctx.getState().reminders[entityId];
    if (reminder === undefined || reminder.deletedAt !== undefined) return undefined;
    return reminder;
  };

  const aliveOfTask = (taskId: string): Reminder[] =>
    aliveReminders(
      Object.values(ctx.getState().reminders).filter((reminder) => reminder.taskId === taskId),
    );

  /**
   * 每任务的写链。
   *
   * 🔴 上限判的是"存活数"，而 `ctx.dispatch` 把 op **落到物化状态是异步的** ⇒
   * 并发调用会在同一个旧快照上全部通过检查。实测（真引擎 + 真 SQLite）连点 8 次
   * `createReminder` 会让 **8 条全部落库**，而 `MAX_REMINDERS_PER_TASK` 是 5 ——
   * 界面上则表现为"渲染出 6 条而错误是空的"，看起来像用例超时。
   * 把「读存活数 → dispatch → 状态可见」排在同一条链上，检查与写才是原子的。
   * 链按任务分键，跑完就摘掉，不让这张 Map 变成跨任务的常驻内存。
   */
  const writeChain = new Map<string, Promise<unknown>>();
  const serialize = <T>(taskId: string, fn: () => Promise<T>): Promise<T> => {
    const prev = writeChain.get(taskId) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    writeChain.set(taskId, settled);
    void settled.then(() => {
      if (writeChain.get(taskId) === settled) writeChain.delete(taskId);
    });
    return result;
  };

  const assertTrigger = (triggerAt: number): void => {
    const rejection = reminderRejection(triggerAt, now());
    if (rejection !== undefined) {
      const detail =
        rejection === 'not-a-time'
          ? '不是一个合法的时间戳（应为正整数 epoch ms）'
          : rejection === 'in-the-past'
            ? '已经过去了（提醒不会补发，只会立刻触发）'
            : '超出一年，可能是把秒当成了毫秒';
      throw new Error(`提醒时间不合法：${detail}（收到 ${String(triggerAt)}）`);
    }
  };

  const assertOffset = (offsetMs: number): void => {
    if (!Number.isFinite(offsetMs) || offsetMs < 0) {
      throw new Error(`提前量必须是 0 或正整数毫秒，收到 ${JSON.stringify(offsetMs)}`);
    }
  };

  async function writeNew(
    taskId: string,
    triggerAt: number,
    over: NewReminderFields,
  ): Promise<string> {
    return serialize(taskId, async () => {
      const entityId = reminderId(taskId, triggerAt);
      // 幂等：同任务同刻已经有一条存活提醒 → 直接返回它（见文件头第 1 条）。
      if (reminderOf(entityId) !== undefined) return entityId;

      // 见文件头第 3 条：封顶只数**存活**提醒，墓碑不占名额。
      // 🔴 这一段必须在 `serialize` 里面 —— 检查在旧快照上跑就等于没有上限。
      if (aliveOfTask(taskId).length >= MAX_REMINDERS_PER_TASK) {
        throw new Error(
          `一条任务最多 ${String(MAX_REMINDERS_PER_TASK)} 条提醒（${taskId} 已经到上限）`,
        );
      }

      await ctx.dispatch({
        entityType: 'REMINDER' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: {
          taskId,
          triggerAt,
          // `offsetMs` 只在给定时出现；`undefined` 会被 JSON 丢掉，
          // 而"没有提前量"与"提前量为 0"是两件事（前者不随重复移动）。
          ...(over.offsetMs === undefined ? {} : { offsetMs: over.offsetMs }),
        },
      });
      return entityId;
    });
  }

  return {
    async createReminder(taskId, triggerAt, over = {}) {
      if (taskOf(taskId) === undefined) throw new Error(`找不到任务「${taskId}」`);
      assertTrigger(triggerAt);
      if (over.offsetMs !== undefined) assertOffset(over.offsetMs);
      return writeNew(taskId, triggerAt, over);
    },

    async createReminderBeforeDue(taskId, offsetMs) {
      const task = taskOf(taskId);
      if (task === undefined) throw new Error(`找不到任务「${taskId}」`);
      if (task.dueDate === undefined) {
        throw new Error(`任务「${taskId}」没有截止时间，"提前提醒"没有依据`);
      }
      assertOffset(offsetMs);
      const triggerAt = reminderTriggerFromOffset(task.dueDate, offsetMs);
      assertTrigger(triggerAt);
      return writeNew(taskId, triggerAt, { offsetMs });
    },

    async rescheduleReminder(entityId, triggerAt) {
      if (reminderOf(entityId) === undefined) throw new Error(`找不到提醒「${entityId}」`);
      assertTrigger(triggerAt);
      await ctx.dispatch({
        entityType: 'REMINDER' as EntityType,
        entityId,
        opType: OpType.Update,
        // 改期会**清掉 snooze**：用户重新挑了个时间，上一次的"稍后"已经没有意义，
        // 留着它会让 `reminderEffectiveAt` 继续返回旧的 snooze 时刻
        // （症状：改完时间却没生效）。
        payload: { triggerAt, snoozedUntil: null },
      });
    },

    async snoozeReminder(entityId, untilMs) {
      const reminder = reminderOf(entityId);
      if (reminder === undefined) throw new Error(`找不到提醒「${entityId}」`);
      if (!Number.isFinite(untilMs) || untilMs <= now()) {
        throw new Error(`「稍后提醒」的目标时刻必须是未来的有限时间戳（收到 ${String(untilMs)}）`);
      }
      // 已投递 / 已关闭 → 不写。判定顺序（fired/dismissed 优先于到点）在领域层，
      // 这里只是**不为一个必然无效的写入产生 op**。
      const phase = reminderPhase(reminder, now());
      if (phase === 'fired' || phase === 'dismissed') return false;

      await ctx.dispatch({
        entityType: 'REMINDER' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { snoozedUntil: untilMs },
      });
      return true;
    },

    async markReminderFired(entityId) {
      const reminder = reminderOf(entityId);
      if (reminder === undefined) throw new Error(`找不到提醒「${entityId}」`);
      if (reminder.firedAt !== undefined) return false;

      await ctx.dispatch({
        entityType: 'REMINDER' as EntityType,
        entityId,
        opType: OpType.Update,
        // 时刻写进**载荷**（数据）而不是只依赖 op 的 timestamp（日志元数据）：
        // 两端重放同一条 op 必须得到同一个 `firedAt`（reducer 是纯函数的纪律）。
        payload: { firedAt: now() },
      });
      return true;
    },

    async dismissReminder(entityId) {
      const reminder = reminderOf(entityId);
      if (reminder === undefined) throw new Error(`找不到提醒「${entityId}」`);
      if (reminder.dismissedAt !== undefined) return false;

      await ctx.dispatch({
        entityType: 'REMINDER' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { dismissedAt: now() },
      });
      return true;
    },

    async undoDismissReminder(entityId) {
      const reminder = reminderOf(entityId);
      if (reminder === undefined) throw new Error(`找不到提醒「${entityId}」`);
      if (reminder.dismissedAt === undefined) return false;

      await ctx.dispatch({
        entityType: 'REMINDER' as EntityType,
        entityId,
        opType: OpType.Update,
        // 清字段写 `null`：`undefined` 会被 JSON 丢掉，对端既不清除也不设置
        // （同 `actions.ts` 文件头第 2 条）。
        payload: { dismissedAt: null },
      });
      return true;
    },

    async removeReminder(entityId) {
      if (reminderOf(entityId) === undefined) throw new Error(`找不到提醒「${entityId}」`);
      await ctx.dispatch({
        entityType: 'REMINDER' as EntityType,
        entityId,
        opType: OpType.Delete,
        payload: {},
      });
    },

    listForTask(taskId) {
      return aliveOfTask(taskId);
    },

    due() {
      return dueOf(Object.values(ctx.getState().reminders), now());
    },

    async rescheduleForRepeat(taskId, nextDueDate) {
      if (taskOf(taskId) === undefined) throw new Error(`找不到任务「${taskId}」`);
      return rescheduleRemindersForRepeat(ctx, taskId, nextDueDate);
    },
  };
}

/**
 * 重复任务顺延：把某任务的每条带 `offsetMs` 的提醒重置到下一个周期。
 *
 * 🔴 **为什么它是独立函数，而不是只做 `ReminderActions` 的一个方法。**
 *
 * 这一层的唯一调用方本该是"完成一个重复任务"那一刻 —— 而在
 * `createTaskActions` 里那件事发生在 `completeTask`（`actions.ts`），
 * 它**没有** `ReminderActions` 实例（任务动作不该依赖提醒动作的实例，
 * 那会让宿主必须按顺序建两个对象）。
 *
 * 抽出来之前，这个循环只存在于 `rescheduleForRepeat` 方法里，于是
 * **`grep rescheduleForRepeat` 在生产代码里零命中**：领域层的
 * `nextTriggerAfterRepeat` 写了、单测也写了，但"任务顺延时提醒跟着走"
 * 这件事**没有任何一条路径会触发**（`docs/research/dida365-feature-benchmark.md`
 * §3 记的"基础设施做完了、最后一米没接"，又一次同形）。
 *
 * ⇒ 现在 `completeTask` 直接调这个函数，`reminder-actions.ts` 的方法
 * 只是它的**带校验的门面**。两条路径共用同一个循环，所以不会漂移。
 *
 * ⚠️ 调用方**不要**自己再遍历一遍 reminders —— 那正是上面那个缺口的成因。
 */
export async function rescheduleRemindersForRepeat(
  ctx: ActionContext,
  taskId: string,
  nextDueDate: number | undefined,
): Promise<number> {
  /**
   * 只看**存活**的提醒：墓碑不占名额，也不该被"顺延"——那会白写一条 op
   * （见文件头第 3 条与 `aliveReminders`）。
   */
  const alive = aliveReminders(
    Object.values(ctx.getState().reminders).filter((reminder) => reminder.taskId === taskId),
  );

  let moved = 0;
  for (const reminder of alive) {
    const next = nextTriggerAfterRepeat(reminder, nextDueDate);
    if (next === undefined) continue;
    await ctx.dispatch({
      entityType: 'REMINDER' as EntityType,
      entityId: reminder.id,
      opType: OpType.Update,
      payload: {
        triggerAt: next,
        // 新周期重置：上一个周期的投递/关闭/推迟对新周期没有意义（文件头第 5 条）。
        firedAt: null,
        dismissedAt: null,
        snoozedUntil: null,
      },
    });
    moved += 1;
  }
  return moved;
}