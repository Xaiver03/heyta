/**
 * 导出：把本地数据变成一份能被带走、能被核对的文档
 * ==================================================
 *
 * 这个文件兑现 `README.md` 设计原则第 5 条（**导出自由**）与订阅到期提示里
 * 对用户的承诺 ——「本地数据仍然可以正常查看、编辑和**导出**」。
 *
 * 🔴 **为什么序列化器在 `packages/app-host` 而不是 `apps/web`：**
 *
 * "导出的内容是什么形状"是**产品语义**，不是平台差异（AGENTS.md §3.5）。
 * 具体地，下面每一条都是判断，而且每一个宿主都必须给出**一模一样**的答案：
 *
 *   - 导出里放哪几类实体？（漏一类 = 用户以为带走了全部，其实没有）
 *   - 已删除的记录要不要带走？（丢掉墓碑的"备份"根本无法完整还原）
 *   - 计数怎么算？（用户拿什么核对"导出真的是完整的"）
 *   - 文档格式自己的版本号从哪来、和 schema 版本是不是一回事？
 *
 * 这些判断放进 `apps/web`，下一个宿主（移动端、CLI）就会再写一遍并漂移 ——
 * 而那正是 §3.5 反复记过的形状。所以这里是**零运行时依赖的纯函数**，
 * 宿主只负责把「物化状态 + op-log + 时间戳」递进来。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **已删除的记录必须出现在导出里。**
 *
 * op-log 用墓碑（`deletedAt`）表达删除，而不是物理删除（见
 * `packages/op-log/src/state.ts`）。一个悄悄丢掉墓碑的导出：
 *
 *   1. **无法被完整还原** —— 重放时"删除"这个事实凭空消失，被删的数据会复活；
 *   2. **用户看不到自己丢了什么** —— 导出说"全都在"，而那些行根本没进去。
 *
 * 所以墓碑是**内容**，不是可以顺手过滤掉的噪声。`buildTaskExportRows()` 里那处
 * `aliveRecords()` 只服务**给人看的任务清单**（一个人不想在清单里看到已删任务），
 * 两条路径的差别由测试钉住。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { dueLocalDateOf, localTimeOf, type LocalTime, type Priority, type Task } from '@heyta/domain';
import { bucketFor, type MaterializedState } from '@heyta/op-log';
import { CURRENT_SCHEMA_VERSION, ENTITY_TYPES } from '@heyta/shared-schema';
import type { Operation } from '@heyta/sync-core';

import { aliveRecords } from './category-report.js';
import type { AppHost } from './host.js';

/**
 * 导出格式**自己**的版本号。
 *
 * 🔴 **它不是 `CURRENT_SCHEMA_VERSION`，两者不能混为一谈。**
 *
 *   - `CURRENT_SCHEMA_VERSION`（`packages/shared-schema`）= **op / 线协议**的版本，
 *     动它要走 ADR 与迁移链，近乎单向。
 *   - 本常量 = **这个导出文档**的版本。它只描述"这份 JSON 自己长什么样"。
 *
 * 两者的变化频率完全无关：导出格式可以加字段（比如加一个校验和）而
 * schema 一动不动；反过来 schema bump 也不必然改导出格式。合成一个数字，
 * 将来任何一边的演进都会误伤另一边。
 */
export const EXPORT_FORMAT_VERSION = 1;

/** `app` 标识里的应用名。品牌名是拉丁词，**不是文案**（见 `check:ui-language`）。 */
export const EXPORT_APP_NAME = 'heyta';

/** 一类实体在导出里的计数，**含墓碑**。 */
export interface ExportEntityCount {
  /** 该实体的总条数（含已删除）。 */
  total: number;
  /** 其中带 `deletedAt` 的墓碑条数。 */
  deleted: number;
}

