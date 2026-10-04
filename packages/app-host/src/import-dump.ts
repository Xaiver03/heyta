/**
 * 导入 / 还原：把一份导出文档变回本机数据
 * ============================================
 *
 * 这个文件兑现 `README.md` 设计原则第 5 条（**导出自由**）的另一半 ——
 * 在那之前，`export-dump.ts` 造出来的文件只能出、不能回，
 * 界面与 Markdown 页脚都写着"这是导出，还不是还原点"。
 *
 * 🔴 **为什么产品语义在 `packages/app-host` 而不是 `apps/*`：**
 *
 * "一份导出文件能不能被接受、导进哪里、怎么保证结果与导出逐项一致"
 * 全是判断，而且每个宿主都必须给出**一模一样**的答案（AGENTS.md §3.5）。
 * 放进 `apps/web`，下一个宿主（CLI、移动端）就会再写一遍并漂移。
 * 所以这里是零运行时依赖的纯函数 + 一条把判断串起来的编排；宿主只负责
 * "选文件 / 读文本 / 给一个存储目标"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 本轮的范围：**只做「还原到空库」，不做「合并到已有数据的库」**
 *
 * 这是唯一一个在动手前就想清楚、且必须写下来的决定。
 *
 * **两种语义的风险不对称：**
 *
 * | | 还原到空库 | 合并到已有数据的库 |
 * |---|---|---|
 * | 用户意图 | "把这份备份变回我的数据" | "把两份数据拼起来" |
 * | id 冲突 | 不可能（目标为空） | 必然：同一 id 在两份数据里可能都改了 |
 * | 时钟/顺序 | 只需要"并进导出日志里的全部时钟" | 还要判断"两边谁更新" |
 * | 出错后果 | 结果是导出时的状态 | 可能静默丢掉本地或导入的一端 |
 *
 * 合并需要的三件事本轮**一件都没有可靠答案**：
 *
 *   1. **id 冲突的判定** —— 本地已有同 id 实体时，是覆盖、保留本地，
 *      还是按 `updatedAt` 择一？三条路都会在某个场景下丢掉用户的编辑。
 *   2. **时钟/op 顺序** —— 导入的 op 与本地已接受的 op 之间没有共同因果历史，
 *      `compareVectorClocks` 只会给出 `CONCURRENT`，于是每一对都退化成
 *      LWW + `clientId` 决胜 —— 而"谁赢"取决于随机 id 与墙上时钟，不是用户意图。
 *   3. **"本地已有更新版本"的判定** —— 这是第 2 条的具体后果，本轮没有可信判据。
 *
 * 做对一半好过糊弄两种。**合并被明确拒绝，而不是"暂时没实现"**：
 * 拒绝的理由是"它会静默丢数据"，那是一个产品结论，不是排期问题。
 *
 * ## 🔴 导入**绝不**清空或覆盖现有数据
 *
 * `restoreIntoEmptyTarget()` 在写任何东西**之前**先数目标 op-log（含归档）：
 * 只要里面**有任何一条 op**，就返回 `target-not-empty` 并**什么都不写**。
 * 所以"导入把用户数据清了"这条路径在代码里根本不存在 —— 不是靠界面拦，
 * 而是靠这里拦。界面还会再确认一次（见 `ImportPanel`），那是第二道。
 *
 * ## 结果必须与导出"逐项一致"，包括"哪些是被删掉的"
 *
 * 导出里含墓碑是**故意的**（见 `export-dump.ts` 文件头）：op-log 用
 * `deletedAt` 表示删除，丢掉墓碑的"备份"回放时已删数据会复活。
 * 所以还原走的是**重放导出里的完整 op-log**，而不是把 `entities` 写进状态 ——
 * `DEL` op 重放后天然得到墓碑，已删记录不会复活。`entities` 只用来**核对**。
 *
 * 核对分两次，都在下面：
 *   - **写之前**：`replayOperations(导出.opLog)` 必须与 `导出.entities` /
 *     `导出.counts` 逐项一致。不一致 = 这份文件被改坏了 / 半截 —— 直接拒绝，
 *     **一个字节都不写**。
 *   - **写之后**：本机物化状态必须与 `导出.entities` 逐项一致，
 *     否则报 `verification-failed` 而不是"成功"。
 *
 * 🔴 **`entities` 可以缺省**（{@link RestoreDocument}）：缺省时实体由**上面那份客户端
 * reducer** 从 `opLog` 物化，再拿它当核对基准。这专门给恢复工具那条路 ——
 * 服务端对 `DEL` 是 `delete`，客户端是 field-level tombstone，让服务端那一半来填
 * `entities` 会产出**没有墓碑**的产物（见 `export-dump.ts` 里那段说明）。
 * ⚠️ 代价必须写清：文件自己不声明实体时，**写之前那次交叉少了一个独立来源**
 * （它变成"重放 == 重放"，恒真）；此时真正还有牙的是**写之后**那次比对
 * （本机引擎物化 vs 纯重放的结果），半截导入 / 引擎漂移仍然会被抓住。
 */

