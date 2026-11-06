import { z } from 'zod';

import { localDateSchema } from './local-date.js';

/**
 * One narrowly-scoped cross-entity operation for completing a repeating task.
 *
 * It is intentionally a payload marker rather than a new entity type or a
 * general transaction language. The op is still routed as TASK/UPD; the
 * reducer knows this one marker also carries the reminder field patches that
 * belong to the same occurrence.
 */
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/)
  .refine((value) => value !== 'constructor' && value !== 'prototype' && value !== '__proto__');
const epoch = z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000);
const receipt = z.string().min(1).max(256);

const taskPatch = z.object({
  dueDate: epoch,
  /**
   * 本地日期（全天）投影 —— **可选，且与 `dueDate` 必须指向同一天**。
   *
   * 🔴 它此前不在这里，而生产侧（`packages/app-host/src/actions.ts` 的完成发射）
   * 在任务带 `dueDateLocal` 时会把它一起塞进 `task` 补丁里 ⇒
   * **`.strict()` 把它当未知键拒掉 ⇒ 任何"带本地日期的重复任务"一勾完成就抛
   * `Invalid or unsupported task repeat completion`。** 那不是防守，是功能断了。
   *
   * 为什么是可选而不是必填：绝大多数任务只有 `dueDate`（带时刻）。
   * 为什么与 `dueDate` 成对出现：`dueDateLocal` 是"日期投影"，单独给它没有意义
   * （`taskBatchItemSchema` 的 `superRefine` 是同一条不变量，两处一并遵守）。
   */
  dueDateLocal: localDateSchema.optional(),
  widgetCompletionReceipts: z.array(receipt).max(100).optional(),
}).strict().superRefine((patch, ctx) => {
  if (patch.dueDateLocal === undefined) return;
  /**
   * 「同一天」的判据**只能宽到一天**，因为**服务端没有设备时区**：
   * `dueDate` 是设备本地零点的毫秒，而 UTC±14 之间任意一个小时区，
   * 其"某一天的本地零点"与"那一天的 UTC 零点"最多差 14 小时。
   * 所以判"两者相差不超过 24 小时"，挡住的是**错配一整个周期**这一类（唯一的现实失败形态：
   * 补丁里的 `dueDateLocal` 来自上一次计算，而 `dueDate` 已经推进了）。
   * ⚠️ 别把它升级成"UTC 日期逐字相等" —— 那会在 UTC+14 与 UTC-12 上误杀正确数据。
   */
  const projectedMs = Date.parse(`${patch.dueDateLocal}T00:00:00.000Z`);
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (Number.isNaN(projectedMs) || Math.abs(patch.dueDate - projectedMs) > ONE_DAY) {
    ctx.addIssue({
      code: 'custom',
      message: 'dueDateLocal must fall on the same day as dueDate',
    });
  }
});

const reminderPatch = z.object({
  id: identity,
  triggerAt: epoch,
  dismissedAt: epoch.nullable(),
  snoozedUntil: epoch.nullable(),
  firedForTriggerAt: epoch.optional(),
}).strict();

export const heytaTaskRepeatCompletionPayloadSchema = z.object({
  heytaTaskRepeatCompletion: z.literal(1),
  task: taskPatch,
  reminders: z.array(reminderPatch).max(50),
}).strict();

export type TaskRepeatCompletionTaskPatch = z.infer<typeof taskPatch>;
export type TaskRepeatCompletionReminderPatch = z.infer<typeof reminderPatch>;
export type HeytaTaskRepeatCompletionPayload = z.infer<typeof heytaTaskRepeatCompletionPayloadSchema>;

/** Detect the marker before ordinary TASK/UPD fallback. */
export function hasTaskRepeatCompletionMarker(payload: unknown): boolean {
  return payload !== null && typeof payload === 'object' && Object.hasOwn(payload, 'heytaTaskRepeatCompletion');
}

/**
 * Validate the complete scoped shape. Reminder ids are constrained to the
 * task's id prefix so this marker cannot become a generic arbitrary
 * cross-entity executor.
 */
export function parseTaskRepeatCompletionOperation(op: {
  entityType: string;
  opType: string;
  entityId?: string;
  entityIds?: readonly string[];
  payload: unknown;
}): HeytaTaskRepeatCompletionPayload {
  const parsed = heytaTaskRepeatCompletionPayloadSchema.safeParse(op.payload);
  if (!parsed.success || op.entityType !== 'TASK' || op.opType !== 'UPD' ||
      op.entityId === undefined || (op.entityIds?.length ?? 0) !== 0) {
    throw new Error('Invalid or unsupported task repeat completion');
  }
  const ids = parsed.data.reminders.map((reminder) => reminder.id);
  const validReminderId = (id: string): boolean => {
    const separator = id.lastIndexOf(':');
    if (separator <= 0 || separator === id.length - 1) return false;
    const parentTaskId = id.slice(0, separator);
    const triggerText = id.slice(separator + 1);
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(triggerText)) return false;
    const triggerAt = Number(triggerText);
    // The suffix is the reminder's creation trigger. Repeating-task
    // rescheduling deliberately keeps the reminder entity id stable while
    // changing its current `triggerAt`, so it must not equal the patch value.
    return parentTaskId === op.entityId && Number.isSafeInteger(triggerAt);
  };
  if (new Set(ids).size !== ids.length || ids.some((id) => !validReminderId(id))) {
    throw new Error('Task repeat completion reminder scope mismatch');
  }
  return parsed.data;
}
