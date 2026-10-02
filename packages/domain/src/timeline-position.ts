/**
 * 「一条任务在时间上的位置」—— 三态判别联合（`timeline` 重画刀，goal P1）
 * ====================================================================
 *
 * 🔴 为什么是**判别联合**而不是"有没有 `durationMinutes`"这种弱信号：
 * 那是 R4 §1.5 **类 A 在数据层的复现** ——「用一个不存在的属性表达一个契约」。
 * 三种状态在**类型上**可区分，渲染层就不可能把"没有时间数据"画成一条假长度的条
 * （R4 实测：诚实的兜底文案仍然造出了一条说谎的线）。
 *
 * 三态降级规则（外部产品的一致做法，唯一事实源 R4 §5.2）：
 *
 * | 数据               | 画法                     |
 * |--------------------|--------------------------|
 * | 有起止（区间）      | **条**                   |
 * | 只有时刻            | **点 / 菱形**，不是条     |
 * | 什么时间数据都没有   | **移出图区**，进有名字的泳道 |
 *
 * ## P1 的生产者边界（零 schema 改动）
 *
 * P1 只有 `Task.dueDate`（可选，epoch ms）可用：
 * **有 `dueDate` ⇒ `point`；没有 ⇒ `unscheduled`。**
 * `range` 在 P1 **没有生产者** —— 它是为 P2（`startDate` / `durationMinutes`
 * 两个可选字段，见 goal §3.1 的 ADR）预留的完备形状：类型先立，生产者后到，
 * 渲染层从第一天起就不会把 range 画错。
 *
 * ## 分层位置（与 `TimelineBlock` 同一条理由）
 *
 * 它是 `planTimelineRows()`（app-host）的**返回值**，也是共享 `TimelineBoard`
 * （`packages/ui`）的**入参** —— 两端都依赖 `@heyta/domain`，而 ui 与 app-host
 * **互不依赖**。定义在任何一侧都会逼另一侧抄一份结构类型，两份必然漂移。
 *
 * ⚠️ 只有数据，没有行为：怎么从任务推导出来在 app-host，怎么画在 ui。
 */

/**
 * 任务在时间上的位置。
 *
 * ⚠️ 时间一律 **epoch ms**（与 `Task.dueDate` 同单位，链路上不需要换算）。
 */
export type TaskTimePosition =
  | {
      /** 有起止：画成**条**。P2 才有生产者（见文件头）。 */
      readonly kind: 'range';
      readonly startMs: number;
      readonly endMs: number;
    }
  | {
      /** 只有时刻：画成**点 / 菱形**，绝不画成条。 */
      readonly kind: 'point';
      readonly atMs: number;
    }
  | {
      /** 什么时间数据都没有：**不落图**，进有名字的「未排期」泳道。 */
      readonly kind: 'unscheduled';
    };

/**
 * 共享 `TimelineBoard` 的**一行**（一个任务）。
 *
 * 🔴 它**没有**任何时长/长度字段 —— 「绝不编长度」在数据形状上就成立：
 * 渲染层想画一条"按 1 小时排"的条，**类型上就没有数可用**。
 * AI 估时（`aiMinutes`）只是行头的一个**文字 badge**，与几何无关。
 */
export interface TimelineBoardRow {
  readonly taskId: string;
  readonly title: string;
  readonly position: TaskTimePosition;
  /**
   * 备注里 AI 估的分钟数（原样，未夹上下限）。`undefined` = 没估过；
   * `0` 是"估了 0 分钟" —— 两者不是一回事（见 `duration-note.ts`）。
   */
  readonly aiMinutes: number | undefined;
}
