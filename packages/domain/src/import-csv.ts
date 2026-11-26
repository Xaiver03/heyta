/**
 * 通用 CSV / Todoist 导入解析（复用滴答导入的「计划 → 动作」管线）
 * ==============================================================
 *
 * 不重造 op 构造：产出与 `ticktick-import` **同一形状**的 `TickTickImportPlan` /
 * `TickTickImportReport`，于是 `@heyta/app-host` 的 `createTickTickImportActions`
 * 能直接预览与写入（稳定 id 幂等、引用顺序、跳过/未映射报告全部沿用）。
 *
 * 两个新来源：
 *   · `parseGenericCsv` —— 通用 CSV：列名中英皆可（title/标题、due/截止、note/备注…）；
 *   · `parseTodoistCsv` —— Todoist 导出：TYPE/CONTENT/DUE_DATE/PRIORITY/LABELS/PROJECT_NAME/IS_COMPLETED。
 *
 * 纯函数：不碰存储、不 dispatch；`now` 注入（用于"已完成"时间与 createdAt）。
 */

import { dueDateToEpoch } from './capture.js';
import { Priority } from './entities.js';
import {
  lexCsv,
  stableTickTickId,
  type TickTickImportPlan,
  type TickTickImportReport,
  type TickTickParseFailure,
  type TickTickProjectDraft,
  type TickTickSkipEntry,
  type TickTickTaskDraft,
} from './ticktick-import.js';
import type { LocalDate, LocalTime } from './date.js';

export const GENERIC_CSV_NAMESPACE = 'heyta:csv:v1';
export const TODOIST_NAMESPACE = 'heyta:todoist:v1';

export type CsvImportKind = 'generic' | 'todoist';

export interface CsvImportOptions {
  /** 未给时间时用当前时刻（已完成时间、createdAt/updatedAt）。 */
  readonly now: number;
}

export type CsvImportResult =
  | { readonly ok: true; readonly plan: TickTickImportPlan; readonly report: TickTickImportReport }
  | {
      readonly ok: false;
      readonly reason: TickTickParseFailure | 'unsupported';
      readonly detail?: string;
      readonly report: TickTickImportReport;
    };

/** 空报告（失败时也要一个结构化的零值报告，界面不自造）。 */
function emptyReport(dataRows = 0): TickTickImportReport {
  return {
    dataRows,
    tasks: 0,
    projects: 0,
    tags: 0,
    checklistItems: 0,
    recurringTasks: 0,
    completedTasks: 0,
    skipped: [],
    unmapped: [],
    skippedCounts: {},
    unmappedCounts: {},
  };
}

const normHeader = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** 在表头里找第一个命中的列下标。 */
function findColumn(header: readonly string[], names: readonly string[]): number {
  const normalized = header.map(normHeader);
  for (let i = 0; i < normalized.length; i += 1) {
    if (names.includes(normalized[i] as string)) return i;
  }
  return -1;
}

const cellAt = (row: readonly string[], index: number): string =>
  index >= 0 && index < row.length ? (row[index] as string).trim() : '';

interface ParsedDue {
  readonly dueDate?: number;
  readonly dueDateLocal?: LocalDate;
}

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?/;

