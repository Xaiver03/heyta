/**
 * 滴答清单导入：**导入计划 → op 批次**的构造器（宿主层）
 * =================================================================
 *
 * `packages/domain/src/ticktick-import.ts` 产出的是**纯数据的导入计划**
 * （`TickTickImportPlan`：projects / tags / tasks 三类 draft + 稳定 id）。
 * 这个文件是那条流水线的下一段：**把计划按引用完整性排序、翻成一批 op、
 * 派发进 op-log**，并把 domain 的 `TickTickImportReport` **原样**交回调用方。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 它为什么在 `packages/app-host`（判据见 AGENTS.md §3.5）
 *
 * §3.5 的判据是"这段代码里有没有任何一行在决定'业务上该怎么做'？"。
 * 这里决定的是：**先建清单/标签、再建任务**；**已存在的稳定 id 不再写**；
 * 字段名是 `note` 不是 `notes`。三条全是产品语义，而每个宿主
 * （Web / 移动端 / CLI）都必须给出**一模一样**的答案。
 * 放进 `apps/*`，下一个宿主就会再写一遍并漂移（§3.5 末尾那条教训）。
 *
 * 它**不在** `packages/domain`：op 需要 `clientId` / `vectorClock` / 线协议
 * 类型，那些是宿主与 op-log 的事。domain 只产出纯数据计划。
 *
 * ## 🔴 侦察事实：op 的 `clientId` / `vectorClock` 不是这里填的
 *
 * 本轮实测确认：`ActionContext.dispatch()` 收的是 **`OpIntent`**
 * （`packages/op-log/src/engine.ts:40`），里面**没有** `clientId` / `vectorClock`；
 * 它们在 `OpLogEngine.buildOp()`（同文件 252-286 行）里被**盖章**：
 *
 *     clientId: this.options.clientId
 *     vectorClock: <dispatch 时算好的时钟>
 *
 * 这不是"漏了"，而是**既有形状**：`createTaskActions` / `createProjectActions`
 * 全都只构造 `OpIntent`，`clientId` 只存在引擎里一处。上一轮计划里写的
 * "op 需要 clientId/vectorClock"描述的是**最终落盘的 `Operation`**，
 * 而 app-host 这一层的职责边界到 `OpIntent` 为止。照抄既有形状，不另造一份。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 顺序：引用完整性**单点定义**在 `TICKTICK_IMPORT_ORDER`
 *
 * heyta 的 op 是**按实体**写的（`OpIntent` 只接受单一 `entityType`，
 * 见 `entities.ts` 里 `Task.repeatRule` 上那段：reducer 根本没有处理
 * `MultiEntityPayload`），所以"导入一个文件"必然是一批 op。
 * 任务 op 的载荷里带 `projectId` / `tagIds` —— 那些 id 指向的实体
 * **必须先写进 op-log**，否则（reducer 不做跨实体校验）会安静地留下
 * **孤儿引用**："导入成功"了，但任务挂着一个任何视图都查不到的清单/标签。
 *
 * 顺序只有一份定义：`TICKTICK_IMPORT_ORDER = ['project', 'tag', 'task']`。
 * 构造器**不依赖** `plan.projects` 的先后，而是按这个常量重排；清单内部
 * 还额外保证**父先于子**（`parentId` 指向的 folder 排在被指向的清单前面）。
 *
 * ## 🔴 幂等：判据是**"目标状态里已经有这个稳定 id"**
 *
 * `plan` 里每个 draft 的 `id` 都来自 domain 的 `stableTickTickId` ——
 * 只由文件内容派生，同一份文件两次解析得到**逐字节相同**的 id。
 * 所以幂等的判据只有一条：
 *
 *     目标物化状态里已存在该 id ⟹ **不构造 op、不派发、计数进 `skipped`**
 *
 * 于是"同一份文件导两次"的端到端判据是硬的：
 *   ① 第二次 `opCount === 0`；② `getPendingUpload()` 长度不变；
 *   ③ 实体总数不变。三条都被 `ticktick-import-actions.spec.ts` 直接断言。
 *
 * ⚠️ **两点如实说明，不粉饰：**
 *
 *   1. **"已存在"包括墓碑。** 用户手工删掉某条导入的任务之后再导同一份文件，
 *      该 id 仍在物化状态里（带 `deletedAt`），构造器**跳过**它 ——
 *      即**不复活用户的删除**。这是保守选择：复活比不导更糟。
 *   2. **domain 的 `mergeTickTickPlans` 是另一道闸门，不是同一道。**
 *      它按 id 去重的是**计划对计划**（调用方若持久化了上一次的计划就用它）；
 *      这里去重的是**计划对物化状态**（库才是唯一事实）。两者互补，不重复。
 *
 * ## 🔴 不静默丢数据：report 原样交回 + 派发前先验引用
 *
 *   - `importPlan(plan, report)` **返回的 `report` 就是传进来的那个对象**
 *     （同一个引用，测试用 `toBe` 钉住）。构造器不改写、不丢字段、
 *     不把 `unmapped` 清空 —— 那些"滴答有、heyta 没有归宿"的原值
 *     要在导入预览里给用户看。
 *   - **派发任何 op 之前**先把整批的引用验一遍（任务的 `projectId` / `tagIds`、
 *     清单的 `parentId` 必须在"目标状态 ∪ 本批"里）。验不过**抛错，一个 op 都不写**。
 *     这同时消灭了"写了一半才发现引用是坏的"这种半截状态。
 *   - 派发期间引擎抛错**原样向上抛**，绝不 `try/catch` 后返回"成功"。
 *
 * ## ⚠️ 本轮实测到的**丢失**（逐条给影响与最小一步）
 *
 *   1. **`draft.createdAt` / `draft.updatedAt` 落不进实体。**
 *      实测 `packages/op-log/src/state.ts:270`：新建实体的 `createdAt` 恒取
 *      `op.timestamp`；`updatedAt` 在 247 行也恒被 op 时间戳覆盖。
 *      影响：导入后的任务/清单，其 `createdAt` 是**导入时刻**，不是滴答的
 *      `Created Time`；列表按 `(createdAt, id)` 排序，于是导入的一批会按导入顺序
 *      而非滴答的创建时间排。`updatedAt` 同理。
 *      最小一步：要么在 `OpIntent` 上支持"这次写入用这个时间戳"（动 op-log），
 *      要么每条任务多发一条 `UPD { createdAt }`（违反 §3.4"一个用户意图 = 一个 op"）。
 *      **两条都要动别的包，本轮不改，写进汇报由父 agent 协调。**
 *   2. **`draft.order` 对清单没有落点。** `Project` 实体（`entities.ts:170`）
 *      只有 `name` / `parentId` / `color` / `archived`，**没有 `order`**。
 *      任务有（`Task.order`），清单没有。往载荷里塞一个未登记的键会绕开
 *      schema 纪律（§3.3），所以**刻意不写**。
 *      影响：`TickTickProjectDraft.order` 被丢弃，清单列表按 `(createdAt, id)` 排。
 *      最小一步：给 `Project` 加可选 `order?: number`（domain 改动，需协调）。
 *   3. **`draft.sourceKey` 不落库。** 它只是 id 的派生输入，落库没有用途
 *      （幂等靠 id，不靠 sourceKey）。这是有意不写，不是遗漏。
 *
 * ## 本轮**明确没做**
 *
 *   - **UI 入口 / 文件选择 / 导入预览弹窗 / 进度 / 撤销** —— 一行都没写。
 *   - **一个事务地原子导入**：`ActionContext` 只有 `dispatch` 与 `getState`，
 *     没有批量写入口，所以一批 op 是**逐条**落盘的，中途崩溃会留下"导了一半"。
 *     ⚠️ 但**这一半是幂等可续的**：重跑同一份文件时，已写的实体全部进 `skipped`，
 *     剩余部分继续 —— 这正是稳定 id 换来的恢复能力。真正的原子性需要
 *     `OpLogEngine.importOperations` 那类批量入口，不在 `ActionContext` 上。
 */

