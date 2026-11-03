/**
 * 任务动态：把一条 TASK 的 op 历史折成"谁在什么时候改了什么"
 * ==========================================================
 *
 * 对标的那款产品把它叫「任务动态」。我们比它有好得多的底座 —— op-log 本来就
 * 存了每一条操作，所以这件事**不需要新字段、不需要新实体、不需要写路径**，
 * 只需要一个纯读投影。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三条决定形状的理由
 *
 * 1. 🔴 **入参是结构类型，不是 `Operation`。** `packages/domain` 的依赖只有
 *    `@heyta/shared-schema` + ical.js（见本包 `package.json`），**没有** sync-core。
 *    为了一个读投影去加依赖方向，等于让领域层认识线协议实现。
 *    先例是本仓的 `mention-tasks.ts`（`MentionTaskLike`）与 `isLive` 的窄入参。
 *
 * 2. 🔴 **"旧值"靠投影自己折出来，不靠猜。** 逐条 op 只带**新值**
 *    （reducer 是逐字段合并，`UPD` 的载荷里没有旧值）。所以这里从最早一条开始
 *    把载荷叠在一个快照上，轮到某条 op 时，"改之前"就是当前快照的值。
 *    直接从单条 op 里读 `from` 会得到 `undefined`，而界面会把它显示成
 *    "从空改成 X" —— 那是**假事实**。
 *
 * 3. 🔴 **不生成文案。** 与 `packages/ui` 同一条边界：领域层不 import i18n。
 *    这里只返回结构（字段名 + 旧值 + 新值），怎么说那句话归宿主。
 *    ⚠️ 标题/备注这类正文**会出现在事件里** —— 本机日志里存的就是明文
 *    （仓库既有档位，见 `packages/app-host/src/share-comments.ts` 文件头），
 *    但提供 `includeValues: false` 那一档，供"只想说改了哪个字段"的场景用。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 覆盖范围（这条决定界面能说什么话）
 *
 * 同步下行的 op **会**进本地 op-log（实测：`packages/op-log/src/engine.ts:597`
 * 的 `applyRemoteLocked` 第一步就 `appendBatchSkipDuplicates(ops, 'remote', …)`），
 * 所以事件里**包含别的设备写的**。
 *
 * ⚠️ 但一台**新设备**是先拿快照再增量同步的，它的本地日志可能不含全部历史。
 * 所以这一族能说的是"这台设备记录到的变更流水"，**不许**说成"这条任务的完整历史"。
 * 要把后者做真，需要服务端提供按实体的历史端点 —— 现量服务端没有那样的端点。
 */

/** 投影要吃的那一小截 op 形状（见文件头理由 1）。 */
export interface TaskActivityOp {
  readonly id: string;
  readonly opType: string;
  readonly timestamp: number;
  readonly clientId?: string;
  readonly entityId?: string;
  readonly entityIds?: readonly string[];
  readonly payload?: unknown;
}

/**
 * 会被认出来的字段。
 *
 * 🔴 这是一份**白名单**而不是"载荷里有什么就报什么"：没列进来的键多半是
 * 内部字段（`id` / `createdAt` / `updatedAt`）或还没定语义的新字段，
 * 直接吐给界面会出现"用户看到一条他看不懂的变更"。
 * 认不出的走 `other` 并保留 `rawField`，宿主可以选择忽略或兜底显示。
 */
export type TaskActivityField =
  | 'title'
  | 'note'
  | 'dueDate'
  | 'priority'
  | 'projectId'
  | 'tagIds'
  | 'parentId'
  | 'repeatRule'
  | 'repeatDtstart'
  | 'startDate'
  | 'durationMinutes'
  | 'completedAt'
  | 'pinnedAt'
  | 'abandonedAt'
  | 'deletedAt'
  | 'other';