import { MODELED_ENTITY_TYPES, bucketFor, emptyState, replayOperations } from '@heyta/op-log';
import type { MaterializedState } from '@heyta/op-log';
import { CURRENT_SCHEMA_VERSION } from '@heyta/shared-schema';
import { OpType, type Operation } from '@heyta/sync-core';

import {
  EXPORT_APP_NAME,
  EXPORT_FORMAT_VERSION,
  type ExportDocument,
  type RestoreDocument,
} from './export-dump.js';

/**
 * 导入/还原被拒绝的原因。
 *
 * 🔴 它是**结构化**的，不是一句文案：词条是唯一文案事实源（AGENTS.md），
 * 所以这里只回 `reason`，界面/CLI 自己取词条。
 */
export type ExportImportFailureReason =
  /** 不是合法 JSON。 */
  | 'invalid-json'
  /** 是 JSON，但形状不对（缺字段、字段类型不对、op 形状不对）。 */
  | 'invalid-document'
  /** 这不是 heyta 的导出文件。 */
  | 'wrong-application'
  /** 导出格式版本不认识（可能来自更新的版本）。 */
  | 'unsupported-format-version'
  /** op / 线协议 schema 版本不同 —— 跨版本还原本轮不做。 */
  | 'unsupported-schema-version'
  /** 文档**自相矛盾**：重放它的 op-log 得不到它自己声称的 entities/counts。 */
  | 'inconsistent-document'
  /** 目标是**空库**才能还原，而它已经有数据了。 */
  | 'target-not-empty'
  /** 写完之后结果与导出对不上（不该发生，但必须能被观测到）。 */
  | 'verification-failed';

/** `parseExportDocument()` 的结果。 */
export type ParseExportResult =
  | { ok: true; document: RestoreDocument }
  | { ok: false; reason: ExportImportFailureReason; detail?: string };

/** `restoreIntoEmptyTarget()` 的结果。 */
export type RestoreExportResult =
  | {
      ok: true;
      /** 真正写进日志的 op 条数。 */
      importedOps: number;
      /** 因为已存在而跳过的 op 条数（同一份导出导两次时全在这里）。 */
      skippedOps: number;
      /** 还原后的记录总数（含墓碑）。 */
      entities: number;
      /** 其中已删除的条数 —— 它必须与导出里的一致。 */
      deleted: number;
    }
  | { ok: false; reason: ExportImportFailureReason; detail?: string };

/**
 * 还原要落到的目标。
 *
 * `AppHost` **结构上**满足它（`engine.countStoredOps`），所以宿主直接把 host 传进来；
 * `apps/web` 没有 AppHost 对象，就传一个 `{ engine }` 的薄适配 —— 引擎自己就能数。
 * 刻意收窄而不是要求完整 `AppHost`：还原只该看到"库里有多少条""写进去""状态是什么"。
 *
 * 🔴 以前这里要的是 `readOpLog()`（读**全库**）。空库守卫只需要一个 `> 0`，
 * 却把用户正要保护的那份数据连密文正文一起搬进内存数一遍 —— 每次点"还原"付一次。
 * 换成计数之后，接口上**没有**能把全库读回来的口子了，这条成本就不可能再被引进来。
 */
export interface ImportTarget {
  engine: {
    importOperations(ops: readonly Operation<string>[]): Promise<{ imported: number; skipped: number }>;
    getState(): MaterializedState;
    /** 全库条数（热区 + 归档），不物化任何一行。 */
    countStoredOps(): Promise<number>;
  };
}

// ── 解析 ────────────────────────────────────────────────────