import { Priority, type TickTickImportPlan, type TickTickImportReport } from '@heyta/domain';
import type { MaterializedState, OpIntent } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';

// ── 顺序：唯一一份定义 ───────────────────────────────────────

/**
 * 三类实体的派发顺序 —— **引用完整性的唯一事实源**。
 *
 * 必须是 清单(`project`) → 标签(`tag`) → 任务(`task`)。
 * 改动它会让 `ticktick-import-actions.spec.ts` 的"顺序"与"引用完整性"用例变红
 * （已做故障注入证明）。任务载荷引用前两者，前两者不引用任务 —— 依赖图是单向的。
 */
export const TICKTICK_IMPORT_ORDER = ['project', 'tag', 'task'] as const;

export type TickTickImportKind = (typeof TICKTICK_IMPORT_ORDER)[number];

export interface TickTickImportCounts {
  projects: number;
  tags: number;
  tasks: number;
}

export interface TickTickImportBatchEntry {
  kind: TickTickImportKind;
  /** = op 的 `entityId`。稳定 id，直接来自计划。 */
  entityId: string;
  intent: OpIntent;
}

/** 一批"要写进 op-log 的东西"，已排好序。**纯数据，无副作用。** */
export interface TickTickImportBatch {
  /** 本次真正要新建的三类 draft（目标状态里**没有**的那些）。 */
  plan: TickTickImportPlan;
  /** 按 {@link TICKTICK_IMPORT_ORDER} 排好的 op 意图（清单内父先于子）。 */
  entries: readonly TickTickImportBatchEntry[];
  /** 因为稳定 id 已存在于目标状态而**跳过**的数量。 */
  skipped: TickTickImportCounts;
}