/** 解析截止：`YYYY-MM-DD` / `YYYY-MM-DD HH:mm` / ISO；解析不出则丢弃（不猜）。 */
function parseDue(raw: string): ParsedDue {
  const value = raw.trim();
  if (value === '') return {};
  const match = DATE_TIME.exec(value);
  if (match !== null) {
    const date = match[1] as LocalDate;
    const time = match[2] as LocalTime | undefined;
    return { dueDateLocal: date, dueDate: dueDateToEpoch(date, time) };
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? { dueDate: Math.trunc(parsed) } : {};
}

/** 优先级：文本 / 数字 都认；不认识返回 `undefined`（保持"未知"，不猜）。 */
function parsePriority(raw: string): Priority | undefined {
  const value = raw.trim().toLowerCase();
  if (value === '') return undefined;
  if (['high', '高', '高优先级', 'urgent', 'p1', '1'].includes(value)) return Priority.High;
  if (['medium', '中', '中优先级', 'normal', 'p2', '2'].includes(value)) return Priority.Medium;
  if (['low', '低', '低优先级', 'p3', '3'].includes(value)) return Priority.Low;
  if (['none', '无', '0'].includes(value)) return Priority.None;
  return undefined;
}

/** 标签：逗号或分号分隔。 */
function parseTags(raw: string): string[] {
  return raw
    .split(/[,;，；]/u)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

const truthy = (raw: string): boolean => ['true', '1', 'yes', 'y', '是', '已完成'].includes(raw.trim().toLowerCase());

/** Todoist 优先级是 1..4（4 最高），与通用 CSV 的文本档不同，单独映射。 */
function parseTodoistPriority(raw: string): Priority | undefined {
  switch (raw.trim()) {
    case '4':
      return Priority.High;
    case '3':
      return Priority.Medium;
    case '2':
      return Priority.Low;
    case '1':
    case '0':
      return Priority.None;
    default:
      return undefined;
  }
}

/** 累积器：project/tag 去重 + 任务与报告。 */
class PlanBuilder {
  readonly projects: TickTickProjectDraft[] = [];
  readonly tags: TickTickImportPlan['tags'] = [];
  readonly tasks: TickTickTaskDraft[] = [];
  readonly report: TickTickImportReport;
  private readonly projectByName = new Map<string, TickTickProjectDraft>();
  private readonly tagByName = new Map<string, TickTickImportPlan['tags'][number]>();
  private readonly sourceKeys = new Set<string>();

  constructor(
    private readonly namespace: string,
    dataRows: number,
    private readonly now: number,
  ) {
    this.report = emptyReport(dataRows);
  }

  private projectId(name: string, order: number): string {
    const key = name.trim().toLowerCase();
    const existing = this.projectByName.get(key);
    if (existing !== undefined) return existing.id;
    const draft: TickTickProjectDraft = {
      id: stableTickTickId(this.namespace, 'project', `list:${key}`),
      name: name.trim(),
      sourceKey: `list:${key}`,
      order,
    };
    this.projectByName.set(key, draft);
    this.projects.push(draft);
    return draft.id;
  }

  private tagIds(names: readonly string[]): string[] {
    const ids: string[] = [];
    for (const name of names) {
      const key = name.trim().toLowerCase();
      let draft = this.tagByName.get(key);
      if (draft === undefined) {
        draft = { id: stableTickTickId(this.namespace, 'tag', `tag:${key}`), name: name.trim() };
        this.tagByName.set(key, draft);
        this.tags.push(draft);
      }
      if (!ids.includes(draft.id)) ids.push(draft.id);
    }
    return ids;
  }

  addTask(input: {
    readonly sourceKey: string;
    readonly title: string;
    readonly note?: string;
    readonly listName?: string;
    readonly tags?: readonly string[];
    readonly priority?: Priority;
    readonly due?: ParsedDue;
    readonly completed?: boolean;
    readonly rowIndex: number;
    readonly order: number;
  }): void {
    const title = input.title.trim();
    if (title === '') {
      this.skip(input.rowIndex, title, 'empty-title');
      return;
    }
    if (this.sourceKeys.has(input.sourceKey)) {
      this.skip(input.rowIndex, title, 'duplicate-source-id');
      return;
    }
    this.sourceKeys.add(input.sourceKey);

    const task: TickTickTaskDraft = {
      id: stableTickTickId(this.namespace, 'task', input.sourceKey),
      title,
      createdAt: this.now,
      updatedAt: this.now,
      sourceKey: input.sourceKey,
      order: input.order,
    };
    if (input.note !== undefined && input.note !== '') task.note = input.note;
    if (input.listName !== undefined && input.listName.trim() !== '') {
      task.projectId = this.projectId(input.listName, this.projects.length);
    }
    if (input.tags !== undefined && input.tags.length > 0) {
      const ids = this.tagIds(input.tags);
      if (ids.length > 0) task.tagIds = ids;
    }
    if (input.priority !== undefined) task.priority = input.priority;
    if (input.due?.dueDate !== undefined) task.dueDate = input.due.dueDate;
    // `dueDateLocal` 不在 `TickTickTaskDraft` 里（滴答导入项目没用它）；随 `note` 之外无归宿，
    // 由 `dueDate`（本地零点）承担。日期型信息不丢：dueDate 已经是那一天本地零点。
    if (input.completed === true) {
      task.completedAt = this.now;
      this.report.completedTasks += 1;
    }
    this.tasks.push(task);
  }

  private skip(rowIndex: number, title: string, reason: TickTickSkipEntry['reason']): void {
    this.report.skipped.push({ rowIndex, title, reason });
    this.report.skippedCounts[reason] = (this.report.skippedCounts[reason] ?? 0) + 1;
  }

  finish(): { plan: TickTickImportPlan; report: TickTickImportReport } {
    this.report.tasks = this.tasks.length;
    this.report.projects = this.projects.length;
    this.report.tags = this.tags.length;
    return { plan: { projects: this.projects, tags: this.tags, tasks: this.tasks }, report: this.report };
  }
}

/**
 * 通用 CSV：表头中英皆可。
 * 必需列：title（或 标题/任务/content）；其余可选。
 */
export function parseGenericCsv(text: string, options: CsvImportOptions): CsvImportResult {
  const { rows } = lexCsv(text);
  if (rows.length === 0) return { ok: false, reason: 'no-header', report: emptyReport() };
  const header = rows[0] ?? [];
  const titleCol = findColumn(header, ['title', '任务', '标题', 'content', 'name', '名称']);
  if (titleCol < 0) return { ok: false, reason: 'no-header', report: emptyReport() };
  const dueCol = findColumn(header, ['due', 'due date', 'duedate', '截止', '截止日期', 'date', '日期']);
  const timeCol = findColumn(header, ['time', '时间']);
  const noteCol = findColumn(header, ['note', '备注', 'description', '描述', '内容']);
  const priorityCol = findColumn(header, ['priority', '优先级']);
  const listCol = findColumn(header, ['list', 'list name', '清单', '项目', 'project', 'project name']);
  const tagsCol = findColumn(header, ['tags', 'tag', '标签']);
  const completedCol = findColumn(header, ['completed', '完成', 'done', 'completed at']);

  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''));
  const builder = new PlanBuilder(GENERIC_CSV_NAMESPACE, dataRows.length, options.now);

  dataRows.forEach((row, index) => {
    const dueRaw = cellAt(row, dueCol);
    const timeRaw = cellAt(row, timeCol);
    const due = parseDue(timeRaw !== '' ? `${dueRaw} ${timeRaw}` : dueRaw);
    const title = cellAt(row, titleCol);
    builder.addTask({
      sourceKey: `row:${String(index)}:${title.toLowerCase()}`,
      title,
      note: cellAt(row, noteCol),
      listName: cellAt(row, listCol),
      tags: parseTags(cellAt(row, tagsCol)),
      priority: parsePriority(cellAt(row, priorityCol)),
      due,
      completed: truthy(cellAt(row, completedCol)),
      rowIndex: index + 1,
      order: index,
    });
  });

  if (builder.tasks.length === 0 && builder.report.skipped.length === 0) {
    return { ok: false, reason: 'no-tasks', report: builder.report };
  }
  const done = builder.finish();
  return { ok: true, ...done };
}