/**
 * 文本 → 导出文档。**纯函数**：不碰存储、不写任何东西。
 *
 * 它只做**形状与版本**的校验，不做"内容是否自洽"的判定 ——
 * 那需要重放整个 op-log，属于 {@link restoreIntoEmptyTarget}（也刻意在写之前）。
 */
export function parseExportDocument(text: string): ParseExportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid-document', detail: '顶层不是对象' };
  }

  const raw = parsed as Record<string, unknown>;

  if (raw['formatVersion'] !== EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      reason: 'unsupported-format-version',
      detail: `formatVersion=${String(raw['formatVersion'])}（本机支持 ${String(EXPORT_FORMAT_VERSION)}）`,
    };
  }

  const app = raw['app'];
  if (
    app === null ||
    typeof app !== 'object' ||
    (app as Record<string, unknown>)['name'] !== EXPORT_APP_NAME
  ) {
    return { ok: false, reason: 'wrong-application' };
  }

  if (raw['schemaVersion'] !== CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'unsupported-schema-version',
      detail: `schemaVersion=${String(raw['schemaVersion'])}（本机支持 ${String(CURRENT_SCHEMA_VERSION)}）`,
    };
  }

  // `entities` **可以整格缺省**（恢复工具那类"只交 op-log"的产物，实体由本机的
  // 客户端 reducer 物化）。但**给了就必须是"类型 → 数组"**：`entities: null`
  // 与 `entities: []` 都是坏文件，不许被当成"没给"放过去 —— 放过去的代价是
  // 一份被截断/改坏的产物会走到"由 ops 自己物化"那条路上，而那条路的写前交叉是恒真的。
  const entities = raw['entities'];
  if (entities !== undefined) {
    if (entities === null || typeof entities !== 'object' || Array.isArray(entities)) {
      return { ok: false, reason: 'invalid-document', detail: 'entities 不是对象' };
    }
    for (const [entityType, rows] of Object.entries(entities as Record<string, unknown>)) {
      if (!Array.isArray(rows)) {
        return { ok: false, reason: 'invalid-document', detail: `entities.${entityType} 不是数组` };
      }
    }
  }

  const counts = raw['counts'];
  if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) {
    return { ok: false, reason: 'invalid-document', detail: 'counts 不是对象' };
  }

  const opLog = raw['opLog'];
  if (!Array.isArray(opLog)) {
    return { ok: false, reason: 'invalid-document', detail: 'opLog 不是数组' };
  }
  for (const op of opLog) {
    const bad = invalidOpReason(op);
    if (bad !== undefined) return { ok: false, reason: 'invalid-document', detail: bad };
  }

  // 计数必须与数组长度自洽 —— 否则"导全了/还原全了"这些数字本身不可信。
  if ((counts as Record<string, unknown>)['totalOps'] !== opLog.length) {
    return {
      ok: false,
      reason: 'inconsistent-document',
      detail: `counts.totalOps=${String((counts as Record<string, unknown>)['totalOps'])} 与 opLog 长度 ${String(opLog.length)} 不符`,
    };
  }

  return { ok: true, document: raw as unknown as RestoreDocument };
}

/** 一条 op 的形状校验。返回 `undefined` 表示合法。 */
function invalidOpReason(op: unknown): string | undefined {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) return 'opLog 里有非对象元素';
  const record = op as Record<string, unknown>;

  if (typeof record['id'] !== 'string' || record['id'] === '') return '某条 op 缺少 id';
  if (typeof record['clientId'] !== 'string' || record['clientId'] === '') {
    return `op ${String(record['id'])} 缺少 clientId`;
  }
  if (typeof record['entityType'] !== 'string' || record['entityType'] === '') {
    return `op ${String(record['id'])} 缺少 entityType`;
  }
  if (typeof record['timestamp'] !== 'number' || !Number.isFinite(record['timestamp'])) {
    return `op ${String(record['id'])} 的 timestamp 不是数字`;
  }
  // opType 词表只有一份（sync-core 的 OpType）—— 不认识就拒绝，不要自造词。
  if (!isKnownOpType(record['opType'])) {
    return `op ${String(record['id'])} 的 opType「${String(record['opType'])}」不在词表里`;
  }
  const clock = record['vectorClock'];
  if (clock === null || typeof clock !== 'object' || Array.isArray(clock)) {
    return `op ${String(record['id'])} 的 vectorClock 不是对象`;
  }
  for (const value of Object.values(clock as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `op ${String(record['id'])} 的 vectorClock 含非数字分量`;
    }
  }
  return undefined;
}