// ── 载荷构造：字段名只有这一处 ───────────────────────────────

/**
 * 任务 draft → op 载荷。**字段名单点定义在这里**。
 *
 * 🔴 与 `actions.ts` 的 `createTaskActions.create` 是同一条产品语义：
 * 新建任务默认 `priority = Priority.None`；备注字段名是 **`note`（单数）**
 * （写成 `notes` 会同步到每台设备却没有任何视图读得到 —— 见 `NewTaskFields.note`）。
 *
 * ⚠️ **字段原样写进去，不做二次 trim / 不做 CSV 相关处理。** 标题里的逗号、
 * 换行、emoji 是**数据**：domain 负责 CSV 反引号转义，这里只负责搬运。
 * 在这里再 `split(',')` 或 `slice()` 一次，就会把标题截断成一个看着正常的错值。
 */
export function tickTickTaskPayload(
  draft: TickTickTaskDraftLike,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: draft.title,
    priority: draft.priority ?? Priority.None,
  };
  // 可选字段：**缺省就不放这个键**（而不是写 undefined/null）——
  // `undefined` 会被 JSON 丢掉，`null` 在 reducer 里是"显式清除"，
  // 两者语义都与"滴答没给这个字段"不同。
  if (draft.note !== undefined) payload.note = draft.note;
  if (draft.projectId !== undefined) payload.projectId = draft.projectId;
  if (draft.tagIds !== undefined && draft.tagIds.length > 0) payload.tagIds = [...draft.tagIds];
  if (draft.dueDate !== undefined) payload.dueDate = draft.dueDate;
  if (draft.completedAt !== undefined) payload.completedAt = draft.completedAt;
  if (draft.repeatRule !== undefined) payload.repeatRule = draft.repeatRule;
  if (draft.repeatDtstart !== undefined) payload.repeatDtstart = draft.repeatDtstart;
  if (draft.order !== undefined) payload.order = draft.order;
  return payload;
}

/** `TickTickTaskDraft` 的结构子集（避免为一个函数 import 类型时形成环）。 */
type TickTickTaskDraftLike = TickTickImportPlan['tasks'][number];

function projectIntent(draft: TickTickImportPlan['projects'][number]): OpIntent {
  return {
    entityType: 'PROJECT' as EntityType,
    entityId: draft.id,
    opType: OpType.Create,
    // 无父显式写 `null`，不做"不放这个键"的分支 —— 与
    // `project-actions.ts` 文件头第 1 条同一条规则：同一件事只能有一种写法。
    payload: { name: draft.name, parentId: draft.parentId ?? null },
  };
}

