/**
 * 任务模板（`TASK_TEMPLATE`）的**纯逻辑** —— 名校验 / 规范顺序 / 任务 ⇄ 模板 的字段映射
 * ================================================================================
 *
 * 这份文件只回答"模板是什么、建任务时要搬哪几格"，**不碰 IO、不碰 op-log、不碰 i18n**。
 * 与 `filter-rule.ts` / `sections.ts` 同一条纪律：业务判据只在领域层算一次，
 * 动作层与界面都调它，免得"哪些字段该继承"在两处各写一遍然后漂移。
 *
 * [ADR-0093](../../../docs/adr/0093-task-templates-are-a-user-entity.md) 定的两条边界：
 *
 * 1. 🔴 **模板只存"建任务时要预填的那几格"，不存一个 `Task` 快照。**
 *    下面 {@link templatePayloadFromTask} 是**唯一**处决定"从一条任务抓取哪些字段"；
 *    `projectId` / `dueDate` / `parentId` / `repeatRule` / `completedAt` 等"某条具体任务
 *    此刻的状态"**刻意不抓**（理由见 `entities.ts` 的 `TaskTemplate` 注释）。
 *
 * 2. 🔴 **从模板建任务 = 一条 `TASK` Create op**（AGENTS §3.4）。所以
 *    {@link taskFieldsFromTemplate} 产出的是**一条新任务的字段**，由动作层
 *    `dispatch` 一次；它本身不生成 id、不写任何东西（`genItemId` 由调用方注入，
 *    因为条目 id 是"这条任务里某一条勾选项"的定位键，不是模板里的东西）。
 */

import { Priority, type Task, type TaskTemplate } from './entities.js';

/** 模板名的写侧上限（与 `FILTER_NAME_MAX_LENGTH` 同一量级，避免侧栏被一个超长名撑爆）。 */
export const TEMPLATE_NAME_MAX_LENGTH = 100;

/** 模板名的写侧拒绝码。 */
export type TemplateNameRejection = 'empty' | 'too-long';

export function templateNameRejection(name: string): TemplateNameRejection | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > TEMPLATE_NAME_MAX_LENGTH) return 'too-long';
  return undefined;
}

/**
 * 活着的模板（未软删、未彻底删除），**规范顺序**：`order` 升序，缺 `order` 的排在
 * 有 `order` 的后面，同 `order` 按名字、再按 id（确定性打破平局）。
 *
 * 与 `aliveFilters` 同一条纪律：顺序只在领域层算一次。
 */
export function aliveTemplates<
  T extends { deletedAt?: number; purgedAt?: number; order?: number; name: string; id: string },
>(templates: readonly T[]): T[] {
  return templates
    .filter((template) => template.deletedAt === undefined && template.purgedAt === undefined)
    .sort(compareTemplatesForDisplay);
}

export function compareTemplatesForDisplay(
  a: { order?: number; name: string; id: string },
  b: { order?: number; name: string; id: string },
): number {
  const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 「从一条任务抓取哪些字段」的**唯一**定义，也是 `TaskTemplate` 内容的形状。 */
export interface TaskTemplateFields {
  name: string;
  title?: string;
  note?: string;
  priority?: Priority;
  important?: boolean;
  tagIds?: string[];
  checklist?: { text: string; done: boolean }[];
  durationMinutes?: number;
}

/**
 * 把一条任务**快照**成模板字段（"保存任务为模板"）。
 *
 * 🔴 只搬 {@link TaskTemplate} 明确列出的那几格；其余一律不搬（见文件头第 1 条）。
 * `checklist` 只保留 `text` / `done`（丢掉条目 id —— 新任务里会重新生成）；
 * `tagIds` 去重后保留（是否仍存活的过滤发生在建任务那一步）。
 */
export function templatePayloadFromTask(task: Task, name: string): TaskTemplateFields {
  const fields: TaskTemplateFields = { name };
  if (task.title.trim() !== '') fields.title = task.title;
  if (task.note !== undefined && task.note !== '') fields.note = task.note;
  if (task.priority !== undefined) fields.priority = task.priority;
  if (task.important === true) fields.important = true;
  if (task.tagIds !== undefined && task.tagIds.length > 0) {
    fields.tagIds = [...new Set(task.tagIds)];
  }
  if (task.checklist !== undefined && task.checklist.length > 0) {
    fields.checklist = task.checklist.map((item) => ({ text: item.text, done: item.done }));
  }
  if (task.durationMinutes !== undefined && task.durationMinutes > 0) {
    fields.durationMinutes = task.durationMinutes;
  }
  return fields;
}

/**
 * 从一个模板算出**一条新任务**要写的字段（"从模板建任务"）。
 *
 * 返回的对象只含**有值**的键（不写 `null`/`undefined`）—— 建任务时是合并语义，
 * 缺席即"不预填这一格"，与 `filter-actions.createFilter` 里"新建时显式写 `null`"
 * 是两回事（那里是为了清掉一个已存在的键，这里没有任何东西可清）。
 *
 * `title` 的兜底：模板没填 `title` 时用模板名 —— 模板名是用户为"这条要建的任务"
 * 起的默认标题，比一个空标题有用（一个空标题的模板没有意义）。
 *
 * `genItemId` 由调用方注入，给 `checklist` 的每一条生成一个新 `TaskChecklistItem.id`。
 */
export function taskFieldsFromTemplate(
  template: Pick<
    TaskTemplate,
    'name' | 'title' | 'note' | 'priority' | 'important' | 'tagIds' | 'checklist' | 'durationMinutes'
  >,
  genItemId: () => string,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const title = template.title ?? template.name;
  if (title.trim() !== '') fields['title'] = title;
  if (template.note !== undefined) fields['note'] = template.note;
  if (template.priority !== undefined) fields['priority'] = template.priority;
  if (template.important === true) fields['important'] = true;
  if (template.tagIds !== undefined && template.tagIds.length > 0) {
    fields['tagIds'] = [...new Set(template.tagIds)];
  }
  if (template.checklist !== undefined && template.checklist.length > 0) {
    fields['checklist'] = template.checklist.map((item) => ({
      id: genItemId(),
      text: item.text,
      done: item.done === true,
    }));
  }
  if (template.durationMinutes !== undefined && template.durationMinutes > 0) {
    fields['durationMinutes'] = template.durationMinutes;
  }
  return fields;
}