function isKnownOpType(value: unknown): boolean {
  return typeof value === 'string' && (Object.values(OpType) as string[]).includes(value);
}

// ── 还原 ────────────────────────────────────────────────────

/**
 * 把一份导出文档还原到**空**目标。
 *
 * 三种拒绝都不会写任何东西：
 *   - `target-not-empty` —— 目标已有 op（**绝不清空用户数据**）。
 *   - `inconsistent-document` —— 重放导出 op-log 得不到它自己声称的状态。
 *   - `verification-failed` 是写之后才可能出现的，它意味着**真的发生了异常**，
 *     此时数据已经在库里 —— 如实上报，不要谎报成功。
 */
export async function restoreIntoEmptyTarget(
  target: ImportTarget,
  document: RestoreDocument,
): Promise<RestoreExportResult> {
  // 1. 目标必须真的是空库。**这一步在写任何东西之前。**
  const existing = await target.engine.countStoredOps();
  if (existing > 0) {
    return {
      ok: false,
      reason: 'target-not-empty',
      detail: `本机已有 ${String(existing)} 条操作日志`,
    };
  }

  // 2. 写之前先证明这份文件自洽：重放它的 op-log 必须得到它自己声称的
  //    entities 与 counts。不一致 = 文件被改坏/半截 —— 一个字节都不写。
  //
  //    `entities` 缺省时核对基准由**客户端 reducer** 物化（见文件头那段：这正是
  //    "恢复产物丢墓碑"的修法），此时第 2 步退化成恒真，还有牙的是第 4 步。
  const replayed = replayOperations(emptyState(), document.opLog);
  const reference = referenceOf(document, replayed);
  if (!stateMatchesDocument(replayed, reference)) {
    return { ok: false, reason: 'inconsistent-document' };
  }

  // 3. 追加 + 从完整日志重建状态与时钟（墓碑随 DEL op 一起重放，不会复活）。
  const result = await target.engine.importOperations(document.opLog);

  // 4. 写完之后再核对一次。对不上就必须报失败，而不是"看起来成功了"。
  const after = target.engine.getState();
  if (!stateMatchesDocument(after, reference)) {
    return {
      ok: false,
      reason: 'verification-failed',
      detail: `写入了 ${String(result.imported)} 条 op，但结果与导出不一致`,
    };
  }

  const totals = countState(after);
  return {
    ok: true,
    importedOps: result.imported,
    skippedOps: result.skipped,
    entities: totals.total,
    deleted: totals.deleted,
  };
}

/**
 * 还原**之前**的预告：这份文档导进空库之后会有什么。
 *
 * 🔴 数字来自**重放**，不来自文件自己的声明。原因很具体：`ExportScreen` 的确认面板
 * 原来直接读 `document.counts.entities.TASK?.total ?? 0`，而"只交 op-log"的恢复产物
 * 没有那一格 ⇒ `?? 0` 会**安静地显示"0 条记录、0 条已删除"**，
 * 而真正导进去的是 3 条含 1 墓碑。确认面板说的是"按下去会发生什么"，
 * 它显示 0 就是界面在说谎 —— 不是"少显示一点信息"。
 * 文件自己声明了计数时两者本来就相等（写前的自洽校验保证），所以对完整导出零行为变化。
 */
export function previewRestore(document: RestoreDocument): {
  totalOps: number;
  totalEntities: number;
  totalDeleted: number;
  perType: Record<string, { total: number; deleted: number }>;
} {
  const state = replayOperations(emptyState(), document.opLog);
  const perType: Record<string, { total: number; deleted: number }> = {};
  for (const entityType of MODELED_ENTITY_TYPES) {
    const records = recordsOf(state, entityType);
    if (records.length === 0) continue;
    perType[entityType] = { total: records.length, deleted: records.filter(isTombstone).length };
  }
  const totals = countState(state);
  return {
    totalOps: document.opLog.length,
    totalEntities: totals.total,
    totalDeleted: totals.deleted,
    perType,
  };
}

