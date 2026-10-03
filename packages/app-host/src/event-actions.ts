/**
 * 倒数日动作（宿主无关）
 * =======================
 *
 * 与 `note-actions.ts` / `reminder-actions.ts` 同一个理由：**op 的构造只能有一份**。
 * 每个宿主各拼一遍 payload，就会出现"Web 上清空有效、Android 上清空无效"
 * 这种没有任何一层会报错的漂移（AGENTS §3.5 记着两次同形状的代价）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 四条由这里独占的语义决定
 *
 * 1. 🔴 **一个用户手势 = 一个 op**（AGENTS §3.4）。
 *    所以「编辑日期」这个面板保存时把 `date` 与 `isLunar` 写进**同一条** UPD ——
 *    它们是同一次确认。拆成两条会让两端各看到一半的新状态，
 *    而"农历生日"在中间那一瞬会被算成公历生日。
 *    同理，样式（图标 + 颜色）一次保存一条 op。
 *
 * 2. 🔴 **清除写 `null`，不写"不放这个键"**。
 *    reducer 对 UPD 是合并语义：省略一个键等于"不动它"。
 *    于是"去掉图标"如果实现成不放 `icon`，界面上图标还留着，
 *    而用户刚刚点过"无"（同 `note-actions.ts` 的 `projectId` 写法）。
 *
 * 3. **归档与删除是两条不同的 op、两个不同的字段。**
 *    `archiveEvent` 只写 `archivedAt`，**绝不碰 `deletedAt`**；
 *    `removeEvent` 只发 `DEL`。把归档实现成软删除会让归档项出现在回收站，
 *    而 `unarchiveEvent` 清墓碑会让离线端把它当"从未删除"重新同步回来（§2.5）。
 *
 * 4. **规则字符串在写入侧就校验**（`isValidRecurrenceRule`）。
 *    界面不许手拼 RRULE（用 `Recurrence.yearly()` 之类的构造助手）——
 *    拼错一个分号不会报错，只会静默变成另一条规则。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  aliveEvents,
  archivedEvents,
  eventRejection,
  sortEventsForDisplay,
  type CountdownEvent,
  type CountdownEventKind,
  type CategorySlot,
  eventTitleRejection,
  isValidRecurrenceRule,
  type LocalDate,
  type LunarLeapMonthPolicy,
} from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

/** 新建时可一并写入的字段。省略 = 用领域层的运行时默认值。 */
export interface NewEventFields {
  /** 类型档位。省略 = 用户没选，界面按日期方向兜底（见 `eventKindOf`）。 */
  kind?: CountdownEventKind;
  /** 每年重复时按农历锚点推。默认 `false`。 */
  isLunar?: boolean;
  /** 闰月口径。默认 `'first'`（ADR-0044 D2）。 */
  leapMonthPolicy?: LunarLeapMonthPolicy;
  /** RRULE（由 `Recurrence` 助手构造）。省略 / `null` = 一次性倒数日。 */
  recurrence?: string | null;
  /** 直接置顶创建（"加到最前面"）。默认 `false`。 */
  pinned?: boolean;
  icon?: string | null;
  color?: CategorySlot | null;
  notes?: string | null;
}

export interface EventActionsOptions {
  /** 倒数日 id 生成器。可注入，理由见 `NoteActionsOptions.newNoteId`。 */
  newEventId?: () => string;
  /** 墙上时钟，只用于 `pinnedAt` / `archivedAt` 这类**标记字段**。
   *  🔴 op 自己的时间戳由 dispatch 负责，reducer 从不读它（§3.4 幂等重放的前提）。 */
  now?: () => number;
}