/**
 * 导出文档的计数区。
 *
 * 🔴 这是"导出能证明自己完整"的地方：用户/测试核对 `totalOps` 与 `opLog.length`、
 * 核对每类实体条数，而不是只能相信导出没有悄悄少东西。
 */
export interface ExportCounts {
  /** 实体类型 → 计数。键与 `entities` 一一对应。 */
  entities: Record<string, ExportEntityCount>;
  /** 跨实体的记录总数（含墓碑）。 */
  totalEntities: number;
  /** 跨实体的墓碑总数。 */
  totalDeleted: number;
  /** op-log 条数。 */
  totalOps: number;
  /** op 按实体类型计数（含未物化实体 —— 它们只在 op-log 里存在）。 */
  opsByEntityType: Record<string, number>;
}

/** 一份自描述的导出文档。`serializeExportDocument()` 保证确定性序列化。 */
export interface ExportDocument {
  /** 本导出格式的版本。**不是** `CURRENT_SCHEMA_VERSION`。 */
  formatVersion: number;
  /** 应用标识（谁导出的）。`host` 是宿主名，仅作诊断。 */
  app: { name: string; host?: string };
  /** 导出时刻（ISO 8601）。由调用方传入的时间戳派生，不读 `Date.now()`。 */
  exportedAt: string;
  /** op / 线协议的 schema 版本。 */
  schemaVersion: number;
  /**
   * 物化状态里的全部实体，按实体类型分组，**含墓碑**。
   *
   * ⚠️ 只覆盖 `bucketFor()` 认识的（即被 reducer 物化的）实体类型。
   * 其它合法但未物化的实体（`REMINDER` 等）的内容仍完整存在于 `opLog` 里 ——
   * 所以"导全了"这句话对**整份文档**成立，而不是对 `entities` 单独成立。
   */
  entities: Record<string, unknown[]>;
  /** **完整** op-log，按 `(timestamp, id)` 确定性排序。 */
  opLog: Operation<string>[];
  /** 计数区。见 {@link ExportCounts}。 */
  counts: ExportCounts;
}

/**
 * 一份**只声明 op-log** 的还原文档：`entities` 与实体计数缺省，由导入器用
 * **客户端那份 reducer** 物化。
 *
 * 🔴 为什么要有这一格，而不是让产出方自己把 `entities` 填上：
 * 恢复工具（`server/scripts/recover-user.ts`）手里只有服务端 replay 的结果，而两层对
 * `DEL` 的语义**不一致且各自都有注释**：服务端是 `delete state[type][id]`
 * （`server/src/sync/op-replay.ts` 的 `case 'DEL'`），客户端是 field-level tombstone
 * （`packages/op-log/src/state.ts` 里那句 *"must be materialized even when the create
 * has not arrived yet, otherwise an out-of-order replay can resurrect the entity"*）。
 * 让服务端那一份去填 `entities`，产物就**结构上不可能有墓碑** —— 恢复出来的设备上
 * 用户回收站里的东西全没了，而对端那条活体会被当成"本机缺的"再同步回来（正是上面那句
 * 注释防的事）。所以这里不是"允许少写一个字段"，是**把实体交给唯一有权物化它的那一层**：
 * 还原本来就靠重放 op-log 得到状态（见 `import-dump.ts` 文件头），`entities` 只用来核对。
 *
 * ⚠️ 代价必须说清：文件不再自己声明一份实体，写之前那次"两个来源交叉"就少了一个来源
 * （`restoreIntoEmptyTarget` 第 2 步）。剩下的真判据是**写完之后再重放一次比对**，
 * 它仍然抓得住半截导入 / 引擎物化漂移。
 */
export interface RestoreDocument extends Omit<ExportDocument, 'entities' | 'counts'> {
  /** 缺省 ⇒ 由导入器用客户端 reducer 从 `opLog` 物化。 */
  entities?: Record<string, unknown[]>;
  /** 只有 `totalOps` 是必填的（它是唯一能被 op-log 自己证明的计数）。 */
  counts: Pick<ExportCounts, 'totalOps'> & Partial<Omit<ExportCounts, 'totalOps'>>;
}

