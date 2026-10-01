/**
 * 习惯与打卡动作（宿主无关）
 * ============================
 *
 * 与 `actions.ts`（任务）同一个理由：**op 的构造只能有一份**。
 * 这些语义此前只存在于 `apps/web/src/features/habits/store.ts`（4 处 op 构造）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个由这里**独占**的语义决定，每一个都错了很久才会被发现：
 *
 * 1. 🔴 **打卡记录的 id 是 `${habitId}:${date}`，不是随机 id。**
 *    这是"同一天重复打卡"能自然幂等的**根本原因**：两次打卡落到同一个
 *    实体 id 上，于是 reducer 的 LWW 把它们收敛成一条，而不是两条让计数翻倍。
 *    用随机 id 的话，用户双击一下打卡，连续天数就可能 +2。
 *
 * 2. **幂等判定在意图层，不在 reducer。**
 *    "今天已经打过卡了，再点一次什么都不做" —— reducer 做不到这件事，
 *    因为"第二次打卡"和"改了打卡数值"在 op 上长得一模一样
 *    （都是对同一实体的 `UPD`/`CRT`）。必须在**发起写入之前**查一次。
 *
 * 3. **打卡值缺省落在 `habit.target` 上，再缺省才是 1。**
 *    一个"每天 8 杯水"的习惯，跳过 value 打卡应当记 8 而不是 1 ——
 *    记 1 会让完成率永远是 12%，而界面上什么都没报错。
 *
 * ⚠️ `undoCheckIn` 是软删除（`DEL` op），不是物理删。物理删除会让另一端
 * 把打卡**同步回来** —— 用户会看到自己撤销的打卡自己复活。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  parseCategorySlot,
  parseHabitIcon,
  toLocalDate,
  type CategorySlot,
  type Habit,
  type HabitGoalType,
  type HabitIcon,
  type HabitLog,
  type LocalDate,
} from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

/** 建习惯时可覆盖的字段。 */
export interface NewHabitFields {
  target?: number;
  unit?: string;
  /**
   * 达成口径。
   *
   * 🔴 **原来这里没有它** —— 于是新建时就**没有任何办法**指定"最多/恰好"，
   * 只能拿到默认的 `atLeast`。`Habit` 有 `goalType`、`isAchieved` 三种口径
   * 全实现了，但**入口一个都没有**：这就是"模型有、界面不可达"的第一层。
   */
  goalType?: HabitGoalType;
  color?: string;
  /**
   * 图标（闭集 key）。省略 = **没选过**，界面于是用 `deriveHabitIcon(id)` 派生一个 ——
   * 不是"没有图标"（理由见 `@heyta/domain#habit-icons`）。
   */
  icon?: HabitIcon;
  backfillDays?: number;
}

export interface HabitActionsOptions {
  /** 时间源。默认 `Date.now` —— 它决定"今天是哪天"，而"今天"是**本地日期**。 */
  now?: () => number;
  /** 习惯 id 生成器。可注入，理由见 `TaskActionsOptions.newTaskId`。 */
  newHabitId?: () => string;
}

export interface HabitActions {
  /** 新建习惯。返回新实体 id。 */
  createHabit(name: string, over?: NewHabitFields): Promise<string>;
  /** 软删除习惯。⚠️ 打卡记录**不**级联删除（撤销删除后历史还在）。 */
  removeHabit(entityId: string): Promise<void>;

  /**
   * 给习惯指定一个**分类色槽位**（1–8），或 `undefined` 表示清掉。
   *
   * 与 `setProjectColor` 是同一条规则（存槽位号，不存颜色本身；不做健康度判断），
   * 理由写在 `docs/plans/activity-categories-and-colors.md` §6。
   *
   * ⚠️ 习惯要**按分钟计量**才会进分类时长统计（`unit` 是"分钟"/"min" 之类）——
   * 一个"每天 8 杯水"的习惯可以有颜色，但它不贡献分钟数，
   * 因为"杯"换不成时间，而我们**不猜换算**。
   */
  setHabitColor(entityId: string, slot?: CategorySlot): Promise<void>;

  /**
   * 给习惯指定一个**图标**（闭集 key），或 `undefined` 表示清掉。
   *
   * 与 `setHabitColor` 是同一条规则的两件事：存的都是**用户选过的身份标记**，
   * 校验都在写入侧（不认识的值 `throw`，不悄悄落成第一个），清除都写成 `null`。
   *
   * ⚠️ `undefined` **不是**"界面上没有图标" —— 那是"回到派生的那个"。
   * 习惯永远有图标，所以这个动作改的是"画哪一个"，不是"画不画"。
   */
  setHabitIcon(entityId: string, icon?: HabitIcon): Promise<void>;