export interface EventActions {
  createEvent(title: string, date: LocalDate, over?: NewEventFields): Promise<string>;
  renameEvent(entityId: string, title: string): Promise<void>;
  /** 🔴 日期与历法**同一条 op**（见文件头第 1 条）。`isLunar` 省略 = 不改历法。 */
  setEventDate(entityId: string, date: LocalDate, isLunar?: boolean): Promise<void>;
  /** `null` = 用户明确"不选类型"（回到按日期方向兜底），不是"不改"。 */
  setEventKind(entityId: string, kind: CountdownEventKind | null): Promise<void>;
  setEventLeapMonthPolicy(entityId: string, policy: LunarLeapMonthPolicy): Promise<void>;
  /** `null` = 改成一次性。非法 RRULE 字符串**抛错**（见文件头第 4 条）。 */
  setEventRecurrence(entityId: string, rule: string | null): Promise<void>;
  setEventPinned(entityId: string, pinned: boolean): Promise<void>;
  /** 样式面板的一次保存：图标 + 色槽。省略的键不动。 */
  setEventStyle(
    entityId: string,
    style: { icon?: string | null; color?: CategorySlot | null },
  ): Promise<void>;
  /** `null` 与空串都算"没有备注"（界面上的"清除"按钮走 `null`）。 */
  setEventNotes(entityId: string, notes: string | null): Promise<void>;
  /** 归档：只写 `archivedAt`（文件头第 3 条）。 */
  archiveEvent(entityId: string): Promise<void>;
  /** 取消归档。**未归档时返回 `false` 且不写 op**（不产生空 op）。 */
  unarchiveEvent(entityId: string): Promise<boolean>;
  /** 软删除（进回收站）。 */
  removeEvent(entityId: string): Promise<void>;
  /** 从回收站还原。**不在回收站时返回 `false` 且不写 op**。 */
  restoreEvent(entityId: string): Promise<boolean>;
  eventOf(entityId: string): CountdownEvent | undefined;
  /** 主列表：未删未归档，**规范顺序**（置顶 → 距下一次 → id）。 */
  listEvents(today: LocalDate): CountdownEvent[];
  /** 归档视图：顺序同上。 */
  listArchivedEvents(today: LocalDate): CountdownEvent[];
}