/**
 * Todoist 导出 CSV：列名对大小写/空格不敏感。
 * 必需列：CONTENT；TYPE 非 task 的行跳过。
 */
export function parseTodoistCsv(text: string, options: CsvImportOptions): CsvImportResult {
  const { rows } = lexCsv(text);
  if (rows.length === 0) return { ok: false, reason: 'no-header', report: emptyReport() };
  const header = rows[0] ?? [];
  const typeCol = findColumn(header, ['type']);
  const contentCol = findColumn(header, ['content']);
  if (contentCol < 0) return { ok: false, reason: 'no-header', report: emptyReport() };
  const descCol = findColumn(header, ['description']);
  const priorityCol = findColumn(header, ['priority']);
  const dueCol = findColumn(header, ['due_date', 'due date', 'due']);
  const labelsCol = findColumn(header, ['labels']);
  const projectCol = findColumn(header, ['project_name', 'project name']);
  const completedCol = findColumn(header, ['is_completed', 'completed']);

  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''));
  const builder = new PlanBuilder(TODOIST_NAMESPACE, dataRows.length, options.now);

  dataRows.forEach((row, index) => {
    const type = cellAt(row, typeCol).toLowerCase();
    if (type !== '' && type !== 'task') {
      // 非任务（section/note）不进任务表，但也不算"坏行"——不计入 skipped。
      return;
    }
    const title = cellAt(row, contentCol);
    builder.addTask({
      sourceKey: `row:${String(index)}:${title.toLowerCase()}`,
      title,
      note: cellAt(row, descCol),
      listName: cellAt(row, projectCol),
      tags: parseTags(cellAt(row, labelsCol)),
      priority: parseTodoistPriority(cellAt(row, priorityCol)),
      due: parseDue(cellAt(row, dueCol)),
      completed: truthy(cellAt(row, completedCol)),
      rowIndex: index + 1,
      order: index,
    });
  });

  if (builder.tasks.length === 0 && builder.report.skipped.length === 0) {
    return { ok: false, reason: 'no-tasks', report: builder.report };
  }
  const done = builder.finish();
  return { ok: true, ...done };
}

/** 按来源分派。 */
export function parseCsvImport(kind: CsvImportKind, text: string, options: CsvImportOptions): CsvImportResult {
  return kind === 'todoist' ? parseTodoistCsv(text, options) : parseGenericCsv(text, options);
}
