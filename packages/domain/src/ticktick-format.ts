/**
 * 滴答清单（TickTick / dida365）CSV 备份**格式**的唯一事实源
 * =================================================================
 *
 * 这里只放"这份外来文件长什么样"的知识：列名、表头识别、枚举映射、
 * checklist 标记、重复规则前缀。**投什么、丢什么、怎么报**在
 * `ticktick-import.ts`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 为什么枚举映射必须集中在这一个文件里
 *
 * 滴答的优先级是 `0 / 1 / 3 / 5`（0=无、1=低、3=中、5=高），**不是连续整数**；
 * 状态是 `0 / 1 / 2`，而 `2` 的含义说法不一。这类"外来枚举 → 我们的枚举"的
 * 映射如果散在解析、预览、界面三处，任何一处改口径都会让另外两处
 * **静默给出不同的结果**（AGENTS.md #4/#7 反复记过的形状）。
 *
 * 所以：**只在这里定义一次**，解析器只调这里的函数。
 * `ticktick-import.spec.ts` 里有一条判据专门钉"改这里会红"。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 事实来源与核实程度（写清楚，免得下一个 agent 当成官方规格）
 *
 * 下面每条都标了核实程度。**未核实的不许升格成事实**：
 *
 * | 事实 | 依据 | 程度 |
 * |---|---|---|
 * | 列名全集（24 列） | ticktickmd `parser.py` 的 DictReader key 全集 | 实测（第三方解析器逐列读取） |
 * | 同一列名全集 | DidaTask-Data-Dashboard `public/app.js` 注释 + 逐列取值 | 实测（第三方独立实现，逐列一致） |
 * | 同一列名全集 | Mindwtr `ticktick-import.ts` 的 `getCell(row, ..., 'X')` | 实测（第三方独立实现，逐列一致） |
 * | 表头**不在第一行**（前面有元数据行） | Mindwtr 文件头 + DidaTask 注释「前 6 行为元数据，第 7 行为表头」 | 实测（两处独立描述；**第几行不固定**，所以只能搜索表头） |
 * | 优先级 `0/1/3/5` | DidaTask `PRIORITY_MAP` + ticktickmd `Priority` 枚举 + Mindwtr 阈值 | 实测（三处一致） |
 * | 状态 `0=未完成 / 1=已完成 / 2=已完成或归档` | DidaTask 注释 + ticktickmd `TaskStatus` + Mindwtr `resolveTaskStatus` | 实测（三处一致；**`2` 是"归档"还是"已完成"三处说法不完全统一**，见下） |
 * | checklist 标记 `▫`(U+25AB) / `▪`(U+25AA) | ticktickmd `generator.py` + Mindwtr 常量 | 实测（两处独立一致） |
 * | `Content` 里 checklist 项**无换行拼接** | ticktickmd README「TickTick concatenates list items without newlines」 | 实测（一处明说，一处按标记切分） |
 * | 重复规则以 `RRULE:` 开头 | ticktickmd README 举例 `RRULE:FREQ=DAILY` | 实测（一处举例） |
 * | 时间戳形如 `2025-12-27T03:57:34+0000`（**无冒号**的偏移） | ticktickmd `parse_datetime` 的格式串 | 实测（一处明说，Mindwtr 也专门做了偏移补冒号） |
 * | 中文版（dida365）与中国版列名完全相同 | 上表"DidaTask"一列就是 dida365 的实现 | 实测 |
 *
 * ⚠️ **未核实（不许当事实用）：**
 *   - 滴答**服务端真实**的枚举取值空间（上面是从第三方解析器反推的，
 *     不是官方规格；官方 Open API 文档本次取不到 —— `developer.ticktick.com`
 *     返回 404）。
 *   - `Status=2` 到底是"归档"还是"已完成"：三处来源一致地把它算作**已完成**，
 *     但 ticktickmd 叫它 `ARCHIVED`、DidaTask 直接当已完成。本文件按
 *     "已完成 + 记为近似"处理（见 `TickTickStatus` 注释）。
 *   - `View Mode` / `Column Name` / `Column Order` 的**取值词表**（只知列名，
 *     不知有哪些值）。
 *   - `Reminder` 列的**语法**（只知它是一个文本列，本次没有拿到样例）。
 *   - 是否所有版本的备份都带 `taskId` / `parentId`（`taskId`/`parentId` 在所有
 *     三个实现里都是**可选读**，说明至少有过没有它们的版本）。
 */

import { Priority } from './entities.js';
import { isValidRecurrenceRule } from './recurrence.js';