/** `buildExportDocument()` 的输入。 */
export interface BuildExportOptions {
  /** 物化状态（宿主从 `engine.getState()` 拿）。 */
  state: MaterializedState;
  /** 完整 op-log（宿主从存储读）。顺序任意，这里会重新确定性排序。 */
  ops: readonly Operation<string>[];
  /** 导出时刻的 epoch ms。**由调用方给**，使函数保持纯。 */
  exportedAt: number;
  /** 宿主名（`'web'` / `'node'` / …），仅用于 `app.host`。 */
  host?: string;
}

/**
 * 物化状态 + op-log → 导出文档。**纯函数**：不读时钟、不碰存储、不改入参。
 */
export function buildExportDocument(options: BuildExportOptions): ExportDocument {
  const entities: Record<string, unknown[]> = {};
  const entityCounts: Record<string, ExportEntityCount> = {};
  let totalEntities = 0;
  let totalDeleted = 0;

  // 按 ENTITY_TYPES 的**声明顺序**（而不是对象插入顺序）遍历，
  // 好让同样的数据永远产出同样的 key 顺序。
  for (const entityType of ENTITY_TYPES) {
    const bucket = bucketFor(options.state, entityType);
    // 未物化的实体类型在这里返回 undefined —— 跳过，但它们的 op 仍在 opLog 里。
    if (bucket === undefined) continue;

    // ⚠️ **不滤墓碑。** 这是本文件的核心纪律，见文件头。
    const records = Object.values(bucket).sort(byEntityId);
    entities[entityType] = records;

    const deleted = records.filter(isTombstone).length;
    entityCounts[entityType] = { total: records.length, deleted };
    totalEntities += records.length;
    totalDeleted += deleted;
  }

  // op 的顺序不能依赖存储/调用方给的顺序 —— 那正是"确定性"要挡的东西。
  const ops = [...options.ops].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
  );

  const opCounts: Record<string, number> = {};
  for (const op of ops) {
    opCounts[op.entityType] = (opCounts[op.entityType] ?? 0) + 1;
  }

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    app:
      options.host === undefined
        ? { name: EXPORT_APP_NAME }
        : { name: EXPORT_APP_NAME, host: options.host },
    exportedAt: new Date(options.exportedAt).toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    entities,
    opLog: ops,
    counts: {
      entities: entityCounts,
      totalEntities,
      totalDeleted,
      totalOps: ops.length,
      // key 排序，保证确定性（见 `serializeExportDocument` 的同一理由）
      opsByEntityType: Object.fromEntries(
        Object.keys(opCounts)
          .sort()
          .map((key) => [key, opCounts[key] ?? 0]),
      ),
    },
  };
}

/**
 * 从宿主读全量数据并构造导出文档。
 *
 * 这是给**非 Web 宿主**（CLI 等）的便利入口：它只做"读 + 调纯函数"，
 * 自己不判断导出内容。Web 宿主因为用的是另一条接线（`apps/web/src/lib/oplog.ts`），
 * 直接调 {@link buildExportDocument}。
 *
 * 🔴 `exportedAt` 仍然由调用方给 —— 不在这里读 `Date.now()`，
 * 否则这个函数就不可测了。
 */
export async function exportDocumentFromHost(
  host: AppHost,
  options: { exportedAt: number; host?: string },
): Promise<ExportDocument> {
  return buildExportDocument({
    state: host.getState(),
    ops: await host.readOpLog(),
    exportedAt: options.exportedAt,
    ...(options.host !== undefined ? { host: options.host } : {}),
  });
}

