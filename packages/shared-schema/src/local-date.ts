import { z } from 'zod';

/**
 * 「本地日期」的**唯一**校验器（`YYYY-MM-DD`，且必须是真实存在的那一天）。
 *
 * ## 为什么它在这里，而不是各自契约里各写一份
 *
 * 同一个形状此前在两个契约里各写了一遍（`task-batch-contract.ts` 的 `dueDateLocal` /
 * `startDateLocal`）。**两份正则 + 两份"这一天真的存在吗"的 refine 一定会漂** ——
 * 而漂的方向是"一边接受 2026-02-30、另一边拒绝"，那类差异不会让任何测试红，
 * 只会让同一份数据在两条通道上有两种合法性。
 *
 * ## 它守的那条不变量
 *
 * 除了形状，它还挡"日历上不存在的日子"：`2026-02-30` / `2026-13-01` / `2026-00-10` 全部拒绝。
 * 只写 `^\d{4}-\d{2}-\d{2}$` 是不够的 —— 那个正则接受 `9999-99-99`。
 *
 * ⚠️ **它是"本地日期"，不是时间戳**：不带时区、不带时分秒。
 * 与 `epoch`（毫秒）并存时，两者必须指向同一天 —— 那条一致性由各载荷自己的 `superRefine` 管
 * （见 `taskBatchItemSchema`），不在本文件。
 */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day!));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() + 1 === month &&
      parsed.getUTCDate() === day
    );
  });

/** 这一串能不能当作本地日期用（给不接受 zod 的调用方）。 */
export function isLocalDate(value: unknown): value is string {
  return typeof value === 'string' && localDateSchema.safeParse(value).success;
}
