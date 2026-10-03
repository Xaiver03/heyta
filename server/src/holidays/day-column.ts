/**
 * `holiday_adjustment_days.day`（一个 `DATE` 列）与 `YYYY-MM-DD` 字符串之间唯一的换算处。
 *
 * ## 为什么单独一个文件（三行代码也要单独放）
 *
 * 这个换算**写错的形态是静默的、且只在一半时区错**：
 *
 * | 写法 | UTC 的机器 | UTC+8 的机器 | UTC-5 的机器 |
 * |---|---|---|---|
 * | ✅ `d.toISOString().slice(0,10)` | `2027-01-01` | `2027-01-01` | `2027-01-01` |
 * | ❌ `toLocalDate(d)`（`@heyta/domain`，用本地 getter） | `2027-01-01` | `2027-01-01` | 🔴 **`2026-12-31`** |
 *
 * ❌ 那一列的症状是"元旦那天标注错位到去年"，而**开发和 CI 都在这张表的左边** ——
 * `packages/domain/date.ts` 那句"一律用本地日历日"讲的是**用户的时间**，
 * 而 `DATE` 列装的是**不带时区的历法日**，两者不是同一件事。
 * 判据在 `server/tests/holiday-adjustment-migration.pglite.spec.ts`，
 * 它把 `America/New_York` 下确实会少一天这件事**量了出来**，不是嘴上说。
 *
 * 反过来（字符串 → 列）也必须显式 UTC：`new Date('2027-01-01')` 在 ES 规范里
 * 是 UTC 午夜，而 `new Date(2027, 0, 1)` 是**本地**午夜 —— 后者写进 `DATE` 列时
 * 驱动会按连接时区解释它，同一份录入在 UTC-5 的库上会变成前一天。
 */

/** `DATE` 列（Prisma 给的是 UTC 零点的 `Date`）→ `YYYY-MM-DD`。 */
export const dayColumnToIso = (value: Date): string => value.toISOString().slice(0, 10);

/** `YYYY-MM-DD` → `DATE` 列。**只接受形状合法的输入**（调用方必须先过 zod）。 */
export const isoToDayColumn = (value: string): Date => {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`isoToDayColumn 收到非法日期：${value}`);
  // 🔴 `Date.UTC` 而不是 `new Date(y, m-1, d)`：后者是本地零点，
  // 而本地零点在 UTC-x 的机器上对应的**历法日**就是前一天。
  return new Date(Date.UTC(y, m - 1, d));
};