/** 载荷里认识的键 → 语义字段名。唯一一份，宿主不许再抄一张表。 */
export const TASK_ACTIVITY_FIELDS = {
  title: 'title',
  note: 'note',
  dueDate: 'dueDate',
  priority: 'priority',
  projectId: 'projectId',
  tagIds: 'tagIds',
  parentId: 'parentId',
  repeatRule: 'repeatRule',
  repeatDtstart: 'repeatDtstart',
  startDate: 'startDate',
  durationMinutes: 'durationMinutes',
  completedAt: 'completedAt',
  pinnedAt: 'pinnedAt',
  abandonedAt: 'abandonedAt',
  deletedAt: 'deletedAt',
} as const satisfies Record<string, TaskActivityField>;

/** 不进事件的内部字段（每次写 op 都会带，报出来全是噪音）。 */
const IGNORED_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'dueDateLocal', 'startDateLocal']);

export interface TaskActivityChange {
  readonly field: TaskActivityField;
  /** 白名单外的键名原样带回来，供宿主决定怎么兜底。`field === 'other'` 时非空。 */
  readonly rawField?: string;
  /** 改之前的值（由投影自己折出来）。`undefined` = 改之前这个字段不存在。 */
  readonly from: unknown;
  /** 改之后的值。`undefined` = 这条 op 把它清掉了（载荷里写的是 `null`）。 */
  readonly to: unknown;
  /** 显式清除：载荷写的是 `null`，reducer 会删掉这个字段。 */
  readonly cleared: boolean;
}

export interface TaskActivityEvent {
  readonly at: number;
  readonly opId: string;
  readonly kind: 'created' | 'updated' | 'deleted' | 'restored';
  readonly clientId: string;
  /** 这条是不是本机写的（`clientId === localClientId`）。 */
  readonly local: boolean;
  readonly changes: readonly TaskActivityChange[];
  /**
   * 这条 op 同时覆盖了别的任务（`entityIds` / BATCH）。
   * ⚠️ 此时 `changes` 只包含**本任务那一份**；标出来是因为宿主可能想说
   *   "这是一次批量操作"，而它不能从 `changes` 里自己推出来。
   */
  readonly batched: boolean;
}

export interface ProjectTaskActivityOptions {
  /** 本机 clientId，用来判"这条是我写的还是别的设备写的"。 */
  readonly localClientId: string;
  /** 默认 `true`。关掉后 `from` / `to` 一律不填（隐私敏感场景）。 */
  readonly includeValues?: boolean;
  /** 最多返回多少条（从最近往回数）。默认 50。 */
  readonly limit?: number;
}

/** 载荷里 `null` 的语义是"显式删除这个字段"（`packages/op-log/src/state.ts` 的合并规则）。 */
function isClear(value: unknown): boolean {
  return value === null;
}

function asRecord(payload: unknown): Record<string, unknown> | undefined {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : undefined;
}

/**
 * BATCH / `entityIds` 那条 op 的载荷里可能装着**一批任务**。
 * 只取属于本任务的那一份，否则会把别人任务的改动算到这条头上。
 *
 * 🔴 认不出结构时返回 `undefined` ⇒ 这条只记"发生过一次批量操作"，
 *   **不拿整份包装载荷去当字段表遍历**。那样做的症状是流水里冒出一条
 *   `ids` / `entityIds` 之类的"字段变更"，而它根本不是这条任务改了什么 ——
 *   写这条的时候我自己就先踩了一次（把 `{ ids: [...] }` 判成了 `other: ids`）。
 */
function payloadForTask(
  payload: unknown,
  taskId: string,
  batched: boolean,
): Record<string, unknown> | undefined {
  const record = asRecord(payload);
  if (record === undefined) return undefined;
  const tasks = record['tasks'];
  if (Array.isArray(tasks)) {
    return asRecord(tasks.find((entry) => asRecord(entry)?.['id'] === taskId));
  }
  // 批量 op 但载荷不是 `tasks` 那种形状 ⇒ 不知道哪一份属于本任务，宁可不报。
  return batched ? undefined : record;
}