/**
 * 序列化成**确定性** JSON：递归按 key 排序后 `JSON.stringify`。
 *
 * `JSON.stringify` 本身依赖对象的插入顺序，而 op 的 `payload` 来自 reducer 的
 * 展开合并 —— 同样的数据在不同路径下可能得到不同的 key 顺序。对"备份/对账"
 * 这类用途，两份内容相同的导出应当逐字节相同，否则没法用哈希比对。
 *
 * 数组**保持原序**（实体与 op 已经在上游排好）。
 */
export function serializeExportDocument(doc: ExportDocument): string {
  return JSON.stringify(sortKeysDeep(doc), null, 2);
}

/** 导出格式。`json` = 完整保真，`markdown` = 人能直接打开看。 */
export type ExportFormat = 'json' | 'markdown';

/**
 * 导出文件名。**纯函数**，宿主不该自己拼日期格式。
 *
 * 用 ISO 时间戳（把 `:` 与 `.` 换成 `-`，好让它是合法的文件名），
 * 于是同一秒里导两次不会互相覆盖得很隐蔽，文件也天然按时间排序。
 */
export function exportFileName(format: ExportFormat, exportedAt: number): string {
  const stamp = new Date(exportedAt).toISOString().replace(/[:.]/g, '-');
  return `heyta-export-${stamp}.${format === 'json' ? 'json' : 'md'}`;
}

// ── 人能直接看的那一份（任务清单） ─────────────────────────────

/**
 * 任务清单里的一行。
 *
 * 这是"人类可读导出"的**内容形状**（产品语义），所以它在这里而不在界面里；
 * 界面只负责把这些行渲染成 Markdown 并翻译表头。
 */
export interface ExportTaskRow {
  id: string;
  title: string;
  completed: boolean;
  /** 本地日期 `YYYY-MM-DD`（时区语义来自宿主，复用 `toLocalDateString`）。 */
  dueDate?: string;
  /**
   * 本地时刻 `HH:MM`，**没有时刻（"只到日"）时整个键缺席**。
   *
   * 🔴 为什么必须有这一栏：`toLocalDateString` 是**有损**的 —— 它只留日。
   * 一条"明天 16:00"的任务在没有 `dueTime` 的清单里会被写成"明天"，
   * 而清单看起来是完整的：用户看不出丢了什么，核对的人也看不出导出少了一栏。
   * 这类"静默有损"正是本文件开头对墓碑的那条纪律要防的东西。
   */
  dueTime?: LocalTime;
  priority?: Priority;
  projectName?: string;
  /** 已解析成名字并排序。 */
  tagNames: string[];
  createdAt: number;
}

/**
 * 物化状态 → 任务行（**只含未删除的任务**）。
 *
 * 🔴 这里滤墓碑是**对的，而且只在这里**：给人看的清单里出现已删任务是噪声。
 * 完整保真那一份（`buildExportDocument`）绝不能滤 —— 两条路径的差别有测试钉住。
 */