export function createEventActions(
  ctx: ActionContext,
  options: EventActionsOptions = {},
): EventActions {
  const makeEventId = options.newEventId ?? ((): string => `event-${randomId()}`);
  const now = options.now ?? ((): number => Date.now());

  const eventOf = (entityId: string): CountdownEvent | undefined => {
    const event = ctx.getState().events[entityId];
    if (event === undefined || event.deletedAt !== undefined) return undefined;
    return event;
  };

  /** 见文件头第 1 条：标题与日期的合法性由领域层单点判定。 */
  const assertTitleAndDate = (title: string, date: LocalDate): void => {
    const rejection = eventRejection(title, date);
    if (rejection === undefined) return;
    const detail =
      rejection === 'empty-title'
        ? '标题不能为空（空白也算空）'
        : rejection === 'too-long-title'
          ? `标题 ${String(title.length)} 字，超过上限`
          : `日期「${date}」不是有效的 YYYY-MM-DD`;
    throw new Error(`倒数日不合法：${detail}`);
  };

  /** 见文件头第 4 条。 */
  const assertRule = (rule: string): void => {
    if (!isValidRecurrenceRule(rule)) {
      throw new Error(`重复规则「${rule}」不是合法 RRULE（请用 Recurrence 助手构造）`);
    }
  };

  const allEvents = (): CountdownEvent[] => Object.values(ctx.getState().events);

  return {
    async createEvent(title, date, over = {}) {
      assertTitleAndDate(title, date);
      if (over.recurrence !== undefined && over.recurrence !== null) assertRule(over.recurrence);
      const entityId = makeEventId();
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: {
          title: title.trim(),
          date,
          // 🔴 新建时能确定的字段一律**显式写值**，不留给"省略 = 不动它"：
          // CRT 的合并语义下，省略等于把默认值交给对端，而默认值只有一份定义。
          isLunar: over.isLunar ?? false,
          ...(over.kind === undefined ? {} : { kind: over.kind }),
          ...(over.leapMonthPolicy === undefined
            ? {}
            : { leapMonthPolicy: over.leapMonthPolicy }),
          recurrence: over.recurrence ?? null,
          ...(over.pinned === true ? { pinnedAt: now() } : {}),
          ...(over.icon === undefined ? {} : { icon: over.icon }),
          ...(over.color === undefined ? {} : { color: over.color }),
          ...(over.notes === undefined ? {} : { notes: over.notes }),
        },
      });
      return entityId;
    },

    async renameEvent(entityId, title) {
      if (eventOf(entityId) === undefined) throw new Error(`找不到倒数日「${entityId}」`);
      const rejection = eventTitleRejection(title);
      if (rejection !== undefined) {
        throw new Error(
          rejection === 'empty-title'
            ? '倒数日标题不能为空（空白也算空）'
            : `倒数日标题 ${String(title.length)} 字，超过上限`,
        );
      }
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { title: title.trim() },
      });
    },

    async setEventDate(entityId, date, isLunar) {
      const current = eventOf(entityId);
      if (current === undefined) throw new Error(`找不到倒数日「${entityId}」`);
      assertTitleAndDate(current.title, date);
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { date, ...(isLunar === undefined ? {} : { isLunar }) },
      });
    },

    async setEventKind(entityId, kind) {
      if (eventOf(entityId) === undefined) throw new Error(`找不到倒数日「${entityId}」`);
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { kind },
      });
    },

    async setEventLeapMonthPolicy(entityId, policy) {
      if (eventOf(entityId) === undefined) throw new Error(`找不到倒数日「${entityId}」`);
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { leapMonthPolicy: policy },
      });
    },

    async setEventRecurrence(entityId, rule) {
      if (eventOf(entityId) === undefined) throw new Error(`找不到倒数日「${entityId}」`);
      if (rule !== null) assertRule(rule);
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { recurrence: rule },
      });
    },

    async setEventPinned(entityId, pinned) {
      if (eventOf(entityId) === undefined) throw new Error(`找不到倒数日「${entityId}」`);
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        // 取消置顶写 `null`（见文件头第 2 条）
        payload: { pinnedAt: pinned ? now() : null },
      });
    },

    async setEventStyle(entityId, style) {
      if (eventOf(entityId) === undefined) throw new Error(`找不到倒数日「${entityId}」`);
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: {
          ...(style.icon === undefined ? {} : { icon: style.icon }),
          ...(style.color === undefined ? {} : { color: style.color }),
        },
      });
    },

    async setEventNotes(entityId, notes) {
      if (eventOf(entityId) === undefined) throw new Error(`找不到倒数日「${entityId}」`);
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { notes: notes === null || notes.trim() === '' ? null : notes.trim() },
      });
    },

    async archiveEvent(entityId) {
      if (eventOf(entityId) === undefined) throw new Error(`找不到倒数日「${entityId}」`);
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { archivedAt: now() },
      });
    },

    async unarchiveEvent(entityId) {
      const raw = ctx.getState().events[entityId];
      if (raw === undefined || raw.archivedAt === undefined) return false;
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { archivedAt: null },
      });
      return true;
    },

    async removeEvent(entityId) {
      if (eventOf(entityId) === undefined) throw new Error(`找不到倒数日「${entityId}」`);
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Delete,
        payload: {},
      });
    },

    async restoreEvent(entityId) {
      // 读**含墓碑**的原始记录：`eventOf` 会滤掉墓碑，用它会让"撤销删除"
      // 永远判定成"找不到"（同 `note-actions.ts` 的 `restoreNote`）。
      const raw = ctx.getState().events[entityId];
      if (raw === undefined || raw.deletedAt === undefined) return false;
      await ctx.dispatch({
        entityType: 'EVENT' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { deletedAt: null },
      });
      return true;
    },

    eventOf,

    listEvents(today) {
      return sortEventsForDisplay(aliveEvents(allEvents()), today);
    },

    listArchivedEvents(today) {
      return sortEventsForDisplay(archivedEvents(allEvents()), today);
    },
  };
}
