/**
 * 从滴答清单导入 —— 宿主接线（B2-1）
 * ======================================
 *
 * 这个文件**只做接线**：把"用户选了一个文件"翻译成 domain 的解析、
 * 再交给 `@heyta/app-host` 的 op 批次构造器。**它不含任何业务判断** ——
 * 24 列的列名、优先级映射、幂等、引用顺序、跳过与未映射的报告，
 * 全部在 `packages/domain/src/ticktick-format.ts` / `ticktick-import.ts`
 * 与 `packages/app-host/src/ticktick-import-actions.ts` 里（AGENTS.md §3.5）。
 *
 * ## 🔴 为什么预览与确认共用同一个 `plan`
 *
 * `previewTickTickImport` 解析一次、算一遍批次，把 `plan` / `report` / `batch`
 * 一起交给界面；确认时**把同一份 `plan`、`report` 原样交回**
 *（`confirmTickTickImport`）。两次解析（预览一次、导入一次）会让
 * "用户看到的数字"与"真的写进去的东西"来自两次独立的解析 ——
 * 而两者只要差一条，界面就在说一句它没做到的话。
 *
 * 幂等不靠"只解析一次"保证，靠稳定 id：确认时 `importPlan` 会**重新**
 * 对当前状态算一遍批次，所以预览之后本机若已写入同样内容，第二次会 `opCount === 0`。
 *
 * ## 🔴 这不是"还原"（与 `ImportPanel` 的分工）
 *
 * 设置页里另有一个 `ImportPanel`，那一个是**还原 heyta 自己的导出文件**，
 * 只支持"导到空库"。本面板是**从另一个产品迁进来**，走的是普通 op，
 * 可以与既有数据共存 —— 两件事的承诺完全不同，所以是两个面板、两套文案。
 */

import {
  createTickTickImportActions,
  type ActionContext,
  type TickTickImportBatch,
  type TickTickImportResult,
} from '@heyta/app-host';
import {
  parseTickTickCsv,
  type TickTickImportPlan,
  type TickTickImportReport,
  type TickTickParseFailure,
} from '@heyta/domain';

import { currentState, dispatchIntent } from '../../lib/oplog.js';

/**
 * 动作层的宿主上下文。
 *
 * 与 tasks / projects / notes 等 store 是同一个形状（两个函数引用，
 * 不含判断）。切分 store 不是这里的目的 —— 见 `tasks/store.ts` 同段注释。
 */
const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  getState: currentState,
};

const importActions = createTickTickImportActions(actionContext);

/** 预览结果：解析成功给出计划与批次，失败给出结构化原因。 */
export type TickTickPreview =
  | {
      readonly ok: true;
      readonly plan: TickTickImportPlan;
      readonly report: TickTickImportReport;
      /** 本次**会**写进去的批次（`entries.length` 就是 op 条数）。 */
      readonly batch: TickTickImportBatch;
    }
  | {
      readonly ok: false;
      readonly reason: TickTickParseFailure;
      readonly report: TickTickImportReport;
    };

/**
 * 只读预览。**一个字都不写。**
 *
 * `now` 由调用方给（默认 `Date.now()`），因为 domain 的解析必须保持纯 ——
 * 它只在滴答没给 `Created Time` 时用作回落时间戳。
 */
export function previewTickTickImport(text: string, now: number = Date.now()): TickTickPreview {
  const parsed = parseTickTickCsv(text, { now });
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, report: parsed.report };
  }
  return {
    ok: true,
    plan: parsed.plan,
    report: parsed.report,
    batch: importActions.previewPlan(parsed.plan),
  };
}

/**
 * 确认导入：把预览得到的那一份计划写成 op。
 *
 * 🔴 **不吞异常**：`importPlan` 在派发中途抛错时**原样上抛**，由调用方
 * 决定怎么显示。把它 catch 成"成功"会让一次半截导入在界面上看起来完成了 ——
 * 这正是构造器文件头列为禁止的那种写法。所以这里没有任何 try/catch。
 */
export function confirmTickTickImport(
  plan: TickTickImportPlan,
  report: TickTickImportReport,
): Promise<TickTickImportResult> {
  return importActions.importPlan(plan, report);
}
