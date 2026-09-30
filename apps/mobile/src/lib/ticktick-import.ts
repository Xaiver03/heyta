/**
 * 滴答清单导入（移动端）—— 预览 → 确认
 * ======================================
 *
 * ## 它补的是什么
 *
 * `packages/domain/src/ticktick-format.ts` + `ticktick-import.ts` 与
 * `packages/app-host/src/ticktick-import-actions.ts` **都早就写好了**，
 * web 端也已经有入口（`apps/web/src/features/settings/TickTickImportPanel.tsx`）。
 * 而移动端：🔴 **一次调用点都没有** —— `apps/mobile/src/screens/ExportScreen.tsx`
 * 的文件头甚至写着「这一轮**不做导入**」。于是"从滴答清单搬过来"在手机上不存在。
 *
 * ⇒ 这是方案 §5.5 第 7 项（滴答导入三端入口）里**移动端的那一半**。
 *
 * ## 🔴 输入方式与 web 不同（粘贴，不是选文件）—— 这是有据的取舍
 *
 * web 用 `<input type="file">`。移动端要"选文件"必须引入一个原生依赖
 * （`react-native-document-picker` / `react-native-fs` 之类），而那要过
 * `AGENTS.md` §3.1–3.2 的**两道门**（可维护性 + 许可证），并且把"导入"
 * 这件事绑在一个只为它存在的原生模块上。
 *
 * 而移动端的现实是：用户从滴答清单导出后，CSV 往往**就在聊天/邮件里**，
 * 长按复制再粘进来是**更短**的一条路。所以这一版走**粘贴**，零新依赖。
 *
 * ⚠️ **如实登记**：所以移动端能导入的是"**CSV 文本**"，而不是"**CSV 文件**"。
 * 这个差别写在界面提示里，不假装等价。
 *
 * ## 与 web 逐字相同的两条纪律
 *
 * 1. **幂等不靠"只解析一次"**，靠稳定 id：确认时 `importPlan` 会**重新**算一遍
 *    （理由见 `packages/domain/src/ticktick-import.ts` 的文件头）。
 * 2. 🔴 **不吞异常**：`importPlan` 在中途抛错时**原样上抛** ——
 *    把它 catch 成"成功"会让一次半截导入在界面上看起来完成了。
 */

import {
  createTickTickImportActions,
  type AppHost,
  type TickTickImportBatch,
  type TickTickImportResult,
} from '@heyta/app-host';
import {
  parseTickTickCsv,
  type TickTickImportPlan,
  type TickTickImportReport,
  type TickTickParseFailure,
} from '@heyta/domain';

/** 预览结果：解析成功给出计划与批次，失败给出结构化原因。 */
export type TickTickPreview =
  | {
      readonly ok: true;
      readonly plan: TickTickImportPlan;
      readonly report: TickTickImportReport;
      readonly batch: TickTickImportBatch;
    }
  | {
      readonly ok: false;
      readonly reason: TickTickParseFailure;
      readonly report: TickTickImportReport;
    };

/**
 * 解析 + 预览。**不写任何 op** —— 这一层只回答"会导入什么"。
 *
 * `host` 由调用方传（移动端的宿主是异步打开的，见 `db/open-host.ts`），
 * 而**不是**像 web 那样在模块加载期拿一个全局单例 —— 那种写法在 RN 里
 * 会在宿主还没打开时就建出一个悬空的动作层。
 */
export function previewTickTickImport(
  text: string,
  host: AppHost,
  now: number = Date.now(),
): TickTickPreview {
  const parsed = parseTickTickCsv(text, { now });
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, report: parsed.report };
  }
  return {
    ok: true,
    plan: parsed.plan,
    report: parsed.report,
    batch: createTickTickImportActions(host).previewPlan(parsed.plan),
  };
}

/** 确认导入：把预览得到的那一份计划写成 op。**不吞异常**（见文件头第 2 条）。 */
export function confirmTickTickImport(
  plan: TickTickImportPlan,
  report: TickTickImportReport,
  host: AppHost,
): Promise<TickTickImportResult> {
  return createTickTickImportActions(host).importPlan(plan, report);
}