export function buildTaskExportRows(state: MaterializedState): ExportTaskRow[] {
  return aliveRecords(state.tasks)
    .map((task) => toExportTaskRow(task, state))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function toExportTaskRow(task: Task, state: MaterializedState): ExportTaskRow {
  const project = task.projectId === undefined ? undefined : state.projects[task.projectId];
  const tagNames = (task.tagIds ?? [])
    .map((id) => state.tags[id]?.name)
    .filter((name): name is string => name !== undefined)
    .sort();
  // 🔴 只算一次：`localTimeOf` 与 `isAllDue` 的互斥性由领域层保证，
  //   这里不许自己再判"零点不算时刻"—— 那就是第二套判据（AGENTS §3.5）。
  const dueTime = task.dueDateLocal !== undefined || task.dueDate === undefined
    ? undefined : localTimeOf(task.dueDate);
  const dueDay = dueLocalDateOf(task);

  return {
    id: task.id,
    title: task.title,
    completed: task.completedAt !== undefined,
    ...(dueDay !== undefined ? { dueDate: dueDay } : {}),
    ...(dueTime === undefined ? {} : { dueTime }),
    ...(task.priority !== undefined ? { priority: task.priority } : {}),
    ...(project !== undefined ? { projectName: project.name } : {}),
    tagNames,
    createdAt: task.createdAt,
  };
}

/**
 * Markdown 清单的**结构文字**。
 *
 * 🔴 为什么不在这里写死中英文：词条表是唯一文案事实源（AGENTS.md）。
 * 于是分工是 —— **格式（有哪些列、怎么排版）在这里**，
 * **措辞（表头、页脚怎么写）由调用方从词条表取**。这与
 * `packages/app-host` 的 AI 失败态（返回 `reason`，壳取词条）是同一条纪律。
 */
export interface TasksMarkdownCopy {
  /** 一级标题行，例如 `# heyta 任务清单`。 */
  heading: string;
  /** 生成时间行模板，`{at}` 会被替换成 ISO 时间。 */
  generatedAt: string;
  /** 没有任务时的占位句。 */
  empty: string;
  /** 完成状态：未完成。 */
  open: string;
  /** 完成状态：已完成。 */
  done: string;
  /** 空单元格占位符。 */
  none: string;
  /** 页脚（诚实地说明这是导出、不能导回来）。 */
  footer: string;
  columns: {
    title: string;
    status: string;
    due: string;
    priority: string;
    project: string;
    tags: string;
  };
  /** 优先级 → 本地化措辞。 */
  priorityLabel: (priority: Priority) => string;
}

/** 任务行 → Markdown 文本。**纯函数**，给定输入输出逐字节相同。 */
export function renderTasksMarkdown(
  rows: readonly ExportTaskRow[],
  copy: TasksMarkdownCopy,
  exportedAtIso: string,
): string {
  const lines: string[] = [copy.heading, '', copy.generatedAt.replace('{at}', exportedAtIso), ''];

  if (rows.length === 0) {
    lines.push(copy.empty, '');
  } else {
    const columns = copy.columns;
    lines.push(
      `| ${columns.title} | ${columns.status} | ${columns.due} | ${columns.priority} | ` +
        `${columns.project} | ${columns.tags} |`,
    );
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const row of rows) {
      // 「截止」这一栏**不加第二列**：日 + 时刻合成一个单元格（`2026-10-04 16:00`），
      // 没时刻时逐字节还是旧的那一份。列数变了会同时改掉表头分隔行与所有
      // 既有断言，而产品上要的只是"时刻别丢"。
      const due =
        row.dueDate === undefined
          ? copy.none
          : row.dueTime === undefined
            ? row.dueDate
            : `${row.dueDate} ${row.dueTime}`;
      const cells = [
        row.title,
        row.completed ? copy.done : copy.open,
        due,
        row.priority === undefined ? copy.none : copy.priorityLabel(row.priority),
        row.projectName ?? copy.none,
        row.tagNames.length === 0 ? copy.none : row.tagNames.join(', '),
      ];
      lines.push(`| ${cells.map(escapeCell).join(' | ')} |`);
    }
    lines.push('');
  }

  lines.push(`> ${copy.footer}`);
  return `${lines.join('\n')}\n`;
}

/** Markdown 表格单元格里的 `|` 与换行必须转义，否则表格会被撑坏。 */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function byEntityId(
  a: Record<string, unknown> & { updatedAt?: number },
  b: Record<string, unknown> & { updatedAt?: number },
): number {
  return String(a['id'] ?? '').localeCompare(String(b['id'] ?? ''));
}

function isTombstone(record: Record<string, unknown>): boolean {
  return record['deletedAt'] !== undefined;
}

/**
 * 递归按 key 排序。
 *
 * ⚠️ `null` 要单独挡掉：`typeof null === 'object'`，不挡会把 null 变成 `{}`。
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    sorted[key] = sortKeysDeep(source[key]);
  }
  return sorted;
}
