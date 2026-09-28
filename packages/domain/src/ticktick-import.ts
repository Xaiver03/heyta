/**
 * 滴答清单（TickTick / dida365）导入 —— **领域逻辑层**
 * ==========================================================
 *
 * 把一份滴答的 CSV 备份变成 heyta 能直接写进 op-log 的**导入计划**
 * （`TickTickImportPlan`），并**如实报告跳过了什么、哪些字段没有归宿**。
 *
 * ## 它为什么在 `packages/domain`，而"写进去"为什么不在这里
 *
 * 「一份滴答备份里的每一行该变成什么」全是产品语义，而且每个宿主
 * （Web / 移动端 / CLI）都必须给出**一模一样**的答案 —— 这是 AGENTS.md §3.5
 * 的判据。放进任何一个 `apps/*`，下一个宿主就会再写一遍并漂移
 * （`import-dump.ts` 的文件头记着同一条教训）。
 *
 * 但"生成 op"这一步**刻意不在这里**：op 需要 `clientId` / `vectorClock` /
 * 线协议类型，那些是宿主与 op-log 的事（`packages/app-host` 的
 * `createTaskActions` 是既有形状）。domain 只产出一份**纯数据的计划**：
 * 稳定 id + 逐字段的值。app-host 把计划翻译成 op 时不需要再做任何业务判断。
 *
 * ## 🔴 幂等：稳定 id 是唯一判据
 *
 * 同一份文件导两次**不许**产生重复实体。做法是**确定性 id**：
 *
 *     id = tt1-<kind>-<fnv1a64(sourceKey)>
 *
 * `sourceKey` 只由文件内容派生，绝不掺时间戳、随机数、行号（除非文件里
 * 真的没有 `taskId`，那时见下）。于是同一份文件两次解析得到**逐字节相同**
 * 的计划；{@link mergeTickTickPlans} 按 id 去重，第二次全部落进 `skipped`。
 *
 * ⚠️ **没有 `taskId` 的行是一个已知的弱点**：它们的 `sourceKey` 只能回落到
 * **行序号**，于是"同一份文件里插了一行"会让后续行的身份整体平移、重新导入
 * 时就可能变成新实体。这不是可以糊弄过去的细节，所以每一行都会被记进
 * `report.unmapped` 的 `missingSourceId` —— 用户能在导入前就看到它。
 * 三个第三方实现都做了同样的回落（`row-<n>`），我们沿用并**把代价写在报告里**。
 *
 * ## 🔴 不静默丢数据：靠一条守恒律
 *
 * 每个数据行**要么**产出一条任务，**要么**出现在 `report.skipped` 里：
 *
 *     report.dataRows === report.tasks + report.skipped.length
 *
 * 这条等式是测试直接断言的判据（见 `ticktick-import.spec.ts`）。
 * 任何"遇到不认识的形状就 `continue`"的写法都会当场把它打破。
 *
 * 而"字段没有归宿"是另一种丢失，用 `report.unmapped` 记录：滴答有、heyta
 * 现在没有的字段（提醒、开始时间、子任务父子关系、看板分组……）**一个都不丢**，
 * 全部原值带进报告。heyta 的模型以后补上这些能力时，用户能从报告里找回原值。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ **本轮范围**：只做"文件 → 计划 + 报告"。把计划写成 op、界面入口、
 * 预览弹窗、撤销，全部留给后续刀（见 `docs/plans/site-and-parity-alignment.md`
 * 的 W5 / B2-1 记账）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { dueDateToEpoch } from './capture.js';
import { localDateTimeToEpoch, toLocalDate, type LocalDate } from './date.js';
import type { Priority } from './entities.js';
import {
  TICKTICK_COLUMNS,
  buildTickTickHeaderIndex,
  findTickTickHeaderRow,
  getTickTickCell,
  isTickTickStatusCompleted,
  isTickTickTrue,
  mapTickTickKind,
  mapTickTickPriority,
  mapTickTickRepeat,
  mapTickTickStatus,
  parseTickTickContent,
  toTickTickNumber,
} from './ticktick-format.js';

// ── 身份 ─────────────────────────────────────────────────────

/**
 * 稳定 id 的命名空间与格式版本。
 *
 * 🔴 改这个常量 = **换一套身份**：同一份文件再导入会生成全新的实体，
 * 于是"导两次不重复"立刻不成立。它只在"身份派生规则本身要改"时才动，
 * 且动的时候必须同时想清楚旧 id 怎么办。
 */