function tagIntent(draft: TickTickImportPlan['tags'][number]): OpIntent {
  return {
    entityType: 'TAG' as EntityType,
    entityId: draft.id,
    opType: OpType.Create,
    payload: { name: draft.name },
  };
}

function taskIntent(draft: TickTickImportPlan['tasks'][number]): OpIntent {
  return {
    entityType: 'TASK' as EntityType,
    entityId: draft.id,
    opType: OpType.Create,
    payload: tickTickTaskPayload(draft),
  };
}

// ── 纯构造：计划 + 状态 → 排好序的批次 ───────────────────────

/** 物化状态桶里有没有这个 id（**含墓碑** —— 见文件头幂等第 1 条）。 */
function idPresent(bucket: Record<string, unknown>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(bucket, id);
}

/**
 * 清单 draft 排序：**父先于子**，其余保持计划里的相对顺序。
 *
 * heyta 只支持一层（folder → list），所以正常情况下一次扫描就够；
 * 这里写成循环是为了"深度嵌套的计划也不会静默产出孤儿清单"。
 * 有环或父缺失的会被留在 `remaining` 里 —— 随后引用校验会抛错。
 */
function orderProjectDrafts(
  drafts: readonly TickTickImportPlan['projects'][number][],
  existingProjectIds: ReadonlySet<string>,
): Array<TickTickImportPlan['projects'][number]> {
  const ordered: Array<TickTickImportPlan['projects'][number]> = [];
  const emitted = new Set<string>();
  let remaining = [...drafts];

  // 父已在目标状态里的（或本来就是顶层）可以立刻发。
  let progressed = true;
  while (progressed && remaining.length > 0) {
    progressed = false;
    const next: typeof remaining = [];
    for (const draft of remaining) {
      const parent = draft.parentId;
      const ready =
        parent === undefined || existingProjectIds.has(parent) || emitted.has(parent);
      if (ready) {
        ordered.push(draft);
        emitted.add(draft.id);
        progressed = true;
      } else {
        next.push(draft);
      }
    }
    remaining = next;
  }
  // 父缺失/成环的留在最后：引用校验会先拦住它们（不会走到派发）。
  return [...ordered, ...remaining];
}

/**
 * 把一份导入计划翻成排好序的 op 批次。**纯函数**：只读状态，不派发、不写。
 *
 * 引用完整性在**这里**验：任务的 `projectId` / `tagIds`、清单的 `parentId`
 * 必须落在"目标状态里已有的 id ∪ 本批新增的 id"里，否则抛错。
 * 因为是纯函数且不派发，调用方可以拿它做**导入预览**（`previewPlan`）。
 */