  /**
   * 改一个习惯的**目标**：数值 / 单位 / 达成口径（三者都可单独改）。
   *
   * 🔴 这是「习惯计数型 / 时长型」在**写路径**上缺的那一米：
   * `Habit` 有 `target` / `unit` / `goalType`，`isAchieved` 把三种口径都实现了，
   * `checkIn` 也收 `value` —— 但**没有任何动作能改一个已建习惯的目标**
   *（`createHabit` 只能设初始值，而 `NewHabitFields` 连 `goalType` 都没有）。
   * ⇒ 界面上只能建"每天做一次"的习惯，**计数型与时长型到不了用户手里**。
   *
   * `unit` 传空串（或全是空白）表示**清除单位**，写成 `null`
   *（与 `setHabitColor` / `setDueDate` 同一条"用 null 穿过 JSON 表达清除"的约定）。
   *
   * ⚠️ **一个字段都没传时不写 op** —— 否则"点开又点走"会给每个习惯白写一条空 UPD。
   */
  setHabitGoal(
    entityId: string,
    goal: { target?: number; unit?: string; goalType?: HabitGoalType },
  ): Promise<void>;

  /**
   * 打卡。省略 `date` 表示**今天**。
   *
   * 已打卡时是**幂等空操作**（见文件头第 2 条），返回 `false`；
   * 真的写入了返回 `true` —— 调用方据此决定要不要提示"今天已经打过卡了"。
   */
  checkIn(habitId: string, date?: LocalDate, value?: number): Promise<boolean>;
  /**
   * 撤销打卡。没打过卡时是空操作（返回 `false`），不产生多余的 `DEL`。
   */
  undoCheckIn(habitId: string, date?: LocalDate): Promise<boolean>;

  /** 未删除的习惯，按 (createdAt, id) 升序。 */
  listHabits(): Habit[];
  /** 未删除的打卡记录，顺序同上。 */
  listLogs(): HabitLog[];
}

/**
 * 打卡记录的主键：习惯 + 日期。
 *
 * 🔴 见文件头第 1 条 —— 这个函数的形状就是幂等性的来源，
 * **不要**改成随机 id。
 */
export function habitLogId(habitId: string, date: LocalDate): string {
  return `${habitId}:${date}`;
}

function aliveOf<T extends { deletedAt?: number }>(record: Record<string, T>): T[] {
  return Object.values(record).filter((item) => item.deletedAt === undefined);
}