export const TICKTICK_IMPORT_ID_NAMESPACE = 'heyta:ticktick:v1';

/** 计划里三类实体的 kind 段（进 id）。 */
export type TickTickDraftKind = 'project' | 'tag' | 'task';

/** FNV-1a 32 位。用 `Math.imul` 保证 32 位溢出语义在 JS 里成立。 */
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 稳定 id。
 *
 * 用两个不同种子的 FNV-1a 拼成 16 位十六进制（≈64 位），而不是自研
 * "更好的"哈希：这里要的性质只有两条 —— **确定性**与**够低的碰撞率**，
 * 后者在"一个用户的一份备份"这个规模上绰绰有余。
 * 不用 `crypto.randomUUID`：那会立刻破坏幂等（且 domain 必须纯净）。
 */
export function stableTickTickId(namespace: string, kind: TickTickDraftKind, sourceKey: string): string {
  const a = fnv1a32(`${namespace}\u0000${kind}\u0000${sourceKey}`, 0x811c9dc5);
  const b = fnv1a32(`${namespace}\u0000${kind}\u0000${sourceKey}`, 0x9e3779b9);
  const hex = `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
  return `tt1-${kind}-${hex}`;
}

// ── 计划与报告 ───────────────────────────────────────────────

/** 一份待创建的清单（滴答的"文件夹"与"清单"都变成它）。 */
export interface TickTickProjectDraft {
  id: string;
  name: string;
  /** 文件夹下的清单：指向文件夹那条 draft 的 id。heyta 只支持一层。 */
  parentId?: string;
  /** 派生来源，`folder:<norm>` 或 `folder:<norm>/list:<norm>`。 */
  sourceKey: string;
  order: number;
}

/** 一份待创建的标签。heyta 的 `Tag` 只有名字，所以 id 由名字派生。 */
export interface TickTickTagDraft {
  id: string;
  name: string;
}

/** 一条待创建的任务。字段与 `Task` 对齐，但**不含** createdAt/updatedAt 之外的宿主痕迹。 */
export interface TickTickTaskDraft {
  id: string;
  title: string;
  note?: string;
  projectId?: string;
  tagIds?: string[];
  priority?: Priority;
  /** 截止时间（epoch ms）。日期型截止放在**本地零点**，与 `dueDateToEpoch` 同一约定。 */
  dueDate?: number;
  completedAt?: number;
  /** 不带 `RRULE:` 前缀的 RFC 5545 串（与 `Recurrence.daily()` 同形）。 */
  repeatRule?: string;
  /** 规则的锚点（本地日历日）。取导入时截止日的日历日。 */
  repeatDtstart?: LocalDate;
  order?: number;
  createdAt: number;
  updatedAt: number;
  sourceKey: string;
}

/** 一份完整的导入计划。app-host 把三类 draft 依次翻成 op 即可。 */
export interface TickTickImportPlan {
  projects: TickTickProjectDraft[];
  tags: TickTickTagDraft[];
  tasks: TickTickTaskDraft[];
}

/** 整行没有变成任务的原因。结构化，不是文案（词条表是唯一文案事实源）。 */
export type TickTickSkipReason =
  /** `Title` 为空。 */
  | 'empty-title'
  /** 同一份文件里 `taskId` 重复出现 —— 后面的按重复处理，不重复建实体。 */
  | 'duplicate-source-id';

export interface TickTickSkipEntry {
  reason: TickTickSkipReason;
  /** 数据行序号（1-based，从表头下一行算起）。 */
  rowIndex: number;
  title: string;
  detail?: string;
}

/**
 * 滴答有、而 heyta 当前模型**没有归宿**的字段/取值。
 *
 * 每一条都带原值。它的用途不是日志，是**导入预览**：用户应当在写进库之前
 * 就看到"这 3 条提醒带不进来"。所以它必须结构化（`field` + `value`），
 * 措辞由界面从词条表取。
 */
export type TickTickUnmappedField =
  /** `Reminder`：heyta 还没有提醒数据模型（B1-1 未做）。 */
  | 'reminder'
  /** `Start Date`：heyta 的 `Task` 只有 `dueDate`，没有开始时间。 */
  | 'startDate'
  /** `parentId`：heyta 的 `Task` 还没有 `parentId`（B1-3 未做），子任务被拍平成独立任务。 */
  | 'parentId'
  /** `Is Floating`：浮动时间（无时区）在 heyta 没有对应语义。 */
  | 'isFloating'
  /** `Column Name` / `Column Order` / `View Mode`：看板分组，heyta 无对应。 */
  | 'columnName'
  | 'columnOrder'
  | 'viewMode'
  /** `Timezone`：日期型截止被放在本地零点，滴答的时区被丢弃。 */
  | 'timezone'
  /** `Status=2`（归档/已完成）在 heyta 没有任务级归档，按已完成近似。 */
  | 'archiveStatus'
  /** 优先级取值不在离散表 `0/1/3/5` 里，用了阈值近似。 */
  | 'priority'
  /** 状态取值不认识，保守回落成"未完成"。 */
  | 'status'
  /** `Kind` 取值不认识，回落成 `TEXT`。 */
  | 'kind'
  /** 重复规则映射不了（或有多行、只取了第一行）。 */
  | 'repeat'
  /** 该行没有 `taskId`，身份只能回落到行序号 —— 幂等性因此变弱。 */
  | 'missingSourceId';

export interface TickTickUnmappedEntry {
  field: TickTickUnmappedField;
  rowIndex: number;
  title: string;
  value: string;
}

/** 导入报告。**它是产品输出的一部分，不是调试日志。** */
export interface TickTickImportReport {
  /** 表头之后、非全空的数据行数。 */
  dataRows: number;
  /** 实际会创建/合并的任务数。 */
  tasks: number;
  projects: number;
  tags: number;
  /** 被转成备注里 markdown 复选框的 checklist 项数。 */
  checklistItems: number;
  /** 带重复规则的任务数。 */
  recurringTasks: number;
  /** 已完成（含归档近似）的任务数。 */
  completedTasks: number;
  /** 整行没进来 —— 一条都不许静默消失。 */
  skipped: TickTickSkipEntry[];
  /** 字段/取值没有归宿 —— 原值全在这里。 */
  unmapped: TickTickUnmappedEntry[];
  skippedCounts: Partial<Record<TickTickSkipReason, number>>;
  unmappedCounts: Partial<Record<TickTickUnmappedField, number>>;
}

export type TickTickParseFailure =
  /** 找不到表头行（含必需的 `Title` 与 `List Name`）。 */
  | 'no-header'
  /** 表头在、但一条可导入的任务都没有。 */
  | 'no-tasks';

export type TickTickParseResult =
  | { ok: true; plan: TickTickImportPlan; report: TickTickImportReport }
  | { ok: false; reason: TickTickParseFailure; detail?: string; report: TickTickImportReport };

/** `parseTickTickCsv` 的选项。 */
export interface TickTickImportOptions {
  /**
   * 导入时刻的 epoch ms。**由调用方给**，函数保持纯。
   *
   * 对齐 `export-dump.ts` 的 `exportedAt`：领域层读 `Date.now()` 会让
   * 同一份文件在不同时刻产出不同的计划，幂等判据就没法写了。
   * 只在滴答没给 `Created Time` 时用作回落。
   */
  now: number;
  /** 稳定 id 命名空间。默认 {@link TICKTICK_IMPORT_ID_NAMESPACE}。 */
  idNamespace?: string;
}

// ── CSV 词法 ─────────────────────────────────────────────────

export interface CsvLexResult {
  rows: string[][];
  /** 文件在引号里结束（最后一个引号没闭合）。原始 CSV 讲了，只有一处明说。 */
  unclosedQuote: boolean;
}

/**
 * RFC 4180 风格的 CSV 词法拆分。**纯函数**。
 *
 * 为什么不自研"更好的"：这里被 `parser.py` 与 DidaTask 两处独立实现验证过的
 * 同一套规则就是这一套 —— 引号包裹、`""` 转义、引号内逗号与换行都是数据。
 * DidaTask 的实现与本函数逐条同形（它就是手写的同一个循环）。
 *
 * ⚠️ 不处理"字段内裸 `\r`"的极端情况之外的花样；遇到未闭合引号**不抛错**，
 * 而是把已读到的内容交出去并置 `unclosedQuote` —— 丢掉整份文件比降级解析更糟。
 */
export function lexCsv(text: string, delimiter = ','): CsvLexResult {
  // BOM：Windows 导出的 CSV 常见，留在第一个列名里会让表头匹配失败。
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let unclosedQuote = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char === '\r') {
      // `\r\n` 与裸 `\r` 都当行结束；不要在字段里保留它，
      // 否则同一个标题在 Windows 导出里会多一个不可见字符，id 就不同了。
      if (source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (inQuotes) unclosedQuote = true;
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return { rows, unclosedQuote };
}

// ── 日期 ─────────────────────────────────────────────────────

/** 滴答的时间戳偏移**没有冒号**（`+0000`），`Date.parse` 需要它。 */
function normalizeTickTickOffset(value: string): string {
  return value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}

const DATE_ONLY_PATTERN = /^(\d{4}-\d{2}-\d{2})/;

export interface TickTickDateMapping {
  epoch?: number;
  /** 日期型才有（本地日历日）。 */
  localDate?: LocalDate;
  /** 值非空但解析不了。调用方要报告它 —— 不许静默变成"没有截止日"。 */
  unparsable: boolean;
}

/**
 * 滴答日期 → epoch ms。
 *
 * 🔴 三条语义，逐条都有理由：
 *
 *   1. **日期型（`Is All Day=Y` 或值本身就是 `YYYY-MM-DD`）→ 本地零点。**
 *      与 `dueDateToEpoch` 同一约定。理由是 heyta 的"今天"视图按本地日历日
 *      比对（`quadrant.ts` / `task-filter.ts`），用 UTC 零点会让 UTC+8 的用户
 *      在 08:00 之前看到"今天到期"跑到昨天去。
 *   2. **带偏移的时刻 → 精确时刻。** `Date.parse` 认得偏移，结果与宿主时区无关。
 *   3. **无偏移的时刻 → 墙上时间。** 走 `localDateTimeToEpoch`（仓库唯一的
 *      本地时间实现），**绝不静默修正**。
 *
 * ⚠️ 第 1 条**丢弃 `Timezone` 列**：滴答用"日期 + 时区"表达"那一天"，
 * 而我们只有本地日历日。这个丢弃会被调用方记进 `timezone` 报告。
 */
export function mapTickTickDate(value: string, isAllDay: boolean): TickTickDateMapping {
  const trimmed = value.trim();
  if (trimmed === '') return { unparsable: false };

  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(trimmed);
  const treatAsDateOnly = isAllDay || trimmed.length === 10;

  if (treatAsDateOnly && dateOnlyMatch !== null) {
    const localDate = dateOnlyMatch[1] as LocalDate;
    try {
      return { epoch: dueDateToEpoch(localDate), localDate, unparsable: false };
    } catch {
      return { unparsable: true };
    }
  }

  const normalized = normalizeTickTickOffset(trimmed);
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) {
    const epoch = Date.parse(normalized);
    if (!Number.isFinite(epoch)) return { unparsable: true };
    return { epoch, localDate: toLocalDate(epoch), unparsable: false };
  }

  const epoch = localDateTimeToEpoch(normalized);
  if (epoch === undefined) {
    // `YYYY-MM-DD` 之外还可能是纯日期（被上面的分支拦掉了）或无法识别的文本。
    if (dateOnlyMatch !== null) {
      const localDate = dateOnlyMatch[1] as LocalDate;
      try {
        return { epoch: dueDateToEpoch(localDate), localDate, unparsable: false };
      } catch {
        return { unparsable: true };
      }
    }
    return { unparsable: true };
  }
  return { epoch, localDate: toLocalDate(epoch), unparsable: false };
}

/** 时刻型时间戳（`Created Time` / `Completed Time`）→ epoch ms。 */
export function mapTickTickTimestamp(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const normalized = normalizeTickTickOffset(trimmed);
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) {
    const epoch = Date.parse(normalized);
    return Number.isFinite(epoch) ? epoch : undefined;
  }
  return localDateTimeToEpoch(normalized);
}

// ── sourceKey 规范化 ─────────────────────────────────────────

/** 名字 → sourceKey 片段：小写、非字母数字折叠成 `-`。 */
function normalizeSourcePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** 清单的 sourceKey：`folder:<x>/list:<y>`；无文件夹时 `folder:/list:<y>`。 */
export function tickTickProjectSourceKey(folderName: string, listName: string): string {
  const folder = normalizeSourcePart(folderName);
  const list = normalizeSourcePart(listName);
  return `folder:${folder}/list:${list}`;
}

/** 文件夹的 sourceKey。 */
export function tickTickFolderSourceKey(folderName: string): string {
  return `folder:${normalizeSourcePart(folderName)}`;
}

/** 标签解析：`,` / `，` / `;` 分隔，剥前导 `#`，去空、去重（保序）。 */
export function parseTickTickTags(value: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of value.split(/[,;，、]/u)) {
    const name = part.trim().replace(/^#+/u, '').trim();
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

// ── 报告构造 ─────────────────────────────────────────────────

function emptyReport(): TickTickImportReport {
  return {
    dataRows: 0,
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

function bump<T extends string>(counts: Partial<Record<T, number>>, key: T): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

// ── 解析 ─────────────────────────────────────────────────────

/** 全空行（所有单元格去空白后为空）不算数据行。 */
function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === '');
}

/**
 * 一份滴答 CSV 备份 → 导入计划 + 报告。**纯函数**：不读时钟、不碰存储。
 */
export function parseTickTickCsv(text: string, options: TickTickImportOptions): TickTickParseResult {
  const namespace = options.idNamespace ?? TICKTICK_IMPORT_ID_NAMESPACE;
  const report = emptyReport();
  const { rows } = lexCsv(text);

  const headerRowIndex = findTickTickHeaderRow(rows);
  if (headerRowIndex === -1) {
    return {
      ok: false,
      reason: 'no-header',
      detail: `需要一个同时含「${TICKTICK_COLUMNS.title}」与「${TICKTICK_COLUMNS.listName}」的表头行`,
      report,
    };
  }

  const headerIndex = buildTickTickHeaderIndex(rows[headerRowIndex] ?? []);
  const cell = (row: readonly string[], column: string): string =>
    getTickTickCell(row, headerIndex, column);

  const projects: TickTickProjectDraft[] = [];
  const projectIds = new Set<string>();
  const tags: TickTickTagDraft[] = [];
  const tagIds = new Set<string>();
  const tasks: TickTickTaskDraft[] = [];
  const seenTaskKeys = new Set<string>();

  let rowIndex = 0;
  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    if (isBlankRow(row)) continue;
    rowIndex += 1;
    report.dataRows += 1;

    const title = cell(row, TICKTICK_COLUMNS.title).trim();
    if (title === '') {
      report.skipped.push({
        reason: 'empty-title',
        rowIndex,
        title: '',
        detail: cell(row, TICKTICK_COLUMNS.listName).trim(),
      });
      bump(report.skippedCounts, 'empty-title');
      continue;
    }

    // ── 清单 / 文件夹 ──
    const folderName = cell(row, TICKTICK_COLUMNS.folderName).trim();
    const listName = cell(row, TICKTICK_COLUMNS.listName).trim();

    let folderId: string | undefined;
    if (folderName !== '') {
      const sourceKey = tickTickFolderSourceKey(folderName);
      folderId = stableTickTickId(namespace, 'project', sourceKey);
      if (!projectIds.has(folderId)) {
        projectIds.add(folderId);
        projects.push({ id: folderId, name: folderName, sourceKey, order: projects.length });
      }
    }

    // `List Name` 为空 = 收集箱（heyta 用"没有 projectId"表达它）。
    // **不编造一个回落清单名**：编出来的名字是用户可见文案，得走词条表，
    // 而这里连 i18n 都不该碰。收件箱是更忠实的映射。
    let projectId: string | undefined;
    let projectSourceKey = 'inbox';
    if (listName !== '') {
      projectSourceKey = tickTickProjectSourceKey(folderName, listName);
      projectId = stableTickTickId(namespace, 'project', projectSourceKey);
      if (!projectIds.has(projectId)) {
        projectIds.add(projectId);
        projects.push({
          id: projectId,
          name: listName,
          sourceKey: projectSourceKey,
          order: projects.length,
          ...(folderId !== undefined ? { parentId: folderId } : {}),
        });
      }
    }

    // ── 标签 ──
    const tagNames = parseTickTickTags(cell(row, TICKTICK_COLUMNS.tags));
    const taskTagIds: string[] = [];
    for (const name of tagNames) {
      const id = stableTickTickId(namespace, 'tag', name);
      taskTagIds.push(id);
      if (!tagIds.has(id)) {
        tagIds.add(id);
        tags.push({ id, name });
      }
    }

    // ── 身份 ──
    const sourceTaskId = cell(row, TICKTICK_COLUMNS.taskId).trim();
    if (sourceTaskId === '') {
      report.unmapped.push({
        field: 'missingSourceId',
        rowIndex,
        title,
        value: '',
      });
      bump(report.unmappedCounts, 'missingSourceId');
    }
    const taskSourceKey = `${projectSourceKey}:${sourceTaskId !== '' ? sourceTaskId : `row-${rowIndex}`}`;
    if (seenTaskKeys.has(taskSourceKey)) {
      report.skipped.push({
        reason: 'duplicate-source-id',
        rowIndex,
        title,
        detail: sourceTaskId,
      });
      bump(report.skippedCounts, 'duplicate-source-id');
      continue;
    }
    seenTaskKeys.add(taskSourceKey);

    // ── 优先级 ──
    const priorityMapping = mapTickTickPriority(cell(row, TICKTICK_COLUMNS.priority));
    if (!priorityMapping.exact) {
      report.unmapped.push({
        field: 'priority',
        rowIndex,
        title,
        value: priorityMapping.raw,
      });
      bump(report.unmappedCounts, 'priority');
    }

    // ── 状态 / 完成时间 ──
    const statusMapping = mapTickTickStatus(cell(row, TICKTICK_COLUMNS.status));
    if (!statusMapping.exact) {
      report.unmapped.push({ field: 'status', rowIndex, title, value: statusMapping.raw });
      bump(report.unmappedCounts, 'status');
    }
    if (statusMapping.status === 'archived') {
      report.unmapped.push({ field: 'archiveStatus', rowIndex, title, value: statusMapping.raw });
      bump(report.unmappedCounts, 'archiveStatus');
    }
    const completedAt = mapTickTickTimestamp(cell(row, TICKTICK_COLUMNS.completedTime));
    const createdTime = mapTickTickTimestamp(cell(row, TICKTICK_COLUMNS.createdTime));
    const createdAt = createdTime ?? options.now;
    const updatedAt = completedAt ?? createdTime ?? options.now;
    const isCompleted = isTickTickStatusCompleted(statusMapping.status) || completedAt !== undefined;

    // ── 日期 ──
    const isAllDay = isTickTickTrue(cell(row, TICKTICK_COLUMNS.isAllDay));
    const dueMapping = mapTickTickDate(cell(row, TICKTICK_COLUMNS.dueDate), isAllDay);
    if (dueMapping.epoch !== undefined) {
      const timezone = cell(row, TICKTICK_COLUMNS.timezone).trim();
      if (timezone !== '' && dueMapping.localDate !== undefined && isAllDay) {
        report.unmapped.push({ field: 'timezone', rowIndex, title, value: timezone });
        bump(report.unmappedCounts, 'timezone');
      }
    }

    // ── 重复 ──
    const repeatMapping = mapTickTickRepeat(cell(row, TICKTICK_COLUMNS.repeat));
    if (!repeatMapping.exact) {
      report.unmapped.push({ field: 'repeat', rowIndex, title, value: repeatMapping.raw });
      bump(report.unmappedCounts, 'repeat');
    }

    // ── 类型（只影响 checklist 判定；取值不认识的仍按内容里有没有标记决定） ──
    const kindMapping = mapTickTickKind(cell(row, TICKTICK_COLUMNS.kind));
    if (!kindMapping.exact) {
      report.unmapped.push({ field: 'kind', rowIndex, title, value: kindMapping.raw });
      bump(report.unmappedCounts, 'kind');
    }

    // ── 正文 / checklist ──
    const content = parseTickTickContent(cell(row, TICKTICK_COLUMNS.content));
    report.checklistItems += content.items.length;

    // ── 没有归宿的字段：原值带进报告 ──
    const reminder = cell(row, TICKTICK_COLUMNS.reminder).trim();
    if (reminder !== '') {
      report.unmapped.push({ field: 'reminder', rowIndex, title, value: reminder });
      bump(report.unmappedCounts, 'reminder');
    }
    const startDate = cell(row, TICKTICK_COLUMNS.startDate).trim();
    if (startDate !== '') {
      report.unmapped.push({ field: 'startDate', rowIndex, title, value: startDate });
      bump(report.unmappedCounts, 'startDate');
    }
    const parentId = cell(row, TICKTICK_COLUMNS.parentId).trim();
    if (parentId !== '') {
      // 子任务**不丢**：它被拍平成一条独立任务（heyta 的 Task 还没有 parentId）。
      report.unmapped.push({ field: 'parentId', rowIndex, title, value: parentId });
      bump(report.unmappedCounts, 'parentId');
    }
    if (isTickTickTrue(cell(row, TICKTICK_COLUMNS.isFloating))) {
      const value = cell(row, TICKTICK_COLUMNS.isFloating).trim();
      report.unmapped.push({ field: 'isFloating', rowIndex, title, value });
      bump(report.unmappedCounts, 'isFloating');
    }
    const columnName = cell(row, TICKTICK_COLUMNS.columnName).trim();
    if (columnName !== '') {
      report.unmapped.push({ field: 'columnName', rowIndex, title, value: columnName });
      bump(report.unmappedCounts, 'columnName');
    }
    const columnOrderRaw = cell(row, TICKTICK_COLUMNS.columnOrder).trim();
    const columnOrder = toTickTickNumber(columnOrderRaw, -1);
    if (columnOrderRaw !== '' && columnOrder >= 0) {
      report.unmapped.push({ field: 'columnOrder', rowIndex, title, value: columnOrderRaw });
      bump(report.unmappedCounts, 'columnOrder');
    }
    const viewMode = cell(row, TICKTICK_COLUMNS.viewMode).trim();
    if (viewMode !== '') {
      report.unmapped.push({ field: 'viewMode', rowIndex, title, value: viewMode });
      bump(report.unmappedCounts, 'viewMode');
    }

    // ── 组装 ──
    const orderRaw = cell(row, TICKTICK_COLUMNS.order).trim();
    const order = orderRaw === '' ? rowIndex - 1 : toTickTickNumber(orderRaw, rowIndex - 1);

    const draft: TickTickTaskDraft = {
      id: stableTickTickId(namespace, 'task', taskSourceKey),
      title,
      sourceKey: taskSourceKey,
      createdAt,
      updatedAt,
      order,
      ...(content.note !== undefined ? { note: content.note } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
      ...(taskTagIds.length > 0 ? { tagIds: taskTagIds } : {}),
      ...(priorityMapping.priority !== undefined ? { priority: priorityMapping.priority } : {}),
      ...(dueMapping.epoch !== undefined ? { dueDate: dueMapping.epoch } : {}),
      ...(isCompleted ? { completedAt: completedAt ?? updatedAt } : {}),
      ...(repeatMapping.repeatRule !== undefined ? { repeatRule: repeatMapping.repeatRule } : {}),
      ...(repeatMapping.repeatRule !== undefined && dueMapping.localDate !== undefined
        ? { repeatDtstart: dueMapping.localDate }
        : {}),
    };

    tasks.push(draft);
    report.tasks += 1;
    if (draft.repeatRule !== undefined) report.recurringTasks += 1;
    if (draft.completedAt !== undefined) report.completedTasks += 1;
  }

  report.projects = projects.length;
  report.tags = tags.length;

  if (tasks.length === 0) {
    return { ok: false, reason: 'no-tasks', report };
  }

  return { ok: true, plan: { projects, tags, tasks }, report };
}

// ── 合并（幂等的判据点） ─────────────────────────────────────

export interface TickTickMergeCounts {
  projects: number;
  tags: number;
  tasks: number;
}

export interface TickTickMergeResult {
  /** 合并后的计划。 */
  plan: TickTickImportPlan;
  added: TickTickMergeCounts;
  /** 因为稳定 id 已经存在而**没有**重复创建的。同一份文件导两次时全在这里。 */
  skipped: TickTickMergeCounts;
}

/**
 * 把新解析的计划并进一份已有的计划。
 *
 * 去重判据**只有一条**：稳定 id 是否已经出现过。这正是幂等成立的原因 ——
 * 同一份文件两次解析出的 id 逐字节相同，所以第二次 `added` 全 0。
 *
 * ⚠️ `existing` 在这里被当成"已经导进库里的东西"。真正的宿主还会用
 * **实体自己的 id** 去重（比如用户手工建的清单恰好撞 id）；这一层只保证
 * "同一份滴答文件导两次不重复"这条判据，那是本模块的职责边界。
 */
export function mergeTickTickPlans(
  existing: TickTickImportPlan,
  incoming: TickTickImportPlan,
): TickTickMergeResult {
  const plan: TickTickImportPlan = {
    projects: [...existing.projects],
    tags: [...existing.tags],
    tasks: [...existing.tasks],
  };
  const projectIds = new Set(existing.projects.map((draft) => draft.id));
  const tagIds = new Set(existing.tags.map((draft) => draft.id));
  const taskIds = new Set(existing.tasks.map((draft) => draft.id));

  const added: TickTickMergeCounts = { projects: 0, tags: 0, tasks: 0 };
  const skipped: TickTickMergeCounts = { projects: 0, tags: 0, tasks: 0 };

  for (const draft of incoming.projects) {
    if (projectIds.has(draft.id)) {
      skipped.projects += 1;
      continue;
    }
    projectIds.add(draft.id);
    plan.projects.push(draft);
    added.projects += 1;
  }
  for (const draft of incoming.tags) {
    if (tagIds.has(draft.id)) {
      skipped.tags += 1;
      continue;
    }
    tagIds.add(draft.id);
    plan.tags.push(draft);
    added.tags += 1;
  }
  for (const draft of incoming.tasks) {
    if (taskIds.has(draft.id)) {
      skipped.tasks += 1;
      continue;
    }
    taskIds.add(draft.id);
    plan.tasks.push(draft);
    added.tasks += 1;
  }

  return { plan, added, skipped };
}

/** 空计划（宿主第一次导入时的起点）。 */
export function emptyTickTickPlan(): TickTickImportPlan {
  return { projects: [], tags: [], tasks: [] };
}