function classify(field: string): { field: TaskActivityField; rawField?: string } {
  const known = TASK_ACTIVITY_FIELDS as Record<string, TaskActivityField>;
  const mapped = known[field];
  return mapped === undefined ? { field: 'other', rawField: field } : { field: mapped };
}

/**
 * 把一条 TASK 的 op 序列折成事件序列。
 *
 * **纯函数**：不读时钟、不读存储、不写 op（§3.4：这是读路径，零副作用）。
 * 入参顺序不敏感（内部先按 `timestamp` 升序再折）。
 */
export function projectTaskActivity(
  ops: readonly TaskActivityOp[],
  taskId: string,
  options: ProjectTaskActivityOptions,
): readonly TaskActivityEvent[] {
  const includeValues = options.includeValues ?? true;
  const limit = options.limit ?? 50;

  const mine = ops
    .filter(
      (op) => op.entityId === taskId || (op.entityIds !== undefined && op.entityIds.includes(taskId)),
    )
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : 1));

  /** 折叠用的快照：轮到某条 op 时，它就是"改之前"的样子。见文件头理由 2。 */
  const snapshot: Record<string, unknown> = {};
  const events: TaskActivityEvent[] = [];

  for (const op of mine) {
    const batched =
      op.opType === 'BATCH'
      || op.entityIds !== undefined
      || Array.isArray(asRecord(op.payload)?.['tasks']);
    const payload = payloadForTask(op.payload, taskId, batched) ?? {};
    const changes: TaskActivityChange[] = [];

    for (const [key, next] of Object.entries(payload)) {
      if (IGNORED_KEYS.has(key)) continue;
      const cleared = isClear(next);
      const value = cleared ? undefined : next;
      const previous = snapshot[key];
      if (!cleared && previous === value) continue; // 写了个一样的值：不是变更
      changes.push({ ...classify(key), from: includeValues ? previous : undefined, to: includeValues ? value : undefined, cleared });
      if (cleared) delete snapshot[key];
      else snapshot[key] = value;
    }

    const kind =
      op.opType === 'CRT'
        ? 'created'
        : op.opType === 'DEL'
          ? 'deleted'
          : isClear(payload['deletedAt'])
            ? 'restored'
            : 'updated';

    if (kind === 'deleted') snapshot['deletedAt'] = op.timestamp;
    if (kind === 'restored') delete snapshot['deletedAt'];

    events.push({
      at: op.timestamp,
      opId: op.id,
      kind,
      clientId: op.clientId ?? '',
      local: (op.clientId ?? '') === options.localClientId,
      changes: kind === 'created' ? changes.filter((c) => c.field !== 'other') : changes,
      batched,
    });
  }

  return events.slice(-Math.max(0, limit)).reverse();
}

/** 事件里出现过的字段集合（宿主用来决定"这一屏要不要显示动态那一格"）。 */
export function taskActivityTouchedFields(
  events: readonly TaskActivityEvent[],
): ReadonlySet<TaskActivityField> {
  const acc = new Set<TaskActivityField>();
  for (const event of events) for (const change of event.changes) acc.add(change.field);
  return acc;
}

/**
 * 这条流水**能说到什么程度**。
 *
 * 🔴 单独把这个判断做成一个出口，是因为它是一句**对外承诺**：
 * 新设备的本地日志可能只有快照 + 增量，此时"完整历史"是不实陈述。
 * 界面拿它决定说"这台设备记录到的变更"还是"这条任务的完整历史"。
 */
export function taskActivityCoverage(input: {
  readonly taskCreatedAt: number | undefined;
  readonly earliestEventAt: number | undefined;
}): 'complete' | 'device-local-only' | 'empty' {
  if (input.earliestEventAt === undefined) return 'empty';
  if (input.taskCreatedAt === undefined) return 'device-local-only';
  // 只有当本地最早的那条 op 就是**建这条任务的那条**，才敢说完整。
  return input.earliestEventAt <= input.taskCreatedAt ? 'complete' : 'device-local-only';
}