function byCanonicalOrder<T extends { createdAt: number; id: string }>(a: T, b: T): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function createHabitActions(
  ctx: ActionContext,
  options: HabitActionsOptions = {},
): HabitActions {
  const now = options.now ?? Date.now;
  const makeHabitId = options.newHabitId ?? ((): string => `habit-${randomId()}`);

  const habitOf = (entityId: string): Habit | undefined => {
    const habit = ctx.getState().habits[entityId];
    if (habit === undefined || habit.deletedAt !== undefined) return undefined;
    return habit;
  };

  /** 找某习惯某天的**未删除**打卡记录。 */
  const logOf = (habitId: string, date: LocalDate): HabitLog | undefined => {
    const logs = ctx.getState().habitLogs;
    return Object.values(logs).find(
      (log) =>
        log.habitId === habitId && log.date === date && log.deletedAt === undefined,
    );
  };

  return {
    async createHabit(name, over = {}) {
      const trimmed = name.trim();
      if (trimmed === '') throw new Error('习惯名称不能为空');

      const entityId = makeHabitId();
      await ctx.dispatch({
        entityType: 'HABIT' as EntityType,
        entityId,
        opType: OpType.Create,
        // `target` 默认 1：纯打卡型习惯（有的只要"做过"）。
        // 不写 `target: null` —— 这里的 1 是**默认值**，不是"清除"。
        payload: { name: trimmed, target: 1, ...over },
      });
      return entityId;
    },

    async setHabitColor(entityId, slot) {
      if (habitOf(entityId) === undefined) throw new Error(`找不到习惯「${entityId}」`);
      // 与 `setProjectColor` 同一道边界校验，理由见那边（界面容易传成 0 起算的下标）。
      const clean = slot === undefined ? undefined : parseCategorySlot(slot);
      if (slot !== undefined && clean === undefined) {
        throw new Error(`分类色槽位必须是 1–8 的整数，收到 ${JSON.stringify(slot)}`);
      }
      await ctx.dispatch({
        entityType: 'HABIT' as EntityType,
        entityId,
        opType: OpType.Update,
        // 清除写 `null`（穿过 JSON 表达"清除"），不写"不放这个键"。
        payload: { color: clean === undefined ? null : String(clean) },
      });
    },

    async setHabitIcon(entityId, icon) {
      if (habitOf(entityId) === undefined) throw new Error(`找不到习惯「${entityId}」`);
      // 与 `setHabitColor` 同一道写入侧校验：不认识的值**抛**，不悄悄存下去。
      // 存下去的后果是"这条习惯的图标在某个端上画不出来"，而那在任何一层都不报错。
      const clean = icon === undefined ? undefined : parseHabitIcon(icon);
      if (icon !== undefined && clean === undefined) {
        throw new Error(`习惯图标必须是闭集里的 key，收到 ${JSON.stringify(icon)}`);
      }
      await ctx.dispatch({
        entityType: 'HABIT' as EntityType,
        entityId,
        opType: OpType.Update,
        // 清除写 `null`（与 `color` 同一条"用 null 穿过 JSON 表达清除"的约定）：
        // 不写这个键 = 不改，写 `null` = 回到派生的那个。
        payload: { icon: clean ?? null },
      });
    },

    async setHabitGoal(entityId, goal) {
      if (habitOf(entityId) === undefined) throw new Error(`找不到习惯「${entityId}」`);

      // 🔴 数值校验不是"看着别扭"，是**判据会失真**：
      //    `isAchieved` 是 `value >= target` / `<=` / `===` 这类比较，
      //    一个负数或 NaN 会让"达成"恒真或恒假，而界面上看不出哪里不对。
      //    `goalType: 'atMost'` 时 `target: 0` 是**合法**的（"一次都不碰"），所以下界是 0 不是 1。
      if (goal.target !== undefined && (!Number.isFinite(goal.target) || goal.target < 0)) {
        throw new Error(`习惯目标必须是不小于 0 的有限数，收到「${String(goal.target)}」`);
      }

      const payload: Record<string, unknown> = {};
      if (goal.target !== undefined) payload.target = goal.target;
      if (goal.unit !== undefined) {
        const trimmed = goal.unit.trim();
        // 空串 = **清除**（null），不是留一个空单位 ——
        // 空单位在界面上会渲染成「1 」，看起来像少了个字。
        payload.unit = trimmed === '' ? null : trimmed;
      }
      if (goal.goalType !== undefined) payload.goalType = goal.goalType;

      // 一个字段都没传 ⇒ 不写 op（空 UPD 是纯粹的噪音）。
      if (Object.keys(payload).length === 0) return;

      await ctx.dispatch({
        entityType: 'HABIT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload,
      });
    },

    async removeHabit(entityId) {
      if (habitOf(entityId) === undefined) throw new Error(`找不到习惯「${entityId}」`);
      await ctx.dispatch({
        entityType: 'HABIT' as EntityType,
        entityId,
        opType: OpType.Delete,
        payload: {},
      });
    },

    async checkIn(habitId, date, value) {
      const habit = habitOf(habitId);
      if (habit === undefined) throw new Error(`找不到习惯「${habitId}」`);

      const day = date ?? toLocalDate(now());
      // 幂等：这天已经打过卡就什么都不做 —— 见文件头第 2 条。
      if (logOf(habitId, day) !== undefined) return false;

      await ctx.dispatch({
        entityType: 'HABIT_LOG' as EntityType,
        entityId: habitLogId(habitId, day),
        opType: OpType.Create,
        payload: {
          habitId,
          date: day,
          // 见文件头第 3 条：value → habit.target → 1。
          value: value ?? habit.target ?? 1,
          // 🔴 `deletedAt: null` 是**必须**的，不是防御性写法。
          //
          // 打卡记录的 id 由 (习惯, 日期) 决定（见文件头第 1 条），所以
          // "撤销打卡 → 同一天再打卡"会**对同一个实体再发一条 CRT**。
          // 而 reducer 对 CRT/UPD 是**合并**语义：它把 payload 合到已有实体上，
          // 不会替你清掉 `deletedAt`。于是那条墓碑一直留着 ——
          // **重新打卡的 op 写得明明白白、同步得干干净净，界面上就是不出现。**
          // （这条是 `habit-actions.spec.ts` 里"撤销后还能再打卡"抓出来的。）
          //
          // `null` 在 reducer 里的含义就是"显式清除这个字段"，正好是这里要的。
          deletedAt: null,
        },
      });
      return true;
    },

    async undoCheckIn(habitId, date) {
      const day = date ?? toLocalDate(now());
      // 没打卡就没得撤销 —— 不产生多余的 `DEL`（那会让日志里出现
      // "删除了一条不存在的东西"，排查时非常难解释）。
      if (logOf(habitId, day) === undefined) return false;

      await ctx.dispatch({
        entityType: 'HABIT_LOG' as EntityType,
        entityId: habitLogId(habitId, day),
        opType: OpType.Delete,
        payload: {},
      });
      return true;
    },

    listHabits() {
      return aliveOf(ctx.getState().habits).sort(byCanonicalOrder);
    },

    listLogs() {
      return aliveOf(ctx.getState().habitLogs).sort(byCanonicalOrder);
    },
  };
}