/**
 * 滴答备份 CSV 的列名。
 *
 * ⚠️ 大小写与空白**不完全统一**（`taskId` / `parentId` 是驼峰，
 * `Is Check list` 里"Check list"中间有空格）。所以所有查找都走
 * {@link buildTickTickHeaderIndex}（归一化后再比），**不要直接
 * `row['taskId']`**。
 */
export const TICKTICK_COLUMNS = {
  folderName: 'Folder Name',
  listName: 'List Name',
  title: 'Title',
  kind: 'Kind',
  tags: 'Tags',
  content: 'Content',
  isChecklist: 'Is Check list',
  startDate: 'Start Date',
  dueDate: 'Due Date',
  reminder: 'Reminder',
  repeat: 'Repeat',
  priority: 'Priority',
  status: 'Status',
  createdTime: 'Created Time',
  completedTime: 'Completed Time',
  order: 'Order',
  timezone: 'Timezone',
  isAllDay: 'Is All Day',
  isFloating: 'Is Floating',
  columnName: 'Column Name',
  columnOrder: 'Column Order',
  viewMode: 'View Mode',
  taskId: 'taskId',
  parentId: 'parentId',
} as const;

/** 列名的联合类型。 */
export type TickTickColumn = (typeof TICKTICK_COLUMNS)[keyof typeof TICKTICK_COLUMNS];

/**
 * 表头行必须同时含有的列。
 *
 * 判据刻意用**两列**而不是"第 7 行"：元数据行数在不同版本里会变，
 * 而"同时有 Title 与 List Name"这件事三份独立实现都当作表头判据。
 *
 * ⚠️ 没把 `Content` 之类的加进必需集：这三份实现里 ticktickmd 只按
 * `"Folder Name"` 定位、DidaTask 按 `Title`+`List Name`、Mindwtr 按
 * `TITLE`+`LIST NAME`。取**共同的最小集**最不容易误拒真文件。
 */
export const TICKTICK_REQUIRED_COLUMNS: readonly string[] = [
  TICKTICK_COLUMNS.title,
  TICKTICK_COLUMNS.listName,
];

/** 表头单元格归一化：去空白 + 转小写。列名比对只走这一条路。 */
export function normalizeTickTickHeader(cell: string): string {
  return cell.trim().toLowerCase();
}

/** 表头行 → 「归一化列名 → 下标」。 */
export function buildTickTickHeaderIndex(row: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();
  row.forEach((cell, position) => {
    const key = normalizeTickTickHeader(cell);
    // 重复列名取**第一次**出现的位置：后出现的多半是导出器追加的兼容列。
    if (key !== '' && !index.has(key)) index.set(key, position);
  });
  return index;
}

/** 该表头是否满足必需列。 */
export function isTickTickHeaderRow(row: readonly string[]): boolean {
  const index = buildTickTickHeaderIndex(row);
  return TICKTICK_REQUIRED_COLUMNS.every((column) => index.has(normalizeTickTickHeader(column)));
}

/**
 * 在行里找表头。
 *
 * ⚠️ 返回 `-1` = 这不是滴答备份。**不要**回落到"假定第一行是表头" ——
 * 那会把元数据行当成列名，然后产出一份"0 条任务"的**假成功**。
 */
export function findTickTickHeaderRow(rows: readonly string[][]): number {
  return rows.findIndex((row) => isTickTickHeaderRow(row));
}

/** 取一行的某列（列名归一化比对）。找不到该列返回 `''`。 */
export function getTickTickCell(
  row: readonly string[],
  headerIndex: ReadonlyMap<string, number>,
  column: string,
): string {
  const position = headerIndex.get(normalizeTickTickHeader(column));
  if (position === undefined) return '';
  return row[position] ?? '';
}

// ── 真值 / 数字 ──────────────────────────────────────────────

/** 滴答的布尔列取值：`Y` / `true` / `1` / `yes`（大小写不敏感）。 */
export function isTickTickTrue(value: string): boolean {
  return /^(?:y|yes|true|1)$/i.test(value.trim());
}