/**
 * 核对基准：文件自己声明了 `entities` 就用文件那份（两个独立来源，交叉才有意义）；
 * 缺省就用**客户端 reducer** 重放出来的那份。
 *
 * 🔴 两个来源不能在这里合成一个"看起来更完整"的对象：实体和计数必须**整套**来自同一份，
 * 否则就是拿 A 的实体去比 B 的计数，红的时候说不清是谁不对。
 */
function referenceOf(document: RestoreDocument, replayed: MaterializedState): ExportDocument {
  if (document.entities !== undefined) return document as ExportDocument;

  const entities: Record<string, unknown[]> = {};
  const counts: Record<string, { total: number; deleted: number }> = {};
  for (const entityType of MODELED_ENTITY_TYPES) {
    const records = recordsOf(replayed, entityType);
    if (records.length === 0) continue;
    entities[entityType] = records;
    counts[entityType] = { total: records.length, deleted: records.filter(isTombstone).length };
  }
  const totals = countState(replayed);

  return {
    ...document,
    entities,
    counts: {
      ...document.counts,
      entities: counts,
      totalEntities: totals.total,
      totalDeleted: totals.deleted,
    } as ExportDocument['counts'],
  } as ExportDocument;
}

/**
 * 物化状态是否与导出文档**逐项一致**（含墓碑），并且计数也对得上。
 *
 * ⚠️ 这条判据必须能分辨"删了"与"没这条"：导出的每一条（含墓碑）都要在本机
 * 找到**逐字段相同**的记录。只比"活着的那几条"会让"已删数据复活/丢失"
 * 两种最要命的错误同时通过。
 */
export function stateMatchesDocument(
  state: MaterializedState,
  document: ExportDocument,
): boolean {
  const entityTypes = new Set<string>([
    ...MODELED_ENTITY_TYPES,
    ...Object.keys(document.entities),
  ]);

  for (const entityType of entityTypes) {
    const actual = recordsOf(state, entityType);
    const expected = [...(document.entities[entityType] ?? [])].sort(byRecordId);
    if (actual.length !== expected.length) return false;
    for (let i = 0; i < actual.length; i += 1) {
      if (canonical(actual[i]) !== canonical(expected[i])) return false;
    }
  }

  const totals = countState(state);
  if (totals.total !== document.counts.totalEntities) return false;
  if (totals.deleted !== document.counts.totalDeleted) return false;

  for (const entityType of entityTypes) {
    const expectedCount = document.counts.entities[entityType] ?? { total: 0, deleted: 0 };
    const actualRecords = recordsOf(state, entityType);
    const actualCount = {
      total: actualRecords.length,
      deleted: actualRecords.filter(isTombstone).length,
    };
    if (actualCount.total !== expectedCount.total) return false;
    if (actualCount.deleted !== expectedCount.deleted) return false;
  }

  return true;
}

/** 某实体类型在物化状态里的全部记录（含墓碑），按 id 排序。 */
function recordsOf(state: MaterializedState, entityType: string): unknown[] {
  const bucket = bucketFor(state, entityType);
  if (bucket === undefined) return [];
  return Object.values(bucket).sort(byRecordId);
}

/** 全库计数（含墓碑）。 */
function countState(state: MaterializedState): { total: number; deleted: number } {
  let total = 0;
  let deleted = 0;
  for (const entityType of MODELED_ENTITY_TYPES) {
    const records = recordsOf(state, entityType);
    total += records.length;
    deleted += records.filter(isTombstone).length;
  }
  return { total, deleted };
}

function byRecordId(a: unknown, b: unknown): number {
  const ida = String((a as Record<string, unknown>)['id'] ?? '');
  const idb = String((b as Record<string, unknown>)['id'] ?? '');
  return ida.localeCompare(idb);
}

function isTombstone(record: unknown): boolean {
  return (record as Record<string, unknown>)['deletedAt'] !== undefined;
}

/**
 * 与 `export-dump.ts` 里那个**私有**的排序器同形：递归按 key 排序后 `JSON.stringify`。
 *
 * 为什么不从那边 import：那个是序列化细节，导出侧的稳定字节由它自己的测试钉住。
 * 这里要的是"两个对象是否逐字段相同"的**判据** —— 共用同一个私有函数会把
 * "导出格式"与"导入校验"焊死，而它们本就该能各自演进。
 */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

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
