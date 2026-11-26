/**
 * 通用 CSV / Todoist 导入 —— 宿主接线
 * ==================================
 * 只接线：解析在 `@heyta/domain` 的 `parseCsvImport`；预览/写入的 op 构造复用
 * `@heyta/app-host` 的 `createTickTickImportActions`（同一份 `TickTickImportPlan` 管线）——
 * 稳定 id 幂等、引用顺序、报告全部沿用，不重造。
 */

import {
  createTickTickImportActions,
  type ActionContext,
  type TickTickImportBatch,
  type TickTickImportResult,
} from '@heyta/app-host';
import {
  parseCsvImport,
  type CsvImportKind,
  type TickTickImportPlan,
  type TickTickImportReport,
  type TickTickParseFailure,
} from '@heyta/domain';

import { currentState, dispatchChecked, dispatchIntent } from '../../lib/oplog.js';

const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  dispatchChecked,
  getState: currentState,
};

const importActions = createTickTickImportActions(actionContext);

export type CsvPreview =
  | {
      readonly ok: true;
      readonly plan: TickTickImportPlan;
      readonly report: TickTickImportReport;
      readonly batch: TickTickImportBatch;
    }
  | {
      readonly ok: false;
      readonly reason: TickTickParseFailure | 'unsupported';
      readonly report: TickTickImportReport;
    };

/** 只读预览：解析一次，算一遍批次，一个字都不写。 */
export function previewCsvImport(kind: CsvImportKind, text: string, now: number = Date.now()): CsvPreview {
  const parsed = parseCsvImport(kind, text, { now });
  if (!parsed.ok) return { ok: false, reason: parsed.reason, report: parsed.report };
  return {
    ok: true,
    plan: parsed.plan,
    report: parsed.report,
    batch: importActions.previewPlan(parsed.plan),
  };
}

/** 确认导入：把预览那一份 plan / report 原样交回去写（不吞异常）。 */
export function confirmCsvImport(
  plan: TickTickImportPlan,
  report: TickTickImportReport,
): Promise<TickTickImportResult> {
  return importActions.importPlan(plan, report);
}