/** 取整数；不合法回落到 `fallback`。**绝不抛错**（外来文件不该让导入炸）。 */
export function toTickTickNumber(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (trimmed === '') return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── 优先级 ───────────────────────────────────────────────────

/**
 * 滴答优先级 → heyta 优先级。**离散取值表，不是阈值**。
 *
 * 滴答只有 `0 / 1 / 3 / 5` 四个取值（三份独立实现一致）。写成表而不是
 * `<`/`>=` 阈值链，是为了让"滴答真的有 2 或 4 吗"这个未知量**显式暴露**：
 * 不在表里的取值走 {@link mapTickTickPriority} 的近似分支并被报告。
 */
export const TICKTICK_PRIORITY_MAP: Readonly<Record<string, Priority>> = {
  '0': Priority.None,
  '1': Priority.Low,
  '3': Priority.Medium,
  '5': Priority.High,
};

export interface TickTickPriorityMapping {
  /** `undefined` = 无优先级（滴答的 `0`）。 */
  priority: Priority | undefined;
  /** `true` = 走了离散表；`false` = 表里没有，用了近似或干脆没映射。 */
  exact: boolean;
  /** 原始文本，报告里要原样带出去。 */
  raw: string;
}

/**
 * 优先级映射。
 *
 * 表里没有时用阈值近似（`>=5` 高、`>=3` 中、`>=1` 低、其余无），
 * 这是三份实现里逻辑最完整的那份的形状；但**必须标成近似**，
 * 由调用方记进"跳过了什么"的报告里 —— 近似不许装成精确。
 */
export function mapTickTickPriority(value: string): TickTickPriorityMapping {
  const raw = value.trim();
  if (raw === '') return { priority: undefined, exact: true, raw };

  const exact = TICKTICK_PRIORITY_MAP[raw];
  if (exact !== undefined) {
    return { priority: exact === Priority.None ? undefined : exact, exact: true, raw };
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return { priority: undefined, exact: false, raw };
  if (numeric >= 5) return { priority: Priority.High, exact: false, raw };
  if (numeric >= 3) return { priority: Priority.Medium, exact: false, raw };
  if (numeric >= 1) return { priority: Priority.Low, exact: false, raw };
  return { priority: undefined, exact: false, raw };
}

// ── 完成状态 ─────────────────────────────────────────────────

/**
 * 滴答任务状态。
 *
 * `open` = 未完成（滴答 `0`）。
 * `completed` = 已完成（滴答 `1`）。
 * `archived` = 滴答 `2`。⚠️ 含义**未核实**：三份实现都把它算作"已完成"，
 *   但名字上像"归档"。heyta 的 `Task` **没有**任务级归档字段
 *   （只有 `Project.archived`），所以这里映射成"已完成"并**记为近似**，
 *   由调用方报告 —— 不许悄悄当成普通已完成。
 */
export type TickTickStatus = 'open' | 'completed' | 'archived';

/** 滴答状态 → 我们认识的状态。 */
export const TICKTICK_STATUS_MAP: Readonly<Record<string, TickTickStatus>> = {
  '0': 'open',
  '1': 'completed',
  '2': 'archived',
};

export interface TickTickStatusMapping {
  status: TickTickStatus;
  /** `false` = 取值不在表里，回落成了 `open`（保守：不假装完成）。 */
  exact: boolean;
  raw: string;
}

/**
 * 状态映射。
 *
 * 不认识的取值一律回落 `open` 并标 `exact: false`：把一个"不知道是什么"
 * 的任务当已完成的后果（用户以为事情做完了）比当未完成严重得多。
 */
export function mapTickTickStatus(value: string): TickTickStatusMapping {
  const raw = value.trim();
  if (raw === '') return { status: 'open', exact: true, raw };

  const status = TICKTICK_STATUS_MAP[raw];
  if (status !== undefined) return { status, exact: true, raw };
  return { status: 'open', exact: false, raw };
}

/** 状态是否算"这件事已经做完了"。`archived` 也算（见类型注释）。 */
export function isTickTickStatusCompleted(status: TickTickStatus): boolean {
  return status === 'completed' || status === 'archived';
}

// ── 任务类型 ─────────────────────────────────────────────────

/** 滴答任务类型（`Kind` 列）。 */
export type TickTickKind = 'TEXT' | 'NOTE' | 'CHECKLIST';

export const TICKTICK_KIND_MAP: Readonly<Record<string, TickTickKind>> = {
  TEXT: 'TEXT',
  NOTE: 'NOTE',
  CHECKLIST: 'CHECKLIST',
};

export function mapTickTickKind(value: string): { kind: TickTickKind; exact: boolean; raw: string } {
  const raw = value.trim();
  if (raw === '') return { kind: 'TEXT', exact: true, raw };
  const kind = TICKTICK_KIND_MAP[raw.toUpperCase()];
  if (kind !== undefined) return { kind, exact: true, raw };
  return { kind: 'TEXT', exact: false, raw };
}

// ── checklist 内容 ───────────────────────────────────────────

/**
 * 滴答 checklist 的项标记。
 *
 * ⚠️ 是**几何图形字符**而不是 `- [ ]`：`▫`(U+25AB) 未勾选、`▪`(U+25AA) 已勾选。
 * 两处独立实现（ticktickmd `generator.py`、Mindwtr 常量）逐字一致。
 *
 * 🔴 滴答把 checklist 项**无换行拼接**在 `Content` 里，所以这些标记同时是
 * **分隔符**。少认一个标记，两项会粘成一项（静默丢结构，不丢文字 ——
 * 但仍是我们不该犯的错）。
 */
export const TICKTICK_CHECKLIST_MARKERS = {
  unchecked: '\u25ab',
  checked: '\u25aa',
} as const;

export interface TickTickChecklistItem {
  title: string;
  completed: boolean;
}

export interface TickTickContentParse {
  /** 正文（markdown）。checklist 项已转成 `- [ ]` / `- [x]`；空则 `undefined`。 */
  note: string | undefined;
  /** 解析出的 checklist 项。非 checklist 任务为空数组。 */
  items: TickTickChecklistItem[];
  /** 内容里是否真的出现了标记。 */
  hadMarkers: boolean;
}

/**
 * `Content` → 正文 + checklist 项。**纯函数**。
 *
 * 规则（对齐 ticktickmd 的 `convert_checklist_content`）：
 *   - marker 之前、以及 marker 之间的文本按出现顺序保留；
 *   - marker 起一项，`▫` 未完成、`▪` 已完成；
 *   - 输出 markdown 复选框，于是 `Task.note`（markdown 备注）能原样渲染。
 *
 * 🔴 一条文字都不许丢：marker 前的前言也作为普通段落保留。
 */
export function parseTickTickContent(raw: string): TickTickContentParse {
  const text = raw.replace(/\r\n?/g, '\n');
  const unchecked = TICKTICK_CHECKLIST_MARKERS.unchecked;
  const checked = TICKTICK_CHECKLIST_MARKERS.checked;
  const hadMarkers = text.includes(unchecked) || text.includes(checked);

  if (!hadMarkers) {
    const note = text.trim();
    return { note: note === '' ? undefined : note, items: [], hadMarkers: false };
  }

  const items: TickTickChecklistItem[] = [];
  const noteLines: string[] = [];
  let buffer = '';
  let current: TickTickChecklistItem | undefined;

  const flush = (): void => {
    if (current === undefined) return;
    const title = buffer.trim();
    if (title !== '') items.push({ title, completed: current.completed });
    buffer = '';
  };

  for (const char of text) {
    if (char === unchecked || char === checked) {
      flush();
      // 🔴 前言必须止步于第一个 marker：`flush()` 在 `current === undefined`
      // 时会保留 `buffer`，所以这里显式清一次，否则前言会粘进第一项。
      buffer = '';
      current = { title: '', completed: char === checked };
      continue;
    }
    buffer += char;
  }
  flush();

  // 前言：第一个 marker 之前的内容。用 indexOf 而不是在循环里分叉 ——
  // 循环只负责"项怎么切"，前言怎么留是另一件事。
  const firstMarker = Math.min(
    ...[text.indexOf(unchecked), text.indexOf(checked)].filter((at) => at >= 0),
  );
  const preamble = text.slice(0, firstMarker).trim();
  if (preamble !== '') noteLines.push(preamble);

  for (const item of items) {
    noteLines.push(`- [${item.completed ? 'x' : ' '}] ${item.title}`);
  }

  const note = noteLines.join('\n').trim();
  return { note: note === '' ? undefined : note, items, hadMarkers: true };
}

// ── 重复规则 ─────────────────────────────────────────────────

/**
 * 滴答重复规则 → heyta 的 RRULE。
 *
 * heyta 的 `Task.repeatRule` 存的是**不带 `RRULE:` 前缀**的 RFC 5545 串
 * （见 `Recurrence.daily()` 的返回值）。滴答带 `RRULE:` 前缀，所以要剥掉。
 *
 * 合法性判断复用 `recurrence.ts` 的 `isValidRecurrenceRule` —— 那是本仓库
 * 唯一的 RRULE 判据，**不要在这里再写一个**（两份解析器必然在某个边缘分叉）。
 */
export function mapTickTickRepeat(value: string): {
  repeatRule: string | undefined;
  exact: boolean;
  raw: string;
} {
  const raw = value.replace(/\r\n?/g, '\n');
  // 滴答可能给出多行（Mindwtr 逐行取第一条非空行）。取第一条；
  // 其余行**不静默吞掉** —— 由调用方把整段原始值带进报告。
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');

  if (firstLine === undefined) return { repeatRule: undefined, exact: true, raw: '' };

  const stripped = firstLine.replace(/^RRULE:/i, '').trim();
  const mapped = isValidRecurrenceRule(stripped);
  // 只有恰好一行且映射成功才算"精确"；多行意味着丢了后续规则，必须报告。
  const singleLine = raw.split('\n').filter((line) => line.trim() !== '').length === 1;
  if (!mapped) return { repeatRule: undefined, exact: false, raw };
  return { repeatRule: stripped, exact: singleLine, raw };
}