export function planTickTickImportBatch(
  plan: TickTickImportPlan,
  state: MaterializedState,
): TickTickImportBatch {
  // 1. 幂等闸门：稳定 id 已存在就跳过（含墓碑）。
  const projectBucket = state.projects as unknown as Record<string, unknown>;
  const tagBucket = state.tags as unknown as Record<string, unknown>;
  const taskBucket = state.tasks as unknown as Record<string, unknown>;

  const newProjects = plan.projects.filter((draft) => !idPresent(projectBucket, draft.id));
  const newTags = plan.tags.filter((draft) => !idPresent(tagBucket, draft.id));
  const newTasks = plan.tasks.filter((draft) => !idPresent(taskBucket, draft.id));

  const skipped: TickTickImportCounts = {
    projects: plan.projects.length - newProjects.length,
    tags: plan.tags.length - newTags.length,
    tasks: plan.tasks.length - newTasks.length,
  };

  // 2. 可引用的 id 集合 = 状态里已有的 ∪ 本批新增的。
  const availableProjectIds = new Set<string>(Object.keys(projectBucket));
  for (const draft of newProjects) availableProjectIds.add(draft.id);
  const availableTagIds = new Set<string>(Object.keys(tagBucket));
  for (const draft of newTags) availableTagIds.add(draft.id);

  // 3. 引用校验：派发前拦住孤儿，**一个 op 都不写**。
  for (const draft of newProjects) {
    if (draft.parentId !== undefined && !availableProjectIds.has(draft.parentId)) {
      throw new Error(
        `导入计划里清单「${draft.name}」引用了不存在的父清单「${draft.parentId}」`,
      );
    }
  }
  for (const draft of newTasks) {
    if (draft.projectId !== undefined && !availableProjectIds.has(draft.projectId)) {
      throw new Error(
        `导入计划里任务「${draft.title}」引用了不存在的清单「${draft.projectId}」`,
      );
    }
    for (const tagId of draft.tagIds ?? []) {
      if (!availableTagIds.has(tagId)) {
        throw new Error(
          `导入计划里任务「${draft.title}」引用了不存在的标签「${tagId}」`,
        );
      }
    }
  }

  // 4. 按**唯一一份顺序**重排。父先于子只在清单内部再排一次。
  const orderedProjects = orderProjectDrafts(newProjects, new Set(Object.keys(projectBucket)));
  const byKind: Record<TickTickImportKind, TickTickImportBatchEntry[]> = {
    project: orderedProjects.map((draft) => ({
      kind: 'project' as const,
      entityId: draft.id,
      intent: projectIntent(draft),
    })),
    tag: newTags.map((draft) => ({
      kind: 'tag' as const,
      entityId: draft.id,
      intent: tagIntent(draft),
    })),
    task: newTasks.map((draft) => ({
      kind: 'task' as const,
      entityId: draft.id,
      intent: taskIntent(draft),
    })),
  };

  return {
    plan: { projects: orderedProjects, tags: newTags, tasks: newTasks },
    entries: TICKTICK_IMPORT_ORDER.flatMap((kind) => byKind[kind]),
    skipped,
  };
}

// ── 动作层：派发批次 ─────────────────────────────────────────

/** `importPlan()` 的结果。 */
export interface TickTickImportResult {
  /**
   * domain 的导入报告，**原样交回**（同一个引用）。
   *
   * 构造器**不改写**它：`unmapped` / `skipped` 是给用户看的导入预览，
   * 丢掉它就是静默丢数据。
   */
  report: TickTickImportReport;
  /** 本次真正写进去的三类 draft（= `batch.plan`）。 */
  plan: TickTickImportPlan;
  added: TickTickImportCounts;
  skipped: TickTickImportCounts;
  /** 本次派发的 op 条数。同一份文件导第二次时必须是 **0**。 */
  opCount: number;
}

export interface TickTickImportActions {
  /**
   * 把一份导入计划写成 op 批次，并把 `report` 原样交回。
   *
   * 顺序、幂等、引用校验全在 {@link planTickTickImportBatch} 里 ——
   * 这里只负责按序 `dispatch`。
   */
  importPlan(plan: TickTickImportPlan, report: TickTickImportReport): Promise<TickTickImportResult>;
  /**
   * 只看**这次会写什么**，一个字都不写。
   *
   * UI 的导入预览要用它（本轮不写 UI），也方便宿主先弹确认再 `importPlan`。
   * 引用的 id 已经在里面查过了。
   */
  previewPlan(plan: TickTickImportPlan): TickTickImportBatch;
}

export function createTickTickImportActions(ctx: ActionContext): TickTickImportActions {
  return {
    previewPlan(plan) {
      return planTickTickImportBatch(plan, ctx.getState());
    },

    async importPlan(plan, report) {
      const batch = planTickTickImportBatch(plan, ctx.getState());

      // **不上 try/catch**：引擎抛错就让它穿过去。
      // 吞掉异常再返回"成功"，会让调用方把一个半截导入当成完整导入。
      for (const entry of batch.entries) {
        await ctx.dispatch(entry.intent);
      }

      return {
        report,
        plan: batch.plan,
        added: {
          projects: batch.plan.projects.length,
          tags: batch.plan.tags.length,
          tasks: batch.plan.tasks.length,
        },
        skipped: batch.skipped,
        opCount: batch.entries.length,
      };
    },
  };
}
